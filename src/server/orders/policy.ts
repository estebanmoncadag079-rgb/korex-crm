/**
 * La autorización y la ejecución de **confirmar un pedido** — la única acción
 * del vertical de pedidos que produce efectos externos irreversibles.
 *
 * ## Qué es esto (Fase 1 del plan de migración)
 *
 * `docs/korexia/156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX.md` auditó diez
 * incidentes reales y descartó explícitamente construir un orquestador de
 * intención: **ninguno de los diez se explicaba por "el modelo eligió mal la
 * acción"**. Lo que sí faltaba era una autoridad backend, acotada a las
 * acciones irreversibles, que decidiera si una acción propuesta puede
 * ejecutarse. Este archivo es la Fase 1 de ese plan para `notify_order`.
 *
 * **Es una mudanza, no un rediseño.** El código de abajo salió tal cual de
 * `pipeline.ts` (`case "notify_order"` y el guardarraíl de pedido ya
 * confirmado). No cambia ni una decisión, ni un orden de operaciones, ni un
 * mensaje. Lo único nuevo es el sitio y el contrato.
 *
 * ## La línea de corte: decidir vs. reaccionar
 *
 * El contrato del documento (sección 7, `AllowedAction`) dice que la Policy
 * devuelve un veredicto — `{ok:true}` o `{ok:false, motivo, correccion}` —, no
 * que ejecute la reacción. Por eso `puedeConfirmarPedido` **decide y nada
 * más**: reintentar con el modelo, derivar a una persona y anotar la traza
 * siguen siendo del pipeline, que es quien conduce el turno.
 *
 * Se dejó FUERA el guardarraíl financiero (`inconsistenciaFinancieraDePedido`)
 * a propósito, aunque el plan lo nombraba: no es una decisión sobre la acción
 * propuesta sino una comprobación sobre el TEXTO que el modelo va a enviar, y
 * vive entretejida con el bucle de reintentos del turno. Moverlo sería
 * reescribirlo, y esta fase se definió como riesgo cero.
 *
 * ## Por qué los efectos llegan por parámetro
 *
 * `deliverReply`, `asegurarOwnershipVigente`, `appendLeadNote` y `applyHandoff`
 * viven en `pipeline.ts`. Importarlos desde aquí crearía un ciclo entre los dos
 * módulos; recibirlos como `efectos` lo evita, deja explícito todo lo que este
 * código puede tocar del mundo exterior, y hace que se pueda probar sin montar
 * medio pipeline.
 */
import { publish } from "@/server/events/bus";
import { contactPhoneOf, notifyTeam } from "@/server/ai/notify-team";
import {
  registrarConfirmacionDePedido,
  borrarConfirmacionDePedido,
  intentarNotificarPedido,
  ultimaConfirmacionDe,
} from "@/server/ai/confirmacion-de-pedido";
import { onLeadWon } from "@/server/inbox/lead-activity";
import { buscarProductos } from "@/server/catalog/buscar";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { guardarEntregaVerificada, type EstadoDelPedido } from "@/server/orders/estado";
import type { Requisito } from "@/server/ai/generador/ficha";
import { enPesos, faltaParaElMinimoDeDomicilio } from "@/server/orders/minimo-de-domicilio";
import { requisitoSatisfecho } from "@/server/orders/extraer";

/**
 * El veredicto de la Policy sobre una acción irreversible propuesta por el
 * modelo. `correccion` es lo que se le dice al modelo para que lo intente de
 * otra forma; `motivo` es para los logs y para quien atienda después.
 */
export type VeredictoDePedido =
  | { ok: true }
  | { ok: false; motivo: string; correccion: string };

export const CORRECCION_DE_PEDIDO_YA_CONFIRMADO =
  "[SISTEMA] Este pedido YA fue confirmado y notificado al equipo anteriormente en esta " +
  "misma conversación — no vuelvas a usar la acción notify_order para él, sin importar lo " +
  "que diga el historial. Responde directamente a lo último que escribió el cliente (una " +
  "pregunta, un comentario, lo que sea) como una conversación normal. Si de verdad está " +
  "pidiendo algo NUEVO y distinto, trátalo como un pedido aparte: solo entonces puede volver " +
  "a corresponder notify_order, con ese contenido nuevo.";

