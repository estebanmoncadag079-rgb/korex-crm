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
  opciones: [] as { grupo?: string | null; opcion: string }[],
  datos: {} as Record<string, string | null>,
};

/** Azúcar sintáctico para las pruebas: `sal("arequipe","arequipe")`. */
const sal = (...nombres: string[]) => nombres.map((n) => ({ grupo: "SALSA", opcion: n }));
const adi = (...nombres: string[]) => nombres.map((n) => ({ grupo: "ADICIONES", opcion: n }));

describe("unidades contra presentaciones", () => {
  // Decisión del dueño (15-ago-2026): ante la ambigüedad de unidades, el
  // agente PUEDE preguntar. Confirmar cuesta un mensaje; equivocarse cuesta
  // $50.000 y un cliente. Y la pregunta no depende del negocio: la duda la
  // levanta el backend, no una regla escrita en el prompt de cada cliente.
  it('"quiero 6 churros" NO son seis Churritas', () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churros", cantidad: 6, opciones: sal("arequipe") },
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
        opciones: sal("arequipe", "lechera", "chocolate negro"),
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
      { ...vacio, producto: "churrita", opciones: sal("arequipe") },
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
      { ...vacio, producto: "churrita con chocolate negro", opciones: sal("chocolate negro") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.producto).toBe("CHURRITA");
    expect(r.estado.seleccion.map((o) => o.nombre)).toEqual(["chocolate negro"]);
    expect(r.reconstruible).toBe(true);
  });

  it('"chocolate" a secas es una salsa, y falta saber la presentación', () => {
    const r = normalizarPedido({ ...vacio, producto: "arequipe" }, CARTA, UNIDADES);
    expect(r.estado.producto).toBeNull();
    expect(r.estado.seleccion.map((o) => o.nombre)).toEqual(["arequipe"]);
    expect(r.dudas.some((d) => d.preguntar.includes("presentación"))).toBe(true);
  });
});

