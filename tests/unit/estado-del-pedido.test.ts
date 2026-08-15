/**
 * Fase 2 · el validador y el extractor, sin base de datos.
 *
 * La regla que gobierna estas pruebas: **el modelo propone y el backend
 * decide**. Cada caso comprueba que una propuesta razonable del modelo no basta
 * para que algo se persista.
 */
import { describe, expect, it } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { estadoVacio, validarPropuesta, type EstadoDelPedido } from "@/server/orders/estado";
import { comoTexto, leerAporte, loQueFalta } from "@/server/orders/extraer";

const SALSAS = [
  { id: "o1", nombre: "chocolate negro", precioExtraCents: 0 },
  { id: "o2", nombre: "arequipe", precioExtraCents: 0 },
  { id: "o3", nombre: "lechera", precioExtraCents: 0 },
];
const CHURRITA: ProductoDelCatalogo = {
  id: "prod_churrita",
  nombre: "CHURRITA",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [{ id: "g1", nombre: "SALSA", minimo: 1, maximo: 1, opciones: SALSAS }],
};
const CARTA = [CHURRITA];
const UNIDADES = { CHURRITA: 6 };

const propuesta = (p: Partial<Parameters<typeof validarPropuesta>[0]> = {}) => ({
  producto: "churrita",
  cantidad: 1,
  salsas: ["arequipe"],
  recubierto: null,
  adiciones: [],
  nombre: null,
  telefono: null,
  direccion: null,
  ...p,
});

describe("el backend resuelve, no el modelo", () => {
  it("guarda el ID del producto, no solo el nombre que dijo el modelo", () => {
    const v = validarPropuesta(propuesta(), CARTA, UNIDADES);
    expect(v.ok).toBe(true);
    expect(v.estado.producto.id).toBe("prod_churrita");
    expect(v.estado.producto.nombre).toBe("CHURRITA");
  });

  it("el total lo calcula el servidor", () => {
    const v = validarPropuesta(propuesta(), CARTA, UNIDADES);
    expect(v.estado.totalCents).toBe(1000000);
  });

  it("corrige el nombre sin rechazar la conversación", () => {
    const v = validarPropuesta(propuesta({ producto: "Churritas" }), CARTA, UNIDADES);
    expect(v.ok).toBe(true);
    expect(v.correcciones.join(" ")).toContain("CHURRITA");
  });
});

describe("corrupción deliberada", () => {
  it("producto que no existe en la carta", () => {
    const v = validarPropuesta(propuesta({ producto: "PIZZA" }), CARTA, UNIDADES);
    expect(v.estado.producto.id).toBeNull();
    expect(v.dudas.some((d) => d.campo === "producto")).toBe(true);
  });

  it("producto de OTRA organización: no resuelve", () => {
    // Aunque el modelo lo nombre bien, si no está en el catálogo de este
    // negocio no existe. Es la barrera contra la fuga entre clientes.
    const v = validarPropuesta(propuesta({ producto: "TORTA DE CHOCOLATE" }), CARTA, UNIDADES);
    expect(v.estado.producto.id).toBeNull();
  });

  it("salsa incompatible con el producto → RECHAZO", () => {
    const v = validarPropuesta(propuesta({ salsas: ["mostaza"] }), CARTA, UNIDADES);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("mostaza");
  });

  it("cantidad 0 → RECHAZO", () => {
    const v = validarPropuesta(propuesta({ cantidad: 0 }), CARTA, UNIDADES);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("cantidad inválida");
  });

  it("cantidad negativa → RECHAZO", () => {
    expect(validarPropuesta(propuesta({ cantidad: -3 }), CARTA, UNIDADES).ok).toBe(false);
  });

  it("cantidad decimal → RECHAZO", () => {
    expect(validarPropuesta(propuesta({ cantidad: 1.5 }), CARTA, UNIDADES).ok).toBe(false);
  });

  it('"6 churros" no se cobra ×6: se pregunta', () => {
    const v = validarPropuesta(
      propuesta({ producto: "churros", cantidad: 6 }),
      CARTA,
      UNIDADES
    );
    expect(v.estado.producto.cantidad).toBe(1);
    expect(v.dudas.some((d) => d.campo === "cantidad")).toBe(true);
  });
});

