/**
 * Fase 2 · el validador y el extractor, sin base de datos.
 *
 * La regla que gobierna estas pruebas: **el modelo propone y el backend
 * decide**. Cada caso comprueba que una propuesta razonable del modelo no basta
 * para que algo se persista.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import {
  estadoVacio,
  registrarMetricaDeEstado,
  validarPropuesta,
  type EstadoDelPedido,
} from "@/server/orders/estado";
import { comoTexto, leerAporte, loQueFalta } from "@/server/orders/extraer";

const SALSAS = [
  { id: "o1", nombre: "chocolate negro", precioExtraCents: 0 },
  { id: "o2", nombre: "arequipe", precioExtraCents: 0 },
  { id: "o3", nombre: "lechera", precioExtraCents: 0 },
];
const CHURRITA: ProductoDelCatalogo = {
  id: "prod_churrita",
  nombre: "CHURRITA",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [{ id: "g1", nombre: "SALSA", minimo: 1, maximo: 1, permiteRepeticion: true, opciones: SALSAS }],
};
const CARTA = [CHURRITA];
const UNIDADES = { CHURRITA: 6 };

const sal = (...nombres: string[]) => nombres.map((n) => ({ grupo: "SALSA", opcion: n }));

/** Lo mismo, pero ya resuelto: es lo que guarda el estado. */
const elegidas = (...nombres: string[]) =>
  nombres.map((n) => ({
    grupoId: "g1",
    grupoNombre: "SALSA",
    opcionId: SALSAS.find((o) => o.nombre === n)!.id,
    nombre: n,
    precioDeltaCents: 0,
  }));

const propuesta = (p: Partial<Parameters<typeof validarPropuesta>[0]> = {}) => ({
  producto: "churrita",
  cantidad: 1,
  opciones: sal("arequipe"),
  datos: {} as Record<string, string | null>,
  ...p,
});

/** Lo que pide un negocio de pedidos con domicilio. Sale de SU ficha. */
const REQUISITOS = [
  { id: "nombre", tipo: "texto" as const, etiqueta: "el nombre", obligatorio: true },
  { id: "telefono", tipo: "telefono" as const, etiqueta: "el celular", obligatorio: true },
  { id: "direccion", tipo: "direccion" as const, etiqueta: "la dirección", obligatorio: true },
];

describe("el backend resuelve, no el modelo", () => {
  it("guarda el ID del producto, no solo el nombre que dijo el modelo", () => {
    const v = validarPropuesta(propuesta(), CARTA, UNIDADES);
    expect(v.ok).toBe(true);
    expect(v.estado.producto.id).toBe("prod_churrita");
    expect(v.estado.producto.nombre).toBe("CHURRITA");
  });

  it("el total lo calcula el servidor", () => {
    const v = validarPropuesta(propuesta(), CARTA, UNIDADES);
    expect(v.estado.totalCents).toBe(1000000);
  });

  it("corrige el nombre sin rechazar la conversación", () => {
    const v = validarPropuesta(propuesta({ producto: "Churritas" }), CARTA, UNIDADES);
    expect(v.ok).toBe(true);
    expect(v.correcciones.join(" ")).toContain("CHURRITA");
  });
});

