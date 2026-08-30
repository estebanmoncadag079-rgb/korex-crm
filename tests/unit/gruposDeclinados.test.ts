/**
 * Problema B (docs de la corrección de Malía, 29/30-ago-2026): el agente
 * preguntó por los toppings varias veces seguidas sin avanzar. La causa era
 * que un grupo OPCIONAL sin nada elegido se veía exactamente igual —"no hay
 * nada aquí"— tanto si el cliente nunca lo había tocado como si acababa de
 * decir "sin toppings". El backend no tenía dónde guardar esa segunda cosa.
 *
 * `gruposDeclinados` cierra esa distinción: PENDIENTE (ausente de
 * `seleccion` y de `gruposDeclinados`) vs. DECLINADO (en `gruposDeclinados`).
 * Un grupo obligatorio nunca puede "declinarse" — hay que elegirlo sí o sí,
 * y eso ya lo garantizaba `loQueFalta` antes de este cambio; no se toca.
 */
import { describe, expect, it } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { estadoVacio, validarPropuesta, type EstadoDelPedido } from "@/server/orders/estado";
import { comoTexto, loQueFalta } from "@/server/orders/extraer";

const SABORES = [
  { id: "s1", nombre: "vainilla", precioExtraCents: 0 },
  { id: "s2", nombre: "chocolate", precioExtraCents: 0 },
];
const TOPPINGS = [
  { id: "t1", nombre: "fresa", precioExtraCents: 200_000 },
  { id: "t2", nombre: "mani", precioExtraCents: 200_000 },
];
const POSTRE: ProductoDelCatalogo = {
  id: "prod_postre",
  nombre: "Postre",
  categoria: null,
  precioCents: 1_000_000,
  descripcion: null,
  grupos: [
    { id: "g_sabor", nombre: "Sabor", minimo: 1, maximo: 1, permiteRepeticion: false, opciones: SABORES },
    { id: "g_toppings", nombre: "Toppings", minimo: 0, maximo: 3, permiteRepeticion: false, opciones: TOPPINGS },
  ],
};
const CARTA = [POSTRE];

function propuesta(datos: {
  opciones?: { grupo: string; opcion: string }[];
  gruposDeclinados?: string[];
}) {
  return {
    items: [
      {
        ofrecible: "postre",
        cantidad: 1,
        opciones: datos.opciones ?? [],
        gruposDeclinados: datos.gruposDeclinados ?? null,
      },
    ],
    datos: {},
  };
}

describe("Caso 1 — cliente elige toppings", () => {
  it("queda guardado en la selección, y toppings deja de pedirse", () => {
    const r = validarPropuesta(
      propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }, { grupo: "Toppings", opcion: "fresa" }] }),
      CARTA
    );
    expect(r.ok).toBe(true);
    expect(r.estado.items[0]!.seleccion.some((s) => s.nombre === "fresa")).toBe(true);
    expect(r.estado.items[0]!.gruposDeclinados).toEqual([]);
    expect(loQueFalta(r.estado, CARTA)).not.toContain("toppings");
  });
});

describe("Caso 2 — cliente rechaza toppings explícitamente", () => {
  it("queda en gruposDeclinados, el pedido avanza y comoTexto lo dice", () => {
    const r = validarPropuesta(
      propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }], gruposDeclinados: ["Toppings"] }),
      CARTA
    );
    expect(r.ok).toBe(true);
    expect(r.estado.items[0]!.gruposDeclinados).toEqual([{ grupoId: "g_toppings", grupoNombre: "Toppings" }]);
    // Nada bloquea el cierre: sigue sin figurar como falta (era opcional).
    expect(loQueFalta(r.estado, CARTA)).not.toContain("toppings");

    const texto = comoTexto(r.estado, CARTA);
    expect(texto.toLowerCase()).toContain("sin toppings");
    expect(texto).toContain("no vuelvas a preguntar");
  });

  it("declinar un grupo OBLIGATORIO se ignora: sigue pendiente, se sigue pidiendo", () => {
    // El modelo nunca debería proponer esto, pero si lo hace no se le cree:
    // "Sabor" es obligatorio y no se puede "no querer".
    const r = validarPropuesta(propuesta({ gruposDeclinados: ["Sabor"] }), CARTA);
    expect(r.estado.items[0]!.gruposDeclinados).toEqual([]);
    expect(loQueFalta(r.estado, CARTA)).toContain("sabor");
  });
});

describe("Caso 3 — opcional sin tocar: el sistema no fuerza el ciclo", () => {
  it("toppings nunca aparece como 'falta' aunque el cliente no lo haya mencionado", () => {
    const r = validarPropuesta(propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }] }), CARTA);
    expect(loQueFalta(r.estado, CARTA)).toEqual([]);
    // Y comoTexto no incluye ninguna instrucción de volver a preguntar algo
    // que no está resuelto: solo informa de lo que SÍ hay.
    const texto = comoTexto(r.estado, CARTA);
    expect(texto).not.toMatch(/sin toppings/i);
  });
});

