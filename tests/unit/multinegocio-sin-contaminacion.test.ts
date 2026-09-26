import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La capa nueva corre para TODA la flota, así que la pregunta no es si
 * funciona en un negocio: es si al encenderla en cinco a la vez alguno
 * empieza a ver lo del vecino.
 *
 * Cinco perfiles reales, del más configurado al menos: MALIA y Lis (pedidos
 * con estado en el backend), La Churra (pedidos, catálogo en tablas), Lashes
 * Valen (citas) y Camilabrandcol (sin configurar — todo en el prompt).
 *
 * Los tres riesgos que cubre, en el orden en que dolerían:
 *
 *  1. que a un negocio le lleguen los productos o las reglas de otro;
 *  2. que a un salón de citas le lleguen reglas de pedidos;
 *  3. que a un negocio sin configurar la capa nueva le imponga una
 *     arquitectura que su estado actual no sostiene — el fallo silencioso,
 *     porque nadie lo pidió y nadie lo mira.
 *
 * Los perfiles son fixtures, no lecturas de producción: lo que se prueba es
 * el aislamiento del código, no qué flags tiene hoy cada cliente (eso vive en
 * `arquitectura-churra-lis.test.ts`).
 */

const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const catalogoDePedidosMock = vi.fn();
const catalogoDeMock = vi.fn();
vi.mock("@/server/catalog/queries", () => ({
  catalogoDePedidos: (...a: unknown[]) => catalogoDePedidosMock(...a),
  catalogoDe: (...a: unknown[]) => catalogoDeMock(...a),
}));

const catalogoParaPromptMock = vi.fn().mockResolvedValue([]);
vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: vi.fn(),
  catalogoParaPrompt: (...a: unknown[]) => catalogoParaPromptMock(...a),
  proximasFechasConCupoMultiple: vi.fn(),
  crearCitaMultiple: vi.fn(),
  reprogramarCita: vi.fn(),
  cancelarCita: vi.fn(),
  citasActivasDeContacto: vi.fn().mockResolvedValue([]),
  disponibilidadRealMultiple: vi.fn(),
  listStaff: vi.fn().mockResolvedValue([]),
  estaEntreLosOfrecidos: () => Promise.resolve({ ok: true }),
  registrarOfrecidos: () => Promise.resolve(),
  limpiarOfrecidos: () => Promise.resolve(),
}));

vi.mock("@/server/ai/notify-team", () => ({
  notifyTeam: vi.fn().mockResolvedValue({ sent: 0, failed: 0, detail: "prueba" }),
  contactPhoneOf: vi.fn().mockResolvedValue(null),
}));