describe("corrupción deliberada", () => {
  it("producto que no existe en la carta", () => {
    const v = validarPropuesta(propuesta({ producto: "PIZZA" }), CARTA, UNIDADES);
    expect(v.estado.producto.id).toBeNull();
    expect(v.dudas.some((d) => d.campo === "producto")).toBe(true);
  });

  it("producto de OTRA organización: no resuelve", () => {
    // Aunque el modelo lo nombre bien, si no está en el catálogo de este
    // negocio no existe. Es la barrera contra la fuga entre clientes.
    const v = validarPropuesta(propuesta({ producto: "TORTA DE CHOCOLATE" }), CARTA, UNIDADES);
    expect(v.estado.producto.id).toBeNull();
  });

  it("salsa incompatible con el producto → RECHAZO", () => {
    const v = validarPropuesta(propuesta({ opciones: sal("mostaza") }), CARTA, UNIDADES);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("mostaza");
  });

  it("cantidad 0 → RECHAZO", () => {
    const v = validarPropuesta(propuesta({ cantidad: 0 }), CARTA, UNIDADES);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("cantidad inválida");
  });

  it("cantidad negativa → RECHAZO", () => {
    expect(validarPropuesta(propuesta({ cantidad: -3 }), CARTA, UNIDADES).ok).toBe(false);
  });

  it("cantidad decimal → RECHAZO", () => {
    expect(validarPropuesta(propuesta({ cantidad: 1.5 }), CARTA, UNIDADES).ok).toBe(false);
  });

  it('"6 churros" no se cobra ×6: se pregunta', () => {
    const v = validarPropuesta(
      propuesta({ producto: "churros", cantidad: 6 }),
      CARTA,
      UNIDADES
    );
    expect(v.estado.producto.cantidad).toBe(1);
    expect(v.dudas.some((d) => d.campo === "cantidad")).toBe(true);
  });
});

describe("estados imposibles", () => {
  const completo = {
    producto: "churrita",
    cantidad: 1,
    opciones: sal("arequipe"),
    datos: { nombre: "Andrea", telefono: "3001234567", direccion: "Cra 5 #10-20" },
    confirmado: true,
  };

  it("confirmado sin producto → RECHAZO", () => {
    const v = validarPropuesta({ ...completo, producto: null }, CARTA, UNIDADES, REQUISITOS);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("sin producto");
  });

  it("confirmado sin teléfono → RECHAZO", () => {
    const v = validarPropuesta({ ...completo, datos: { ...completo.datos, telefono: null } }, CARTA, UNIDADES, REQUISITOS);
    expect(v.ok).toBe(false);
    expect(v.rechazos.join(" ")).toContain("el celular");
  });

  it("confirmado sin dirección → RECHAZO", () => {
    expect(validarPropuesta({ ...completo, datos: { ...completo.datos, direccion: "  " } }, CARTA, UNIDADES, REQUISITOS).ok).toBe(false);
  });

  it("un pedido completo y confirmado SÍ pasa", () => {
    const v = validarPropuesta(completo, CARTA, UNIDADES, REQUISITOS);
    expect(v.ok).toBe(true);
    expect(v.estado.confirmado).toBe(true);
    expect(v.estado.totalCents).toBe(1000000);
  });

  it("el paso numérico no rompe nada (el prompt numera sus mensajes)", () => {
    const v = validarPropuesta({ ...propuesta(), paso: 2 }, CARTA, UNIDADES);
    expect(v.estado.paso).toBe("2");
  });
});

describe("qué aportó el cliente en este turno", () => {
  const base: EstadoDelPedido = {
    ...estadoVacio(),
    producto: { id: "prod_churrita", nombre: "CHURRITA", cantidad: 1 },
  };

  it("distingue lo nuevo de lo que cambia y de lo que permanece", () => {
    const despues: EstadoDelPedido = { ...base, seleccion: elegidas("arequipe") };
    const l = leerAporte(base, despues);
    expect(l.nuevo.map((n) => n.campo)).toEqual(["opciones"]);
    expect(l.permanece).toContain("producto");
    expect(l.cambia).toEqual([]);
  });

  it("un cambio de opinión NO es información nueva", () => {
    const antes: EstadoDelPedido = { ...base, seleccion: elegidas("arequipe") };
    const despues: EstadoDelPedido = { ...base, seleccion: elegidas("lechera") };
    const l = leerAporte(antes, despues);
    expect(l.cambia.map((c) => c.campo)).toEqual(["opciones"]);
    expect(l.nuevo).toEqual([]);
  });

  it("en una conversación nueva, todo lo dicho es aporte", () => {
    const l = leerAporte(null, base);
    expect(l.nuevo.map((n) => n.campo)).toContain("producto");
  });
});

