/**
 * LABORATORIO de MALIA: su configuración REAL en una base desechable, con
 * `state_source='backend'` encendido.
 *
 * ## Por qué existe
 *
 * MALIA sería el primer negocio del CRM en correr `state_source='backend'`
 * junto con `delivery_source='tabla'`. Esa combinación no la usa nadie hoy y
 * no la cubría ningún test: el domicilio verificado se lee por caminos
 * distintos según la bandera (`pipeline.ts:1261`), y el que ella estrenaría
 * es el que nunca se ejercitó.
 *
 * Las pruebas unitarias cubren las costuras. Esto cubre lo otro: que con su
 * catálogo real, sus 353 zonas reales y su ficha real, el backend calcule lo
 * que tiene que calcular y rechace lo que tiene que rechazar.
 *
 * ## Qué hace
 *
 * 1. LEE de producción (solo SELECT) la organización, la ficha, el catálogo,
 *    los grupos de opciones y las zonas de MALIA.
 * 2. Los ESCRIBE en la base desechable, aplicando de paso lo que haría
 *    `migrar:malia` (requisito de dirección, mínimo, observaciones, reglas
 *    recortadas) y encendiendo `state_source='backend'`.
 *
 * Nunca escribe en producción. La base destino se pasa por `LAB_URL` y el
 * script se niega a arrancar si apunta al puerto de producción.
 *
 * Uso:  LAB_URL=postgresql://…:15434/vocero_lab pnpm lab:malia
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const PROD_PUERTO_PROHIBIDO = "15433";
const ORG = "org_kf1suh8q9dtbmcq3f3ba";

const labUrl = process.env.LAB_URL;
if (!labUrl) {
  console.error("[lab] falta LAB_URL");
  process.exit(1);
}
/*
 * El puerto 15433 es el túnel a PRODUCCIÓN (CLAUDE.md lo dice con esas
 * palabras). Un script que siembra datos no puede poder apuntar ahí, ni por
 * un despiste de copiar y pegar.
 */
if (labUrl.includes(PROD_PUERTO_PROHIBIDO) || labUrl.includes("172.16.1.1")) {
  console.error("[lab] ⛔ LAB_URL apunta a PRODUCCIÓN. Abortado.");
  process.exit(1);
}

function envVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    return readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim();
  } catch {
    return undefined;
  }
}
const prodUrl = envVar("DATABASE_URL")!.replace("localhost", "127.0.0.1");

const prod = postgres(prodUrl, { max: 1, onnotice: () => {} });
const lab = postgres(labUrl, { max: 1, onnotice: () => {} });

const [donde] = await lab`SELECT current_database() AS d`;
console.log(`[lab] destino: ${donde!.d} (desechable)`);
if (donde!.d === "vocero") {
  console.error("[lab] ⛔ la base destino se llama 'vocero'. Abortado.");
  process.exit(1);
}

// ── 1. Leer de producción, SOLO SELECT ──────────────────────────────────
const [org] = await prod`SELECT * FROM organization WHERE id = ${ORG}`;
const [perfil] = await prod`SELECT * FROM agent_profile WHERE organization_id = ${ORG}`;
const productos = await prod`SELECT * FROM product WHERE organization_id = ${ORG}`;
const grupos = await prod`SELECT * FROM product_option_group WHERE organization_id = ${ORG}`;
const opciones = await prod`SELECT * FROM product_option WHERE organization_id = ${ORG}`;
const zonas = await prod`SELECT * FROM delivery_zone WHERE organization_id = ${ORG}`;
await prod.end();
console.log(
  `[lab] leído de producción: ${productos.length} productos · ${grupos.length} grupos · ` +
    `${opciones.length} opciones · ${zonas.length} zonas`
);

