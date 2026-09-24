import { describe, expect, it } from "vitest";
import { Operacion } from "@/server/orders/operaciones";

/**
 * Alineación del contrato de `agregar_item` — hallazgo real en producción con
 * GPT-5 mini (24-sep-2026, conv cv_ymsfzdchi5aexoh3ybsr).
 *
 * El esquema del PROVEEDOR (`esquemaDeOperaciones`, pipeline.ts) declara
 * `opciones`, `cantidad` y `ofrecible` como `["<tipo>", "null"]` — es decir, el
 * modelo puede mandarlos en `null`. Pero el validador Zod exigía `opciones` y
 * `cantidad` como obligatorios no nulos, así que "quiero un cremoso de 7 oz"
 * (sin topping elegido aún) → `opciones: null` → Zod: "0.opciones Required" →
 * la operación se rechazaba y el pedido no se persistía.
 *
 * La semántica correcta del dominio: un producto se puede agregar antes de
 * elegir opciones. `opciones` ausente/null/[] significa lo mismo: "todavía no
 * hay opciones seleccionadas".
 *
 * 🛑 Lo que NO cambia: `ofrecible` (el producto) sigue siendo obligatorio. Un
 * `agregar_item` sin producto no tiene sentido y se sigue rechazando — no se
 * relaja Zod indiscriminadamente.
 */
const base = { tipo: "agregar_item", ofrecible: "Cremoso 7 oz" } as const;

describe("agregar_item: opciones representa 'todavía no elegidas' sin romperse", () => {
  it("opciones AUSENTE → se normaliza a []", () => {
    const r = Operacion.safeParse({ ...base, cantidad: 1 });
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") expect(r.data.opciones).toEqual([]);
  });

  it("opciones null → se normaliza a []", () => {
    const r = Operacion.safeParse({ ...base, cantidad: 1, opciones: null });
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") expect(r.data.opciones).toEqual([]);
  });

  it("opciones [] → permanece []", () => {
    const r = Operacion.safeParse({ ...base, cantidad: 1, opciones: [] });
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") expect(r.data.opciones).toEqual([]);
  });

  it("opciones con una lista real → se conserva intacta", () => {
    const r = Operacion.safeParse({
      ...base,
      cantidad: 2,
      opciones: [{ grupo: "Topping", opcion: "Milo" }],
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") {
      expect(r.data.opciones).toEqual([{ grupo: "Topping", opcion: "Milo" }]);
    }
  });
});

describe("agregar_item: cantidad tiene un default seguro (1)", () => {
  it("cantidad AUSENTE → 1", () => {
    const r = Operacion.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") expect(r.data.cantidad).toBe(1);
  });

  it("cantidad null → 1", () => {
    const r = Operacion.safeParse({ ...base, cantidad: null });
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") expect(r.data.cantidad).toBe(1);
  });

  it("cantidad real → se conserva", () => {
    const r = Operacion.safeParse({ ...base, cantidad: 3 });
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") expect(r.data.cantidad).toBe(3);
  });
});

describe("agregar_item: el producto SIGUE siendo obligatorio (no se relaja de más)", () => {
  it("ofrecible null → RECHAZADO", () => {
    expect(Operacion.safeParse({ tipo: "agregar_item", ofrecible: null, cantidad: 1, opciones: [] }).success).toBe(false);
  });

  it("ofrecible ausente → RECHAZADO", () => {
    expect(Operacion.safeParse({ tipo: "agregar_item", cantidad: 1, opciones: [] }).success).toBe(false);
  });
});

/**
 * Regresión de alineación proveedor ↔ Zod (FASE 7): tal como el modo estricto
 * del proveedor obliga, el modelo manda TODOS los campos del esquema, con los
 * que no aplican en `null`. Un `agregar_item` así —relleno de nulls— tiene que
 * parsear. Si alguien vuelve a poner un campo de `agregar_item` como
 * obligatorio-no-nulo sin default, este test se cae.
 */
describe("alineación proveedor ↔ Zod: un agregar_item relleno de nulls parsea", () => {
  const rellenoDeNulls = {
    tipo: "agregar_item",
    ofrecible: "Cremoso 7 oz",
    opciones: null,
    cantidad: null,
    grupo: null,
    opcion: null,
    modalidad: null,
    requisitoId: null,
    valor: null,
    esRegalo: null,
    servicio: null,
    fecha: null,
    hora: null,
    especialista: null,
  };

  it("parsea y normaliza (opciones=[], cantidad=1), ignorando los campos que no aplican", () => {
    const r = Operacion.safeParse(rellenoDeNulls);
    expect(r.success).toBe(true);
    if (r.success && r.data.tipo === "agregar_item") {
      expect(r.data.opciones).toEqual([]);
      expect(r.data.cantidad).toBe(1);
      expect(r.data.ofrecible).toBe("Cremoso 7 oz");
    }
  });
});
