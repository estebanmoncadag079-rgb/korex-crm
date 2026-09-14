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

  /**
   * La otra mitad del mismo contrato: no basta con que el campo EXISTA en los
   * dos sitios, tiene que aceptar los mismos VALORES.
   *
   * El modo estricto obliga a declarar toda propiedad en `required`, así que
   * el modelo emite todas en cada respuesta y rellena con `null` las que no
   * apliquen a la acción elegida. Si Zod declara un campo `.optional()` sin
   * `.nullable()`, ese `null` legítimo revienta la validación entera.
   *
   * Pasó en producción el 14-sep-2026: `totalCents` se añadió a `reply`
   * copiando la forma de `notify_order` (`.optional()` a secas). Seis turnos
   * rotos en dos horas con "no cumple el esquema: totalCents Expected number,
   * received null", cada uno terminando en handoff por `backend_error` y
   * dejando al cliente esperando minutos. `notify_order` se salvaba porque su
   * camino limpia los nulos antes de validar; el bucle de
   * `consultar_domicilio` llama al modelo directo y no limpia nada.
   */
  it("acepta los null que el modo estricto obliga al modelo a emitir", () => {
    const comoLoManda = {
      action: "reply" as const,
      text: "Domicilio a Ciudad 2000: $8.000. Total: $26.000.",
      deliveryFeeCents: null,
      totalCents: null,
    };
    const r = AgentAction.safeParse(comoLoManda);
    expect(
      r.success,
      `un reply con los numéricos en null debe validar: ${r.success ? "" : JSON.stringify(r.error.issues)}`
    ).toBe(true);

    // Y con valores reales sigue validando, que es para lo que existen.
    expect(
      AgentAction.safeParse({ ...comoLoManda, deliveryFeeCents: 800000, totalCents: 2600000 }).success
    ).toBe(true);
  });
});
