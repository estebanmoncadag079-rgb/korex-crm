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
 * Ver `specs/003-backend-como-autoridad/data-model.md` sección 1 (el tipo) y
 * sección 3 (las compuertas). Este es el paso T003: solo el tipo y la firma,
 * sin implementar las compuertas (T008-T010).
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
import type { EstadoDelPedido } from "@/server/orders/estado";
import type { ServiceRow, BusinessHours } from "./logic";
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
  requisitos: Requisito[];
  hours: BusinessHours;
  now?: Date;
};

/** Mismo contrato que `orders/operaciones.ts` — un veredicto y nada más. */
export type ResultadoDeOperacion =
  | { ok: true; estado: EstadoDelPedido }
  | { ok: false; motivo: string; correccion: string };

/**
 * Aplica UNA operación sobre el estado actual (`data-model.md` sección 3).
 *
 * **Asíncrona, a diferencia de la de pedidos** — no es una inconsistencia:
 * `disponibilidadRealMultiple` (T009) consulta la base para re-verificar que
 * un horario sigue libre en este instante, porque la disponibilidad de una
 * cita es un recurso disputado entre conversaciones concurrentes y no se
 * puede pre-cargar como un catálogo estático sin arriesgar doble reserva.
 * `buscarServicio`/`resolverEspecialistaMultiple` (por nombre) no cambian
 * este razonamiento — el `await` es por `disponibilidadRealMultiple`.
 *
 * ⚠️ Sin implementar todavía — las compuertas son T008 (existe/aplica al
 * vertical), T009 (resuelve contra datos reales) y T010 (el estado la
 * permite). Este es el paso T003: solo la firma.
 */
export async function aplicarOperacion(
  _estadoActual: EstadoDelPedido,
  _operacion: Operacion,
  _contexto: ContextoOperaciones
): Promise<ResultadoDeOperacion> {
  throw new Error(
    "aplicarOperacion: pendiente de implementar (T008-T010 de specs/003-backend-como-autoridad/tasks.md)"
  );
}
