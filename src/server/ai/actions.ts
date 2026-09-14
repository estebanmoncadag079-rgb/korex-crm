import { z } from "zod";
import { MAX_ITEMS } from "@/server/orders/normalizar";

/** Cuántas reservas independientes admite un solo `book_appointment`. */
const MAX_RESERVAS = 4;

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
export const AgentAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("none") }),
  /**
   * La respuesta que lee el cliente.
   *
   * `deliveryFeeCents` y `totalCents` son OPCIONALES y no cambian lo que se
   * envía: son las cifras que el propio texto menciona, declaradas aparte
   * para que el guardarraíl financiero las compare como NÚMEROS en vez de
   * volver a leer la prosa. Mismos nombres que en `notify_order` a
   * propósito — es el mismo dato, y ahí este patrón nunca ha fallado.
   *
   * Nace de un incidente real (MALIA, 13-sep-2026): a la pregunta *"¿qué
   * vale el pavé de Milo grande con domicilio a Ciudad 2000?"* el backend
   * verificó bien las dos cifras (producto $18.000, zona $8.000) y el
   * modelo respondió el total correcto, $26.000. Pero
   * `dijoOtroValorDeDomicilio` releía el texto, encontraba "$26.000" cerca
   * de la palabra "domicilio", lo comparaba con los $8.000 verificados y
   * concluía que el bot se había inventado la tarifa. Reintento, segundo
   * fallo igual, y la clienta quedó derivada sin respuesta.
   *
   * Con la cifra declarada aparte no hay nada que adivinar: el guardarraíl
   * sabe qué valores son legítimos en ese texto.
   */
  z.object({
    action: z.literal("reply"),
    text: z.string().min(1),
    /**
     * ⚠️ Los dos aceptan `null`, y eso NO es decorativo: `CAMPOS_DE_ACCION`
     * los declara como `["number","null"]`, así que el modelo los manda en
     * `null` siempre que no apliquen (es el contrato plano del modo estricto
     * del proveedor). La primera versión de esto copió `totalCents` de
     * `notify_order` —donde es `.optional()` sin `nullable`— y rompió 6
     * turnos en producción en dos horas: `no cumple el esquema: totalCents
     * Expected number, received null`, cada uno terminando en handoff por
     * `backend_error`. `notify_order` se salva porque su camino pasa por
     * `sinNulos`; el bucle de `consultar_domicilio` llama a `chatJson`
     * directo y no limpia nada.
     */
    deliveryFeeCents: z.number().int().nonnegative().nullable().optional(),
    totalCents: z.number().int().nonnegative().nullable().optional(),
  }),
  z.object({
    action: z.literal("update_lead"),
    note: z.string().min(1),
    reply: z.string().optional(),
  }),
  /**
   * El cliente acaba de dar un dato que este negocio declaró como requisito
   * antes de cerrar (nombre, hoy — ver `server/contacts.ts`, "Requisitos
   * declarados por el negocio").
   *
   * Genérica del núcleo, no de un vertical: ni citas ni pedidos la poseen.
   * Existe por una razón concreta — `update_lead` ya persistía algo del
   * contacto, pero como NOTA LIBRE (`appendLeadNote`); mezclarla con datos
   * ESTRUCTURADOS habría hecho que una sola acción cargara con dos
   * responsabilidades (notas de texto y campos validables). Se separan a
   * propósito (docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md, Regla 11).
   *
   * `requisitoId` tiene que ser uno de los que el negocio declaró — el
   * ejecutor lo rechaza si no, nunca inventa un campo nuevo.
   */
  z.object({
    action: z.literal("provide_requirement"),
    requisitoId: z.string().min(1),
    valor: z.string().min(1),
    /** Para seguir la conversación en el mismo turno — agradecer, retomar lo que se estaba haciendo. */
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("handoff"),
    reason: z.string().optional(),
    farewell: z.string().optional(),
  }),
  /**
   * Pedido cerrado: se registra en el lead, se avisa por WhatsApp al equipo
   * del negocio y la conversación pasa a manos humanas (el agente calla).
   *
   * Fase 10N-J — campos estructurados opcionales (incidente real de
   * Kachipay: al cliente le dijeron "$12.000" de domicilio y el resumen
   * cerró con "$8.000", sin que nada lo detectara). `summary` sigue siendo
   * el texto que ve el EQUIPO por WhatsApp — eso no cambia — pero cuando el
   * negocio tiene `delivery_source='tabla'`, el pipeline EXIGE que estos
   * tres números también vengan aparte, y los verifica antes de aceptar la
   * acción (ver `pipeline.ts`, guardarraíl de consistencia financiera):
   * `totalCents` debe ser exactamente `subtotalCents + (deliveryFeeCents ?? 0)`,
   * y `deliveryFeeCents` debe coincidir con la última zona verificada por
   * `consultar_domicilio` en esta conversación. Opcionales en el schema
   * (no en todos los verticales hay `delivery_zone`) — la obligatoriedad
   * real la impone el guardarraíl, no este tipo.
   */
  z.object({
    action: z.literal("notify_order"),
    summary: z.string().min(1),
    farewell: z.string().optional(),
    subtotalCents: z.number().int().nonnegative().optional(),
    deliveryFeeCents: z.number().int().nonnegative().nullable().optional(),
    totalCents: z.number().int().nonnegative().optional(),
  }),
  /**
   * Mandar una foto que el negocio tiene cargada: la de un producto, su carta,
   * el local.
   *
   * Existe porque hay respuestas que el texto no da bien. Un catálogo de 30
   * servicios escrito en un mensaje de WhatsApp no lo lee nadie, y a "¿cómo se
   * ve el Volumen Ruso?" se responde con la foto del Volumen Ruso.
   *
   * `etiqueta` es como el negocio nombró esa foto al subirla. El servidor la
   * busca entre las suyas y **si no existe degrada a `reply`**: el agente
   * contesta con texto en vez de prometer una imagen que no puede mandar. Es
   * el mismo criterio de los guardarraíles — comprobar el hecho, no confiar en
   * la intención.
   */
  z.object({
    action: z.literal("send_image"),
    etiqueta: z.string().min(1).optional(),
    /**
     * El mismo dato en inglés, porque **el modelo lo escribe así**.
     *
     * Verificado contra el pipeline real (13-ago-2026): a "¿cómo se ve el
     * volumen ruso?" el agente eligió bien la acción pero mandó `"label"` en
     * vez de `"etiqueta"`. El esquema la rechazó, se agotaron los reintentos y
     * la conversación acabó derivada a una persona — con la foto cargada y
     * lista para enviar.
     *
     * Y su error es razonable: todo el resto del contrato está en inglés
     * (`action`, `reply`, `text`, `summary`, `farewell`) y la acción se llama
     * `send_image`. El único campo en español era justo el que había que
     * adivinar. Se aceptan los dos en vez de confiar en que acierte — mismo
     * criterio que los guardarraíles: comprobar el hecho, no la intención.
     */
    label: z.string().min(1).optional(),
    /** El pie de foto. Va en la misma burbuja que la imagen, no aparte. */
    reply: z.string().optional(),
  }),
  /**
   * El menú guiado de WhatsApp (25-ago-2026, solo `menu_mode='guiado'`): una
   * lista o botones que el cliente TOCA, en vez de texto libre que el modelo
   * tiene que interpretar.
   *
   * El modelo solo decide EL MOMENTO ("intenciones" al abrir la
   * conversación, "catalogo" cuando preguntan qué venden) — nunca arma las
   * filas: el servidor las construye desde `ficha.menu` y el catálogo real,
   * y **degrada a `reply`** si el menú no cabe en los límites de WhatsApp.
   * Mismo criterio que `send_image`: comprobar el hecho, no confiar en la
   * intención.
   */
  z.object({
    action: z.literal("send_menu"),
    tipo: z.enum(["intenciones", "catalogo"]),
    /**
     * Cuando el catálogo no cabe en una sola lista, `tipo: "catalogo"` sin
     * `categoria` muestra primero los NOMBRES de categoría; el cliente toca
     * una y el modelo repite `send_menu` con esa categoría exacta aquí para
     * ver sus productos. Ignorado si el catálogo entero sí cabe en una lista.
     */
    categoria: z.string().optional(),
    reply: z.string().optional(),
  }),
  /**
   * Consultas verificables de PEDIDOS (25-ago-2026, `catalog_source='tabla'`):
   * el mismo patrón que `consult_availability` ya resolvió para citas,
   * llevado a "¿tienen X?" / "¿cuánto cuesta X?". Son acciones INTERNAS —
   * nunca llegan al cliente — que el servidor resuelve contra la base real
   * y devuelve como hecho en el mismo turno (ver pipeline.ts). El modelo
   * decide CUÁNDO preguntar; nunca decide el hecho leyendo el catálogo en
   * prosa.
   *
   * Nace del incidente real: "¿Tienen disponible torta de chocolate?" contra
   * un catálogo que sí tenía "Porción Chocolate" — el modelo no conectó el
   * sinónimo y escaló. `consultar_producto` existe para que esa
   * correspondencia la calcule el servidor, no el modelo.
   */
  z.object({
    action: z.literal("consultar_producto"),
    consulta: z.string().min(1),
  }),
  /**
   * Mismo principio para métodos de pago (caso Nequi, 24-ago-2026): en vez
   * de que el modelo decida si un método "cuenta como" lo declarado leyendo
   * una instrucción en prosa, el servidor lo resuelve contra
   * `ficha.pago.formas` (ver `server/pagos/metodo.ts`). Solo aparece cuando
   * `payment_source='ficha'`.
   */
  z.object({
    action: z.literal("consultar_medio_pago"),
    metodo: z.string().min(1),
  }),
  /**
   * Mismo principio para la tarifa de domicilio (Fase 10N-J, incidente real
   * de Kachipay): en vez de que el modelo diga un precio de memoria o lo
   * infiera de la ficha en prosa, el servidor lo resuelve contra
   * `delivery_zone` (ver `server/delivery/zonas.ts`). Solo aparece cuando
   * `delivery_source='tabla'` — sin zonas reales cargadas no hay contra qué
   * verificar.
   */
  z.object({
    action: z.literal("consultar_domicilio"),
    zona: z.string().min(1),
    /**
     * Fase 10V-X — el cliente dijo que RECOGE en el local (no quiere
     * domicilio). `zona` sigue siendo obligatoria en el esquema (puede
     * llevar cualquier texto, como "recogida" — el servidor la ignora
     * cuando esta bandera es `true`) para no bifurcar el contrato en dos
     * acciones que hacen casi lo mismo. Sin esta señal explícita, un
     * cambio de domicilio a recogida solo se sabría inventando un "no
     * encontré esa zona" — indistinguible de una zona real mal escrita.
     */
    recogida: z.boolean().optional(),
  }),
  /**
   * Vertical de citas (solo orgs con agent_profile.appointmentsEnabled).
   *
   * `consult_availability` es una acción INTERNA: nunca llega al cliente. El
   * servidor calcula los horarios reales y se los devuelve al modelo dentro
   * del mismo turno (ver server/ai/pipeline.ts) — igual que el horario de
   * atención, la disponibilidad la calcula el servidor, jamás el modelo.
   */
  z.object({
    action: z.literal("consult_availability"),
    /**
     * Uno o varios, en el orden en que el cliente los nombró — "manos y pies
     * tradicional" son dos. Cada uno se resuelve por separado contra el
     * catálogo (`buscarServicio`); si el cliente pide varios, TODOS van aquí,
     * nunca una acción por servicio.
     */
    servicios: z.array(z.string().min(1)).min(1).max(MAX_ITEMS),
    fecha: z.string().optional(),
    especialista: z.string().optional(),
  }),
  /**
   * `reservas[]`, no una sola fecha/hora/especialista (19-ago-2026,
   * docs/korexia/108-RESERVAS-DE-VARIAS-PERSONAS.md): un caso real de
   * Lashes Valen pidió una cita para la clienta y otra para su mamá, cada
   * una con su servicio, hora y especialista — dos reservas independientes,
   * no dos servicios de la misma visita (eso ya lo cubre `servicios[]`
   * DENTRO de una reserva, sin tocar aquí). El modelo solo podía declarar
   * una, así que el texto anunciaba dos citas y el sistema agendaba una.
   *
   * `MAX_RESERVAS` es deliberadamente bajo: esto es para un grupo pequeño
   * que agenda junto (una familia, dos amigas), no un mecanismo de carga
   * masiva — cada reserva se valida y ejecuta por separado en el pipeline.
   */
  z.object({
    action: z.literal("book_appointment"),
    reservas: z
      .array(
        z.object({
          servicios: z.array(z.string().min(1)).min(1).max(MAX_ITEMS),
          fecha: z.string().min(1),
          hora: z.string().min(1),
          especialista: z.string().optional(),
        })
      )
      .min(1)
      .max(MAX_RESERVAS),
    farewell: z.string().optional(),
  }),
  z.object({
    action: z.literal("reschedule_appointment"),
    servicio: z.string().min(1),
    nuevaFecha: z.string().min(1),
    nuevaHora: z.string().min(1),
    farewell: z.string().optional(),
  }),
  z.object({
    action: z.literal("cancel_appointment"),
    servicio: z.string().min(1),
    farewell: z.string().optional(),
  }),
]).superRefine((accion, ctx) => {
  /*
   * Una acción que NO se puede ejecutar no debería ser válida.
   *
   * `send_image` acepta la etiqueta en español o en inglés porque el modelo
   * usa las dos (ver la nota del esquema), pero hasta ahora **ninguna de las
   * dos era obligatoria**: una acción sin etiqueta pasaba la validación,
   * llegaba al ejecutor, no encontraba ningún recurso y degradaba a texto —
   * es decir, el cliente leía "te envío el catálogo" y no le llegaba nada.
   * Exactamente el fallo del 18-ago-2026.
   *
   * Se comprueba aquí, y no exigiendo `etiqueta` a secas, para no repetir el
   * bug del 13-ago: entonces se rechazaba `label` y la conversación acabó en
   * manos de una persona con la foto cargada y lista para enviar. Lo que hace
   * falta es que venga UNA de las dos, no una concreta.
   */
  if (accion.action === "send_image" && !accion.etiqueta && !accion.label) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["etiqueta"],
      message:
        'send_image necesita "etiqueta" (o "label") con el nombre EXACTO de la lista de fotos: sin ella no se puede enviar nada. Si lo que quieres no está en esa lista, usa reply y no prometas el envío.',
    });
  }
  /*
   * `send_menu.reply` NO se exige aquí a propósito (docs/korexia/144):
   * exigirlo en el esquema convertía su ausencia en un turno perdido — sin
   * red de reintentos en el camino de la Fase 2 (`chatJsonConEstado`
   * valida `AgentAction` DESPUÉS de que `chatJson` ya dio la llamada por
   * buena contra un esquema laxo), así que un "reply" omitido de forma
   * intermitente por el modelo escalaba a una persona el 71% de las veces
   * en la prueba real contra Lis, con "Hola, buenas noches" como único
   * disparador.
   *
   * El dato tiene fallback determinista y seguro en cada uno de sus usos
   * reales — `armarMenuDeIntenciones`/`armarMenuDeCatalogo`/
   * `armarMenuDeCategoria` (server/catalog/menu.ts) ya traen un texto
   * neutral por defecto, y el propio `pipeline.ts` ya usa
   * `action.reply ?? "¿En qué te puedo ayudar?"` en la degradación — así
   * que rechazar la acción entera por este campo tiraba a la basura un
   * turno perfectamente ejecutable. `reply` sigue siendo información real
   * cuando el modelo la da (el texto exacto que quiso decir); cuando no,
   * el sistema ya sabe qué decir sin inventar nada del negocio.
   */
});

