/**
 * Las operaciones que el LLM puede proponer sobre la reserva en curso —
 * Feature 003-backend-como-autoridad, Principio 7 de
 * `REGLAS-DE-ARQUITECTURA.md` ("El backend es la autoridad").
 *
 * Gemelo de `orders/operaciones.ts` para el vertical de citas — mismo
 * principio, mismo contrato de resultado, **sin compartir código**: es la
 * decisión explícita de `specs/003-backend-como-autoridad/plan.md` ("un
 * módulo por vertical, no uno genérico"), porque cada uno resuelve contra su
 * propia fuente de datos real (`ServiceRow`/`disponibilidadRealMultiple` aquí,
 * `ProductoDelCatalogo`/`buscarProductos` en pedidos).
 *
 * Ver `specs/003-backend-como-autoridad/data-model.md` secciones 1 (el tipo),
 * 2 (el lote atómico) y 3 (las compuertas) — las tres ya implementadas
 * (T008-T010): `aplicarOperacion` cubre las tres compuertas por operación,
 * `aplicarOperaciones` el lote completo.
 *
 * **Ninguna operación referencia por id** — mismo criterio que
 * `orders/operaciones.ts`: `fijar_servicio`/`fijar_especialista` llevan el
 * NOMBRE, resuelto por `buscarServicio`/`resolverEspecialistaMultiple`
 * (ambos YA resuelven por nombre hoy, nada que cambiarles). `fijar_horario`
 * lleva la tupla `fecha`/`hora`/`especialista?` que el backend acaba de
 * ofrecer — nunca un id de `offered_slot`.
 *
 * ⚠️ Igual que `estado.ts`: nada de esto corre para ningún cliente todavía.
 * Se activa recién en T027, tras completar y probar T001-T026.
 */
import { z } from "zod";
import type { EstadoDelPedido, ItemDelPedido } from "@/server/orders/estado";
import { buscarServicio, normalizarFecha, esFechaValida, type ServiceRow, type BusinessHours } from "./logic";
import { resolverEspecialistaMultiple, disponibilidadRealMultiple, type StaffRow } from "./queries";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * Las operaciones del vertical de citas. Unión discriminada por `tipo`, mismo
 * estilo que `orders/operaciones.ts` y que `AgentAction` (`ai/actions.ts:12`).
 *
 * `fijar_modalidad` NO existe aquí a propósito: `modalidadDeEntrega` es un
 * concepto de pedidos (recoger/domicilio) sin equivalente en citas — mismo
 * criterio que ya aplica `auth/arquitectura.ts` a `catalogSource`/
 * `paymentSource` para este vertical.
 */
export const Operacion = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("fijar_servicio"),
    servicio: z.string().min(1),
  }),
  /**
   * La tupla que el backend acaba de ofrecer (vía `consult_availability`),
   * re-verificada contra `disponibilidadRealMultiple` en el momento de
   * aplicar la operación — nunca un id de `offered_slot` que el modelo deba
   * recordar. `especialista` es opcional: hay negocios de un solo
   * profesional donde el cliente nunca lo nombra.
   */
  z.object({
    tipo: z.literal("fijar_horario"),
    fecha: z.string().min(1),
    hora: z.string().min(1),
    especialista: z.string().optional(),
  }),
  z.object({
    tipo: z.literal("fijar_especialista"),
    especialista: z.string().min(1),
  }),
  /** Mismo caso que en pedidos: clave fresca del esquema de este turno. */
  z.object({
    tipo: z.literal("fijar_dato"),
    requisitoId: z.string().min(1),
    valor: z.string(),
  }),
  /**
   * NO hay `cancelar` en esta unión — mismo criterio que
   * `orders/operaciones.ts` (corrección de diseño del 16-sep-2026), aplicado
   * aquí también: `matchesReinicio`/`borrarEstado` (`pipeline.ts:1171-1214`)
   * es genérico por diseño — `estadoEstructurado = profile.stateSource ===
   * "backend"` no distingue vertical, y `EstadoDelPedido.reserva` ya se
   * borra con el resto de la fila. El comentario del propio código lo
   * confirma (`pipeline.ts:1090-1097`): el mecanismo ya está listo para
   * citas, aunque hoy ningún cliente real de ese vertical tenga Fase 2
   * encendida. No hace falta una `Operacion` nueva para "vaciar la reserva
   * en curso" — ya existe, determinística, y corre antes del modelo.
   *
   * Esto NO es `cancel_appointment` (`ai/actions.ts:282`): esa acción
   * cancela una cita YA CONFIRMADA en la base (`appointment`), con su
   * propia idempotencia (`registrarConfirmacionDeCita`/`cancelarCita`,
   * `pipeline.ts:3975`). Sigue existiendo tal cual, fuera de este motor de
   * operaciones — son dos cosas distintas: una borra un borrador sin
   * confirmar, la otra cancela algo que ya es real.
   */
  z.object({ tipo: z.literal("confirmar") }),
]);