describe("normaliza en vez de rechazar (regla 3)", () => {
  it("acepta mayúsculas, tildes y plural", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "Churritas", opciones: sal("Arequipe") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.producto).toBe("CHURRITA");
    expect(r.estado.seleccion.map((o) => o.nombre)).toEqual(["arequipe"]);
    expect(r.reconstruible).toBe(true);
  });

  it("una salsa que no existe no tumba el pedido: se pregunta", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", opciones: sal("fresa") },
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
      { ...vacio, producto: "churrita", opciones: [...sal("arequipe"), ...adi("botella de agua")] },
      conAdicion,
      UNIDADES
    );
    expect(r.estado.totalCents).toBe(1200000);
  });

  it("sin precio cargado NO es gratis: se pregunta", () => {
    const sinPrecio: ProductoDelCatalogo[] = [{ ...CHURRITA, precioCents: null }];
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", opciones: sal("arequipe") },
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

  const rec = (n: string) => [{ grupo: "RECUBIERTO", opcion: n }];

  /** Lo que este negocio pide para cerrar. Sale de SU ficha, no del núcleo. */
  const REQUISITOS = [
    { id: "nombre", tipo: "texto" as const, etiqueta: "nombre", obligatorio: true },
    { id: "telefono", tipo: "telefono" as const, etiqueta: "teléfono", obligatorio: true },
    { id: "direccion", tipo: "direccion" as const, etiqueta: "dirección", obligatorio: true },
  ];

  it("dice todo lo que falta, y los nombres los pone el CATÁLOGO", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita" },
      CARTA_COMPLETA,
      UNIDADES,
      REQUISITOS
    );
    // NADA de esto está escrito en el núcleo: "salsa" y "recubierto" salen de
    // `grupos[].nombre`, y los tres últimos, de los requisitos de la ficha. Un
    // salón vería aquí "esmalte" y "a nombre de quién".
    expect(r.faltaParaCerrar).toEqual(["salsa", "recubierto", "nombre", "teléfono", "dirección"]);
  });

  it("un pedido con todo no deja nada pendiente, y el total lo suma el servidor", () => {
    const r = normalizarPedido(
      {
        producto: "churrita",
        cantidad: 1,
        opciones: [...sal("arequipe"), ...rec("azúcar-canela"), ...adi("botella de agua")],
        datos: { nombre: "Andrea", telefono: "3001234567", direccion: "Cra 5 #10-20" },
      },
      CARTA_COMPLETA,
      UNIDADES,
      REQUISITOS
    );
    expect(r.faltaParaCerrar).toEqual([]);
    expect(r.estado.totalCents).toBe(1200000); // $10.000 + $2.000 de la botella
    expect(r.reconstruible).toBe(true);
  });

  it("el recubierto se valida contra la carta, no contra lo que suene bien", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", opciones: [...sal("arequipe"), ...rec("con miel")] },
      CARTA_COMPLETA,
      UNIDADES
    );
    expect(r.dudas.some((d) => d.porque.includes("con miel"))).toBe(true);
    expect(r.reconstruible).toBe(false);
  });

  it("mayúsculas y tildes se corrigen en CUALQUIER grupo, no se rechazan", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", opciones: [...sal("arequipe"), ...rec("AZUCAR SOLA")] },
      CARTA_COMPLETA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toContain("azúcar sola");
    expect(r.dudas).toEqual([]);
  });

  /*
   * 🔴 El caso que costó el cobro doble del 16-ago: `lechera` está como SALSA
   * (incluida) y como ADICIÓN ($1.500). Con el modelo viejo se sumaba sola.
   */
  it("la misma palabra en dos grupos: con grupo se resuelve, sin grupo se PREGUNTA", () => {
    const conGrupo = normalizarPedido(
      { ...vacio, producto: "churrita", opciones: [{ grupo: "SALSA", opcion: "lechera" }, ...rec("sin azúcar")] },
      CARTA_COMPLETA,
      UNIDADES
    );
    expect(conGrupo.estado.totalCents).toBe(1000000); // la salsa NO se cobra
    expect(conGrupo.dudas).toEqual([]);

    const sinGrupo = normalizarPedido(
      { ...vacio, producto: "churrita", opciones: [{ opcion: "lechera" }, ...rec("sin azúcar")] },
      CARTA_COMPLETA,
      UNIDADES
    );
    expect(sinGrupo.dudas.some((d) => d.porque.includes("está en 2 grupos"))).toBe(true);
    expect(sinGrupo.estado.totalCents).toBeNull(); // no se adivina, no se cobra
  });

  it("sin el grupo en la tabla (como hoy), no se exige para cerrar", () => {
    // CARTA no tiene grupo RECUBIERTO: es el estado real de producción.
    const r = normalizarPedido(
      { ...vacio, producto: "churrita", opciones: sal("arequipe") },
      CARTA,
      UNIDADES
    );
    expect(r.faltaParaCerrar).not.toContain("recubierto");
    expect(r.reconstruible).toBe(true);
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 EL PRECIO: cada opción se cobra por SU grupo (16-ago-2026).
 *
 * `sumaDeExtras` recorría todos los grupos y sumaba cualquier opción cuyo
 * nombre coincidiera. En La Churra los mismos nombres están en los dos:
 *
 *   SALSAS   : arequipe · lechera · chocolate negro · chocolate blanco  ($0)
 *   ADICIONES: … LECHERA $1.500 · AREQUIPE $1.500 · CHOCOLATE BLANCO $2.000
 *
 * Una salsa incluida cobraba $1.500 que nadie pidió.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("el precio: una salsa incluida no se cobra", () => {
  const ADICIONES = [
    { id: "a1", nombre: "Salsa de CHOCOLATE", precioExtraCents: 200000 },
    { id: "a2", nombre: "LECHERA", precioExtraCents: 150000 },
    { id: "a3", nombre: "AREQUIPE", precioExtraCents: 150000 },
    { id: "a4", nombre: "CHOCOLATE BLANCO", precioExtraCents: 200000 },
    { id: "a5", nombre: "Botella de agua", precioExtraCents: 200000 },
  ];

  /** La carta tal como quedará DESPUÉS de `cargar:opciones`. */
  function conAdiciones(base: ProductoDelCatalogo): ProductoDelCatalogo {
    return {
      ...base,
      grupos: [
        ...base.grupos,
        { id: `ad-${base.id}`, nombre: "ADICIONES", minimo: 0, maximo: 5, opciones: ADICIONES },
      ],
    };
  }

  const CHURRITA_CON = conAdiciones(CHURRITA);
  const FAMILY_CON = conAdiciones(CARTA.find((p) => p.nombre === "FAMILY BOX")!);
  const MEGA_CON = conAdiciones(CARTA.find((p) => p.nombre === "MEGA BOX")!);
  const CARTA_CON = [CHURRITA_CON, FAMILY_CON, MEGA_CON];

  it("una Churrita con arequipe cuesta el precio de la Churrita, sin un peso más", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 1, opciones: sal("arequipe") },
      CARTA_CON,
      UNIDADES
    );
    expect(r.estado.totalCents).toBe(1000000); // $10.000 exactos
  });

  it("una caja con TODAS sus salsas incluidas tampoco suma nada", () => {
    const r = normalizarPedido(
      {
        ...vacio,
        producto: "FAMILY BOX",
        cantidad: 1,
        opciones: sal("arequipe", "lechera", "chocolate blanco"),
      },
      CARTA_CON,
      UNIDADES
    );
    // Los tres nombres existen ADEMÁS como adición de pago. No se cobran.
    expect(r.estado.totalCents).toBe(3200000); // $32.000 exactos
  });

  /*
   * El Mega Box con adiciones cargadas: cinco salsas repetidas y ni un peso de
   * más. Junta los dos arreglos del 16-ago —el grupo del precio (2A) y las
   * salsas repetibles (2B)— en el caso que los destapó a los dos.
   */
  it("Mega Box con salsas repetidas: se completa y no se cobra ninguna", () => {
    const r = normalizarPedido(
      {
        ...vacio,
        producto: "MEGA BOX",
        cantidad: 1,
        opciones: sal("arequipe", "lechera", "chocolate negro", "chocolate blanco", "arequipe"),
      },
      CARTA_CON,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toHaveLength(5); // la quinta ya no se pierde
    expect(r.dudas.some((d) => d.campo === "salsas")).toBe(false);
    expect(r.estado.totalCents).toBe(5000000); // $50.000 exactos, sin recargo
    expect(r.reconstruible).toBe(true);
  });

  it("dos botellas de agua se cobran DOS veces, no una", () => {
    const r = normalizarPedido(
      {
        ...vacio,
        producto: "CHURRITA",
        cantidad: 1,
        opciones: [...sal("arequipe"), ...adi("Botella de agua", "Botella de agua")],
      },
      CARTA_CON,
      UNIDADES
    );
    expect(r.estado.totalCents).toBe(1000000 + 200000 * 2); // $14.000
  });

  it("pero una ADICIÓN de arequipe sí se cobra: $1.500", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 1, opciones: [...sal("arequipe"), ...adi("AREQUIPE")] },
      CARTA_CON,
      UNIDADES
    );
    expect(r.estado.totalCents).toBe(1000000 + 150000); // $11.500
  });

  it("la misma palabra en los dos grupos: se cobra UNA vez, la de la adición", () => {
    const soloSalsa = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 1, opciones: sal("lechera") },
      CARTA_CON,
      UNIDADES
    );
    const salsaYAdicion = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 1, opciones: [...sal("lechera"), ...adi("LECHERA")] },
      CARTA_CON,
      UNIDADES
    );
    expect(salsaYAdicion.estado.totalCents! - soloSalsa.estado.totalCents!).toBe(150000);
  });

  /*
   * CAMBIO DE COMPORTAMIENTO (v2, 17-ago): antes una adición inexistente se
   * ignoraba en silencio y el pedido se cerraba con su total. Ahora se
   * pregunta. Es más correcto: si el cliente pidió caviar, cerrar como si no
   * lo hubiera dicho es despacharle otra cosa.
   */
  it("una adición que no existe no inventa un cargo NI se ignora: se pregunta", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 1, opciones: [...sal("arequipe"), ...adi("caviar")] },
      CARTA_CON,
      UNIDADES
    );
    expect(r.estado.seleccion.some((o) => o.nombre === "caviar")).toBe(false);
    expect(r.dudas.some((d) => d.porque.includes("caviar"))).toBe(true);
    expect(r.estado.totalCents).toBeNull();
  });

  it("y el extra se multiplica por la cantidad, como el producto", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 2, opciones: [...sal("arequipe"), ...adi("Botella de agua")] },
      CARTA_CON,
      UNIDADES
    );
    expect(r.estado.totalCents).toBe((1000000 + 200000) * 2); // $24.000
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * LAS SALSAS NO SON ÚNICAS (decisión del dueño, 16-ago-2026).
 *
 * Un Mega Box lleva CINCO y el catálogo tiene CUATRO sabores: repetir no es un
 * error, es la única forma de completarlo.
 *
 *   Churrita   → 1     Family Box → 3
 *   Besties    → 2     Mega Box   → 5
 * ────────────────────────────────────────────────────────────────────────
 */
