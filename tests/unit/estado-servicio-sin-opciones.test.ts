/**
 * Bug real, auditoría de citas (Lashes Valen, 31-ago-2026): `catalogoDe`
 * devuelve TODO servicio de citas con `grupos: []` (no existe tabla de
 * opciones para servicios — `server/catalog/queries.ts`). Cuando el modelo
 * propone `items[].opciones` para un servicio sin ningún grupo declarado,
 * `resolverItem` (normalizar.ts) lo trataba como una opción inválida — duda
 * con "no está entre las opciones de X" — y `validarPropuesta` (estado.ts)
 * convertía esa duda en un RECHAZO que descartaba el turno ENTERO: ni el
 * servicio ni la cantidad, ya resueltos correctamente, se guardaban.
 * Reproducido con evidencia real (`runAgentTurn` contra un clon de Lashes
 * Valen): "quiero un Laminado de cejas" dejaba `conversation_state = null`.
 *
 * El fix (normalizar.ts, `resolverItem`): si `producto.grupos.length === 0`,
 * cualquier `opciones` propuesta se ignora en silencio — no hay NADA
 * legítimo contra qué resolverla, así que no es una elección real que se
 * pierda, es ruido del modelo sobre un campo que este producto no tiene.
 * Cuando el producto SÍ tiene grupos (pedidos, la mayoría de los casos), el
 * comportamiento no cambia ni un bit: sigue rechazando una opción que no
 * exista.
 */
import { describe, expect, it } from "vitest";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { validarPropuesta } from "@/server/orders/estado";
import type { PropuestaDelModelo } from "@/server/orders/estado";

const LAMINADO: ProductoDelCatalogo = {
  id: "svc_lam",
  nombre: "Laminado de cejas",
  categoria: "Cejas y Lifting",
  precioCents: 8000000,
  descripcion: null,
  grupos: [],
};
const HENNA: ProductoDelCatalogo = {
  id: "svc_henna",
  nombre: "Cejas en Henna",
  categoria: "Cejas y Lifting",
  precioCents: 3000000,
  descripcion: null,
  grupos: [],
};
const CATALOGO_CITAS: ProductoDelCatalogo[] = [LAMINADO, HENNA];

const CHURRITA_CON_SALSA: ProductoDelCatalogo = {
  id: "p1",
  nombre: "CHURRITA",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [
    {
      id: "g-p1",
      nombre: "SALSA",
      minimo: 1,
      maximo: 1,
      permiteRepeticion: true,
      opciones: [{ id: "o1", nombre: "arequipe", precioExtraCents: 0 }],
    },
  ],
};

const REQUISITO_NOMBRE = [{ id: "nombre", tipo: "texto" as const, etiqueta: "el nombre", obligatorio: true }];

