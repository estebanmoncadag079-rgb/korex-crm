/**
 * Crea (o pone al dia) en produccion el rol de SOLO LECTURA del auditor H-2.
 *
 * ## Por que existe
 *
 * `DEPLOY_DB_URL` mete una credencial de base de datos dentro de GitHub
 * Actions. Si esa credencial es `postgres` —hoy el UNICO rol que puede
 * conectarse— cualquier compromiso de CI pasa de "puede leer dos tablas" a
 * "puede borrar las 91 tablas de todos los clientes". El auditor solo lee:
 * no necesita nada mas.
 *
 * ## Por que permisos POR COLUMNA y no por tabla
 *
 * `agent_profile` tiene 26 columnas y el auditor usa 13. Entre las otras 13
 * esta `notify_phones`: los telefonos del equipo del negocio. Un `GRANT
 * SELECT` sobre la tabla entera los expondria a quien tenga el secreto de
 * CI, sin que el auditor los necesite para nada.
 *
 * El coste: si algun dia el auditor lee una columna nueva, fallara con
 * "permission denied for table". Es el fallo correcto —ruidoso y en el
 * gate— y se arregla anadiendo la columna a COLUMNAS y re-ejecutando esto.
 *
 * ## Como se obtuvo la lista de columnas (y por que costo dos intentos)
 *
 * `auditar-arquitectura.ts` no importa sus dependencias arriba: las carga
 * con `await import(...)` a mitad de archivo. Un inventario que solo lea el
 * script se deja fuera `validarConfiguracionArquitectonica`
 * (`server/auth/arquitectura.ts`), que hace SU PROPIA consulta con otras 5
 * columnas. El arbol completo alcanzable es:
 *
 *   auditar-arquitectura.ts   -> organization(2) + agent_profile(8)
 *   auth/arquitectura.ts      -> agent_profile(5 mas)
 *   horario.ts                -> 0 consultas (funciones puras)
 *   horario-auditoria.ts      -> 0 consultas (funciones puras)
 *
 * Uso:
 *   pnpm crear:rol-auditor             -> SIMULACRO: hace todo y hace ROLLBACK
 *   pnpm crear:rol-auditor --aplicar   -> escribe de verdad (idempotente)
 *
 * ## Rollback
 *
 * **De una ampliación de permisos** (el caso normal: el rol ya existía y solo
 * se le añadieron columnas). Solo revoca lo añadido, el rol sigue vivo:
 *
 *   REVOKE SELECT (organization_id, name, price_cents, available, archived_at)
 *     ON public.product FROM korex_h2_auditor;
 *
 * **Del rol entero.** `DROP ROLE` a secas **NO funciona** —los GRANT son
 * dependencias y Postgres lo rechaza con *"cannot be dropped because some
 * objects depend on it"*—. Ensayado el 20-sep dentro de una transacción
 * deshecha; la secuencia que sí funciona es:
 *
 *   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM korex_h2_auditor;
 *   REVOKE ALL ON SCHEMA public            FROM korex_h2_auditor;
 *   REVOKE ALL ON DATABASE vocero          FROM korex_h2_auditor;
 *   DROP ROLE korex_h2_auditor;
 *
 * Es seguro: el rol no es propietario de ningún objeto ni pertenece a otro,
 * así que borrarlo no pierde un solo dato.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

const ROL = "korex_h2_auditor";
const BASE = "vocero";
const ENTREGA = join(homedir(), "korex-DEPLOY_DB_URL.txt");

/** Las columnas EXACTAS que lee el auditor. Ver la cabecera para el arbol. */
const COLUMNAS: Record<string, string[]> = {
  organization: ["id", "name"],
  agent_profile: [
    // auditar-arquitectura.ts
    "organization_id",
    "ficha",
    "instructions",
    "hours_days",
    "hours_open",
    "hours_close",
    "hours_open_sunday",
    "hours_close_sunday",
    // auth/arquitectura.ts -> validarConfiguracionArquitectonica
    "appointments_enabled",
    "catalog_source",
    "state_source",
    "payment_source",
    "consultas_verificadas_enabled",
  ],
  /*
   * Añadida el 21-sep-2026, después de que el despliegue se detuviera con
   * `permission denied for table product`.
   *
   * El auditor había estrenado una comprobación nueva —productos ofrecibles
   * sin precio— y nadie amplió este rol. En local y en el laboratorio se
   * corre como `postgres`, que es superusuario: ninguno de los dos podía
   * cazarlo. Solo lo cazó el gate, contra la base real y con el rol real,
   * que es exactamente para lo que existe.
   *
   * `tests/unit/rol-auditor-cubre-lo-que-lee.test.ts` impide que se repita.
   */
  product: ["organization_id", "name", "price_cents", "available", "archived_at"],
};

