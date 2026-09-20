/**
 * El lector tolerante de la ficha — **paso 1 de "un dueño por dato"**
 * ([68-UN-DUENO-POR-DATO.md](../../../../docs/korexia/68-UN-DUENO-POR-DATO.md)).
 *
 * Entiende las dos formas y devuelve siempre la misma:
 *
 *   forma PLANA (hoy)          { nombre, horario, reglasPropias, … }
 *   forma POR SECCIONES        { schema_version: 2, negocio: {…}, flujo: {…}, politicas: {…} }
 *
 * **Por qué primero el lector y luego la conversión**: al revés, un código
 * desplegado que no entiende la forma nueva se encontraría una ficha que no
 * sabe leer, y el síntoma sería un prompt vacío en producción.
 *
 * Aquí NO se decide nada del negocio ni se toca el prompt: esto solo traduce.
 * Mientras ningún cliente esté convertido, el comportamiento es idéntico al de
 * antes.
 */
import type { FichaDelNegocio } from "./ficha";

/**
 * Qué campo pertenece a quién. Es el corazón del acuerdo: cada sección tiene un
 * dueño y nadie escribe fuera de la suya.
 */
export const SECCIONES = {
  /** Lo que responde el cliente en su cuestionario. */
  negocio: [
    "nombre",
    "queVende",
    "ubicacion",
    "horario",
    // Contexto libre sobre el horario: es del cliente, como el horario mismo.
    "observacionesHorario",
    "vertical",
    "catalogo",
    "duracionTipicaMin",
    "variantes",
    "entrega",
    "canales",
    "pago",
    "tono",
    "regalos",
    "preguntasFrecuentes",
  ],
  /** Lo que ajusta el operador: el orden y las palabras de la conversación. */
  flujo: ["reglasPropias", "saludoInicial", "cierre", "menu"],
  /**
   * Las reglas que se escriben **después de un incidente**: cuándo pasar a una
   * persona y qué no se puede prometer nunca (salud, por ejemplo).
   *
   * La primera versión del plan dio esta sección por vacía. La simulación
   * demostró que no lo está, y que darla por vacía habría borrado justo estas
   * reglas en la conversión.
   */
  politicas: ["escalarSiempre", "nuncaPrometer"],
} as const;

export type FichaPorSecciones = {
  schema_version: number;
  negocio: Record<string, unknown>;
  flujo: Record<string, unknown>;
  politicas: Record<string, unknown>;
};

/** ¿Viene ya por secciones? Lo dice el propio JSON, sin columna aparte. */
/**
 * Una ficha **aplanada**: la que devuelve `leerFicha`, lista para el generador.
 *
 * 🔴 **No es la ficha. Es una LECTURA de la ficha.** Le faltan las secciones
 * —`negocio`, `flujo`, `politicas`— y su `schema_version`, porque el generador
 * no los necesita. Persistirla tal cual **destruye el modelo por secciones**, y
 * eso pasó de verdad el 17-ago con dos fichas de producción.
 *
 * La marca existe para que se vea en las firmas de qué se está hablando: nadie
 * puede fabricar una `FichaAplanada` fuera de este módulo, así que cuando una
 * función la recibe, se sabe de dónde viene.
 *
 * **Para guardar hay una sola puerta: `serializarComoEstaba()`.**
 */
declare const APLANADA: unique symbol;
export type FichaAplanada = FichaDelNegocio & { readonly [APLANADA]: true };

export function esPorSecciones(obj: unknown): obj is FichaPorSecciones {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return typeof o.schema_version === "number" && o.schema_version >= 2;
}

/** De las secciones al objeto plano que `generarPerfil` ya sabe leer. */
export function aplanar(v2: FichaPorSecciones): FichaDelNegocio {
  return {
    ...(v2.negocio ?? {}),
    ...(v2.flujo ?? {}),
    ...(v2.politicas ?? {}),
  } as unknown as FichaDelNegocio;
}

/** Del objeto plano a las secciones, cada campo a su dueño. */
export function aSecciones(ficha: FichaDelNegocio): FichaPorSecciones {
  const f = ficha as unknown as Record<string, unknown>;
  const reparte = (campos: readonly string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of campos) if (f[k] !== undefined) out[k] = f[k];
    return out;
  };
  return {
    schema_version: 2,
    negocio: reparte(SECCIONES.negocio),
    flujo: reparte(SECCIONES.flujo),
    politicas: reparte(SECCIONES.politicas),
  };
}

/**
 * Campos de la ficha que no pertenecen a ninguna sección.
 *
 * Existe porque el reparto se escribe a mano: el día que alguien añada un campo
 * nuevo a la ficha y olvide asignarlo, este aviso lo caza **antes** de que la
 * conversión lo tire. Es lo que pasó con `escalarSiempre` y `nuncaPrometer`.
 */
export function camposSinDueño(ficha: FichaDelNegocio): string[] {
  const conocidos = new Set<string>([
    ...SECCIONES.negocio,
    ...SECCIONES.flujo,
    ...SECCIONES.politicas,
  ]);
  return Object.keys(ficha as unknown as Record<string, unknown>).filter(
    (k) => !conocidos.has(k)
  );
}

export type Seccion = keyof typeof SECCIONES;

/**
 * Fusiona una ficha entrante sobre la guardada **respetando la propiedad**:
 * solo se escriben las secciones que el llamante tiene permitido tocar; el
 * resto se conserva tal cual estaba.
 *
 * Es el corazón del paso 2. Antes, cualquiera de los dos escritores mandaba el
 * objeto entero y el último ganaba: así se perdieron las reglas de flujo de La
 * Churra el 15-ago a las 12:59.
 *
 * **Alta contra reenvío**: si no hay ficha guardada no hay nada que pisar, así
 * que se escribe entera. La restricción existe para proteger lo que ya está,
 * no para impedir que un negocio nazca completo.
 *
 * **El formato no cambia aquí**: si la guardada era plana, se devuelve plana.
 * Convertir a secciones es un acto aparte y explícito, nunca un efecto
 * secundario de rellenar un formulario.
 */
