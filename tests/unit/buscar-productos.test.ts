import { describe, expect, it } from "vitest";

/**
 * `buscarProductos` es la mitad del catálogo que hace verificable el caso
 * real que lo originó (25-ago-2026, Lis): "torta de chocolate" tiene que
 * resolver a "Porción Chocolate" sin que el modelo tenga que adivinarlo
 * leyendo el catálogo como prosa.
 */

import { buscarProductos, type ResultadoBusquedaProducto } from "@/server/catalog/buscar";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

function producto(id: string, nombre: string, precioCents: number | null = 1000000): ProductoDelCatalogo {
  return { id, nombre, categoria: null, precioCents, descripcion: null, grupos: [] };
}

const CATALOGO_LIS: ProductoDelCatalogo[] = [
  producto("p1", "Porción Chocolate"),
  producto("p2", "Porción Fresa"),
  producto("p3", "Torta Completa Vainilla"),
  producto("p4", "Cupcake Red Velvet"),
];

describe("buscarProductos", () => {
  it("encuentra por coincidencia exacta, sin importar mayúsculas ni tildes", () => {
    const r = buscarProductos(CATALOGO_LIS, "porción chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p1");

    expect(buscarProductos(CATALOGO_LIS, "PORCION FRESA").status).toBe("found");
  });

  it("resuelve el caso real: 'torta de chocolate' → Porción Chocolate", () => {
    const r = buscarProductos(CATALOGO_LIS, "torta de chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p1");
  });

  it("encuentra por substring único", () => {
    const r = buscarProductos(CATALOGO_LIS, "red velvet");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p4");
  });

  it("devuelve multiple_matches cuando dos productos empatan igual de bien (mismos tokens, distinto orden)", () => {
    const empatados: ProductoDelCatalogo[] = [
      producto("x", "Combo Familiar Grande"),
      producto("y", "Combo Grande Familiar"),
    ];
    // "ya" al final evita que la consulta sea substring exacto de cualquiera
    // de los dos nombres (eso resolvería por substring único, no por tokens).
    const r = buscarProductos(empatados, "grande familiar combo ya");
    expect(r.status).toBe("multiple_matches");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "multiple_matches" }>).productos).toHaveLength(2);
  });

  it("no inventa un match cuando no hay ninguno razonable", () => {
    expect(buscarProductos(CATALOGO_LIS, "servicio a domicilio en Bogotá").status).toBe("not_found");
  });

  it("con el catálogo vacío, nunca encuentra nada", () => {
    expect(buscarProductos([], "torta de chocolate").status).toBe("not_found");
  });

  it("con una consulta vacía, nunca encuentra nada", () => {
    expect(buscarProductos(CATALOGO_LIS, "   ").status).toBe("not_found");
  });
});