const aplicar = process.argv.includes("--aplicar");

function urlAdmin(): string {
  const env = readFileSync(".env", "utf8");
  const l = env.split(/\r?\n/).find((x) => x.startsWith("DATABASE_URL="));
  if (!l) throw new Error("no hay DATABASE_URL en .env");
  return l.slice("DATABASE_URL=".length).trim().replace("localhost", "127.0.0.1");
}
const P = (b: boolean) => (b ? "PASS" : "FAIL <<<");
const admin = postgres(urlAdmin(), { max: 1, onnotice: () => {} });

const yaExiste =
  (await admin`SELECT 1 FROM pg_roles WHERE rolname = ${ROL}`).length > 0;

// -- 1. Estado previo, para el registro ----------------------------------
console.log("-".repeat(72));
console.log("ESTADO ANTES DEL CAMBIO");
const antes = await admin`SELECT rolname, rolcanlogin, rolsuper FROM pg_roles
  WHERE rolname NOT LIKE 'pg\\_%' ORDER BY rolname`;
console.log(
  "  roles existentes:",
  antes.map((r) => `${r.rolname}${r.rolsuper ? " (superusuario)" : ""}`).join(", ")
);
console.log(`  base: ${BASE} | schema: public | RLS en las dos tablas: desactivada`);
console.log(`  ${ROL}: ${yaExiste ? "ya existe -> solo se ponen al dia los permisos" : "no existe -> se crea"}`);

// -- 2. Contrasena -------------------------------------------------------
// base64url = [A-Za-z0-9_-]: ningun caracter que rompa el parseo de la
// cadena de conexion (@ : / ? # % son justo los que si lo romperian).
let password = "";
if (!yaExiste) {
  password = randomBytes(33).toString("base64url");
  if (!/^[A-Za-z0-9_-]{40,}$/.test(password)) throw new Error("contrasena no segura para URL");
  console.log(`\n  contrasena generada: ${password.length} caracteres aleatorios (no se imprime)`);
} else if (existsSync(ENTREGA)) {
  // Se relee del archivo de entrega para poder VERIFICAR conectandose como
  // el rol. Nunca se imprime.
  const linea = readFileSync(ENTREGA, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("postgresql://"));
  if (linea) password = new URL(linea.trim()).password;
  console.log(`\n  contrasena: se reutiliza la del rol existente (releida del archivo de entrega)`);
}

// -- 3. Crear / poner al dia, dentro de una transaccion ------------------
console.log("\n" + "-".repeat(72));
console.log(aplicar ? "APLICANDO" : "SIMULACRO (todo se deshace con ROLLBACK al final)");

