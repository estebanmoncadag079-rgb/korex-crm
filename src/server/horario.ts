import { normalizarHora } from "@/lib/hora";

/**
 * EL HORARIO DEL NEGOCIO: un solo modelo, un solo dueño.
 *
 * ## El incidente que lo obligó (19/20-sep-2026, Lis)
 *
 * La dueña desmarcó el domingo en su pantalla y el bot siguió ofreciendo
 * servicio ese día. No fue un fallo del modelo: el horario se guardaba en
 * **dos sitios que podían contradecirse**.
 *
 *   `hours_days = "1,2,3,4,5,6"`        → el domingo NO está
 *   `hours_open_sunday = "14:00"`       → pero el domingo tiene franja propia
 *
 * Y el resolutor de entonces (`rangoDelDia` en `prompts.ts`) miraba primero
 * la franja de domingo, **sin comprobar nunca si el domingo estaba entre los
 * días abiertos**. Peor: `businessStatus` tenía un `tieneDomingoPropio` que
 * se saltaba adrede la comprobación de días. Desmarcar el domingo no
 * desmarcaba nada.
 *
 * ## La regla, ahora inviolable
 *
 * > **Un día que no está en el horario está CERRADO. Y la única forma de
 * > decir que un día abre es ponerle su franja.**
 *
 * No hay una lista de días por un lado y unas horas por otro: cada día
 * *es* su franja, o no está. Un "domingo cerrado con horario de domingo"
 * dejó de ser representable — no hace falta validarlo, no cabe en el tipo.
 *
 * ## Por qué el domingo deja de ser especial
 *
 * Porque nunca debió serlo. `hours_open_sunday` existía para un caso real
 * (un negocio que el domingo abre más tarde), pero resolverlo con un par de
 * columnas aparte convirtió un día normal en una rama del código, y esa
 * rama fue exactamente por donde se coló el fallo. Aquí el domingo es el
 * día 7 y se comporta como el 1.
 *
 * ## Qué es autoridad y qué es derivado
 *
 *   ficha.horario.porDia        → CANÓNICO. Lo escribe el negocio desde el CRM.
 *     ├── ficha.horario.dias/abre/cierra/abreDomingo/cierraDomingo  → derivado
 *     └── agent_profile.hours_*                                     → derivado
 *
 * Los derivados existen solo para que el código ya desplegado siga leyendo
 * algo coherente y para poder mirar el horario desde SQL. **Se reescriben
 * enteros desde el canónico en cada guardado**, así que no pueden quedarse
 * viejos; y si alguien los edita a mano, `pnpm auditar:arquitectura` lo
 * marca como FAIL.
 */

/** 1 = lunes … 7 = domingo. El domingo es un día más. */
export type DiaDeLaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Cuándo abre y cierra un día concreto, en "HH:MM" de 24 horas. */
export type FranjaDelDia = { abre: string; cierra: string };

/**
 * El horario de la semana.
 *
 * **Un día ausente está CERRADO.** Es la única forma de decirlo, y por eso
 * no puede contradecir a nada: no hay ningún otro campo que opine.
 */
export type HorarioSemanal = Partial<Record<DiaDeLaSemana, FranjaDelDia>>;

export const DIAS_DE_LA_SEMANA: readonly DiaDeLaSemana[] = [1, 2, 3, 4, 5, 6, 7];

export const NOMBRE_DEL_DIA: Record<DiaDeLaSemana, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};

function esDia(n: unknown): n is DiaDeLaSemana {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 7;
}

/**
 * **La función de dominio.** Qué franja rige un día, o `null` si está cerrado.
 *
 * Todo el sistema pregunta aquí: el prompt, el motor de citas, el estado del
 * negocio y la migración. No hay ninguna rama para el domingo, y no puede
 * haberla — el tipo no distingue días.
 */
export function franjaDelDia(
  horario: HorarioSemanal,
  dia: number
): FranjaDelDia | null {
  if (!esDia(dia)) return null;
  return horario[dia] ?? null;
}

/** Los días que el negocio atiende, en orden. Vacío = no atiende ninguno. */
export function diasAbiertos(horario: HorarioSemanal): DiaDeLaSemana[] {
  return DIAS_DE_LA_SEMANA.filter((d) => horario[d]);
}

