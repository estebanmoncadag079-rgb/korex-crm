/**
 * Fase 9 — el punto de ejecución que le faltaba a
 * `validarConfiguracionArquitectonica`.
 *
 * La función existía desde la Fase 7/8 del programa de mejora y estaba bien
 * construida, pero **no la llamaba nadie**: solo los tests. Un validador que
 * no corre nunca no protege de ninguna regresión — es documentación
 * ejecutable, no un guardarraíl. Esto le da un sitio donde correr.
 *
 * Recorre TODAS las organizaciones (nunca una lista de clientes escrita a
 * mano) y compara cada `agent_profile` contra la arquitectura aprobada para
 * su vertical. La regla vive en `server/auth/arquitectura.ts`, que es la
 * misma fuente que usa `provisionOrganization` al dar de alta: aquí no se
 * duplica ni un valor esperado.
 *
 * Señal de salida, pensada para que la pueda leer una persona y también un CI:
 *
 *   exit 0  → PASS: ninguna organización con un mecanismo CORE ausente.
 *   exit 1  → FAIL: al menos una INCONSISTENTE. Se nombra cuál y qué le falta.
 *
 * Las ADVERTENCIAS (mecanismos `recomendado`, como `payment_source`) se
 * listan pero NO tumban el resultado: son mejoras, no fiabilidad rota.
 * `--estricto` las convierte en fallo, para cuando se quiera exigir la
 * arquitectura completa.
 *
 * SOLO LECTURA: no escribe ni "arregla" nada, igual que el resto de
 * diagnósticos del proyecto (`migrar:catalogo`/`fase2` sin `--aplicar`).
 * Corregir es una decisión humana, con su propio comando.
 *
 * Uso:
 *   pnpm auditar:arquitectura
 *   pnpm auditar:arquitectura --estricto
 */
import { readFileSync } from "node:fs";

function envVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    return env
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim();
  } catch {
    return undefined;
  }
}

const url = envVar("DATABASE_URL");
if (!url) {
  console.error("[auditar-arquitectura] falta DATABASE_URL");
  process.exit(1);
}

const estricto = process.argv.includes("--estricto");

/**
 * `validarConfiguracionArquitectonica` lee por `getDb()`, y esa conexión pasa
 * por `getEnv()`, que valida el entorno ENTERO de la aplicación (auth, cifrado,
 * webhook) aunque aquí solo se hagan SELECT.
 *
 * Se rellenan los mínimos con valores neutros —nunca secretos reales— igual
 * que hace `tests/integration/_db.ts`, y ANTES de importar nada que toque la
 * base. Es lo que permite reutilizar el validador tal cual en vez de duplicar
 * su consulta aquí, que es justo lo que no debe hacerse: la regla de qué es
 * "arquitectura aprobada" tiene que vivir en un solo sitio.
 */
process.env.DATABASE_URL = url;
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "solo-para-este-diagnostico-de-lectura";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "solo-para-este-diagnostico-de-lectura";

const { getDb, schema } = await import("@/lib/db");
const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
const db = getDb();

async function main() {
  const organizaciones = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization);

  const inconsistentes: string[] = [];
  const conAdvertencia: string[] = [];
  let alineadas = 0;
  let sinPerfil = 0;

  for (const org of organizaciones.sort((a, b) => a.name.localeCompare(b.name))) {
    const diag = await validarConfiguracionArquitectonica(org.id);
    if (!diag) {
      sinPerfil++;
      console.log(`  ⚪ ${org.name} — sin agent_profile (alta a medias o cliente vacío)`);
      continue;
    }

    if (diag.estado === "INCONSISTENTE") {
      inconsistentes.push(org.name);
      const detalle = [
        diag.faltantes.length ? `falta(n) [core]: ${diag.faltantes.join(", ")}` : "",
        diag.incompatibles.length ? `dato suelto de otro vertical: ${diag.incompatibles.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      console.log(`  🔴 ${org.name} (${diag.vertical}) — ${detalle}`);
      for (const campo of diag.faltantes) {
        console.log(
          `       ${campo}: tiene "${String(diag.configuracionActual[campo])}", ` +
            `se espera "${String(diag.configuracionEsperada[campo])}"`
        );
      }
    } else if (diag.estado === "ADVERTENCIA") {
      conAdvertencia.push(org.name);
      console.log(
        `  🟡 ${org.name} (${diag.vertical}) — recomendado y ausente: ${diag.advertencias.join(", ")}`
      );
      for (const campo of diag.advertencias) {
        console.log(
          `       ${campo}: tiene "${String(diag.configuracionActual[campo])}", ` +
            `se recomienda "${String(diag.configuracionEsperada[campo])}"`
        );
      }
    } else {
      alineadas++;
      console.log(`  🟢 ${org.name} (${diag.vertical}) — alineada`);
    }
  }

  console.log(
    `\n[auditar-arquitectura] ${alineadas} alineada(s), ${conAdvertencia.length} con advertencia, ` +
      `${inconsistentes.length} inconsistente(s), ${sinPerfil} sin perfil.`
  );

  const falla = inconsistentes.length > 0 || (estricto && conAdvertencia.length > 0);
  if (falla) {
    const culpables = [...inconsistentes, ...(estricto ? conAdvertencia : [])];
    console.error(`\n❌ FAIL — desalineada(s): ${culpables.join(", ")}`);
      process.exit(1);
  }

  console.log(
    estricto
      ? "\n✅ PASS — todas las organizaciones tienen la arquitectura completa."
      : "\n✅ PASS — ninguna organización tiene un mecanismo CORE ausente."
  );
}

await main();