try {
  await admin.begin(async (tx) => {
    // Si `CREATE ROLE ... PASSWORD` fallara, `log_min_error_statement=error`
    // escribiria la sentencia ENTERA —contrasena incluida— en el log del
    // servidor. Estas tres lineas cierran esa puerta mientras dura el cambio.
    await tx.unsafe(`SET LOCAL log_statement = 'none'`);
    await tx.unsafe(`SET LOCAL log_min_duration_statement = -1`);
    await tx.unsafe(`SET LOCAL log_min_error_statement = 'panic'`);

    if (!yaExiste) {
      await tx.unsafe(
        `CREATE ROLE ${ROL} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ` +
          `NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 ` +
          `PASSWORD '${password}'`
      );
    }
    await tx.unsafe(`GRANT CONNECT ON DATABASE ${BASE} TO ${ROL}`);
    await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${ROL}`);
    for (const [t, cols] of Object.entries(COLUMNAS)) {
      await tx.unsafe(`GRANT SELECT (${cols.join(", ")}) ON public.${t} TO ${ROL}`);
    }
    console.log(
      `  ${yaExiste ? "permisos al dia" : "rol creado"} | CONNECT ${BASE} | USAGE public | ` +
        `SELECT sobre ${Object.values(COLUMNAS).flat().length} columnas de ${Object.keys(COLUMNAS).length} tablas`
    );

    let todo = true;
    for (const [t, cols] of Object.entries(COLUMNAS)) {
      for (const c of cols) {
        const [r] = await tx.unsafe(
          `SELECT has_column_privilege('${ROL}','public.${t}','${c}','SELECT') AS ok`
        );
        if (!r!.ok) {
          console.log(`  FALTA SELECT en ${t}.${c}`);
          todo = false;
        }
      }
    }
    console.log("  todas las columnas necesarias legibles:", P(todo));

    let limpio = true;
    for (const t of Object.keys(COLUMNAS)) {
      for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        const [r] = await tx.unsafe(`SELECT has_table_privilege('${ROL}','public.${t}','${p}') AS ok`);
        if (r!.ok) {
          console.log(`  TIENE ${p} sobre ${t} <<<`);
          limpio = false;
        }
      }
    }
    console.log("  sin ningun permiso de escritura:", P(limpio));
    const [cr] = await tx.unsafe(`SELECT has_schema_privilege('${ROL}','public','CREATE') AS ok`);
    console.log("  no puede crear objetos en public:", P(!cr!.ok));

    // Que NO se haya colado ninguna columna de mas en las dos tablas.
    let deMas = 0;
    for (const t of Object.keys(COLUMNAS)) {
      const cols = await tx.unsafe(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${t}'`
      );
      for (const c of cols) {
        const n = String(c.column_name);
        if (COLUMNAS[t]!.includes(n)) continue;
        const [r] = await tx.unsafe(
          `SELECT has_column_privilege('${ROL}','public.${t}','${n}','SELECT') AS ok`
        );
        if (r!.ok) {
          console.log(`  LEE DE MAS: ${t}.${n} <<<`);
          deMas++;
        }
      }
    }
    console.log("  ninguna columna concedida de mas:", P(deMas === 0));

    if (!todo || !limpio || cr!.ok || deMas > 0) throw new Error("verificacion previa fallida");
    if (!aplicar) throw new Error("__SIMULACRO__");
  });
} catch (e) {
  const m = (e as Error).message;
  if (!m.includes("__SIMULACRO__")) {
    /*
     * Fallo ANTES del COMMIT. `admin.begin` ya deshizo la transacción entera,
     * así que no hay cambios parciales: o entraron los cinco GRANT o no entró
     * ninguno. Aquí el `exit 1` es correcto — no se aplicó nada.
     */
    console.log(`\n[crear-rol-auditor] ABORTADO por ROLLBACK, nada se escribio: ${m}`);
    await admin.end();
    process.exit(1);
  }
}

if (!aplicar) {
  console.log("\n[crear-rol-auditor] SIMULACRO terminado: nada se escribio. Anade --aplicar.");
  await admin.end();
  process.exit(0);
}

/*
 * ── A PARTIR DE AQUÍ LOS PERMISOS YA ESTÁN EN LA BASE ─────────────────
 *
 * El COMMIT pasó. Nada de lo que venga después puede deshacerlo, y por eso
 * nada de lo que venga después debe salir con 1 "por si acaso": un código de
 * salida que dice "falló" cuando el cambio SÍ se aplicó es peor que no
 * tenerlo, porque invita a re-ejecutar o a dar por bueno un rollback que
 * nadie hizo.
 *
 * El incidente que lo pide (21-sep-2026): con la contraseña ya borrada del
 * disco —lo correcto, se borra al pegarla en GitHub—, este script aplicaba
 * los GRANT, los comprometía, y acto seguido salía con 1 porque no podía
 * reconectarse como el rol para la verificación posterior. El cambio real
 * quedaba hecho y reportado como fallo.
 *
 * Desde aquí el código de salida responde a UNA sola pregunta: **¿los
 * permisos quedaron mal?** No a "¿pude verificarlo todo?".
 */
console.log("\n" + "=".repeat(72));
console.log("PERMISOS APLICADOS Y COMPROMETIDOS (COMMIT hecho).");
console.log(`  ${Object.values(COLUMNAS).flat().length} columnas de SELECT sobre ${Object.keys(COLUMNAS).length} tablas: ${Object.keys(COLUMNAS).join(", ")}`);
console.log("  Esto ya NO se deshace solo. Rollback: ver la cabecera de este archivo.");
console.log("=".repeat(72));

/** La consulta que comprueba el estado ya comprometido, sin necesitar la contraseña. */
const VERIFICACION_EXTERNA =
  `ssh -i ~/.ssh/churrabot_key root@2.25.159.117 "docker exec -i korex-crm-postgres-1 ` +
  `psql -U postgres -d vocero -qc \\"SELECT table_name, count(*) FROM ` +
  `information_schema.column_privileges WHERE grantee='${ROL}' GROUP BY 1 ORDER BY 1\\""`;

