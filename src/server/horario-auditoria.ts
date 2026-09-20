import {
  columnasDesdeHorario,
  diasAbiertos,
  horarioCanonico,
  horarioSemanalDesdeLegacy,
  NOMBRE_DEL_DIA,
  sinHorarioConfigurado,
  type HorarioSemanal,
} from "./horario";

/**
 * ¿Puede el horario de este negocio volver a contradecirse?
 *
 * Un modelo canónico solo sirve si alguien vigila que nada se salga de él. El
 * incidente de Lis no fue "un bug en una función": fue **un dato podrido que
 * llevaba semanas ahí sin que nada lo mirara** — el domingo desmarcado y su
 * franja de domingo conviviendo en la misma fila.
 *
 * Esto es ese vigilante. Puro y sin base de datos: recibe la fila y devuelve
 * lo que no cuadra. Lo ejecuta `pnpm auditar:arquitectura`.
 */

export type TipoDeIncoherencia =
  | "franja_de_dia_cerrado"
  | "derivados_desalineados"
  | "horario_en_instructions"
  | "ficha_sin_migrar"
  | "derivados_con_perdida"
  | "sin_horario";

export type IncoherenciaDeHorario = {
  tipo: TipoDeIncoherencia;
  /** `true` = tumba la auditoría. `false` = se informa y no bloquea. */
  bloqueante: boolean;
  mensaje: string;
};

/** La fila de `agent_profile` que hace falta para juzgar su horario. */
export type FilaParaAuditar = {
  ficha?: string | null;
  instructions?: string | null;
  hoursDays?: string | null;
  hoursOpen?: string | null;
  hoursClose?: string | null;
  hoursOpenSunday?: string | null;
  hoursCloseSunday?: string | null;
};

