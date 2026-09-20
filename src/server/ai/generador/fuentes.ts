import { verticalDe, type Vertical } from "@/server/vertical";

/**
 * De las columnas de `agent_profile` a lo que el generador puede escribir.
 *
 * ## Qué problema resuelve, con el caso que lo obligó
 *
 * El 19-sep-2026 `pnpm migrar:pago` quitó el bloque de pago del prompt de La
 * Churra (14.023 → 13.837 caracteres) y encendió `payment_source='ficha'`,
 * para que el pipeline lo inyectara fresco en cada turno en vez de llevarlo
 * congelado en el texto. A la siguiente regeneración, `regenerar:flota`
 * devolvía los 186 caracteres exactos que la migración había quitado: el
 * generador reconstruye desde la ficha y **nunca miró esa columna**.
 *
 * El `if` que faltaba no era la causa, era el síntoma. La causa: **cada
 * llamante traducía las columnas a mano, y cada uno un subconjunto
 * distinto** — `aplicarFicha` leía tres, `regenerar:flota` dos,
 * `convertir:ficha` una, la vista previa de /admin ninguna salvo el
 * vertical. Una fuente nueva nacía ignorada en todos los sitios que nadie
 * se acordó de tocar, y el fallo solo se veía meses después, en producción.
 *
 * Por eso la traducción vive aquí y en ningún otro sitio: añadir una fuente
 * mañana es tocar este archivo, y todos los llamantes la respetan de
 * inmediato.
 *
 * ## El contrato
 *
 * > Un dato con fuente estructurada de autoridad **no se vuelve a escribir
 * > dentro de `instructions`**. La conducta que el modelo necesita para
 * > actuar, sí.
 *
 * El prompt no es una segunda base de datos: es contexto derivado. Lo que
 * decide qué puede aparecer en él es la fuente de autoridad, nunca un script
 * de limpieza que se ejecuta por fuera y que la siguiente regeneración
 * deshace.
 */

/**
 * La fila de `agent_profile`, tal como llega de la base. Todos los campos son
 * opcionales a propósito: un llamante que no leyó una columna **no debe poder
 * afirmar nada sobre ella**, y omitirla es exactamente eso.
 */
export type FilaDeFuentes = {
  catalogSource?: string | null;
  paymentSource?: string | null;
  deliverySource?: string | null;
  menuMode?: string | null;
  appointmentsEnabled?: boolean | null;
};

/** Lo que `generarPerfil` entiende. Ver su firma para el significado de cada uno. */
export type OpcionesDeGeneracion = {
  catalogoEnTabla: boolean;
  pagosEnFicha: boolean;
  domicilioEnTabla: boolean;
  menuGuiado: boolean;
  /**
   * Ausente cuando el llamante no leyó `appointments_enabled`: entonces manda
   * `ficha.vertical`, que es el comportamiento de las herramientas fuera de
   * línea desde siempre. Inventarlo aquí sería afirmar un permiso que nadie
   * consultó.
   */
  vertical?: Vertical;
};

/**
 * Traduce la fila a opciones. **Falla hacia lo seguro**: cualquier valor que
 * no sea exactamente el esperado deja el bloque escribiéndose, que es el
 * comportamiento de siempre. Un `payment_source` corrupto no puede dejar a un
 * agente sin saber cobrar.
 */
export function opcionesDeGeneracion(fila: FilaDeFuentes): OpcionesDeGeneracion {
  return {
    catalogoEnTabla: fila.catalogSource === "tabla",
    pagosEnFicha: fila.paymentSource === "ficha",
    domicilioEnTabla: fila.deliverySource === "tabla",
    menuGuiado: fila.menuMode === "guiado",
    ...(fila.appointmentsEnabled === undefined || fila.appointmentsEnabled === null
      ? {}
      : { vertical: verticalDe(fila.appointmentsEnabled) }),
  };
}
