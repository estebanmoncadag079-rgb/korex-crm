/**
 * `permiteRepeticion`, configurable desde el CRM (17-ago-2026).
 *
 * Lo que se comprueba aquí es **la parte sin base de datos**: la cuenta que
 * decide si un grupo se puede completar sin repetir —la que pinta el aviso de
 * la pantalla y el ⛔ del script de respaldo— y que el interruptor del CRM es
 * exactamente lo que desbloquea al validador.
 *
 * Lo que NO se repite aquí, a propósito:
 *
 * - que repetir se conserve o se pregunte según el grupo → ya está en
 *   `tercer-vertical.test.ts`, bloque *"la repetición la declara cada grupo"*;
 * - que el cambio persista, no se vea desde otra organización y llegue al
 *   catálogo del agente → necesita Postgres de verdad y está en
 *   `tests/integration/permite-repeticion-crm.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { repeticionObligatoria } from "@/lib/catalogo-repeticion";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { normalizarPedido, type EstadoPropuesto } from "@/server/orders/normalizar";

describe("cuándo un grupo NO se puede completar sin repetir", () => {
  it("pide más opciones de las que hay: repetir es la única salida", () => {
    // El Mega Box: cinco de cuatro sabores.
    expect(repeticionObligatoria({ maximo: 5, opciones: 4 })).toBe(true);
  });

  it("con opciones de sobra, repetir es una preferencia y no una necesidad", () => {
    expect(repeticionObligatoria({ maximo: 1, opciones: 4 })).toBe(false);
    expect(repeticionObligatoria({ maximo: 4, opciones: 4 })).toBe(false);
  });

  it("un grupo SIN opciones cargadas no es un problema de repetición", () => {
    /*
     * El validador se salta los grupos vacíos (`normalizar.ts`), así que avisar
     * aquí mandaría a alguien a tocar el interruptor cuando lo que le falta es
     * cargar las opciones.
     */
    expect(repeticionObligatoria({ maximo: 3, opciones: 0 })).toBe(false);
  });
});

/**
 * El interruptor del CRM y el pedido que desbloquea, atados en la misma prueba.
 *
 * El grupo es el caso real que la pantalla marca en ámbar: `maximo` 5 con 4
 * opciones. Con el interruptor apagado ese pedido **no se puede cerrar jamás**;
 * encendido, se cierra y se cobra igual.
 */
describe("el valor que se guarda desde el CRM manda en el validador", () => {
  const OPCIONES = [
    { id: "o1", nombre: "opción A", precioExtraCents: 0 },
    { id: "o2", nombre: "opción B", precioExtraCents: 0 },
    { id: "o3", nombre: "opción C", precioExtraCents: 0 },
    { id: "o4", nombre: "opción D", precioExtraCents: 0 },
  ];

  const carta = (permiteRepeticion: boolean): ProductoDelCatalogo[] => [
    {
      id: "p1",
      nombre: "CAJA GRANDE",
      categoria: null,
      precioCents: 5_000_000,
      descripcion: null,
      grupos: [
        {
          id: "g1",
          nombre: "ELECCIÓN",
          minimo: 5,
          maximo: 5,
          permiteRepeticion,
          opciones: OPCIONES,
        },
      ],
    },
  ];

  const pedido: EstadoPropuesto = {
    items: [
      {
        ofrecible: "CAJA GRANDE",
        cantidad: 1,
        opciones: [
          { grupo: "ELECCIÓN", opcion: "opción A" },
          { grupo: "ELECCIÓN", opcion: "opción A" },
          { grupo: "ELECCIÓN", opcion: "opción B" },
          { grupo: "ELECCIÓN", opcion: "opción C" },
          { grupo: "ELECCIÓN", opcion: "opción D" },
        ],
      },
    ],
    datos: {},
  };

  it("el aviso de la pantalla señala justo a este grupo", () => {
    expect(repeticionObligatoria({ maximo: 5, opciones: OPCIONES.length })).toBe(true);
  });

  it("apagado: el pedido se queda sin poder cerrarse, y se pregunta", () => {
    const r = normalizarPedido(pedido, carta(false), {});
    expect(r.estado.items[0]!.seleccion).toHaveLength(4); // la repetida no entra
    expect(r.dudas.length).toBeGreaterThan(0);
    expect(r.reconstruible).toBe(false);
    expect(r.estado.totalCents).toBeNull();
  });

  it("encendido desde el CRM: el mismo pedido se cierra y cuesta lo mismo", () => {
    const r = normalizarPedido(pedido, carta(true), {});
    expect(r.estado.items[0]!.seleccion).toHaveLength(5);
    expect(r.dudas).toEqual([]);
    expect(r.reconstruible).toBe(true);
    expect(r.estado.totalCents).toBe(5_000_000);
  });
});
