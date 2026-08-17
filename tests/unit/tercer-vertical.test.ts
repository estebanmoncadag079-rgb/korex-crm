/**
 * La prueba de que el modelo admite un vertical que nadie ha programado.
 *
 * No basta con que funcione para pedidos y citas: son los dos que existen, y
 * cualquier modelo diseñado mirándolos los soporta por construcción. La pregunta
 * es otra — **¿entra un tercero sin tocar el núcleo?**
 *
 * El vertical inventado aquí es un TALLER DE REPARACIONES:
 *
 *   - lo que vende es un servicio con opciones (tipo de arreglo, urgencia),
 *   - lo que necesita para cerrar NO es una dirección ni un teléfono: es la
 *     PLACA del vehículo y el número de orden del seguro,
 *   - y no entrega nada a domicilio.
 *
 * Ninguna de esas tres cosas está escrita en `estado.ts`, `normalizar.ts`,
 * `extraer.ts` ni `pipeline.ts`. Si esta prueba pasa, el núcleo es
 * independiente del vertical de verdad y no de boquilla.
 */
import { describe, expect, it } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { validarPropuesta } from "@/server/orders/estado";
import { comoTexto, loQueFalta } from "@/server/orders/extraer";
import type { Requisito } from "@/server/ai/generador/ficha";

/** El catálogo del taller: un servicio con dos grupos de opciones. */
const REPARACION: ProductoDelCatalogo = {
  id: "srv_frenos",
  nombre: "REVISIÓN DE FRENOS",
  categoria: null,
  precioCents: 12000000, // $120.000
  descripcion: null,
  grupos: [
    {
      id: "g_tipo",
      nombre: "TIPO DE PASTILLA",
      minimo: 1,
      maximo: 1,
      opciones: [
        { id: "t1", nombre: "estándar", precioExtraCents: 0 },
        { id: "t2", nombre: "cerámica", precioExtraCents: 8000000 },
      ],
    },
    {
      id: "g_urgencia",
      nombre: "URGENCIA",
      minimo: 0,
      maximo: 1,
      opciones: [{ id: "u1", nombre: "mismo día", precioExtraCents: 3000000 }],
    },
  ],
};

/** Lo que este taller declara en SU ficha. Ni un campo lo conoce el núcleo. */
const REQUISITOS: Requisito[] = [
  { id: "placa", tipo: "documento", etiqueta: "la placa del vehículo", obligatorio: true },
  { id: "ordenSeguro", tipo: "documento", etiqueta: "el número de orden", obligatorio: false },
];

describe("un vertical que nadie programó: taller de reparaciones", () => {
  it("valida sus opciones y cobra bien, sin saber qué es una pastilla", () => {
    const v = validarPropuesta(
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [
          { grupo: "TIPO DE PASTILLA", opcion: "cerámica" },
          { grupo: "URGENCIA", opcion: "mismo día" },
        ],
        datos: { placa: "ABC123" },
      },
      [REPARACION],
      {},
      REQUISITOS
    );

    expect(v.ok).toBe(true);
    expect(v.estado.totalCents).toBe(12000000 + 8000000 + 3000000); // $230.000
    expect(v.estado.seleccion.map((s) => s.grupoNombre)).toEqual([
      "TIPO DE PASTILLA",
      "URGENCIA",
    ]);
  });

  it("exige lo que el taller pide, y NADA de lo que pide una churrería", () => {
    const sinPlaca = validarPropuesta(
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "estándar" }],
        datos: {},
        confirmado: true,
      },
      [REPARACION],
      {},
      REQUISITOS
    );

    expect(sinPlaca.ok).toBe(false);
    expect(sinPlaca.rechazos.join(" ")).toContain("la placa del vehículo");
    // Y lo que importa: NO pide dirección, ni teléfono, ni nombre.
    expect(sinPlaca.rechazos.join(" ")).not.toContain("dirección");
    expect(sinPlaca.rechazos.join(" ")).not.toContain("teléfono");
  });

  it("un requisito opcional no bloquea el cierre", () => {
    const v = validarPropuesta(
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "estándar" }],
        datos: { placa: "ABC123" }, // sin `ordenSeguro`
        confirmado: true,
      },
      [REPARACION],
      {},
      REQUISITOS
    );
    expect(v.ok).toBe(true);
  });

  it("le dice al modelo qué falta con las palabras del TALLER", () => {
    const v = validarPropuesta(
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [],
        datos: {},
      },
      [REPARACION],
      {},
      REQUISITOS
    );

    const falta = loQueFalta(v.estado, REPARACION, REQUISITOS);
    expect(falta).toEqual(["tipo de pastilla", "la placa del vehículo"]);
    // `URGENCIA` es opcional (minimo 0) y `ordenSeguro` también: no se piden.
    expect(falta).not.toContain("urgencia");
    expect(falta).not.toContain("el número de orden");
  });

  it("y el bloque del prompt habla de placas, no de salsas", () => {
    const v = validarPropuesta(
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "cerámica" }],
        datos: { placa: "ABC123" },
      },
      [REPARACION],
      {},
      REQUISITOS
    );

    const texto = comoTexto(v.estado, REPARACION, REQUISITOS);
    expect(texto).toContain("REVISIÓN DE FRENOS");
    expect(texto).toContain("tipo de pastilla: cerámica");
    // La placa es `documento`: se dice que ya la dio, no se repite el dato.
    expect(texto).toContain("la placa del vehículo: ya la dio");
    expect(texto).not.toContain("ABC123");
  });
});
