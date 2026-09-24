/**
 * El estado del pedido, mantenido por el BACKEND — Fase 2.
 *
 * **La regla que gobierna todo este archivo**: el LLM propone, el backend
 * valida y es la fuente de verdad. Aquí no entra nada que no haya pasado por
 * `normalizarPedido`, y el total **siempre** lo recalcula el servidor.
 *
 * Se reemplaza la fila entera en cada turno: sin deltas ni merges. Es seguro
 * porque la cola garantiza un turno por conversación a la vez
 * ([34-COLA-DE-TURNOS.md](../../../docs/korexia/34-COLA-DE-TURNOS.md)) y elimina
 * una familia completa de bugs de fusión.
 *
 * ⚠️ **Nada de esto corre para ningún cliente todavía**: se lee solo cuando
 * `agent_profile.state_source = 'backend'`, y hoy los cuatro están en
 * `'prompt'`.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import * as schema from "@/lib/db/schema";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import type { Requisito } from "@/server/ai/generador/ficha";
import {
  normalizarModalidad,
  normalizarPedido,
  type EstadoPropuesto,
  type ItemPropuesto,
  type OpcionElegida,
  type OpcionPropuesta,
} from "./normalizar";
import type { Actor } from "@/server/registro-de-cambios";
import { paraLog } from "@/server/registro-de-cambios";

/**
 * La forma del estado. Cambiarla obliga a subir `SCHEMA_VERSION`.
 *
 * **v2 (17-ago-2026)**: las tres listas con nombre de La Churra —`salsas`,
 * `recubierto`, `adiciones`— se sustituyen por una `seleccion` genérica.
 *
 * **v3 (17-ago-2026)**: `entrega{nombre,telefono,direccion}` —los datos de un
 * negocio que reparte a domicilio— se sustituye por `datos`, indexado por los
 * requisitos que declara cada ficha.
 *
 * **v4 (17-ago-2026)**: `producto` —un objeto— y la `seleccion` de la raíz se
 * sustituyen por `items[]`. Con un solo producto, *"una Churrita con arequipe y
 * un Besties con chocolate"* no cabía: la mitad del pedido no tenía dónde
 * existir, y las opciones de los dos caían en una lista donde ya no se sabía de
 * quién era cada una.
 *
 * Las tres se pudieron hacer sin migración porque `conversation_state` estaba
 * **vacía**: 0 filas y 0 organizaciones, verificado en producción ese día. Con
 * un solo pedido vivo, el mismo cambio habría significado perderlo — y con el
 * primer cliente encendido, esa ventana se cierra para siempre.
 *
 * **v5 (18-ago-2026)**: se añade `reserva`, opcional y solo para citas — el
 * paso 4 de [88-AUDITORIA-SELECCION-MULTIPLE.md](../../../docs/korexia/88-AUDITORIA-SELECCION-MULTIPLE.md),
 * pendiente desde el 17-ago. Va en la RAÍZ del estado, no dentro de cada
 * ítem: los ejemplos reales ("manos y pies", "cejas y pestañas") son siempre
 * una sola visita — un bloque de tiempo, un recurso — igual que `datos` ya es
 * del pedido entero y no se duplica por ítem.
 *
 * **`gruposDeclinados` (29-ago-2026, sin subir versión)**: dentro de cada
 * ítem, opcional, igual que `modalidadDeEntrega` — un cliente que dice "sin
 * toppings" quedaba indistinguible de uno al que nunca se le preguntó, y el
 * agente volvía a ofrecer el mismo grupo turno tras turno sin memoria de
 * que ya se había resuelto. Ausente = `[]` al leerlo.
 */
export const SCHEMA_VERSION = 5;

/** Una línea del pedido: qué, cuánto y con qué opciones. */
export type ItemDelPedido = {
  ofrecible: {
    /** Resuelto por el backend contra el catálogo. `null` = aún sin elegir. */
    id: string | null;
    /** Redundante a propósito: si el producto se borra, el estado sigue legible. */
    nombre: string | null;
  };
  cantidad: number;
  /**
   * Lo que el cliente eligió **para este ítem**, en una lista y en su orden.
   *
   * Cada elemento sabe de qué grupo es, así que ya no hay nada que adivinar: es
   * lo que hace **inexpresables** el cobro cruzado entre grupos y el "primer
   * grupo con opciones". Y es una lista, no un conjunto: `[arequipe, arequipe]`
   * son dos salsas, que es como pide la gente.
   */
  seleccion: OpcionElegida[];
  /**
   * Grupos OPCIONALES que el cliente rechazó explícitamente para este ítem
   * ("sin toppings") — no volver a ofrecerlos. Ausente en estados guardados
   * antes de que este campo existiera; se trata como `[]` al leerlos, igual
   * que `modalidadDeEntrega` (ver el porqué de que `SCHEMA_VERSION` NO suba
   * más abajo).
   */
  gruposDeclinados?: { grupoId: string; grupoNombre: string }[];
  /** Lo de este ítem, con su cantidad ya multiplicada. Lo calcula el servidor. */
  totalCents: number | null;
};

/**
 * Cuándo y con quién — SOLO para el vertical de citas. Una reserva para
 * TODA la visita, no una por ítem: si el cliente pide "manos y pies", los
 * dos `items[]` comparten esta misma reserva.
 */
export type ReservaDeCita = {
  /** DD/MM/AAAA, igual que `appointments/logic.ts`. */
  fecha: string | null;
  /** HH:MM. */
  hora: string | null;
  /** Suma de `durationMin` de los servicios YA RESUELTOS. Lo calcula el servidor. */
  duracionMin: number | null;
  /** Resuelto por el backend contra `resourceService`. El modelo nunca ve ids. */
  recursoId: string | null;
  /** Redundante a propósito, igual que `ofrecible.nombre`. */
  recursoNombre: string | null;
};