if (!password) {
  /*
   * No es un fallo: es lo NORMAL cuando el rol ya existía y su contraseña se
   * borró del disco al pegarla en GitHub. Los permisos están puestos; lo
   * único que no se puede hacer es la verificación negativa conectándose
   * como el rol, que necesita autenticarse.
   */
  console.log("\n⚠️  VERIFICACIÓN POSTERIOR PENDIENTE — y esto NO es un fallo.");
  console.log("   Los permisos de arriba están aplicados. Lo que no se pudo hacer es");
  console.log("   reconectarse COMO el rol para las pruebas negativas, porque su");
  console.log("   contraseña no está en disco (se borra al pegarla en GitHub: correcto).");
  console.log("\n   Verifícalo desde fuera, que además lee el estado ya comprometido:\n");
  console.log(`   ${VERIFICACION_EXTERNA}\n`);
  console.log("   Debe listar exactamente:");
  for (const [t, cols] of Object.entries(COLUMNAS)) console.log(`     ${t}: ${cols.length}`);
  console.log("\n[crear-rol-auditor] terminado con exito (codigo 0).");
  await admin.end();
  process.exit(0);
}

// -- 4. Verificacion real: conectarse COMO el rol nuevo ------------------
const u = new URL(urlAdmin());
u.username = ROL;
u.password = password;
const urlAuditor = u.toString();

console.log("\n" + "-".repeat(72));
console.log("VERIFICACION CONECTADO COMO EL ROL NUEVO");
const ro = postgres(urlAuditor, { max: 1, onnotice: () => {} });
const [quien] = await ro`SELECT current_user AS u, current_database() AS d`;
console.log(`  conecta: PASS (${quien!.u} -> ${quien!.d})`);

const [atr] = await ro`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication,
  rolbypassrls, rolcanlogin, rolconnlimit FROM pg_roles WHERE rolname = current_user`;
console.log("  LOGIN:", P(atr!.rolcanlogin === true));
console.log("  SUPERUSER false:", P(atr!.rolsuper === false));
console.log("  CREATEDB false:", P(atr!.rolcreatedb === false));
console.log("  CREATEROLE false:", P(atr!.rolcreaterole === false));
console.log("  REPLICATION false:", P(atr!.rolreplication === false));
console.log("  BYPASSRLS false:", P(atr!.rolbypassrls === false));
console.log("  limite de conexiones:", atr!.rolconnlimit);

console.log("\n  LECTURAS QUE EL AUDITOR NECESITA:");
const [o] = await ro`SELECT count(*)::int AS n FROM (SELECT id, name FROM organization) x`;
console.log("    SELECT organization: PASS", `(${o!.n} filas)`);
const [ap] = await ro.unsafe(
  `SELECT count(*)::int AS n FROM (SELECT ${COLUMNAS.agent_profile!.join(", ")} FROM agent_profile) x`
);
console.log("    SELECT agent_profile: PASS", `(${ap!.n} filas, ${COLUMNAS.agent_profile!.length} columnas)`);

console.log("\n  VERIFICACION NEGATIVA (todo esto DEBE fallar):");
const denegado = async (etiqueta: string, sentencia: string, enTransaccion = true) => {
  try {
    if (enTransaccion) {
      await ro.begin(async (tx) => {
        await tx.unsafe(sentencia);
        throw new Error("__DESHACER__");
      });
    } else {
      await ro.unsafe(sentencia);
    }
    console.log(`    ${etiqueta}: PERMITIDO <<<`);
    return false;
  } catch (e) {
    const m = (e as Error).message;
    if (m.includes("__DESHACER__")) {
      console.log(`    ${etiqueta}: PERMITIDO (deshecho) <<<`);
      return false;
    }
    console.log(`    ${etiqueta}: DENEGADA - ${m.split("\n")[0]!.slice(0, 64)}`);
    return true;
  }
};
const neg: boolean[] = [];
neg.push(
  await denegado(
    "INSERT",
    `INSERT INTO organization (id, name, slug, created_at) VALUES ('zz','zz','zz',now())`
  )
);
neg.push(await denegado("UPDATE", `UPDATE agent_profile SET instructions = instructions WHERE false`));
neg.push(await denegado("DELETE", `DELETE FROM organization WHERE false`));
neg.push(await denegado("TRUNCATE", `TRUNCATE organization`));
neg.push(await denegado("DDL: ALTER TABLE", `ALTER TABLE organization ADD COLUMN zz text`));
neg.push(await denegado("DDL: CREATE TABLE", `CREATE TABLE zz_prueba (a int)`));
neg.push(await denegado("DDL: DROP TABLE", `DROP TABLE agent_profile`));
neg.push(await denegado("CREATE ROLE", `CREATE ROLE zz_prueba`));
// Fuera de transaccion: dentro, Postgres rechaza por sintaxis y no llega a
// comprobar el permiso, que es justo lo que queremos demostrar.
neg.push(await denegado("CREATE DATABASE", `CREATE DATABASE zz_prueba`, false));
neg.push(await denegado("columna no concedida (notify_phones)", `SELECT notify_phones FROM agent_profile`));
neg.push(await denegado("columna no concedida (metadata)", `SELECT metadata FROM organization`));
neg.push(await denegado("tabla ajena (contact)", `SELECT * FROM contact LIMIT 1`));
await ro.end();