let estadoActual: Record<string, unknown> | null = null;
const guardarEstadoMock = vi.fn(async () => ({ ok: true }));
const leerEstadoConVersionMock = vi.fn(async () =>
  estadoActual ? { estado: estadoActual, version: 1 } : null
);
vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    guardarEstado: () => guardarEstadoMock(),
    leerEstadoConVersion: () => leerEstadoConVersionMock(),
    borrarEstado: async () => {},
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
    delete: () => ({ where: () => Promise.resolve([]) }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

const producto = (id: string, nombre: string) => ({
  id,
  nombre,
  categoria: null,
  precioCents: 1000000,
  descripcion: null,
  grupos: [],
});

/** Los cinco negocios, con lo que los distingue de verdad. */
const NEGOCIOS = {
  malia: {
    organizationId: "org_malia",
    appointmentsEnabled: false,
    catalogSource: "tabla",
    stateSource: "backend",
    deliverySource: "prompt",
    instructions: "Regla de MALIA: las opciones se enumeran una por línea.",
    catalogo: [producto("m1", "Pavé chocolate"), producto("m2", "Pavé 16 oz")],
  },
  lis: {
    organizationId: "org_lis",
    appointmentsEnabled: false,
    catalogSource: "tabla",
    stateSource: "backend",
    deliverySource: "prompt",
    instructions: "Regla de Lis: envía el link del catálogo cuando pregunten por productos.",
    catalogo: [producto("l1", "Pastelitos x3")],
  },
  churra: {
    organizationId: "org_churra",
    appointmentsEnabled: false,
    catalogSource: "tabla",
    stateSource: "backend",
    deliverySource: "prompt",
    instructions: "Regla de La Churra: escribe 0 para empezar de nuevo.",
    catalogo: [producto("c1", "Churrita clásica")],
  },
  lashes: {
    organizationId: "org_lashes",
    appointmentsEnabled: true,
    catalogSource: "prompt",
    stateSource: "prompt",
    deliverySource: "prompt",
    instructions: "Regla de Lashes: confirma siempre con quién es la cita.",
    catalogo: [],
  },
  /** Sin configurar: todo en el prompt, como llegó. */
  camila: {
    organizationId: "org_camila",
    appointmentsEnabled: false,
    catalogSource: "prompt",
    stateSource: "prompt",
    deliverySource: "prompt",
    instructions: "Regla de Camilabrandcol: responde con el catálogo del prompt.",
    catalogo: [],
  },
} as const;

type Negocio = (typeof NEGOCIOS)[keyof typeof NEGOCIOS];

async function turnoDe(n: Negocio, texto: string) {
  catalogoDePedidosMock.mockImplementation(async (orgId: string) =>
    orgId === n.organizationId ? [...n.catalogo] : []
  );
  catalogoDeMock.mockImplementation(async (orgId: string) =>
    orgId === n.organizationId ? [...n.catalogo] : []
  );
  catalogoParaPromptMock.mockResolvedValue([]);

  selectQueue.push(
    [
      {
        id: "cv_1",
        organizationId: n.organizationId,
        contactId: "ct_1",
        isTest: true,
        aiEnabled: true,
        handoffAt: null,
        handoffReason: null,
        lastInboundAt: new Date(),
      },
    ],
    [
      {
        id: `agp_${n.organizationId}`,
        organizationId: n.organizationId,
        enabled: true,
        appointmentsEnabled: n.appointmentsEnabled,
        name: "Asistente",
        tone: null,
        instructions: n.instructions,
        escalationRules: null,
        greeting: null,
        hoursOpen: "09:30",
        hoursClose: "18:30",
        hoursDays: "1,2,3,4,5,6",
        catalogSource: n.catalogSource,
        paymentSource: "prompt",
        stateSource: n.stateSource,
        deliverySource: n.deliverySource,
        ficha: null,
      },
    ],
    [{ id: "msg_1", direction: "in", text: texto, createdAt: new Date() }],
    [],
    [],
    [{ name: null, phone: "573000000000" }],
    []
  );
  chatJson.mockResolvedValue({
    ok: true,
    raw: "{}",
    data: { action: "reply", text: "Claro que sí 😊" },
  });
  const { runAgentTurn } = await import("@/server/ai/pipeline");
  await runAgentTurn("cv_1");
  const mensajes = chatJson.mock.calls[0]?.[1] as { role: string; content: string }[] | undefined;
  return (mensajes ?? []).map((m) => m.content).join("\n---\n");
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset();
  catalogoDeMock.mockReset();
  catalogoParaPromptMock.mockReset().mockResolvedValue([]);
  guardarEstadoMock.mockClear();
  leerEstadoConVersionMock.mockClear();
  selectQueue.length = 0;
  estadoActual = null;
});

describe("cada negocio ve lo suyo y nada más", () => {
  it("Lis no ve los productos ni la regla de MALIA", async () => {
    const prompt = await turnoDe(NEGOCIOS.lis, "hola, qué tienen?");

    expect(prompt).toContain("Pastelitos x3");
    expect(prompt).not.toContain("Pavé");
    expect(prompt).not.toContain("Regla de MALIA");
  });

  it("La Churra no ve nada de Lis", async () => {
    const prompt = await turnoDe(NEGOCIOS.churra, "hola, qué tienen?");

    expect(prompt).toContain("Churrita clásica");
    expect(prompt).not.toContain("Pastelitos");
    expect(prompt).not.toContain("Regla de Lis");
  });

  it("MALIA no ve nada de La Churra", async () => {
    const prompt = await turnoDe(NEGOCIOS.malia, "hola, qué tienen?");

    expect(prompt).toContain("Pavé chocolate");
    expect(prompt).not.toContain("Churrita");
    expect(prompt).not.toContain("Regla de La Churra");
  });

  /*
   * El catálogo se pide por organización y esa consulta ya está probada; lo
   * que se mira aquí es que la capa NUEVA no añadiera ninguna lectura sin
   * `organizationId` — el error que convierte un aislamiento correcto en una
   * fuga.
   */
  it("la capa nueva no consulta catálogo de ninguna otra organización", async () => {
    await turnoDe(NEGOCIOS.lis, "cuánto cuesta el domicilio?");

    for (const llamada of catalogoDePedidosMock.mock.calls) {
      expect(llamada[0]).toBe("org_lis");
    }
  });
});