/**
 * Fase 10V-X — la verificación de domicilio, persistida ENTRE turnos.
 *
 * Nace de la brecha real: un cliente pregunta la tarifa ("¿cuánto a
 * Kachipay?" → `consultar_domicilio` confirma $12.000) y confirma el pedido
 * varios mensajes después. Hasta ahora esa verificación era EFÍMERA — solo
 * vivía en `messages` del turno en que se consultó (ver el comentario del
 * bucle en `pipeline.ts`) — así que el guardarraíl de cierre exigía
 * reverificar EN EL MISMO TURNO del cierre, o forzaba una derivación a
 * persona en el caso normal de "confirmo más tarde". Esto lo saca de la
 * memoria del turno y lo pone donde sobrevive: la misma fila de
 * `conversation_state` que ya existía para el Fase 2 (`items`/`datos`), pero
 * de forma INDEPENDIENTE de `state_source` — ver `leerEntregaVerificada`/
 * `guardarEntregaVerificada` más abajo, y el porqué de esa independencia en
 * su comentario.
 *
 * `tipo: "domicilio"` con `feeCents: null` es un estado válido y
 * deliberado: "el cliente quiere domicilio, pero la zona todavía no está
 * resuelta" — la transición explícita que pide el cambio de zona (zona
 * anterior invalidada, nueva zona pendiente) en vez de dejar la tarifa
 * vieja como válida por omisión.
 */
export type EntregaVerificada = {
  tipo: "domicilio" | "recogida";
  /** `null` cuando `tipo==="domicilio"` y la zona aún no resolvió (pendiente). */
  zonaId: string | null;
  /** Redundante a propósito, igual que `ofrecible.nombre`: si la zona se borra, el registro sigue legible. */
  zonaNombre: string | null;
  /** `null` = domicilio pendiente de verificar. `0` es una tarifa real (zona gratis), nunca "no aplica". */
  feeCents: number | null;
  /** El mensaje del cliente que disparó esta verificación — para trazabilidad, no para lógica. */
  verificadoEnMensajeId: string | null;
  /** ISO. Cuándo se resolvió (o se invalidó) esta entrega. */
  verificadoEn: string;
};

export type EstadoDelPedido = {
  schema_version: number;
  /** Todo lo que lleva el pedido, en el orden en que se pidió. Máximo `MAX_ITEMS`. */
  items: ItemDelPedido[];
  /**
   * Lo que el negocio pidió para poder cerrar, indexado por el `id` de su
   * requisito. **Todo este bloque es dato personal**: es lo que el cliente
   * cuenta sobre sí mismo, así que el registro de cambios lo trata como tal sin
   * necesidad de una lista de campos que alguien tenga que mantener.
   */
  datos: Record<string, string | null>;
  /**
   * Cuándo y con quién, si esta organización es de citas. `undefined`/`null`
   * para pedidos — igual que `Ofrecible.duracionMin` no existe para un
   * producto que no dura.
   */
  reserva?: ReservaDeCita | null;
  /**
   * Cómo recibirá el cliente ESTE pedido, ya resuelto contra lo que la ficha
   * ofrece (`modalidadesDeEntrega`). `null`/ausente = todavía no se sabe.
   *
   * Es la mitad que les faltaba a los requisitos condicionales: la ficha dice
   * qué modalidades OFRECE el negocio; esto, cuál ELIGIÓ el cliente. Sin este
   * dato la dirección se pedía en todos los pedidos de un negocio que
   * repartiera —también a quien pasaba a recoger—, y el modelo acababa
   * escribiendo `"Recoge en el local"` dentro del campo dirección
   * (20-ago-2026).
   *
   * **Opcional a propósito, y por eso `SCHEMA_VERSION` NO sube**: un estado
   * escrito antes de que esto existiera se sigue leyendo igual, con la
   * modalidad sin saber. Subirla habría hecho que un contenedor todavía sin
   * desplegar DESCARTE los pedidos en curso (ver `leerEstado`) — un precio
   * real a cambio de nada, porque un lector viejo simplemente ignora una clave
   * que no conoce.
   */
  modalidadDeEntrega?: string | null;
  /**
   * Fase 10V-X — la última verificación de domicilio conocida para ESTA
   * conversación, sobreviviendo entre turnos. `null`/ausente = nunca se
   * verificó nada (o `delivery_source` no es `'tabla'` para este negocio).
   * Ver `EntregaVerificada` arriba para el porqué de cada campo.
   *
   * Opcional a propósito, mismo criterio que `modalidadDeEntrega`: un
   * estado escrito antes de que este campo existiera se sigue leyendo
   * igual, sin subir `SCHEMA_VERSION`.
   */
  entrega?: EntregaVerificada | null;
  /**
   * Que el cliente haya dicho que el pedido es un regalo.
   *
   * 24-sep-2026. `CADENCIA` le pide al agente conservar lo que el cliente
   * adelanta, pero el estado no tenía dónde: un "es para un detalle" solo
   * sobrevivía en el historial del chat, y el historial se trunca. Caso real
   * (MALIA, conv cv_zgm286k69bz1hmprf87a): la clienta dijo "es para un
   * endulce de amigos secretos" y el estado guardado no tenía ni rastro.
   *
   * 🛑 **El backend no lo infiere nunca.** Solo se escribe cuando el modelo
   * propone `marcar_regalo` tras oírselo al cliente. "Lo necesito para el
   * sábado" no es un regalo, y aquí no hay heurística que lo convierta.
   *
   * 🛑 **No es un requisito de cierre**: nunca entra en `TE FALTA` ni bloquea
   * `notify_order`. Es contexto para conversar.
   *
   * Opcional, y por eso `SCHEMA_VERSION` NO sube — mismo criterio que
   * `modalidadDeEntrega` y `entrega`: un lector viejo ignora una clave que no
   * conoce, y subirla haría que un contenedor sin desplegar DESCARTE los
   * pedidos en curso.
   */
  paraRegalo?: boolean;
  /**
   * De dónde salió `datos.nombre`. Hoy solo hay un origen válido: `"cliente"`,
   * cuando el propio cliente se identificó ("soy X", "me llamo X") o dio su
   * nombre junto a su teléfono.
   *
   * 2.ª auditoría (Bloqueador 3). El nombre necesita **procedencia durable**, no
   * solo valor: si guardáramos únicamente `datos.nombre = "Juan Pérez"`, en un
   * turno posterior no habría forma de saber si eso lo confirmó el cliente o se
   * coló del perfil de WhatsApp / de una mención. Con este campo, la
   * confirmación sobrevive aunque el mensaje original salga de `HISTORY_LIMIT`.
   *
   * `contact.name` NUNCA la escribe: el perfil no es evidencia. La escribe
   * exclusivamente la Compuerta 4 de `fijar_dato`, y solo tras verificar la
   * evidencia (`nombreTieneProcedenciaDeCliente`).
   *
   * Opcional, y por eso `SCHEMA_VERSION` NO sube — mismo criterio que
   * `paraRegalo`/`modalidadDeEntrega`: un lector viejo ignora la clave.
   */
  procedenciaDelNombre?: "cliente";
  /** Lo calcula el servidor. NUNCA el número que diga el modelo. */
  totalCents: number | null;
  /** Texto libre: el modelo devuelve etiquetas que ningún enum previó. */
  paso: string;
  /** El cliente dijo que sí. Distinto de "el pedido está completo". */
  confirmado: boolean;
};