// Red de seguridad: que ninguna de las pruebas negativas haya dejado rastro.
const rastro = await admin`SELECT datname FROM pg_database WHERE datname = 'zz_prueba'`;
const rastroRol = await admin`SELECT rolname FROM pg_roles WHERE rolname = 'zz_prueba'`;
const rastroTabla = await admin`SELECT tablename FROM pg_tables WHERE tablename = 'zz_prueba'`;
const sinRastro = rastro.length === 0 && rastroRol.length === 0 && rastroTabla.length === 0;
console.log("\n  sin rastro de las pruebas (base/rol/tabla zz_prueba):", P(sinRastro));

// -- 5. El auditor real, con esa credencial ------------------------------
console.log("\n" + "-".repeat(72));
console.log("AUDITOR H-2 REAL CON LA CREDENCIAL NUEVA");
const r = spawnSync("npx", ["tsx", "scripts/auditar-arquitectura.ts"], {
  env: { ...process.env, DATABASE_URL: urlAuditor },
  encoding: "utf8",
  shell: true,
});
const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
console.log(
  salida
    .split("\n")
    .filter((l) => /BLOQUEADORES|DECISIONES|OBSERVACIONES|NO EVALUABLES|PASS|denied|Error/.test(l))
    .slice(-8)
    .join("\n")
);
console.log("  codigo de salida:", r.status);

/*
 * El auditor puede salir con 1 por DOS razones muy distintas, y confundirlas
 * es el mismo error de arriba con otro disfraz:
 *
 *   a) `permission denied` → los permisos quedaron mal. ES cosa de este
 *      script, y tiene que salir con 1.
 *   b) encontró una incoherencia en los DATOS de algún negocio → los
 *      permisos están perfectos y el auditor hizo su trabajo. No es cosa de
 *      este script: se avisa y se sale con 0.
 *
 * Sin esta distinción, conceder permisos correctamente sobre una base que
 * tuviera un bloqueador se reportaría como "falló el GRANT".
 */
const faltaPermiso = /permission denied/i.test(salida);
if (r.status !== 0 && !faltaPermiso) {
  console.log("\n  ⚠️  el auditor salio con " + r.status + ", pero NO por permisos:");
  console.log("     encontro algo en los DATOS. Los permisos de este script estan bien;");
  console.log("     lo que reporte el auditor se atiende aparte.");
}

// -- 6. Entrega de la credencial, fuera del repositorio ------------------
writeFileSync(
  ENTREGA,
  `DEPLOY_DB_URL para GitHub (Environment: production)\r\n` +
    `Pega la linea de abajo COMPLETA en el campo Value y luego BORRA este archivo.\r\n\r\n` +
    `${urlAuditor}\r\n`,
  "utf8"
);
console.log("\n" + "-".repeat(72));
console.log(`CREDENCIAL ENTREGADA EN: ${ENTREGA}`);
console.log("  (fuera del repositorio | borralo en cuanto lo pegues en GitHub)");

/*
 * El código de salida responde SOLO a "¿los permisos quedaron mal?":
 *
 *   - alguna prueba negativa PASÓ (el rol puede escribir)   → sí, exit 1
 *   - quedó rastro de las pruebas                            → sí, exit 1
 *   - el auditor se quejó de `permission denied`             → sí, exit 1
 *   - el auditor encontró una incoherencia de datos          → NO, exit 0
 *
 * Los GRANT ya están comprometidos pase lo que pase aquí: un exit 1 en este
 * punto significa "revisa los permisos", nunca "no se aplicó nada".
 */
const permisosMal = !neg.every(Boolean) || !sinRastro || faltaPermiso;
console.log(
  "\n" +
    (permisosMal
      ? "REVISAR LOS PERMISOS: algo no cuadra arriba. Los GRANT SÍ están aplicados."
      : "OK: permisos aplicados, verificados y probados.")
);
await admin.end();
process.exit(permisosMal ? 1 : 0);
