/**
 * `crear-rol-auditor --aplicar` no puede aplicar un cambio real y luego
 * reportarlo como fallo.
 *
 * ## El incidente que lo pide
 *
 * 21-sep-2026. El rol `korex_h2_auditor` ya existía y su contraseña estaba
 * borrada del disco —lo correcto: se borra al pegarla en GitHub—. Con ese
 * estado, el script:
 *
 *   1. ejecutaba los GRANT,
 *   2. hacía COMMIT,
 *   3. no encontraba la contraseña para reconectarse COMO el rol,
 *   4. **salía con código 1.**
 *
 * El cambio quedaba hecho en producción y reportado como fallo. Eso invita
 * a re-ejecutar, o peor, a dar por bueno un rollback que nadie hizo. Se
 * detectó antes de ejecutarlo, leyendo el código.
 *
 * ## El contrato que se fija aquí
 *
 * Después del COMMIT, el código de salida responde a **una sola pregunta**:
 * *¿los permisos quedaron mal?* No a *¿pude verificarlo todo?*.
 *
 * | Situación | Código |
 * |---|---|
 * | Fallo ANTES del COMMIT | 1 (y ROLLBACK: no quedan cambios parciales) |
 * | COMMIT ok, sin credencial para verificar | **0**, con advertencia |
 * | COMMIT ok, el rol PUEDE escribir | 1 |
 * | COMMIT ok, el auditor se queja de `permission denied` | 1 |
 * | COMMIT ok, el auditor halla una incoherencia de DATOS | **0**, con aviso |
 *
 * ## Por qué se comprueba leyendo el archivo
 *
 * El script es un programa de línea de comandos que escribe en producción:
 * no se puede importar ni ejecutar desde una prueba sin una base real y una
 * credencial. Lo que hay que garantizar es la FORMA del control de flujo —
 * qué camino sale con qué código— y eso sí es una propiedad del texto.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/crear-rol-auditor.ts";
const fuente = readFileSync(SCRIPT, "utf8");

/** El archivo partido por el punto de no retorno: el COMMIT. */
const MARCA_COMMIT = "PERMISOS APLICADOS Y COMPROMETIDOS";
const iCommit = fuente.indexOf(MARCA_COMMIT);
const antesDelCommit = fuente.slice(0, iCommit);
const despuesDelCommit = fuente.slice(iCommit);

describe("el archivo tiene la forma que estas pruebas asumen", () => {
  it("existe el punto de no retorno del COMMIT", () => {
    // Sin esto, un refactor que renombrara el mensaje dejaría todas las
    // pruebas de abajo mirando el archivo entero y pasando por accidente.
    expect(iCommit).toBeGreaterThan(0);
    expect(despuesDelCommit.length).toBeGreaterThan(500);
  });
});

describe("COMMIT correcto + credencial ausente -> EXITO con advertencia", () => {
  /** El bloque que corre exactamente en ese caso. */
  const bloque = despuesDelCommit.slice(
    despuesDelCommit.indexOf("if (!password)"),
    despuesDelCommit.indexOf("// -- 4.")
  );

  it("ese camino existe y está DESPUÉS del COMMIT", () => {
    expect(bloque.length).toBeGreaterThan(200);
  });

  it("sale con 0, no con 1", () => {
    expect(bloque).toContain("process.exit(0)");
    expect(bloque).not.toContain("process.exit(1)");
  });

  it("dice claramente que los permisos SÍ se aplicaron", () => {
    expect(despuesDelCommit).toMatch(/PERMISOS APLICADOS Y COMPROMETIDOS/);
    expect(bloque).toMatch(/NO es un fallo/i);
    expect(bloque).toMatch(/permisos.{0,40}est[aá]n aplicados/i);
  });

  it("advierte de que la verificación queda pendiente", () => {
    expect(bloque).toMatch(/VERIFICACI[OÓ]N POSTERIOR PENDIENTE/i);
  });

  it("indica QUÉ verificación externa hay que ejecutar, con el comando", () => {
    expect(bloque).toContain("VERIFICACION_EXTERNA");
    expect(fuente).toMatch(/column_privileges[\s\S]{0,80}grantee/);
    // Y dice qué debe devolver, tabla por tabla.
    expect(bloque).toMatch(/Debe listar/i);
  });

  it("NO deshace los GRANT ya confirmados", () => {
    // No puede haber ni un REVOKE ni un rollback en el camino posterior al
    // COMMIT: lo comprometido se queda comprometido.
    expect(despuesDelCommit).not.toMatch(/\bREVOKE\b(?![^\n]*\*)/);
    expect(despuesDelCommit).not.toMatch(/ROLLBACK;/);
  });
});

