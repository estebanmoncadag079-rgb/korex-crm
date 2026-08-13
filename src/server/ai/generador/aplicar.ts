import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { leerCatalogoPegado } from "@/lib/catalogo-texto";
import { normalizarHora } from "@/lib/hora";
import { faltantesDeLaFicha, type FichaDelNegocio } from "./ficha";
import { generarPerfil } from "./generar";

/**
 * Deja un cliente configurado a partir de su ficha, en una sola operación.
 *
 * Es la mitad del alta que hasta ahora se hacía **a mano por SQL** (pasos 3 a 6
 * de [05-CLIENTES.md]): el prompt, el horario, los teléfonos de aviso y el
 * conocimiento. Eran cuatro comandos sueltos que había que recordar, y olvidar
 * uno dejaba al cliente a medio configurar sin que nada avisara.
 *
 * Todo va en **una transacción**: si algo falla, no queda un cliente con el
 * prompt puesto y el horario sin poner, que es el peor estado posible — el
 * agente atendería creyendo que siempre está abierto.
 */

export type ResultadoDelAlta = {
  organizationId: string;
  /** Caracteres del prompt generado, para enseñarlo en la pantalla. */
  largoDelPrompt: number;
  /** Cuántas preguntas frecuentes se cargaron al conocimiento. */
  entradasDeConocimiento: number;
  /** Servicios creados en el catálogo (solo en el vertical de citas). */
  serviciosCreados: number;
};

/**
 * El borrador de la ficha, mientras el cliente la va llenando.
 *
 * Se guarda en `organization.metadata` (que ya existe y es JSON) para no añadir
 * una tabla por algo que se usa una vez en la vida de cada cliente.
 *
 * Existe porque el formulario se llena **por etapas y a lo largo de días**: un
 * dueño de negocio no se sienta 40 minutos a responder de un tirón. Sin
 * guardado parcial cierra la pestaña en la etapa 4, lo pierde todo y no vuelve.
 */
export async function guardarBorrador(
  organizationId: string,
  borrador: Partial<FichaDelNegocio>
): Promise<void> {
  const db = getDb();
  const filas = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);

  // Se conserva lo que ya hubiera en metadata (la marca white-label vive ahí):
  // esto AÑADE una clave, no reemplaza el objeto entero.
  let meta: Record<string, unknown> = {};
  try {
    meta = filas[0]?.metadata ? JSON.parse(filas[0].metadata) : {};
  } catch {
    meta = {};
  }

  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify({ ...meta, fichaBorrador: borrador }) })
    .where(eq(schema.organization.id, organizationId));
}

