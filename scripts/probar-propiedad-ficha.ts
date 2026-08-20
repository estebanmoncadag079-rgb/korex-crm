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
import { compararFila, explicar, type Fila } from "@/server/ai/generador/comparar-fila";
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
// `getDb()` valida el entorno ENTERO al primer uso, no solo lo que este script
// toca: sin las dos últimas se muere con "Variables de entorno inválidas"
// antes de llegar a comprobar nada.
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

/**
 * Lo que manda el CUESTIONARIO al reenviarse — el pago hostil de verdad.
 *
 * ⚠️ **No trae los campos del operador**, y es a propósito: reproduce el
 * formulario que sale en blanco, que es lo que le vació las reglas de flujo a
 * un negocio el 15-ago-2026. Que falten (`undefined`) y no que vengan vacíos
 * es justo la distinción que decide si se conservan:
 *
 *   no lo manda    → no lo tocó        → se conserva
 *   lo manda vacío → lo borró queriendo → se borra
 *
 * Desde el 20-ago el cuestionario puede escribir las TRES secciones —pregunta
 * el saludo, las reglas y el escalado, y descartarlos en silencio era el fallo
 * que se vino a arreglar—, así que lo que protege ya no es prohibirle tocarlas:
 * es que omitir no borre. Esta prueba existe para demostrarlo con esa puerta
 * abierta de par en par.
 */
const DEL_CUESTIONARIO = {
  ...FICHA_COMPLETA,
  reglasPropias: undefined,
  saludoInicial: undefined,
  escalarSiempre: undefined,
  nuncaPrometer: undefined,
} as unknown as FichaDelNegocio;

const db = getDb();
let organizationId = "";

/**
 * La FILA COMPLETA, no una lista de campos.
 *
 * La versión anterior de esta función leía cinco columnas escogidas a mano, y
 * por eso no vio que `aplicarFicha` revertía el horario del salón el 15-ago a
 * las 19:46. Una lista comprueba lo que ya sabes que se rompe.
 */
const leerPerfil = async (): Promise<Fila> => {
  const [p] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  return p as unknown as Fila;
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

  // 2. Antes de nada: agente encendido y catálogo EN TABLAS.
  //
  // Lo segundo va aquí y no después a propósito. Reenviar el cuestionario de un
  // cliente con el catálogo en tablas volvía a embeberlo en el prompt (+698
  // caracteres en La Churra, la carta duplicada) porque `aplicarFicha` no se
  // había enterado de la Fase 1. Sin este caso la prueba pasaba y el fallo
  // seguía vivo; y si la bandera se cambia DESPUÉS de generar el prompt, se
  // comparan dos escenarios distintos y la prueba miente al revés.
  await db
    .update(schema.agentProfile)
    .set({ enabled: true, catalogSource: "tabla" })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  // La agencia aplica la ficha completa (las tres secciones)
  await aplicarFicha(organizationId, FICHA_COMPLETA, {
    puedeEscribir: ["negocio", "flujo", "politicas"],
  });
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
  // Las MISMAS opciones que usa la ruta del cuestionario. Con `["negocio"]` la
  // prueba pasaba por una razón que ya no es la de producción.
  const resultado = await aplicarFicha(organizationId, DEL_CUESTIONARIO, {
    puedeEscribir: ["negocio", "flujo", "politicas"],
  });
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

  // La comprobación que manda: reenviar el cuestionario solo puede tocar lo que
  // el cuestionario declara suyo. Cualquier otra columna que cambie, aborta.
  const DECLARADOS = ["ficha", "instructions", "greeting", "escalationRules", "name", "tone", "updatedAt"];
  const filaEntera = compararFila(antes, despues, DECLARADOS);
  console.log(`
--- FILA COMPLETA (la regla nueva) ---`);
  console.log(explicar(filaEntera));

  console.log(`${"─".repeat(72)}`);
  console.log(
    comprobacion.ok && reglasIntactas && sigueConvertida && filaEntera.ok
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
