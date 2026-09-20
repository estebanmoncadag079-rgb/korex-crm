import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * H-2: LA AUDITORÍA CORRE ANTES DE DESPLEGAR, Y NO SE PUEDE QUITAR SIN QUE SE NOTE.
 *
 * El encabezado de `auditar-arquitectura.ts` lo decía de sí mismo desde el
 * primer día: *"un validador que no corre nunca no protege de ninguna
 * regresión — es documentación ejecutable, no un guardarraíl"*. Seguía siendo
 * cierto de él: existía y no lo invocaba nadie. La auditoría del 20-sep-2026
 * lo encontró (H-2).
 *
 * Esta prueba es la que impide que vuelva a pasar. Si alguien quita el paso
 * del workflow, o lo mueve DESPUÉS del despliegue —donde ya no protege de
 * nada—, esto se pone rojo.
 *
 * Por qué hace falta una prueba para esto: el gate técnico (typecheck, lint,
 * tests, build) mira el CÓDIGO. El fallo que originó todo este trabajo no era
 * de código, era **una fila incoherente** que nadie miraba. El único sitio
 * donde eso se puede atajar antes de que llegue a un cliente es el despliegue.
 */

const WORKFLOW = readFileSync(
  join(process.cwd(), ".github/workflows/deploy.yml"),
  "utf8"
);

describe("el despliegue audita la arquitectura antes de tocar producción", () => {
  it("el workflow invoca al auditor", () => {
    expect(WORKFLOW).toContain("pnpm auditar:arquitectura");
  });

  it("lo hace ANTES de desplegar, no después", () => {
    const auditoria = WORKFLOW.indexOf("pnpm auditar:arquitectura");
    // La invocación real, no el `chmod +x` que va justo antes.
    const despliegue = WORKFLOW.indexOf('scripts/deploy.sh "$COMMIT_SHA"');
    expect(auditoria).toBeGreaterThan(-1);
    expect(despliegue).toBeGreaterThan(-1);
    // Auditar después de desplegar es enterarse cuando ya llegó al cliente.
    expect(auditoria).toBeLessThan(despliegue);
  });

  it("el túnel se cierra pase lo que pase, incluso si el auditor falla", () => {
    // Sin esto, un fallo del auditor deja un túnel abierto a la base de
    // producción en el runner hasta que el job muere.
    expect(WORKFLOW).toMatch(/trap cerrar_tunel EXIT/);
  });

  it("sin el secreto NO deja pasar: lo trata como error, no como aviso", () => {
    /*
     * La primera versión hacía `exit 0` cuando faltaba `DEPLOY_DB_URL`:
     * "aviso y dejo pasar". Eso convertía una auditoría obligatoria en una
     * sugerencia — bastaba con no crear el secreto para desactivar el
     * guardarraíl sin que nadie se enterara. Un gate que se apaga solo no es
     * un gate.
     */
    expect(WORKFLOW).toContain("DEPLOY_DB_URL");
    expect(WORKFLOW).toMatch(/::error.*DEPLOY_DB_URL/);
    expect(WORKFLOW).not.toMatch(/::warning.*DEPLOY_DB_URL/);
  });

  it("el paso de despliegue sigue exigiendo CONFIRMAR: esto no relaja ninguna barrera", () => {
    expect(WORKFLOW).toContain('if [ "$CONFIRM_INPUT" != "CONFIRMAR" ]');
    expect(WORKFLOW).toContain("environment: production");
  });
});

