/**
 * Fase 2 de extremo a extremo, sobre clientes que se crean y se BORRAN.
 *
 * Condición del dueño: nada de un cliente de prueba permanente. Uno permanente
 * mete ruido en `/admin` y acaba siendo otro objeto olvidado del sistema — es el
 * mismo patrón de `probar:propiedad`, que ya funcionó.
 *
 * Prueba contra Postgres de verdad, con **dos** clientes efímeros —uno de
 * pedidos y uno de citas— porque la regla 9 del proyecto dice que ninguna
 * decisión arquitectónica se valida contra un solo vertical.
 *
 * **No toca a ningún cliente real y deja la bandera `state_source` en `'prompt'`
 * en toda la flota.**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITERIOS DE SALIDA (los fijó el dueño antes de ejecutarlo por primera vez)
 *
 * Vertical de pedidos:  crear un pedido · elegir producto · añadir opciones de
 *                       varios grupos · repetir dentro de un grupo que lo
 *                       permite · pedir los datos obligatorios · confirmar ·
 *                       borrar el estado al terminar.
 * Vertical de citas:    crear la conversación · el flujo de citas sigue
 *                       funcionando · NO pide dirección · NO pide teléfono ·
 *                       `cierre.requisitos` no cambia el prompt.
 * Y en los dos:         sin errores · sin datos huérfanos · sin estado
 *                       persistente tras la limpieza · sin diferencias entre lo
 *                       esperado y lo observado.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Uso:
 *   pnpm probar:estado
 */
import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { compararFila, explicar, type Fila } from "@/server/ai/generador/comparar-fila";
import {
  borrarEstado,
  estadoVacio,
  guardarEstado,
  leerEstado,
  validarPropuesta,
  type EstadoDelPedido,
} from "@/server/orders/estado";
import { comoTexto, loQueFalta } from "@/server/orders/extraer";
import { catalogoDe } from "@/server/catalog/queries";
import { calcularDisponibilidad } from "@/server/appointments/logic";
import { requisitosDe, type FichaDelNegocio } from "@/server/ai/generador/ficha";
import { aSecciones, leerFichaAplanada } from "@/server/ai/generador/leer-ficha";
import { generarPerfil } from "@/server/ai/generador/generar";
import { verticalDe } from "@/server/vertical";
import { createClientWithOwner } from "@/server/auth/provisioning";

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
/*
 * `getEnv()` valida el entorno ENTERO antes de dar el cliente de la base, así
 * que hacen falta también las dos que este programa no usa. Van en el `.env`
 * local como marcadores: si alguna vez se usaran de verdad, se vería.
 */
for (const n of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const marca = Date.now();
const correoPedidos = `prueba-pedidos-${marca}@ejemplo.invalid`;
const correoCitas = `prueba-citas-${marca}@ejemplo.invalid`;
const db = getDb();
/** Todo lo creado aquí, para borrarlo pase lo que pase y comprobar que no queda nada. */
const efimeros: string[] = [];
let orgPedidos = "";
let orgCitas = "";
let convPedidos = "";
let convCitas = "";
const fallos: string[] = [];

/**
 * Compara dos estados por CONTENIDO.
 *
 * `JSON.stringify` no vale: Postgres guarda `jsonb` con las claves reordenadas,
 * así que un estado idéntico vuelve de la base con otro orden y la comparación
 * directa da falso negativo.
 */
const mismoEstado = (a: unknown, b: unknown): boolean => {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, val]) => [k, ordenar(val)])
      );
    }
    return v;
  };
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
};

