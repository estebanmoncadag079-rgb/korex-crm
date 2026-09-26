import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  aplicarFicha,
  guardarBorrador,
  leerBorrador,
} from "@/server/ai/generador/aplicar";
import { advertenciasDeFicha } from "@/server/ai/generador/deteccion-mezcla";
import {
  faltantesDeLaFicha,
  fusionarRequisitosDelCatalogo,
  idDeOpcionDeMenu,
  REQUISITOS_DISPONIBLES,
  type FichaDelNegocio,
  type OpcionDeMenu,
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
 * "Datos que deben solicitarse antes de confirmar" solo deja marcar/desmarcar
 * el catálogo fijo de esta pantalla (`REQUISITOS_DISPONIBLES`) — los que se
 * guardan en el contacto. `id` es `string` a propósito, NO un enum de ese
 * catálogo: un negocio de pedidos con domicilio puede tener además
 * "direccion" declarado por otra vía (`requisitosSugeridos`/
 * `migrar:requisitos`, ver ficha.ts), y el borrador que este formulario
 * recarga trae ese requisito completo aunque esta pantalla no lo pregunte.
 * Un enum estricto aquí bloqueaba con un 400 CUALQUIER guardado de ese
 * negocio, incluso sin tocar nada (25-ago-2026, Lis). El POST más abajo es
 * quien preserva lo que este catálogo no cubre.
 */
const requisitoSchema = z.object({ id: z.string() });

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
      /*
       * EL CANÓNICO. Sin declararlo aquí, zod lo descarta EN SILENCIO —el
       * mismo fallo que ya se documentó con `duracionTipicaMin` tres líneas
       * más abajo— y el horario que la persona marca día a día en su
       * pantalla no llegaría nunca a la base. Los campos de abajo son sus
       * derivados y los recalcula el servidor al guardar.
       */
      porDia: z.record(z.string(), z.object({
      abre: z.string(),
      cierra: z.string(),
    })).optional(),
      dias: z.array(z.number().int().min(1).max(7)),
      abre: z.string(),
      cierra: z.string(),
      abreDomingo: z.string().optional(),
      cierraDomingo: z.string().optional(),
    }),
    /*
     * Contexto libre sobre el horario. Sin declararlo, zod lo descarta EN
     * SILENCIO y lo que el negocio escriba no llega nunca — el mismo fallo
     * que ya costó `duracionTipicaMin` y `porDia`.
     */
    observacionesHorario: z.string().max(2000).optional(),
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
    // Pedido minimo para domicilio, en centavos. Declararlo aqui NO es
    // opcional: Zod descarta en silencio lo que no esta en el esquema, y un
    // campo que la pantalla guarda pero la ruta tira deja la funcionalidad
    // decorativa (paso con `porDia`, 20-sep-2026).
    minimoDomicilioCents: z.number().int().nonnegative().optional(),
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
      // Doc 200: formas de pago por modalidad y cuándo se da la cuenta.
      porModalidad: z
        .object({
          domicilio: z.array(z.enum(["transferencia", "efectivo", "tarjeta"])).optional(),
          recoger: z.array(z.enum(["transferencia", "efectivo", "tarjeta"])).optional(),
        })
        .optional(),
      cuentaAntesDeConfirmar: z.enum(["si_la_piden", "nunca"]).optional(),
    }),
    tono: z.string(),
    // Doc 200: conducta que decide el negocio y mensajes que el bot envía tal cual.
    politicaDeCancelacion: z.string().max(2000).optional(),
    fueraDeHorario: z.object({ tomaPedidos: z.boolean() }).optional(),
    respuestaAPublicaciones: z.enum(["responder", "pasar_al_equipo"]).optional(),
    mensajes: z
      .object({
        derivar: z.string().max(500).optional(),
        fueraDeHorario: z.string().max(500).optional(),
        pedirBarrio: z.string().max(500).optional(),
        domicilioPendiente: z.string().max(500).optional(),
      })
      .optional(),
    regalos: z.string(),
    saludoInicial: z.string(),
    /*
     * El menú guiado de WhatsApp (25-ago-2026): aquí solo las etiquetas de
     * texto que escribe el dueño. El servidor deriva el `id` de cada una
     * (`idDeOpcionDeMenu`) recién al aplicar la ficha — igual que
     * `cierre.requisitos` solo trae el id y el servidor completa el resto.
     */
    menu: z.object({ opciones: z.array(z.string()) }).optional(),
    reglasPropias: z.array(z.string()),
    preguntasFrecuentes: z.array(preguntaSchema),
    escalarSiempre: z.array(z.string()),
    nuncaPrometer: z.array(z.string()),
    /*
     * `requisitos`: qué debe recoger el agente antes de cerrar — solo el id;
     * tipo/etiqueta/obligatorio los pone el servidor al aplicar (ver el POST
     * más abajo). `pagoAntesDeLaCita`: solo aparece en el paso "Cómo te
     * pagan" cuando el vertical es citas — optional a propósito, para que un
     * negocio de pedidos no lo mande nunca y no haya nada que preservar.
     */
    cierre: z.object({
      requisitos: z.array(requisitoSchema),
      pagoAntesDeLaCita: z.boolean().optional(),
    }),
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
    advertenciasContenido: advertenciasDeFicha(borrador),
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
   * `cierre` lleva `requisitos` y `pagoAntesDeLaCita`, los dos editados
   * desde este mismo paso ahora (25-ago-2026). `fusionarFicha` fusiona por
   * SECCIÓN completa (`flujo`), no campo a campo dentro de `cierre` — así
   * que construir `cierre` a mano aquí, sin partir de lo ya guardado,
   * borraría lo que no se reconstruya explícitamente.
   *
   * `pagoAntesDeLaCita` es `undefined` cuando el vertical es pedidos (ese
   * checkbox ni se muestra): el `??` conserva ahí lo que ya hubiera, en vez
   * de apagarlo por accidente cada vez que alguien reenvía el cuestionario.
   */
  const fichaPrevia = await leerBorrador(session.organizationId);
  const requisitos = fusionarRequisitosDelCatalogo(
    body.data.borrador.cierre?.requisitos ?? [],
    fichaPrevia.cierre?.requisitos
  );
  /*
   * El menú guiado (25-ago-2026): el borrador solo trae etiquetas de texto;
   * aquí se les pone un `id` derivado y estable. Vacío se omite del todo
   * (`undefined`), igual que cualquier otro campo opcional de la ficha — sin
   * esto, `ficha.menu = { opciones: [] }` seguiría pasando la comprobación
   * de "¿hay menú?" en otros sitios que solo miran si la clave existe.
   */
  const etiquetasDeMenu = (body.data.borrador.menu?.opciones ?? [])
    .map((e) => e.trim())
    .filter(Boolean);
  const menu = etiquetasDeMenu.length
    ? {
        opciones: etiquetasDeMenu.reduce<OpcionDeMenu[]>((acc, etiqueta) => {
          const id = idDeOpcionDeMenu(etiqueta, new Set(acc.map((o) => o.id)));
          acc.push({ id, etiqueta });
          return acc;
        }, []),
      }
    : undefined;
  const borradorConCierre: FichaDelNegocio = {
    ...borrador,
    menu,
    cierre: {
      ...fichaPrevia.cierre,
      requisitos,
      pagoAntesDeLaCita:
        body.data.borrador.cierre?.pagoAntesDeLaCita ?? fichaPrevia.cierre?.pagoAntesDeLaCita,
    },
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
    // Informativo, nunca bloqueante — aplicarFicha() ya se ejecutó arriba
    // aunque haya advertencias: el negocio queda configurado igual.
    advertenciasContenido: advertenciasDeFicha(borradorConCierre),
  });
});