describe("buscarProductos — Fase 10S: coincide() no debe fusionar palabras distintas", () => {
  it("BUG REAL: 'limon' encuentra la 'Bebida de Limón Natural' correcta, no 'Limonada' por prefijo compartido", () => {
    const catalogo: ProductoDelCatalogo[] = [
      producto("b1", "Bebida de Limón Natural"),
      producto("b2", "Limonada"),
    ];
    const r = buscarProductos(catalogo, "limon");
    // Antes del fix: "found" -> Limonada (ratio 1/1 le ganaba a la bebida
    // por tener menos tokens, sin pasar por multiple_matches).
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("b1");
  });

  it("BUG REAL: 'chocolate' y 'choconuez' no deben tratarse como el mismo producto por compartir 5 letras de prefijo", () => {
    const catalogo: ProductoDelCatalogo[] = [
      producto("c1", "Torta Choconuez"),
      producto("c2", "Porción Chocolate"),
    ];
    const r = buscarProductos(catalogo, "chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("c2");
  });

  it("sigue tolerando plural simple: 'tortas' encuentra 'Torta Completa Vainilla'", () => {
    const r = buscarProductos(CATALOGO_LIS, "tortas de vainilla");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p3");
  });
});

/**
 * Fase 8E — incidente REAL de producción (8-sep-2026, 13:37-13:54, MALIA,
 * conversación cv_2xfh67lig9a07xzief96). Catálogo real de esa organización:
 * solo "Botella de Agua", "Pavé Cremoso 8 oz" y "Pavé Cremoso 16 oz" —
 * "oblea" no existe ni como producto ni como opción (verificado en la base
 * de producción: 0 filas).
 *
 * La clienta pidió "el pavé de oblea". `buscarProductos` devolvía
 * `found: Pavé Cremoso 8 oz` (el único token que coincidía era "pave", que
 * comparten los dos productos; "oblea" no coincidía con nada; el desempate
 * lo decidía `ratio`, que ahí solo premia al nombre más corto). Ese `found`
 * viaja al prompt como hecho verificado y `contradiceProductoEncontrado`
 * obliga al modelo a sostenerlo — en la traza real quedó registrado:
 * `hechos=producto:"el pave de oblea"=found@backend` y
 * `guardarrailes=producto_contradicho:corrigio`.
 *
 * Consecuencia medida: el bot ofreció el pavé de oblea en 8 y 16 oz, el
 * carrito real rechazó "Oblea" cinco veces en silencio, el cierre falló por
 * `subtotal-no-coincide-con-el-carrito` y el pedido acabó en derivación —
 * la clienta lo canceló.
 */
describe("buscarProductos — Fase 8E: un match de puro nombre de familia no es un hallazgo", () => {
  const CATALOGO_MALIA: ProductoDelCatalogo[] = [
    producto("m1", "Botella de Agua", 300000),
    producto("m2", "Pavé Cremoso 16 oz", 1800000),
    producto("m3", "Pavé Cremoso 8 oz", 1000000),
  ];

  it("BUG REAL: 'el pave de oblea' NO puede resolver a 'Pavé Cremoso 8 oz'", () => {
    expect(buscarProductos(CATALOGO_MALIA, "el pave de oblea").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_MALIA, "pavé de oblea").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_MALIA, "pave de oblea").status).toBe("not_found");
  });

  it("lo que SÍ está en el catálogo se sigue encontrando igual", () => {
    // Sin palabras sin explicar: el match cubre lo que pidió la clienta.
    const r = buscarProductos(CATALOGO_MALIA, "el de 8 oz");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("m3");

    const r2 = buscarProductos(CATALOGO_MALIA, "pavé cremoso 16 oz");
    expect(r2.status).toBe("found");
    expect((r2 as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("m2");

    // "16" distingue a ese producto de su hermano: aunque "maracuyá" quede
    // sin explicar (es una OPCIÓN, la resuelve `buscarOpciones` después),
    // el producto sí quedó identificado de verdad.
    const r3 = buscarProductos(CATALOGO_MALIA, "pave cremoso 16 oz de maracuya");
    expect(r3.status).toBe("found");
    expect((r3 as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("m2");

    expect(buscarProductos(CATALOGO_MALIA, "botella de agua").status).toBe("found");
  });

  it("no rompe el caso original de Lis: 'torta de chocolate' sigue resolviendo (chocolate SÍ distingue)", () => {
    const r = buscarProductos(CATALOGO_LIS, "torta de chocolate");
    expect(r.status).toBe("found");
    expect((r as Extract<ResultadoBusquedaProducto, { status: "found" }>).producto.id).toBe("p1");
  });
});

/**
 * Falso positivo de tamaño (22-sep-2026, encontrado auditando la prueba real
 * de Yuli en MALIA).
 *
 * Una clienta pidió "dos cremosos de 7 onzas". MALIA vende de 8 y de 16.
 * `buscarProductos("Pavé Cremoso 7 oz")` devolvía **`found: Pavé Cremoso
 * 8 oz`** — y ese `found` no es una sugerencia: viaja al prompt como hecho
 * verificado y `contradiceProductoEncontrado` obliga al modelo a sostenerlo.
 * El sistema afirmaba que existe un tamaño que no existe.
 *
 * Medido contra los catálogos REALES de los tres negocios de pedidos: 17
 * falsos positivos, 13 de ellos en Lis —incluido `"Cremoso 8 oz"` →
 * `Cremoso 7 oz`, el mismo fallo con los números al revés—. La Churra no
 * tiene ni un número en sus nombres: es inmune por construcción.
 *
 * ⚠️ **Son DOS mecanismos, no uno.** `tokens()` descarta los tokens de menos
 * de dos caracteres, así que un tamaño de UN dígito desaparece antes de
 * comparar (`"Pavé Cremoso 8 oz"` → `[pave, cremoso, oz]`). Pero además, y
 * con números de dos dígitos, **un número que contradice nunca descalifica**:
 * solo baja el `ratio`. Por eso `"Cremoso Familiar 43 oz"` resolvía al de 44.
 * Arreglar solo la tokenización habría tapado 8 de los 17.
 *
 * La regla es la contradicción, no la ausencia: un candidato SIN tamaño no se
 * descalifica (`"torta de chocolate"` sigue resolviendo), y un número que no
 * va pegado a una unidad del catálogo es una CANTIDAD, no un tamaño — sin eso
 * se rompe `policy.ts`, que le pasa el mensaje entero del cliente.
 */
const CATALOGO_MALIA_REAL: ProductoDelCatalogo[] = [
  producto("mr1", "Pavé Cremoso 16 oz", 1800000),
  producto("mr2", "Pavé Cremoso 8 oz", 1000000),
];

const CATALOGO_LIS_REAL: ProductoDelCatalogo[] = [
  producto("lr1", "Cremoso 7 oz", 1200000),
  producto("lr2", "Cremoso 12 oz", 1800000),
  producto("lr3", "Cremoso 16 oz", 2200000),
  producto("lr4", "Cremoso de Temporada  Franui 12 oz", 2000000),
  producto("lr5", "Polvoroso 12 oz", 1800000),
  producto("lr6", "Polvoroso 16 oz", 2200000),
  producto("lr7", "Porción Zanahoria", 900000),
  producto("lr8", "Porción Red Velvet", 900000),
  producto("lr9", "Porción Chocolate", 900000),
  producto("lr10", "Cremoso Familiar 44 oz", 5000000),
  producto("lr11", "Mini Box", 3000000),
  producto("lr12", "Agua", 300000),
  producto("lr13", "Café", 400000),
];

const CATALOGO_CHURRA_REAL: ProductoDelCatalogo[] = [
  producto("cr1", "CHURRITA", 1000000),
  producto("cr2", "BESTIES", 1500000),
  producto("cr3", "FAMILY BOX", 3000000),
  producto("cr4", "MEGA BOX", 5000000),
];

const id = (r: ResultadoBusquedaProducto) =>
  r.status === "found" ? r.producto.id : r.status;

describe("buscarProductos — A) un tamaño que el catálogo no tiene no puede resolver", () => {
  it("MALIA: el caso de Yuli. 7 oz no existe, y 9 tampoco", () => {
    expect(buscarProductos(CATALOGO_MALIA_REAL, "Pavé Cremoso 7 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_MALIA_REAL, "Pavé Cremoso 9 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_MALIA_REAL, "7 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_MALIA_REAL, "9 oz").status).toBe("not_found");
  });

  it("Lis: el mismo fallo con los números al revés — 8 oz no existe ahí", () => {
    expect(buscarProductos(CATALOGO_LIS_REAL, "Cremoso 8 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "Cremoso 6 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "8 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "9 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "6 oz").status).toBe("not_found");
  });

  it("Lis: y con DOS dígitos, que la tokenización nunca descartó", () => {
    expect(buscarProductos(CATALOGO_LIS_REAL, "Cremoso Familiar 43 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "Cremoso Familiar 45 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "Cremoso de Temporada  Franui 11 oz").status).toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "Cremoso de Temporada  Franui 13 oz").status).toBe("not_found");
  });

  it("Lis: los que se escondían detrás de un multiple_matches", () => {
    for (const n of [11, 13, 15, 17]) {
      expect(buscarProductos(CATALOGO_LIS_REAL, `Polvoroso ${n} oz`).status).toBe("not_found");
    }
  });
});

describe("buscarProductos — B) los 26 casos verdes del baseline siguen verdes", () => {
  it("MALIA: nombres exactos, 'el de N' y la consulta con opción sin explicar", () => {
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "Pavé Cremoso 8 oz"))).toBe("mr2");
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "Pavé Cremoso 16 oz"))).toBe("mr1");
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "el de 8 oz"))).toBe("mr2");
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "el de 16 oz"))).toBe("mr1");
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "8 oz"))).toBe("mr2");
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "16 oz"))).toBe("mr1");
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "pave cremoso 16 oz de maracuya"))).toBe("mr1");
  });

  it("Lis: cada tamaño que SÍ existe resuelve a su propio producto", () => {
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Cremoso 7 oz"))).toBe("lr1");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Cremoso 12 oz"))).toBe("lr2");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Cremoso 16 oz"))).toBe("lr3");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Polvoroso 12 oz"))).toBe("lr5");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Polvoroso 16 oz"))).toBe("lr6");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Cremoso Familiar 44 oz"))).toBe("lr10");
  });

  it("Lis: los productos SIN tamaño no los toca la regla", () => {
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Mini Box"))).toBe("lr11");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Porción Chocolate"))).toBe("lr9");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Agua"))).toBe("lr12");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Café"))).toBe("lr13");
    // El caso fundacional del archivo, con el catálogo real.
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "torta de chocolate"))).toBe("lr9");
    expect(buscarProductos(CATALOGO_LIS_REAL, "tortas de vainilla").status).toBe("not_found");
  });
});

