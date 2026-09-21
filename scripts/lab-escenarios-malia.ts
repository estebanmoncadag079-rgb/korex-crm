/**
 * LABORATORIO · los escenarios de MALIA con `state_source='backend'` y
 * `delivery_source='tabla'`, contra Postgres de verdad.
 *
 * Corre las funciones REALES del backend —el mismo `normalizarPedido`, el
 * mismo `resolverZonaDeEntrega`, la misma `puedeConfirmarPedido`, la misma
 * persistencia con su token de concurrencia— sobre el catálogo, las 353 zonas
 * y la ficha reales de MALIA, copiados a una base desechable por
 * `scripts/lab-malia.ts`.
 *
 * No hay LLM: el modelo aquí es una constante. Lo que se prueba no es si el
 * modelo acierta, sino si el backend decide bien **pase lo que pase** con lo
 * que el modelo proponga — que es justo lo que significa "backend como
 * autoridad".
 *
 * Nunca toca producción: se niega a arrancar si `LAB_URL` huele a producción.
 *
 * Uso:  LAB_URL=postgresql://…:15434/vocero_lab pnpm lab:escenarios
 */
import postgres from "postgres";

const ORG = "org_kf1suh8q9dtbmcq3f3ba";
const labUrl = process.env.LAB_URL;
if (!labUrl || labUrl.includes("15433") || labUrl.includes("172.16.1.1")) {
  console.error("[lab] ⛔ LAB_URL ausente o apuntando a producción.");
  process.exit(1);
}
process.env.DATABASE_URL = labUrl;
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "lab-desechable-no-es-un-secreto-real";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN ??= "lab-desechable-no-es-un-secreto-real";

const { getDb, schema } = await import("@/lib/db");
const { eq } = await import("drizzle-orm");
const { catalogoDe } = await import("@/server/catalog/queries");
const { normalizarPedido } = await import("@/server/orders/normalizar");
const { resolverZonaDeEntrega, zonasDeEntregaQuery } = await import("@/server/delivery/zonas");
const { guardarEstado, leerEstado, borrarEstado, estadoVacio } = await import(
  "@/server/orders/estado"
);
const { puedeConfirmarPedido } = await import("@/server/orders/policy");
const { comoTexto } = await import("@/server/orders/extraer");
const { requisitosDe } = await import("@/server/ai/generador/ficha");
const { leerFicha } = await import("@/server/ai/generador/leer-ficha");
const { MODALIDAD_DOMICILIO, MODALIDAD_RECOGIDA } = await import("@/server/ai/generador/ficha");

type Ficha = import("@/server/ai/generador/ficha").FichaDelNegocio;
type Estado = import("@/server/orders/estado").EstadoDelPedido;

const db = getDb();
const sql = postgres(labUrl, { max: 1, onnotice: () => {} });

let pasan = 0;
let fallan = 0;
const fallos: string[] = [];
function comprobar(etiqueta: string, ok: boolean, detalle = "") {
  if (ok) {
    pasan++;
    console.log(`   ✅ ${etiqueta}${detalle ? ` — ${detalle}` : ""}`);
  } else {
    fallan++;
    fallos.push(etiqueta);
    console.log(`   ❌ ${etiqueta}${detalle ? ` — ${detalle}` : ""}`);
  }
}
const pesos = (c: number | null) => (c === null ? "—" : `$${(c / 100).toLocaleString("es-CO")}`);

// ── Contexto real, leído del laboratorio ────────────────────────────────
const [perfil] = await db
  .select()
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, ORG));
const ficha = leerFicha(perfil!.ficha) as Ficha;
const catalogo = await catalogoDe(ORG, "pedidos");
const zonas = await zonasDeEntregaQuery(ORG);
const minimo = ficha.entrega?.minimoDomicilioCents;

console.log("═".repeat(74));
console.log("LABORATORIO · MALIA con state_source=backend + delivery_source=tabla");
console.log("═".repeat(74));
console.log(`state_source=${perfil!.stateSource} · delivery_source=${perfil!.deliverySource} · ` +
  `catalog=${perfil!.catalogSource} · payment=${perfil!.paymentSource}`);
console.log(`catálogo vivo: ${catalogo.length} productos · zonas: ${zonas.length} · mínimo: ${pesos(minimo ?? null)}`);
console.log(`productos: ${catalogo.map((p) => `${p.nombre} ${pesos(p.precioCents)}`).join(" · ")}`);

// Una conversación real en la base, para ejercitar la persistencia de verdad.
const CONV = "cv_lab_malia";
const CONTACT = "ct_lab_malia";
await sql`DELETE FROM conversation_state WHERE conversation_id = ${CONV}`;
await sql`DELETE FROM conversation WHERE id = ${CONV}`;
await sql`DELETE FROM contact WHERE id = ${CONTACT}`;
await sql`INSERT INTO contact (id, organization_id, phone, name, created_at, updated_at)
  VALUES (${CONTACT}, ${ORG}, '573000000000', 'Cliente de laboratorio', now(), now())`;
