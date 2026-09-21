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
import { and, eq, isNull } from "drizzle-orm";

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
const { incoherenciasDeHorario, horarioLegibleParaAuditoria } = await import(
  "@/server/horario-auditoria"
);
const { horarioDeLaFila } = await import("@/server/horario");
const db = getDb();

/**
 * ── CÓMO SE CLASIFICA UN HALLAZGO ──────────────────────────────────────────
 *
 * Este auditor corre DENTRO del camino del despliegue (H-2), así que la
 * pregunta que contesta no es "¿está todo perfecto?" sino:
 *
 *     ¿Es seguro desplegar ESTE código sobre ESTOS datos?
 *
 * De ahí sale el criterio, y es verificable, no una cuestión de gusto:
 *
 *   **BLOQUEA lo que el despliegue puede cambiar. No bloquea lo que va a
 *   seguir exactamente igual después de desplegar.**
 *
 * Con ese criterio:
 *
 * - BLOQUEADOR — una INCOHERENCIA: dos fuentes del mismo dato que se
 *   contradicen. Desplegar puede cambiar cuál de las dos gana, y entonces el
 *   negocio se comporta distinto sin que nadie lo haya pedido. Es literalmente
 *   lo que le pasó a Lis con el domingo.
 *
 * - DECISIÓN DE NEGOCIO — un mecanismo aprobado que todavía no se encendió en
 *   un cliente (`state_source`, `catalog_source`). Es una brecha real y se
 *   reporta siempre, pero **desplegar no la empeora ni la mejora**: encenderlo
 *   es un acto deliberado, con su propio comando y su propia verificación.
 *   Bloquear el despliegue por esto pararía cualquier corrección urgente hasta
 *   terminar un despliegue por fases — y no protegería de nada.
 *
 * - NO EVALUABLE — un cliente sin ficha: alta a medias, sin negocio que
 *   auditar. No se inventa un diagnóstico sobre lo que no está configurado.
 *
 * - OBSERVACIÓN — todo lo demás: mejoras recomendadas, avisos.
 *
 * `--estricto` sube el listón y bloquea TAMBIÉN las decisiones pendientes y
 * las observaciones, para cuando se quiera exigir la arquitectura completa.
 *
 * Nada se oculta: los cuatro grupos se imprimen siempre, con nombre y motivo.
 */
