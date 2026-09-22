/**
 * Fija el ALCANCE del salvavidas de cierre (`docs/korexia/189`), no su
 * comportamiento —eso ya lo prueba `recuperacion-de-turno.test.ts`—.
 *
 * La excepción autorizada sobre `docs/korexia/156` es estrecha a propósito:
 * solo se activa cuando hay una fuente backend-autoritativa (`estadoGuardado`)
 * que respalde la decisión. Generalizarla a "cualquier handoff" —la
 * heurística que el propio encargo prohibió— sería exactamente el defecto
 * que doc 156 identificó y este archivo existe para que nadie lo reintroduzca
 * sin darse cuenta, en un refactor futuro.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const recuperacion = readFileSync("src/server/ai/recuperacion-de-turno.ts", "utf8");
const pipeline = readFileSync("src/server/ai/pipeline.ts", "utf8");

describe("el detector no es una heurística de texto", () => {
  it("los DOS detectores reutilizan su Policy — ninguno reimplementa lógica", () => {
    expect(recuperacion).toContain("puedeConfirmarPedido(");
    expect(recuperacion).toContain("puedeConfirmarCita(");
    // Ninguna palabra clave de handoff/reply se usa para DECIDIR — el único
    // criterio es el veredicto del backend.
    expect(recuperacion).not.toMatch(/action\.reason.*includes/i);
    expect(recuperacion).not.toMatch(/action\.text.*length/i);
  });

  it("sin estadoGuardado, NINGUNO de los dos detectores llama a nada más", () => {
    for (const nombreFuncion of ["accionEvitablementeNoCerrada", "citaEvitablementeNoCerrada"]) {
      const inicio = recuperacion.indexOf(`function ${nombreFuncion}`);
      expect(inicio).toBeGreaterThan(0);
      const cuerpo = recuperacion.slice(inicio, inicio + 700);
      const primeraGuarda = cuerpo.indexOf("if (!input.estadoGuardado)");
      const primeraLlamadaAPolicy = Math.max(
        cuerpo.indexOf("puedeConfirmarPedido("),
        cuerpo.indexOf("puedeConfirmarCita(")
      );
      expect(primeraGuarda).toBeGreaterThan(0);
      // La guarda de estadoGuardado va ANTES que cualquier llamada al backend.
      const llamadasReales = [cuerpo.indexOf("puedeConfirmarPedido("), cuerpo.indexOf("puedeConfirmarCita(")]
        .filter((i) => i > 0);
      for (const i of llamadasReales) expect(primeraGuarda).toBeLessThan(i);
      void primeraLlamadaAPolicy;
    }
  });

  it("los datos del rescate (montos, fecha, hora) salen de estadoGuardado, nunca de un modelo", () => {
    // El rescate de PEDIDO: los montos.
    const pedido = recuperacion.slice(
      recuperacion.indexOf("export async function intentarRescateDeCierre"),
      recuperacion.indexOf("/** Rescate de CITA")
    );
    expect(pedido).toContain("input.estadoGuardado.totalCents");
    expect(pedido).not.toMatch(/resultado\.summary.*totalCents|juicio\.data\.total/);

    // El rescate de CITA: fecha/hora/servicios.
    const cita = recuperacion.slice(
      recuperacion.indexOf("export async function intentarRescateDeCita")
    );
    expect(cita).toContain("reserva.fecha!");
    expect(cita).toContain("reserva.hora!");
    expect(cita).toContain("input.estadoGuardado.items.map");
  });

  it("máximo dos llamadas a chatJson en TODO el archivo — un solo motor compartido, sin bucle", () => {
    // Un solo `juicioYRedaccion` con 2 llamadas, reutilizado por pedidos Y
    // citas: si hubiera dos motores independientes, esto subiría a 4.
    const llamadas = recuperacion.match(/await chatJson\(/g) ?? [];
    expect(llamadas.length).toBe(2);
  });

  it("citas queda explícitamente FUERA para reschedule/cancel — no hay señal que invertir", () => {
    expect(recuperacion).toMatch(/reschedule_appointment/);
    expect(recuperacion).toMatch(/cancel_appointment/);
    expect(recuperacion).toMatch(/FUERA de alcance/);
  });
});

/**
 * `deliveryFeeCents` — corrección del 21-sep-2026 (noche). El rescate de
 * pedidos no lo poblaba: tenía menos datos estructurados que un
 * `notify_order` normal. Corregido reutilizando `cifrasNumericasDelCierre`
 * (`anuncio-de-cierre.ts`), la MISMA función que ahora también usa
 * `bloqueDeCifrasVerificadas` para su texto — una sola fuente de verdad
 * para "qué cobra este cierre", nunca dos versiones que puedan divergir.
 */
