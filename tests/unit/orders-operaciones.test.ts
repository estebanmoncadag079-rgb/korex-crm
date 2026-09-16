import { describe, expect, it } from "vitest";
import { aplicarOperacion, aplicarOperaciones, type Operacion, type ContextoOperaciones } from "@/server/orders/operaciones";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * T011 — feature 003-backend-como-autoridad. Sin LLM: prueba `aplicarOperacion`
 * (las tres compuertas, `data-model.md` sección 3) y `aplicarOperaciones` (el
 * lote atómico, sección 2) directamente sobre datos en memoria.
 *
 * El caso central de atomicidad usa el ejemplo YA CORREGIDO de `data-model.md`
 * sección 6 (16-sep-2026): la versión anterior de ese ejemplo describía a
 * `cambiar_cantidad` rechazando por "disponibilidad real" de un producto, algo
 * que el catálogo de pedidos no tiene ni implementa — se sustituyó por
 * `cantidad: 0`, que sí es un rechazo real de la Compuerta 3 ya implementada
 * (T006). No se prueba, ni se simula, ningún concepto de stock/inventario.
 */

const PAVE_CHOCOLATE: ProductoDelCatalogo = {
  id: "prod_choco",
  nombre: "Pavé chocolate",
  categoria: "Pavés",
  precioCents: 1000000,
  descripcion: null,
  grupos: [],
};

const PAVE_VAINILLA: ProductoDelCatalogo = {
  id: "prod_vain",
  nombre: "Pavé vainilla",
  categoria: "Pavés",
  precioCents: 900000,
  descripcion: null,
  grupos: [],
};

const WAFFLE: ProductoDelCatalogo = {
  id: "prod_waffle",
  nombre: "Waffle",
  categoria: "Waffles",
  precioCents: 800000,
  descripcion: null,
  grupos: [
    {
      id: "g-top",
      nombre: "Toppings",
      minimo: 0,
      maximo: 1,
      permiteRepeticion: false,
      opciones: [
        { id: "t1", nombre: "Arequipe", precioExtraCents: 200000 },
        { id: "t2", nombre: "Nutella", precioExtraCents: 300000 },
      ],
    },
  ],
};

const CATALOGO = [PAVE_CHOCOLATE, PAVE_VAINILLA, WAFFLE];

const REQUISITOS: Requisito[] = [{ id: "direccion", tipo: "direccion", etiqueta: "la dirección de entrega", obligatorio: true }];

function contexto(overrides?: Partial<ContextoOperaciones>): ContextoOperaciones {
  return {
    organizationId: "org_test",
    catalogo: CATALOGO,
    requisitos: REQUISITOS,
    modalidadesOfrecidas: ["domicilio", "recoger"],
    ...overrides,
  };
}

/** Aplica una operación y falla el test (con el motivo del rechazo) si no pasó. */
function aplicarOk(estado: EstadoDelPedido, operacion: Operacion, ctx = contexto()): EstadoDelPedido {
  const r = aplicarOperacion(estado, operacion, ctx);
  if (!r.ok) throw new Error(`se esperaba éxito, rechazó: ${r.motivo}`);
  return r.estado;
}