describe("fallo ANTES del COMMIT -> ROLLBACK y codigo 1", () => {
  it("el camino de aborto sale con 1 y dice que no se escribió nada", () => {
    expect(antesDelCommit).toMatch(/ABORTADO por ROLLBACK, nada se escribio/);
    expect(antesDelCommit).toContain("process.exit(1)");
  });

  it("las comprobaciones previas viven DENTRO de la transacción", () => {
    // `throw` dentro de `admin.begin(...)` es lo que fuerza el ROLLBACK. Si
    // alguien las sacara fuera, un fallo dejaría permisos a medias.
    expect(antesDelCommit).toMatch(/if \(!todo \|\| !limpio \|\| cr!\.ok \|\| deMas > 0\) throw new Error/);
    expect(antesDelCommit).toContain("await admin.begin(");
  });
});

describe("el codigo de salida final solo habla de PERMISOS", () => {
  it("un auditor que falla por DATOS no se cuenta como fallo de permisos", () => {
    expect(fuente).toContain("const faltaPermiso = /permission denied/i.test(salida)");
    expect(fuente).toContain("const permisosMal = !neg.every(Boolean) || !sinRastro || faltaPermiso;");
    // Lo que NO debe estar: el exit atado al codigo de salida del auditor.
    expect(fuente).not.toContain("r.status === 0;");
  });

  it("si el rol pudiera escribir, sí sale con 1", () => {
    expect(fuente).toContain("process.exit(permisosMal ? 1 : 0)");
  });

  it("y aun fallando, deja claro que los GRANT están aplicados", () => {
    expect(fuente).toMatch(/REVISAR LOS PERMISOS[\s\S]{0,80}GRANT S[IÍ] est[aá]n aplicados/);
  });
});

describe("las pruebas negativas de escritura siguen ahí", () => {
  for (const intento of [
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "DDL: ALTER TABLE",
    "DDL: CREATE TABLE",
    "DDL: DROP TABLE",
    "CREATE ROLE",
    "CREATE DATABASE",
  ]) {
    it(`sigue intentando —y esperando que se deniegue— ${intento}`, () => {
      // Con `\s*` porque algunas llamadas van partidas en varias líneas por
      // el formateador; lo que importa es que la llamada exista, no cómo esté
      // envuelta.
      const re = new RegExp(`denegado\\(\\s*"${intento.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
      expect(fuente).toMatch(re);
    });
  }

  it("y las lecturas que NO debe poder hacer", () => {
    expect(fuente).toContain("notify_phones");
    expect(fuente).toContain("tabla ajena (contact)");
  });
});

describe("los permisos aprobados no cambian", () => {
  it("product concede exactamente las 5 columnas aprobadas, y ninguna más", () => {
    const linea = fuente.match(/^ {2}product: \[(.*)\],$/m)?.[1] ?? "";
    const cols = [...linea.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(cols).toEqual([
      "organization_id",
      "name",
      "price_cents",
      "available",
      "archived_at",
    ]);
  });

  it("siguen siendo 3 tablas y nada más", () => {
    const claves = [...fuente.matchAll(/^ {2}([a-z_]+): \[/gm)].map((m) => m[1]);
    expect(claves.sort()).toEqual(["agent_profile", "organization", "product"]);
  });
});
