import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { aplicarFicha } from "@/server/ai/generador/aplicar";
import { faltantesDeLaFicha } from "@/server/ai/generador/ficha";
import { appointmentsEnabledFor } from "@/server/appointments/queries";
import { verticalDe } from "@/server/vertical";
import { generarPerfil } from "@/server/ai/generador/generar";
import { findOrganization } from "@/server/admin/clients";

export const dynamic = "force-dynamic";

/**
 * Configurar un cliente desde su ficha (la del cuestionario).
 *
 * Sustituye a los cuatro comandos SQL sueltos que había que ejecutar a mano en
 * cada alta (prompt, horario, teléfonos de aviso y conocimiento), que era donde
 * se perdían horas y se colaban olvidos.
 *
 * `?vistaPrevia=1` genera el prompt y lo devuelve **sin guardar nada**: sirve
 * para leerlo antes de aplicarlo, que es justo lo que hay que hacer con un
 * cliente que ya está vendiendo.
 */

const horario = z.object({
  dias: z.array(z.number().int().min(1).max(7)).min(1),
  abre: z.string().regex(/^\d{1,2}:\d{2}$/, "usa el formato HH:MM"),
  cierra: z.string().regex(/^\d{1,2}:\d{2}$/, "usa el formato HH:MM"),
  abreDomingo: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  cierraDomingo: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
});

const fichaSchema = z.object({
  nombre: z.string().min(1),
  queVende: z.string().min(1),
  ubicacion: z.string().optional(),
  horario,
  vertical: z.enum(["pedidos", "citas"]),
  catalogo: z.string().optional(),
  /** Solo citas: duración de los servicios que no traigan la suya en la lista. */
  duracionTipicaMin: z.number().int().min(5).max(600).optional(),
  variantes: z.string().optional(),
  entrega: z.object({
    haceDomicilios: z.boolean(),
    como: z.string().optional(),
    quienPagaElDomicilio: z.string().optional(),
    restricciones: z.string().optional(),
    recogerEnLocal: z.string().optional(),
  }),
  pago: z.object({
    formas: z.string().min(1),
    datosDeCuenta: z.string().optional(),
    compruebaUnaPersona: z.boolean(),
  }),
  tono: z.string().min(1),
  regalos: z.string().optional(),
  saludoInicial: z.string().optional(),
  reglasPropias: z.array(z.string()).optional(),
  // Sin `.default([])`: ahí zod deja el campo opcional en la ENTRADA y el tipo
  // resultante ya no encaja con FichaDelNegocio, que los exige. Se piden
  // siempre, aunque vengan vacíos — que es una respuesta válida.
  preguntasFrecuentes: z.array(
    z.object({ pregunta: z.string(), respuesta: z.string() })
  ),
  escalarSiempre: z.array(z.string()),
  nuncaPrometer: z.array(z.string()),
});

const cuerpo = z.object({
  ficha: fichaSchema,
  /** Teléfonos a los que avisar de cada pedido. Vacío es válido y deliberado. */
  telefonosDeAviso: z.array(z.string()).optional(),
});

export const POST = withPlatformAdmin(
  async (session, req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;

    // Que la organización exista se comprueba ANTES de generar nada: un id mal
    // escrito no debe acabar en un update silencioso que no toca ninguna fila.
    if (!(await findOrganization(id))) {
      return apiError(404, "not_found", "Esa organización no existe");
    }

    const body = await parseBody(req, cuerpo);
    if (!body.ok) return body.response;

    const faltan = faltantesDeLaFicha(body.data.ficha);
    if (faltan.length > 0) {
      return apiError(
        422,
        "ficha_incompleta",
        `Falta por responder: ${faltan.join(", ")}.`
      );
    }

    /*
     * Vista previa: generar y devolver, sin tocar la base.
     *
     * Con el vertical CONTRATADO, no con el que diga la ficha: si no, la vista
     * previa enseñaría un prompt distinto del que se va a guardar — y el sitio
     * donde se revisa un prompt es justo donde no puede mentir.
     */
    if (new URL(req.url).searchParams.get("vistaPrevia")) {
      const perfil = generarPerfil(body.data.ficha, {
        vertical: verticalDe(await appointmentsEnabledFor(id)),
      });
      return Response.json({ vistaPrevia: true, perfil });
    }

    const resultado = await aplicarFicha(id, body.data.ficha, {
      // Desde /admin actúa la AGENCIA, que es la dueña del flujo y las
      // políticas. El cuestionario del cliente solo puede tocar `negocio`.
      puedeEscribir: ["negocio", "flujo", "politicas"],
      actor: `user:${session.userId}`,
      telefonosDeAviso: body.data.telefonosDeAviso,
    });
    return Response.json({
      ...resultado,
      // Se recuerda en la respuesta porque es el paso que más se olvida y el
      // que más caro sale saltarse.
      aviso:
        "El agente queda APAGADO. Pruébalo con `pnpm probar:agente` y enciéndelo desde Ajustes cuando estés conforme.",
    });
  }
);