/** El `horario` crudo de una ficha, sin validar el resto de la ficha. */
function horarioCrudoDeLaFicha(
  ficha: string | null | undefined
): Record<string, unknown> | null {
  if (!ficha?.trim()) return null;
  try {
    const json = JSON.parse(ficha) as Record<string, unknown>;
    const negocio = (json.negocio as Record<string, unknown> | undefined) ?? json;
    const h = negocio.horario;
    return h && typeof h === "object" ? (h as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Un rango horario escrito en prosa: "de 10:00 a 19:00", "10 am a 7 pm",
 * "9:00-18:00". Deliberadamente exige DOS horas y un conector, para no
 * marcar un "te lo entregamos antes de las 5" que no es un horario de
 * atención.
 */
const RANGO_EN_PROSA =
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|h)?\s*(?:a|–|—|-|hasta)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|h)?\b/i;

const NOMBRES_DE_DIA = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;

/**
 * Las incoherencias del horario de UN negocio.
 *
 * Los cinco casos son los que el incidente dejó claros que hacían falta;
 * cada uno con el porqué en su mensaje, para que quien lo lea sepa qué hacer
 * sin tener que abrir el código.
 */
export function incoherenciasDeHorario(fila: FilaParaAuditar): IncoherenciaDeHorario[] {
  const fallos: IncoherenciaDeHorario[] = [];
  const crudo = horarioCrudoDeLaFicha(fila.ficha);
  const canonico: HorarioSemanal = crudo
    ? horarioCanonico(crudo)
    : horarioSemanalDesdeLegacy({
        dias: fila.hoursDays ?? "",
        abre: fila.hoursOpen,
        cierra: fila.hoursClose,
        abreDomingo: fila.hoursOpenSunday,
        cierraDomingo: fila.hoursCloseSunday,
      });

  // ── CASO 5: sin horario. No es un fallo, pero hay que saberlo: un negocio
  //    sin horario tiene un agente que nunca puede decir si está abierto.
  if (sinHorarioConfigurado(canonico)) {
    fallos.push({
      tipo: "sin_horario",
      bloqueante: false,
      mensaje:
        "no tiene horario configurado — el agente no podrá decir si está abierto ni rechazar un día cerrado",
    });
  }

  // ── CASO 1: franja de un día CERRADO. El fallo exacto de Lis.
  const diaCerradoConFranja: string[] = [];
  const diasDeLasColumnas = new Set(
    (fila.hoursDays ?? "")
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => d >= 1 && d <= 7)
  );
  if ((fila.hoursOpenSunday || fila.hoursCloseSunday) && !diasDeLasColumnas.has(7)) {
    diaCerradoConFranja.push("columnas: hours_open_sunday/hours_close_sunday con el domingo fuera de hours_days");
  }
  if (crudo) {
    const diasFicha = new Set(
      Array.isArray(crudo.dias) ? (crudo.dias as unknown[]).map(Number) : []
    );
    const tieneDomingoEnFicha = Boolean(crudo.abreDomingo || crudo.cierraDomingo);
    const porDia = crudo.porDia as Record<string, unknown> | undefined;
    const domingoAbiertoEnCanonico = Boolean(canonico[7]);
    if (tieneDomingoEnFicha && !domingoAbiertoEnCanonico) {
      diaCerradoConFranja.push(
        "ficha: abreDomingo/cierraDomingo con el domingo cerrado en el horario canónico"
      );
    }
    if (porDia && !Array.isArray(porDia) && typeof porDia === "object") {
      for (const [clave, valor] of Object.entries(porDia)) {
        const d = Number(clave);
        if (d >= 1 && d <= 7 && !canonico[d as 1]) {
          diaCerradoConFranja.push(`ficha: porDia["${clave}"] existe pero ese día no abre (${JSON.stringify(valor)})`);
        }
      }
    }
    if (!tieneDomingoEnFicha && diasFicha.has(7) && !domingoAbiertoEnCanonico && porDia === undefined) {
      diaCerradoConFranja.push("ficha: el domingo está en `dias` pero no queda abierto al resolver");
    }
  }
  if (diaCerradoConFranja.length) {
    fallos.push({
      tipo: "franja_de_dia_cerrado",
      bloqueante: true,
      mensaje:
        "hay un horario de un día que está CERRADO — es el estado exacto que abrió a Lis un domingo desmarcado: " +
        diaCerradoConFranja.join(" · "),
    });
  }

  // ── CASO 2: los derivados no dicen lo mismo que el canónico.
  if (!sinHorarioConfigurado(canonico)) {
    const esperadas = columnasDesdeHorario(canonico);
    const actuales = {
      hoursDays: fila.hoursDays ?? null,
      hoursOpen: fila.hoursOpen ?? null,
      hoursClose: fila.hoursClose ?? null,
      hoursOpenSunday: fila.hoursOpenSunday ?? null,
      hoursCloseSunday: fila.hoursCloseSunday ?? null,
    };
    const difieren = (
      Object.keys(esperadas) as (keyof typeof esperadas)[]
    ).filter((k) => (esperadas[k] ?? null) !== (actuales[k] ?? null));
    if (difieren.length) {
      fallos.push({
        tipo: "derivados_desalineados",
        bloqueante: true,
        mensaje:
          "las columnas hours_* no coinciden con el horario de la ficha (la ficha manda; las columnas son su proyección): " +
          difieren
            .map((k) => `${k}: tiene ${JSON.stringify(actuales[k])}, debería ser ${JSON.stringify(esperadas[k])}`)
            .join(" · "),
      });
    }
  }

  /*
   * ── CASO 2-bis: el canónico NO CABE en las columnas.
   *
   * Las columnas solo saben decir UNA franja para toda la semana. Con
   * lun 08:00-12:00 y sáb 14:00-22:00 escriben 08:00-12:00, y no hay
   * contradicción que detectar —hay PÉRDIDA—, así que el caso 2 lo da por
   * alineado. Importa mientras siga habiendo código leyendo columnas: ese
   * código ofrecería el sábado hasta las 12:00 (H-3 de la auditoría).
   */
  if (!sinHorarioConfigurado(canonico)) {
    const franjas = new Set(
      diasAbiertos(canonico).map((d) => `${canonico[d]!.abre}-${canonico[d]!.cierra}`)
    );
    // Dos franjas distintas son expresables si una de ellas es la del domingo:
    // para eso existen `hours_open_sunday`/`hours_close_sunday`.
    const soloDomingoDifiere =
      franjas.size === 2 &&
      Boolean(canonico[7]) &&
      new Set(
        diasAbiertos(canonico)
          .filter((d) => d !== 7)
          .map((d) => `${canonico[d]!.abre}-${canonico[d]!.cierra}`)
      ).size === 1;
    if (franjas.size > 1 && !soloDomingoDifiere) {
      fallos.push({
        tipo: "derivados_con_perdida",
        bloqueante: false,
        mensaje:
          "tiene horario distinto por día y las columnas hours_* no saben expresarlo: " +
          `escriben una sola franja (${[...franjas].join(" vs ")}). Cualquier código que ` +
          "todavía lea las columnas —el contenedor sin desplegar— usará la equivocada",
      });
    }
  }

  // ── CASO 3: un horario escrito dentro de `instructions`.
  //    El prompt es contexto derivado: si lleva un horario propio, ese horario
  //    puede quedarse viejo y el modelo lo recitará con total seguridad.
  const ins = fila.instructions ?? "";
  const lineasSospechosas = ins
    .split("\n")
    .filter((l) => NOMBRES_DE_DIA.test(l) && RANGO_EN_PROSA.test(l))
    .map((l) => l.trim());
  if (lineasSospechosas.length) {
    fallos.push({
      tipo: "horario_en_instructions",
      /*
       * AVISO, no fallo. Desde el rediseño el backend nunca lee el horario de
       * `instructions`, así que esto no puede romper una decisión: es un
       * riesgo de que el modelo DIGA algo que se quedó viejo. Y a veces es
       * información legítima que el modelo canónico no sabe expresar — Lis
       * distingue el horario de pedidos por WhatsApp del de su local físico,
       * y eso no cabe en `porDia`. Bloquear aquí dejaría el gate en rojo
       * permanente por un dato correcto.
       */
      bloqueante: false,
      mensaje:
        "el prompt lleva un horario escrito dentro; el horario lo inyecta el servidor en cada turno desde la ficha, " +
        `así que esto es una segunda fuente que se quedará vieja: ${lineasSospechosas.slice(0, 3).map((l) => JSON.stringify(l.slice(0, 120))).join(" · ")}`,
    });
  }

  // ── CASO 4: ficha sin migrar. Todavía no es una contradicción, pero es el
  //    terreno donde crecen: mientras no haya `porDia`, la autoridad se está
  //    derivando de campos que alguien puede editar por separado.
  if (crudo && crudo.porDia === undefined) {
    fallos.push({
      tipo: "ficha_sin_migrar",
      bloqueante: false,
      mensaje:
        "su ficha todavía no tiene `horario.porDia` (el canónico): se está derivando de los campos viejos, " +
        "que pueden editarse por separado y volver a contradecirse. Migrar con `pnpm migrar:horario <org> --aplicar`",
    });
  }

  return fallos;
}

/** Resumen legible del horario, para que el informe diga qué se está juzgando. */
export function horarioLegibleParaAuditoria(horario: HorarioSemanal): string {
  const abiertos = diasAbiertos(horario);
  if (!abiertos.length) return "(sin horario)";
  return abiertos
    .map((d) => `${NOMBRE_DEL_DIA[d].slice(0, 3)} ${horario[d]!.abre}-${horario[d]!.cierra}`)
    .join(" · ");
}