describe("deliveryFeeCents del pedido rescatado sale de la autoridad backend", () => {
  const anuncioDeCierre = readFileSync("src/server/ai/anuncio-de-cierre.ts", "utf8");

  it("el rescate de pedido importa y usa cifrasNumericasDelCierre — no reimplementa la cuenta", () => {
    expect(recuperacion).toContain("cifrasNumericasDelCierre");
    const pedido = recuperacion.slice(
      recuperacion.indexOf("export async function intentarRescateDeCierre"),
      recuperacion.indexOf("/** Rescate de CITA")
    );
    expect(pedido).toContain("cifrasNumericasDelCierre(");
    // La suma a mano (`subtotalCents + entrega.feeCents`) no debe existir
    // AQUÍ: si existe, es que se duplicó la cuenta en vez de reutilizarla.
    expect(pedido).not.toMatch(/subtotalCents\s*\+\s*.*feeCents/);
  });

  it("recibe `entrega` desde pipeline.ts — la misma variable que valida un cierre normal", () => {
    // `entregaPersistida` es la variable que `inconsistenciaFinancieraDePedido`
    // usa unas líneas más abajo para validar lo que GPT propone. El rescate
    // debe recibir esa MISMA variable, no una copia ni un recálculo.
    const bloque = pipeline.slice(
      pipeline.indexOf("intentarRescatarTurno({"),
      pipeline.indexOf("Consistencia financiera del cierre")
    );
    expect(bloque).toMatch(/entrega:\s*entregaPersistida/);
  });

  it("cifrasNumericasDelCierre y bloqueDeCifrasVerificadas comparten la misma aritmética", () => {
    // No es la misma línea de código (una devuelve texto, la otra números),
    // pero `bloqueDeCifrasVerificadas` debe LLAMAR a la función numérica
    // para su caso de domicilio con tarifa — no debe haber una segunda suma
    // independiente que pueda desincronizarse.
    const bloqueTexto = anuncioDeCierre.slice(
      anuncioDeCierre.indexOf("export function bloqueDeCifrasVerificadas")
    );
    expect(bloqueTexto).toContain("cifrasNumericasDelCierre(");
  });
});

/**
 * Requisito explícito de la corrección: verificar que CITAS no tenga un
 * vacío estructural equivalente al que tenía pedidos.
 */
