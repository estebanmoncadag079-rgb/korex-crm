/**
 * Comparación de FILA COMPLETA — regla obligatoria del proyecto desde el
 * 15-ago-2026 ([68-UN-DUENO-POR-DATO.md](../../../../docs/korexia/68-UN-DUENO-POR-DATO.md)).
 *
 * **Por qué existe, con nombre y fecha**: a las 19:46:41 de ese día, una prueba
 * diseñada para detectar pérdidas silenciosas **causó una pérdida silenciosa**.
 * Verificaba `instructions`, `greeting`, `escalationRules`, `enabled` y
 * `appointmentsEnabled` — la lista de campos que ya sabíamos frágiles — y
 * mientras tanto `aplicarFicha` revirtió el horario del salón de 09:30–18:30 a
 * 09:00–20:00 sin que nada saltara.
 *
 * De ahí la regla:
 *
 * > **Ninguna prueba valida una lista de campos.** Se captura la fila entera
 * > antes, se ejecuta la operación, se captura la fila entera después, y solo
 * > pueden haber cambiado los campos que el escritor DECLARÓ. Cualquier otra
 * > diferencia aborta.
 *
 * La diferencia práctica: una lista de campos comprueba lo que ya sabes que se
 * rompe; una fila completa comprueba lo que **no** sabes.
 */

export type Fila = Record<string, unknown>;

export type Diferencia = {
  campo: string;
  de: unknown;
  a: unknown;
};

export type Comparacion = {
  /** `false` = hay cambios que nadie declaró. NO seguir. */
  ok: boolean;
  /** Cambios previstos por el escritor. */
  declarados: Diferencia[];
  /** 🔴 Los que nadie anunció. Aquí es donde vive el próximo incidente. */
  noDeclarados: Diferencia[];
  /** Campos declarados que NO cambiaron: la operación no hizo lo que dijo. */
  declaradosSinCambio: string[];
};

/** Compara valores sin depender del tipo: fechas, nulos y objetos incluidos. */
function iguales(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * @param declarados Campos que el escritor dice que va a cambiar. Todo lo demás
 *   debe quedar intacto. `updatedAt` se declara aparte porque casi toda
 *   escritura lo toca; omitirlo de la lista lo convierte en no declarado, que
 *   es justo lo que se quiere cuando se audita una operación de solo lectura.
 */
export function compararFila(
  antes: Fila,
  despues: Fila,
  declarados: readonly string[]
): Comparacion {
  const campos = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const cambiosDeclarados: Diferencia[] = [];
  const noDeclarados: Diferencia[] = [];

  for (const campo of campos) {
    if (iguales(antes[campo], despues[campo])) continue;
    const dif = { campo, de: antes[campo], a: despues[campo] };
    if (declarados.includes(campo)) cambiosDeclarados.push(dif);
    else noDeclarados.push(dif);
  }

  const declaradosSinCambio = declarados.filter(
    (c) => !cambiosDeclarados.some((d) => d.campo === c)
  );

  return {
    ok: noDeclarados.length === 0,
    declarados: cambiosDeclarados,
    noDeclarados,
    declaradosSinCambio,
  };
}

/** Un resumen legible, para que el motivo del aborto se lea de un vistazo. */
export function explicar(c: Comparacion): string {
  const recorta = (v: unknown) => {
    const s = v === null || v === undefined ? String(v) : String(v);
    return s.length > 70 ? `${s.slice(0, 70)}…` : s;
  };
  const lineas: string[] = [];
  for (const d of c.declarados) {
    lineas.push(`  ✅ ${d.campo}: ${recorta(d.de)} → ${recorta(d.a)}`);
  }
  for (const d of c.noDeclarados) {
    lineas.push(`  🔴 ${d.campo} CAMBIÓ SIN DECLARARSE: ${recorta(d.de)} → ${recorta(d.a)}`);
  }
  for (const campo of c.declaradosSinCambio) {
    lineas.push(`  ⚠️  ${campo}: se declaró pero no cambió`);
  }
  return lineas.join("\n") || "  (la fila no cambió en absoluto)";
}
