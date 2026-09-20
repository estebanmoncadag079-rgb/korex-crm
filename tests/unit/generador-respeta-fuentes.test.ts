import { describe, expect, it } from "vitest";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import { generarPerfil } from "@/server/ai/generador/generar";
import { opcionesDeGeneracion } from "@/server/ai/generador/fuentes";
import { quitarPagoDuplicado } from "@/server/ai/generador/quitar-bloque-pago";

/**
 * EL CONTRATO DEL GENERADOR (20-sep-2026).
 *
 * Un dato que ya tiene fuente estructurada de autoridad **no se vuelve a
 * escribir dentro de `instructions`**. El generador lo decide él mismo,
 * mirando las columnas `*_source` de `agent_profile` — no un script externo.
 *
 * Por qué existe este archivo, con el caso real que lo obligó: el 19-sep-2026
 * `pnpm migrar:pago` quitó el bloque de pago del prompt de La Churra
 * (14.023 → 13.837 caracteres) y encendió `payment_source='ficha'`. Pero
 * `regenerar:flota` reconstruye el prompt desde la ficha y **nunca consultó
 * esa columna**: la siguiente regeneración devolvía los 186 caracteres
 * exactos que la migración había quitado. Migración y generador se
 * deshacían mutuamente, en bucle.
 *
 * La causa de fondo no era "falta un `if` para pagos": era que **cada sitio
 * que llama al generador traducía las columnas a mano**, cada uno un
 * subconjunto distinto, así que una fuente nueva nacía ignorada en todos los
 * que nadie se acordó de tocar. Por eso la traducción vive ahora en un solo
 * sitio (`opcionesDeGeneracion`) y estas pruebas la cubren a ella, no solo a
 * sus efectos.
 */

/** La ficha de Lis, con datos reales: si algo se pierde, se nota. */
const FICHA: FichaDelNegocio = {
  nombre: "Lis Pastelería",
  queVende: "Vendemos cremosos, polvorosos y tortas artesanales.",
  ubicacion: "Cali, barrio Santo Domingo",
  horario: { dias: [1, 2, 3, 4, 5, 6], abre: "10:00", cierra: "19:00" },
  vertical: "pedidos",
  catalogo: "Cremoso 7 oz — $12.000\nCremoso 12 oz — $18.000",
  entrega: {
    haceDomicilios: true,
    como: "Por Yango, llega en aproximadamente 1 hora.",
    quienPagaElDomicilio: "El domicilio se paga directamente al repartidor al recibir.",
    restricciones: "No ingresamos a apartamentos ni a centros comerciales.",
    recogerEnLocal: "Sí, en la Carrera 47 #13b-03, local 2.",
  },
  pago: {
    formas: "Transferencia bancaria — Bancolombia, Nequi y llave.",
    datosDeCuenta: "🏦 Bancolombia Ahorros 51400008565\n👤 Karen Liseth Ramírez",
    compruebaUnaPersona: true,
  },
  tono: "Dulce, alegre y cercano.",
  preguntasFrecuentes: [],
  escalarSiempre: ["Reclamos o quejas"],
  nuncaPrometer: ["Una hora exacta de entrega"],
};

// ───────────────────────────────────────────────── PAGO

describe("payment_source='ficha': el pago lo inyecta el pipeline, no el prompt", () => {
  const conFicha = generarPerfil(FICHA, { pagosEnFicha: true }).instructions;

  it("no escribe las formas de pago", () => {
    expect(conFicha).not.toContain("Formas de pago:");
    expect(conFicha).not.toContain("Transferencia bancaria — Bancolombia");
  });

  it("no escribe los datos de la cuenta: ni el rótulo ni un solo dígito", () => {
    expect(conFicha).not.toContain("Datos para el pago");
    expect(conFicha).not.toContain("51400008565");
    expect(conFicha).not.toContain("Karen Liseth Ramírez");
  });

  it("SÍ conserva la conducta: el comprobante lo revisa una persona", () => {
    // Es una regla de comportamiento, no un dato de `ficha.pago`. Quitarla
    // dejaría al agente dando pagos por buenos él solo.
    expect(conFicha).toContain("Pídele la foto del comprobante");
    expect(conFicha).toContain("lo revisa una persona del equipo");
  });

  it("no deja el encabezado '## Cómo te pagan' huérfano cuando no queda nada debajo", () => {
    const sinComprobante = generarPerfil(
      { ...FICHA, pago: { ...FICHA.pago, compruebaUnaPersona: false } },
      { pagosEnFicha: true }
    ).instructions;
    expect(sinComprobante).not.toContain("## Cómo te pagan");
  });
});

