import { describe, expect, it } from "vitest";
import { faltantesDeLaFicha, type FichaDelNegocio } from "@/server/ai/generador/ficha";
import { generarPerfil } from "@/server/ai/generador/generar";
import { CIERRE, CIERRE_CITAS, ESTILO, meta, NUNCA } from "@/server/ai/generador/conducta";

/**
 * El generador de prompts (12-ago-2026).
 *
 * Nació de una pregunta del dueño que era la correcta: si cada cliente nuevo
 * obliga a cazar los errores uno por uno como se hizo con Lis, korex.ia no
 * escala a 10 negocios. La respuesta fue separar lo único de cada negocio (la
 * ficha, del cuestionario) de lo que vale para todos (la conducta), de modo que
 * un cliente nuevo nazca inmunizado sin copiar el prompt de nadie.
 *
 * La ficha de abajo es la de Lis Pastelería, con sus datos reales, para
 * comprobar que un prompt generado no pierde nada de lo que hoy funciona.
 */

const LIS: FichaDelNegocio = {
  nombre: "Lis Pastelería",
  queVende: "Vendemos cremosos, polvorosos y tortas artesanales.",
  ubicacion: "Cali, barrio Santo Domingo",
  horario: { dias: [1, 2, 3, 4, 5, 6], abre: "10:00", cierra: "19:00" },
  vertical: "pedidos",
  catalogo: "Cremoso 7 oz — $12.000\nCremoso 12 oz — $18.000\nCremoso 16 oz — $22.000",
  variantes: "El de 7 oz lleva 1 topping, el de 12 oz lleva 2 y el de 16 oz lleva 3.",
  entrega: {
    haceDomicilios: true,
    como: "Se hace por Yango y llega en 1 hora aproximadamente.",
    quienPagaElDomicilio:
      "El domicilio se paga aparte, directo al repartidor cuando llega.",
    restricciones: "No ingresamos a apartamentos ni centros comerciales.",
    recogerEnLocal: "Sí, puede pasar por el local en horario de atención.",
  },
  pago: {
    formas: "transferencia",
    datosDeCuenta: "Bancolombia Ahorros 51400008565 — Karen Liseth Ramírez",
    compruebaUnaPersona: true,
  },
  tono: "Dulce, alegre y cercano, con emojis y hablando de preparar con mucho amor.",
  regalos: "Sí, y se puede añadir una tarjeta con dedicatoria.",
  preguntasFrecuentes: [
    { pregunta: "¿Hacen envíos fuera de la ciudad?", respuesta: "Por ahora no." },
  ],
  escalarSiempre: ["Reclamos o quejas", "Pedidos muy grandes", "Devoluciones de dinero"],
  nuncaPrometer: ["Una hora exacta de entrega", "Descuentos por tu cuenta"],
};

describe("faltantesDeLaFicha: frena el alta antes de romper nada", () => {
  it("una ficha completa no tiene faltantes", () => {
    expect(faltantesDeLaFicha(LIS)).toEqual([]);
  });

  it("acepta transferencia sin cuenta = agente que cobra al aire", () => {
    const sinCuenta = { ...LIS, pago: { ...LIS.pago, datosDeCuenta: "" } };
    expect(faltantesDeLaFicha(sinCuenta)).toContain(
      "los datos de la cuenta para transferencias"
    );
  });

  it("domicilios sin decir quién los paga = discusión con el repartidor", () => {
    const sinQuienPaga = {
      ...LIS,
      entrega: { ...LIS.entrega, quienPagaElDomicilio: "" },
    };
    expect(faltantesDeLaFicha(sinQuienPaga)).toContain(
      "quién paga el domicilio y cuándo"
    );
  });

  it("un negocio de pedidos sin catálogo en la ficha SÍ puede terminar el alta (25-ago-2026)", () => {
    // El catálogo ya no se pide en el cuestionario: se carga en la pantalla
    // Catálogo, con sus productos y grupos de opciones en tablas — no hay
    // texto que exigir aquí, y exigirlo bloquearía un alta que puede
    // completarse perfectamente sin él.
    expect(faltantesDeLaFicha({ ...LIS, catalogo: "" })).not.toContain(
      "el catálogo con precios"
    );
  });

  it("generarPerfil se niega si la ficha está incompleta", () => {
    expect(() => generarPerfil({ ...LIS, nombre: "" })).toThrow(/falta en la ficha/i);
  });
});

