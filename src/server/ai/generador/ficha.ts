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
};

/** Cuándo atiende. Los días son 1=lunes … 7=domingo. */
export type Horario = {
  dias: number[];
  abre: string;
  cierra: string;
  /** Si el domingo (u otro día) tiene horario propio. */
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
   */
  cierre?: { requisitos: Requisito[] };

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

  // ── 4. Cómo te pagan ───────────────────────────────────────────────────────
  pago: Pago;

  // ── 5. Cómo debe hablarle a sus clientes ───────────────────────────────────
  /** El tono, con las palabras del dueño. Ej: "cercano, con emojis, hablamos de nosotros". */
  tono: string;
  /** Si se puede pedir para regalo, y si hay tarjeta o dedicatoria. */
  regalos?: string;
  /** Menú o saludo inicial propio, si lo quiere. */
  saludoInicial?: string;

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
  if (!ficha.horario?.dias?.length) faltan.push("los días que atiende");
  if (!ficha.horario?.abre || !ficha.horario?.cierra) {
    faltan.push("el horario");
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

  if (ficha.vertical === "pedidos" && !ficha.catalogo?.trim()) {
    faltan.push("el catálogo con precios");
  }
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
 * Los requisitos de cierre de un negocio, ya resueltos.
 *
 * ⚠️ **Aquí vive el único valor por defecto de todo esto, y es deuda
 * declarada.** Los cuatro negocios dados de alta antes del 17-ago-2026 no
 * traen `cierre` en su ficha; sin este respaldo, desplegar el cambio los
 * dejaría cerrando pedidos sin pedir un nombre ni un teléfono. La alternativa
 * era reescribir cuatro fichas de producción para poder refactorizar, que es
 * exactamente lo que este proyecto no hace.
 *
 * **Vive en la ficha —el CRM— y no en el núcleo**: `estado.ts`, `normalizar.ts`,
 * `extraer.ts` y `pipeline.ts` no saben qué es un teléfono. Y se borra el día
 * que las cuatro fichas declaren lo suyo: entonces esta función se queda solo
 * con la primera línea.
 */
export function requisitosDe(ficha: FichaDelNegocio): Requisito[] {
  const declarados = ficha.cierre?.requisitos;
  if (declarados?.length) return declarados.filter((r) => aplica(r, ficha));

  const porDefecto: Requisito[] =
    ficha.vertical === "citas"
      ? [{ id: "nombre", tipo: "texto", etiqueta: "¿a nombre de quién?", obligatorio: true }]
      : [
          { id: "nombre", tipo: "texto", etiqueta: "¿a nombre de quién?", obligatorio: true },
          {
            id: "telefono",
            tipo: "telefono",
            etiqueta: "un celular de contacto",
            obligatorio: true,
          },
          {
            id: "direccion",
            tipo: "direccion",
            etiqueta: "la dirección de entrega",
            obligatorio: true,
            soloSi: "entrega.haceDomicilios",
          },
        ];
  return porDefecto.filter((r) => aplica(r, ficha));
}

/**
 * ¿Hace falta este requisito para ESTE negocio?
 *
 * `soloSi` es una referencia a un campo de la ficha —`"entrega.haceDomicilios"`—
 * y se lee tal cual. Sin operadores: en cuanto se admite `!=` o `&&`, esto deja
 * de ser configuración y pasa a ser un lenguaje que alguien tiene que mantener.
 */
function aplica(requisito: Requisito, ficha: FichaDelNegocio): boolean {
  if (!requisito.soloSi) return true;
  const valor = requisito.soloSi
    .split(".")
    .reduce<unknown>((obj, clave) => (obj as Record<string, unknown>)?.[clave], ficha);
  return Boolean(valor);
}
