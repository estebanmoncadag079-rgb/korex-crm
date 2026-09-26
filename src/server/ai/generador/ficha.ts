/**
 * La ficha del negocio: lo que el cliente responde y NADA más.
 *
 * Es el calco del cuestionario que se le manda
 * (`clientes/plantilla-cuestionario-cliente.docx`), sección por sección y en el
 * mismo orden, para que pasar del Word a este objeto sea mecánico y no haya que
 * interpretar nada.
 *
 * ⚠️ **Aquí NO va estructura ni conducta.** Nada de "cómo se arma el resumen" ni
 * "qué no debe anunciar el agente": eso es igual para una pastelería que para un
 * salón y vive en `conducta.ts`. Aquí solo entra lo que de verdad distingue a
 * este negocio de cualquier otro. Esa separación es lo que permite que un
 * cliente nuevo nazca con todas las lecciones aprendidas sin copiar el prompt de
 * nadie.
 *
 * Todo lo opcional se omite del prompt si viene vacío: un negocio que no hace
 * domicilios no debe tener ni una línea sobre domicilios.
 */

import { normalizarHora } from "@/lib/hora";
import {
  diasDeclaradosSinHoraValida,
  horarioCanonico,
  NOMBRE_DEL_DIA,
  sinHorarioConfigurado,
} from "@/server/horario";

/**
 * Un dato que el negocio necesita reunir antes de cerrar.
 *
 * **Es del CRM, no del núcleo.** El backend no sabe —ni tiene por qué— que un
 * pedido a domicilio necesita una dirección o que una cita necesita un nombre:
 * lo declara cada negocio, y el núcleo se limita a exigir lo declarado.
 *
 * Antes esto eran tres campos escritos dentro del validador
 * (`nombre`, `telefono`, `direccion`), así que un salón —que no entrega nada—
 * arrastraba una dirección que nadie iba a dar.
 */
export type Requisito = {
  /** Con el que se guarda el valor. Estable: cambiarlo pierde lo ya recogido. */
  id: string;
  /**
   * Qué ES el dato. Hoy sirve al prompt y al log; **todavía no valida formato**
   * —hoy no se valida ninguno—, y prometerlo sin hacerlo sería peor que no
   * declararlo.
   */
  tipo: "texto" | "telefono" | "direccion" | "email" | "documento";
  /** Cómo se le pide al cliente, con las palabras del negocio. */
  etiqueta: string;
  /** Sin él no se puede confirmar. */
  obligatorio: boolean;
  /**
   * Solo hace falta si este campo de la ficha es cierto. Es una REFERENCIA,
   * no una expresión: sin operadores ni comparaciones. Un mini-lenguaje de
   * condiciones acaba siendo un intérprete dentro del CRM.
   *
   * Ej.: `"entrega.haceDomicilios"`.
   */
  soloSi?: string;
  /**
   * Solo hace falta si el cliente eligió una de ESTAS modalidades **para este
   * pedido**.
   *
   * ⚠️ No confundir con `soloSi`, que mira la ficha. Son dos preguntas
   * distintas, y las dos hacen falta:
   *
   *   `soloSi`             → ¿este negocio podría necesitarlo alguna vez?  (ficha)
   *   `soloEnModalidades`  → ¿lo necesita ESTE pedido?                    (estado)
   *
   * Nació de un caso real (20-ago-2026): la dirección se exigía con
   * `soloSi: "entrega.haceDomicilios"` —cierto, el negocio reparte— y por eso
   * se le pedía también a quien pasaba a recoger. El modelo, obligado a
   * rellenar un campo sin valor válido, escribió `"Recoge en el local"`
   * DENTRO del campo dirección. La ficha no estaba mal: le faltaba la otra
   * mitad de la condición.
   *
   * Sin declarar = el requisito no depende de la modalidad, que es el caso
   * normal (el nombre y el celular hacen falta siempre).
   *
   * Los valores se comparan contra las modalidades que la ficha OFRECE
   * (`modalidadesDeEntrega`), nunca contra una lista escrita en el núcleo.
   */
  soloEnModalidades?: readonly string[];
};

