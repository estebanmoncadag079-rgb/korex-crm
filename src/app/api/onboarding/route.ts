import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  aplicarFicha,
  guardarBorrador,
  leerBorrador,
} from "@/server/ai/generador/aplicar";
import {
  faltantesDeLaFicha,
  REQUISITOS_DISPONIBLES,
  type FichaDelNegocio,
} from "@/server/ai/generador/ficha";

export const dynamic = "force-dynamic";

/**
 * La configuración inicial, llenada por EL PROPIO CLIENTE.
 *
 * Antes esto era un Word que el cliente devolvía y alguien transcribía a mano.
 * La transcripción era el cuello de botella real del alta: no escalaba porque
 * dependía de una persona, y cada paso a mano era una oportunidad de error.
 * Aquí el dueño del negocio responde en su propia cuenta y el sistema arma su
 * agente solo.
 *
 * **Seguridad**: usa `withAuth`, no `withPlatformAdmin`. La organización sale
 * de la SESIÓN, nunca del cuerpo de la petición, así que un cliente solo puede
 * tocar la suya — aunque manipule lo que envía.
 *
 * - `GET`  → el borrador guardado y qué falta por responder.
 * - `PUT`  → guarda el avance (una etapa) sin aplicar nada.
 * - `POST` → aplica la ficha: genera el prompt y configura el agente.
 */

const preguntaSchema = z.object({ pregunta: z.string(), respuesta: z.string() });

/**
 * Solo lo que "Datos que deben solicitarse antes de confirmar" deja tocar:
 * marcar/desmarcar de un catálogo fijo (`REQUISITOS_DISPONIBLES`). El id es
 * lo único que decide el cliente; `tipo` y `etiqueta` los pone el servidor al
 * aplicar la ficha — mandarlos aquí no cambiaría nada, así que no se piden.
 */
const requisitoSchema = z.object({
  id: z.enum(REQUISITOS_DISPONIBLES.map((r) => r.id) as [string, ...string[]]),
});

/**
 * Laxo a propósito: aquí solo se guarda el avance, y a media ficha casi todo
 * está incompleto. Quien decide si está lista es `faltantesDeLaFicha`, no zod.
 */
const borradorSchema = z
  .object({
    nombre: z.string(),
    queVende: z.string(),
    ubicacion: z.string(),
    horario: z.object({
      dias: z.array(z.number().int().min(1).max(7)),
      abre: z.string(),
      cierra: z.string(),
      abreDomingo: z.string().optional(),
      cierraDomingo: z.string().optional(),
    }),
    vertical: z.enum(["pedidos", "citas"]),
    catalogo: z.string(),
    // Solo citas. Sin declararla aquí, zod la descarta en silencio y todos los
    // servicios nacerían con la duración por defecto.
    duracionTipicaMin: z.number().int().min(5).max(600).optional(),
    variantes: z.string(),
    entrega: z.object({
      haceDomicilios: z.boolean(),
      como: z.string().optional(),
      quienPagaElDomicilio: z.string().optional(),
      restricciones: z.string().optional(),
      recogerEnLocal: z.string().optional(),
    }),
    // Sin declararlo aquí, el cuestionario lo recogería y este esquema lo
    // tiraría en silencio al enviar: el campo existiría en la pantalla y no
    // llegaría nunca a la ficha.
    canales: z
      .array(z.object({ nombre: z.string(), enlace: z.string().optional() }))
      .optional(),
    pago: z.object({
      formas: z.string(),
      datosDeCuenta: z.string().optional(),
      compruebaUnaPersona: z.boolean(),
    }),
    tono: z.string(),
    regalos: z.string(),
    saludoInicial: z.string(),
    reglasPropias: z.array(z.string()),
    preguntasFrecuentes: z.array(preguntaSchema),
    escalarSiempre: z.array(z.string()),
    nuncaPrometer: z.array(z.string()),
    /*
     * Qué debe recoger el agente antes de cerrar — el mismo dato que edita
     * "Datos que deben solicitarse antes de confirmar" en `/api/agent/
     * requisitos`. Ahí solo se manda el id; `tipo`/`etiqueta`/`obligatorio`
     * los pone el servidor al aplicar (ver el POST más abajo), igual que en
     * ese otro endpoint.
     */
    cierre: z.object({ requisitos: z.array(requisitoSchema) }),
  })
  .partial();

