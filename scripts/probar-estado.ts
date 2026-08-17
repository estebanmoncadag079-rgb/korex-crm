/**
 * Fase 2 de extremo a extremo, sobre un cliente que se crea y se BORRA.
 *
 * Condición del dueño: nada de un cliente de prueba permanente. Uno permanente
 * mete ruido en `/admin` y acaba siendo otro objeto olvidado del sistema — es el
 * mismo patrón de `probar:propiedad`, que ya funcionó.
 *
 * Prueba persistencia, recuperación, rollback y corrupción deliberada contra
 * Postgres de verdad. **No toca a ningún cliente real y deja la bandera
 * `state_source` en `'prompt'` en toda la flota.**
 *
 * Uso:
 *   pnpm probar:estado
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
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
for (const n of ["DATABASE_URL", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET"]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const marca = Date.now();
const correo = `prueba-estado-${marca}@ejemplo.invalid`;
const db = getDb();
let organizationId = "";
let conversationId = "";
let contactId = "";
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
    .filter((f) => f.organizationId !== organizationId)
    .map((f) => JSON.stringify(f))
    .sort()
    .join("\n");
}

try {
  console.log(`\n${"=".repeat(74)}`);
  console.log("FASE 2 — prueba de extremo a extremo (cliente efímero)");
  console.log(`${"=".repeat(74)}`);

  const flotaAntes = await huellaDeLaFlota();

  // 1. Cliente de prueba con catálogo propio
  const creado = await createClientWithOwner({
    organizationName: `PRUEBA estado ${marca}`,
    ownerName: "Prueba Estado",
    ownerEmail: correo,
    password: `Prueba-${marca}-x9`,
  });
  organizationId = creado.organizationId;

  const productId = newId("product");
  await db.insert(schema.product).values({
    id: productId,
    organizationId,
    name: "CHURRITA",
    priceCents: 1000000,
    position: 0,
  });
  const groupId = newId("productOptionGroup");
  await db.insert(schema.productOptionGroup).values({
    id: groupId,
    organizationId,
    productId,
    name: "SALSA",
    minSelect: 1,
    maxSelect: 1,
    position: 0,
  });
  for (const [i, nombre] of ["arequipe", "lechera"].entries()) {
    await db.insert(schema.productOption).values({
      id: newId("productOption"),
      organizationId,
      groupId,
      name: nombre,
      priceDeltaCents: 0,
      position: i,
    });
  }

  contactId = newId("contact");
  await db.insert(schema.contact).values({
    id: contactId,
    organizationId,
    phone: `99900${marca}`.slice(0, 15),
    name: "Cliente de prueba",
  });
  conversationId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: conversationId,
    organizationId,
    contactId,
    isTest: true, // JAMÁS toca WhatsApp
  });
  console.log(`\n1. cliente efímero creado: ${organizationId}`);

  const catalogo = [
    {
      id: productId,
      nombre: "CHURRITA",
      categoria: null,
      precioCents: 1000000,
      descripcion: null,
      grupos: [
        {
          id: groupId,
          nombre: "SALSA",
          minimo: 1,
          maximo: 1,
          permiteRepeticion: true,
          opciones: [
            { id: "x", nombre: "arequipe", precioExtraCents: 0 },
            { id: "y", nombre: "lechera", precioExtraCents: 0 },
          ],
        },
      ],
    },
  ];

  // 2. Persistencia
  console.log("\n2. PERSISTENCIA");
  const v = validarPropuesta(
    {
      producto: "churrita",
      cantidad: 1,
      opciones: [{ grupo: "SALSA", opcion: "arequipe" }],
      nombre: null,
      telefono: null,
      direccion: null,
      paso: "eligiendo_opciones",
    },
    catalogo
  );
  comprobar("la propuesta válida pasa", v.ok);
  comprobar("el backend resuelve el productId", v.estado.producto.id === productId);
  comprobar("el total lo calcula el servidor", v.estado.totalCents === 1000000, "$10.000");
  await guardarEstado({
    conversationId,
    organizationId,
    estado: v.estado,
    actor: "script:probar-estado",
    proceso: "probar:estado",
  });

  // 3. Recuperación
  console.log("\n3. RECUPERACIÓN");
  const leido = await leerEstado(conversationId);
  comprobar("se recupera lo guardado", mismoEstado(leido, v.estado));

  // 4. Corrupción deliberada
  console.log("\n4. CORRUPCIÓN DELIBERADA (nada de esto debe persistirse)");
  const casos: [string, Parameters<typeof validarPropuesta>[0]][] = [
    ["producto inexistente", { producto: "PIZZA", cantidad: 1, opciones: [], nombre: null, telefono: null, direccion: null }],
    ["salsa incompatible", { producto: "churrita", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "mostaza" }], nombre: null, telefono: null, direccion: null }],
    ["cantidad 0", { producto: "churrita", cantidad: 0, opciones: [{ grupo: "SALSA", opcion: "arequipe" }], nombre: null, telefono: null, direccion: null }],
    ["confirmado sin datos", { producto: "churrita", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "arequipe" }], nombre: null, telefono: null, direccion: null, confirmado: true }],
  ];
  for (const [nombre, mala] of casos) {
    const r = validarPropuesta(mala, catalogo);
    const rechazadaOsinResolver = !r.ok || r.estado.producto.id === null;
    comprobar(nombre, rechazadaOsinResolver, r.rechazos[0] ?? "no resuelve el producto");
  }
  const trasCorrupcion = await leerEstado(conversationId);
  comprobar("el estado guardado sigue intacto tras los intentos", mismoEstado(trasCorrupcion, v.estado));

  // 5. Rollback
  console.log("\n5. ROLLBACK");
  await borrarEstado(conversationId, { actor: "script:probar-estado", proceso: "probar:estado" });
  comprobar("el estado se borra (es lo que hace el «0»)", (await leerEstado(conversationId)) === null);
  const [perfil] = await db
    .select({ stateSource: schema.agentProfile.stateSource })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  comprobar("la bandera nace y sigue en 'prompt'", perfil?.stateSource === "prompt");

  // 6. Esquema futuro
  console.log("\n6. UNA VERSIÓN DE ESQUEMA QUE NO CONOCEMOS");
  const delFuturo: EstadoDelPedido = { ...estadoVacio(), schema_version: 99 };
  await guardarEstado({
    conversationId,
    organizationId,
    estado: delFuturo,
    actor: "script:probar-estado",
    proceso: "probar:estado",
  });
  comprobar("no se usa a medias: se empieza limpio", (await leerEstado(conversationId)) === null);

  // 6b. Concurrencia
  console.log("\n6b. CONCURRENCIA (dos turnos a la vez sobre la misma conversación)");
  const dos: EstadoDelPedido[] = [
    { ...estadoVacio(), producto: { id: productId, nombre: "CHURRITA", cantidad: 1 }, paso: "turno-A" },
    { ...estadoVacio(), producto: { id: productId, nombre: "CHURRITA", cantidad: 2 }, paso: "turno-B" },
  ];
  await Promise.all(
    dos.map((e) =>
      guardarEstado({
        conversationId,
        organizationId,
        estado: e,
        actor: "script:probar-estado",
        proceso: "concurrencia",
      })
    )
  );
  const tras = await leerEstado(conversationId);
  // La cola garantiza un turno por conversación, así que esto NO debería pasar
  // en producción; se comprueba igual porque el día que la cola falle, el
  // reemplazo completo tiene que dejar un estado coherente, no una mezcla.
  const coherente =
    tras !== null &&
    ((tras.paso === "turno-A" && tras.producto.cantidad === 1) ||
      (tras.paso === "turno-B" && tras.producto.cantidad === 2));
  comprobar("gana uno de los dos ENTERO, sin mezclarse", coherente, `quedó ${tras?.paso}`);
  await borrarEstado(conversationId, { actor: "script:probar-estado", proceso: "limpieza" });

  // 7. La flota, fila completa
  console.log("\n7. LA FLOTA NO CAMBIÓ");
  const flotaDespues = await huellaDeLaFlota();
  comprobar("todas las filas de agent_profile, idénticas", flotaAntes === flotaDespues);
  if (flotaAntes !== flotaDespues) {
    console.log(explicar(compararFila(JSON.parse(flotaAntes) as Fila, JSON.parse(flotaDespues) as Fila, [])));
  }
} finally {
  if (conversationId) {
    await db.delete(schema.conversation).where(eq(schema.conversation.id, conversationId));
  }
  if (organizationId) {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
    await db.delete(schema.user).where(eq(schema.user.email, correo));
    console.log(`\n🧹 cliente efímero borrado (${organizationId})`);
  }
}

console.log(`\n${"=".repeat(74)}`);
console.log(fallos.length === 0 ? "✅ TODO PASA" : `🔴 FALLAN ${fallos.length}: ${fallos.join(", ")}`);
console.log(`${"=".repeat(74)}\n`);
process.exit(fallos.length === 0 ? 0 : 1);