/**
 * Las modalidades de entrega que este negocio OFRECE, derivadas de su ficha.
 *
 * **Es el único sitio del núcleo que conoce nombres de modalidad**, y es a
 * propósito: son los ids canónicos contra los que se normaliza lo que proponga
 * el modelo y contra los que se comparan los `soloEnModalidades` de un
 * requisito. Una tercera modalidad mañana es un campo en la ficha y una línea
 * aquí — en un solo lugar, no repartida por el código.
 *
 * Un negocio que no declare ninguna devuelve lista vacía, y entonces la
 * modalidad no participa en decidir requisitos: se comporta igual que antes de
 * que esto existiera.
 */
export const MODALIDAD_DOMICILIO = "domicilio";
export const MODALIDAD_RECOGIDA = "recogida";

/**
 * Una opción del menú guiado de WhatsApp (25-ago-2026): lo que el cliente
 * TOCA al escribir por primera vez, en vez de texto libre que el modelo
 * tiene que interpretar.
 *
 * Nace de un incidente real: una clienta de Lis escribió "torta de
 * chocolate" y el modelo no conectó el sinónimo con "Porción Chocolate" del
 * catálogo — escaló a una persona en vez de responder. El catálogo (nivel 1
 * del menú: categorías → productos) NO se declara aquí ni en ningún otro
 * campo de la ficha: se deriva de `product` en el momento de armar el menú,
 * para no repetir el mismo dato en dos lugares (ver `catalogo`/`catalog_source`).
 */
export type OpcionDeMenu = {
  /** Con la que WhatsApp identifica qué tocó el cliente. Estable. */
  id: string;
  /** Lo que ve el cliente en el botón o la fila de la lista. */
  etiqueta: string;
};

/**
 * El `id` de una opción, derivado de su etiqueta — el dueño del negocio
 * escribe solo el texto ("Hacer un pedido"); nunca ve ni escribe un id.
 * `existentes` evita que dos opciones con etiquetas parecidas choquen.
 */