export const GET = withAuth(async (session) => {
  const borrador = await leerBorrador(session.organizationId);
  return Response.json({
    borrador,
    faltan: faltantesDeLaFicha(borrador),
    requisitosDisponibles: REQUISITOS_DISPONIBLES.map((r) => ({
      id: r.id,
      etiqueta: r.etiqueta,
    })),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ borrador: borradorSchema }));
  if (!body.ok) return body.response;
  /*
   * `cierre.requisitos` aquí solo trae `{ id }` — el borrador es un avance a
   * medio llenar, no la ficha aplicada. `tipo`/`etiqueta`/`obligatorio` los
   * pone `REQUISITOS_DISPONIBLES` recién en el POST, así que el tipo formal
   * no calza con `Partial<FichaDelNegocio>`; ninguna de las funciones de
   * abajo lee esos tres campos, solo persisten/leen el borrador tal cual.
   */
  const borrador = body.data.borrador as unknown as Partial<FichaDelNegocio>;
  await guardarBorrador(session.organizationId, borrador);
  return Response.json({
    guardado: true,
    faltan: faltantesDeLaFicha(borrador),
  });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ borrador: borradorSchema }));
  if (!body.ok) return body.response;
  const borrador = body.data.borrador as unknown as Partial<FichaDelNegocio>;

  const faltan = faltantesDeLaFicha(borrador);
  if (faltan.length > 0) {
    return apiError(
      422,
      "ficha_incompleta",
      `Antes de terminar falta por responder: ${faltan.join(", ")}.`
    );
  }

  // El borrador se guarda también al aplicar: así queda el registro de lo que
  // respondió el cliente y se puede corregir un dato sin volver a empezar.
  await guardarBorrador(session.organizationId, borrador);

  /*
   * `cierre` lleva DOS datos de dueños distintos: `requisitos` (este paso) y
   * `pagoAntesDeLaCita` (la pantalla de Pago de Citas, `PagoCitasSection`).
   * `fusionarFicha` fusiona por SECCIÓN completa (`flujo`), no campo a campo
   * dentro de `cierre` — así que si aquí solo se manda `{ requisitos }`, eso
   * REEMPLAZARÍA el `cierre` guardado entero y borraría `pagoAntesDeLaCita`
   * sin que nadie lo pidiera. Se preserva explícitamente, mismo patrón que
   * usa `/api/agent/pago-citas` en sentido contrario (preserva `requisitos`
   * al guardar su propio interruptor).
   */
  const fichaPrevia = await leerBorrador(session.organizationId);
  const requisitos = REQUISITOS_DISPONIBLES.filter((r) =>
    (body.data.borrador.cierre?.requisitos ?? []).some((x) => x.id === r.id)
  ).map((r) => ({ ...r, obligatorio: true }));
  const borradorConCierre: FichaDelNegocio = {
    ...borrador,
    cierre: { ...fichaPrevia.cierre, requisitos },
  } as FichaDelNegocio;

  const resultado = await aplicarFicha(
    session.organizationId,
    borradorConCierre,
    {
      // Quién rellenó el cuestionario: el cliente, con nombre y apellidos en el log.
      actor: `user:${session.userId}`,
      /*
       * El cuestionario escribe LO QUE PREGUNTA, y pregunta las tres secciones:
       * el saludo y las reglas propias son `flujo`, y el paso "cuándo debe
       * llamarte a ti" —que él mismo llama la etapa más importante— es entero
       * `politicas`. Con el valor por defecto (`negocio`) esos cuatro campos se
       * descartaban en silencio al reeditar: el cliente los cambiaba y no
       * pasaba nada (20-ago-2026).
       *
       * Se le prohibieron el 15-ago por un motivo real —reenviar el formulario
       * en blanco le vació las reglas de flujo a un negocio—, pero esa causa ya
       * no existe: el formulario se precarga con la ficha aplicada
       * ([117](../../../../docs/korexia/117-EL-CUESTIONARIO-VEIA-VACIO.md)) y
       * `fusionarFicha` conserva lo que no venga. Dos motivos independientes, y
       * hacen falta los dos.
       *
       * Lo que NO cambia: el script del operador sigue sin poder tocar
       * `negocio`. Esa mitad de la regla protege al cliente y sigue en pie.
       */
      puedeEscribir: ["negocio", "flujo", "politicas"],
    }
  );

  return Response.json({
    ...resultado,
    // El agente queda apagado a propósito: lo enciende la agencia después de
    // probarlo. Un cliente no debe poder poner su bot a atender de verdad sin
    // que nadie haya visto una sola conversación de prueba.
    mensaje:
      "¡Listo! Ya tenemos todo para configurar tu asistente. Lo revisamos y lo activamos contigo.",
  });
});