describe("NINGÚN camino permite desplegar sin auditar (fail-closed)", () => {
  /** El bloque `run:` del paso de auditoría, aislado del resto del workflow. */
  const PASO = (() => {
    const ini = WORKFLOW.indexOf("- name: Auditar la coherencia de la arquitectura");
    const fin = WORKFLOW.indexOf("- name: Ejecutar scripts/deploy.sh");
    return WORKFLOW.slice(ini, fin);
  })();

  it("no hay ningún `exit 0`: salir bien solo puede ser haber auditado bien", () => {
    expect(PASO).not.toMatch(/exit 0/);
  });

  it("no está marcado `continue-on-error`", () => {
    expect(PASO).not.toMatch(/continue-on-error/);
  });

  it("no tiene un `if:` que lo pueda saltar", () => {
    // Un `if:` en este paso sería la forma elegante de volver al fail-open.
    expect(PASO).not.toMatch(/^ {8}if:/m);
  });

  it("aborta a la primera con `set -euo pipefail`", () => {
    expect(PASO).toContain("set -euo pipefail");
  });

  it("cada motivo por el que la auditoría no se pueda EJECUTAR también detiene", () => {
    // Falta el secreto · no abre el túnel · la base no responde.
    expect((PASO.match(/exit 1/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(PASO).toMatch(/no se pudo abrir el túnel|No se pudo abrir el túnel/i);
    expect(PASO).toMatch(/no respondió/i);
  });

  it("el auditor es lo ÚLTIMO que corre: su código de salida es el del paso", () => {
    /*
     * Si después del auditor hubiera cualquier otro comando, sería ESE el
     * que decidiera si el paso pasa — y un `echo` final convertiría un FAIL
     * en un PASS sin que se viera.
     */
    const ejecutables = PASO.trim()
      .split(String.fromCharCode(10))
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(ejecutables[ejecutables.length - 1]).toContain("pnpm auditar:arquitectura");
  });

  it("el `|| true` de la limpieza no toca al auditor", () => {
    // `|| true` solo puede aparecer dentro de cerrar_tunel: ahí es correcto
    // (la limpieza no debe tapar el fallo real, y un trap EXIT conserva el
    // código de salida que lo disparó).
    const tras = PASO.slice(PASO.indexOf("trap cerrar_tunel EXIT"));
    expect(tras).not.toContain("|| true");
  });
});

describe("el auditor es SOLO LECTURA: detecta, informa, bloquea — nunca repara", () => {
  const FUENTES = [
    "scripts/auditar-arquitectura.ts",
    "src/server/horario-auditoria.ts",
    "src/server/auth/arquitectura.ts",
  ];

  it("ninguna de sus fuentes escribe en la base", () => {
    /*
     * Un auditor que corre en el camino del despliegue y además escribe es
     * un despliegue que modifica datos sin que nadie lo pida. La regla del
     * proyecto es explícita: corregir es una decisión humana, con su propio
     * comando.
     */
    const escrituras = /\.update\(|\.insert\(|\.delete\(|\bUPDATE\s|\bINSERT\s|\bDELETE\s|\bDROP\s|\bALTER\s/;
    for (const archivo of FUENTES) {
      const codigo = readFileSync(join(process.cwd(), archivo), "utf8");
      expect(`${archivo}: ${escrituras.test(codigo)}`).toBe(`${archivo}: false`);
    }
  });
});

describe("el auditor termina SIEMPRE: colgarse en el gate es un deploy bloqueado", () => {
  it("sale explícitamente también cuando pasa", () => {
    /*
     * El camino de FALLO terminaba con `process.exit(1)`, así que nadie notó
     * que el de ÉXITO no terminaba con nada: la conexión queda abierta y el
     * proceso imprime "PASS" y se queda colgado. Estuvo latente mientras el
     * auditor siempre encontraba algo; en cuanto pasó limpio, se colgó a la
     * primera — y su sitio es el gate de despliegue.
     */
    const codigo = readFileSync(join(process.cwd(), "scripts/auditar-arquitectura.ts"), "utf8");
    expect(codigo).toMatch(/process\.exit\(0\)/);
    expect(codigo).toMatch(/process\.exit\(1\)/);
  });
});

describe("el auditor clasifica, y no esconde ninguno de los cuatro grupos", () => {
  const CODIGO = readFileSync(join(process.cwd(), "scripts/auditar-arquitectura.ts"), "utf8");

  it("imprime los cuatro grupos siempre", () => {
    for (const grupo of ["BLOQUEADORES", "DECISIONES DE NEGOCIO", "OBSERVACIONES", "NO EVALUABLES"]) {
      expect(CODIGO).toContain(grupo);
    }
  });

  it("solo los BLOQUEADORES detienen el despliegue", () => {
    /*
     * El criterio, y es verificable: bloquea lo que el despliegue puede
     * cambiar (una incoherencia entre dos fuentes del mismo dato) y no
     * bloquea lo que va a seguir igual después de desplegar (un mecanismo
     * aprobado aún sin encender en un cliente).
     */
    expect(CODIGO).toMatch(/const culpables = estricto/);
    expect(CODIGO).toMatch(/:\s*bloqueadores;/);
  });

  it("`--estricto` sí exige la arquitectura completa", () => {
    expect(CODIGO).toMatch(/estricto[\s\S]{0,200}decisionesDeNegocio/);
  });

  it("un cliente sin ficha es NO EVALUABLE, no un falso PASS ni un falso FAIL", () => {
    expect(CODIGO).toMatch(/NO EVALUABLE/);
    expect(CODIGO).toMatch(/noEvaluables/);
  });
});