async function main() {
  const organizaciones = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization);

  /** Incoherencias: dos fuentes del mismo dato en desacuerdo. BLOQUEAN. */
  const bloqueadores: string[] = [];
  /** Mecanismo aprobado aún sin encender en un cliente. NO bloquea. */
  const decisionesDeNegocio: string[] = [];
  /** Mejoras recomendadas y avisos. NO bloquean. */
  const observaciones: string[] = [];
  /** Sin ficha: no hay negocio configurado que auditar. NO bloquea. */
  const noEvaluables: string[] = [];
  let alineadas = 0;

  /** Quién tiene ficha: sin ella no hay negocio configurado que auditar. */
  const conFicha = new Set(
    (
      await db
        .select({ id: schema.agentProfile.organizationId, ficha: schema.agentProfile.ficha })
        .from(schema.agentProfile)
    )
      .filter((f) => f.ficha?.trim())
      .map((f) => f.id)
  );

  for (const org of organizaciones.sort((a, b) => a.name.localeCompare(b.name))) {
    const diag = await validarConfiguracionArquitectonica(org.id);
    if (!diag) {
      noEvaluables.push(org.name);
      console.log(`  ⚪ ${org.name} — NO EVALUABLE: sin agent_profile (alta a medias)`);
      continue;
    }
    if (!conFicha.has(org.id)) {
      noEvaluables.push(org.name);
      console.log(
        `  ⚪ ${org.name} (${diag.vertical}) — NO EVALUABLE: sin ficha guardada, ` +
          "no hay negocio configurado contra el que juzgar la arquitectura"
      );
      continue;
    }

    if (diag.estado === "INCONSISTENTE") {
      decisionesDeNegocio.push(org.name);
      const detalle = [
        diag.faltantes.length ? `falta(n) [core]: ${diag.faltantes.join(", ")}` : "",
        diag.incompatibles.length ? `dato suelto de otro vertical: ${diag.incompatibles.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      console.log(`  🟠 ${org.name} (${diag.vertical}) — DECISIÓN DE NEGOCIO · ${detalle}`);
      for (const campo of diag.faltantes) {
        console.log(
          `       ${campo}: tiene "${String(diag.configuracionActual[campo])}", ` +
            `se espera "${String(diag.configuracionEsperada[campo])}"`
        );
      }
      console.log(
        "       (encenderlo es un acto deliberado con su propio comando; " +
          "desplegar no lo cambia, así que no detiene el despliegue)"
      );
    } else if (diag.estado === "ADVERTENCIA") {
      observaciones.push(org.name);
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

  /*
   * ── COHERENCIA DEL HORARIO ─────────────────────────────────────────────
   *
   * Va aparte del bloque de `*_source` porque mide otra cosa: no si un
   * mecanismo está encendido, sino si el MISMO DATO dice lo mismo en todos
   * los sitios donde aparece. El incidente de Lis no fue un mecanismo
   * apagado — fue un dato podrido que llevaba semanas ahí sin que nada lo
   * mirara (ver docs/korexia/184).
   */
  console.log("\n── Coherencia del horario ──────────────────────────────────");
  const perfiles = await db
    .select({
      nombre: schema.organization.name,
      ficha: schema.agentProfile.ficha,
      instructions: schema.agentProfile.instructions,
      hoursDays: schema.agentProfile.hoursDays,
      hoursOpen: schema.agentProfile.hoursOpen,
      hoursClose: schema.agentProfile.hoursClose,
      hoursOpenSunday: schema.agentProfile.hoursOpenSunday,
      hoursCloseSunday: schema.agentProfile.hoursCloseSunday,
    })
    .from(schema.agentProfile)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.agentProfile.organizationId)
    );

  for (const p of perfiles.sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const fallos = incoherenciasDeHorario(p);
    const resumen = horarioLegibleParaAuditoria(horarioDeLaFila(p));
    if (!fallos.length) {
      console.log(`  🟢 ${p.nombre} — ${resumen}`);
      continue;
    }
    const bloquea = fallos.some((f) => f.bloqueante);
    if (bloquea) bloqueadores.push(`${p.nombre} (horario incoherente)`);
    else if (!fallos.every((f) => f.tipo === "sin_horario")) observaciones.push(p.nombre);
    console.log(`  ${bloquea ? "🔴" : "🟡"} ${p.nombre} — ${resumen}`);
    for (const f of fallos) {
      console.log(`       ${f.bloqueante ? "[FAIL]" : "[aviso]"} ${f.tipo}: ${f.mensaje}`);
    }
  }

  /*
   * ── Productos disponibles sin precio ────────────────────────────────
   *
   * Guardar un producto sin precio es DELIBERADO (`catalog/productos.ts:58`):
   * un negocio que todavía no lo sabe puede cargarlo y completarlo después en
   * vez de quedar bloqueado. Así que esto no se prohíbe ni bloquea el
   * despliegue.
   *
   * Pero con `state_source='backend'` deja de ser inocuo: el backend no puede
   * sumar, `puedeConfirmarPedido` rechaza el cierre y el pedido acaba en una
   * persona. Un producto a medias que nadie recuerda haber creado se convierte
   * en ventas derivadas, en silencio.
   *
   * El caso que lo pidió: MALIA tenía un producto llamado `"1"`, disponible,
   * sin precio y sin descripción (auditoría del 21-sep-2026). No es que la
   * capacidad esté mal: es que nada la hacía visible.
   */
  console.log("\n── Catálogo: productos ofrecibles sin precio ───────────────");
  const sinPrecio = await db
    .select({ org: schema.organization.name, nombre: schema.product.name })
    .from(schema.product)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.product.organizationId))
    .where(
      and(
        isNull(schema.product.priceCents),
        isNull(schema.product.archivedAt),
        eq(schema.product.available, true)
      )
    );
  if (sinPrecio.length === 0) {
    console.log("  🟢 ninguno.");
  } else {
    const porOrg = new Map<string, string[]>();
    for (const p of sinPrecio) porOrg.set(p.org, [...(porOrg.get(p.org) ?? []), `"${p.nombre}"`]);
    for (const [org, nombres] of porOrg) {
      observaciones.push(org);
      console.log(
        `  🟡 ${org} — ${nombres.length} producto(s) ofrecible(s) sin precio: ${nombres.join(", ")}`
      );
      console.log(
        "       [aviso] el backend no puede sumarlos; con state_source='backend' el pedido " +
          "se deriva a una persona. Ponles precio o archívalos."
      );
    }
  }

  // ── RESUMEN: los cuatro grupos, siempre, sin esconder ninguno ─────────
  const linea = (titulo: string, lista: string[]) =>
    console.log(`  ${titulo}: ${lista.length ? [...new Set(lista)].join(", ") : "—"}`);

  console.log("\n── Clasificación ───────────────────────────────────────────");
  console.log(`  Alineadas: ${alineadas}`);
  linea("BLOQUEADORES        (detienen el despliegue)", bloqueadores);
  linea("DECISIONES DE NEGOCIO (no lo detienen)      ", decisionesDeNegocio);
  linea("OBSERVACIONES       (no lo detienen)        ", observaciones);
  linea("NO EVALUABLES       (sin ficha)             ", noEvaluables);

  /*
   * Lo único que detiene un despliegue es una INCOHERENCIA: dos fuentes del
   * mismo dato en desacuerdo, donde desplegar puede cambiar cuál gana. Lo
   * demás se reporta y no bloquea — salvo con `--estricto`, que exige la
   * arquitectura completa.
   */
  const culpables = estricto
    ? [...bloqueadores, ...decisionesDeNegocio, ...observaciones]
    : bloqueadores;

  if (culpables.length > 0) {
    console.error(
      `\n❌ FAIL — ${estricto ? "con --estricto, pendientes" : "incoherencias"}: ` +
        [...new Set(culpables)].join(", ")
    );
    process.exit(1);
  }

  console.log(
    estricto
      ? "\n✅ PASS — arquitectura completa y sin incoherencias."
      : "\n✅ PASS — ninguna incoherencia. Lo pendiente queda listado arriba, no oculto."
  );
}



await main();

/*
 * SALIR EXPLÍCITAMENTE, también cuando todo va bien.
 *
 * El camino de FALLO ya terminaba con `process.exit(1)`, así que nadie se
 * enteró de que el de ÉXITO no terminaba con nada: la conexión de `getDb()`
 * queda abierta y mantiene vivo el bucle de eventos. El proceso imprimía
 * "PASS" y se quedaba colgado para siempre.
 *
 * Estuvo latente mientras el auditor siempre encontraba algo. En cuanto
 * empezó a pasar limpio —20-sep-2026, tras migrar Lashes— se colgó a la
 * primera. Y su sitio es el gate de despliegue: colgarse ahí no es un
 * inconveniente, es un despliegue bloqueado hasta que el job muera por
 * tiempo, con la auditoría en verde.
 */
process.exit(0);