describe("estados imposibles", () => {
  const completo = {
    producto: "churrita",
    cantidad: 1,
    salsas: ["arequipe"],
    recubierto: null,
    adiciones: [],
    nombre: "Andrea",
    telefono: "3001234567",
    direccion: "Cra 5 #10-20",
    confirmado: true,
  };

  it("confirmado sin producto → RECHAZO", () => {
    const v = validarPropuesta({ ...completo, producto: null }, CARTA, UNIDADES);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("sin producto");
  });

  it("confirmado sin teléfono → RECHAZO", () => {
    const v = validarPropuesta({ ...completo, telefono: null }, CARTA, UNIDADES);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("sin teléfono");
  });

  it("confirmado sin dirección → RECHAZO", () => {
    expect(validarPropuesta({ ...completo, direccion: "  " }, CARTA, UNIDADES).ok).toBe(false);
  });

  it("un pedido completo y confirmado SÍ pasa", () => {
    const v = validarPropuesta(completo, CARTA, UNIDADES);
    expect(v.ok).toBe(true);
    expect(v.estado.confirmado).toBe(true);
    expect(v.estado.totalCents).toBe(1000000);
  });

  it("el paso numérico no rompe nada (el prompt numera sus mensajes)", () => {
    const v = validarPropuesta({ ...propuesta(), paso: 2 }, CARTA, UNIDADES);
    expect(v.estado.paso).toBe("2");
  });
});

describe("qué aportó el cliente en este turno", () => {
  const base: EstadoDelPedido = {
    ...estadoVacio(),
    producto: { id: "prod_churrita", nombre: "CHURRITA", cantidad: 1 },
  };

  it("distingue lo nuevo de lo que cambia y de lo que permanece", () => {
    const despues: EstadoDelPedido = { ...base, salsas: ["arequipe"] };
    const l = leerAporte(base, despues);
    expect(l.nuevo.map((n) => n.campo)).toEqual(["salsas"]);
    expect(l.permanece).toContain("producto");
    expect(l.cambia).toEqual([]);
  });

  it("un cambio de opinión NO es información nueva", () => {
    const antes: EstadoDelPedido = { ...base, salsas: ["arequipe"] };
    const despues: EstadoDelPedido = { ...base, salsas: ["lechera"] };
    const l = leerAporte(antes, despues);
    expect(l.cambia.map((c) => c.campo)).toEqual(["salsas"]);
    expect(l.nuevo).toEqual([]);
  });

  it("en una conversación nueva, todo lo dicho es aporte", () => {
    const l = leerAporte(null, base);
    expect(l.nuevo.map((n) => n.campo)).toContain("producto");
  });
});

describe("lo que el backend le recuerda al modelo", () => {
  it("dice qué falta, en el orden del flujo", () => {
    const e: EstadoDelPedido = {
      ...estadoVacio(),
      producto: { id: "prod_churrita", nombre: "CHURRITA", cantidad: 1 },
    };
    expect(loQueFalta(e, 1)).toEqual(["salsas", "recubierto", "nombre", "teléfono", "dirección"]);
  });

  it("el bloque del prompt no repite el teléfono, solo dice que ya lo tiene", () => {
    const e: EstadoDelPedido = {
      ...estadoVacio(),
      producto: { id: "prod_churrita", nombre: "CHURRITA", cantidad: 1 },
      salsas: ["arequipe"],
      entrega: { nombre: "Andrea", telefono: "3001234567", direccion: "Cra 5" },
      totalCents: 1000000,
    };
    const texto = comoTexto(e, 1);
    expect(texto).toContain("teléfono: ya lo dio");
    expect(texto).not.toContain("3001234567"); // el dato no se repite en el prompt
    expect(texto).toContain("$10.000");
  });

  it("sin pedido en curso no inyecta nada: el prompt no engorda porque sí", () => {
    expect(comoTexto(estadoVacio(), 1)).toBe("");
  });
});