export function estadoVacio(): EstadoDelPedido {
  return {
    schema_version: SCHEMA_VERSION,
    items: [],
    datos: {},
    reserva: null,
    modalidadDeEntrega: null,
    entrega: null,
    totalCents: null,
    paso: "sin pedido",
    confirmado: false,
  };
}

/**
 * El estado con el que EMPIEZA un pedido nuevo cuando el anterior ya se cerró.
 *
 * Una conversación NO es un solo pedido — `ejecutarConfirmacionDePedido` ya lo
 * reconoce al invalidar la entrega verificada tras cerrar. Pero el pedido en sí
 * no se reiniciaba, así que un SEGUNDO pedido se apilaba sobre el primero
 * (incidente real: MALIA, Ricardo Paz, 24-sep-2026 — 9 ítems / $120.000 en el
 * estado mientras el bot mostraba 4 / $48.000; el guardarraíl financiero derivó
 * a una persona). Un cliente recurrente —el mejor cliente— rompía el flujo.
 *
 * Reinicia todo lo del PEDIDO (ítems, opciones, modalidad, entrega, total,
 * regalo, confirmado, reserva) y CONSERVA quién es el cliente: sus `datos`
 * (nombre, teléfono, dirección) y la procedencia del nombre. Así no se le
 * vuelve a interrogar por lo que ya dio.
 *
 * Es determinista y del backend: no depende de que el modelo "se acuerde" de
 * empezar de cero — pasa igual con cualquier modelo.
 */
export function estadoParaNuevoPedido(anterior: EstadoDelPedido): EstadoDelPedido {
  return {
    ...estadoVacio(),
    datos: { ...anterior.datos },
    procedenciaDelNombre: anterior.procedenciaDelNombre,
  };
}

/**
 * Lo que el modelo propone, antes de que el backend decida nada.
 *
 * `items` es **opcional aquí y obligatorio en `EstadoPropuesto`**, y la
 * diferencia importa: el contrato interno exige la lista, pero lo que llega de
 * un modelo puede no traerla. `itemsDe` es la frontera entre las dos cosas.
 */
export type PropuestaDelModelo = Omit<EstadoPropuesto, "items"> & {
  items?: ItemPropuesto[];
  paso?: string | number | null;
  confirmado?: boolean;
  /**
   * Un pedido de un solo elemento, como se pedía hasta la v3.
   *
   * **No es deuda: es tolerancia deliberada.** El modelo es un modelo, y por
   * bien que se le explique el esquema alguna vez devolverá lo que devolvía
   * antes — o lo que le parezca más natural para un pedido de una sola cosa.
   * Convertirlo cuesta tres líneas; rechazarlo cuesta el turno de un cliente.
   */
  ofrecible?: string | null;
  producto?: string | null;
  cantidad?: number | null;
  opciones?: OpcionPropuesta[];
  /**
   * Lo que el modelo entiende de fecha/hora/especialista — texto libre, nunca
   * ids. El backend es quien resuelve `recursoId` contra el catálogo real.
   */
  reserva?: {
    fecha?: string | null;
    hora?: string | null;
    especialista?: string | null;
  } | null;
  /**
   * Cómo dijo el cliente que quiere recibir el pedido — **texto libre**, tal
   * como lo entendió el modelo. Aquí no es verdad todavía: `validarPropuesta`
   * lo resuelve contra las modalidades que la ficha ofrece y, si no encaja con
   * ninguna, queda en `null`. El modelo propone; el backend decide.
   */
  modalidadDeEntrega?: string | null;
};

/**
 * Los ítems de una propuesta, venga en el formato que venga.
 *
 * Sé tolerante en lo que aceptas: si el modelo manda un producto suelto en la
 * raíz, se convierte en un ítem en vez de tirar el turno.
 */