describe("citas — sin equivalente estructural pendiente (verificado, no solo asumido)", () => {
  it("book_appointment no tiene ningún campo de precio/tarifa en su contrato", () => {
    const actions = readFileSync("src/server/ai/actions.ts", "utf8");
    const bloque = actions.slice(
      actions.indexOf('action: z.literal("book_appointment")'),
      actions.indexOf('action: z.literal("reschedule_appointment")')
    );
    // Los únicos campos de book_appointment son reservas[] y farewell — se
    // fija aquí para que un campo nuevo en el esquema no pase inadvertido
    // sin que alguien revise si el rescate de citas debe poblarlo también.
    expect(bloque).toMatch(/servicios:/);
    expect(bloque).toMatch(/fecha:/);
    expect(bloque).toMatch(/hora:/);
    expect(bloque).toMatch(/especialista:/);
    expect(bloque).toMatch(/farewell:/);
    expect(bloque).not.toMatch(/Cents|precio|tarifa|fee/i);
  });

  it("el rescate de cita puebla los CUATRO campos de reservas[] — ninguno queda en blanco por diseño", () => {
    const cita = recuperacion.slice(recuperacion.indexOf("export async function intentarRescateDeCita"));
    expect(cita).toMatch(/servicios:\s*input\.estadoGuardado\.items\.map/);
    expect(cita).toMatch(/fecha:\s*reserva\.fecha!/);
    expect(cita).toMatch(/hora:\s*reserva\.hora!/);
    expect(cita).toMatch(/especialista:\s*reserva\.recursoNombre/);
    expect(cita).toContain("farewell: resultado.farewell");
  });
});

describe("dónde vive el enganche en pipeline.ts", () => {
  it("hay un ÚNICO punto de entrada — pipeline.ts no llama a los detectores por separado", () => {
    expect(pipeline).not.toContain("accionEvitablementeNoCerrada(");
    expect(pipeline).not.toContain("citaEvitablementeNoCerrada(");
    expect(pipeline).not.toContain("intentarRescateDeCierre(");
    expect(pipeline).not.toContain("intentarRescateDeCita(");
    const ocurrencias = pipeline.match(/intentarRescatarTurno\(/g) ?? [];
    expect(ocurrencias.length).toBe(1);
  });

  it("se llama ANTES de los guardarraíles del cierre — para que la acción rescatada los atraviese", () => {
    /**
     * Corrección del 21-sep-2026 (noche), sobre un hallazgo de la auditoría
     * independiente del commit 26bf657: el enganche vivía DESPUÉS de
     * `inconsistenciaFinancieraDePedido`/`bloqueDeDomicilioPendiente`, así
     * que una acción rescatada nunca los veía — tenía MENOS validación que
     * un cierre que GPT propone por su cuenta. Ahora vive antes de esos dos
     * y de todo lo demás que depende de `action.action === "notify_order"`,
     * pero después de los guardarraíles que no dependen del cierre
     * (disponibilidad, producto, domicilio contradicho).
     */
    const iEnganche = pipeline.indexOf("intentarRescatarTurno({");
    const iFinanciero = pipeline.indexOf("Consistencia financiera del cierre");
    const iCierre = pipeline.indexOf('Guardarraíl de "pedido ya confirmado"');
    expect(iEnganche).toBeGreaterThan(0);
    expect(iFinanciero).toBeGreaterThan(0);
    expect(iCierre).toBeGreaterThan(0);
    expect(iEnganche).toBeLessThan(iFinanciero);
    expect(iFinanciero).toBeLessThan(iCierre);
  });

  it("si no se rescata (null), la acción original de GPT sigue intacta (comentario explícito)", () => {
    const bloque = pipeline.slice(
      pipeline.indexOf("intentarRescatarTurno({"),
      pipeline.indexOf('Guardarraíl de "pedido ya confirmado"')
    );
    expect(bloque).toMatch(/rescate\.rescatado === false/);
    expect(bloque).toMatch(/rescate === null/);
  });
});

describe("la excepción sobre doc 156 queda documentada, no borrada", () => {
  it("doc 156 sigue existiendo y sin marcarse como reemplazado", () => {
    const doc156 = readFileSync("docs/korexia/156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX.md", "utf8");
    expect(doc156).not.toMatch(/reemplazad[oa] por/i);
    expect(doc156).not.toMatch(/obsoleto/i);
  });

  it("existe el documento de excepción, y nombra a doc 156 explícitamente", () => {
    const doc189 = readFileSync(
      "docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md",
      "utf8"
    );
    expect(doc189).toContain("156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX");
    expect(doc189).toMatch(/no reemplaza ni invalida/i);
  });
});
