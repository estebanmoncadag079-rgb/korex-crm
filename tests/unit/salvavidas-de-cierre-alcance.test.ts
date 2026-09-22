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
  it("el detector reutiliza puedeConfirmarPedido — no reimplementa su lógica", () => {
    expect(recuperacion).toContain("puedeConfirmarPedido(");
    // Ninguna palabra clave de handoff/reply se usa para DECIDIR — el único
    // criterio es el veredicto del backend.
    expect(recuperacion).not.toMatch(/action\.reason.*includes/i);
    expect(recuperacion).not.toMatch(/action\.text.*length/i);
  });

  it("sin estadoGuardado, el detector no llama a ningún modelo ni al backend", () => {
    // La primera línea de la función debe cortar ahí — no un `if` al final
    // que deje código previo ejecutándose igual.
    const cuerpo = recuperacion.slice(recuperacion.indexOf("export async function accionEvitablementeNoCerrada"));
    const primeraGuarda = cuerpo.indexOf("if (!input.estadoGuardado)");
    const primeraLlamadaAPolicy = cuerpo.indexOf("puedeConfirmarPedido(");
    expect(primeraGuarda).toBeGreaterThan(0);
    expect(primeraGuarda).toBeLessThan(primeraLlamadaAPolicy);
  });

  it("los montos del pedido rescatado salen de estadoGuardado, nunca de un modelo", () => {
    const cuerpo = recuperacion.slice(recuperacion.indexOf("const montos ="));
    const bloqueMontos = cuerpo.slice(0, cuerpo.indexOf("};") + 2);
    expect(bloqueMontos).toContain("input.estadoGuardado.totalCents");
    expect(bloqueMontos).not.toMatch(/juicio\.data/);
  });

  it("máximo dos llamadas a chatJson por intento — sin bucle", () => {
    const llamadas = recuperacion.match(/await chatJson\(/g) ?? [];
    expect(llamadas.length).toBe(2);
  });
});

describe("dónde vive el enganche en pipeline.ts", () => {
  it("se llama DESPUÉS de todos los guardarraíles reactivos, antes del cierre de pedido", () => {
    const iEnganche = pipeline.indexOf("accionEvitablementeNoCerrada({");
    const iCierre = pipeline.indexOf('Guardarraíl de "pedido ya confirmado"');
    expect(iEnganche).toBeGreaterThan(0);
    expect(iCierre).toBeGreaterThan(0);
    expect(iEnganche).toBeLessThan(iCierre);
  });

  it("nunca reintenta el rescate una segunda vez dentro del mismo turno", () => {
    const ocurrencias = pipeline.match(/intentarRescateDeCierre\(/g) ?? [];
    expect(ocurrencias.length).toBe(1);
  });

  it("si no se rescata, la acción original de GPT sigue intacta (comentario explícito)", () => {
    const bloque = pipeline.slice(
      pipeline.indexOf("accionEvitablementeNoCerrada({"),
      pipeline.indexOf('Guardarraíl de "pedido ya confirmado"')
    );
    expect(bloque).toMatch(/rescate\.rescatado === false/);
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
