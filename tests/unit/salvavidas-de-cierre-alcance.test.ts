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

describe("dónde vive el enganche en pipeline.ts", () => {
  it("hay un ÚNICO punto de entrada — pipeline.ts no llama a los detectores por separado", () => {
    expect(pipeline).not.toContain("accionEvitablementeNoCerrada(");
    expect(pipeline).not.toContain("citaEvitablementeNoCerrada(");
    expect(pipeline).not.toContain("intentarRescateDeCierre(");
    expect(pipeline).not.toContain("intentarRescateDeCita(");
    const ocurrencias = pipeline.match(/intentarRescatarTurno\(/g) ?? [];
    expect(ocurrencias.length).toBe(1);
  });

  it("se llama DESPUÉS de todos los guardarraíles reactivos, antes del cierre de pedido", () => {
    const iEnganche = pipeline.indexOf("intentarRescatarTurno({");
    const iCierre = pipeline.indexOf('Guardarraíl de "pedido ya confirmado"');
    expect(iEnganche).toBeGreaterThan(0);
    expect(iCierre).toBeGreaterThan(0);
    expect(iEnganche).toBeLessThan(iCierre);
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