await sql`INSERT INTO conversation (id, organization_id, contact_id, created_at, updated_at)
  VALUES (${CONV}, ${ORG}, ${CONTACT}, now(), now())`;

const juzgar = (estado: Estado | null, requisitos = requisitosDe(ficha, { modalidadDeEntrega: estado?.modalidadDeEntrega ?? null })) =>
  puedeConfirmarPedido({
    conversationId: CONV,
    productosDelPedido: catalogo,
    history: [],
    estadoGuardado: estado,
    requisitos,
    ...(minimo ? { minimoDomicilioCents: minimo } : {}),
  });

/** Lo que el modelo "propone", resuelto por el backend contra el catálogo real. */
function resolver(items: { ofrecible: string; cantidad: number; seleccion?: [string, string][] }[]) {
  return normalizarPedido(
    {
      items: items.map((i) => ({
        ofrecible: i.ofrecible,
        cantidad: i.cantidad,
        // El modelo propone nombres sueltos; el backend los resuelve contra
        // el catálogo real y decide de qué grupo es cada uno.
        opciones: (i.seleccion ?? []).map(([grupo, opcion]) => ({ grupo, opcion })),
      })),
      datos: {},
      paso: "lab",
      confirmado: false,
    } as never,
    catalogo,
    undefined,
    requisitosDe(ficha)
  );
}

// ═══ 1 · CATÁLOGO Y CIFRAS ══════════════════════════════════════════════
console.log("\n── 1 · El backend calcula las cifras, no el modelo ──────────");
{
  const r = resolver([{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, seleccion: [["Sabores", "Arequipe"]] }]);
  comprobar("1 pavé 8 oz → $10.000", r.estado.totalCents === 1000000, pesos(r.estado.totalCents));

  const dos = resolver([{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 2, seleccion: [["Sabores", "Arequipe"]] }]);
  comprobar("2 pavés 8 oz → $20.000", dos.estado.totalCents === 2000000, pesos(dos.estado.totalCents));

  const grande = resolver([{ ofrecible: "Pavé Cremoso 16 oz", cantidad: 1, seleccion: [["Sabores", "Milo"]] }]);
  comprobar("1 pavé 16 oz → $18.000", grande.estado.totalCents === 1800000, pesos(grande.estado.totalCents));

  const conTopping = resolver([
    { ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, seleccion: [["Sabores", "Arequipe"], ["Toppings", "Oreo"]] },
  ]);
  comprobar(
    "1 pavé 8 oz + topping Oreo (+$2.000) → $12.000",
    conTopping.estado.totalCents === 1200000,
    pesos(conTopping.estado.totalCents)
  );

  const mentira = resolver([{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 20, seleccion: [["Sabores", "Arequipe"]] }]);
  comprobar(
    "20 pavés → $200.000 del catálogo, NO los $160.000 del mayorista en prosa",
    mentira.estado.totalCents === 20000000,
    pesos(mentira.estado.totalCents)
  );

  /*
   * Descubierto EN el laboratorio: cuatro nombres de opción de MALIA existen
   * en los DOS grupos del mismo producto (Arequipe, Milo, Leche Klim y
   * Maracuyá son sabor Y topping). El backend no adivina: lo declara como
   * duda y hace que el agente pregunte. Es la conducta correcta, y conviene
   * fijarla porque en su catálogo va a pasar muy a menudo.
   */
  const ambigua = normalizarPedido(
    { items: [{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 1, opciones: [{ opcion: "Arequipe" }] }],
      datos: {}, paso: "lab", confirmado: false } as never,
    catalogo, undefined, []
  );
  comprobar(
    "'Arequipe' sin decir el grupo → el backend PREGUNTA en vez de adivinar",
    ambigua.estado.totalCents === null &&
      ambigua.dudas.some((d) => d.porque.includes("2 grupos")),
    ambigua.dudas.map((d) => d.campo).join(", ")
  );

  const fantasma = resolver([{ ofrecible: "Pavé de pistacho", cantidad: 1 }]);
  comprobar(
    "producto inexistente → no inventa precio",
    fantasma.estado.totalCents === null && fantasma.dudas.length > 0,
    `dudas: ${fantasma.dudas.map((d) => d.campo).join(", ")}`
  );
}

