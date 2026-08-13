import { describe, expect, it } from "vitest";
import { faltantesDeLaFicha, type FichaDelNegocio } from "@/server/ai/generador/ficha";
import { generarPerfil } from "@/server/ai/generador/generar";

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

  it("un negocio de pedidos sin catálogo no puede vender", () => {
    expect(faltantesDeLaFicha({ ...LIS, catalogo: "" })).toContain(
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
    expect(p.instructions).toContain("AQUÍ TERMINA EL MENSAJE");
    // Lo que se perdía: los datos de pago tras el "confirmo".
    expect(p.instructions).toMatch(/Solo DESPUÉS de que confirme/i);
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