function itemsDe(propuesta: PropuestaDelModelo): ItemPropuesto[] {
  if (propuesta.items?.length) return propuesta.items;
  const suelto = propuesta.ofrecible ?? propuesta.producto;
  if (suelto || propuesta.opciones?.length || propuesta.cantidad != null) {
    return [
      {
        ofrecible: suelto ?? null,
        cantidad: propuesta.cantidad ?? null,
        opciones: propuesta.opciones ?? [],
      },
    ];
  }
  return [];
}

export type Validacion = {
  /** `false` = NO se persiste. */
  ok: boolean;
  estado: EstadoDelPedido;
  /** Por qué se rechaza, en palabras que se puedan leer en un log. */
  rechazos: string[];
  /** Lo que el backend corrigió por su cuenta (mayúsculas, tildes, cantidad). */
  correcciones: string[];
  /** Lo que no puede decidir solo: hay que preguntárselo al cliente. */
  dudas: { campo: string; preguntar: string }[];
};

/**
 * Valida una propuesta del modelo contra el catálogo REAL de esa organización.
 *
 * Reutiliza `normalizarPedido`, que ya resuelve productos y opciones, corrige
 * nombres y recalcula el total. Aquí se añade lo que aquel no podía saber: si
 * el ESTADO en su conjunto es posible.
 */
export function validarPropuesta(
  propuesta: PropuestaDelModelo,
  catalogo: ProductoDelCatalogo[],
  unidadesPorProducto?: Record<string, number>,
  /**
   * Lo que ESTE negocio pide para cerrar, de su ficha.
   *
   * `undefined` = **no lo ha declarado**, que no es lo mismo que no necesitar
   * nada: se rechaza la confirmación en vez de darla por buena.
   */
  requisitos?: Requisito[],
  /**
   * Las modalidades de entrega que este negocio OFRECE (`modalidadesDeEntrega`
   * de su ficha). Sin ellas no hay contra qué resolver lo que proponga el
   * modelo, así que la modalidad queda sin saber — que es como se comportaba
   * todo antes de que existiera.
   */
  modalidadesOfrecidas: readonly string[] = []
): Validacion {
  const rechazos: string[] = [];

  const items = itemsDe(propuesta);
  const r = normalizarPedido(
    { items, datos: propuesta.datos ?? {} },
    catalogo,
    unidadesPorProducto,
    requisitos ?? []
  );

  /*
   * La cantidad se valida sobre lo que PROPUSO EL MODELO, no sobre lo
   * normalizado, y **ítem por ítem**.
   *
   * `normalizarPedido` corrige a 1 cualquier cantidad menor —es lo correcto
   * para no tumbar una conversación—, pero eso significa que un `0` o un `-3`
   * llegarían aquí convertidos en un `1` perfectamente válido. Y una propuesta
   * negativa no es un detalle de formato: es señal de que la extracción se
   * torció, y quiero enterarme el día que empiece a pasar.
   */
  for (const item of items) {
    const cruda = item.cantidad;
    if (cruda !== null && cruda !== undefined && (!Number.isInteger(cruda) || cruda < 1)) {
      rechazos.push(`cantidad inválida: ${cruda}`);
    }
  }

  const confirmado = propuesta.confirmado === true;
  /*
   * `reserva` solo existe si el MODELO la mandó — y solo se la pide
   * `chatJsonConEstado` a organizaciones de citas (ver pipeline.ts). Un
   * pedido nunca la trae, así que se queda en `null` sin que este validador
   * necesite saber de qué vertical es: lo decide la forma del dato, igual
   * que el resto de este archivo.
   */
  const reserva: ReservaDeCita | null = propuesta.reserva
    ? {
        fecha: propuesta.reserva.fecha ?? null,
        hora: propuesta.reserva.hora ?? null,
        // El backend los resuelve fuera de este validador puro: la duración
        // sale de sumar servicios ya resueltos y el recurso, de buscarlo
        // contra la base — ninguno de los dos cabe en una función sin BD.
        duracionMin: null,
        recursoId: null,
        recursoNombre: propuesta.reserva.especialista ?? null,
      }
    : null;
  const estado: EstadoDelPedido = {
    schema_version: SCHEMA_VERSION,
    items: r.estado.items.map((i) => ({
      ofrecible: { id: i.ofrecibleId, nombre: i.ofrecible },
      cantidad: Number.isInteger(i.cantidad) && i.cantidad >= 1 ? i.cantidad : 1,
      seleccion: i.seleccion,
      gruposDeclinados: i.gruposDeclinados,
      totalCents: i.totalCents,
    })),
    datos: propuesta.datos ?? {},
    reserva,
    /*
     * El modelo PROPONE la modalidad; aquí se resuelve contra lo que el
     * negocio ofrece de verdad. Una modalidad que no ofrece queda en `null`
     * —"no se sabe"— y nunca se convierte en verdad por haberla escrito.
     */
    modalidadDeEntrega: normalizarModalidad(propuesta.modalidadDeEntrega, modalidadesOfrecidas),
    totalCents: r.estado.totalCents,
    // `paso` llega como número cuando el prompt del negocio numera sus mensajes.
    paso: String(propuesta.paso ?? "sin pedido"),
    confirmado,
  };

  /*
   * ESTADOS IMPOSIBLES.
   *
   * Un pedido "confirmado" sin producto, sin destino o sin precio no es un
   * pedido: es una venta que nadie puede despachar ni cobrar. El modelo puede
   * proponerlo —dice que sí a todo— y el backend tiene que negarse.
   */
  if (confirmado) {
    if (estado.items.length === 0) rechazos.push("confirmado sin nada pedido");
    // TODOS los ítems, no el primero: un pedido a medias no se despacha mejor
    // por tener resuelto lo primero que dijo el cliente.
    if (estado.items.some((i) => !i.ofrecible.id)) {
      rechazos.push("confirmado sin producto resuelto");
    }
    if (estado.totalCents === null) rechazos.push("confirmado sin total calculado");
    // Solo aplica a citas: `reserva` no existe en absoluto para un pedido
    // (ver el comentario de arriba), así que este `if` nunca se dispara ahí.
    if (estado.reserva && (!estado.reserva.fecha?.trim() || !estado.reserva.hora?.trim())) {
      rechazos.push("confirmado sin fecha/hora de la cita");
    }
    /*
     * Y lo que pida el negocio, ni más ni menos. Antes eran tres `if` con
     * nombre, teléfono y dirección dentro del validador del núcleo: un salón
     * que no entrega nada no podía confirmar una cita jamás.
     *
     * Un negocio que NO los ha declarado no cierra. Es deliberado: dar por
     * bueno un pedido sin pedir nada, en silencio, es peor que negarse — y la
     * ficha sin `cierre` es una configuración a medias, no una decisión.
     * `cierre: { requisitos: [] }` sí es una decisión, y esa sí pasa.
     */
    if (!requisitos) {
      rechazos.push("confirmado sin requisitos declarados en la ficha del negocio");
    }
    for (const r of requisitos ?? []) {
      if (r.obligatorio && !estado.datos[r.id]?.trim()) {
        rechazos.push(`confirmado sin ${r.etiqueta}`);
      }
    }
  }

  /*
   * Una opción que no resolvió es incompatible con ese producto — se llame como
   * se llame su grupo. Antes esto miraba `d.campo === "salsas"`, que era el
   * nombre de un grupo de UN negocio dentro del validador del núcleo.
   */
  for (const d of r.dudas) {
    if (d.porque.includes("no está entre las opciones")) rechazos.push(d.porque);
  }

  return {
    ok: rechazos.length === 0,
    estado,
    rechazos,
    correcciones: r.correcciones.map((c) => `${c.campo}: «${c.de}» → «${c.a}» (${c.regla})`),
    dudas: r.dudas.map((d) => ({ campo: d.campo, preguntar: d.preguntar })),
  };
}