export type Operacion = z.infer<typeof Operacion>;

/**
 * Lo que `aplicarOperacion` necesita para resolver una operación contra
 * datos reales. `servicios` y `requisitos` llegan YA filtrados por
 * organización (Principio III) — este módulo no consulta el catálogo
 * directamente, lo recibe de quien lo invoque.
 *
 * `hours`/`now` son los que ya exige `disponibilidadRealMultiple`
 * (`appointments/queries.ts:631`) para re-verificar `fijar_horario` — se
 * pasan tal cual, sin envolverlos en un tipo nuevo.
 */
export type ContextoOperaciones = {
  organizationId: string;
  servicios: ServiceRow[];
  /**
   * El roster de especialistas de ESTA organización (`listStaff`, ya
   * filtrado por organización). `resolverEspecialistaMultiple` solo
   * devuelve el `id` resuelto, nunca el nombre — esta lista es lo que
   * permite escribir el `recursoNombre` canónico en `reserva` sin tocar esa
   * función (constraint explícito de este archivo, ver el comentario de la
   * unión `Operacion` arriba).
   */
  staff: StaffRow[];
  requisitos: Requisito[];
  hours: BusinessHours;
  now?: Date;
};

/** Mismo contrato que `orders/operaciones.ts` — un veredicto y nada más. */
export type ResultadoDeOperacion =
  | { ok: true; estado: EstadoDelPedido }
  | { ok: false; motivo: string; correccion: string };

/**
 * `fijar_especialista` y `fijar_horario` (cuando trae `especialista`)
 * resuelven el mismo dato de la misma forma: por eso comparten esta función
 * en vez de repetir la llamada a `resolverEspecialistaMultiple` y sus tres
 * desenlaces en dos sitios.
 *
 * `serviceIds` son los servicios YA fijados en `estado.items` — sin al menos
 * uno, no hay contra qué verificar quién atiende, así que ese caso rechaza
 * antes de llegar aquí (ver los dos `case` que la llaman).
 */
async function resolverEspecialista(
  contexto: ContextoOperaciones,
  serviceIds: string[],
  nombre: string
): Promise<{ ok: true; id: string; nombre: string } | { ok: false; motivo: string; correccion: string }> {
  const resuelto = await resolverEspecialistaMultiple(contexto.organizationId, serviceIds, nombre);
  if (!resuelto.ok) {
    return resuelto.opciones.length
      ? {
          ok: false,
          motivo: `"${nombre}" no atiende esa combinación de servicios`,
          correccion: `[SISTEMA] "${nombre}" no atiende esa combinación de servicios. Quienes sí: ${resuelto.opciones.join(", ")}.`,
        }
      : {
          ok: false,
          motivo: "nadie atiende esa combinación de servicios",
          correccion: "[SISTEMA] Nadie atiende esa combinación de servicios a la vez. Ofrece agendarlos por separado.",
        };
  }
  // `nombre` llega con `min(1)` desde el schema de `Operacion`, así que
  // `resolverEspecialistaMultiple` siempre lo busca — `staffId: null` solo
  // ocurre cuando el nombre viene vacío (ver su propia implementación,
  // `appointments/queries.ts:519`). Este `if` es la señal de un invariante
  // roto, no un caso de negocio a manejar.
  if (!resuelto.staffId) {
    return {
      ok: false,
      motivo: "resolverEspecialistaMultiple devolvió staffId nulo con un nombre no vacío",
      correccion: "[SISTEMA] No pude confirmar ese especialista. Pregunta de nuevo con quién quiere la cita.",
    };
  }
  const encontrado = contexto.staff.find((s) => s.id === resuelto.staffId);
  if (!encontrado) {
    return {
      ok: false,
      motivo: `staffId ${resuelto.staffId} resuelto pero ausente de contexto.staff`,
      correccion: "[SISTEMA] No pude confirmar ese especialista. Pregunta de nuevo con quién quiere la cita.",
    };
  }
  return { ok: true, id: encontrado.id, nombre: encontrado.name };
}