describe("el prompt generado lleva lo del negocio", () => {
  const p = generarPerfil(LIS);

  it("su identidad, su catálogo y su cuenta, tal cual", () => {
    expect(p.instructions).toContain("Lis Pastelería");
    expect(p.instructions).toContain("Cremoso 16 oz — $22.000");
    expect(p.instructions).toContain("51400008565");
    expect(p.instructions).toContain("Dulce, alegre y cercano");
  });

  it("la línea del domicilio, en negrita y obligatoria en el resumen", () => {
    expect(p.instructions).toContain(
      "*El domicilio se paga aparte, directo al repartidor cuando llega.*"
    );
    expect(p.instructions).toMatch(/SIEMPRE en el resumen/i);
  });

  it("las reglas de escalado propias del negocio", () => {
    expect(p.escalationRules).toContain("Reclamos o quejas");
    expect(p.escalationRules).toContain("Devoluciones de dinero");
  });

  it("sus prohibiciones se SUMAN a las universales, no las sustituyen", () => {
    expect(p.instructions).toContain("Una hora exacta de entrega");
    expect(p.instructions).toMatch(/Nunca inventes datos duros/i);
  });
});

describe("el prompt generado lleva las lecciones de todos", () => {
  const p = generarPerfil(LIS);

  it("separa los dos momentos del cierre — la lección del 12-ago", () => {
    expect(p.instructions).toContain("MOMENTO 1");
    expect(p.instructions).toContain("MOMENTO 2");
    // Sin el "AQUÍ"/"AHÍ" inicial: lo que importa es que el corte esté, no
    // cómo empiece la frase. Esta prueba se rompió sola al reescribir el
    // bloque, avisando de un cambio que no tenía nada de malo.
    expect(p.instructions).toMatch(/TERMINA EL MENSAJE/);
    // Lo que se perdía: los datos de pago tras el "confirmo".
    expect(p.instructions).toMatch(/Solo DESPUÉS de que confirme/i);
  });

  /**
   * Los tres fallos que aparecieron al probar un pedido completo de La Churra
   * (13-ago): el agente saltaba el resumen, cerraba con `reply` en vez de
   * `notify_order` —así que el pedido no existía para la cocina— y volvía a
   * preguntar la forma de entrega que el cliente acababa de darle.
   */
  it("exige el resumen y manda usar notify_order al confirmar", () => {
    expect(p.instructions).toMatch(/resumen es OBLIGATORIO/i);
    expect(p.instructions).toContain("notify_order");
    expect(p.instructions).toMatch(/en el negocio no se entera nadie/i);
  });

  it("prohíbe volver a preguntar lo que el cliente ya dijo", () => {
    expect(p.instructions).toMatch(/NO se vuelve a preguntar/i);
  });

  it("prohíbe anunciar lo que no se hizo — cierre falso y cita fantasma", () => {
    expect(p.instructions).toMatch(/Nunca anuncies algo que no hiciste/i);
  });

  it("protege el producto que ya estaba pedido", () => {
    expect(p.instructions).toMatch(/Nunca dejes caer algo que el cliente ya había pedido/i);
  });

  it("no deja confirmar pagos por su cuenta", () => {
    expect(p.instructions).toMatch(/Nunca confirmes un pago por tu cuenta/i);
  });

  it("atiende varios mensajes seguidos sin escalar por eso", () => {
    expect(p.instructions).toMatch(/Atiende \*\*todas\*\*/i);
  });

  /**
   * 25-ago-2026 (Lis): el saludo ofrece "Preguntas frecuentes" como opción
   * de menú, y al elegirla el agente volcó de un tirón toda su base de
   * preguntas y respuestas en vez de preguntar qué quería saber el cliente.
   */
  it("no vuelca las preguntas frecuentes: pregunta primero qué quieren saber", () => {
    expect(p.instructions).toMatch(/no le mandes tu conocimiento completo de una vez/i);
    expect(p.instructions).toMatch(/preg[uú]ntale con calidez[\s\S]*gustar[ií]a saber/i);
  });
});