/**
 * `true` cuando este negocio **no tiene horario configurado**, que no es lo
 * mismo que estar cerrado siempre: sin horario no se afirma nada, ni abierto
 * ni cerrado (ver `businessStatus`, que devuelve `null`).
 */
export function sinHorarioConfigurado(horario: HorarioSemanal): boolean {
  return diasAbiertos(horario).length === 0;
}

/** Una franja válida, o `null`. Normaliza "9 AM" → "09:00" (ver `lib/hora.ts`). */
function franjaValida(
  abre: string | null | undefined,
  cierra: string | null | undefined
): FranjaDelDia | null {
  const a = normalizarHora(abre ?? undefined) ?? (abre?.trim() || null);
  const c = normalizarHora(cierra ?? undefined) ?? (cierra?.trim() || null);
  if (!a || !c) return null;
  return { abre: a, cierra: c };
}

/** La forma antigua: una lista de días y una franja común, más la de domingo. */
export type HorarioLegacy = {
  dias?: unknown;
  abre?: string | null;
  cierra?: string | null;
  abreDomingo?: string | null;
  cierraDomingo?: string | null;
};

/** Los días de `"1,2,3"` o `[1,2,3]`, saneados y sin repetir. */
function diasDeLegacy(dias: unknown): DiaDeLaSemana[] {
  const crudos: unknown[] = Array.isArray(dias)
    ? dias
    : typeof dias === "string"
      ? dias.split(",")
      : [];
  const vistos = new Set<DiaDeLaSemana>();
  for (const c of crudos) {
    const n = typeof c === "number" ? c : Number(String(c).trim());
    if (esDia(n)) vistos.add(n);
  }
  return DIAS_DE_LA_SEMANA.filter((d) => vistos.has(d));
}

/**
 * Del modelo viejo al canónico. **Aquí es donde se corrige el fallo de Lis.**
 *
 * La franja propia del domingo solo se aplica **si el domingo está entre los
 * días abiertos**. Antes bastaba con que existiera para que el domingo
 * abriera, y por eso desmarcar el día no servía de nada: la franja huérfana
 * mandaba sobre la casilla.
 *
 * Es una conversión de LECTURA, y por eso vive aquí y no en una migración:
 * un cliente que todavía no se haya migrado —o una fila con las columnas
 * puestas y sin ficha— se lee igual de bien, y ya sin el fallo.
 */
export function horarioSemanalDesdeLegacy(legacy: HorarioLegacy): HorarioSemanal {
  const dias = diasDeLegacy(legacy.dias);
  const comun = franjaValida(legacy.abre, legacy.cierra);
  const domingo = franjaValida(legacy.abreDomingo, legacy.cierraDomingo);

  const horario: HorarioSemanal = {};
  for (const d of dias) {
    /*
     * El domingo abierto usa su franja propia si la tiene; si no, la común.
     * Y un domingo que NO está en `dias` no entra en este bucle: su franja,
     * si existía, se queda fuera. Eso es lo que arregla el incidente.
     */
    const franja = d === 7 ? (domingo ?? comun) : comun;
    if (franja) horario[d] = franja;
  }
  return horario;
}

/**
 * Del canónico a los campos viejos, para que el código todavía desplegado y
 * las columnas de SQL sigan viendo algo coherente.
 *
 * **Es una proyección con pérdida, y a propósito.** El modelo viejo no sabe
 * representar un horario distinto por día (martes 10–14, jueves 15–20): en
 * ese caso escribe la franja más repetida y los días abiertos, que es lo más
 * cerca que puede quedar. Por eso nunca se lee de vuelta como autoridad —
 * solo el canónico manda.
 */