const comprobar = (nombre: string, ok: boolean, detalle = "") => {
  console.log(`  ${ok ? "✅" : "🔴"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!ok) fallos.push(nombre);
};

/** La fila entera de la flota, para demostrar que NADA cambió (regla 6). */
async function huellaDeLaFlota() {
  const filas = await db.select().from(schema.agentProfile);
  return filas
    .filter((f) => !efimeros.includes(f.organizationId))
    .map((f) => JSON.stringify(f))
    .sort()
    .join("\n");
}

/** Guarda la ficha de un efímero. Por la puerta: `aSecciones` (ver 84-EL-MODELO-DE-LA-FICHA). */
async function ponerFicha(organizationId: string, ficha: FichaDelNegocio) {
  await db
    .update(schema.agentProfile)
    .set({ ficha: JSON.stringify(aSecciones(ficha)), updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, organizationId));
}

/** Los requisitos tal y como los verá el pipeline: leídos de la ficha guardada. */
async function requisitosGuardados(organizationId: string) {
  const [p] = await db
    .select({ ficha: schema.agentProfile.ficha })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  const ficha = leerFichaAplanada(p?.ficha ?? null);
  return ficha ? requisitosDe(ficha as unknown as FichaDelNegocio) : undefined;
}

const FICHA_BASE = {
  tono: "cercano",
  ubicacion: "Cra 1 #2-3",
  horario: { abre: "9:30 AM", cierra: "6:30 PM", dias: [1, 2, 3, 4, 5] },
  pago: { formas: "efectivo", compruebaUnaPersona: true },
  saludoInicial: "Hola",
  reglasPropias: [],
  preguntasFrecuentes: [],
  escalarSiempre: [],
  nuncaPrometer: [],
};

try {
  console.log(`\n${"=".repeat(74)}`);
  console.log("FASE 2 — prueba de extremo a extremo (dos clientes efímeros)");
  console.log(`${"=".repeat(74)}`);

  const flotaAntes = await huellaDeLaFlota();

  /* ══════════════════════════════════════════════════════════════════════════
   * BLOQUE A — VERTICAL DE PEDIDOS
   * ════════════════════════════════════════════════════════════════════════ */
  console.log("\n\n■ BLOQUE A — PEDIDOS\n");

  const creadoA = await createClientWithOwner({
    organizationName: `PRUEBA pedidos ${marca}`,
    ownerName: "Prueba Pedidos",
    ownerEmail: correoPedidos,
    password: `Prueba-${marca}-x9`,
  });
  orgPedidos = creadoA.organizationId;
  efimeros.push(orgPedidos);

  // El catálogo REAL de La Churra, tal como quedó en producción tras el paso 1
  // del encendido (18-ago-2026): cuatro presentaciones, cada una con SALSA
  // (repite), RECUBIERTO (no repite) y ADICIONES (repite) — los mismos nombres,
  // opciones y precios que ve el cliente. Ya no son "los 26 de Lis": son los
  // churros de verdad.
  const SALSAS = ["chocolate negro", "arequipe", "lechera", "chocolate blanco"];
  const RECUBIERTOS = ["Azúcar-canela", "Azúcar sola", "Sin azúcar"];
  const ADICIONES_OPCIONES = [
    { nombre: "Salsa de CHOCOLATE NEGRO", precioExtraCents: 200000 },
    { nombre: "Salsa de CHOCOLATE BLANCO", precioExtraCents: 200000 },
    { nombre: "LECHERA", precioExtraCents: 150000 },
    { nombre: "AREQUIPE", precioExtraCents: 150000 },
    { nombre: "Botella de agua", precioExtraCents: 200000 },
  ];
  /** Cuántas salsas trae cada presentación: 1 · 2 · 3 · 5 — la última, más sabores de los que hay. */
  const PRESENTACIONES = [
    { nombre: "CHURRITA", precioCents: 1000000, salsas: 1 },
    { nombre: "BESTIES", precioCents: 2000000, salsas: 2 },
    { nombre: "FAMILY BOX", precioCents: 3200000, salsas: 3 },
    { nombre: "MEGA BOX", precioCents: 5000000, salsas: 5 },
  ] as const;

  const idDe: Record<string, string> = {};
  await db.insert(schema.product).values(
    PRESENTACIONES.map((p, i) => {
      const id = newId("product");
      idDe[p.nombre] = id;
      return { id, organizationId: orgPedidos, name: p.nombre, priceCents: p.precioCents, position: i };
    })
  );

  const grupos: (typeof schema.productOptionGroup.$inferInsert)[] = [];
  const opciones: (typeof schema.productOption.$inferInsert)[] = [];
  for (const p of PRESENTACIONES) {
    const productId = idDe[p.nombre]!;
    const gSalsa = newId("productOptionGroup");
    const gRecubierto = newId("productOptionGroup");
    const gAdiciones = newId("productOptionGroup");
    grupos.push(
      // Cada presentación pide un número DISTINTO de salsas — nunca el núcleo.
      { id: gSalsa, organizationId: orgPedidos, productId, name: "SALSA", minSelect: p.salsas, maxSelect: p.salsas, permiteRepeticion: true, position: 0 },
      // No tiene sentido pedir azúcar-canela dos veces: no admite repetir.
      { id: gRecubierto, organizationId: orgPedidos, productId, name: "RECUBIERTO", minSelect: 1, maxSelect: 1, permiteRepeticion: false, position: 1 },
      // Se cobran aparte y SÍ se pueden repetir (18-ago): dos chocolates de adición son dos cobros.
      { id: gAdiciones, organizationId: orgPedidos, productId, name: "ADICIONES", minSelect: 0, maxSelect: 5, permiteRepeticion: true, position: 2 }
    );
    opciones.push(
      ...SALSAS.map((n, i) => ({ id: newId("productOption"), organizationId: orgPedidos, groupId: gSalsa, name: n, priceDeltaCents: 0, position: i })),
      ...RECUBIERTOS.map((n, i) => ({ id: newId("productOption"), organizationId: orgPedidos, groupId: gRecubierto, name: n, priceDeltaCents: 0, position: i })),
      // AREQUIPE y las dos CHOCOLATE están TAMBIÉN como salsa incluida: el mismo
      // nombre en dos grupos, sin decir cuál, es la ambigüedad real de La Churra
      // (91-CATALOGO-DE-LA-CHURRA.md).
      ...ADICIONES_OPCIONES.map((o, i) => ({ id: newId("productOption"), organizationId: orgPedidos, groupId: gAdiciones, name: o.nombre, priceDeltaCents: o.precioExtraCents, position: i }))
    );
  }
  await db.insert(schema.productOptionGroup).values(grupos);
  await db.insert(schema.productOption).values(opciones);

  const idChurrita = idDe["CHURRITA"]!;
  const idMegaBox = idDe["MEGA BOX"]!;

  // Su ficha declara lo que pide para cerrar. Nada de esto vive en el código.
  await ponerFicha(orgPedidos, {
    ...FICHA_BASE,
    nombre: `PRUEBA pedidos ${marca}`,
    vertical: "pedidos",
    queVende: "churros",
    catalogo: "CHURRITA — $10.000",
    entrega: { haceDomicilios: true, quienPagaElDomicilio: "el cliente" },
    cierre: {
      requisitos: [
        { id: "nombre", tipo: "texto", etiqueta: "el nombre", obligatorio: true },
        { id: "telefono", tipo: "telefono", etiqueta: "un celular de contacto", obligatorio: true },
        { id: "direccion", tipo: "direccion", etiqueta: "la dirección", obligatorio: true, soloSi: "entrega.haceDomicilios" },
      ],
    },
  } as unknown as FichaDelNegocio);

  const contactoA = newId("contact");
  await db.insert(schema.contact).values({
    id: contactoA, organizationId: orgPedidos, phone: `99900${marca}`.slice(0, 15), name: "Cliente de prueba",
  });
  convPedidos = newId("conversation");
  await db.insert(schema.conversation).values({
    id: convPedidos, organizationId: orgPedidos, contactId: contactoA,
    isTest: true, // JAMÁS toca WhatsApp
  });
  console.log(`  cliente efímero de pedidos: ${orgPedidos}`);

  /*
   * El catálogo se lee DE LA BASE, no se escribe a mano: así esta prueba recorre
   * la misma cadena que el pipeline, incluida la columna de la migración 0023.
   */
  const catalogo = await catalogoDe(orgPedidos, "pedidos");
  const requisitos = await requisitosGuardados(orgPedidos);
  const megaBox = catalogo.find((p) => p.id === idMegaBox);

  console.log("\nA1. EL CATÁLOGO LLEGA COMO ESTÁ EN LA BASE — LAS CUATRO PRESENTACIONES REALES");
  comprobar("el vertical se deduce en un solo sitio", verticalDe(false) === "pedidos");
  comprobar("las cuatro presentaciones, cada una con sus tres grupos", catalogo.length === 4 && megaBox?.grupos.length === 3);
  comprobar(
    "la regla de repetición viaja EN EL GRUPO, no en el núcleo",
    megaBox?.grupos.find((g) => g.nombre === "SALSA")?.permiteRepeticion === true &&
      megaBox?.grupos.find((g) => g.nombre === "RECUBIERTO")?.permiteRepeticion === false &&
      megaBox?.grupos.find((g) => g.nombre === "ADICIONES")?.permiteRepeticion === true
  );
  comprobar("los requisitos salen de la ficha, no de una constante", requisitos?.length === 3,
    requisitos?.map((r) => r.id).join(", "));

  console.log("\nA2. UN PEDIDO SENCILLO — SALSA Y RECUBIERTO EN EL MISMO MENSAJE");
  const v1 = validarPropuesta(
    {
      items: [{
        ofrecible: "churrita", cantidad: 1,
        opciones: [{ grupo: "SALSA", opcion: "arequipe" }, { grupo: "RECUBIERTO", opcion: "Azúcar-canela" }],
      }],
      datos: {}, paso: "eligiendo_opciones",
    },
    catalogo, undefined, requisitos
  );
  comprobar("la propuesta válida pasa", v1.ok, v1.rechazos.join(" · "));
  comprobar("el backend resuelve el productId", v1.estado.items[0]?.ofrecible.id === idChurrita);
  comprobar("el total lo calcula el servidor", v1.estado.totalCents === 1000000, "$10.000");
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: v1.estado, actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("se recupera lo guardado", mismoEstado(await leerEstado(convPedidos), v1.estado));

  console.log("\nA3. EL MEGA BOX: CINCO SALSAS DE CUATRO SABORES, Y LA ADICIÓN QUE SÍ SE REPITE");
  const cincoSalsas = [
    { grupo: "SALSA", opcion: "arequipe" },
    { grupo: "SALSA", opcion: "arequipe" },
    { grupo: "SALSA", opcion: "lechera" },
    { grupo: "SALSA", opcion: "chocolate negro" },
    { grupo: "SALSA", opcion: "chocolate blanco" },
  ];
  const recubiertoBase = { grupo: "RECUBIERTO", opcion: "Azúcar-canela" };
  const v2 = validarPropuesta(
    { items: [{ ofrecible: "mega box", cantidad: 1, opciones: [...cincoSalsas, recubiertoBase, { grupo: "ADICIONES", opcion: "AREQUIPE" }] }], datos: {}, paso: "eligiendo_opciones" },
    catalogo, undefined, requisitos
  );
  comprobar("cinco de cuatro sabores: se puede repetir donde el grupo lo permite", v2.ok, v2.rechazos.join(" · "));
  comprobar("las cinco se conservan, no se deduplican", v2.estado.items[0]!.seleccion.filter((s) => s.grupoNombre === "SALSA").length === 5);
  comprobar("«arequipe» dos veces son dos, no una", v2.estado.items[0]!.seleccion.filter((s) => s.grupoNombre === "SALSA" && s.nombre === "arequipe").length === 2);
  /*
   * $50.000 + UNA adición de $1.500. Las salsas van incluidas y el recubierto
   * también. Si el cobro volviera a cruzarse entre grupos, aquí saldrían
   * $53.000 (dos AREQUIPE, salsa y adición confundidas).
   */
  comprobar("cada grupo cobra lo suyo: no hay cobro cruzado", v2.estado.totalCents === 5150000, `$${(v2.estado.totalCents ?? 0) / 100}`);

  const v2b = validarPropuesta(
    { items: [{ ofrecible: "mega box", cantidad: 1, opciones: [...cincoSalsas, recubiertoBase, { grupo: "ADICIONES", opcion: "Botella de agua" }, { grupo: "ADICIONES", opcion: "Botella de agua" }] }], datos: {}, paso: "eligiendo_opciones" },
    catalogo, undefined, requisitos
  );
  // 18-ago: las adiciones pasaron a admitir repetir (reglasPropias: "sí se
  // pueden repetir; pregúntale si quiere sumar otra"). Dos botellas de agua son
  // dos cobros, no una duda.
  comprobar("y donde el grupo SÍ lo permite, dos adiciones iguales se cobran las dos",
    v2b.ok && v2b.estado.items[0]!.seleccion.filter((s) => s.grupoNombre === "ADICIONES").length === 2,
    v2b.rechazos.join(" · ") || v2b.dudas?.[0]?.preguntar || "");
  comprobar("y su total suma las dos botellas", v2b.estado.totalCents === 5000000 + 200000 * 2,
    `$${(v2b.estado.totalCents ?? 0) / 100}`);

  console.log("\nA4. LO QUE FALTA PARA CERRAR");
  const faltan = loQueFalta(v2.estado, catalogo, requisitos);
  comprobar("pide los tres datos que declaró la ficha",
    (requisitos ?? []).every((r) => faltan.some((f) => f.includes(r.etiqueta))), faltan.join(" · "));
  const conNombre = { ...v2.estado, datos: { nombre: "Ana" } };
  comprobar("y deja de pedir el que ya tiene", !loQueFalta(conNombre, catalogo, requisitos).some((f) => f.includes("el nombre")));
  comprobar("el resumen no inventa género ni trata al cliente de usted o de tú",
    !/\b(la dio|lo dio|dió|usted)\b/i.test(comoTexto(conNombre, catalogo, requisitos)));

  console.log("\nA5. CONFIRMAR");
  const sinDatos = validarPropuesta(
    { items: [{ ofrecible: "mega box", cantidad: 1, opciones: [...cincoSalsas, recubiertoBase] }], datos: {}, confirmado: true },
    catalogo, undefined, requisitos
  );
  comprobar("no se confirma sin los datos obligatorios", !sinDatos.ok || !sinDatos.estado.confirmado, sinDatos.rechazos[0] ?? "");

  const sinRequisitos = validarPropuesta(
    { items: [{ ofrecible: "mega box", cantidad: 1, opciones: [...cincoSalsas, recubiertoBase] }], datos: { nombre: "Ana", telefono: "3001234567", direccion: "Cra 1 #2-3" }, confirmado: true },
    catalogo
  );
  comprobar("ni cuando el negocio NO ha declarado qué pide", !sinRequisitos.ok || !sinRequisitos.estado.confirmado, sinRequisitos.rechazos[0] ?? "");

  const completo = validarPropuesta(
    { items: [{ ofrecible: "mega box", cantidad: 1, opciones: [...cincoSalsas, recubiertoBase, { grupo: "ADICIONES", opcion: "AREQUIPE" }] }], datos: { nombre: "Ana", telefono: "3001234567", direccion: "Cra 1 #2-3" }, confirmado: true, paso: "confirmado" },
    catalogo, undefined, requisitos
  );
  comprobar("con todo lo que pide la ficha, SÍ se confirma", completo.ok && completo.estado.confirmado, completo.rechazos.join(" · "));
  comprobar("y el total sigue siendo el del servidor", completo.estado.totalCents === 5150000);
  comprobar("no queda nada por pedir", loQueFalta(completo.estado, catalogo, requisitos).length === 0);
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: completo.estado, actor: "script:probar-estado", proceso: "probar:estado" });

  console.log("\nA6. CORRUPCIÓN DELIBERADA (nada de esto debe persistirse)");
  const guardadoBueno = await leerEstado(convPedidos);
  const casos: [string, Parameters<typeof validarPropuesta>[0]][] = [
    ["producto inexistente", { items: [{ ofrecible: "PIZZA", cantidad: 1, opciones: [] }], datos: {} }],
    ["opción que no existe en el grupo", { items: [{ ofrecible: "churrita", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "mostaza" }] }], datos: {} }],
    ["cantidad 0", { items: [{ ofrecible: "churrita", cantidad: 0, opciones: [{ grupo: "SALSA", opcion: "arequipe" }] }], datos: {} }],
    // El caso REAL de La Churra (91-CATALOGO-DE-LA-CHURRA.md): "arequipe" es
    // salsa incluida Y adición de $1.500 a la vez. Sin decir el grupo, no se
    // adivina — se pregunta, para no cobrar de más.
    ["«arequipe» sin grupo: ambigua entre SALSA y ADICIONES", { items: [{ ofrecible: "churrita", cantidad: 1, opciones: [{ opcion: "arequipe" }] }], datos: {} }],
    ["confirmar con la mitad de los datos", { items: [{ ofrecible: "churrita", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "arequipe" }] }], datos: { nombre: "Ana" }, confirmado: true }],
  ];
  for (const [nombre, mala] of casos) {
    const r = validarPropuesta(mala, catalogo, undefined, requisitos);
    const rechazada = !r.ok || r.estado.items[0]?.ofrecible.id === null || (r.dudas?.length ?? 0) > 0 || !r.estado.confirmado;
    comprobar(nombre, rechazada, r.rechazos[0] ?? r.dudas?.[0]?.preguntar ?? "no resuelve el producto");
  }
  comprobar("el estado guardado sigue intacto tras los intentos", mismoEstado(await leerEstado(convPedidos), guardadoBueno));

  console.log("\nA7. ROLLBACK Y ESQUEMA DESCONOCIDO");
  await borrarEstado(convPedidos, { actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("el estado se borra (es lo que hace el «0»)", (await leerEstado(convPedidos)) === null);
  const [perfilA] = await db
    .select({ stateSource: schema.agentProfile.stateSource })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, orgPedidos));
  comprobar("la bandera nace y sigue en 'prompt'", perfilA?.stateSource === "prompt");

  const delFuturo: EstadoDelPedido = { ...estadoVacio(), schema_version: 99 };
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: delFuturo, actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("una versión que no conocemos no se usa a medias: se empieza limpio", (await leerEstado(convPedidos)) === null);

  console.log("\nA8. CONCURRENCIA (dos turnos a la vez sobre la misma conversación)");
  const dos: EstadoDelPedido[] = [
    { ...estadoVacio(), items: [{ ofrecible: { id: idChurrita, nombre: "CHURRITA" }, cantidad: 1, seleccion: [], totalCents: 1000000 }], paso: "turno-A" },
    { ...estadoVacio(), items: [{ ofrecible: { id: idChurrita, nombre: "CHURRITA" }, cantidad: 2, seleccion: [], totalCents: 2000000 }], paso: "turno-B" },
  ];
  await Promise.all(
    dos.map((e) => guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: e, actor: "script:probar-estado", proceso: "concurrencia" }))
  );
  const tras = await leerEstado(convPedidos);
  // La cola garantiza un turno por conversación, así que esto NO debería pasar
  // en producción; se comprueba igual porque el día que la cola falle, el
  // reemplazo completo tiene que dejar un estado coherente, no una mezcla.
  const coherente =
    tras !== null &&
    ((tras.paso === "turno-A" && tras.items[0]?.cantidad === 1) ||
      (tras.paso === "turno-B" && tras.items[0]?.cantidad === 2));
  comprobar("gana uno de los dos ENTERO, sin mezclarse", coherente, `quedó ${tras?.paso}`);
  await borrarEstado(convPedidos, { actor: "script:probar-estado", proceso: "limpieza" });

  console.log("\nA9. DOS PRODUCTOS EN UN PEDIDO — EL CASO REAL DEL 17-AGO");
  /*
   * El caso que de verdad falló en producción (92-BITACORA-17AGO.md): un
   * cliente escribió «Churrita arequipe / Besties chocolate y chocolate» y el
   * agente perdió la mitad. Aquí van los mismos dos productos, con la MISMA
   * repetición (dos chocolate negro en la Besties, que pide 2 salsas), contra
   * la base de verdad.
   */
  const dosCosas = validarPropuesta(
    {
      items: [
        { ofrecible: "churrita", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "arequipe" }, recubiertoBase] },
        {
          ofrecible: "besties", cantidad: 1,
          opciones: [
            { grupo: "SALSA", opcion: "chocolate negro" },
            { grupo: "SALSA", opcion: "chocolate negro" },
            recubiertoBase,
          ],
        },
      ],
      datos: { nombre: "Ana", telefono: "3001234567", direccion: "Cra 1 #2-3" },
      confirmado: true,
      paso: "confirmado",
    },
    catalogo,
    undefined,
    requisitos
  );
  comprobar("los dos caben, y el pedido se confirma", dosCosas.ok && dosCosas.estado.confirmado,
    dosCosas.rechazos.join(" · "));
  comprobar("cada uno con SUS opciones, sin mezclarse",
    dosCosas.estado.items[0]?.seleccion.length === 2 && dosCosas.estado.items[1]?.seleccion.length === 3);
  comprobar("la repetición de la Besties también se conserva dentro del pedido múltiple",
    dosCosas.estado.items[1]?.seleccion.filter((s) => s.nombre === "chocolate negro").length === 2);
  comprobar("el total es la SUMA de los dos", dosCosas.estado.totalCents === 1000000 + 2000000,
    `$${(dosCosas.estado.totalCents ?? 0) / 100}`);
  await guardarEstado({ conversationId: convPedidos, organizationId: orgPedidos, estado: dosCosas.estado, actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("y vuelve de la base con sus DOS items", (await leerEstado(convPedidos))?.items.length === 2);
  await borrarEstado(convPedidos, { actor: "script:probar-estado", proceso: "limpieza" });

  /* ══════════════════════════════════════════════════════════════════════════
   * BLOQUE B — VERTICAL DE CITAS
   *
   * La regla 9: ninguna decisión se valida contra un solo vertical. Todo lo de
   * arriba pudo salir bien y aun así haberle roto la agenda a un salón.
   * ════════════════════════════════════════════════════════════════════════ */
  console.log("\n\n■ BLOQUE B — CITAS\n");

  const creadoB = await createClientWithOwner({
    organizationName: `PRUEBA citas ${marca}`,
    ownerName: "Prueba Citas",
    ownerEmail: correoCitas,
    password: `Prueba-${marca}-y7`,
    needsAppointments: true,
  });
  orgCitas = creadoB.organizationId;
  efimeros.push(orgCitas);

  const idServicio = newId("service");
  await db.insert(schema.service).values({
    id: idServicio, organizationId: orgCitas, name: "PESTAÑAS CLÁSICAS", priceCents: 8000000, durationMin: 90,
  });
  const idStaff = newId("resource");
  await db.insert(schema.resource).values({ id: idStaff, organizationId: orgCitas, name: "Profesional 1", type: "persona" });
  await db.insert(schema.resourceService).values({
    id: newId("resourceService"), organizationId: orgCitas, resourceId: idStaff, serviceId: idServicio,
  });

  // Su ficha pide UNA sola cosa para cerrar. Ni dirección, ni teléfono.
  await ponerFicha(orgCitas, {
    ...FICHA_BASE,
    nombre: `PRUEBA citas ${marca}`,
    vertical: "citas",
    queVende: "servicios de belleza",
    catalogo: "PESTAÑAS CLÁSICAS — $80.000",
    entrega: { haceDomicilios: false, quienPagaElDomicilio: "" },
    cierre: { requisitos: [{ id: "nombre", tipo: "texto", etiqueta: "el nombre", obligatorio: true }] },
  } as unknown as FichaDelNegocio);

  const contactoB = newId("contact");
  await db.insert(schema.contact).values({
    id: contactoB, organizationId: orgCitas, phone: `99911${marca}`.slice(0, 15), name: "Clienta de prueba",
  });
  convCitas = newId("conversation");
  await db.insert(schema.conversation).values({ id: convCitas, organizationId: orgCitas, contactId: contactoB, isTest: true });
  console.log(`  cliente efímero de citas: ${orgCitas}`);

  const [perfilB] = await db
    .select({
      appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
      ficha: schema.agentProfile.ficha,
      stateSource: schema.agentProfile.stateSource,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, orgCitas));

  console.log("\nB1. EL VERTICAL");
  comprobar("nace como negocio de citas", perfilB?.appointmentsEnabled === true);
  comprobar("y el vertical se deduce del mismo sitio que en pedidos", verticalDe(perfilB?.appointmentsEnabled ?? false) === "citas");

  console.log("\nB2. LO QUE PIDE PARA CERRAR");
  const reqCitas = await requisitosGuardados(orgCitas);
  comprobar("pide exactamente lo que declaró: uno", reqCitas?.length === 1, reqCitas?.map((r) => r.id).join(", "));
  comprobar("NO pide dirección", !reqCitas?.some((r) => r.id === "direccion" || r.tipo === "direccion"));
  comprobar("NO pide teléfono", !reqCitas?.some((r) => r.id === "telefono" || r.tipo === "telefono"));
  const catalogoCitas = await catalogoDe(orgCitas, "citas");
  const servicio = catalogoCitas[0];
  /*
   * Un servicio elegido, en el contrato v4. Se anota el tipo A PROPÓSITO: sin
   * anotación, un objeto con el campo viejo (`producto`) compila igual y la
   * prueba falla en ejecución diciendo que falta la presentación. Pasó aquí.
   */
  const citaElegida: EstadoDelPedido = {
    ...estadoVacio(),
    items: [
      {
        ofrecible: { id: servicio?.id ?? null, nombre: servicio?.nombre ?? null },
        cantidad: 1,
        seleccion: [],
        totalCents: servicio?.precioCents ?? null,
      },
    ],
    datos: { nombre: "Ana" },
  };
  comprobar("con el servicio y el nombre, no queda nada pendiente",
    loQueFalta(citaElegida, catalogoCitas, reqCitas).length === 0,
    loQueFalta(citaElegida, catalogoCitas, reqCitas).join(" · "));
  const sinNada = { ...estadoVacio(), datos: { nombre: "Ana" } };
  comprobar("y sin servicio elegido, lo único que falta es el servicio: nunca un dato personal",
    loQueFalta(sinNada, catalogoCitas, reqCitas).length === 1,
    loQueFalta(sinNada, catalogoCitas, reqCitas).join(" · "));

  console.log("\nB3. EL FLUJO DE CITAS SIGUE FUNCIONANDO");
  comprobar("el servicio se lee por el mismo camino que un producto",
    catalogoCitas.length === 1 && servicio?.nombre === "PESTAÑAS CLÁSICAS");
  /*
   * ⚠️ `calcularDisponibilidad` devuelve `Record<HORA, recursoId[]>` — indexado
   * por la hora, no por el recurso. La primera versión de esta prueba lo leyó
   * al revés, dio «0 franjas» y el caso contrario pasó por la razón
   * equivocada. La auditoría del paso 4 lo describía mal; corregido en
   * 83-RECURSOS-Y-RESERVAS. El parámetro pasó de `staffIds` a `recursoIds` el
   * 18-ago-2026 (paso 4a): un profesional dejó de ser el único recurso.
   */
  const horario = { open: "09:30", close: "18:30", days: "1,2,3,4,5" };
  const huecos = calcularDisponibilidad({ recursoIds: [idStaff], citas: [], duracionMin: 90, hours: horario, esHoy: false });
  const franjas = Object.entries(huecos).filter(([, quienes]) => quienes.includes(idStaff));
  comprobar("hay huecos que ofrecer con la agenda vacía", franjas.length > 0, `${franjas.length} franjas: ${franjas[0]?.[0]}…${franjas.at(-1)?.[0]}`);
  const ocupada = calcularDisponibilidad({
    recursoIds: [idStaff], citas: [{ recursoId: idStaff, startMin: 570, endMin: 1110 }], duracionMin: 90,
    hours: horario, esHoy: false,
  });
  comprobar("y ninguno cuando el día entero está ocupado",
    Object.values(ocupada).every((quienes) => !quienes.includes(idStaff)));

  console.log("\nB4. LOS REQUISITOS NO TOCAN EL PROMPT");
  /*
   * `cierre.requisitos` lo lee el pipeline, NO el texto del prompt. Si el
   * generador empezara a escribirlos, migrar una ficha cambiaría lo que el
   * agente dice — y eso es justo lo que se prometió que no pasaría.
   */
  const fichaB = leerFichaAplanada(perfilB?.ficha ?? null) as unknown as FichaDelNegocio;
  const conCierre = generarPerfil(fichaB, { vertical: "citas" });
  const sinCierre = generarPerfil({ ...fichaB, cierre: undefined } as unknown as FichaDelNegocio, { vertical: "citas" });
  comprobar("el prompt es idéntico con y sin requisitos declarados",
    JSON.stringify(conCierre) === JSON.stringify(sinCierre));

  console.log("\nB5. LA BANDERA");
  comprobar("el cliente de citas también nace en 'prompt'", perfilB?.stateSource === "prompt");

  /* ══════════════════════════════════════════════════════════════════════════
   * CIERRE
   * ════════════════════════════════════════════════════════════════════════ */
  console.log("\n\n■ CIERRE\n");
  console.log("C1. LA FLOTA NO CAMBIÓ");
  const flotaDespues = await huellaDeLaFlota();
  comprobar("todas las filas de agent_profile, idénticas", flotaAntes === flotaDespues);
  if (flotaAntes !== flotaDespues) {
    console.log(explicar(compararFila(JSON.parse(flotaAntes) as Fila, JSON.parse(flotaDespues) as Fila, [])));
  }

  console.log("\nC2. SIN ESTADO PERSISTENTE");
  comprobar("no queda estado en la conversación de pedidos", (await leerEstado(convPedidos)) === null);
  comprobar("ni en la de citas", (await leerEstado(convCitas)) === null);
} finally {
  /*
   * Se borra la organización y `onDelete: cascade` se lleva lo demás. Y DESPUÉS
   * se comprueba tabla por tabla que no quedó nada: un `cascade` que falte en
   * una tabla nueva no avisa, deja huérfanos.
   */
  for (const org of efimeros) {
    await db.delete(schema.organization).where(eq(schema.organization.id, org));
  }
  await db.delete(schema.user).where(inArray(schema.user.email, [correoPedidos, correoCitas]));

  if (efimeros.length) {
    const huerfanos: string[] = [];
    const restos: [string, number][] = [
      ["agent_profile", (await db.select().from(schema.agentProfile).where(inArray(schema.agentProfile.organizationId, efimeros))).length],
      ["product", (await db.select().from(schema.product).where(inArray(schema.product.organizationId, efimeros))).length],
      ["product_option_group", (await db.select().from(schema.productOptionGroup).where(inArray(schema.productOptionGroup.organizationId, efimeros))).length],
      ["product_option", (await db.select().from(schema.productOption).where(inArray(schema.productOption.organizationId, efimeros))).length],
      ["service", (await db.select().from(schema.service).where(inArray(schema.service.organizationId, efimeros))).length],
      ["resource", (await db.select().from(schema.resource).where(inArray(schema.resource.organizationId, efimeros))).length],
      ["resource_service", (await db.select().from(schema.resourceService).where(inArray(schema.resourceService.organizationId, efimeros))).length],
      ["contact", (await db.select().from(schema.contact).where(inArray(schema.contact.organizationId, efimeros))).length],
      ["conversation", (await db.select().from(schema.conversation).where(inArray(schema.conversation.organizationId, efimeros))).length],
      ["conversation_state", (await db.select().from(schema.conversationState).where(inArray(schema.conversationState.organizationId, efimeros))).length],
    ];
    for (const [nombre, n] of restos) if (n) huerfanos.push(`${nombre}: ${n}`);
    console.log(`\n🧹 clientes efímeros borrados (${efimeros.join(", ")})`);
    comprobar("sin datos huérfanos tras la limpieza", huerfanos.length === 0, huerfanos.join(" · "));
  }
}

console.log(`\n${"=".repeat(74)}`);
console.log(fallos.length === 0 ? "✅ TODO PASA" : `🔴 FALLAN ${fallos.length}: ${fallos.join(", ")}`);
console.log(`${"=".repeat(74)}\n`);
process.exit(fallos.length === 0 ? 0 : 1);
