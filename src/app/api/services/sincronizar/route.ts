import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { compararCatalogo, compararFilas } from "@/lib/catalogo-diff";
import {
  appointmentsEnabledFor,
  createService,
  listServices,
  listStaff,
  setEspecialistasDeServicio,
  updateService,
} from "@/server/appointments/queries";

export const dynamic = "force-dynamic";

/**
 * Poner al día el catálogo desde la lista que escribió el cliente.
 *
 * **Por qué existe**: la lista de servicios se escribe en un sitio (el alta, el
 * generador de prompts) y se usa en otro (esta pantalla, donde se marca quién
 * atiende cada cosa). No se hablaban. Si el cliente añadía un servicio a su
 * lista no aparecía en las casillas de las especialistas —y lo que nadie
 * atiende no se puede agendar—; si lo quitaba, se seguía ofreciendo.
 *
 * Dos pasos, siempre en este orden:
 *
 * 1. `POST { texto }` → devuelve **en qué se diferencian** las dos listas. No
 *    escribe nada.
 * 2. `POST { crear, actualizar, archivar }` → aplica solo lo que la persona
 *    marcó en pantalla.
 *
 * Separados a propósito: retirar un servicio o cambiarle el precio afecta a lo
 * que se le cobra a una clienta y a citas ya agendadas. Nada de eso puede pasar
 * por que alguien pegue un texto.
 */

/*
 * `accion` es obligatoria y discrimina: sin ella, un cuerpo mal formado para
 * comparar encajaría en el esquema de aplicar (que tiene todo por defecto) y la
 * respuesta sería un tranquilizador "0 creados" en vez de un error.
 */
const comparar = z.object({
  accion: z.literal("comparar"),
  /** La lista tal cual la escribió el cliente… */
  texto: z.string().max(100_000).optional(),
  /** …o las filas YA revisadas y corregidas en pantalla. */
  filas: z
    .array(
      z.object({
        nombre: z.string().trim().min(1).max(120),
        categoria: z.string().trim().max(60).nullish(),
        precio: z.number().nullable(),
        duracionMin: z.number().int().nullable(),
      })
    )
    .max(200)
    .optional(),
  duracionTipicaMin: z.number().int().min(5).max(600).default(60),
});

const aplicar = z.object({
  accion: z.literal("aplicar"),
  crear: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        category: z.string().trim().max(60).nullish(),
        priceCents: z.number().int().min(0).max(100_000_000),
        durationMin: z.number().int().min(5).max(600),
        /** Quién lo atiende. Vacío = queda sin nadie y NO se podrá agendar. */
        staffIds: z.array(z.string()).max(50).default([]),
      })
    )
    .max(200)
    .default([]),
  actualizar: z
    .array(
      z.object({
        id: z.string(),
        priceCents: z.number().int().min(0).max(100_000_000),
        durationMin: z.number().int().min(5).max(600),
      })
    )
    .max(200)
    .default([]),
  /** Se archivan, nunca se borran: sus citas pasadas siguen teniendo sentido. */
  archivar: z.array(z.string()).max(200).default([]),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!(await appointmentsEnabledFor(session.organizationId))) {
    return apiError(403, "forbidden", "Este cliente no tiene el vertical de citas activo");
  }

  const body = await parseBody(req, z.discriminatedUnion("accion", [comparar, aplicar]));
  if (!body.ok) return body.response;

  if (body.data.accion === "comparar") {
    const guardados = await listServices(session.organizationId);
    const filas = body.data.filas;
    const diff = filas
      ? compararFilas({
          filas: filas.map((f) => ({
            nombre: f.nombre,
            categoria: f.categoria ?? null,
            precio: f.precio,
            duracionMin: f.duracionMin,
          })),
          guardados,
        })
      : compararCatalogo({
          texto: body.data.texto ?? "",
          guardados,
          duracionTipicaMin: body.data.duracionTipicaMin ?? 60,
        });
    // El personal viaja con el diff para poder marcar ahí mismo quién atiende
    // lo nuevo, sin ir persona por persona buscando la casilla.
    const staff = await listStaff(session.organizationId);
    return Response.json({ ...diff, staff: staff.map((s) => ({ id: s.id, name: s.name })) });
  }

  // `parseBody` entrega el tipo de ENTRADA del esquema, donde lo que tiene
  // `.default()` sigue siendo opcional: se normaliza aquí en vez de repetir
  // interrogaciones en cada uso.
  const aCrear = body.data.crear ?? [];
  const aActualizar = body.data.actualizar ?? [];
  const aArchivar = body.data.archivar ?? [];

  const creados: string[] = [];
  const fallidos: string[] = [];
  for (const s of aCrear) {
    const row = await createService(session.organizationId, {
      name: s.name,
      category: s.category ?? null,
      priceCents: s.priceCents,
      durationMin: s.durationMin,
    });
    if (!row) {
      fallidos.push(s.name);
      continue;
    }
    const staffIds = s.staffIds ?? [];
    if (staffIds.length) {
      await setEspecialistasDeServicio(session.organizationId, row.id, staffIds);
    }
    creados.push(row.name);
  }

  for (const c of aActualizar) {
    await updateService(session.organizationId, c.id, {
      priceCents: c.priceCents,
      durationMin: c.durationMin,
    });
  }

  for (const id of aArchivar) {
    await updateService(session.organizationId, id, { archivedAt: new Date() });
  }

  return Response.json({
    creados,
    fallidos,
    actualizados: aActualizar.length,
    archivados: aArchivar.length,
  });
});