describe("las salsas se pueden repetir", () => {
  it("dos de arequipe en una Besties: se conservan las DOS", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "BESTIES", cantidad: 1, opciones: sal("arequipe", "arequipe") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toEqual(["arequipe", "arequipe"]);
    expect(r.dudas.some((d) => d.campo === "salsas")).toBe(false);
    expect(r.estado.totalCents).toBe(2000000); // $20.000, completo
  });

  it("Family Box: arequipe + arequipe + lechera", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "FAMILY BOX", cantidad: 1, opciones: sal("arequipe", "arequipe", "lechera") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toEqual(["arequipe", "arequipe", "lechera"]);
    expect(r.reconstruible).toBe(true);
  });

  it("EL CASO QUE NO SE PODÍA CERRAR: Mega Box con cinco salsas de cuatro sabores", () => {
    const r = normalizarPedido(
      {
        ...vacio,
        producto: "MEGA BOX",
        cantidad: 1,
        opciones: sal("arequipe", "arequipe", "lechera", "chocolate negro", "chocolate blanco"),
      },
      CARTA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toHaveLength(5);
    expect(r.dudas.some((d) => d.campo === "salsas")).toBe(false);
    expect(r.estado.totalCents).toBe(5000000); // $50.000
    expect(r.reconstruible).toBe(true);
  });

  it("repetir NO altera el precio: las salsas van incluidas", () => {
    const unaSola = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 1, opciones: sal("arequipe") },
      CARTA,
      UNIDADES
    );
    const dosIguales = normalizarPedido(
      { ...vacio, producto: "BESTIES", cantidad: 1, opciones: sal("arequipe", "arequipe") },
      CARTA,
      UNIDADES
    );
    expect(unaSola.estado.totalCents).toBe(1000000);
    expect(dosIguales.estado.totalCents).toBe(2000000); // el precio es de la caja
  });

  it("se corrige el nombre de CADA repetición, sin perder ninguna", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "BESTIES", cantidad: 1, opciones: sal("Arequipe", "AREQUIPE") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toEqual(["arequipe", "arequipe"]);
  });

  /* NEGATIVAS: repetir no es barra libre. */
  it("pasarse del máximo se pregunta, no se recorta en silencio", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "CHURRITA", cantidad: 1, opciones: sal("arequipe", "arequipe", "lechera") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toHaveLength(3); // no se recorta por su cuenta
    expect(r.dudas.some((d) => d.porque.includes("pidió 3"))).toBe(true);
    expect(r.estado.totalCents).toBeNull(); // y sin total no se puede confirmar
  });

  it("una salsa repetida que NO existe sigue siendo un rechazo", () => {
    const r = normalizarPedido(
      { ...vacio, producto: "BESTIES", cantidad: 1, opciones: sal("mostaza", "mostaza") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toHaveLength(0);
    // Dos veces: una duda por cada mostaza que no existe.
    expect(r.dudas.filter((d) => d.porque.includes("mostaza")).length).toBe(2);
  });

  it("sin presentación elegida, las repeticiones también se conservan", () => {
    const r = normalizarPedido(
      { ...vacio, producto: null, opciones: sal("arequipe", "arequipe") },
      CARTA,
      UNIDADES
    );
    expect(r.estado.seleccion.map((o) => o.nombre)).toEqual(["arequipe", "arequipe"]);
  });
});
