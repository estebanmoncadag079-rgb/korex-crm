/**
 * El rol de solo lectura del auditor tiene permiso para TODO lo que el
 * auditor lee.
 *
 * ## El incidente que lo pide
 *
 * 21-sep-2026, despliegue del commit `12386b5`. El gate H-2 lo detuvo con:
 *
 *     PostgresError: permission denied for table product   (42501)
 *
 * El auditor había estrenado una comprobación —«productos ofrecibles sin
 * precio»— que consulta `product`, y nadie amplió `korex_h2_auditor`, que
 * solo tenía `organization` y `agent_profile`.
 *
 * **Por qué no lo cazó nada antes:** en local y en el Laboratorio el auditor
 * corre como `postgres`, que es superusuario y pasa por encima de cualquier
 * permiso. Las dos formas de probarlo eran ciegas al problema por
 * construcción. Solo el gate, contra la base real y con el rol real, podía
 * verlo — y lo vio, que es para lo que existe. Producción no se tocó.
 *
 * Al documentar los permisos por columna escribí que el coste era «si algún
 * día el auditor lee una columna nueva, fallará en el gate». Era una TABLA
 * nueva, y esa variante no estaba atada a nada.
 *
 * ## Qué comprueba
 *
 * Recorre el árbol de módulos que el auditor puede alcanzar, extrae cada
 * `schema.<tabla>.<columna>` y exige que esté en el `COLUMNAS` de
 * `crear-rol-auditor.ts`. Es una comprobación de texto a propósito: lo que
 * hay que garantizar es que dos listas escritas en sitios distintos no se
 * separen, y eso es una propiedad de los archivos.
 *
 * Si añades una lectura al auditor, esta prueba se pone roja hasta que
 * amplíes el rol. Y ampliar el rol en producción es
 * `pnpm crear:rol-auditor --aplicar`, que es idempotente.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Los módulos que `auditar-arquitectura.ts` carga y que tocan la base. */
const ALCANZABLES = [
  "scripts/auditar-arquitectura.ts",
  "src/server/auth/arquitectura.ts",
] as const;

const SCRIPT_DEL_ROL = "scripts/crear-rol-auditor.ts";

/** `agentProfile` → `agent_profile`, `priceCents` → `price_cents`. */
const aSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

function lecturasDelAuditor(): { tabla: string; columna: string }[] {
  const vistas = new Map<string, { tabla: string; columna: string }>();
  for (const archivo of ALCANZABLES) {
    const fuente = readFileSync(archivo, "utf8");
    for (const m of fuente.matchAll(/schema\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)/g)) {
      const tabla = aSnake(m[1]!);
      const columna = aSnake(m[2]!);
      vistas.set(`${tabla}.${columna}`, { tabla, columna });
    }
  }
  return [...vistas.values()].sort((a, b) =>
    `${a.tabla}.${a.columna}`.localeCompare(`${b.tabla}.${b.columna}`)
  );
}

describe("el rol del auditor cubre todo lo que el auditor lee", () => {
  const rol = readFileSync(SCRIPT_DEL_ROL, "utf8");
  const lecturas = lecturasDelAuditor();

  it("el escaneo encuentra lecturas (si no, la prueba no prueba nada)", () => {
    // Sin esto, un cambio de sintaxis que rompiera el regex dejaría la prueba
    // en verde para siempre sin comprobar absolutamente nada.
    expect(lecturas.length).toBeGreaterThan(10);
    expect(lecturas.map((l) => `${l.tabla}.${l.columna}`)).toContain("product.price_cents");
  });

  for (const { tabla, columna } of lecturasDelAuditor()) {
    it(`\`${tabla}.${columna}\` está concedida en ${SCRIPT_DEL_ROL}`, () => {
      // La tabla tiene que estar como clave del objeto COLUMNAS…
      expect(rol).toMatch(new RegExp(`(^|\\s|\\{)${tabla}:`, "m"));
      // …y la columna dentro de su lista.
      expect(rol).toContain(`"${columna}"`);
    });
  }

  it("sabe fallar: una columna inventada NO está concedida", () => {
    expect(rol).not.toContain('"columna_que_no_existe_jamas"');
  });
});