export type AgentActionType = z.infer<typeof AgentAction>;

/**
 * Los campos de la acción, descritos para el PROVEEDOR (salidas estructuradas).
 *
 * Vive aquí, pegado al contrato que describe, para que un campo nuevo en la
 * unión y su descripción no acaben en archivos distintos. `tests/unit/
 * esquema-json-de-accion.test.ts` recorre la unión y falla si alguno falta.
 *
 * **Plano a propósito**: la unión discriminada tiene doce ramas, y el modo
 * estricto del proveedor exige enumerar cada propiedad. Un campo que no
 * corresponda a la acción elegida llega en `null` y se descarta antes de
 * validar con Zod (ver `sinNulos` en el pipeline) — nunca se rechaza el turno
 * por eso, que es la regla 3 de la Fase 2.
 */
const CAMPOS_DE_ACCION: Record<string, unknown> = {
  action: {
    type: "string",
    enum: [
      "none", "reply", "update_lead", "provide_requirement", "move_stage",
      "handoff", "notify_order", "send_image", "send_menu",
      "consultar_producto", "consultar_medio_pago", "consultar_domicilio",
      "consult_availability", "book_appointment", "reschedule_appointment",
      "cancel_appointment",
    ],
  },
  text: { type: ["string", "null"] },
  note: { type: ["string", "null"] },
  reply: { type: ["string", "null"] },
  stage: { type: ["string", "null"] },
  reason: { type: ["string", "null"] },
  farewell: { type: ["string", "null"] },
  summary: { type: ["string", "null"] },
  etiqueta: { type: ["string", "null"] },
  label: { type: ["string", "null"] },
  tipo: { type: ["string", "null"] },
  categoria: { type: ["string", "null"] },
  consulta: { type: ["string", "null"] },
  metodo: { type: ["string", "null"] },
  zona: { type: ["string", "null"] },
  recogida: { type: ["boolean", "null"] },
  subtotalCents: { type: ["number", "null"] },
  deliveryFeeCents: { type: ["number", "null"] },
  totalCents: { type: ["number", "null"] },
  requisitoId: { type: ["string", "null"] },
  valor: { type: ["string", "null"] },
  servicio: { type: ["string", "null"] },
  nuevaFecha: { type: ["string", "null"] },
  nuevaHora: { type: ["string", "null"] },
  fecha: { type: ["string", "null"] },
  especialista: { type: ["string", "null"] },
  servicios: { type: ["array", "null"], items: { type: "string" } },
  reservas: {
    type: ["array", "null"],
    items: {
      type: "object",
      properties: {
        servicios: { type: "array", items: { type: "string" } },
        fecha: { type: "string" },
        hora: { type: "string" },
        especialista: { type: ["string", "null"] },
      },
      required: ["servicios", "fecha", "hora", "especialista"],
      additionalProperties: false,
    },
  },
};