describe("lo que el backend le recuerda al modelo", () => {
  it("dice qué falta, en el orden del flujo", () => {
    const e: EstadoDelPedido = {
      ...estadoVacio(),
      producto: { id: "prod_churrita", nombre: "CHURRITA", cantidad: 1 },
    };
    expect(loQueFalta(e, CHURRITA, REQUISITOS)).toEqual([
      "salsa",
      "el nombre",
      "el celular",
      "la dirección",
    ]);
  });

  it("el bloque del prompt no repite el teléfono, solo dice que ya lo tiene", () => {
    const e: EstadoDelPedido = {
      ...estadoVacio(),
      producto: { id: "prod_churrita", nombre: "CHURRITA", cantidad: 1 },
      seleccion: elegidas("arequipe"),
      datos: { nombre: "Andrea", telefono: "3001234567", direccion: "Cra 5" },
      totalCents: 1000000,
    };
    const texto = comoTexto(e, CHURRITA, REQUISITOS);
    expect(texto).toContain("el celular: ya la dio");
    expect(texto).not.toContain("3001234567"); // el dato no se repite en el prompt
    expect(texto).toContain("$10.000");
  });

  it("sin pedido en curso no inyecta nada: el prompt no engorda porque sí", () => {
    expect(comoTexto(estadoVacio(), CHURRITA)).toBe("");
  });
});