// ═══ 2 · ZONAS REALES ═══════════════════════════════════════════════════
console.log("\n── 2 · La tarifa sale de la tabla de 353 zonas ──────────────");
{
  const omar = resolverZonaDeEntrega(zonas, "Omar Torrijos");
  comprobar(
    "zona real 'Omar Torrijos' → $10.000",
    omar.status === "found" && omar.zona.feeCents === 1000000,
    omar.status === "found" ? pesos(omar.zona.feeCents) : omar.status
  );
  const menga = resolverZonaDeEntrega(zonas, "Altos de Menga");
  comprobar(
    "zona real 'Altos de Menga' → $12.000 (tarifa distinta)",
    menga.status === "found" && menga.zona.feeCents === 1200000,
    menga.status === "found" ? pesos(menga.zona.feeCents) : menga.status
  );
  for (const fuera of ["Jamundí", "Yumbo", "Palmira"]) {
    const r = resolverZonaDeEntrega(zonas, fuera);
    comprobar(`'${fuera}' sin cobertura → no se inventa tarifa`, r.status !== "found", r.status);
  }
}

// ═══ 3 · DOMICILIO vs RECOGIDA · requisito de dirección ═════════════════
console.log("\n── 3 · La dirección: obligatoria en domicilio, NO en recogida ─");
{
  // `requisitosDe` devuelve `undefined` cuando la ficha no declara
  // `cierre.requisitos`. MALIA sí los declara, pero hacerle `.map()` directo
  // dejaba el laboratorio a un `undefined` de reventar con otra ficha.
  const enDom = (requisitosDe(ficha, { modalidadDeEntrega: MODALIDAD_DOMICILIO }) ?? []).map((r) => r.id);
  const enRec = (requisitosDe(ficha, { modalidadDeEntrega: MODALIDAD_RECOGIDA }) ?? []).map((r) => r.id);
  comprobar("domicilio exige direccion", enDom.includes("direccion"), enDom.join(", "));
  comprobar("recogida NO exige direccion", !enRec.includes("direccion"), enRec.join(", "));
  comprobar("los dos exigen nombre y teléfono", enRec.includes("nombre") && enRec.includes("telefono"));
}

// ═══ 4 · EL MÍNIMO DE $18.000 ═══════════════════════════════════════════
console.log("\n── 4 · El pedido mínimo de domicilio ────────────────────────");
{
  const base = (totalCents: number, modalidad: string, entrega: unknown = null): Estado => ({
    ...estadoVacio(),
    items: [
      { ofrecible: { id: catalogo[0]!.id, nombre: catalogo[0]!.nombre }, cantidad: 1, seleccion: [], totalCents },
    ],
    totalCents,
    modalidadDeEntrega: modalidad,
    entrega: entrega as never,
    datos: { nombre: "Ana", telefono: "3001234567", direccion: "Calle 1 #2-3, Omar Torrijos" },
    confirmado: true,
  });
  const zonaOmar = {
    tipo: "domicilio", zonaId: "z", zonaNombre: "Omar Torrijos", feeCents: 1000000,
    verificadoEnMensajeId: "m", verificadoEn: new Date().toISOString(),
  };

  const uno = await juzgar(base(1000000, MODALIDAD_DOMICILIO, zonaOmar));
  comprobar(
    "1 pavé 8 oz a domicilio ($10.000) → RECHAZADO",
    !uno.ok && (uno as { motivo: string }).motivo.includes("mínimo"),
    uno.ok ? "lo dejó pasar" : (uno as { motivo: string }).motivo
  );

  const dieciocho = await juzgar(base(1800000, MODALIDAD_DOMICILIO, zonaOmar));
  comprobar("1 pavé 16 oz ($18.000) iguala el mínimo → ACEPTADO", dieciocho.ok);

  const veinte = await juzgar(base(2000000, MODALIDAD_DOMICILIO, zonaOmar));
  comprobar("2 pavés 8 oz ($20.000) → ACEPTADO", veinte.ok);

  const recogida = await juzgar(base(1000000, MODALIDAD_RECOGIDA));
  comprobar("1 pavé 8 oz PARA RECOGER ($10.000) → ACEPTADO, el mínimo no aplica", recogida.ok);

  // La trampa que importa: la tarifa NO puede ayudar a alcanzar el mínimo.
  const conTarifa = await juzgar(base(1000000, MODALIDAD_DOMICILIO, zonaOmar));
  comprobar(
    "$10.000 de producto + $10.000 de tarifa NO alcanzan los $18.000",
    !conTarifa.ok,
    conTarifa.ok ? "🔴 la tarifa contó para el mínimo" : "la tarifa no cuenta"
  );
}

