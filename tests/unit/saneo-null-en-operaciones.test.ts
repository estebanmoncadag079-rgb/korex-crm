import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T028 (feature 003-backend-como-autoridad) — corrección de saneo de `null`
 * en `operaciones[]` antes de la Compuerta 1 (`OperacionPedidos`/
 * `OperacionCitas` `.array().safeParse(...)`, `pipeline.ts:guardarEstadoPropuesto`).
 *
 * Causa raíz: `esquemaDeOperaciones` obliga al proveedor, en modo estricto, a
 * declarar TODO campo aunque no aplique a la operación elegida, con `null`
 * como valor para "no aplica". La `accion` completa ya pasaba por `sinNulos`
 * antes de validar (`chatJsonConEstado`), pero cada elemento de
 * `operaciones[]` se validaba crudo — y `cambiar_cantidad`/`quitar_item`/
 * `elegir_opcion`/`declinar_grupo` declaran su `opciones` como `.optional()`
 * en Zod (acepta AUSENTE, no `null`). Un modelo que sigue al pie de la letra
 * la convención del propio esquema tumbaba la Compuerta 1 del LOTE ENTERO —
 * reproducido en vivo contra La Churra en producción (gpt-5-mini); no
 * reproducido con gemini-2.5-flash (el modelo real del negocio), pero el
 * defecto vivía en el código, no en el modelo.
 *
 * Mismo scaffolding de mocks que `pipeline-operaciones-integracion.test.ts`
 * (T016) — mismo patrón, casos distintos.
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const catalogoDePedidosMock = vi.fn();
const catalogoDeMock = vi.fn();
vi.mock("@/server/catalog/queries", () => ({
  catalogoDePedidos: (...a: unknown[]) => catalogoDePedidosMock(...a),
  catalogoDe: (...a: unknown[]) => catalogoDeMock(...a),
}));

vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: vi.fn(),
  catalogoParaPrompt: vi.fn(),
  proximasFechasConCupoMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn(),
  disponibilidadRealMultiple: vi.fn(),
  listStaff: vi.fn().mockResolvedValue([]),
  estaEntreLosOfrecidos: () => Promise.resolve({ ok: true }),
  registrarOfrecidos: () => Promise.resolve(),
  limpiarOfrecidos: () => Promise.resolve(),
}));

const notifyTeamMock = vi.fn().mockResolvedValue({ sent: 0, failed: 0, detail: "prueba" });
vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: (...a: unknown[]) => notifyTeamMock(...a),
  contactPhoneOf: vi.fn().mockResolvedValue(null),
}));

let estadoActual: unknown = null;
let versionActual = 0;
const guardarEstadoCalls: { estado: Record<string, unknown> }[] = [];
const guardarEstadoMock = vi.fn(async (entrada: { estado: Record<string, unknown> }) => {
  guardarEstadoCalls.push(entrada);
  estadoActual = entrada.estado;
  versionActual += 1;
  return { ok: true };
});
const leerEstadoConVersionMock = vi.fn(async () =>
  estadoActual ? { estado: estadoActual, version: versionActual } : null
);

vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    guardarEstado: (...a: Parameters<typeof guardarEstadoMock>) => guardarEstadoMock(...a),
    leerEstadoConVersion: (...a: Parameters<typeof leerEstadoConVersionMock>) =>
      leerEstadoConVersionMock(...a),
  };
});

const selectQueue: unknown[][] = [];
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const chain = {
          onConflictDoNothing: () => chain,
          onConflictDoUpdate: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
          };
          return chain;
        },
      }),
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

const PAVE = {
  id: "p1",
  nombre: "Pavé chocolate",
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [],
};

const WAFFLE = {
  id: "p2",
  nombre: "Waffle",
  categoria: null,
  precioCents: 800000,
  descripcion: null,
  grupos: [
    {
      id: "g-top",
      nombre: "Toppings",
      minimo: 0,
      maximo: 1,
      permiteRepeticion: false,
      opciones: [{ id: "t1", nombre: "Arequipe", precioExtraCents: 200000 }],
    },
  ],
};

function conversacion(id = "cv_1") {
  return {
    id,
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfil() {
  return {
    id: "agp_1",
    organizationId: "org_1",
    enabled: true,
    appointmentsEnabled: false,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    hoursOpen: "08:00",
    hoursClose: "23:00",
    hoursDays: "1,2,3,4,5,6,7",
    catalogSource: "tabla",
    paymentSource: "prompt",
    stateSource: "backend",
    deliverySource: "prompt",
    ficha: JSON.stringify({ cierre: { requisitos: [] } }),
  };
}

function queueTurnoBase(texto: string) {
  selectQueue.push(
    [conversacion()],
    [perfil()],
    [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }],
    [],
    [],
    [],
    []
  );
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([PAVE, WAFFLE]);
  catalogoDeMock.mockReset().mockResolvedValue([PAVE, WAFFLE]);
  selectQueue.length = 0;
  guardarEstadoCalls.length = 0;
  guardarEstadoMock.mockClear();
  leerEstadoConVersionMock.mockClear();
  notifyTeamMock.mockClear();
  estadoActual = null;
  versionActual = 0;
});

