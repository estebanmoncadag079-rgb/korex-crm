/**
 * El catálogo de casos ambiguos de la Fase 1.5, con los datos reales de La
 * Churra ([67-FASE-1.5.md](../../docs/korexia/67-FASE-1.5.md)).
 *
 * Cada caso es una frase que un cliente escribió o podría escribir, y lo que el
 * backend debe entender. El caso que da origen a todo esto es *"quiero 6
 * churros"*: JSON válido, producto existente, y **$60.000 en vez de $10.000**.
 */
import { describe, expect, it } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { normalizarPedido } from "@/server/orders/normalizar";

const SALSAS = [
  { id: "o1", nombre: "chocolate negro", precioExtraCents: 0 },
  { id: "o2", nombre: "arequipe", precioExtraCents: 0 },
  { id: "o3", nombre: "lechera", precioExtraCents: 0 },
  { id: "o4", nombre: "chocolate blanco", precioExtraCents: 0 },
];

function presentacion(
  id: string,
  nombre: string,
  precioCents: number,
  cuantasSalsas: number
): ProductoDelCatalogo {
  return {
    id,
    nombre,
    categoria: null,
    precioCents,
    descripcion: null,
    grupos: [
      {
        id: `g-${id}`,
        nombre: "SALSA",
        minimo: cuantasSalsas,
        maximo: cuantasSalsas,
        opciones: SALSAS,
      },
    ],
  };
}

const CHURRITA = presentacion("p1", "CHURRITA", 1000000, 1);
const CARTA: ProductoDelCatalogo[] = [
  CHURRITA,
  presentacion("p2", "BESTIES", 2000000, 2),
  presentacion("p3", "FAMILY BOX", 3200000, 3),
  presentacion("p4", "MEGA BOX", 5000000, 5),
];

/** Cuántos churros trae cada presentación. Ver el test que explica por qué NO
 * sale de la base de datos. */
const UNIDADES = { CHURRITA: 6, BESTIES: 14, "FAMILY BOX": 22, "MEGA BOX": 34 };

const vacio = {
  producto: null,
  cantidad: null,
  salsas: [] as string[],
  recubierto: null,
  adiciones: [] as string[],
};

describe("unidades contra presentaciones", () => {
  // Decisión del dueño (15-ago-2026): ante la ambigüedad de unidades, el
  // agente PUEDE preguntar. Confirmar cuesta un mensaje; equivocarse cuesta
  // $50.000 y un cliente. Y la pregunta no depende del negocio: la duda la
  // levanta el backend, no una regla escrita en el prompt de cada cliente.
  it('"quiero 6 churros" NO son seis Churritas', () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churros", cantidad: 6, salsas: ["arequipe"] },
      CARTA,
      UNIDADES
    );
    // Lo que importa: que no cobre 60.000.
    expect(r.estado.cantidad).toBe(1);
    expect(r.dudas.some((d) => d.campo === "cantidad")).toBe(true);
    expect(r.reconstruible).toBe(false);
  });

  it('"una caja de 6" es una Churrita', () => {
    const r = normalizarPedido({ ...vacio, producto: "caja de 6" }, CARTA, UNIDADES);
    expect(r.estado.producto).toBe("CHURRITA");
    expect(r.correcciones.some((c) => c.regla.includes("6 unidades"))).toBe(true);
  });

  it("sin el dato de unidades, el backend NO adivina: pregunta", () => {
    // Este es el estado REAL de producción: `product.description` está vacío,
    // así que el backend no sabe que una Churrita son 6 churros.
    const r = normalizarPedido({ ...vacio, producto: "6 churros" }, CARTA);
    expect(r.estado.producto).toBeNull();
    expect(r.dudas.map((d) => d.porque).join(" ")).toContain(
      "no dice cuántas trae cada presentación"
    );
    expect(r.reconstruible).toBe(false);
  });
});