/**
 * Aplica UNA operación sobre el estado actual (`data-model.md` sección 3).
 *
 * **Asíncrona, a diferencia de la de pedidos** — no es una inconsistencia:
 * `disponibilidadRealMultiple` consulta la base para re-verificar que un
 * horario sigue libre en este instante, porque la disponibilidad de una cita
 * es un recurso disputado entre conversaciones concurrentes y no se puede
 * pre-cargar como un catálogo estático sin arriesgar doble reserva.
 * `buscarServicio`/`resolverEspecialistaMultiple` (por nombre) no cambian
 * este razonamiento — el `await` es por `disponibilidadRealMultiple`.
 *
 * **Nota de implementación (T008), mismo criterio que `orders/operaciones.ts`
 * T004:** la mitad de la Compuerta 1 —"¿existe la operación?"— no necesita
 * chequeo en runtime: Zod la rechaza antes de que esta función se llame (T012/
 * T013), y "¿aplica a este vertical?" la impone el propio TIPO — este archivo
 * declara su propio `Operacion` sin `agregar_item`/`cambiar_cantidad`/
 * `quitar_item`/`elegir_opcion`/`declinar_grupo`/`fijar_modalidad` (esos viven
 * solo en `orders/operaciones.ts`), así que un negocio de citas no puede ni
 * siquiera CONSTRUIR esas operaciones. Lo que queda, y es real: el `switch` de
 * abajo cubre los 5 `tipo` uno por uno, con `default` exhaustivo comprobado
 * por TypeScript.
 *
 * Atómica para ESTA operación: pasa las tres compuertas o no cambia nada. La
 * atomicidad del LOTE completo (si una operación de varias falla, ninguna se
 * persiste) es responsabilidad de `aplicarOperaciones` (T010), que llama a
 * esta función repetidas veces — ver más abajo.
 */