export function fusionarFicha(
  guardadaCruda: string | null | undefined,
  entrante: FichaDelNegocio,
  puedeEscribir: readonly Seccion[]
): { ficha: FichaDelNegocio; conservadas: Seccion[] } {
  const guardada = leerFicha(guardadaCruda);
  if (!guardada) return { ficha: entrante, conservadas: [] };

  const deGuardada = aSecciones(guardada);
  const deEntrante = aSecciones(entrante);
  const conservadas: Seccion[] = [];

  const resultado: FichaPorSecciones = {
    schema_version: 2,
    negocio: {},
    flujo: {},
    politicas: {},
  };
  for (const s of ["negocio", "flujo", "politicas"] as const) {
    if (puedeEscribir.includes(s)) {
      /*
       * La sección escribible se FUSIONA sobre la guardada, no la reemplaza.
       *
       * `aSecciones` omite los campos `undefined`, así que un campo que quien
       * escribe no mande **conserva su valor** en vez de desaparecer. La
       * diferencia es exactamente la que separa dos cosas que antes eran
       * indistinguibles:
       *
       *   no lo mandó  (`undefined`)  → no lo tocó       → se conserva
       *   lo mandó vacío (`""`, `[]`) → lo borró queriendo → se borra
       *
       * Reemplazar la sección entera obligaba a que quien escribe conociera
       * TODOS los campos de esa sección, y quien no los conocía los borraba sin
       * enterarse — así el cuestionario le vació las reglas de flujo a un
       * negocio el 15-ago-2026, y por eso se le prohibió tocarlas.
       */
      resultado[s] = { ...deGuardada[s], ...deEntrante[s] };
    } else {
      resultado[s] = deGuardada[s];
      conservadas.push(s);
    }
  }

  // Los campos sin dueño de la guardada no se tiran: se arrastran hasta que
  // alguien los asigne a una sección.
  const huerfanos: Record<string, unknown> = {};
  const g = guardada as unknown as Record<string, unknown>;
  for (const k of camposSinDueño(guardada)) huerfanos[k] = g[k];

  return {
    ficha: { ...aplanar(resultado), ...huerfanos } as FichaDelNegocio,
    conservadas,
  };
}

/**
 * Serializa la ficha **en el mismo formato en que estaba guardada**… salvo
 * cuando no estaba guardada de ninguna forma.
 *
 * Un cliente convertido sigue convertido; uno plano sigue plano. Rellenar un
 * formulario no puede cambiarle el formato de los datos a nadie.
 *
 * **Pero una ficha NUEVA no tiene formato que respetar, y nacía en el viejo**
 * (auditoría del 20-ago-2026). `aplicarFicha` es el único camino que crea
 * fichas —el alta y `/admin` pasan por él—, así que cada negocio que entraba a
 * la plataforma nacía plano, y solo se convertía si alguien corría
 * `convertir:ficha` a mano. Con tres clientes se nota poco; con mil, el
 * formato por secciones no llega prácticamente a nadie y ponerse al día deja
 * de ser un valor por defecto para convertirse en una migración masiva.
 *
 * No es una conversión silenciosa: **no hay nada que convertir**. Lo ya
 * guardado sigue intocable, y eso incluye una ficha ilegible — si el JSON no
 * se entiende tampoco se sabe qué formato tenía, así que se respeta el
 * comportamiento de siempre en vez de decidir por él.
 */
export function serializarComoEstaba(
  guardadaCruda: string | null | undefined,
  ficha: FichaDelNegocio
): string {
  // Nada guardado = ficha nueva: nace en el formato de hoy.
  if (!guardadaCruda?.trim()) return JSON.stringify(aSecciones(ficha));

  let eraPorSecciones = false;
  try {
    eraPorSecciones = esPorSecciones(JSON.parse(guardadaCruda));
  } catch {
    eraPorSecciones = false;
  }
  return JSON.stringify(eraPorSecciones ? aSecciones(ficha) : ficha);
}

/**
 * Lee la ficha guardada, venga como venga, y la devuelve **APLANADA**.
 *
 * ⚠️ Lo que sale de aquí **no se guarda directamente**: para eso está
 * `serializarComoEstaba()`, que la devuelve a la forma en que estaba.
 *
 * @returns `null` si no hay ficha (prompt manual, como Lis) o si el JSON está
 *   roto — que es lo mismo que había antes: no se toca a quien no se entiende.
 */
export function leerFichaAplanada(cruda: string | null | undefined): FichaAplanada | null {
  if (!cruda?.trim()) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(cruda);
  } catch {
    return null;
  }
  // El `as` vive AQUÍ y solo aquí: es el único punto que puede marcar una ficha
  // como aplanada, y por eso el tipo significa algo fuera.
  if (esPorSecciones(obj)) return aplanar(obj) as FichaAplanada;
  return obj as FichaAplanada;
}

/**
 * @deprecated Usa `leerFichaAplanada`, que dice lo que de verdad devuelve.
 *
 * El nombre viejo inducía a pensar que devolvía «la ficha», y por eso un script
 * guardó su resultado tal cual y se llevó por delante el modelo por secciones
 * de dos fichas de producción (17-ago-2026). Se conserva para no romper los
 * scripts que ya lo usan.
 */
export const leerFicha = leerFichaAplanada;