describe("payment_source='prompt': nada cambia (compatibilidad)", () => {
  const actual = generarPerfil(FICHA).instructions;

  it("sigue escribiendo formas y datos de cuenta, como hoy", () => {
    expect(actual).toContain("Formas de pago:");
    expect(actual).toContain("Datos para el pago");
    expect(actual).toContain("51400008565");
  });

  it("pasar la opción en false es idéntico a no pasarla", () => {
    expect(generarPerfil(FICHA, { pagosEnFicha: false }).instructions).toBe(actual);
  });

  it("Lashes Valen (citas + payment_source='prompt') conserva su bloque", () => {
    const citas = generarPerfil({ ...FICHA, vertical: "citas" }, { vertical: "citas" })
      .instructions;
    expect(citas).toContain("Formas de pago:");
  });
});

// ───────────────────────────────────────────────── DOMICILIO

describe("delivery_source='tabla': la tarifa la escribe el backend, no el resumen del modelo", () => {
  /*
   * MALIA es el caso real: `delivery_source='tabla'` con 350 zonas cargadas.
   * Su ficha ordena meter LITERALMENTE en cada resumen "el domicilio... debe
   * pagarlo junto con todo el pedido", mientras el backend adjunta al mismo
   * cierre su propio bloque verificado (Subtotal / Domicilio / Total, ver
   * `bloqueDeCifrasVerificadas`). Dos versiones del dinero del domicilio en
   * el mismo mensaje, y la del modelo sin nada que la respalde.
   */
  const conTabla = generarPerfil(FICHA, { domicilioEnTabla: true }).instructions;

  it("deja de forzar esa línea dentro del resumen del pedido", () => {
    expect(conTabla).not.toContain("Esta línea va SIEMPRE en el resumen del pedido");
    expect(conTabla).not.toContain("🛵 *El domicilio se paga directamente al repartidor");
  });

  it("NO borra la conducta de entrega: tiempos, restricciones y recogida siguen", () => {
    expect(conTabla).toContain("**Domicilio.**");
    expect(conTabla).toContain("Por Yango, llega en aproximadamente 1 hora.");
    expect(conTabla).toContain("No ingresamos a apartamentos ni a centros comerciales.");
    expect(conTabla).toContain("Recoger en el local");
    expect(conTabla).toContain("Carrera 47 #13b-03");
  });

  it("la política de quién paga sigue como contexto, sin la orden de citarla literal", () => {
    // El dato de CUÁNTO vale lo tiene `delivery_zone`; la política de CUÁNDO
    // se paga no está en ninguna tabla, así que el prompt sigue siendo su
    // única fuente y quitarla dejaría al agente sin saberlo.
    expect(conTabla).toContain("El domicilio se paga directamente al repartidor al recibir.");
  });

  it("nunca deja '**Domicilio.**' sin nada debajo", () => {
    const pelado = generarPerfil(
      {
        ...FICHA,
        entrega: {
          haceDomicilios: true,
          quienPagaElDomicilio: "El cliente lo cubre.",
          recogerEnLocal: "Sí, en el local.",
        },
      },
      { domicilioEnTabla: true }
    ).instructions;
    expect(pelado).toMatch(/\*\*Domicilio\.\*\*\s*\S/);
  });
});

describe("delivery_source='prompt': nada cambia (compatibilidad)", () => {
  const actual = generarPerfil(FICHA).instructions;

  it("La Churra y Lis conservan su línea forzada al resumen", () => {
    expect(actual).toContain("Esta línea va SIEMPRE en el resumen del pedido");
    expect(actual).toContain("🛵 *El domicilio se paga directamente al repartidor al recibir.*");
  });

  it("pasar la opción en false es idéntico a no pasarla", () => {
    expect(generarPerfil(FICHA, { domicilioEnTabla: false }).instructions).toBe(actual);
  });
});

// ───────────────────────────────────────────────── CATÁLOGO (no se rompe)

describe("catalog_source: el patrón que ya existía sigue igual", () => {
  it("'tabla' no escribe el catálogo en el prompt", () => {
    const p = generarPerfil(FICHA, { catalogoEnTabla: true }).instructions;
    expect(p).not.toContain("## Lo que vendes");
    expect(p).not.toContain("Cremoso 7 oz");
  });

  it("'prompt' lo sigue escribiendo", () => {
    const p = generarPerfil(FICHA).instructions;
    expect(p).toContain("## Lo que vendes");
    expect(p).toContain("Cremoso 7 oz");
  });
});

// ─────────────────────────────── LA TRADUCCIÓN, EN UN SOLO SITIO