// ── 2. La ficha, tal como la dejaría `migrar:malia` ─────────────────────
const ficha = JSON.parse(perfil!.ficha as string);
const MINIMO = 1800000;
ficha.observacionesHorario =
  "Nuestro punto del CC Chipichape tiene un horario distinto al de la planta: " +
  "lunes a jueves de 12:00 m a 8:00 pm, y viernes, sábados, domingos y festivos " +
  "de 12:30 pm a 8:30 pm. La planta de Nueva Tequendama atiende de 11:00 am a 7:00 pm.";
ficha.negocio.entrega.minimoDomicilioCents = MINIMO;
ficha.flujo.cierre = {
  ...(ficha.flujo.cierre ?? {}),
  requisitos: [
    {
      id: "direccion",
      tipo: "direccion",
      etiqueta: "la direccion de entrega",
      obligatorio: true,
      soloEnModalidades: ["domicilio"],
    },
    ...(ficha.flujo.cierre?.requisitos ?? []),
  ],
};
ficha.flujo.reglasPropias = [
  "Desde chipichape NO despachamos domicilios pero SI despachamos rappi.",
  ficha.flujo.reglasPropias[2],
  // Mismo texto exacto que produce `migrar-malia.ts`, incluida la frase de
  // cobertura que el dueño decidió conservar el 21-sep-2026. Si el laboratorio
  // usara otra redacción, estaría probando una ficha que no existe.
  "DOMICILIOS\n\nCuando el cliente pida domicilio, pídele la dirección CON el barrio: " +
    "el barrio es lo que nos deja calcular la tarifa.\n\n" +
    "Jamundí, Yumbo o Palmira: no tenemos cobertura. Indica de manera muy " +
    "amable que puede enviar a alguien a recoger el pedido o visitarnos en " +
    "nuestros puntos físicos.",
  "Actualmente no manejamos venta al por mayor; los pedidos grandes los cotiza una persona.",
  ficha.flujo.reglasPropias[5],
];

// ── 3. Escribir en el laboratorio ───────────────────────────────────────
await lab`DELETE FROM delivery_zone WHERE organization_id = ${ORG}`;
await lab`DELETE FROM product_option WHERE organization_id = ${ORG}`;
await lab`DELETE FROM product_option_group WHERE organization_id = ${ORG}`;
await lab`DELETE FROM product WHERE organization_id = ${ORG}`;
await lab`DELETE FROM agent_profile WHERE organization_id = ${ORG}`;
await lab`DELETE FROM organization WHERE id = ${ORG}`;

await lab`INSERT INTO organization ${lab(org as Record<string, unknown>)}`;
await lab`INSERT INTO agent_profile ${lab({
  ...(perfil as Record<string, unknown>),
  ficha: JSON.stringify(ficha),
  // LO QUE SE ESTÁ PROBANDO: la combinación inédita.
  state_source: "backend",
  delivery_source: "tabla",
  catalog_source: "tabla",
  payment_source: "ficha",
})}`;
for (const p of productos) await lab`INSERT INTO product ${lab(p as Record<string, unknown>)}`;
for (const g of grupos)
  await lab`INSERT INTO product_option_group ${lab(g as Record<string, unknown>)}`;
for (const o of opciones) await lab`INSERT INTO product_option ${lab(o as Record<string, unknown>)}`;
for (const z of zonas) await lab`INSERT INTO delivery_zone ${lab(z as Record<string, unknown>)}`;

const [comp] = await lab`SELECT
  (SELECT count(*) FROM product WHERE organization_id=${ORG} AND archived_at IS NULL AND available) AS productos_vivos,
  (SELECT count(*) FROM delivery_zone WHERE organization_id=${ORG} AND active) AS zonas_activas,
  (SELECT state_source FROM agent_profile WHERE organization_id=${ORG}) AS state_source,
  (SELECT delivery_source FROM agent_profile WHERE organization_id=${ORG}) AS delivery_source`;
console.log("[lab] sembrado:", JSON.stringify(comp));
await lab.end();
process.exit(0);