describe("cantidades de presentaciones", () => {
  it('"dame dos Family Box" son dos presentaciones', () => {
    const r = normalizarPedido(
      {
        ...vacio,
        producto: "Family Box",
        cantidad: 2,
        salsas: ["arequipe", "lechera", "chocolate negro"],
      },
      CARTA,
      UNIDADES
    );
    expect(r.estado.producto).toBe("FAMILY BOX");
    expect(r.estado.cantidad).toBe(2);
    expect(r.estado.totalCents).toBe(6400000); // el servidor multiplica, no el modelo
    expect(r.reconstruible).toBe(true);
  });

  it("una presentación sin número es una", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", salsas: ["arequipe"] },
      CARTA,
      UNIDADES
    );
    expect(r.estado.cantidad).toBe(1);
    expect(r.estado.totalCents).toBe(1000000);
  });
});

describe("opciones que llegan como si fueran productos", () => {
  it('"ponme una churrita con chocolate" separa presentación y salsa', () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita con chocolate negro", salsas: ["chocolate negro"] },
      CARTA,
      UNIDADES
    );
    expect(r.estado.producto).toBe("CHURRITA");
    expect(r.estado.salsas).toEqual(["chocolate negro"]);
    expect(r.reconstruible).toBe(true);
  });

  it('"chocolate" a secas es una salsa, y falta saber la presentación', () => {
    const r = normalizarPedido({ ...vacio, producto: "arequipe" }, CARTA, UNIDADES);
    expect(r.estado.producto).toBeNull();
    expect(r.estado.salsas).toEqual(["arequipe"]);
    expect(r.dudas.some((d) => d.preguntar.includes("presentación"))).toBe(true);
  });
});

describe("normaliza en vez de rechazar (regla 3)", () => {
  it("acepta mayúsculas, tildes y plural", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "Churritas", salsas: ["Arequipe"] },
      CARTA,
      UNIDADES
    );
    expect(r.estado.producto).toBe("CHURRITA");
    expect(r.estado.salsas).toEqual(["arequipe"]);
    expect(r.reconstruible).toBe(true);
  });

  it("una salsa que no existe no tumba el pedido: se pregunta", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", salsas: ["fresa"] },
      CARTA,
      UNIDADES
    );
    expect(r.estado.producto).toBe("CHURRITA");
    expect(r.dudas.some((d) => d.porque.includes("fresa"))).toBe(true);
  });
});

describe("el total lo calcula el servidor (regla 2)", () => {
  it("no hay total mientras queden dudas", () => {
    const r = normalizarPedido({ ...vacio, producto: "mega box" }, CARTA, UNIDADES);
    expect(r.estado.totalCents).toBeNull();
    expect(r.reconstruible).toBe(false);
  });

  it("suma las adiciones que se cobran aparte", () => {
    const conAdicion: ProductoDelCatalogo[] = [
      {
        ...CHURRITA,
        grupos: [
          presentacion("p1", "CHURRITA", 1000000, 1).grupos[0]!,
          {
            id: "g-ad",
            nombre: "ADICIONES",
            minimo: 0,
            maximo: 5,
            opciones: [{ id: "a1", nombre: "botella de agua", precioExtraCents: 200000 }],
          },
        ],
      },
    ];
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", salsas: ["arequipe"], adiciones: ["botella de agua"] },
      conAdicion,
      UNIDADES
    );
    expect(r.estado.totalCents).toBe(1200000);
  });

  it("sin precio cargado NO es gratis: se pregunta", () => {
    const sinPrecio: ProductoDelCatalogo[] = [{ ...CHURRITA, precioCents: null }];
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", salsas: ["arequipe"] },
      sinPrecio,
      UNIDADES
    );
    expect(r.estado.totalCents).toBeNull();
    expect(r.dudas.some((d) => d.campo === "total")).toBe(true);
  });
});

/**
 * El flujo REAL del negocio, dictado por el dueño el 15-ago-2026:
 *
 *   carta → presentación → salsas (1/2/3/5 según cuál) → recubierto
 *   (azúcar-canela · azúcar sola · sin azúcar) → adiciones → nombre, teléfono
 *   y dirección → listo.
 *
 * ⚠️ Hoy la tabla `product` **solo** tiene el grupo SALSA: el recubierto y las
 * adiciones siguen viviendo únicamente en el prompt. Estas pruebas fijan el
 * comportamiento para cuando estén cargados, y el caso de que NO lo estén.
 */
