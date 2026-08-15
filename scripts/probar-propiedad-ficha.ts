/**
 * La prueba de extremo a extremo que exigió el dueño antes de convertir a nadie
 * ([68-UN-DUENO-POR-DATO.md](../docs/korexia/68-UN-DUENO-POR-DATO.md)):
 *
 *   ficha original → convertir → reenviar cuestionario → prompt final = anterior
 *
 * Se ejecuta contra un **cliente de prueba que este script crea y borra**, no
 * contra un negocio real: la garantía hay que verla en la base de verdad, pero
 * no a costa de un cliente que factura.
 *
 * Uso:
 *   pnpm probar:propiedad
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { aplicarFicha } from "@/server/ai/generador/aplicar";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import { aSecciones, leerFicha } from "@/server/ai/generador/leer-ficha";
import { verificarAntesDeMigrar } from "@/server/ai/generador/verificar-migracion";
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
const correoDePrueba = `prueba-propiedad-${marca}@ejemplo.invalid`;
const FICHA_COMPLETA = {
  nombre: `PRUEBA propiedad ${marca}`,
  queVende: "churros de prueba",
  vertical: "pedidos",
  horario: { dias: [1, 2, 3, 4, 5], abre: "12:30", cierra: "20:30" },
  catalogo: "CHURRITA — $10.000",
  entrega: {
    haceDomicilios: true,
    como: "domicilio propio",
    quienPagaElDomicilio: "el cliente, al recibir",
  },
  pago: { formas: "efectivo y Nequi", datosDeCuenta: "Nequi 300 000 0000" },
  tono: "cercano",
  // Lo del OPERADOR, que el cuestionario no puede tocar:
  reglasPropias: [
    "Un pedido completo son CINCO mensajes tuyos, ni uno más.",
    'Si el cliente escribe "0", reinicia como si fuera la primera vez.',
  ],
  saludoInicial: "¡Hola! Estas son nuestras presentaciones:",
  escalarSiempre: ["reclamos"],
  nuncaPrometer: ["tiempos de entrega exactos"],
} as unknown as FichaDelNegocio;

/** Lo que manda el CLIENTE: sus datos, sin nada del operador. */
const DEL_CUESTIONARIO = {
  ...FICHA_COMPLETA,
  reglasPropias: [],
  saludoInicial: undefined,
  escalarSiempre: [],
  nuncaPrometer: [],
} as unknown as FichaDelNegocio;

const db = getDb();
let organizationId = "";

const leerPerfil = async () => {
  const [p] = await db
    .select({
      instructions: schema.agentProfile.instructions,
      greeting: schema.agentProfile.greeting,
      escalationRules: schema.agentProfile.escalationRules,
      enabled: schema.agentProfile.enabled,
      appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
      ficha: schema.agentProfile.ficha,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  return p!;
};

try {
  console.log(`\n${"=".repeat(72)}`);
  console.log("PRUEBA DE PROPIEDAD DE LA FICHA — sobre un cliente de prueba");
  console.log(`${"=".repeat(72)}`);

  // 1. Cliente de prueba
  const creado = await createClientWithOwner({
    organizationName: `PRUEBA propiedad ${marca}`,
    ownerName: "Prueba",
    ownerEmail: correoDePrueba,
    password: `Prueba-${marca}-x9`,
  });
  organizationId = creado.organizationId;
  console.log(`\n1. cliente de prueba creado: ${organizationId}`);

  // 2. La agencia aplica la ficha completa (las tres secciones)
  await aplicarFicha(organizationId, FICHA_COMPLETA, {
    puedeEscribir: ["negocio", "flujo", "politicas"],
  });
  // El cliente enciende su agente: así se comprueba que el cuestionario no lo apaga.
  await db
    .update(schema.agentProfile)
    .set({ enabled: true })
    .where(eq(schema.agentProfile.organizationId, organizationId));
  const antes = await leerPerfil();
  console.log(`2. ficha aplicada · prompt ${antes.instructions?.length} caracteres · enabled=${antes.enabled}`);

  // 3. Conversión a secciones (lo que hará el paso 3)
  const fichaLeida = leerFicha(antes.ficha)!;
  await db
    .update(schema.agentProfile)
    .set({ ficha: JSON.stringify(aSecciones(fichaLeida)) })
    .where(eq(schema.agentProfile.organizationId, organizationId));
  console.log("3. ficha CONVERTIDA a secciones");

  // 4. El cliente reenvía su cuestionario (solo posee `negocio`)
  const resultado = await aplicarFicha(organizationId, DEL_CUESTIONARIO);
  console.log(
    `4. cuestionario reenviado · se conservó: ${resultado.seccionesConservadas.join(", ") || "(nada)"}`
  );

  // 5. El veredicto
  const despues = await leerPerfil();
  const comprobacion = verificarAntesDeMigrar(
    {
      instructions: antes.instructions,
      greeting: antes.greeting,
      escalationRules: antes.escalationRules,
      enabled: antes.enabled,
      appointmentsEnabled: antes.appointmentsEnabled,
    },
    {
      instructions: despues.instructions,
      greeting: despues.greeting,
      escalationRules: despues.escalationRules,
      enabled: despues.enabled,
      appointmentsEnabled: despues.appointmentsEnabled,
    }
  );

  console.log(`\n${"─".repeat(72)}`);
  console.log(`prompt   : ${antes.instructions?.length} → ${despues.instructions?.length}  ${comprobacion.detalle.prompt ? "✅ IDÉNTICO" : "🔴 CAMBIÓ"}`);
  console.log(`saludo   : ${comprobacion.detalle.saludo ? "✅" : "🔴"}`);
  console.log(`escalado : ${comprobacion.detalle.escalado ? "✅" : "🔴"}`);
  console.log(`enabled  : ${antes.enabled} → ${despues.enabled}  ${comprobacion.detalle.enabled ? "✅" : "🔴"}`);
  console.log(`citas    : ${antes.appointmentsEnabled} → ${despues.appointmentsEnabled}  ${comprobacion.detalle.appointmentsEnabled ? "✅" : "🔴"}`);

  const fichaFinal = leerFicha(despues.ficha)!;
  const reglasIntactas =
    JSON.stringify(fichaFinal.reglasPropias) === JSON.stringify(FICHA_COMPLETA.reglasPropias);
  console.log(`reglas de flujo del operador: ${reglasIntactas ? "✅ INTACTAS" : "🔴 SE PERDIERON"}`);
  const sigueConvertida = despues.ficha?.includes('"schema_version"') ?? false;
  console.log(`formato de la ficha: ${sigueConvertida ? "✅ sigue por secciones" : "🔴 volvió a plana"}`);

  console.log(`${"─".repeat(72)}`);
  console.log(
    comprobacion.ok && reglasIntactas && sigueConvertida
      ? "\n✅ PASA: reenviar el cuestionario NO cambió el prompt ni tocó lo ajeno."
      : `\n🔴 FALLA:\n   - ${[...comprobacion.fallos, ...(reglasIntactas ? [] : ["se perdieron las reglas de flujo"])].join("\n   - ")}`
  );
} finally {
  if (organizationId) {
    // El cliente de prueba se borra SIEMPRE, salga como salga la prueba.
    //
    // Y el USUARIO también: borrar la organización no se lo lleva por delante
    // —no cuelga de ella—, así que la primera corrida dejó una cuenta huérfana
    // en producción. Una prueba que ensucia la base no es una prueba limpia.
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
    await db.delete(schema.user).where(eq(schema.user.email, correoDePrueba));
    console.log(`\n🧹 cliente y usuario de prueba borrados (${organizationId})`);
  }
}

process.exit(0);