describe("validarPropuesta — servicio de citas SIN grupos de opciones", () => {
  it("Caso 1 — creación: servicio sin ninguna opción propuesta se guarda normal", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: {},
      paso: 1,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.ok).toBe(true);
    expect(v.estado.items[0]!.ofrecible.id).toBe("svc_lam");
    expect(v.estado.items[0]!.seleccion).toEqual([]);
  });

  it("Caso 2 — EL BUG REAL: el modelo pone el propio nombre del servicio como 'opción' → ya NO rechaza", () => {
    const propuesta: PropuestaDelModelo = {
      items: [
        {
          ofrecible: "Laminado de cejas",
          cantidad: 1,
          opciones: [{ grupo: null, opcion: "Laminado de cejas" }],
        },
      ],
      datos: {},
      paso: 1,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.ok).toBe(true);
    expect(v.rechazos).toEqual([]);
    expect(v.estado.items[0]!.ofrecible.id).toBe("svc_lam");
    // La "opción" inventada se ignora: no queda seleccionada.
    expect(v.estado.items[0]!.seleccion).toEqual([]);
  });

  it("Caso 3 — cambio de servicio: el turno siguiente refleja solo el nuevo, no mezcla con el anterior", () => {
    const turno1: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: {},
      paso: 1,
    };
    const turno2: PropuestaDelModelo = {
      items: [{ ofrecible: "Cejas en Henna", cantidad: 1, opciones: [] }],
      datos: {},
      paso: 1,
    };
    const v1 = validarPropuesta(turno1, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    const v2 = validarPropuesta(turno2, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v1.estado.items[0]!.ofrecible.id).toBe("svc_lam");
    expect(v2.estado.items).toHaveLength(1);
    expect(v2.estado.items[0]!.ofrecible.id).toBe("svc_henna");
  });

  it("Caso 4 — cambio de especialista: reserva.especialista se refleja tal como lo propuso el modelo", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: { nombre: "Ana" },
      reserva: { fecha: "07/09/2026", hora: "09:30", especialista: "Valentina" },
      paso: 2,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.estado.reserva?.recursoNombre).toBe("Valentina");

    const propuesta2: PropuestaDelModelo = { ...propuesta, reserva: { ...propuesta.reserva, especialista: "Hilary" } };
    const v2 = validarPropuesta(propuesta2, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v2.estado.reserva?.recursoNombre).toBe("Hilary");
  });

  it("Caso 5 — estado ANTES de tener fecha: reserva.fecha queda null, no rechaza (sin confirmar todavía)", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: {},
      reserva: { fecha: null, hora: null, especialista: null },
      paso: 1,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.ok).toBe(true);
    expect(v.estado.reserva?.fecha).toBeNull();
  });

  it("Caso 6 — estado DESPUÉS de tener fecha: persiste tal cual", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: {},
      reserva: { fecha: "07/09/2026", hora: null, especialista: null },
      paso: 2,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.estado.reserva?.fecha).toBe("07/09/2026");
  });

  it("Caso 7 — estado ANTES de tener horario: reserva.hora queda null", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: {},
      reserva: { fecha: "07/09/2026", hora: null, especialista: "Valentina" },
      paso: 2,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.estado.reserva?.hora).toBeNull();
  });

  it("Caso 8 — estado DESPUÉS de tener horario: persiste tal cual", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: {},
      reserva: { fecha: "07/09/2026", hora: "09:30", especialista: "Valentina" },
      paso: 3,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.estado.reserva?.hora).toBe("09:30");
  });

  it("Caso 9 — confirmación final: con servicio, fecha, hora y requisito cumplidos, se acepta", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: { nombre: "Ana" },
      reserva: { fecha: "07/09/2026", hora: "09:30", especialista: "Valentina" },
      paso: 4,
      confirmado: true,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.ok).toBe(true);
    expect(v.estado.confirmado).toBe(true);
  });

  it("Caso 10 — confirmación sin fecha/hora: sigue rechazando (el fix no afloja esta regla)", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "Laminado de cejas", cantidad: 1, opciones: [] }],
      datos: { nombre: "Ana" },
      reserva: { fecha: null, hora: null, especialista: null },
      paso: 4,
      confirmado: true,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.ok).toBe(false);
    expect(v.rechazos).toContain("confirmado sin fecha/hora de la cita");
  });

  it("NO-REGRESIÓN — producto CON grupos reales (pedidos): una opción inválida SIGUE rechazando", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "CHURRITA", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "fresa" }] }],
      datos: {},
      paso: 1,
    };
    const v = validarPropuesta(propuesta, [CHURRITA_CON_SALSA], undefined, [], []);
    expect(v.ok).toBe(false);
    expect(v.rechazos.some((r) => r.includes('"fresa" no está entre las opciones'))).toBe(true);
  });

  it("NO-REGRESIÓN — producto CON grupos reales: una opción válida se resuelve normal", () => {
    const propuesta: PropuestaDelModelo = {
      items: [{ ofrecible: "CHURRITA", cantidad: 1, opciones: [{ grupo: "SALSA", opcion: "arequipe" }] }],
      datos: {},
      paso: 1,
    };
    const v = validarPropuesta(propuesta, [CHURRITA_CON_SALSA], undefined, [], []);
    expect(v.ok).toBe(true);
    expect(v.estado.items[0]!.seleccion).toHaveLength(1);
    expect(v.estado.items[0]!.seleccion[0]!.nombre).toBe("arequipe");
  });

  it("Varios servicios sin grupos en el mismo turno, cada uno con opciones inventadas: ninguno rechaza", () => {
    const propuesta: PropuestaDelModelo = {
      items: [
        { ofrecible: "Laminado de cejas", cantidad: 1, opciones: [{ grupo: "Especialista", opcion: "Valentina" }] },
        { ofrecible: "Cejas en Henna", cantidad: 1, opciones: [{ opcion: "Cejas en Henna" }] },
      ],
      datos: {},
      paso: 1,
    };
    const v = validarPropuesta(propuesta, CATALOGO_CITAS, undefined, REQUISITO_NOMBRE, []);
    expect(v.ok).toBe(true);
    expect(v.estado.items).toHaveLength(2);
    expect(v.estado.items[0]!.seleccion).toEqual([]);
    expect(v.estado.items[1]!.seleccion).toEqual([]);
  });
});
