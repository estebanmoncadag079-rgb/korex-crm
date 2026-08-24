import { describe, expect, it } from "vitest";
import {
  countVariables,
  renderBody,
  resolveWabaId,
  validateBodyVariables,
} from "@/server/whatsapp/templates";

describe("countVariables / validateBodyVariables (FR-050)", () => {
  it("sin variables → 0, válido", () => {
    expect(countVariables("Hola, seguimos disponibles.")).toBe(0);
    expect(validateBodyVariables("Hola, seguimos disponibles.")).toBeNull();
  });

  it("una variable {{1}} → 1, válido (con y sin espacios)", () => {
    expect(countVariables("Hola {{1}}, ¿retomamos?")).toBe(1);
    expect(countVariables("Hola {{ 1 }}, ¿retomamos?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿retomamos?")).toBeNull();
  });

  it("dos variables → inválido (acotamiento v1)", () => {
    expect(countVariables("Hola {{1}}, tu pedido {{2}} llegó")).toBe(2);
    expect(
      validateBodyVariables("Hola {{1}}, tu pedido {{2}} llegó")
    ).toMatch(/una sola variable/);
  });

  it("variable {{2}} sola → inválida (debe ser {{1}})", () => {
    expect(validateBodyVariables("Tu pedido {{2}} llegó")).toMatch(/\{\{1\}\}/);
  });
});

describe("resolveWabaId (doc 131)", () => {
  it("cuenta de agencia o Meta directo: devuelve wabaId tal cual", () => {
    expect(
      resolveWabaId({ wabaId: "123456789", metaWabaId: null })
    ).toBe("123456789");
  });

  it("cuenta propia de YCloud con metaWabaId capturado: devuelve el real", () => {
    expect(
      resolveWabaId({ wabaId: "ycloud:573155136091", metaWabaId: "987654321" })
    ).toBe("987654321");
  });

  it("cuenta propia de YCloud sin metaWabaId: lanza TemplateError claro", () => {
    expect(() =>
      resolveWabaId({ wabaId: "ycloud:573155136091", metaWabaId: null })
    ).toThrowError(/WABA ID real de Meta no está disponible/);
  });
});

describe("renderBody", () => {
  it("sustituye la variable por el valor", () => {
    expect(renderBody("Hola {{1}}, ¿retomamos?", "María")).toBe(
      "Hola María, ¿retomamos?"
    );
  });

  it("sin valor → variable vacía", () => {
    expect(renderBody("Hola {{1}}!")).toBe("Hola !");
  });

  it("un valor con '$' no se interpreta como referencia de grupo", () => {
    // Antes: body.replace(REGEX, variable) trataba "$1" dentro del valor
    // como el grupo capturado por VARIABLE_REGEX, no como texto literal.
    expect(renderBody("Descuento: {{1}}", "$1,000 de descuento")).toBe(
      "Descuento: $1,000 de descuento"
    );
    expect(renderBody("Promo: {{1}}", "2x1 y $&aún más")).toBe(
      "Promo: 2x1 y $&aún más"
    );
  });
});