export async function aplicarOperacion(
  estadoActual: EstadoDelPedido,
  operacion: Operacion,
  contexto: ContextoOperaciones
): Promise<ResultadoDeOperacion> {
  switch (operacion.tipo) {
    case "fijar_servicio": {
      const servicio = buscarServicio(contexto.servicios, operacion.servicio);
      if (!servicio) {
        const nombresCatalogo = contexto.servicios.map((s) => s.name).join(", ") || "(sin servicios configurados)";
        return {
          ok: false,
          motivo: `"${operacion.servicio}" no está en el catálogo de servicios`,
          correccion: `[SISTEMA] No encontré "${operacion.servicio}" en el catálogo. Servicios reales: ${nombresCatalogo}.`,
        };
      }
      const item: ItemDelPedido = {
        ofrecible: { id: servicio.id, nombre: servicio.name },
        cantidad: 1,
        seleccion: [],
        gruposDeclinados: [],
        totalCents: servicio.priceCents,
      };
      return { ok: true, estado: { ...estadoActual, items: [...estadoActual.items, item] } };
    }

    case "fijar_especialista": {
      const serviceIds = estadoActual.items
        .map((i) => i.ofrecible.id)
        .filter((id): id is string => id !== null);
      if (serviceIds.length === 0) {
        return {
          ok: false,
          motivo: "no hay servicio fijado todavía",
          correccion: "[SISTEMA] Todavía no se ha elegido un servicio para esta cita. Pregunta primero cuál servicio quiere.",
        };
      }
      const resuelto = await resolverEspecialista(contexto, serviceIds, operacion.especialista);
      if (!resuelto.ok) return resuelto;
      const reservaPrevia = estadoActual.reserva;
      return {
        ok: true,
        estado: {
          ...estadoActual,
          reserva: {
            fecha: reservaPrevia?.fecha ?? null,
            hora: reservaPrevia?.hora ?? null,
            duracionMin: reservaPrevia?.duracionMin ?? null,
            recursoId: resuelto.id,
            recursoNombre: resuelto.nombre,
          },
        },
      };
    }

    case "fijar_horario": {
      const serviciosElegidos = estadoActual.items
        .map((i) => contexto.servicios.find((s) => s.id === i.ofrecible.id))
        .filter((s): s is ServiceRow => s != null);
      if (serviciosElegidos.length === 0) {
        return {
          ok: false,
          motivo: "no hay servicio fijado todavía",
          correccion: "[SISTEMA] Todavía no se ha elegido un servicio para esta cita. Pregunta primero cuál servicio quiere, antes de fijar fecha y hora.",
        };
      }

      // Especialista para esta verificación: el que trae la propia operación
      // (se resuelve de nuevo, igual que `fijar_especialista`), o si no, el
      // que ya estaba fijado de un turno anterior — nunca se inventa uno
      // nuevo aquí. Sin ninguno de los dos, se verifica que AL MENOS un
      // especialista esté libre (`staffIdPreferido` ausente), y el recurso
      // concreto se resuelve más adelante, igual que hoy hace
      // `crearCitaMultiple` cuando `book_appointment` no trae especialista
      // (`pipeline.ts:3759`, `staffIdPreferido: resuelto.staffId` con
      // `staffId: null` es un caso ya válido y manejado, no nuevo aquí).
      let especialistaResuelto: { id: string; nombre: string } | null = null;
      if (operacion.especialista) {
        const serviceIds = serviciosElegidos.map((s) => s.id);
        const resuelto = await resolverEspecialista(contexto, serviceIds, operacion.especialista);
        if (!resuelto.ok) return resuelto;
        especialistaResuelto = resuelto;
      } else if (estadoActual.reserva?.recursoId && estadoActual.reserva.recursoNombre) {
        especialistaResuelto = { id: estadoActual.reserva.recursoId, nombre: estadoActual.reserva.recursoNombre };
      }

      const fecha = normalizarFecha(operacion.fecha) ?? operacion.fecha;
      // `calcularDisponibilidad` (bajo `disponibilidadRealMultiple`) solo
      // filtra por hora dentro del día — NO sabe qué días de la semana
      // atiende el negocio ni descarta una fecha ya pasada (salvo hoy). Sin
      // este chequeo, un día cerrado devolvería la grilla completa como si
      // estuviera abierto: mismo orden de validación que ya usa
      // `resolverConsultaDisponibilidad` (`pipeline.ts:544`) para la consulta,
      // aplicado aquí para la re-verificación.
      if (!esFechaValida(fecha, contexto.hours, contexto.now)) {
        return {
          ok: false,
          motivo: `"${fecha}" no es una fecha agendable`,
          correccion: `[SISTEMA] "${fecha}" no es una fecha agendable (ya pasó o el negocio no atiende ese día). Pídele otra fecha.`,
        };
      }
      const disp = await disponibilidadRealMultiple({
        organizationId: contexto.organizationId,
        services: serviciosElegidos,
        fecha,
        staffIdPreferido: especialistaResuelto?.id,
        hours: contexto.hours,
        now: contexto.now,
      });
      if (!disp[operacion.hora]) {
        const horas = Object.keys(disp).sort();
        return {
          ok: false,
          motivo: `${fecha} ${operacion.hora} ya no está disponible`,
          correccion: horas.length
            ? `[SISTEMA] Ese horario ya no está disponible. Horarios reales disponibles el ${fecha}: ${horas.join(", ")}.`
            : `[SISTEMA] No hay horarios disponibles el ${fecha} para este servicio. Ofrece otra fecha.`,
        };
      }

      const duracionMin = serviciosElegidos.reduce((acc, s) => acc + s.durationMin, 0);
      return {
        ok: true,
        estado: {
          ...estadoActual,
          reserva: {
            fecha,
            hora: operacion.hora,
            duracionMin,
            recursoId: especialistaResuelto?.id ?? null,
            recursoNombre: especialistaResuelto?.nombre ?? null,
          },
        },
      };
    }

    case "fijar_dato": {
      // Compuerta 2: el requisito existe en la ficha de este negocio — mismo
      // criterio que `orders/operaciones.ts` (`requisitoId` no es un id que
      // el modelo recuerde: es la clave que el propio esquema de este turno
      // le inyecta fresca a partir de la ficha, `data-model.md` sección 1).
      const requisito = contexto.requisitos.find((r) => r.id === operacion.requisitoId);
      if (!requisito) {
        return {
          ok: false,
          motivo: `"${operacion.requisitoId}" no es un requisito declarado por este negocio`,
          correccion: "[SISTEMA] Ese dato no está entre lo que este negocio pide para cerrar.",
        };
      }
      // Compuerta 3: sin reglas adicionales — cualquier texto no vacío vale
      // (es prosa que lee una persona, ver `estructura-vs-prosa`).
      if (!operacion.valor.trim()) {
        return {
          ok: false,
          motivo: "valor vacío",
          correccion: `[SISTEMA] Todavía falta ${requisito.etiqueta}.`,
        };
      }
      return {
        ok: true,
        estado: { ...estadoActual, datos: { ...estadoActual.datos, [operacion.requisitoId]: operacion.valor } },
      };
    }

    /**
     * Mismo criterio que `orders/operaciones.ts` (`data-model.md` sección 4):
     * `confirmar` solo marca la intención sobre el ESTADO EN MEMORIA — pone
     * `confirmado: true` —; la AUTORIDAD real sobre si eso se ejecuta de
     * verdad (hay servicio, fecha, hora y los requisitos obligatorios
     * cubiertos) sigue siendo de la Policy existente
     * (`appointment_booking_confirmation`), que corre DESPUÉS de guardado el
     * lote — no se duplica esa validación aquí.
     */
    case "confirmar":
      return { ok: true, estado: { ...estadoActual, confirmado: true } };

    default: {
      // Exhaustividad: si TypeScript se queja aquí de que `operacion` no es
      // `never`, falta manejar un `tipo` nuevo arriba — es la señal a
      // propósito, no un caso a silenciar.
      const _exhaustivo: never = operacion;
      return {
        ok: false,
        motivo: `operación desconocida: ${JSON.stringify(_exhaustivo)}`,
        correccion: "Esa operación no existe. Usa una de las permitidas.",
      };
    }
  }
}

