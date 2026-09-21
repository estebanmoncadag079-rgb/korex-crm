/**
 * La combinación que nunca había corrido: `state_source='backend'` con
 * `delivery_source='tabla'`.
 *
 * ## Por qué hacía falta esta prueba
 *
 * La auditoría de MALIA (21-sep-2026) encontró que **ningún test y ningún
 * cliente en producción usaban las dos cosas a la vez**:
 *
 * | | `state_source` | `delivery_source` |
 * |---|---|---|
 * | La Churra, Lis, Camilabrandcol, Lashes | `backend` | `prompt` |
 * | MALIA (hoy) | `prompt` | **`tabla`** |
 * | MALIA (objetivo) | **`backend`** | **`tabla`** |
 *
 * Y no es una combinación inocente: el domicilio verificado se lee por **dos
 * caminos distintos** según la bandera (`pipeline.ts:1261`) —
 * `estadoGuardado.entrega` con `backend`, `leerEntregaVerificada` con
 * `prompt`—. El camino que MALIA estrenaría es justo el que nadie ejercitaba.
 *
 * Aquí se fijan las costuras donde las dos fuentes se encuentran: la tarifa
 * verificada y el pedido mínimo, que es el único sitio donde una podría
 * contaminar a la otra.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/confirmacion-de-pedido", () => ({
  ultimaConfirmacionDe: vi.fn(async () => null),
  registrarConfirmacionDePedido: vi.fn(),
  borrarConfirmacionDePedido: vi.fn(),
  intentarNotificarPedido: vi.fn(),
}));

import { comoTexto } from "@/server/orders/extraer";
import { puedeConfirmarPedido } from "@/server/orders/policy";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import { MODALIDAD_DOMICILIO, MODALIDAD_RECOGIDA } from "@/server/ai/generador/ficha";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/** El catálogo real de MALIA, reducido a lo que estas pruebas necesitan. */
const PAVE_8: ProductoDelCatalogo = {
  id: "prod_8",
  nombre: "Pavé Cremoso 8 oz",
  categoria: "Pavés",
  precioCents: 1000000,
  descripcion: null,
  grupos: [],
};
const SIN_PRECIO: ProductoDelCatalogo = { ...PAVE_8, id: "prod_x", nombre: "1", precioCents: null };

/** Una zona real de su tabla, con su tarifa. */
const ZONA_VERIFICADA = {
  tipo: "domicilio" as const,
  zonaId: "dz_jhg3bexqhe9zvfzp51bh",
  zonaNombre: "Omar Torrijos",
  feeCents: 1000000, // $10.000
  verificadoEnMensajeId: "msg_1",
  verificadoEn: "2026-09-21T14:00:00.000Z",
};

const MINIMO = 1800000; // $18.000 — un pavé de 16 oz

function pedido(over: Partial<EstadoDelPedido> = {}): EstadoDelPedido {
  return {
    ...estadoVacio(),
    items: [
      { ofrecible: { id: "prod_8", nombre: "Pavé Cremoso 8 oz" }, cantidad: 1, seleccion: [], totalCents: 1000000 },
    ],
    totalCents: 1000000, // un solo pavé de 8 oz: NO llega al mínimo
    modalidadDeEntrega: MODALIDAD_DOMICILIO,
    entrega: ZONA_VERIFICADA,
    ...over,
  };
}

const juzgar = (estado: EstadoDelPedido, productos = [PAVE_8]) =>
  puedeConfirmarPedido({
    conversationId: "cv_test",
    productosDelPedido: productos,
    history: [],
    estadoGuardado: estado,
    requisitos: [],
    minimoDomicilioCents: MINIMO,
  });

describe("la tarifa verificada NO ayuda a alcanzar el pedido mínimo", () => {
  /*
   * Es el error que se cometería solo, y sería invisible: $10.000 de producto
   * más $10.000 de tarifa superan cualquier mínimo razonable, así que un
   * mínimo comparado contra el total dejaría pasar exactamente los pedidos
   * que existe para frenar. El subtotal (`estado.totalCents`) no incluye la
   * tarifa — `normalizar.ts:818` — y de eso depende todo esto.
   */
  it("un pedido de $10.000 con tarifa de $10.000 sigue sin llegar a $18.000", async () => {
    const v = await juzgar(pedido());
    if (v.ok) throw new Error("se esperaba un rechazo: la tarifa no cuenta para el mínimo");
    expect(v.motivo).toContain("mínimo");
    // Y la cifra que se le da al modelo es la del PRODUCTO, no la del total.
    expect(v.correccion).toContain("$10.000");
    expect(v.correccion).toContain("$18.000");
  });

  it("el bloque de estado enseña la tarifa Y el aviso del mínimo a la vez", async () => {
    const texto = comoTexto(pedido(), [PAVE_8], [], "pedidos", MINIMO);
    // La tarifa verificada sigue llegando al modelo…
    expect(texto).toContain("Omar Torrijos");
    expect(texto).toContain("$10.000");
    // …y el aviso del mínimo también, sin que uno tape al otro.
    expect(texto).toContain("MÍNIMO DE DOMICILIO");
    expect(texto).toContain("$18.000");
  });

  it("con dos pavés sí pasa, y la tarifa sigue intacta", async () => {
    const dos = pedido({ totalCents: 2000000 });
    expect((await juzgar(dos)).ok).toBe(true);
    const texto = comoTexto(dos, [PAVE_8], [], "pedidos", MINIMO);
    expect(texto).toContain("Omar Torrijos");
    expect(texto).not.toContain("MÍNIMO DE DOMICILIO");
  });
});