/** El borrador guardado, o `{}` si aún no hay nada. */
export async function leerBorrador(
  organizationId: string
): Promise<Partial<FichaDelNegocio>> {
  const db = getDb();
  const filas = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  try {
    const meta = filas[0]?.metadata
      ? (JSON.parse(filas[0].metadata) as Record<string, unknown>)
      : {};
    return (meta.fichaBorrador as Partial<FichaDelNegocio>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Aplica la ficha sobre una organización que ya existe.
 *
 * La organización y su dueño se crean antes con `createClientWithOwner`, que ya
 * deja el `agent_profile` vacío y las etapas del pipeline puestas.
 *
 * ⚠️ **El agente queda APAGADO** (`enabled: false`). Encenderlo es un acto
 * deliberado y va después de probar: es el paso 8 del alta, y saltárselo fue lo
 * que enseñó `05-CLIENTES.md` que no hay que hacer. Un agente que empieza a
 * responder antes de que nadie haya visto una conversación de prueba es un
 * cliente enfadado esperando a que pase.
 */
export async function aplicarFicha(
  organizationId: string,
  ficha: FichaDelNegocio,
  opciones?: { telefonosDeAviso?: string[] }
): Promise<ResultadoDelAlta> {
  const faltan = faltantesDeLaFicha(ficha);
  if (faltan.length > 0) {
    throw new Error(`Faltan datos en la ficha: ${faltan.join(", ")}.`);
  }

  const perfil = generarPerfil(ficha);
  const db = getDb();
  let serviciosCreados = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.agentProfile)
      .set({
        name: `Asistente de ${ficha.nombre}`,
        tone: ficha.tono.trim(),
        instructions: perfil.instructions,
        escalationRules: perfil.escalationRules,
        greeting: perfil.greeting,
        hoursDays: ficha.horario.dias.join(","),
        // Se guarda YA normalizado a "HH:MM": el cliente escribe "9 AM" y el
        // motor de citas necesita "09:00". Guardar el texto crudo dejaba la
        // agenda sin un solo hueco, en silencio (ver `lib/hora.ts`).
        hoursOpen: normalizarHora(ficha.horario.abre) ?? ficha.horario.abre,
        hoursClose: normalizarHora(ficha.horario.cierra) ?? ficha.horario.cierra,
        hoursOpenSunday: normalizarHora(ficha.horario.abreDomingo) ?? null,
        hoursCloseSunday: normalizarHora(ficha.horario.cierraDomingo) ?? null,
        // Vacío es una decisión válida y hay que poder expresarla: Lis pidió
        // expresamente que no se avisara a ningún número, ni al suyo.
        notifyPhones: (opciones?.telefonosDeAviso ?? []).join(",") || null,
        appointmentsEnabled: ficha.vertical === "citas",
        enabled: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentProfile.organizationId, organizationId));

    // El conocimiento se REEMPLAZA, no se acumula: si se corrige la ficha y se
    // vuelve a aplicar, no deben quedar las respuestas viejas conviviendo con
    // las nuevas — el agente daría dos versiones del mismo dato.
    await tx
      .delete(schema.kbEntry)
      .where(eq(schema.kbEntry.organizationId, organizationId));

    const preguntas = ficha.preguntasFrecuentes.filter(
      (p) => p.pregunta.trim() && p.respuesta.trim()
    );
    if (preguntas.length > 0) {
      await tx.insert(schema.kbEntry).values(
        preguntas.map((p) => ({
          id: newId("kbEntry"),
          organizationId,
          kind: "qa" as const,
          question: p.pregunta.trim(),
          answer: p.respuesta.trim(),
        }))
      );
    }

    /*
     * Los servicios de un negocio de citas nacen aquí.
     *
     * Antes el alta los ignoraba —el catálogo de citas vive en `service`, no en
     * el prompt— y el salón terminaba su configuración sin un solo servicio,
     * sin que nada se lo advirtiera: su agente no sabía qué ofrecía ni a qué
     * precio. Cargarlos de uno en uno era la única puerta, y con 46 no la cruza
     * nadie.
     *
     * Solo se crean si NO tiene ya catálogo: aplicar la ficha dos veces no
     * puede duplicarle los 46 servicios. Corregirlos, ampliarlos o borrarlos se
     * hace en la pantalla de Servicios, que es donde se ven con sus duraciones.
     */
    if (ficha.vertical === "citas" && ficha.catalogo?.trim()) {
      const yaTiene = await tx
        .select({ id: schema.service.id })
        .from(schema.service)
        .where(eq(schema.service.organizationId, organizationId))
        .limit(1);

      if (!yaTiene[0]) {
        const tipica = ficha.duracionTipicaMin ?? 60;
        const filas = leerCatalogoPegado(ficha.catalogo).filter((f) => f.nombre);
        if (filas.length > 0) {
          await tx.insert(schema.service).values(
            filas.map((f) => ({
              id: newId("service"),
              organizationId,
              name: f.nombre.slice(0, 120),
              category: f.categoria?.slice(0, 60) ?? null,
              priceCents: Math.round((f.precio ?? 0) * 100),
              // La duración de la línea manda; si no la trae, la típica que dio
              // el cliente. Nunca queda sin duración: sin ella no hay agenda.
              durationMin: f.duracionMin ?? tipica,
            }))
          );
          serviciosCreados = filas.length;
        }
      }
    }
  });

  return {
    organizationId,
    largoDelPrompt: perfil.instructions.length,
    entradasDeConocimiento: ficha.preguntasFrecuentes.filter(
      (p) => p.pregunta.trim() && p.respuesta.trim()
    ).length,
    serviciosCreados,
  };
}