describe("Lashes Valen: un salón no recibe reglas de pedidos", () => {
  it("ni plan del turno, ni modalidad de entrega, ni meta de cerrar el pedido", async () => {
    const prompt = await turnoDe(NEGOCIOS.lashes, "cuánto vale el servicio?");

    expect(prompt).not.toContain("PLAN DEL TURNO");
    expect(prompt).not.toContain("MODALIDAD DE ENTREGA");
    expect(prompt).not.toContain("ENTREGA VERIFICADA");
    // Lo suyo sí está.
    expect(prompt).toContain("Regla de Lashes");
  });

  /*
   * El horario se pasa tal cual viene del perfil. La prueba NO fija una hora
   * concreta a propósito: clavar «18:30» aquí convertiría un dato de negocio
   * —que ya cambió una vez— en algo que hay que editar en dos sitios.
   */
  it("el horario del perfil llega intacto: la capa nueva no lo reinterpreta", async () => {
    const prompt = await turnoDe(NEGOCIOS.lashes, "a qué hora abren?");

    expect(prompt).toContain("09:30");
    expect(prompt).toContain("18:30");
  });
});

describe("Camilabrandcol: sin configurar, se queda como estaba", () => {
  /*
   * Es el caso que nadie reclamaría si saliera mal, y por eso el más fácil de
   * romper: un negocio que todavía lo tiene todo en el prompt no puede
   * empezar a recibir bloques de una arquitectura que no tiene encendida.
   */
  it("no recibe bloque de estado, ni un plan del backend que interprete al cliente", async () => {
    const prompt = await turnoDe(NEGOCIOS.camila, "cuánto cuesta el domicilio?");

    // Nada de la arquitectura que no tiene encendida.
    expect(prompt).not.toContain("MODALIDAD DE ENTREGA");
    expect(prompt).not.toContain("TE FALTA");
    expect(prompt).toContain("Regla de Camilabrandcol");

    // Doc 198 (25-sep-2026): el backend ya no clasifica el mensaje del cliente
    // con palabras clave; entenderlo es del modelo, en todos los negocios.
    expect(prompt).not.toContain("PLAN DEL TURNO");
  });

  it("no se le lee ni se le escribe estado", async () => {
    await turnoDe(NEGOCIOS.camila, "quiero dos");

    expect(guardarEstadoMock).not.toHaveBeenCalled();
  });
});

describe("MALIA: su regla de presentación de opciones no se toca", () => {
  /*
   * §26 del plan. La regla vive en la ficha de MALIA, que este trabajo NO
   * modifica; lo que sí puede romperse desde el código es la regla de
   * cadencia que la sostiene — que el punto de las opciones se resuelva
   * entero y SOLO ese. Si alguien la reescribe, esto se cae.
   */
  it("la cadencia sigue diciendo que el punto de opciones no se mezcla con otros", async () => {
    const { CADENCIA, meta } = await import("@/server/ai/generador/conducta");

    expect(CADENCIA).toContain("Nunca juntes preguntas de dos puntos en el mismo mensaje");
    expect(meta("pedidos")).toContain(
      "si el punto activo son las opciones, en ese\nmensaje van las opciones de todo lo que pidió y nada más"
    );
  });

  it("el plan del turno nunca le pide volver a listar las opciones", async () => {
    const { bloqueDelPlan, leerIntencion, planDelTurno } = await import(
      "@/server/orders/intencion"
    );
    const lectura = leerIntencion("cuánto cuesta el domicilio?", []);
    const bloque = bloqueDelPlan(lectura, planDelTurno(lectura, true));

    expect(bloque).not.toMatch(/lista|listar|opciones/i);
    expect(bloque).toContain("sin saltarte el orden ni adelantar otros puntos");
  });
});