// ═══ 5 · PERSISTENCIA REAL DEL ESTADO ═══════════════════════════════════
console.log("\n── 5 · El estado se guarda y se relee de Postgres ───────────");
{
  const r = resolver([{ ofrecible: "Pavé Cremoso 8 oz", cantidad: 2, seleccion: [["Sabores", "Arequipe"], ["Toppings", "Oreo"]] }]);
  const estado: Estado = {
    ...estadoVacio(),
    items: r.estado.items as never,
    totalCents: r.estado.totalCents,
    modalidadDeEntrega: MODALIDAD_DOMICILIO,
    entrega: {
      tipo: "domicilio", zonaId: "z", zonaNombre: "Omar Torrijos", feeCents: 1000000,
      verificadoEnMensajeId: "m", verificadoEn: new Date().toISOString(),
    } as never,
    datos: { nombre: "Ana", telefono: "3001234567", direccion: "Calle 1 #2-3" },
    paso: "resumen",
    confirmado: false,
  };
  await guardarEstado({
    conversationId: CONV, organizationId: ORG, estado,
    actor: "script:lab", proceso: "lab",
  });
  const releido = await leerEstado(CONV, ORG);
  comprobar("el estado vuelve de la base intacto", releido?.totalCents === estado.totalCents,
    pesos(releido?.totalCents ?? null));
  comprobar("la entrega verificada sobrevive al viaje", releido?.entrega?.feeCents === 1000000,
    pesos(releido?.entrega?.feeCents ?? null));
  comprobar("la modalidad sobrevive", releido?.modalidadDeEntrega === MODALIDAD_DOMICILIO);

  const bloque = comoTexto(releido!, catalogo, requisitosDe(ficha, { modalidadDeEntrega: MODALIDAD_DOMICILIO }), "pedidos", minimo);
  comprobar("el bloque le da al modelo la tarifa verificada", bloque.includes("Omar Torrijos"));
  comprobar("y NO le avisa de un mínimo que sí alcanza", !bloque.includes("MÍNIMO DE DOMICILIO"),
    pesos(releido!.totalCents));

  const pobre = { ...releido!, totalCents: 1000000, items: [releido!.items[0]!] };
  const bloquePobre = comoTexto(pobre as Estado, catalogo, [], "pedidos", minimo);
  comprobar("con un pedido por debajo, SÍ le avisa antes del cierre",
    bloquePobre.includes("MÍNIMO DE DOMICILIO") && bloquePobre.includes("$8.000"));
}

// ═══ 6 · EL CIERRE COMPLETO ═════════════════════════════════════════════
console.log("\n── 6 · Cierre de punta a punta ──────────────────────────────");
{
  const estado = await leerEstado(CONV, ORG);
  const reqs = requisitosDe(ficha, { modalidadDeEntrega: MODALIDAD_DOMICILIO });

  const completo = await juzgar({ ...estado!, confirmado: true }, reqs);
  comprobar("pedido completo a domicilio → SE PUEDE CERRAR", completo.ok,
    completo.ok ? `${pesos(estado!.totalCents)} + ${pesos(estado!.entrega!.feeCents!)} de envío` : (completo as {motivo:string}).motivo);

  const sinDireccion = await juzgar(
    { ...estado!, datos: { nombre: "Ana", telefono: "3001234567" }, confirmado: true }, reqs);
  comprobar("sin dirección en un domicilio → NO se puede cerrar",
    !sinDireccion.ok && (sinDireccion as {motivo:string}).motivo.includes("direccion"),
    sinDireccion.ok ? "lo dejó pasar" : (sinDireccion as {motivo:string}).motivo);

  const recogeSinDireccion = await juzgar({
    ...estado!, modalidadDeEntrega: MODALIDAD_RECOGIDA, entrega: null,
    datos: { nombre: "Ana", telefono: "3001234567" }, confirmado: true,
  });
  comprobar("sin dirección PARA RECOGER → sí se puede cerrar", recogeSinDireccion.ok,
    recogeSinDireccion.ok ? "" : (recogeSinDireccion as {motivo:string}).motivo);

  const sinTotal = await juzgar({ ...estado!, totalCents: null, confirmado: true }, reqs);
  comprobar("sin total calculado → NO se puede cerrar",
    !sinTotal.ok && (sinTotal as {motivo:string}).motivo.includes("total"));
}

// ── Limpieza ────────────────────────────────────────────────────────────
await borrarEstado(CONV, { actor: "script:lab", proceso: "lab", organizationId: ORG });
const tras = await leerEstado(CONV, ORG);
comprobar("el estado se borra al terminar, sin huérfanos", tras === null);
await sql`DELETE FROM conversation WHERE id = ${CONV}`;
await sql`DELETE FROM contact WHERE id = ${CONTACT}`;
await sql.end();

console.log("\n" + "═".repeat(74));
console.log(`RESULTADO: ${pasan} pasan · ${fallan} fallan`);
if (fallan) console.log("FALLAN: " + fallos.join(" | "));
console.log("═".repeat(74));
process.exit(fallan ? 1 : 0);