/**
 * El estado guardado, o `null` si esta conversación aún no tiene.
 *
 * Fase 10X — `organizationId` es OPCIONAL a propósito, por compatibilidad:
 * `scripts/probar-estado.ts` llama esto sin él y los scripts quedan fuera
 * del gate de typecheck (ver CLAUDE.md), así que no se toca sin poder
 * ejecutarlo contra la base real. Hoy no es explotable sin `organizationId`
 * —el único llamador real (`pipeline.ts`) deriva `conversationId` de una
 * fila ya verificada por organización, nunca del cliente—, pero cuando se
 * pasa, la lectura queda `scoped()` de verdad: la protección barata para
 * que dejar de ser cierto algún día no sea una fuga silenciosa.
 */
/**
 * Fase 10R — bug real: una fila cuya forma no es la esperada (falta `items`
 * o `datos` — escrita por una versión de código distinta, o corrompida a
 * mano) pasaba el único chequeo que existía (`typeof === "object"`) y
 * llegaba intacta hasta `comoTexto` (`orders/extraer.ts`), que asume
 * `estado.items` sin comprobarlo: una excepción SIN CAPTURAR dentro de
 * `runAgentTurn`, que agota los 5 reintentos de `agent_job` (~40 min, ver
 * `cola.ts`) y deja al cliente en silencio total, sin handoff automático ni
 * visibilidad en ningún panel. Ahora se trata como "sin estado" — igual que
 * una versión futura desconocida — en vez de tumbar el turno; queda un log
 * para que no sea un silencio invisible.
 */
function formaReconocida(guardado: unknown): guardado is EstadoDelPedido {
  if (!guardado || typeof guardado !== "object") return false;
  const g = guardado as Partial<EstadoDelPedido>;
  return (
    Array.isArray(g.items) &&
    typeof g.datos === "object" &&
    g.datos !== null &&
    !Array.isArray(g.datos)
  );
}

async function leerFilaDeEstado(
  conversationId: string,
  organizationId?: string
): Promise<{ estado: EstadoDelPedido; version: number } | null> {
  const db = getDb();
  const condicion = organizationId
    ? scoped(
        schema.conversationState.organizationId,
        organizationId,
        eq(schema.conversationState.conversationId, conversationId)
      )
    : eq(schema.conversationState.conversationId, conversationId);
  const [fila] = await db.select().from(schema.conversationState).where(condicion);
  if (!fila) return null;

  const guardado = fila.estado;
  if (!formaReconocida(guardado)) {
    console.error(
      `[estado] conversation_state con forma inesperada (conversación ${conversationId}): se trata como "sin estado" en vez de tumbar el turno.`
    );
    return null;
  }
  /*
   * Una versión que no reconocemos NO se usa a medias.
   *
   * Con `schema_version` mayor que la nuestra, el estado lo escribió una
   * versión más nueva del código: leerlo sería inventarse los campos que
   * faltan. Se empieza limpio, que es recuperable, en vez de arrastrar basura.
   */
  if (guardado.schema_version > SCHEMA_VERSION) {
    return null;
  }
  return { estado: guardado, version: fila.version };
}

export async function leerEstado(
  conversationId: string,
  organizationId?: string
): Promise<EstadoDelPedido | null> {
  const fila = await leerFilaDeEstado(conversationId, organizationId);
  return fila?.estado ?? null;
}