describe("buscarProductos — C) la ambigüedad legítima se conserva", () => {
  it("Lis: dos familias comparten el mismo tamaño, y eso NO se resuelve solo", () => {
    for (const q of ["16 oz", "el de 16 oz", "12 oz", "el de 12 oz"]) {
      expect(buscarProductos(CATALOGO_LIS_REAL, q).status).toBe("multiple_matches");
    }
  });

  it("y sin número tampoco: 'Polvoroso' son dos", () => {
    expect(buscarProductos(CATALOGO_LIS_REAL, "Polvoroso").status).toBe("multiple_matches");
  });
});

describe("buscarProductos — D) una cantidad no es un tamaño", () => {
  /*
   * El caso que rompería `policy.ts`, que no le pasa un nombre de producto
   * sino el MENSAJE ENTERO del cliente. El "2" es cuántos quiere; el "16 oz"
   * es de qué tamaño. Una regla que mirara todos los dígitos dejaría este
   * mensaje en `not_found` y la Policy bloquearía un pedido nuevo legítimo.
   */
  it("'me agregas 2 pavés mas de 16 oz' sigue resolviendo al de 16", () => {
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "me agregas 2 pavés mas de 16 oz"))).toBe("mr1");
  });

  it("un número sin unidad del catálogo no descalifica a nadie", () => {
    expect(id(buscarProductos(CATALOGO_MALIA_REAL, "quiero 3 pavé cremoso 8 oz"))).toBe("mr2");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "2 porciones de chocolate"))).toBe("lr9");
  });

  it("y un mensaje con números que no son ni cantidad ni tamaño no inventa nada", () => {
    for (const q of ["mi celular es 3155551234", "son para 4 personas", "a las 3 de la tarde"]) {
      expect(buscarProductos(CATALOGO_MALIA_REAL, q).status).toBe("not_found");
    }
  });
});