describe("el flujo completo del pedido", () => {
  const RECUBIERTOS = [
    { id: "r1", nombre: "azúcar-canela", precioExtraCents: 0 },
    { id: "r2", nombre: "azúcar sola", precioExtraCents: 0 },
    { id: "r3", nombre: "sin azúcar", precioExtraCents: 0 },
  ];
  const ADICIONES = [
    { id: "a1", nombre: "botella de agua", precioExtraCents: 200000 },
    { id: "a2", nombre: "salsa de chocolate", precioExtraCents: 200000 },
    { id: "a3", nombre: "lechera", precioExtraCents: 150000 },
  ];
  const churritaCompleta: ProductoDelCatalogo = {
    ...CHURRITA,
    grupos: [
      { id: "gs", nombre: "SALSA", minimo: 1, maximo: 1, opciones: SALSAS },
      { id: "gr", nombre: "RECUBIERTO", minimo: 1, maximo: 1, opciones: RECUBIERTOS },
      { id: "ga", nombre: "ADICIONES", minimo: 0, maximo: 5, opciones: ADICIONES },
    ],
  };
  const CARTA_COMPLETA = [churritaCompleta];

  it("dice todo lo que falta, en el orden del flujo", () => {
    const r = normalizarPedido({ ...vacio, producto: "churrita" }, CARTA_COMPLETA, UNIDADES);
    expect(r.faltaParaCerrar).toEqual([
      "salsas",
      "recubierto",
      "nombre",
      "teléfono",
      "dirección",
    ]);
  });

  it("un pedido con todo no deja nada pendiente, y el total lo suma el servidor", () => {
    const r = normalizarPedido(
      {
        producto: "churrita",
        cantidad: 1,
        salsas: ["arequipe"],
        recubierto: "azúcar-canela",
        adiciones: ["botella de agua"],
        nombre: "Andrea",
        telefono: "3001234567",
        direccion: "Cra 5 #10-20",
      },
      CARTA_COMPLETA,
      UNIDADES
    );
    expect(r.faltaParaCerrar).toEqual([]);
    expect(r.estado.totalCents).toBe(1200000); // $10.000 + $2.000 de la botella
    expect(r.reconstruible).toBe(true);
  });

  it("el recubierto se valida contra la carta, no contra lo que suene bien", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", salsas: ["arequipe"], recubierto: "con miel" },
      CARTA_COMPLETA,
      UNIDADES
    );
    expect(r.dudas.some((d) => d.campo === "recubierto")).toBe(true);
    expect(r.reconstruible).toBe(false);
  });

  it("mayúsculas y tildes en el recubierto se corrigen, no se rechazan", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", salsas: ["arequipe"], recubierto: "AZUCAR SOLA" },
      CARTA_COMPLETA,
      UNIDADES
    );
    expect(r.estado.recubierto).toBe("azúcar sola");
    expect(r.dudas.some((d) => d.campo === "recubierto")).toBe(false);
  });

  it("sin el grupo en la tabla (como hoy), se acepta lo que venga sin inventar una lista", () => {
    // CARTA no tiene grupo RECUBIERTO: es el estado real de producción.
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", salsas: ["arequipe"], recubierto: "azúcar-canela" },
      CARTA,
      UNIDADES
    );
    expect(r.estado.recubierto).toBe("azúcar-canela");
    expect(r.dudas.some((d) => d.campo === "recubierto")).toBe(false);
    // Y por eso tampoco puede exigirlo para cerrar.
    expect(r.faltaParaCerrar).not.toContain("recubierto");
  });
});

describe("la pregunta obligatoria de la Fase 1.5", () => {
  it("solo dice que puede reconstruir cuando no queda ninguna duda", () => {
    const completo = normalizarPedido(
      { ...vacio, producto: "besties", cantidad: 1, salsas: ["arequipe", "lechera"] },
      CARTA,
      UNIDADES
    );
    expect(completo.reconstruible).toBe(true);
    expect(completo.estado.totalCents).toBe(2000000);

    const aMedias = normalizarPedido(
      { ...vacio, producto: "besties", cantidad: 1, salsas: ["arequipe"] },
      CARTA,
      UNIDADES
    );
    expect(aMedias.reconstruible).toBe(false);
  });
});