describe("T028 — saneo de null en operaciones[] antes de Compuerta 1", () => {
  it("A. agregar_item con opciones válidas: sigue funcionando igual que antes de la corrección", async () => {
    queueTurnoBase("quiero un pavé de chocolate");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo!",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }],
      },
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(guardarEstadoCalls).toHaveLength(1);
    expect(guardarEstadoCalls[0]!.estado.items as unknown[]).toHaveLength(1);
  });

  it("B. cambiar_cantidad con opciones:null (el payload real que reprodujo el fallo): ya no rechaza la Compuerta 1", async () => {
    queueTurnoBase("quiero un pavé de chocolate");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo!",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }],
      },
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(guardarEstadoCalls).toHaveLength(1);

    queueTurnoBase("mejor que sean 2");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo, 2!",
        operaciones: [{ tipo: "cambiar_cantidad", ofrecible: "Pavé chocolate", opciones: null, cantidad: 2 }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(2);
    const estado2 = guardarEstadoCalls[1]!.estado as {
      items: { cantidad: number; totalCents: number }[];
      totalCents: number;
    };
    expect(estado2.items[0]!.cantidad).toBe(2);
    expect(estado2.items[0]!.totalCents).toBe(2000000);
    expect(estado2.totalCents).toBe(2000000);
  });

  it("C. quitar_item con opciones:null: ya no rechaza la Compuerta 1", async () => {
    queueTurnoBase("quiero un pavé de chocolate");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo!",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }],
      },
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    queueTurnoBase("ya no lo quiero");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "Listo, lo quito.",
        operaciones: [{ tipo: "quitar_item", ofrecible: "Pavé chocolate", opciones: null }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(2);
    expect(guardarEstadoCalls[1]!.estado.items as unknown[]).toHaveLength(0);
  });

  it("D. elegir_opcion con opciones válidas: sigue funcionando (control positivo)", async () => {
    queueTurnoBase("quiero un waffle");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo!",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Waffle", opciones: [], cantidad: 1 }],
      },
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    queueTurnoBase("con arequipe");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Arequipe!",
        operaciones: [{ tipo: "elegir_opcion", ofrecible: "Waffle", opciones: null, grupo: "Toppings", opcion: "Arequipe" }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(2);
    const estado = guardarEstadoCalls[1]!.estado as { items: { totalCents: number }[] };
    expect(estado.items[0]!.totalCents).toBe(1000000); // 800000 base + 200000 del topping
  });

  it("E. declinar_grupo con opciones:null: ya no rechaza la Compuerta 1", async () => {
    queueTurnoBase("quiero un waffle");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo!",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Waffle", opciones: [], cantidad: 1 }],
      },
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    queueTurnoBase("sin toppings");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "Sin toppings.",
        operaciones: [{ tipo: "declinar_grupo", ofrecible: "Waffle", opciones: null, grupo: "Toppings" }],
      },
    });
    await runAgentTurn("cv_1");

    expect(guardarEstadoCalls).toHaveLength(2);
    const estado = guardarEstadoCalls[1]!.estado as { items: { gruposDeclinados: unknown[] }[] };
    expect(estado.items[0]!.gruposDeclinados).toEqual([{ grupoId: "g-top", grupoNombre: "Toppings" }]);
  });

  it("F. lote con una operación válida (opciones:null saneada) + una inválida: atomicidad total, nada nuevo se guarda", async () => {
    queueTurnoBase("quiero un pavé de chocolate");
    chatJson.mockResolvedValueOnce({
      ok: true,
      raw: "{}",
      data: {
        action: "reply",
        text: "¡Listo!",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }],
      },
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(guardarEstadoCalls).toHaveLength(1);

    // cambiar_cantidad (válida, con opciones:null — la que este fix habilita)
    // + agregar_item de un producto que no existe (Compuerta 2, sin relación
    // con este fix). La inválida debe tumbar el lote COMPLETO.
    queueTurnoBase("mejor 5, y también quiero una torta voladora");
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: {
          action: "reply",
          text: "Anotado.",
          operaciones: [
            { tipo: "cambiar_cantidad", ofrecible: "Pavé chocolate", opciones: null, cantidad: 5 },
            { tipo: "agregar_item", ofrecible: "Torta voladora", opciones: [], cantidad: 1 },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "No tenemos torta voladora." },
      });
    await runAgentTurn("cv_1");

    // Ningún guardado nuevo: ni siquiera la cambiar_cantidad —que ahora,
    // gracias al saneo, hubiera pasado la Compuerta 1 sola— queda aplicada,
    // porque la operación 2 del mismo lote falló en la Compuerta 2.
    expect(guardarEstadoCalls).toHaveLength(1);
    expect((guardarEstadoCalls[0]!.estado.items as { cantidad: number }[])[0]!.cantidad).toBe(1);
  });
});