export function idDeOpcionDeMenu(etiqueta: string, existentes: Set<string>): string {
  const base =
    etiqueta
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(new RegExp("[̀-ͯ]", "g"), "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "opcion";
  let id = base;
  let sufijo = 2;
  while (existentes.has(id)) id = `${base}_${sufijo++}`;
  return id;
}

export function modalidadesDeEntrega(ficha: FichaDelNegocio): string[] {
  const ofrecidas: string[] = [];
  if (ficha.entrega?.haceDomicilios) ofrecidas.push(MODALIDAD_DOMICILIO);
  if (ficha.entrega?.recogerEnLocal?.trim()) ofrecidas.push(MODALIDAD_RECOGIDA);
  return ofrecidas;
}

/**
 * Otro sitio donde el cliente puede pedir o agendar: una app de domicilios, una
 * tienda web, un marketplace.
 *
 * **No vive dentro de `Entrega` a propósito.** Para una pastelería, Rappi es
 * una forma de recibir el pedido; para un salón, agendar por otra plataforma no
 * es ninguna "entrega". Colgarlo de la entrega lo habría dejado inservible para
 * la mitad de la flota.
 */
export type CanalExterno = {
  /** Cómo lo llama el cliente. Ej: "Rappi", "nuestra tienda web". */
  nombre: string;
  /** A dónde se le manda, si hay enlace. Sin él, el agente solo lo menciona. */
  enlace?: string;
};

/** Cómo entrega el negocio lo que vende. */
export type Entrega = {
  /** ¿Hace domicilios? Si es `false`, el resto de este bloque se ignora. */
  haceDomicilios: boolean;
  /** Con quién y cuánto tarda. Ej: "por Yango, llega en 1 hora aprox." */
  como?: string;
  /**
   * Quién paga el domicilio y cuándo.
   *
   * Es el dato que más caro sale si el agente no lo dice: el cliente cree que
   * el total lo incluye y discute con el repartidor. Va SIEMPRE en el resumen,
   * en negrita y con el hecho primero — se aprendió con Lis, donde iba en
   * cursiva (WhatsApp la pinta tenue) y la dueña la reescribía a mano creyendo
   * que el agente la había olvidado.
   */
  quienPagaElDomicilio?: string;
  /** Restricciones de entrega. Ej: "no entramos a conjuntos ni centros comerciales". */
  restricciones?: string;
  /** ¿Se puede recoger en el local? Cómo funciona. */
  recogerEnLocal?: string;
  /**
   * Pedido mínimo, en centavos, para que salga un domicilio. Ausente o `0` =
   * sin mínimo, que es el caso de casi todos.
   *
   * Es un IMPORTE y no un número de unidades a propósito: la regla que lo
   * pidió (MALIA, 21-sep-2026) era *"mínimo dos pavés de 8 oz, o uno de 16"*,
   * y eso NO es expresable por unidades —uno de 16 oz es una sola unidad y sí
   * vale—. Traducida, la regla es económica: un domicilio no sale a cuenta
   * por menos de X. Ver `@/server/orders/minimo-de-domicilio` para la tabla
   * de equivalencias y por qué se compara contra el subtotal y nunca contra
   * el total con la tarifa incluida.
   */
  minimoDomicilioCents?: number;
};

/** Cómo le pagan al negocio. */
export type Pago = {
  /** Formas aceptadas. Ej: "transferencia y efectivo". */
  formas: string;
  /**
   * Los datos de la cuenta, TAL CUAL se los va a dar el agente al cliente.
   * Se copian sin tocar una coma: un dígito cambiado es plata que se pierde.
   */
  datosDeCuenta?: string;
  /**
   * Qué se hace con el comprobante.
   *
   * El agente puede pedir la foto, pero **nunca da un pago por bueno**: eso lo
   * revisa una persona. Es una decisión del producto, no del cliente
   * (ver `docs/korexia/13-AUDIO-E-IMAGENES.md`).
   */
  compruebaUnaPersona: boolean;
  /**
   * Las formas de pago como DATO, por modalidad (doc 200, 26-sep-2026).
   *
   * `formas` es texto libre y el backend no lo puede interpretar: MALIA dice
   * "efectivo pero solo recogiendo en planta" y se aprobó efectivo contra
   * entrega (caso Sofía, doc 198). Con esto el backend responde con certeza.
   * Ausente = se usa `formas` como hasta hoy.
   */
  porModalidad?: { domicilio?: MetodoDePago[]; recoger?: MetodoDePago[] };
  /**
   * Cuándo se dan los datos de la cuenta. Ausente = `si_la_piden` (lo de hoy:
   * si el cliente pregunta cómo pagar, se le contesta). `nunca` = solo al cerrar,
   * después de que confirme (Lis: "no dar la cuenta antes de la confirmación").
   */
  cuentaAntesDeConfirmar?: "si_la_piden" | "nunca";
};

/** Las formas de pago que el backend sabe distinguir. Nequi, Daviplata y llaves son transferencia. */
export type MetodoDePago = "transferencia" | "efectivo" | "tarjeta";
export const METODOS_DE_PAGO: readonly MetodoDePago[] = ["transferencia", "efectivo", "tarjeta"];

/**
 * Lo que el bot envía TAL CUAL al cliente en momentos fijos (doc 200). Cada uno
 * es opcional: vacío = el texto por defecto de la plataforma.
 */
export type MensajesDelBot = {
  /** Cuando pasa la conversación a una persona del equipo. */
  derivar?: string;
  /** Cuando el negocio está cerrado y se toma el pedido para después. */
  fueraDeHorario?: string;
  /** Cuando la dirección no identifica un barrio de la tabla de domicilios. */
  pedirBarrio?: string;
  /** La línea del cierre cuando el domicilio lo cotiza el equipo aparte. */
  domicilioPendiente?: string;
};

/**
 * Cuándo atiende. Los días son 1=lunes … 7=domingo.
 *
 * ## `porDia` es el CANÓNICO; el resto son derivados suyos
 *
 * Hasta el 20-sep-2026 esto eran dos datos sueltos —una lista de días y una
 * franja común, más la de domingo aparte— y **podían contradecirse**. Le pasó
 * a Lis: desmarcó el domingo (`dias` sin el 7) y su franja de domingo se
 * quedó puesta; el resolutor miraba la franja antes que los días y el bot
 * siguió ofreciendo servicio el domingo. Desmarcar el día no desmarcaba nada.
 *
 * Ahora cada día **es** su franja, o no está:
 *
 * ```json
 * "porDia": { "1": {"abre":"10:00","cierra":"19:00"}, "7": {"abre":"14:00","cierra":"19:00"} }
 * ```
 *
 * Un "domingo cerrado con horario de domingo" ya no es representable.
 *
 * `dias`, `abre`, `cierra`, `abreDomingo` y `cierraDomingo` **siguen aquí y
 * siguen siendo obligatorios**, pero como PROYECCIÓN: los reescribe entero
 * `horarioNormalizado()` en cada guardado, desde `porDia`. Existen para que el
 * código ya desplegado —que no conoce `porDia`— siga leyendo algo coherente
 * mientras dura la migración. Nunca se leen como autoridad: `horarioCanonico()`
 * los ignora en cuanto hay `porDia`, y `pnpm auditar:arquitectura` marca FAIL
 * si discrepan (ver `@/server/horario`).
 */
export type Horario = {
  /**
   * CANÓNICO. Clave = día (1=lunes … 7=domingo) en texto, porque esto viaja
   * como JSON. **Un día ausente está CERRADO.** Opcional solo mientras queden
   * fichas sin migrar; en cuanto se guarda, siempre está.
   */
  porDia?: Record<string, { abre: string; cierra: string }>;
  /** DERIVADO de `porDia`. Los días abiertos. */
  dias: number[];
  /** DERIVADO de `porDia`. La franja más repetida. */
  abre: string;
  /** DERIVADO de `porDia`. */
  cierra: string;
  /** DERIVADO de `porDia`. Solo si el domingo abre Y su franja es distinta. */
  abreDomingo?: string;
  cierraDomingo?: string;
};

/** Una pregunta frecuente con su respuesta, tal como la daría el dueño. */
export type PreguntaFrecuente = { pregunta: string; respuesta: string };

/**
 * Todo lo que hace único a un negocio. Sale del cuestionario, punto por punto.
 */
export type FichaDelNegocio = {
  // ── 1. Tu negocio ──────────────────────────────────────────────────────────
  /** Nombre comercial, tal como lo conocen sus clientes. */
  nombre: string;
  /** Qué vende o qué servicio ofrece, en una línea. */
  queVende: string;
  /** Ciudad, barrio y dirección si aplica. */
  ubicacion?: string;
  horario: Horario;
  /**
   * Lo que el negocio quiera explicar sobre sus horarios y que `horario` no
   * sabe expresar. **Contexto para el cliente, nunca una regla.**
   *
   * El caso que lo pidió (Lis): *"Atendemos pedidos por WhatsApp desde las
   * 10:00 a. m., pero el punto físico abre al público desde la 1:00 p. m."*.
   * Su horario operativo es el de WhatsApp —es el canal que atiende el
   * agente— y el del local no cabe en `porDia` sin inventar un segundo
   * horario estructurado que luego pediría un tercero y un cuarto.
   *
   * ⚠️ **Vive aquí y no dentro de `horario` a propósito**: `horarioNormalizado`
   * reescribe ese objeto entero en cada guardado, así que un campo hermano
   * suyo se borraría solo. Y `businessStatus` no puede leerlo ni queriendo:
   * solo acepta `HorarioSemanal` (ver `@/server/horario`).
   */
  observacionesHorario?: string;

  /**
   * El vertical. Cambia qué puede hacer el agente:
   * `pedidos` cierra ventas; `citas` agenda en el calendario.
   */
  vertical: "pedidos" | "citas";

  /**
   * Qué hay que reunir para cerrar, en el orden en que se pide.
   *
   * Opcional **solo por compatibilidad**: los negocios dados de alta antes del
   * 17-ago-2026 no lo traen, y reescribir sus fichas para desplegar una
   * refactorización sería tocar datos de producción por comodidad. Cuando falta,
   * `requisitosDe()` devuelve los de su vertical.
   *
   * `pagoAntesDeLaCita` (19-ago-2026, docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md):
   * solo aplica a `citas`. Ausente o `false` = el agente NUNCA pide pago al
   * confirmar. Vive aquí, y no en `pago` de más abajo, por la misma razón que
   * los requisitos: `pago` está en la sección `negocio` que el cuestionario
   * del cliente reescribe cada vez que se reenvía, y pisaría este interruptor.
   */
  cierre?: { requisitos: Requisito[]; pagoAntesDeLaCita?: boolean };

  // ── 2. Qué ofrece y a qué precio ───────────────────────────────────────────
  /**
   * Productos o servicios con precio, uno por línea.
   *
   * En `citas` NO entra en el prompt —el catálogo vive en la tabla `service` y
   * llega aparte, con sus duraciones—, pero sí se recoge en el alta: es la
   * lista que se convierte en servicios al aplicar la ficha. Antes se omitía, y
   * un salón terminaba su alta sin catálogo y sin que nadie se lo dijera.
   */
  catalogo?: string;
  /**
   * Cuánto dura un servicio típico, en minutos. Solo `citas`.
   *
   * Se pide en el alta para poder crear el catálogo de una vez: sin duración un
   * servicio no se puede guardar, porque de ella depende que la agenda no
   * solape dos citas. Las líneas que traigan la suya ("180 min") mandan sobre
   * esta; el resto nace con ella y se ajusta después en Servicios.
   */
  duracionTipicaMin?: number;
  /** Variantes que el cliente elige y cuántas puede escoger de cada una. */
  variantes?: string;

  // ── 3. Cómo reciben lo que piden ───────────────────────────────────────────
  entrega: Entrega;
  /**
   * Dónde MÁS te pueden pedir o agendar. Opcional: un negocio que no tenga
   * ninguno no nota que esto existe.
   *
   * Nació de una venta perdida (20-ago-2026): una clienta preguntó por una app
   * de domicilios y el agente contestó que el negocio no la manejaba. Sí la
   * manejaba — pero nadie se lo había preguntado nunca al darlo de alta, así
   * que no estaba en ninguna parte.
   */
  canales?: CanalExterno[];

  // ── 4. Cómo te pagan ───────────────────────────────────────────────────────
  pago: Pago;

  /**
   * Solo CITAS: la política de cancelación y cambios, tal cual se la dice el
   * bot al cliente cuando pregunta (doc 200). 💬 literal.
   */
  politicaDeCancelacion?: string;

  // ── Conducta que decide el negocio (doc 200) ───────────────────────────────
  /** ¿Se toman pedidos con el negocio cerrado? Ausente = sí (lo de hoy). */
  fueraDeHorario?: { tomaPedidos: boolean };
  /**
   * Qué hacer cuando el cliente responde a una historia/estado y pregunta por
   * lo que vio (el bot no puede ver la publicación). Ausente = `responder`:
   * contesta lo que pueda con su conocimiento y, si no sabe de qué habla,
   * pregunta. `pasar_al_equipo` = lo de antes del 26-sep-2026.
   */
  respuestaAPublicaciones?: "responder" | "pasar_al_equipo";
  /** Lo que el bot envía tal cual en momentos fijos. */
  mensajes?: MensajesDelBot;

  // ── 5. Cómo debe hablarle a sus clientes ───────────────────────────────────
  /** El tono, con las palabras del dueño. Ej: "cercano, con emojis, hablamos de nosotros". */
  tono: string;
  /** Si se puede pedir para regalo, y si hay tarjeta o dedicatoria. */
  regalos?: string;
  /** Menú o saludo inicial propio, si lo quiere. */
  saludoInicial?: string;
  /**
   * El menú guiado de WhatsApp: 3-4 opciones que el cliente toca al escribir
   * por primera vez ("Ver menú", "Hacer un pedido"…). Opcional: sin esto, o
   * con `menu_mode='texto'` en `agent_profile`, el agente sigue redactando
   * el saludo libremente como siempre.
   */
  menu?: { opciones: OpcionDeMenu[] };

  /**
   * Reglas propias que no encajan en ninguna categoría de arriba.
   *
   * **Este campo es imprescindible y se descubrió probando**: al generar el
   * prompt de Lis con el resto de la ficha salió de 4.913 caracteres frente a
   * los 17.058 que tiene hoy. Parte de la diferencia era grasa, pero parte no —
   * eran reglas suyas acumuladas en semanas de ajuste, sin sitio donde ir:
   *
   *   • "Si el cliente dice que no le abre el enlace del menú, mándaselo escrito"
   *   • "Las sodas y el café solo se venden en el punto, a domicilio solo agua"
   *   • "Si pide dos teléfonos, usa el primero y anota el otro"
   *
   * Un negocio de verdad siempre tiene un puñado de estas, y son justo las que
   * lo distinguen. Van tal cual al prompt, en su propia sección.
   */
  reglasPropias?: string[];

  // ── 6. Lo que sus clientes preguntan seguido ───────────────────────────────
  /**
   * Van al KB (`kb_entry`), no al prompt: son datos consultables y crecen con
   * el tiempo.
   *
   * ⚠️ **Solo siembran a un cliente cuya KB está vacía; nunca la reemplazan.**
   * El cuestionario dejó de pedirlas el 15-ago-2026 porque preguntaba lo mismo
   * que la pantalla de Conocimiento, que es la fuente de verdad
   * (`docs/korexia/61-UNA-SOLA-PUERTA.md`). El campo se conserva porque las
   * fichas ya guardadas lo traen y `aplicarFicha` lo sigue leyendo para el alta.
   */
  preguntasFrecuentes: PreguntaFrecuente[];

  // ── 7. Qué NO debe resolver solo ───────────────────────────────────────────
  /** Casos que van directos a una persona. Ej: reclamos, devoluciones. */
  escalarSiempre: string[];
  /** Lo que el agente no puede decir ni prometer nunca, aunque insistan. */
  nuncaPrometer: string[];
};

/**
 * Lo que falta para poder generar un prompt utilizable.
 *
 * Se comprueba ANTES de dar de alta, no después: un cliente que arranca sin
 * datos de cuenta tiene un agente que cierra pedidos y no sabe cobrarlos.
 */
export function faltantesDeLaFicha(ficha: Partial<FichaDelNegocio>): string[] {
  const faltan: string[] = [];
  if (!ficha.nombre?.trim()) faltan.push("el nombre del negocio");
  if (!ficha.queVende?.trim()) faltan.push("qué vende o qué servicio ofrece");
  if (!ficha.tono?.trim()) faltan.push("el tono con el que habla");
  /*
   * Se valida sobre el CANÓNICO, no sobre los derivados: una ficha ya migrada
   * trae `porDia` y podría traer los campos viejos vacíos sin que eso sea un
   * error. `horarioCanonico` entiende las dos formas.
   */
  const horarioDeLaFicha = horarioCanonico(ficha.horario);
  if (sinHorarioConfigurado(horarioDeLaFicha)) {
    faltan.push("los días que atiende");
  }
  /*
   * Un día marcado al que le faltan las horas se NOMBRA, no se descarta.
   * Antes desaparecía en silencio y el negocio se quedaba cerrado ese día
   * creyendo que lo había configurado (H-1, auditoría del 20-sep-2026).
   */
  for (const d of diasDeclaradosSinHoraValida(ficha.horario)) {
    faltan.push(`las horas del ${NOMBRE_DEL_DIA[d]} (está marcado pero sin horario legible)`);
  }
  if (!ficha.horario?.abre || !ficha.horario?.cierra) {
    if (sinHorarioConfigurado(horarioDeLaFicha)) faltan.push("el horario");
  } else if (
    // Una hora que el servidor no sabe leer es peor que no tenerla: con las
    // citas encendidas, la agenda queda vacía de huecos y el agente rechaza
    // clientes creyendo que está llena. Pasó con "9 AM" el 13-ago-2026.
    !normalizarHora(ficha.horario.abre) ||
    !normalizarHora(ficha.horario.cierra)
  ) {
    faltan.push(
      `el horario en un formato legible (llegó "${ficha.horario.abre}" a "${ficha.horario.cierra}"; se espera "09:00", "9 AM" o similar)`
    );
  }

  // El catálogo de PEDIDOS ya no se pide en el alta (25-ago-2026): se carga
  // en la pantalla Catálogo, igual que los de CITAS se cargan en Servicios.
  // Que falte no bloquea terminar el cuestionario — un negocio puede
  // completar su ficha y cargar el menú después, o al revés.
  if (ficha.pago && !ficha.pago.formas?.trim()) {
    faltan.push("las formas de pago");
  }
  // Aceptar transferencia sin decir a qué cuenta deja al agente cerrando
  // pedidos que nadie puede pagar.
  if (
    ficha.pago?.formas?.toLowerCase().includes("transferencia") &&
    !ficha.pago?.datosDeCuenta?.trim()
  ) {
    faltan.push("los datos de la cuenta para transferencias");
  }
  // Un domicilio sin decir quién lo paga acaba en discusión con el repartidor.
  if (ficha.entrega?.haceDomicilios && !ficha.entrega?.quienPagaElDomicilio?.trim()) {
    faltan.push("quién paga el domicilio y cuándo");
  }
  return faltan;
}

/**
 * Los requisitos de cierre de un negocio. **Solo lo que declara su ficha.**
 *
 * `undefined` = este negocio **no los ha declarado todavía**, que no es lo mismo
 * que *"no necesita ninguno"* — para eso está `cierre: { requisitos: [] }`. La
 * diferencia importa: el validador se niega a confirmar un pedido de un negocio
 * sin declarar, en vez de darlo por bueno sin pedir nada.
 *
 * ## Por qué aquí NO hay valores por defecto
 *
 * Los hubo, el 17-ago, para no romper a los cuatro clientes que no traían
 * `cierre`. Duraron unas horas: eran una lista de campos por vertical, y esa
 * forma tiene un destino conocido —
 *
 * ```ts
 * if (vertical === "pedidos")      return [...];
 * if (vertical === "citas")        return [...];
 * if (vertical === "reparaciones") return [...];   // ← seis meses después
 * ```
 *
 * — que es exactamente el conocimiento del negocio volviendo al código por la
 * puerta de atrás. Se sustituyeron por `pnpm migrar:requisitos`, que escribe
 * esos mismos requisitos **en las fichas, una sola vez y como dato**.
 *
 * > **Ningún vertical nuevo añade requisitos por defecto aquí.** Los cuatro
 * > clientes de agosto fueron una excepción de compatibilidad, no una regla — y
 * > se resolvió migrándolos, no programándolos.
 */
export function requisitosDe(
  ficha: FichaDelNegocio,
  /**
   * Lo que se sabe del pedido EN CURSO. `undefined` = todavía no se sabe nada
   * (o este cliente no lleva el estado en el backend), y entonces se resuelve
   * solo con la ficha, exactamente como antes de que la modalidad existiera.
   *
   * Va aquí, en el productor, para que los cinco consumidores sigan recibiendo
   * el mismo concepto —"lo que falta para cerrar"— sin saber que la modalidad
   * existe. Duplicar esta decisión en cada uno es cómo se pierde una
   * arquitectura.
   */
  pedido?: { modalidadDeEntrega?: string | null }
): Requisito[] | undefined {
  const declarados = ficha.cierre?.requisitos;
  if (!declarados) return undefined;
  return declarados.filter((r) => aplica(r, ficha, pedido?.modalidadDeEntrega ?? null));
}

/**
 * ¿Este negocio pide el pago por adelantado al confirmar una cita?
 *
 * Único lugar que lee el dato: no declarado es lo mismo que `false` — el
 * agente NUNCA menciona el pago al agendar salvo que el negocio lo haya
 * encendido explícitamente aquí (docs/korexia/107-PAGO-ANTES-DE-LA-CITA.md).
 */
export function pagoAntesDeLaCitaDe(ficha: FichaDelNegocio): boolean {
  return ficha.cierre?.pagoAntesDeLaCita === true;
}

/**
 * Los requisitos que el paso "Datos que deben solicitarse antes de
 * confirmar" del cuestionario de alta puede ofrecer como casillas — el
 * catálogo cerrado, no lo que escriba quien llama.
 *
 * El negocio solo decide QUÉ marcar; `tipo` y `etiqueta` los fija el
 * servidor, para que la pantalla sea de verdad "solo la interfaz para editar
 * `cierre.requisitos`" y no un lugar donde alguien pueda inventar un id
 * nuevo sin que `server/contacts.ts` sepa qué hacer con él (`capturar()`
 * solo entiende los que están en `CAMPO_DE_REQUISITO`).
 *
 * Solo "nombre" es capturable hoy — ver docs/korexia/102. Los demás quedan
 * en la lista para que el negocio pueda DECLARARLOS (quedan en su ficha,
 * como fuente de verdad), aunque el sistema todavía no sepa capturarlos
 * solo desde el chat.
 */
export const REQUISITOS_DISPONIBLES: readonly Requisito[] = [
  { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
  { id: "telefono", tipo: "telefono", etiqueta: "el celular de contacto", obligatorio: true },
  { id: "email", tipo: "email", etiqueta: "el correo", obligatorio: true },
  { id: "documento", tipo: "documento", etiqueta: "el documento de identidad", obligatorio: true },
];

/**
 * Combina lo que "Datos que deben solicitarse antes de confirmar" gestiona
 * (el catálogo de arriba, marcado/desmarcado por checkbox) con lo que un
 * negocio ya tuviera declarado por otra vía — hoy, solo "direccion" para
 * pedidos con domicilio (ver `requisitosSugeridos`, aplicado antes a mano con
 * `migrar:requisitos`). Esa pantalla no pregunta por "direccion", así que no
 * debe borrarlo: se preserva tal cual estuviera en la ficha ya aplicada.
 *
 * Sin esto, terminar el cuestionario borraba en silencio la dirección de
 * domicilio de cualquier negocio migrado así (25-ago-2026, Lis) — y antes de
 * eso, el propio guardado fallaba siempre con un 400, porque el schema de
 * entrada solo aceptaba los cuatro ids de este catálogo.
 */
export function fusionarRequisitosDelCatalogo(
  marcados: { id: string }[],
  requisitosPrevios: Requisito[] | undefined
): Requisito[] {
  const delCatalogo = REQUISITOS_DISPONIBLES.filter((r) =>
    marcados.some((x) => x.id === r.id)
  ).map((r) => ({ ...r, obligatorio: true }));
  const idsDelCatalogo = new Set(REQUISITOS_DISPONIBLES.map((r) => r.id));
  const fueraDelCatalogo = (requisitosPrevios ?? []).filter(
    (r) => !idsDelCatalogo.has(r.id)
  );
  return [...fueraDelCatalogo, ...delCatalogo];
}

/**
 * Los requisitos que le tocarían a una ficha que aún no los declara.
 *
 * ⚠️ **Esto NO lo usa el pipeline ni el validador**: existe solo para que
 * `migrar:requisitos` proponga un punto de partida razonable, que una persona
 * revisa antes de escribirlo. En cuanto la ficha lo tiene, esta función deja de
 * mirarse — y el día que las cuatro estén migradas, se borra.
 */
export function requisitosSugeridos(ficha: FichaDelNegocio): Requisito[] {
  const sugeridos: Requisito[] = [
    { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
  ];
  if (ficha.vertical === "pedidos") {
    sugeridos.push(
      { id: "telefono", tipo: "telefono", etiqueta: "el celular de contacto", obligatorio: true },
      {
        id: "direccion",
        tipo: "direccion",
        etiqueta: "la dirección de entrega",
        obligatorio: true,
        // Las DOS condiciones: que el negocio reparta (ficha) y que ESTE
        // pedido sea a domicilio (estado). Con solo la primera se le pedía la
        // dirección a quien pasaba a recoger — ver `soloEnModalidades`.
        soloSi: "entrega.haceDomicilios",
        soloEnModalidades: [MODALIDAD_DOMICILIO],
      }
    );
  }
  // Sin modalidad: aquí no hay pedido todavía, solo se propone qué declarar.
  // Un requisito condicionado a la modalidad SÍ debe proponerse, con su
  // condición dentro — quien la evalúa después es el pedido, no esta función.
  return sugeridos.filter((r) => aplica(r, ficha, null));
}

function aplica(
  requisito: Requisito,
  ficha: FichaDelNegocio,
  modalidadElegida: string | null
): boolean {
  // 1) ¿Este negocio podría necesitarlo alguna vez? — lo dice la ficha.
  if (requisito.soloSi) {
    const valor = requisito.soloSi
      .split(".")
      .reduce<unknown>((obj, clave) => (obj as Record<string, unknown>)?.[clave], ficha);
    if (!valor) return false;
  }

  // 2) ¿Lo necesita ESTE pedido? — lo dice la modalidad elegida.
  if (!requisito.soloEnModalidades?.length) return true;

  /*
   * Modalidad todavía sin saber → **se exige, como antes de que esto
   * existiera**.
   *
   * Es deliberadamente conservador, y la alternativa era peor: si al no saber
   * la modalidad se dejara de pedir la dirección, bastaría con que el modelo
   * propusiera una modalidad que el negocio NO ofrece —normalizada a `null`—
   * para que un pedido a domicilio se cerrara sin dirección. Una propuesta
   * inválida no puede quitar requisitos.
   *
   * "No se sabe" no es "no hace falta": solo se relaja cuando hay una
   * modalidad REAL, ya normalizada contra lo que la ficha ofrece, y esa
   * modalidad no está en la lista.
   */
  if (!modalidadElegida) return true;

  return requisito.soloEnModalidades.includes(modalidadElegida);
}