describe("buscarProductos — F) La Churra no puede notar el cambio", () => {
  it("ni un número en todo su catálogo: la regla nunca se activa", () => {
    expect(id(buscarProductos(CATALOGO_CHURRA_REAL, "CHURRITA"))).toBe("cr1");
    expect(id(buscarProductos(CATALOGO_CHURRA_REAL, "churritas"))).toBe("cr1");
    expect(id(buscarProductos(CATALOGO_CHURRA_REAL, "BESTIES"))).toBe("cr2");
    expect(id(buscarProductos(CATALOGO_CHURRA_REAL, "MEGA BOX"))).toBe("cr4");
    expect(id(buscarProductos(CATALOGO_CHURRA_REAL, "FAMILY BOX"))).toBe("cr3");
    // Con un número inventado: como su catálogo no usa unidades, la consulta
    // no trae ninguna especificación que contradecir y todo sigue igual.
    expect(id(buscarProductos(CATALOGO_CHURRA_REAL, "quiero 2 churritas"))).toBe("cr1");
  });
});

describe("buscarProductos — G) EL DETECTOR DETECTA: la regla de contradicción está viva", () => {
  /*
   * Sin estas pruebas, las del bloque A estarían verdes aunque la regla no
   * llegara a activarse nunca — que es como un guardarraíl deja de servir sin
   * avisar (misma cautela que `generador-de-prompt.test.ts`).
   */
  it("con el MISMO nombre, solo cambia el número: uno resuelve y el otro no", () => {
    expect(buscarProductos(CATALOGO_MALIA_REAL, "Pavé Cremoso 8 oz").status).toBe("found");
    expect(buscarProductos(CATALOGO_MALIA_REAL, "Pavé Cremoso 7 oz").status).toBe("not_found");
  });

  it("la unidad la pone el catálogo: si no la usa, la regla no se activa", () => {
    // Un catálogo que mide en ml no puede ser filtrado por una consulta en oz:
    // "oz" no es una unidad suya, así que ese número es ruido, no un tamaño.
    const enMililitros: ProductoDelCatalogo[] = [
      producto("v1", "Botella 500 ml", 300000),
      producto("v2", "Botella 1000 ml", 500000),
    ];
    expect(buscarProductos(enMililitros, "Botella 500 ml").status).toBe("found");
    // Contradicción en SU unidad: descalifica.
    expect(buscarProductos(enMililitros, "Botella 750 ml").status).toBe("not_found");
  });

  it("un catálogo sin números no puede activar la regla en ninguna consulta", () => {
    // La garantía estructural de La Churra: sin unidades, `pedidos` siempre
    // queda vacío y el algoritmo es literalmente el de antes.
    for (const q of ["CHURRITA 7 oz", "2 BESTIES", "MEGA BOX 16"]) {
      expect(buscarProductos(CATALOGO_CHURRA_REAL, q).status).not.toBe("not_found");
    }
  });

  it("un producto SIN tamaño nunca queda descalificado por el tamaño de otro", () => {
    // Regla 4: el filtro solo mira a quien declara esa unidad.
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Mini Box"))).toBe("lr11");
    expect(id(buscarProductos(CATALOGO_LIS_REAL, "Agua"))).toBe("lr12");
  });
});