describe("se adapta al negocio sin dejar huecos", () => {
  it("un negocio sin domicilios no habla de domicilios", () => {
    const soloLocal: FichaDelNegocio = {
      ...LIS,
      entrega: { haceDomicilios: false, recogerEnLocal: "Pasa por el local." },
    };
    const p = generarPerfil(soloLocal);
    expect(p.instructions).toContain("No hay domicilios");
    expect(p.instructions).not.toContain("🛵");
  });

  /**
   * El orden de las preguntas, que faltaba y lo detectó el dueño: "el agente
   * queda muy suelto con esto". Sin orden explícito pedía la dirección antes
   * que el producto, o los datos de a poquitos.
   */
  it("dice el ORDEN en que preguntar, no solo qué necesita", () => {
    const p = generarPerfil(LIS).instructions;
    expect(p).toContain("El orden en que preguntas");
    // El orden importa: el pago va al final, después de confirmar.
    expect(p.indexOf("Qué quiere y cuántos")).toBeLessThan(
      p.indexOf("Su nombre y su celular")
    );
    expect(p.indexOf("Su nombre y su celular")).toBeLessThan(
      p.indexOf("Los datos de pago")
    );
  });

  it("manda agrupar las preguntas en vez de ir de una en una", () => {
    expect(generarPerfil(LIS).instructions).toMatch(/en el MISMO mensaje/i);
  });

  it("el vertical de citas cambia la meta y no repite el catálogo", () => {
    const salon: FichaDelNegocio = {
      ...LIS,
      nombre: "Studio Bella",
      vertical: "citas",
      catalogo: undefined,
      queVende: "Pestañas, cejas y uñas.",
    };
    const p = generarPerfil(salon);
    expect(p.instructions).toMatch(/dejar la cita agendada/i);
    expect(p.instructions).not.toContain("Cremoso");
    // El catálogo de citas llega aparte, desde la tabla `service`.
    expect(p.instructions).not.toContain("## Lo que vendes");
  });

  /**
   * 13-ago-2026. El salón nació con el ritual de PEDIDOS completo: hablaba de
   * `notify_order`, de "en la cocina no se entera nadie", del "total con la
   * cifra" y de domicilios — en un negocio donde solo hay que agendar.
   * `meta(vertical)` distinguía los dos mundos; el cierre, no.
   */
  it("un negocio de citas no hereda el cierre de pedidos", () => {
    const salon: FichaDelNegocio = {
      ...LIS,
      nombre: "Studio Bella",
      vertical: "citas",
      catalogo: undefined,
      queVende: "Pestañas, cejas y uñas.",
    };
    const p = generarPerfil(salon);

    expect(p.instructions).toMatch(/Cómo se cierra una cita/i);
    expect(p.instructions).toMatch(/nunca la inventes/i);

    expect(p.instructions).not.toContain("notify_order");
    expect(p.instructions).not.toContain("en el negocio no se entera nadie");
    expect(p.instructions).not.toMatch(/MOMENTO 2/);
    // Ni domicilios ni "ofrécele recoger" a quien viene a que le hagan las uñas.
    expect(p.instructions).not.toMatch(/domicilio/i);
    expect(p.instructions).not.toMatch(/ofrécele recoger/i);
  });

  it("un negocio de pedidos conserva su cierre de siempre", () => {
    const p = generarPerfil(LIS);
    expect(p.instructions).toContain("notify_order");
    expect(p.instructions).toMatch(/MOMENTO 1/);
    expect(p.instructions).not.toMatch(/Cómo se cierra una cita/i);
  });

  it("sin saludo propio, genera uno con el nombre del negocio", () => {
    const p = generarPerfil({ ...LIS, saludoInicial: undefined });
    expect(p.greeting).toContain("Lis Pastelería");
  });

  it("no deja títulos huérfanos cuando falta un dato opcional", () => {
    const p = generarPerfil({ ...LIS, regalos: undefined, variantes: undefined });
    expect(p.instructions).not.toContain("## Regalos");
    expect(p.instructions).not.toMatch(/\n\n\n/); // sin huecos dobles
  });

  /**
   * El campo que faltaba y salió al comparar el prompt generado con el real:
   * las reglas que un negocio acumula y no encajan en ninguna categoría. Sin
   * esto, migrar un cliente vivo perdía justo lo que lo distingue.
   */
  it("recoge las reglas propias que no encajan en ninguna categoría", () => {
    const p = generarPerfil({
      ...LIS,
      reglasPropias: [
        "Si el cliente dice que no le abre el enlace del menú, mándaselo escrito.",
        "Las sodas y el café solo se venden en el punto; a domicilio solo agua.",
      ],
    });
    expect(p.instructions).toContain("## Reglas propias de este negocio");
    expect(p.instructions).toContain("a domicilio solo agua");
    // Van antes del cierre: son del día a día, no una advertencia final.
    expect(p.instructions.indexOf("Reglas propias")).toBeLessThan(
      p.instructions.indexOf("MOMENTO 1")
    );
  });

  it("sin reglas propias, no aparece la sección", () => {
    expect(generarPerfil(LIS).instructions).not.toContain("## Reglas propias");
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * LA CONDUCTA COMÚN NO SABE DE NINGÚN SECTOR (paso 3, 17-ago-2026).
 *
 * `conducta.ts` se lo lleva TODO cliente de VOCERO. Hasta hoy hablaba de
 * salsas, toppings, sabores y de "en la cocina no se entera nadie" — el
 * vocabulario de un negocio de comida dentro del prompt que comparten un salón
 * de pestañas, una papelería y lo que venga.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("la conducta común es de todos, no de un sector", () => {
  const TEXTOS = [ESTILO, CIERRE, CIERRE_CITAS, NUNCA, meta("pedidos"), meta("citas")];

  it("ni una palabra de comida en el texto que se lleva cualquier negocio", () => {
    const prohibidas = /salsa|churro|topping|arequipe|recubiert|cocina|sabor/i;
    const culpables = TEXTOS.filter((t) => prohibidas.test(t));
    expect(culpables).toEqual([]);
  });

  it("EL DETECTOR DETECTA: un texto con vocabulario de comida lo dispara", () => {
    // Sin esta prueba, la de arriba estaría verde aunque el patrón no
    // encontrara nada — que es como un guardarraíl deja de servir sin avisar.
    expect(/salsa|churro|topping|arequipe|recubiert|cocina|sabor/i.test(
      "pídele las salsas y el recubierto"
    )).toBe(true);
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * Y SABE QUE UN PEDIDO PUEDE LLEVAR VARIAS COSAS.
 *
 * De nada sirve que el estado aguante tres productos si el agente los
 * pregunta de uno en uno — que es lo que pasó de verdad el 17-ago.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("el agente sabe que se piden varias cosas a la vez", () => {
  it("pedidos: dice que se apunten todas y se pregunte en UN mensaje", () => {
    const t = meta("pedidos");
    expect(t).toContain("VARIAS cosas");
    expect(t).toMatch(/anótalo todo de una vez/i);
    // Lo que falló: preguntar otra vez algo ya dicho al pasar a la otra cosa.
    expect(t).toMatch(/no se lo vuelvas a preguntar/i);
  });

  it("pedidos: las opciones son de CADA cosa, y no se mezclan", () => {
    const t = meta("pedidos");
    expect(t).toContain("CADA cosa");
    expect(t).toMatch(/no se mezclan/i);
  });

  it("citas: varios servicios son UNA visita, con su tiempo sumado", () => {
    // La regla 9: lo mismo, comprobado en el otro vertical.
    const t = meta("citas");
    expect(t).toContain("VARIOS servicios");
    expect(t).toMatch(/una sola visita/i);
    expect(t).toMatch(/tiempo de todos juntos/i);
  });

  it("el resumen lleva una línea por cosa", () => {
    expect(CIERRE).toMatch(/una línea por cosa/i);
  });
});
