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
import { requisitosDe, type FichaDelNegocio, type Requisito } from "@/server/ai/generador/ficha";

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
      maximo: 1, permiteRepeticion: false,
      opciones: [
        { id: "t1", nombre: "estándar", precioExtraCents: 0 },
        { id: "t2", nombre: "cerámica", precioExtraCents: 8000000 },
      ],
    },
    {
      id: "g_urgencia",
      nombre: "URGENCIA",
      minimo: 0,
      maximo: 1, permiteRepeticion: false,
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
    const v = validarPropuesta((
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [
          { grupo: "TIPO DE PASTILLA", opcion: "cerámica" },
          { grupo: "URGENCIA", opcion: "mismo día" },
        ],
        datos: { placa: "ABC123" },
      }),
      [REPARACION],
      {},
      REQUISITOS
    );

    expect(v.ok).toBe(true);
    expect(v.estado.totalCents).toBe(12000000 + 8000000 + 3000000); // $230.000
    expect(v.estado.items[0]!.seleccion.map((s) => s.grupoNombre)).toEqual([
      "TIPO DE PASTILLA",
      "URGENCIA",
    ]);
  });

  it("exige lo que el taller pide, y NADA de lo que pide una churrería", () => {
    const sinPlaca = validarPropuesta((
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "estándar" }],
        datos: {},
        confirmado: true,
      }),
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
    const v = validarPropuesta((
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "estándar" }],
        datos: { placa: "ABC123" }, // sin `ordenSeguro`
        confirmado: true,
      }),
      [REPARACION],
      {},
      REQUISITOS
    );
    expect(v.ok).toBe(true);
  });

  it("le dice al modelo qué falta con las palabras del TALLER", () => {
    const v = validarPropuesta((
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [],
        datos: {},
      }),
      [REPARACION],
      {},
      REQUISITOS
    );

    const falta = loQueFalta(v.estado, [REPARACION], REQUISITOS);
    expect(falta).toEqual(["tipo de pastilla", "la placa del vehículo"]);
    // `URGENCIA` es opcional (minimo 0) y `ordenSeguro` también: no se piden.
    expect(falta).not.toContain("urgencia");
    expect(falta).not.toContain("el número de orden");
  });

  it("y el bloque del prompt habla de placas, no de salsas", () => {
    const v = validarPropuesta((
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "cerámica" }],
        datos: { placa: "ABC123" },
      }),
      [REPARACION],
      {},
      REQUISITOS
    );

    const texto = comoTexto(v.estado, [REPARACION], REQUISITOS);
    expect(texto).toContain("REVISIÓN DE FRENOS");
    expect(texto).toContain("tipo de pastilla: cerámica");
    // La placa es `documento`: se dice que ya la dio, no se repite el dato.
    expect(texto).toContain("la placa del vehículo: ya está");
    expect(texto).not.toContain("ABC123");
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * EL GUARDARRAÍL de la preocupación del dueño (17-ago).
 *
 * `requisitosDe()` tuvo valores por defecto durante unas horas. La forma que
 * tenían —una lista por vertical— acaba, con el tiempo, en:
 *
 *     if (vertical === "reparaciones") return [...];
 *
 * y con ello el conocimiento del negocio de vuelta en el código. Estas pruebas
 * fallan el día que alguien lo reintroduzca.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("ningún vertical trae requisitos por defecto en el código", () => {
  const sinDeclarar = (vertical: "pedidos" | "citas"): FichaDelNegocio =>
    ({
      nombre: "Cualquiera",
      vertical,
      queVende: "algo",
      catalogo: "COSA — $1.000",
      tono: "cercano",
      horario: { abre: "9:00 AM", cierra: "6:00 PM", dias: [1, 2, 3] },
      entrega: { haceDomicilios: true },
      pago: { formas: "efectivo", compruebaUnaPersona: true },
      saludoInicial: "Hola",
      preguntasFrecuentes: [],
      escalarSiempre: [],
      nuncaPrometer: [],
    }) as FichaDelNegocio;

  it("una ficha que no los declara devuelve `undefined`, en CUALQUIER vertical", () => {
    expect(requisitosDe(sinDeclarar("pedidos"))).toBeUndefined();
    expect(requisitosDe(sinDeclarar("citas"))).toBeUndefined();
  });

  it("y sin declararlos, un pedido NO se confirma: falla ruidoso, no en silencio", () => {
    const v = validarPropuesta((
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "estándar" }],
        datos: {},
        confirmado: true,
      }),
      [REPARACION],
      {},
      undefined // ← la ficha no los declara
    );
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("sin requisitos declarados");
  });

  it("pero declarar CERO requisitos sí es una decisión, y se respeta", () => {
    const ficha = { ...sinDeclarar("pedidos"), cierre: { requisitos: [] } };
    expect(requisitosDe(ficha)).toEqual([]);

    const v = validarPropuesta((
      {
        producto: "revisión de frenos",
        cantidad: 1,
        opciones: [{ grupo: "TIPO DE PASTILLA", opcion: "estándar" }],
        datos: {},
        confirmado: true,
      }),
      [REPARACION],
      {},
      []
    );
    expect(v.ok).toBe(true);
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * PASO 3A · La repetición es del CATÁLOGO, no del núcleo.
 *
 * Entre el 16 y el 17-ago fue una regla del núcleo DOS VECES: primero prohibida
 * —y un Mega Box, cinco salsas de cuatro sabores, no se podía cerrar jamás— y
 * luego universal, con lo que un salón admitía "esmaltado tradicional +
 * tradicional". Las dos veces la decidió lo que necesitaba UN negocio.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("la repetición la declara cada grupo", () => {
  /** Un grupo que NO admite repetir: es el valor por defecto. */
  const CON_ESMALTE: ProductoDelCatalogo = {
    id: "srv_manicura",
    nombre: "MANICURA",
    categoria: null,
    precioCents: 4500000,
    descripcion: null,
    grupos: [
      {
        id: "g_esm",
        nombre: "ESMALTADO",
        minimo: 1,
        maximo: 2,
        permiteRepeticion: false,
        opciones: [
          { id: "e1", nombre: "tradicional", precioExtraCents: 0 },
          { id: "e2", nombre: "semipermanente", precioExtraCents: 1500000 },
        ],
      },
    ],
  };

  /** El mismo grupo, declarando que sí. */
  const REPETIBLE: ProductoDelCatalogo = {
    ...CON_ESMALTE,
    grupos: [{ ...CON_ESMALTE.grupos[0]!, permiteRepeticion: true }],
  };

  it("sin declararlo, elegir dos veces lo mismo se PREGUNTA", () => {
    const v = validarPropuesta((
      {
        producto: "manicura",
        cantidad: 1,
        opciones: [
          { grupo: "ESMALTADO", opcion: "tradicional" },
          { grupo: "ESMALTADO", opcion: "tradicional" },
        ],
        datos: {},
      }),
      [CON_ESMALTE],
      {},
      []
    );
    expect(v.estado.items[0]!.seleccion).toHaveLength(1); // la segunda no entra
    expect(v.dudas.some((d) => d.preguntar.includes("¿Querías otra distinta?"))).toBe(true);
  });

  it("declarándolo, las dos se conservan", () => {
    const v = validarPropuesta((
      {
        producto: "manicura",
        cantidad: 1,
        opciones: [
          { grupo: "ESMALTADO", opcion: "tradicional" },
          { grupo: "ESMALTADO", opcion: "tradicional" },
        ],
        datos: {},
      }),
      [REPETIBLE],
      {},
      []
    );
    expect(v.estado.items[0]!.seleccion).toHaveLength(2);
    expect(v.dudas).toEqual([]);
  });

  it("dos opciones DISTINTAS del mismo grupo nunca fueron el problema", () => {
    const v = validarPropuesta((
      {
        producto: "manicura",
        cantidad: 1,
        opciones: [
          { grupo: "ESMALTADO", opcion: "tradicional" },
          { grupo: "ESMALTADO", opcion: "semipermanente" },
        ],
        datos: {},
      }),
      [CON_ESMALTE],
      {},
      []
    );
    expect(v.estado.items[0]!.seleccion).toHaveLength(2);
    expect(v.dudas).toEqual([]);
  });

  it("y repetir donde no se puede NO se recorta en silencio: se cobra bien lo que quedó", () => {
    const v = validarPropuesta((
      {
        producto: "manicura",
        cantidad: 1,
        opciones: [
          { grupo: "ESMALTADO", opcion: "semipermanente" },
          { grupo: "ESMALTADO", opcion: "semipermanente" },
        ],
        datos: {},
      }),
      [CON_ESMALTE],
      {},
      []
    );
    // Una sola vez el recargo, y con la duda encima: sin total hasta aclararlo.
    expect(v.estado.items[0]!.seleccion).toHaveLength(1);
    expect(v.estado.totalCents).toBeNull();
  });
});