/** Los nombres de los campos de acción, para la prueba de deriva. */
export const CAMPOS_DE_ACCION_DECLARADOS = Object.keys(CAMPOS_DE_ACCION);

/**
 * El `response_format` que exige la acción **y** el estado en la misma
 * respuesta.
 *
 * Es lo que hace posible la Fase 2: medido el 19-ago-2026, sin esto
 * `gemini-2.5-flash` no emite `estado` ni una sola vez, por mucho que el prompt
 * se lo pida. `estadoSchema` lo pone quien conoce esa forma (el pipeline), no
 * este archivo.
 */
export function formatoDeRespuestaConEstado(estadoSchema: unknown): unknown {
  return formato("accion_con_estado", { estado: estadoSchema });
}

/**
 * El mismo contrato, **sin** estado: para las llamadas que solo piden una
 * acción.
 *
 * La usa el segundo turno del modelo tras `consult_availability`
 * (`pipeline.ts`), que era la única llamada del camino de citas sin garantía
 * estructurada. Con la Fase 2 encendida falló 2 de 2 veces —una devolviendo
 * prosa en vez de JSON, otra una acción incompleta— y las dos acabaron en
 * handoff por error, con la clienta leyendo "te comunico con una persona"
 * cuando el sistema tenía los horarios en la mano (20-ago-2026).
 */
export function formatoDeRespuestaDeAccion(): unknown {
  return formato("accion", {});
}

function formato(nombre: string, extra: Record<string, unknown>): unknown {
  return {
    type: "json_schema",
    json_schema: {
      name: nombre,
      strict: true,
      schema: {
        type: "object",
        properties: { ...CAMPOS_DE_ACCION, ...extra },
        // El modo estricto exige que TODA propiedad declarada esté en
        // `required`: si una se queda fuera, el proveedor rechaza la petición.
        required: [...Object.keys(CAMPOS_DE_ACCION), ...Object.keys(extra)],
        additionalProperties: false,
      },
    },
  };
}

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización (exacto → lower-case). Sin match: degradar a reply/none.
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const lower = requested.trim().toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/** Degrada una move_stage sin etapa válida (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (action.action === "move_stage") {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