describe("las métricas de la regla 10", () => {
  const capturar = (fn: () => void): string => {
    let linea = "";
    const log = vi.spyOn(console, "log").mockImplementation((m) => void (linea = String(m)));
    const warn = vi.spyOn(console, "warn").mockImplementation((m) => void (linea = String(m)));
    try {
      fn();
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
    return linea;
  };

  it("una línea por turno con lo que las seis métricas necesitan", () => {
    const v = validarPropuesta(propuesta({ producto: "Churritas" }), CARTA, UNIDADES);
    const linea = capturar(() =>
      registrarMetricaDeEstado({
        organizationId: "org_x",
        conversationId: "cv_1",
        resultado: "guardado",
        validacion: v,
        msModelo: 2172,
        msBackend: 31,
      })
    );

    expect(linea).toContain("[metrica] evento=estado org=org_x conv=cv_1");
    expect(linea).toContain("resultado=guardado");
    expect(linea).toContain("ms_modelo=2172");
    expect(linea).toContain("ms_backend=31");
    // "Churritas" → CHURRITA es una corrección: la métrica la cuenta, y dice
    // QUÉ campo se corrigió (no cuántos, que no sirve para investigar nada).
    expect(linea).toMatch(/correcciones=[1-9]/);
    expect(linea).toContain("campos_corregidos=producto");
    expect(linea).toContain("rechazos=0");
  });

  it("un rechazo dice POR QUÉ, que es lo que se mira a diario", () => {
    const v = validarPropuesta(propuesta({ cantidad: 0 }), CARTA, UNIDADES);
    expect(v.ok).toBe(false);
    const linea = capturar(() =>
      registrarMetricaDeEstado({
        organizationId: "org_x",
        conversationId: "cv_2",
        resultado: "rechazado",
        validacion: v,
        msBackend: 4,
      })
    );

    expect(linea).toContain("resultado=rechazado");
    expect(linea).toContain("rechazos=1");
    expect(linea).toContain("cantidad inválida: 0");
    expect(linea).toContain("ms_modelo=-"); // no hubo llamada que medir
  });

  it("NO vuelca lo que escribió el cliente: solo el nombre del campo", () => {
    const v = validarPropuesta(
      propuesta({ datos: { nombre: "Andrea", telefono: "3001234567", direccion: "Cra 5 #4-3" } }),
      CARTA,
      UNIDADES
    );
    const linea = capturar(() =>
      registrarMetricaDeEstado({
        organizationId: "org_x",
        conversationId: "cv_3",
        resultado: "guardado",
        validacion: v,
        msBackend: 7,
      })
    );

    expect(linea).not.toContain("3001234567");
    expect(linea).not.toContain("Cra 5");
    expect(linea).not.toContain("Andrea");
  });

  it("sin propuesta no revienta: se anota igual, con todo a cero", () => {
    const linea = capturar(() =>
      registrarMetricaDeEstado({
        organizationId: "org_x",
        conversationId: "cv_4",
        resultado: "sin_propuesta",
        msBackend: 0,
      })
    );

    expect(linea).toContain("resultado=sin_propuesta");
    expect(linea).toContain("correcciones=0");
    expect(linea).toContain("rechazos=0");
  });
});

describe("cada opción sabe de qué grupo es (modelo v2)", () => {
  // El catálogo tal como queda con tres grupos: el orden deja de importar,
  // porque ya no hay que adivinar nada.
  const CON_TRES_GRUPOS: ProductoDelCatalogo = {
    ...CHURRITA,
    grupos: [
      {
        id: "g0",
        nombre: "RECUBIERTO",
        minimo: 1,
        maximo: 1, permiteRepeticion: false,
        opciones: [{ id: "r1", nombre: "azúcar-canela", precioExtraCents: 0 }],
      },
      { id: "g1", nombre: "SALSA", minimo: 1, maximo: 5, permiteRepeticion: true, opciones: SALSAS },
      {
        id: "g2",
        nombre: "ADICIONES",
        minimo: 0,
        maximo: 5, permiteRepeticion: true,
        opciones: [{ id: "a1", nombre: "lechera", precioExtraCents: 150000 }],
      },
    ],
  };
  const CARTA_3 = [CON_TRES_GRUPOS];

  it("el recubierto primero ya no confunde a nadie: cada opción trae su grupo", () => {
    const v = validarPropuesta(
      {
        ...propuesta(),
        opciones: [
          { grupo: "SALSA", opcion: "arequipe" },
          { grupo: "RECUBIERTO", opcion: "azúcar-canela" },
        ],
      },
      CARTA_3,
      UNIDADES
    );
    const porGrupo = v.estado.seleccion.map((s) => `${s.grupoNombre}:${s.nombre}`);
    expect(porGrupo).toEqual(["SALSA:arequipe", "RECUBIERTO:azúcar-canela"]);
  });

  it("una salsa incluida no se cobra aunque exista una adición con su nombre", () => {
    const v = validarPropuesta(
      {
        ...propuesta(),
        opciones: [
          { grupo: "SALSA", opcion: "lechera" },
          { grupo: "RECUBIERTO", opcion: "azúcar-canela" },
        ],
      },
      CARTA_3,
      UNIDADES
    );
    expect(v.estado.totalCents).toBe(1000000); // sin el +$1.500 de la adición
  });

  it("el nombre y el precio quedan guardados: el estado sigue legible mañana", () => {
    const v = validarPropuesta(
      {
        ...propuesta(),
        opciones: [
          { grupo: "ADICIONES", opcion: "lechera" },
          { grupo: "SALSA", opcion: "arequipe" },
          { grupo: "RECUBIERTO", opcion: "azúcar-canela" },
        ],
      },
      CARTA_3,
      UNIDADES
    );
    const adicion = v.estado.seleccion.find((s) => s.grupoNombre === "ADICIONES")!;
    expect(adicion.opcionId).toBe("a1");
    expect(adicion.nombre).toBe("lechera");
    expect(adicion.precioDeltaCents).toBe(150000);
  });

  it("un grupo que ningún código conoce funciona igual", () => {
    const salon: ProductoDelCatalogo = {
      ...CHURRITA,
      nombre: "MANICURA",
      grupos: [
        {
          id: "ge",
          nombre: "ESMALTE",
          minimo: 1,
          maximo: 1, permiteRepeticion: false,
          opciones: [{ id: "e1", nombre: "con esmalte", precioExtraCents: 500000 }],
        },
      ],
    };
    const v = validarPropuesta(
      { ...propuesta(), producto: "MANICURA", opciones: [{ grupo: "ESMALTE", opcion: "con esmalte" }] },
      [salon],
      {}
    );
    expect(v.ok).toBe(true);
    expect(v.estado.seleccion[0]!.grupoNombre).toBe("ESMALTE");
    expect(v.estado.totalCents).toBe(1000000 + 500000);
  });
});