describe("buscarProductos — H) el contrato del que depende orders/policy.ts", () => {
  /*
   * `policy.ts:134` decide si hubo un PEDIDO NUEVO tras una confirmación con
   * `buscarProductos(...).status !== "not_found"`, y le pasa el MENSAJE
   * ENTERO del cliente. Endurecer los números sin distinguir cantidad de
   * tamaño convertiría mensajes legítimos en `not_found` y bloquearía
   * pedidos nuevos: el cliente pide más y el sistema no se entera.
   */
  const cuenta = (cat: ProductoDelCatalogo[], texto: string) =>
    buscarProductos(cat, texto).status !== "not_found";

  it("un pedido nuevo con cantidad y tamaño sigue contando", () => {
    expect(cuenta(CATALOGO_MALIA_REAL, "me agregas 2 pavés mas de 16 oz")).toBe(true);
    expect(cuenta(CATALOGO_MALIA_REAL, "quiero 3 pavé cremoso 8 oz")).toBe(true);
    expect(cuenta(CATALOGO_LIS_REAL, "2 porciones de chocolate")).toBe(true);
  });

  it("y lo que NO es un pedido sigue sin contar, como hoy", () => {
    for (const q of ["hola, gracias, todo bien", "me lo mandas a las 3 de la tarde", "son para 4 personas", "mi celular es 3155551234"]) {
      expect(cuenta(CATALOGO_MALIA_REAL, q)).toBe(false);
    }
  });

  it("un tamaño inexistente deja de contar como pedido, y está bien", () => {
    // Cambio de comportamiento buscado: antes "7 oz" contaba como pedido
    // nuevo porque resolvía —mal— al de 8. Ya no resuelve, así que no cuenta.
    expect(cuenta(CATALOGO_MALIA_REAL, "quiero uno de 7 oz")).toBe(false);
  });
});

describe("buscarProductos — D bis) una cantidad SIN tamaño no descalifica a nadie", () => {
  /*
   * El hueco que destapó una mutación de prueba: si un producto se comparara
   * contra números de la consulta que NO son de su unidad, "quiero 2 cremosos"
   * descalificaría a TODOS los que miden en oz —su `8 oz` no encuentra ningún
   * "2 oz" que lo respalde— y un pedido perfectamente normal acabaría en
   * `not_found`. Por eso un candidato solo se mide contra los números de SU
   * propia unidad.
   */
  it("pedir varias unidades de algo sigue encontrando ese algo", () => {
    for (const q of ["quiero 2 cremosos", "2 cremosos", "quiero 2 pavé cremoso"]) {
      expect(buscarProductos(CATALOGO_MALIA_REAL, q).status).not.toBe("not_found");
    }
    expect(buscarProductos(CATALOGO_LIS_REAL, "quiero 2 cremosos").status).not.toBe("not_found");
    expect(buscarProductos(CATALOGO_LIS_REAL, "dame 3 polvorosos").status).toBe("multiple_matches");
  });
});