/**
 * ¿Puede este turno confirmar un pedido?
 *
 * Incidente real (5-sep-2026, Caso B): un mensaje del cliente DESPUÉS de un
 * cierre exitoso podía reabrir la confirmación. `conversation_state.confirmado`
 * no basta como fuente de verdad — lo que importa es si YA existe una fila en
 * `order_confirmation` para esta conversación.
 *
 * Con una confirmación previa, `notify_order` solo procede cuando ALGÚN mensaje
 * del cliente POSTERIOR a esa confirmación nombra un producto real del catálogo
 * —verificado con `buscarProductos`, el mismo matcher ya probado que usa
 * `consultar_producto`, nunca comparando el `summary` en texto libre del
 * modelo—. Sin eso, lo que se pide confirmar es, con altísima probabilidad, el
 * pedido que ya se cerró. Un pedido genuinamente nuevo (el cliente vuelve a
 * nombrar algo del catálogo) queda libre de inmediato: esto nunca bloquea la
 * conversación, solo el cierre repetido de UN pedido ya cerrado.
 *
 * Acotado a `productosDelPedido.length > 0` (catálogo en tabla): sin un
 * catálogo real contra qué verificar, no hay forma de reconocer "pedido nuevo"
 * sin caer otra vez en comparar texto libre — hoy cubre a los tres negocios
 * reales que toman pedidos.
 *
 * **T017 (feature 003-backend-como-autoridad, Principio 7), ampliación
 * aditiva:** además de la idempotencia de arriba (sin tocarla), si
 * `estadoGuardado` viene informado —solo ocurre con `state_source='backend'`,
 * ningún negocio real hoy— también exige que la HOJA esté completa: al menos
 * un ítem resuelto, el total ya calculado por el backend, y todo requisito
 * `obligatorio` con un valor. `data-model.md` sección 4: "`confirmar` no es
 * una operación como las demás" — marca la intención en memoria, pero la
 * AUTORIDAD sobre si eso cierra de verdad sigue siendo de esta Policy.
 */
export async function puedeConfirmarPedido(input: {
  conversationId: string;
  productosDelPedido: ProductoDelCatalogo[];
  history: { direction: string; text: string | null; createdAt: Date }[];
  /**
   * El estado tal como quedó DESPUÉS de aplicar el lote de este turno
   * (`pipeline.ts`, `guardarEstadoPropuesto`) — nunca el de antes, porque
   * `confirmar` puede venir en el MISMO lote que completó lo que faltaba.
   * `undefined`/`null` = `state_source !== 'backend'`: esta Policy no exige
   * nada nuevo, se comporta exactamente como antes de esta feature.
   */
  estadoGuardado?: EstadoDelPedido | null;
  /** Lo que ESTE negocio declaró para poder cerrar — para el chequeo de arriba. */
  requisitos?: Requisito[];
  /**
   * Pedido mínimo para domicilio, en centavos, tal como lo declara la ficha
   * (`entrega.minimoDomicilioCents`). Ausente/`0` = este negocio no tiene
   * mínimo, que es el caso de casi todos.
   */
  minimoDomicilioCents?: number;
}): Promise<VeredictoDePedido> {
  if (input.productosDelPedido.length === 0) return { ok: true };

  const ultimaConfirmacion = await ultimaConfirmacionDe(input.conversationId);
  if (ultimaConfirmacion) {
    const huboPedidoNuevo = input.history.some(
      (m) =>
        m.direction === "in" &&
        m.createdAt.getTime() > ultimaConfirmacion.createdAt.getTime() &&
        Boolean(m.text) &&
        buscarProductos(input.productosDelPedido, m.text!).status !== "not_found"
    );
    if (!huboPedidoNuevo) {
      return {
        ok: false,
        motivo: `ya existe una confirmación (${ultimaConfirmacion.id}) y ningún mensaje del cliente desde entonces nombra un producto del catálogo`,
        correccion: CORRECCION_DE_PEDIDO_YA_CONFIRMADO,
      };
    }
  }

  if (input.estadoGuardado) {
    const estado = input.estadoGuardado;
    if (estado.items.length === 0) {
      return {
        ok: false,
        motivo: "el pedido no tiene ítems resueltos",
        correccion:
          "[SISTEMA] Todavía no hay ningún producto en el pedido — pregúntale al cliente qué quiere pedir antes de confirmar.",
      };
    }
    if (estado.totalCents === null) {
      return {
        ok: false,
        motivo: "el total del pedido no está calculado",
        correccion: "[SISTEMA] El pedido todavía no está resuelto del todo — no confirmes ni inventes un total.",
      };
    }
    /*
     * El pedido mínimo para domicilio, si este negocio lo declaró.
     *
     * Va DESPUÉS del total —un pedido sin total no se rechaza por "no llega
     * al mínimo", que sería un diagnóstico falso— y ANTES de los requisitos,
     * porque cambia lo que el cliente tiene que pedir: saber que le faltan
     * $8.000 de producto es más útil que saber que falta su teléfono, y
     * pedirle el teléfono para un pedido que no va a salir es hacerle perder
     * el tiempo dos veces.
     */
    const falta = faltaParaElMinimoDeDomicilio({
      minimoCents: input.minimoDomicilioCents,
      modalidadDeEntrega: estado.modalidadDeEntrega,
      subtotalCents: estado.totalCents,
    });
    if (falta) {
      return {
        ok: false,
        motivo:
          `el pedido no llega al mínimo de domicilio ` +
          `(${enPesos(falta.subtotalCents)} de ${enPesos(falta.minimoCents)})`,
        correccion:
          `[SISTEMA] Este pedido todavía no llega al mínimo para domicilio: ` +
          `lleva ${enPesos(falta.subtotalCents)} y el mínimo es ${enPesos(falta.minimoCents)}, ` +
          `así que faltan ${enPesos(falta.faltanCents)}. Díselo al cliente y ofrécele ` +
          `añadir algo más o pasar a recoger — no confirmes el domicilio.`,
      };
    }

    // El estado en el backend exige procedencia para el nombre (Bloqueador 2):
    // un `datos.nombre` heredado sin `procedenciaDelNombre === "cliente"` no
    // basta para cerrar. Aquí SIEMPRE es backend (`estado = input.estadoGuardado`).
    const faltantes = (input.requisitos ?? []).filter(
      (r) => r.obligatorio && !requisitoSatisfecho(estado, r, true)
    );
    if (faltantes.length > 0) {
      return {
        ok: false,
        motivo: `faltan requisitos obligatorios: ${faltantes.map((r) => r.id).join(", ")}`,
        correccion: `[SISTEMA] Todavía falta antes de confirmar: ${faltantes.map((r) => r.etiqueta).join(", ")}. Pregúntaselo al cliente.`,
      };
    }
  }

  return { ok: true };
}