/**
 * Programa de mejora integral, Prioridad 3 — igual que `leerEstado`, pero
 * además devuelve el token de concurrencia (`version`) de la fila leída, para
 * que quien va a escribir MÁS TARDE en el turno (tras llamadas al modelo,
 * guardarraíles, reintentos) pueda pedir que su escritura solo se aplique si
 * nadie más escribió mientras tanto (`guardarEstado({..., versionEsperada})`).
 */
export async function leerEstadoConVersion(
  conversationId: string,
  organizationId?: string
): Promise<{ estado: EstadoDelPedido; version: number } | null> {
  return leerFilaDeEstado(conversationId, organizationId);
}

/**
 * Guarda el estado REEMPLAZANDO la fila entera, y deja rastro campo por campo.
 *
 * La instrumentación va aquí desde el primer commit (regla 6): un escritor
 * nuevo sin trazabilidad es exactamente lo que este proyecto acaba de cerrar.
 */
/**
 * Programa de mejora integral, Prioridad 3 — `versionEsperada` es el token
 * de concurrencia optimista (mismo principio que `generation` en
 * `agent_job`, Fase 10Q). Cuando se pasa, la escritura solo se aplica si la
 * fila SIGUE en esa versión — si otra ejecución de `runAgentTurn` para la
 * MISMA conversación ya escribió después de que quien llama esto leyó su
 * estado, esta escritura no afecta ninguna fila en vez de pisar datos más
 * nuevos con una decisión tomada sobre datos viejos. Opcional a propósito:
 * los llamadores que no conocen (o no necesitan) una versión previa —
 * `borrarEstado`, scripts, la corrección de higiene que solo re-lee justo
 * antes de escribir— siguen con el comportamiento incondicional de siempre.
 *
 * `guardarEstado` sigue sin lanzar NUNCA: una carrera perdida se registra y
 * se ignora, igual que cualquier otro fallo aquí.
 */
export async function guardarEstado(
  entrada: {
    conversationId: string;
    organizationId: string;
    estado: EstadoDelPedido;
    actor: Actor;
    proceso: string;
    versionEsperada?: number;
  }
): Promise<{ ok: boolean }> {
  const db = getDb();
  const anterior = await leerEstado(entrada.conversationId, entrada.organizationId);

  const filas = await db
    .insert(schema.conversationState)
    .values({
      conversationId: entrada.conversationId,
      organizationId: entrada.organizationId,
      estado: entrada.estado,
      schemaVersion: entrada.estado.schema_version,
      paso: entrada.estado.paso,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.conversationState.conversationId,
      set: {
        estado: entrada.estado,
        schemaVersion: entrada.estado.schema_version,
        paso: entrada.estado.paso,
        updatedAt: new Date(),
        version: sql`${schema.conversationState.version} + 1`,
      },
      ...(entrada.versionEsperada !== undefined
        ? { where: eq(schema.conversationState.version, entrada.versionEsperada) }
        : {}),
    })
    .returning({ conversationId: schema.conversationState.conversationId });

  if (entrada.versionEsperada !== undefined && filas.length === 0) {
    console.warn(
      `[estado] ${entrada.organizationId}: carrera de escritura perdida en conversación ` +
        `${entrada.conversationId} (versión esperada ${entrada.versionEsperada} ya no coincide) — ` +
        `esta escritura de "${entrada.proceso}" se descarta, no se pisa el estado más nuevo.`
    );
    return { ok: false };
  }

  registrarCambioDeEstado({
    conversationId: entrada.conversationId,
    antes: anterior,
    despues: entrada.estado,
    actor: entrada.actor,
    proceso: entrada.proceso,
  });
  return { ok: true };
}

/**
 * Fase 10V-X — lee la última verificación de domicilio conocida para esta
 * conversación, SIN importar `state_source`.
 *
 * **Por qué independiente de `leerEstado`/`estadoEstructurado`**: el Fase 2
 * completo (`items`/`datos` estructurados) sigue apagado para los 4
 * clientes reales (`state_source='prompt']`) — pero uno de ellos ya tiene
 * `delivery_source='tabla'` (el incidente de Kachipay que originó todo
 * esto). Atar la persistencia de la tarifa de domicilio al MISMO
 * interruptor que el resto del Fase 2 habría dejado la brecha real sin
 * cerrar: se necesitaría encender `state_source='backend'` completo —un
 * cambio de comportamiento mucho más grande, sin encender hoy— solo para
 * arreglar el domicilio. Se reutiliza la MISMA fila, columna y mecanismo de
 * concurrencia (`conversation_state`, `version`), pero el llamador
 * (`pipeline.ts`) decide leer/escribir esto según `delivery_source==='tabla'`
 * exclusivamente — nunca según `state_source`.
 */
export async function leerEntregaVerificada(
  conversationId: string,
  organizationId: string
): Promise<EntregaVerificada | null> {
  const fila = await leerFilaDeEstado(conversationId, organizationId);
  return fila?.estado.entrega ?? null;
}

/**
 * Guarda la verificación de domicilio, preservando lo demás que ya hubiera
 * en el estado (para no pisar `items`/`datos` de un negocio que además
 * tenga `state_source='backend'` — combinación que hoy no tiene ningún
 * cliente real, pero que no debe romperse si algún día la tiene).
 *
 * Lee su PROPIA versión justo antes de escribir (nunca una capturada al
 * principio del turno): esto puede llamarse en mitad del turno, desde el
 * bucle de `consultar_domicilio`, mucho antes de que el resto del pipeline
 * decida si guarda algo más — usar una versión vieja aquí perdería
 * carreras contra escrituras que ni siquiera han pasado todavía.
 *
 * Nunca lanza: mismo criterio que `guardarEstado`, del que depende.
 */