export function legacyDesdeHorarioSemanal(horario: HorarioSemanal): {
  dias: DiaDeLaSemana[];
  abre: string;
  cierra: string;
  abreDomingo: string | null;
  cierraDomingo: string | null;
} {
  const dias = diasAbiertos(horario);

  // La franja más repetida entre los días de lunes a sábado; si el negocio
  // solo abre el domingo, la suya.
  const conteo = new Map<string, number>();
  for (const d of dias) {
    if (d === 7 && dias.length > 1) continue;
    const f = horario[d]!;
    const clave = `${f.abre}|${f.cierra}`;
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  let mejor = "";
  let mejorN = 0;
  for (const [clave, n] of conteo) {
    if (n > mejorN) {
      mejor = clave;
      mejorN = n;
    }
  }
  const [abre = "", cierra = ""] = mejor.split("|");

  const domingo = horario[7];
  /*
   * `abreDomingo` solo se escribe cuando el domingo ABRE **y** su franja es
   * distinta de la común. Un domingo cerrado deja estos dos campos en `null`,
   * siempre: la franja huérfana que engañó al resolutor ya no puede existir
   * ni aquí, que es el único sitio que la escribe.
   */
  const domingoEsDistinto =
    domingo && (domingo.abre !== abre || domingo.cierra !== cierra);

  return {
    dias,
    abre,
    cierra,
    abreDomingo: domingoEsDistinto ? domingo.abre : null,
    cierraDomingo: domingoEsDistinto ? domingo.cierra : null,
  };
}

/**
 * Los días que el negocio DECLARÓ abiertos pero cuyas horas no se entienden.
 *
 * Existe por el hallazgo H-1 de la auditoría del 20-sep-2026, que fue un fallo
 * de este mismo rediseño: la pantalla deja marcar un día y dejar sus horas en
 * blanco, y al guardar la franja vacía se descartaba y el día **desaparecía
 * sin un solo aviso**. El administrador veía el lunes marcado, guardaba, y el
 * bot trataba el lunes como cerrado.
 *
 * Es la misma clase de fallo que este trabajo vino a cerrar —la pantalla
 * diciendo una cosa y el backend otra—, solo que hacia el lado seguro. Da
 * igual hacia dónde: **un dato que el negocio declaró no se descarta
 * callando**. Con esto, `faltantesDeLaFicha` lo nombra y frena el alta.
 *
 * Lista vacía para una ficha sin migrar (sin `porDia`): ahí no hay ninguna
 * declaración por día que contradecir.
 */
export function diasDeclaradosSinHoraValida(
  horario: (HorarioLegacy & { porDia?: unknown }) | null | undefined
): DiaDeLaSemana[] {
  const porDia = horario?.porDia;
  if (!porDia || typeof porDia !== "object" || Array.isArray(porDia)) return [];

  const malos: DiaDeLaSemana[] = [];
  for (const [clave, valor] of Object.entries(porDia as PorDiaGuardado)) {
    const d = Number(clave);
    if (!esDia(d)) continue;
    /*
     * Aquí se exige que la hora sea LEGIBLE, no solo que exista.
     *
     * `franjaValida` es tolerante a propósito —conserva el texto crudo si no
     * sabe normalizarlo, como hacía el modelo viejo—, pero el modelo viejo
     * tenía además su propia comprobación de formato en `faltantesDeLaFicha`:
     * un horario escrito "9 AM" que el servidor no supiera leer dejaba la
     * agenda de citas sin un solo hueco, en silencio (13-ago-2026). El modelo
     * por día había perdido esa garantía; esto la devuelve.
     */
    const abre = typeof valor?.abre === "string" ? valor.abre : "";
    const cierra = typeof valor?.cierra === "string" ? valor.cierra : "";
    if (!normalizarHora(abre) || !normalizarHora(cierra)) malos.push(d);
  }
  return DIAS_DE_LA_SEMANA.filter((d) => malos.includes(d));
}

/** La forma canónica tal como se guarda: `{ "1": {abre,cierra}, … }`. */
export type PorDiaGuardado = Record<string, { abre?: unknown; cierra?: unknown }>;

/** Sanea un `porDia` recién leído de la base (JSON, puede venir de cualquier forma). */
export function horarioSemanalDesdePorDia(porDia: unknown): HorarioSemanal {
  if (!porDia || typeof porDia !== "object" || Array.isArray(porDia)) return {};
  const horario: HorarioSemanal = {};
  for (const [clave, valor] of Object.entries(porDia as PorDiaGuardado)) {
    const d = Number(clave);
    if (!esDia(d) || !valor || typeof valor !== "object") continue;
    const franja = franjaValida(
      typeof valor.abre === "string" ? valor.abre : null,
      typeof valor.cierra === "string" ? valor.cierra : null
    );
    if (franja) horario[d] = franja;
  }
  return horario;
}

/**
 * El horario canónico de un negocio, venga su ficha en la forma nueva o en la
 * vieja.
 *
 * **`porDia` manda siempre que exista**, aunque los campos viejos digan otra
 * cosa: son derivados suyos. Cuando no existe —cliente sin migrar— se deriva
 * de los campos viejos, ya con la corrección del domingo huérfano.
 */
export function horarioCanonico(
  horario: (HorarioLegacy & { porDia?: unknown }) | null | undefined
): HorarioSemanal {
  if (!horario) return {};
  if (horario.porDia !== undefined && horario.porDia !== null) {
    return horarioSemanalDesdePorDia(horario.porDia);
  }
  return horarioSemanalDesdeLegacy(horario);
}

/**
 * La ficha con su horario ya normalizado: el canónico y sus derivados, todos
 * escritos desde la misma verdad.
 *
 * Se llama en CADA guardado de la ficha, no solo al migrar. Es lo que hace
 * imposible que los derivados se queden viejos — y por tanto que vuelvan a
 * contradecir al canónico como hicieron con Lis.
 */
export function horarioNormalizado(horario: HorarioSemanal): {
  porDia: Record<string, FranjaDelDia>;
  dias: DiaDeLaSemana[];
  abre: string;
  cierra: string;
  abreDomingo?: string;
  cierraDomingo?: string;
} {
  const legacy = legacyDesdeHorarioSemanal(horario);
  const porDia: Record<string, FranjaDelDia> = {};
  for (const d of diasAbiertos(horario)) porDia[String(d)] = horario[d]!;
  return {
    porDia,
    dias: legacy.dias,
    abre: legacy.abre,
    cierra: legacy.cierra,
    ...(legacy.abreDomingo ? { abreDomingo: legacy.abreDomingo } : {}),
    ...(legacy.cierraDomingo ? { cierraDomingo: legacy.cierraDomingo } : {}),
  };
}

/**
 * Lo que el negocio escribió a mano sobre sus horarios. **Contexto, nunca
 * autoridad.**
 *
 * No todo cabe en una franja por día. Lis es el caso real: toma pedidos por
 * WhatsApp desde las 10:00, pero su local físico abre a la 1 de la tarde. Su
 * horario OPERATIVO —el que decide si el bot atiende— es el de WhatsApp; el
 * del local es algo que hay que poder contarle al cliente y que ninguna
 * estructura por día sabe expresar.
 *
 * La alternativa era añadir `horarioLocal`, y detrás habrían venido
 * `horarioInstagram`, `horarioEntrega`, `horarioFestivos`… un campo
 * estructurado por cada particularidad de cada negocio. En su lugar: un texto
 * libre que explica y que **no puede decidir nada**.
 *
 * ## Por qué no puede decidir nada
 *
 * No es una regla escrita que alguien deba recordar: **es el tipo**.
 * `businessStatus` y `franjaDelDia` solo aceptan `HorarioSemanal`, que es un
 * mapa de día a franja. Esta cadena no cabe ahí. Para que una observación
 * abriera un día haría falta cambiar una firma a propósito, no despistarse.
 *
 * ## Por qué vive FUERA de `ficha.horario`
 *
 * Porque `horarioNormalizado` reescribe `ficha.horario` entero en cada
 * guardado. Un campo hermano dentro de ese objeto se borraría solo — que es
 * exactamente la trampa de H-1. El normalizador no puede perder lo que nunca
 * maneja.
 */
export function observacionesDeHorario(fila: { ficha?: string | null }): string | null {
  if (!fila.ficha?.trim()) return null;
  let json: unknown;
  try {
    json = JSON.parse(fila.ficha);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const raiz = json as Record<string, unknown>;
  const negocio = (raiz.negocio as Record<string, unknown> | undefined) ?? raiz;
  const texto = negocio.observacionesHorario;
  return typeof texto === "string" && texto.trim() ? texto : null;
}

/** Las columnas `hours_*` derivadas del canónico. Nunca se leen como autoridad. */
export function columnasDesdeHorario(horario: HorarioSemanal): {
  hoursDays: string | null;
  hoursOpen: string | null;
  hoursClose: string | null;
  hoursOpenSunday: string | null;
  hoursCloseSunday: string | null;
} {
  if (sinHorarioConfigurado(horario)) {
    // Sin horario no se inventa uno: se deja vacío, y `businessStatus`
    // devuelve `null` (no afirma ni abierto ni cerrado).
    return {
      hoursDays: null,
      hoursOpen: null,
      hoursClose: null,
      hoursOpenSunday: null,
      hoursCloseSunday: null,
    };
  }
  const l = legacyDesdeHorarioSemanal(horario);
  return {
    hoursDays: l.dias.join(","),
    hoursOpen: l.abre || null,
    hoursClose: l.cierra || null,
    hoursOpenSunday: l.abreDomingo,
    hoursCloseSunday: l.cierraDomingo,
  };
}

/**
 * El horario canónico de una fila de `agent_profile`, con o sin ficha.
 *
 * Orden de autoridad, y el porqué de cada escalón:
 *
 *   1. **`ficha.horario.porDia`** — el canónico. Lo escribe el negocio desde
 *      su pantalla y manda sobre todo lo demás.
 *   2. **las columnas `hours_*`** — lo que HOY usa producción de verdad: las
 *      leen el prompt, el estado del negocio y el motor de citas. Mientras un
 *      cliente no tenga `porDia`, esto es su horario efectivo.
 *   3. `ficha.horario` en su forma vieja — el último recurso, solo si no hay
 *      columnas.
 *
 * ⚠️ **El orden 2 antes que 3 no es un detalle: es un dato real.** Lashes
 * Valen tiene `cierra: "22:30"` en su ficha y `hours_close = "18:30"` en sus
 * columnas — alguien corrigió el cierre a mano el 15-ago-2026 y la respuesta
 * del cuestionario se quedó como estaba. El salón cierra a las 18:30, que es
 * lo que el motor de citas viene usando desde entonces. Leer la ficha vieja
 * antes que las columnas le habría abierto la agenda cuatro horas de más el
 * día del despliegue, sin que nadie lo pidiera.
 *
 * Dicho de otra forma: la ficha VIEJA nunca fue la fuente operativa —así
 * estaba documentado (`aplicarFicha`: *"`ficha.horario` es lo que el cliente
 * respondió el día del alta, un registro histórico, no un dato operativo"*)—
 * y una migración no puede cambiarle el horario a nadie.
 */
export function horarioDeLaFila(fila: {
  ficha?: string | null;
  hoursDays?: string | null;
  hoursOpen?: string | null;
  hoursClose?: string | null;
  hoursOpenSunday?: string | null;
  hoursCloseSunday?: string | null;
}): HorarioSemanal {
  const canonicoDeLaFicha = porDiaDeLaFichaCruda(fila.ficha);
  if (canonicoDeLaFicha) return canonicoDeLaFicha;

  const deLasColumnas = horarioSemanalDesdeLegacy({
    dias: fila.hoursDays ?? "",
    abre: fila.hoursOpen,
    cierra: fila.hoursClose,
    abreDomingo: fila.hoursOpenSunday,
    cierraDomingo: fila.hoursCloseSunday,
  });
  if (!sinHorarioConfigurado(deLasColumnas)) return deLasColumnas;

  return horarioDeLaFichaCruda(fila.ficha) ?? {};
}

/** Solo el canónico de la ficha (`porDia`), o `null` si todavía no lo tiene. */
function porDiaDeLaFichaCruda(ficha: string | null | undefined): HorarioSemanal | null {
  const crudo = horarioCrudoDeLaFicha(ficha);
  if (!crudo || crudo.porDia === undefined || crudo.porDia === null) return null;
  return horarioSemanalDesdePorDia(crudo.porDia);
}

/**
 * El horario de una ficha en crudo (JSON, plana o por secciones), o `null` si
 * esa ficha no tiene horario — que no es lo mismo que tenerlo vacío.
 *
 * No usa `leerFicha` a propósito: ese lector valida la ficha entera y aquí
 * hace falta poder leer el horario de una ficha incompleta (un borrador a
 * medias, un cliente a medio dar de alta) sin que se caiga todo.
 */
function horarioDeLaFichaCruda(ficha: string | null | undefined): HorarioSemanal | null {
  const horario = horarioCrudoDeLaFicha(ficha);
  return horario ? horarioCanonico(horario) : null;
}

/** El objeto `horario` de una ficha en crudo, sin interpretarlo. */
function horarioCrudoDeLaFicha(
  ficha: string | null | undefined
): (HorarioLegacy & { porDia?: unknown }) | null {
  if (!ficha?.trim()) return null;
  let json: unknown;
  try {
    json = JSON.parse(ficha);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const raiz = json as Record<string, unknown>;
  const negocio = (raiz.negocio as Record<string, unknown> | undefined) ?? raiz;
  const horario = negocio.horario as (HorarioLegacy & { porDia?: unknown }) | undefined;
  return horario && typeof horario === "object" ? horario : null;
}