/** El veredicto de aplicar un LOTE completo — `data-model.md` sección 2. */
export type ResultadoDelLote =
  | { persistido: true; estadoFinal: EstadoDelPedido }
  | {
      persistido: false;
      rechazo: Extract<ResultadoDeOperacion, { ok: false }>;
      /** Índice, dentro del lote, de la operación que hizo fallar todo. */
      operacionFallida: number;
    };

/**
 * Aplica una lista de operaciones **en orden**, sobre una copia en memoria a
 * partir del estado guardado — nunca escribe nada. Traducción directa del
 * pseudocódigo de `data-model.md` sección 2 (corregida 15-sep-2026: lote
 * atómico, no persistencia parcial).
 *
 * Si CUALQUIER operación falla, se descarta TODO lo calculado en memoria —ni
 * siquiera las que pasaron antes que ella cuentan— y se devuelve
 * `persistido: false` con el rechazo exacto y en qué posición del lote
 * ocurrió. Si las `operaciones.length` pasan, se devuelve `persistido: true`
 * con el estado final.
 *
 * **No llama a `guardarEstado`.** Esta función es pura, igual que
 * `aplicarOperacion`: quien la invoque (T012/T013, `pipeline.ts`) decide
 * cuándo y cómo persistir `estadoFinal` — el mismo límite que ya respeta
 * `ContextoOperaciones` (este módulo recibe datos ya resueltos, nunca
 * consulta ni escribe la base por su cuenta).
 */
export async function aplicarOperaciones(
  estadoGuardado: EstadoDelPedido,
  operaciones: Operacion[],
  contexto: ContextoOperaciones
): Promise<ResultadoDelLote> {
  let estado = estadoGuardado;
  for (let i = 0; i < operaciones.length; i++) {
    const resultado = await aplicarOperacion(estado, operaciones[i]!, contexto);
    if (!resultado.ok) {
      return { persistido: false, rechazo: resultado, operacionFallida: i };
    }
    estado = resultado.estado;
  }
  return { persistido: true, estadoFinal: estado };
}