describe("Caso 4 — el cliente cambia de opinión", () => {
  it("de declinado a elegido: el estado se actualiza (reemplazo completo, sin arrastrar lo viejo)", () => {
    const turno1 = validarPropuesta(
      propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }], gruposDeclinados: ["Toppings"] }),
      CARTA
    );
    expect(turno1.estado.items[0]!.gruposDeclinados).toHaveLength(1);

    // El cliente cambia de opinión; el modelo del turno siguiente ya NO manda
    // "Toppings" en gruposDeclinados, sino la opción elegida.
    const turno2 = validarPropuesta(
      propuesta({
        opciones: [{ grupo: "Sabor", opcion: "vainilla" }, { grupo: "Toppings", opcion: "mani" }],
      }),
      CARTA
    );
    expect(turno2.estado.items[0]!.gruposDeclinados).toEqual([]);
    expect(turno2.estado.items[0]!.seleccion.some((s) => s.nombre === "mani")).toBe(true);
  });

  it("de elegido a declinado también se actualiza", () => {
    const turno1 = validarPropuesta(
      propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }, { grupo: "Toppings", opcion: "fresa" }] }),
      CARTA
    );
    expect(turno1.estado.items[0]!.seleccion.some((s) => s.nombre === "fresa")).toBe(true);

    const turno2 = validarPropuesta(
      propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }], gruposDeclinados: ["Toppings"] }),
      CARTA
    );
    expect(turno2.estado.items[0]!.seleccion.some((s) => s.nombre === "fresa")).toBe(false);
    expect(turno2.estado.items[0]!.gruposDeclinados).toEqual([{ grupoId: "g_toppings", grupoNombre: "Toppings" }]);
  });
});

describe("Caso 5 — no depende del historial de mensajes", () => {
  it("comoTexto/loQueFalta leen solo el estado guardado, nunca la conversación", () => {
    // Ambas funciones no reciben ningún historial como argumento — el estado
    // persistido es la única fuente, sin importar cuántos turnos hace que se
    // resolvió. Se simula "muchos turnos después": mismo resultado que recién
    // resuelto.
    const resueltoHaceRato: EstadoDelPedido = {
      ...estadoVacio(),
      items: [
        {
          ofrecible: { id: POSTRE.id, nombre: POSTRE.nombre },
          cantidad: 1,
          seleccion: [
            { grupoId: "g_sabor", grupoNombre: "Sabor", opcionId: "s1", nombre: "vainilla", precioDeltaCents: 0 },
          ],
          gruposDeclinados: [{ grupoId: "g_toppings", grupoNombre: "Toppings" }],
          totalCents: 1_000_000,
        },
      ],
      totalCents: 1_000_000,
    };
    expect(loQueFalta(resueltoHaceRato, CARTA)).toEqual([]);
    expect(comoTexto(resueltoHaceRato, CARTA).toLowerCase()).toContain("sin toppings");
  });
});

describe("Caso 6 — reproduce el escenario real: no hay repetición infinita", () => {
  it("una vez el cliente atiende toppings (elige o declina), ningún turno posterior vuelve a pedirlo", () => {
    // Reconstruye, turno a turno, la conversación real de Malía hasta el
    // punto en que se resuelve el tamaño/sabor — y confirma que, apenas el
    // cliente dice algo sobre toppings (aunque sea "sin toppings"), el
    // backend deja de listarlo como pendiente para siempre, sin depender de
    // que el LLM "se acuerde": es el estado, no la memoria del modelo.
    let estado = estadoVacio();

    // Turno 1: solo elige tamaño y sabor — toppings todavía sin tocar.
    estado = validarPropuesta(
      propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }] }),
      CARTA
    ).estado;
    expect(loQueFalta(estado, CARTA)).toEqual([]); // opcional: nunca bloquea

    // Turno 2, 3, 4... el cliente sigue sin mencionar toppings: el backend
    // JAMÁS lo agrega a "falta", así que nada en el estado empuja a
    // preguntarlo de nuevo turno tras turno.
    for (let i = 0; i < 5; i++) {
      estado = validarPropuesta(
        propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }] }),
        CARTA
      ).estado;
      expect(loQueFalta(estado, CARTA)).toEqual([]);
    }

    // Finalmente el cliente responde ("sin toppings" o eligiendo uno): queda
    // resuelto para siempre, sin ambigüedad posible en turnos futuros.
    estado = validarPropuesta(
      propuesta({ opciones: [{ grupo: "Sabor", opcion: "vainilla" }], gruposDeclinados: ["Toppings"] }),
      CARTA
    ).estado;
    expect(estado.items[0]!.gruposDeclinados).toHaveLength(1);
    expect(comoTexto(estado, CARTA)).toContain("no vuelvas a preguntar");
  });
});
