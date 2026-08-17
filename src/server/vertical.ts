/**
 * El vertical de un negocio: **una sola fuente de verdad**.
 *
 * Hasta el 17-ago-2026 había dos, y podían contradecirse:
 *
 * - `agent_profile.appointments_enabled` — lo que el negocio **contrató**.
 *   Gobierna los permisos: ocho rutas de API devuelven 403 si está en `false`.
 * - `ficha.vertical` — lo que el cliente **declaró** en el cuestionario.
 *   Gobierna el prompt: el generador elige con él el cierre, el catálogo y las
 *   reglas de horario.
 *
 * Existía un aviso para cuando discrepaban, y ese aviso **era la señal del
 * problema**: un negocio con la ficha de citas y la columna en `false` tendría
 * un agente prometiendo *"te agendo"* mientras la API rechaza la reserva con un
 * 403. El cliente se queda esperando una cita que nadie creó.
 *
 * ## Por qué manda la COLUMNA
 *
 * 1. **Es un permiso.** El vertical decide a qué APIs se puede llamar, y un
 *    permiso no puede depender de un JSON que el propio cliente edita desde su
 *    cuestionario (`api/onboarding` va con `withAuth`, no con admin). Si mandara
 *    la ficha, cualquier cliente se activaría un vertical que no contrató.
 * 2. **Es lo que se contrata**, y lo escribe quien lo vende: `provisioning.ts`
 *    al dar de alta y `/admin` después.
 * 3. **Lo derivado se recompila** ([68-UN-DUENO-POR-DATO.md](../../docs/korexia/68-UN-DUENO-POR-DATO.md)).
 *    El prompt es derivado; la ficha, la fuente de su contenido; y el vertical,
 *    un dato operativo que ya tenía dueño.
 *
 * `ficha.vertical` no desaparece: **pasa a ser una copia derivada**, igual que
 * `producto.nombre` en el estado del pedido. Se normaliza al escribir la ficha,
 * así que no puede contradecir a la columna.
 *
 * ⚠️ **Hoy es un booleano, y eso tiene techo.** Un tercer vertical no cabe en
 * `appointments_enabled` y obligará a una columna `vertical` de texto — una
 * migración. Este módulo existe para que ese día se toque **un solo sitio**.
 */

/** Los verticales que el sistema sabe atender. */
export type Vertical = "pedidos" | "citas";

/** El vertical de un negocio, a partir de lo que contrató. */
export function verticalDe(appointmentsEnabled: boolean | null | undefined): Vertical {
  return appointmentsEnabled ? "citas" : "pedidos";
}

/** Lo contrario: qué valor de la columna corresponde a un vertical. */
export function contrataCitas(vertical: Vertical): boolean {
  return vertical === "citas";
}
