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

  // ── 2. Qué ofrece y a qué precio ───────────────────────────────────────────
  /**
   * Productos o servicios con precio, uno por línea.
   *
   * En el vertical de `citas` esto se deja vacío: el catálogo vive en la tabla
   * `service` y el prompt lo recibe aparte, ya formateado y con duraciones.
   */
  catalogo?: string;
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
   * el tiempo. Se listan aquí para que el alta las capture de una vez.
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
  if (!ficha.horario?.abre || !ficha.horario?.cierra) faltan.push("el horario");

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
