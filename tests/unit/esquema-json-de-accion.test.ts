import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentAction,
  CAMPOS_DE_ACCION_DECLARADOS,
  formatoDeRespuestaConEstado,
} from "@/server/ai/actions";

/**
 * El contrato de acciones vive en DOS sitios a la fuerza: la unión de Zod (que
 * valida lo que llega) y el esquema JSON (que le dice al proveedor qué emitir).
 * Tenerlo escrito dos veces solo es seguro si algo avisa cuando se separan.
 *
 * Y separarse es caro de una forma concreta: con salidas estructuradas el
 * modelo emite **solo lo declarado**. Un campo nuevo en la unión que nadie
 * añada aquí no llegaría nunca — y se vería como "el modelo dejó de usar esa
 * acción", no como un esquema incompleto. Medido el 19-ago-2026: con un
 * esquema al que le faltaba `text`, la respuesta venía sin texto y el cliente
 * se habría quedado sin contestación.
 */
function camposDeLaUnion(): string[] {
  // `AgentAction` es la unión envuelta en un superRefine: hay que entrar.
  const union = (AgentAction as unknown as { innerType: () => z.ZodTypeAny }).innerType();
  const opciones = (union as unknown as { options: z.ZodObject<z.ZodRawShape>[] }).options;
  const campos = new Set<string>();
  for (const opcion of opciones) {
    for (const campo of Object.keys(opcion.shape)) campos.add(campo);
  }
  return [...campos];
}

describe("el esquema JSON de la acción no se separa de la unión de Zod", () => {
  it("declara TODOS los campos que alguna acción puede traer", () => {
    const faltan = camposDeLaUnion().filter((c) => !CAMPOS_DE_ACCION_DECLARADOS.includes(c));
    expect(
      faltan,
      `campos en la unión que el esquema JSON no declara (el modelo nunca los emitiría): ${faltan.join(", ")}`
    ).toEqual([]);
  });

  it("no declara campos que ya no existen en la unión", () => {
    const deLaUnion = camposDeLaUnion();
    const sobran = CAMPOS_DE_ACCION_DECLARADOS.filter((c) => !deLaUnion.includes(c));
    expect(sobran, `campos declarados que la unión ya no tiene: ${sobran.join(", ")}`).toEqual([]);
  });

  it("exige la acción y el estado en la misma respuesta, sin dejar cabos sueltos", () => {
    const formato = formatoDeRespuestaConEstado({ type: "object" }) as {
      json_schema: {
        strict: boolean;
        schema: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
      };
    };
    const { strict, schema } = formato.json_schema;

    expect(strict, "sin strict el proveedor trata el esquema como una sugerencia").toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("estado");
    expect(schema.required).toContain("action");
    // El modo estricto exige que TODA propiedad declarada esté en `required`:
    // si una se queda fuera, el proveedor rechaza la petición entera.
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
  });
});