describe("aplicarOperacion — pedidos", () => {
  describe("agregar_item", () => {
    it("resuelve el nombre contra el catálogo real y agrega la línea", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.items).toHaveLength(1);
      expect(r.estado.items[0]!.ofrecible).toEqual({ id: "prod_choco", nombre: "Pavé chocolate" });
      expect(r.estado.items[0]!.totalCents).toBe(1000000);
    });

    it("Compuerta 2: un nombre que no resuelve contra el catálogo rechaza", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "agregar_item", ofrecible: "Producto inexistente", opciones: [], cantidad: 1 }, contexto());
      expect(r.ok).toBe(false);
    });
  });

  describe("cambiar_cantidad", () => {
    it("Compuerta 2: rechaza si el nombre no está en el pedido actual", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "cambiar_cantidad", ofrecible: "Pavé chocolate", cantidad: 2 }, contexto());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toMatch(/no está en el pedido/);
    });

    it("Compuerta 3: cantidad 0 rechaza (la regla real — no hay stock/inventario en el catálogo)", () => {
      const conItem = aplicarOk(estadoVacio(), { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 });
      const r = aplicarOperacion(conItem, { tipo: "cambiar_cantidad", ofrecible: "Pavé chocolate", cantidad: 0 }, contexto());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe("cantidad inválida: 0");
    });

    it("con las dos compuertas en verde, cambia la cantidad y recalcula el total", () => {
      const conItem = aplicarOk(estadoVacio(), { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 });
      const r = aplicarOperacion(conItem, { tipo: "cambiar_cantidad", ofrecible: "Pavé chocolate", cantidad: 3 }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.items[0]!.cantidad).toBe(3);
      expect(r.estado.items[0]!.totalCents).toBe(3000000);
    });
  });

  describe("quitar_item", () => {
    it("Compuerta 2: rechaza si el nombre no está en el pedido", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "quitar_item", ofrecible: "Pavé chocolate" }, contexto());
      expect(r.ok).toBe(false);
    });

    it("quita la línea existente", () => {
      const conItem = aplicarOk(estadoVacio(), { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 });
      const r = aplicarOperacion(conItem, { tipo: "quitar_item", ofrecible: "Pavé chocolate" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.items).toHaveLength(0);
    });
  });

  describe("elegir_opcion / declinar_grupo", () => {
    it("Compuerta 2: rechaza si el ofrecible no está en el pedido", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "elegir_opcion", ofrecible: "Waffle", grupo: "Toppings", opcion: "Arequipe" }, contexto());
      expect(r.ok).toBe(false);
    });

    it("agrega la opción elegida y cobra su extra", () => {
      const conItem = aplicarOk(estadoVacio(), { tipo: "agregar_item", ofrecible: "Waffle", opciones: [], cantidad: 1 });
      const r = aplicarOperacion(conItem, { tipo: "elegir_opcion", ofrecible: "Waffle", grupo: "Toppings", opcion: "Arequipe" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.items[0]!.totalCents).toBe(1000000); // 800000 base + 200000 del topping

    });

    it("declinar_grupo marca el grupo como rechazado", () => {
      const conItem = aplicarOk(estadoVacio(), { tipo: "agregar_item", ofrecible: "Waffle", opciones: [], cantidad: 1 });
      const r = aplicarOperacion(conItem, { tipo: "declinar_grupo", ofrecible: "Waffle", grupo: "Toppings" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.items[0]!.gruposDeclinados).toEqual([{ grupoId: "g-top", grupoNombre: "Toppings" }]);
    });
  });

  describe("fijar_dato", () => {
    it("Compuerta 2: rechaza un requisito que este negocio no declaró", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "fijar_dato", requisitoId: "telefono", valor: "3001234567" }, contexto());
      expect(r.ok).toBe(false);
    });

    it("Compuerta 3: rechaza un valor vacío", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "fijar_dato", requisitoId: "direccion", valor: "  " }, contexto());
      expect(r.ok).toBe(false);
    });

    it("con las dos compuertas en verde, guarda el dato", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "fijar_dato", requisitoId: "direccion", valor: "Cra 1 # 2-3" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.datos.direccion).toBe("Cra 1 # 2-3");
    });
  });

  describe("fijar_modalidad", () => {
    it("rechaza una modalidad que este negocio no ofrece", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "fijar_modalidad", modalidad: "teletransportación" }, contexto());
      expect(r.ok).toBe(false);
    });

    it("resuelve contra las modalidades reales de este negocio", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "fijar_modalidad", modalidad: "Domicilio" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.modalidadDeEntrega).toBe("domicilio");
    });
  });

  describe("confirmar", () => {
    it("solo marca confirmado:true en memoria — sin validar si el pedido está completo", () => {
      const r = aplicarOperacion(estadoVacio(), { tipo: "confirmar" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.confirmado).toBe(true);
    });
  });

  it("un tipo desconocido (bypaseando Zod) cae al rechazo exhaustivo, no revienta", () => {
    const invalida = { tipo: "eliminar_todo" } as unknown as Operacion;
    const r = aplicarOperacion(estadoVacio(), invalida, contexto());
    expect(r.ok).toBe(false);
  });
});

describe("aplicarOperaciones — lote atómico (data-model.md sección 2)", () => {
  it("lote vacío: no cambia nada, devuelve el mismo estado", () => {
    const inicial = estadoVacio();
    const r = aplicarOperaciones(inicial, [], contexto());
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    expect(r.estadoFinal).toBe(inicial);
  });

  it("todas las operaciones pasan: se aplican en orden sobre el estado final", () => {
    const operaciones: Operacion[] = [
      { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 },
      { tipo: "fijar_dato", requisitoId: "direccion", valor: "Ciudad 2000" },
    ];
    const r = aplicarOperaciones(estadoVacio(), operaciones, contexto());
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    expect(r.estadoFinal.items).toHaveLength(1);
    expect(r.estadoFinal.datos.direccion).toBe("Ciudad 2000");
  });

  /**
   * El caso central de la corrección de atomicidad (data-model.md sección 6,
   * ejemplo corregido el 16-sep-2026): la operación 2 falla por una regla que
   * SÍ existe (cantidad inválida) — no se prueba disponibilidad ni stock,
   * porque el catálogo de pedidos no tiene ese concepto.
   */
  it("si la operación 2 de 3 falla, NINGUNA se persiste — ni siquiera la 1ª que sí había pasado", () => {
    const estadoInicial = estadoVacio();
    const operaciones: Operacion[] = [
      { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 },
      { tipo: "cambiar_cantidad", ofrecible: "Pavé chocolate", cantidad: 0 },
      { tipo: "confirmar" },
    ];
    const r = aplicarOperaciones(estadoInicial, operaciones, contexto());

    expect(r.persistido).toBe(false);
    if (r.persistido) return;
    expect(r.operacionFallida).toBe(1);
    expect(r.rechazo.motivo).toBe("cantidad inválida: 0");
    expect("estadoFinal" in r).toBe(false);

    // El estado ORIGINAL (el que se le habría pasado a guardarEstado) sigue
    // exactamente como estaba antes del turno — el pavé del paso 1 nunca
    // queda, y `confirmar` (paso 3) ni siquiera se evaluó.
    expect(estadoInicial.items).toHaveLength(0);
    expect(estadoInicial.confirmado).toBe(false);
  });
});
