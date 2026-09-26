import { describe, expect, it } from "vitest";
import { aplicarOperaciones, type ContextoOperaciones } from "@/server/orders/operaciones";
import { estadoVacio } from "@/server/orders/estado";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * E2E del 26-sep-2026 (MALIA): "quiero 2 pavés de 8 oz, uno de milo y otro de
 * maracuyá, sin toppings". El modelo agregó dos líneas iguales de "Pavé 8 oz"
 * y después eligió el sabor de cada una. Las dos líneas eran IDÉNTICAS, así que
 * "elegir Milo para el Pavé 8 oz" se rechazaba por ambiguo — y el lote entero
 * (atómico, a propósito) se descartaba: el pedido quedó con 0 productos, el bot
 * mostró un resumen perfecto y al "sí, confirmo" no pudo cerrar. Falló dos
 * corridas seguidas.
 *
 * Entre líneas idénticas, da igual a cuál se le asigne la opción: el resultado
 * es el mismo pedido. La regla determinista: la opción va a la PRIMERA línea que
 * todavía la necesita. Solo cuando las candidatas son de verdad distintas sigue
 * siendo ambiguo (y se pregunta).
 */
const PAVE_8: ProductoDelCatalogo = {
  id: "prod_p8",
  nombre: "Pavé Cremoso 8 oz",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [
    {
      id: "g-sab",
      nombre: "Sabores",
      minimo: 1,
      maximo: 1,
      permiteRepeticion: false,
      opciones: [
        { id: "s-milo", nombre: "Milo", precioExtraCents: 0 },
        { id: "s-mara", nombre: "Maracuyá", precioExtraCents: 0 },
      ],
    },
    {
      id: "g-top",
      nombre: "Toppings",
      minimo: 0,
      maximo: 9,
      permiteRepeticion: false,
      opciones: [
        { id: "t-oreo", nombre: "Oreo", precioExtraCents: 200000 },
        { id: "t-mm", nombre: "M&M", precioExtraCents: 200000 },
      ],
    },
  ],
};

const ctx: ContextoOperaciones = {
  organizationId: "org_test",
  catalogo: [PAVE_8],
  requisitos: [],
  modalidadesOfrecidas: ["domicilio", "recoger"],
};

const agregar = (sabor: string) => ({
  tipo: "agregar_item" as const,
  ofrecible: "Pavé Cremoso 8 oz",
  opciones: [{ grupo: "Sabores", opcion: sabor }],
  cantidad: 1,
});

describe("varias líneas del mismo producto: la opción va a donde no hay duda", () => {
  it("el caso de MALIA: uno de Milo, otro de Maracuyá y 'sin toppings' dicho una vez — se guarda, los dos sin toppings", () => {
    const r = aplicarOperaciones(
      estadoVacio(),
      [agregar("Milo"), agregar("Maracuyá"), { tipo: "declinar_grupo", ofrecible: "Pavé Cremoso 8 oz", grupo: "Toppings" }],
      ctx
    );
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    const [a, b] = r.estadoFinal.items;
    expect(a!.seleccion.map((x) => x.nombre)).toEqual(["Milo"]);
    expect(b!.seleccion.map((x) => x.nombre)).toEqual(["Maracuyá"]);
    expect(a!.gruposDeclinados?.map((g) => g.grupoNombre)).toEqual(["Toppings"]);
    expect(b!.gruposDeclinados?.map((g) => g.grupoNombre)).toEqual(["Toppings"]);
    expect(r.estadoFinal.totalCents).toBe(2000000);
  });

  it("'sin toppings' dicho dos veces tampoco falla (no duplica)", () => {
    const d = { tipo: "declinar_grupo" as const, ofrecible: "Pavé Cremoso 8 oz", grupo: "Toppings" };
    const r = aplicarOperaciones(estadoVacio(), [agregar("Milo"), agregar("Maracuyá"), d, d], ctx);
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    expect(r.estadoFinal.items.map((i) => i.gruposDeclinados?.length)).toEqual([1, 1]);
  });

  it("dos líneas IDÉNTICAS (los dos de Milo): el topping va a la primera, da igual cuál", () => {
    const r = aplicarOperaciones(
      estadoVacio(),
      [agregar("Milo"), agregar("Milo"), { tipo: "elegir_opcion", ofrecible: "Pavé Cremoso 8 oz", grupo: "Toppings", opcion: "Oreo" }],
      ctx
    );
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    expect(r.estadoFinal.items.map((i) => i.seleccion.map((x) => x.nombre))).toEqual([["Milo", "Oreo"], ["Milo"]]);
  });

  it("CONTROL: líneas distintas y un topping sin decir para cuál → sigue siendo ambiguo (se pregunta)", () => {
    const r = aplicarOperaciones(
      estadoVacio(),
      [agregar("Milo"), agregar("Maracuyá"), { tipo: "elegir_opcion", ofrecible: "Pavé Cremoso 8 oz", grupo: "Toppings", opcion: "Oreo" }],
      ctx
    );
    expect(r.persistido).toBe(false);
  });

  it("CONTROL: con `opciones` que distinguen la línea, se usa eso", () => {
    const r = aplicarOperaciones(
      estadoVacio(),
      [
        agregar("Milo"),
        agregar("Maracuyá"),
        { tipo: "elegir_opcion", ofrecible: "Pavé Cremoso 8 oz", opciones: [{ grupo: "Sabores", opcion: "Maracuyá" }], grupo: "Toppings", opcion: "Oreo" },
      ],
      ctx
    );
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    expect(r.estadoFinal.items[1]!.seleccion.map((x) => x.nombre)).toEqual(["Maracuyá", "Oreo"]);
  });
});