describe("recogida: ni tarifa ni mínimo", () => {
  it("un solo pavé para recoger se cierra sin problema", async () => {
    const v = await juzgar(pedido({ modalidadDeEntrega: MODALIDAD_RECOGIDA, entrega: null }));
    expect(v.ok).toBe(true);
  });

  it("el bloque no menciona el mínimo cuando se recoge", () => {
    const texto = comoTexto(
      pedido({ modalidadDeEntrega: MODALIDAD_RECOGIDA, entrega: null }),
      [PAVE_8],
      [],
      "pedidos",
      MINIMO
    );
    expect(texto).not.toContain("MÍNIMO DE DOMICILIO");
  });
});

describe("un producto sin precio nunca puede confirmar", () => {
  /*
   * MALIA tiene en su catálogo un producto llamado `"1"`, disponible y sin
   * precio. Con `state_source='prompt'` no pasaba nada porque el backend no
   * sumaba; con `backend` sí, y la única defensa es esta. La limpieza del
   * dato es aparte: el guardarraíl tiene que existir igualmente, porque
   * mañana alguien cargará otro producto a medias.
   */
  it("con el total sin calcular, el backend no deja cerrar", async () => {
    const v = await juzgar(pedido({ totalCents: null }), [SIN_PRECIO]);
    if (v.ok) throw new Error("se esperaba un rechazo");
    expect(v.motivo).toContain("total");
  });

  it("y no se confunde con el mínimo: el diagnóstico es el correcto", async () => {
    const v = await juzgar(pedido({ totalCents: null }), [SIN_PRECIO]);
    if (v.ok) throw new Error("se esperaba un rechazo");
    expect(v.motivo).not.toContain("mínimo");
  });
});

describe("sin mínimo configurado, la combinación se comporta como siempre", () => {
  /*
   * Los otros cuatro negocios no tienen mínimo. Si esta feature les cambiara
   * algo, sería una regresión introducida para resolver el caso de uno solo —
   * justo lo que las reglas de arquitectura prohíben.
   */
  it("el bloque de estado sale idéntico con y sin el parámetro", () => {
    const conParametro = comoTexto(pedido(), [PAVE_8], [], "pedidos", undefined);
    const sinParametro = comoTexto(pedido(), [PAVE_8], [], "pedidos");
    expect(conParametro).toBe(sinParametro);
    expect(conParametro).not.toContain("MÍNIMO");
  });

  it("y el cierre tampoco exige nada nuevo", async () => {
    const v = await puedeConfirmarPedido({
      conversationId: "cv_test",
      productosDelPedido: [PAVE_8],
      history: [],
      estadoGuardado: pedido(),
      requisitos: [],
    });
    expect(v.ok).toBe(true);
  });
});

describe("el cableado: la ficha llega hasta quien decide", () => {
  /*
   * Lo de arriba prueba que la Policy y el bloque de estado se comportan bien
   * SI reciben el mínimo. Esto prueba que alguien se lo pase.
   *
   * Es una comprobación sobre el texto del pipeline y no una prueba de
   * ejecución a propósito: montar `runAgentTurn` por el camino `backend`
   * exige reordenar la cola de consultas simuladas del harness entero, y una
   * prueba frágil que nadie sabe arreglar acaba borrada. Dos puntos de
   * conexión, dos aserciones — y la prueba de ejecución real es el
   * Laboratorio contra Postgres, que va antes de producción.
   *
   * Si un refactor corta cualquiera de los dos cables, el mínimo se convierte
   * en un campo de la ficha que nadie lee: exactamente el modo de fallo que
   * tuvo `porDia`, y que no se notó hasta mirarlo a mano.
   */
  const pipeline = readFileSync("src/server/ai/pipeline.ts", "utf8");

  it("el pipeline se lo pasa a `puedeConfirmarPedido`", () => {
    expect(pipeline).toMatch(
      /puedeConfirmarPedido\(\{[\s\S]{0,600}?minimoDomicilioCents: fichaDelNegocio\.entrega\.minimoDomicilioCents/
    );
  });

  it("el pipeline se lo pasa a `comoTexto`, para avisar antes del cierre", () => {
    expect(pipeline).toMatch(
      /comoTexto\([\s\S]{0,300}?fichaDelNegocio\?\.entrega\?\.minimoDomicilioCents/
    );
  });
});