/**
 * El estado propuesto, **sin perder la verificación de domicilio**.
 *
 * `validarPropuesta` reconstruye el estado desde lo que propone el modelo
 * —items, datos, reserva, modalidad, total, paso, confirmado— y `entrega` no
 * está en esa lista. Como el campo es opcional en el tipo, TypeScript nunca se
 * quejó: cada turno se guardaba con `entrega: undefined` y borraba la
 * verificación del turno anterior.
 *
 * Medido en producción el 9-sep-2026: de 101 conversaciones de MALIA con
 * estado guardado, **solo 4 conservaban la entrega**. Las otras 97 llegaban al
 * cierre sin zona verificada, el guardarraíl financiero no tenía contra qué
 * comprobar la tarifa, y derivaba. Cuatro clientes perdidos en un solo día
 * —Carol, Michael, Laura y Karol— y cada uno parecía un bug distinto: eran
 * este.
 *
 * Existe como función con nombre, y no como un `...` suelto en el pipeline,
 * para que se pueda probar y para que quien la lea sepa por qué está.
 */
export function conEntregaConservada(
  estado: EstadoDelPedido,
  entregaConocida: EntregaVerificada | null | undefined
): EstadoDelPedido {
  return { ...estado, entrega: entregaConocida ?? estado.entrega ?? null };
}

export async function guardarEntregaVerificada(entrada: {
  conversationId: string;
  organizationId: string;
  /** `null` invalida/borra la verificación conocida (reinicio, pedido ya confirmado). */
  entrega: EntregaVerificada | null;
  actor: Actor;
  proceso: string;
}): Promise<{ ok: boolean }> {
  const fila = await leerFilaDeEstado(entrada.conversationId, entrada.organizationId);
  const base = fila?.estado ?? estadoVacio();
  return guardarEstado({
    conversationId: entrada.conversationId,
    organizationId: entrada.organizationId,
    estado: { ...base, entrega: entrada.entrega },
    actor: entrada.actor,
    proceso: entrada.proceso,
    versionEsperada: fila?.version,
  });
}

/**
 * Vacía el estado. Es lo que hace el `"0"` de La Churra.
 *
 * Fase 10X — `organizationId` opcional en `opciones`, mismo motivo que
 * `leerEstado`: cuando se pasa, el borrado queda `scoped()`.
 */
export async function borrarEstado(
  conversationId: string,
  opciones: { actor: Actor; proceso: string; organizationId?: string }
): Promise<void> {
  const db = getDb();
  const anterior = await leerEstado(conversationId, opciones.organizationId);
  const condicion = opciones.organizationId
    ? scoped(
        schema.conversationState.organizationId,
        opciones.organizationId,
        eq(schema.conversationState.conversationId, conversationId)
      )
    : eq(schema.conversationState.conversationId, conversationId);
  await db.delete(schema.conversationState).where(condicion);
  if (anterior) {
    registrarCambioDeEstado({
      conversationId,
      antes: anterior,
      despues: null,
      actor: opciones.actor,
      proceso: opciones.proceso,
    });
  }
}

/** Aplana el estado a `items.0.cantidad`, `datos.telefono`… */
/**
 * El estado, en claves planas, para que el registro de cambios diga CUÁL
 * cambió en vez de "el pedido es distinto".
 *
 * Exportada para poder probarla sola, igual que otras funciones puras del
 * proyecto. ⚠️ El log no es fuente de verdad: la fuente es el estado
 * persistido, y esto solo lo hace legible.
 */
export function aplanar(e: EstadoDelPedido | null): Record<string, unknown> {
  if (!e) return {};
  return {
    // Una clave por ítem y campo, con su posición: así el registro de cambios
    // dice CUÁL cambió en vez de "el pedido es distinto".
    ...Object.fromEntries(
      e.items.flatMap((i, n) => [
        [`items.${n}.id`, i.ofrecible.id],
        [`items.${n}.nombre`, i.ofrecible.nombre],
        [`items.${n}.cantidad`, i.cantidad],
        [`items.${n}.seleccion`, i.seleccion.map((s) => `${s.grupoNombre}:${s.nombre}`).join(", ")],
        [`items.${n}.gruposDeclinados`, (i.gruposDeclinados ?? []).map((g) => g.grupoNombre).join(", ")],
        [`items.${n}.totalCents`, i.totalCents],
      ])
    ),
    // Una clave por dato recogido: `datos.telefono`, `datos.mesa`… Todas
    // personales, porque el bloque entero lo es.
    ...Object.fromEntries(Object.entries(e.datos).map(([id, v]) => [`datos.${id}`, v])),
    "reserva.fecha": e.reserva?.fecha ?? null,
    "reserva.hora": e.reserva?.hora ?? null,
    "reserva.duracionMin": e.reserva?.duracionMin ?? null,
    "reserva.recursoId": e.reserva?.recursoId ?? null,
    "reserva.recursoNombre": e.reserva?.recursoNombre ?? null,
    /*
     * Lo que ELIGIÓ el cliente, separado de lo que VERIFICÓ el sistema.
     *
     * Faltaba, y el 23-sep-2026 eso impidió diagnosticar desde el registro
     * por qué el agente de Lis repreguntaba la modalidad: hubo que abrir el
     * JSON del estado a mano. Un cambio `null → domicilio` era invisible.
     */
    modalidadDeEntrega: e.modalidadDeEntrega ?? null,
    paraRegalo: e.paraRegalo ?? null,
    procedenciaDelNombre: e.procedenciaDelNombre ?? null,
    "entrega.tipo": e.entrega?.tipo ?? null,
    "entrega.zonaNombre": e.entrega?.zonaNombre ?? null,
    "entrega.feeCents": e.entrega?.feeCents ?? null,
    totalCents: e.totalCents,
    paso: e.paso,
    confirmado: e.confirmado,
  };
}