describe("opcionesDeGeneracion: la fila de agent_profile decide, nadie más", () => {
  it("traduce las cuatro fuentes y el vertical de una sola vez", () => {
    expect(
      opcionesDeGeneracion({
        catalogSource: "tabla",
        paymentSource: "ficha",
        deliverySource: "tabla",
        menuMode: "guiado",
        appointmentsEnabled: false,
      })
    ).toEqual({
      catalogoEnTabla: true,
      pagosEnFicha: true,
      domicilioEnTabla: true,
      menuGuiado: true,
      vertical: "pedidos",
    });
  });

  it("una fila recién creada (todo por defecto) no suprime nada", () => {
    expect(
      opcionesDeGeneracion({
        catalogSource: "prompt",
        paymentSource: "prompt",
        deliverySource: "prompt",
        menuMode: "texto",
        appointmentsEnabled: false,
      })
    ).toEqual({
      catalogoEnTabla: false,
      pagosEnFicha: false,
      domicilioEnTabla: false,
      menuGuiado: false,
      vertical: "pedidos",
    });
  });

  it("sin `appointmentsEnabled` no inventa vertical: lo deja decidir a la ficha", () => {
    // Quien no leyó la columna no puede afirmar el vertical. Devolverlo aquí
    // a ciegas sería pisarle a la ficha lo único que le queda por decir.
    expect(opcionesDeGeneracion({ catalogSource: "tabla" }).vertical).toBeUndefined();
  });

  it("`appointmentsEnabled: true` es el vertical de citas", () => {
    expect(opcionesDeGeneracion({ appointmentsEnabled: true }).vertical).toBe("citas");
  });

  it("un valor desconocido en una columna NO suprime nada (falla hacia lo seguro)", () => {
    // Un `payment_source` corrupto o de una versión futura no puede dejar al
    // agente sin saber cobrar: en la duda se escribe el bloque, que es el
    // comportamiento de siempre.
    const o = opcionesDeGeneracion({ paymentSource: "otra_cosa", catalogSource: "" });
    expect(o.pagosEnFicha).toBe(false);
    expect(o.catalogoEnTabla).toBe(false);
  });
});

// ─────────────────────────────── LA REGRESIÓN QUE LO ORIGINÓ

describe("regenerar después de migrar ya no deshace la migración", () => {
  it("lo que `migrar:pago` quita, `generarPerfil` ya no lo repone", () => {
    /*
     * Reproduce el bucle exacto de La Churra, en dos pasos:
     *   1. el prompt de antes de migrar (payment_source='prompt'),
     *   2. `migrar:pago` lo limpia y enciende la columna,
     *   3. se regenera con la columna encendida.
     * Antes, el paso 3 devolvía el prompt del paso 1.
     */
    const antesDeMigrar = generarPerfil(FICHA).instructions;
    const { nuevo: limpiado, huboCambio } = quitarPagoDuplicado(antesDeMigrar);
    expect(huboCambio).toBe(true);

    const regenerado = generarPerfil(FICHA, { pagosEnFicha: true }).instructions;

    expect(regenerado.length).toBeLessThan(antesDeMigrar.length);
    expect(regenerado).not.toContain("51400008565");
    // El generador ya llega solo al mismo sitio al que llegaba el script.
    expect(regenerado).toBe(limpiado);
  });

  it("regenerar dos veces seguidas da exactamente lo mismo (idempotente)", () => {
    const opciones = { pagosEnFicha: true, catalogoEnTabla: true, domicilioEnTabla: true };
    expect(generarPerfil(FICHA, opciones).instructions).toBe(
      generarPerfil(FICHA, opciones).instructions
    );
  });
});

// ────────── LO QUE EL PROMPT DEJA DE DECIR, EL PIPELINE LO SIGUE DICIENDO

describe("nadie se queda sin el dato: el pipeline lo inyecta fresco", () => {
  it("lo que el generador quita con payment_source='ficha', lo pone pagoDePedidosParaElPrompt", async () => {
    /*
     * La comprobación que de verdad importa: suprimir un bloque solo es
     * seguro si el otro extremo lo repone. Si esta prueba falla, un agente
     * quedó sin saber cobrar — el peor resultado posible de este cambio,
     * peor que el duplicado que vinimos a quitar.
     */
    const { pagoDePedidosParaElPrompt } = await import("@/server/ai/prompts");
    const delPrompt = generarPerfil(FICHA, { pagosEnFicha: true }).instructions;
    const delPipeline = pagoDePedidosParaElPrompt(FICHA.pago);

    expect(delPrompt).not.toContain("51400008565");
    expect(delPipeline).toContain("51400008565");
    expect(delPipeline).toContain(FICHA.pago.formas);
    expect(delPipeline).toContain("MÉTODOS DE PAGO ACEPTADOS");
  });

  it("con delivery_source='tabla' el contrato de consulta sustituye a la línea del resumen", async () => {
    const { CONTRATO_DE_CONSULTA_DE_DOMICILIO } = await import("@/server/ai/prompts");
    // El resumen deja de llevar la frase de la ficha porque las cifras del
    // cierre las escribe el servidor, y el modelo tiene prohibido inventarlas.
    expect(CONTRATO_DE_CONSULTA_DE_DOMICILIO).toContain("consultar_domicilio");
    expect(CONTRATO_DE_CONSULTA_DE_DOMICILIO).toContain(
      "el servidor lo añade al final"
    );
  });
});