/** Lo que este módulo necesita del pipeline para producir efectos. */
export type EfectosDelCierre<C> = {
  asegurarOwnershipVigente: (conversation: C) => Promise<void>;
  deliverReply: (conversation: C, texto: string) => Promise<void>;
  appendLeadNote: (organizationId: string, contactId: string, nota: string) => Promise<void>;
  applyHandoff: (
    conversationId: string,
    organizationId: string,
    reason: "cliente" | "modelo" | "error" | "ventana"
  ) => Promise<void>;
};

/**
 * Cierra el pedido: lo registra, avisa al equipo, se despide del cliente,
 * cierra el embudo y pasa la conversación a una persona.
 *
 * Transcrito literalmente del `case "notify_order"` de `pipeline.ts`. Cada
 * comentario de abajo describe un incidente real ya corregido; se conservan
 * intactos porque son la razón por la que el orden de las operaciones es el que
 * es, y quien lo cambie sin leerlos volverá a romper lo mismo.
 */
export async function ejecutarConfirmacionDePedido<
  C extends { id: string; contactId: string; isTest: boolean },
>(
  input: {
    conversation: C;
    organizationId: string;
    conversationId: string;
    summary: string;
    farewell?: string | null;
    /** IDs de los mensajes del cliente que disparan este cierre. */
    messageIds: string[];
    /** ¿Este pedido llevaba un domicilio verificado que hay que invalidar? */
    domicilioEstructurado: boolean;
  },
  efectos: EfectosDelCierre<C>
): Promise<void> {
  const { conversation, organizationId, conversationId } = input;

  /**
   * Fase 11-A — se verifica ownership ANTES de reclamar la clave de
   * idempotencia: si este worker ya perdió la generación, ni siquiera vale la
   * pena tomar la clave (el nuevo dueño, en su propia ejecución, la tomará él).
   */
  await efectos.asegurarOwnershipVigente(conversation);

  /**
   * Fase 11-B — el teléfono se resuelve ANTES de registrar la confirmación:
   * `orderConfirmation.customerPhone` guarda el dato que un reintento posterior
   * de la notificación va a necesitar (ver `intentarNotificarPedido`), y
   * todavía no hay ninguna clave tomada de la que preocuparse si esto falla.
   */
  let phone: string | null;
  try {
    phone = await contactPhoneOf(organizationId, conversation.contactId);
  } catch (err) {
    console.error(
      `[agente] no se pudo resolver el teléfono del contacto en ${conversationId} antes de confirmar el pedido:`,
      err
    );
    throw err;
  }

  /**
   * Fase 10N-A — idempotencia real (Postgres, no memoria) antes de cualquier
   * efecto: el `INSERT` con `UNIQUE(conversation_id, idempotency_key)` es quien
   * decide, no una variable en este proceso.
   *
   * Fase urgente (4-sep-2026) — BUG REAL corregido: la despedida al CLIENTE
   * (`farewell`) se mandaba FUERA de este `if/else`, incondicionalmente — así
   * que una ejecución duplicada correctamente no repetía el aviso al EQUIPO,
   * pero SÍ le reenviaba al CLIENTE el mismo mensaje de confirmación, una vez
   * por cada re-ejecución del turno. Ahora vive DENTRO del `else`.
   */
  const { primeraVez, id: confirmationId } = await registrarConfirmacionDePedido({
    organizationId,
    conversationId,
    messageIds: input.messageIds,
    summary: input.summary,
    customerPhone: phone,
  });

  if (!primeraVez) {
    console.warn(
      `[agente] notify_order duplicado (mismo pedido, misma conversación) en ${conversationId}; no se repite el aviso`
    );
  } else {
    /**
     * Fase 10V-X — este pedido se cierra: la verificación de domicilio que lo
     * respaldaba deja de ser válida para lo que venga después en esta MISMA
     * conversación. Nunca se asume que una conversación es un solo pedido. Solo
     * invalida, nunca lanza: un fallo aquí no puede tumbar el cierre real.
     */
    if (input.domicilioEstructurado) {
      await guardarEntregaVerificada({
        conversationId,
        organizationId,
        entrega: null,
        actor: "pipeline",
        proceso: "pedido_confirmado",
      }).catch((err) => {
        console.error("[domicilio] no se pudo invalidar la verificación tras cerrar el pedido:", err);
      });
    }

    // Orden deliberado: primero el registro (fuente de verdad), después el
    // aviso por WhatsApp (puede fallar por la ventana de 24 h) y al final la
    // despedida — así un pedido nunca se pierde por un fallo de envío.
    try {
      // Fase 11-A — segunda comprobación, justo antes del efecto externo real.
      await efectos.asegurarOwnershipVigente(conversation);
    } catch (err) {
      /**
       * Fase 10V, Hallazgo D — la notificación TODAVÍA no se ha intentado:
       * deshacer la clave aquí es seguro (nada que duplicar) y deja que el
       * reintento del job lo intente de cero.
       */
      await borrarConfirmacionDePedido({
        conversationId,
        messageIds: input.messageIds,
      }).catch((errDeshacer) => {
        console.error(
          "[agente] no se pudo deshacer la idempotencia tras un error inesperado:",
          errDeshacer
        );
      });
      throw err;
    }

    /**
     * Fase 11-B — separación real entre "pedido registrado" (ya ocurrió) y
     * "aviso entregado" (esto). Para conversaciones de prueba (Laboratorio) se
     * conserva el camino directo: `notifyTeam` con `isTest: true` simula el
     * aviso sin mandar nada real, y el Laboratorio nunca debe generar una fila
     * que `reintentarNotificacionesPendientes` intente reenviar de verdad.
     */
    const result = conversation.isTest
      ? await notifyTeam({
          organizationId,
          summary: input.summary,
          customerPhone: phone,
          isTest: true,
        })
      : await intentarNotificarPedido({
          id: confirmationId,
          organizationId,
          summary: input.summary,
          customerPhone: phone,
        });

    try {
      await efectos.appendLeadNote(
        organizationId,
        conversation.contactId,
        `Pedido confirmado: ${input.summary}\n[aviso al equipo: ${result.detail}]`
      );
    } catch (err) {
      /**
       * Fase 10V, Hallazgo D — a diferencia de arriba, aquí el intento de
       * notificación YA se ejecutó: deshacer la clave arriesgaría duplicar el
       * aviso real al equipo en un reintento.
       */
      console.error(
        `[agente] no se pudo anotar la nota del pedido en ${conversationId} (el aviso al equipo SÍ se intentó, no se reintenta para no duplicarlo):`,
        err
      );
    }

    /**
     * Fase urgente (4-sep-2026) — la despedida al CLIENTE es un efecto externo
     * real (un mensaje de WhatsApp), igual que el aviso al equipo: solo debe
     * salir la PRIMERA vez que se confirma este pedido exacto.
     */
    if (input.farewell) {
      await efectos.deliverReply(conversation, input.farewell);
    }
  }

  // El embudo se cierra solo: un pedido confirmado es la única señal inequívoca
  // de venta que tiene el sistema. Aislado, y FUERA del `if/else` a propósito:
  // es idempotente por sí solo (`onLeadWon` comprueba el stage antes de
  // moverlo) y debe completarse aunque una ejecución anterior ya hubiera
  // avisado.
  try {
    if (await onLeadWon(organizationId, conversation.contactId)) {
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
    }
  } catch (err) {
    console.error("[embudo] no se pudo cerrar el lead:", err);
  }

  // Pedido cerrado = lo toma una persona (coordinar entrega y pago). También
  // idempotente y por eso fuera del `if/else` igual que arriba.
  await efectos.applyHandoff(conversationId, organizationId, "modelo");
}