/**
 * Un log por CAMPO del estado, no uno por escritura.
 *
 * "El estado cambió" no dice nada al investigar. "`producto.cantidad` pasó de 1
 * a 6" dice exactamente dónde mirar — y es la diferencia entre encontrar un
 * cobro de más en un minuto o en una auditoría forense.
 */
function registrarCambioDeEstado(entrada: {
  conversationId: string;
  antes: EstadoDelPedido | null;
  despues: EstadoDelPedido | null;
  actor: Actor;
  proceso: string;
}): void {
  try {
    const a = aplanar(entrada.antes);
    const b = aplanar(entrada.despues);
    const campos = new Set([...Object.keys(a), ...Object.keys(b)]);
    const timestamp = new Date().toISOString();

    for (const campo of campos) {
      if (a[campo] === b[campo]) continue;
      console.log(
        `[cambio] tabla=conversation_state registro=${entrada.conversationId} ` +
          `campo=${campo} valor_anterior=${paraLog("conversation_state", campo, a[campo])} ` +
          `valor_nuevo=${paraLog("conversation_state", campo, b[campo])} proceso=${entrada.proceso} ` +
          `actor=${entrada.actor} timestamp=${timestamp}`
      );
    }
  } catch (err) {
    console.warn(`[cambio] no se pudo registrar el estado: ${(err as Error).message}`);
  }
}

/** Cómo acabó el turno para el estado. */
export type ResultadoDelTurno = "guardado" | "rechazado" | "sin_propuesta" | "error";

export type MetricaDeEstado = {
  organizationId: string;
  conversationId: string;
  resultado: ResultadoDelTurno;
  /** Ausente cuando el modelo no propuso estado, o cuando la validación ni corrió. */
  validacion?: Validacion;
  /** Milisegundos de la llamada al modelo que trae la propuesta. */
  msModelo?: number;
  /** Milisegundos que tarda el BACKEND en validar y persistir. */
  msBackend: number;
  /** El error, cuando `resultado = "error"`. */
  detalle?: string;
};

/**
 * Las seis métricas de la regla 10, en UNA línea por turno.
 *
 * **Por qué una línea y no seis contadores**: un contador dice *cuántos*, y la
 * pregunta del piloto es *cuál* — qué conversación, qué se corrigió y por qué se
 * rechazó. Con la línea completa las seis se derivan grepeando, y no hace falta
 * decidir hoy qué agregación se querrá mañana. Es la misma decisión que ya se
 * tomó para el registro de cambios: log estructurado antes que tabla.
 *
 * Cómo se saca cada una de las seis:
 *
 * | Regla 10 | De dónde sale |
 * |---|---|
 * | Estados inválidos | `resultado=rechazado` · el porqué en `motivos=` |
 * | Estados corregidos | `correcciones=N` · qué campos en `campos_corregidos=` |
 * | Turnos por pedido | líneas con el mismo `conv=` hasta `confirmado=true` |
 * | Pedidos abandonados | un `conv=` que nunca llega a `confirmado=true` |
 * | Coste por conversación | ya existía: `registrarUsoIa(…, "conv:<id>")` |
 * | Tiempo de extracción | `ms_modelo=` (la llamada) y `ms_backend=` (validar y persistir) |
 *
 * **Nunca lanza y nunca vuelca valores del cliente**: van los NOMBRES de los
 * campos corregidos, no lo que el cliente escribió. Un log de métricas se acaba
 * pegando en un chat, y ahí no puede aparecer la dirección de nadie.
 */
export function registrarMetricaDeEstado(m: MetricaDeEstado): void {
  try {
    const v = m.validacion;
    // Solo el nombre del campo: `correcciones` viene como "campo: «de» → «a»".
    const campos = (v?.correcciones ?? []).map((c) => c.split(":")[0]!.trim());
    const linea =
      `[metrica] evento=estado org=${m.organizationId} conv=${m.conversationId} ` +
      `resultado=${m.resultado} ` +
      `paso=${paraLog("metrica", "paso", v?.estado.paso ?? "-")} ` +
      `confirmado=${v?.estado.confirmado ?? "-"} ` +
      `items=${v?.estado.items.length ?? "-"} ` +
      `producto=${paraLog("metrica", "producto", v?.estado.items.map((i) => i.ofrecible.nombre ?? "?").join("|") || "-")} ` +
      `total_cents=${v?.estado.totalCents ?? "-"} ` +
      `correcciones=${campos.length} ` +
      `campos_corregidos=${campos.length ? campos.join("|") : "-"} ` +
      `rechazos=${v?.rechazos.length ?? 0} ` +
      `motivos=${v?.rechazos.length ? paraLog("metrica", "motivos", v.rechazos.join(" · ")) : "-"} ` +
      `dudas=${v?.dudas.length ?? 0} ` +
      `ms_modelo=${m.msModelo ?? "-"} ms_backend=${m.msBackend} ` +
      (m.detalle ? `detalle=${paraLog("metrica", "detalle", m.detalle)} ` : "") +
      `timestamp=${new Date().toISOString()}`;

    // Rechazado y error se ven en `warn`: son lo que hay que mirar a diario
    // durante el piloto. El resto es material de análisis, no una alarma.
    if (m.resultado === "rechazado" || m.resultado === "error") console.warn(linea);
    else console.log(linea);
  } catch (err) {
    console.warn(`[metrica] no se pudo registrar: ${(err as Error).message}`);
  }
}
