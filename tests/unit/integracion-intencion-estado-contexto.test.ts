import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Los diez casos A–J del plan, cada uno de punta a punta sobre `runAgentTurn`.
 *
 * Son los incidentes reales, no ejemplos inventados: A y B salen de MALIA
 * (conv cv_zgm286k69bz1hmprf87a), F del mismo sitio —`estado.datos` acabó con
 * `{"nombre":"Luisa Duque"}` sin que Luisa lo dijera—, y H de Lis, cuyo
 * prompt decía literalmente «undefined: ya está».
 *
 * Cada caso mira las cuatro cosas que el plan pide mirar, no solo el texto
 * que devuelve el modelo: el prompt que recibió, el plan que se le puso
 * delante, la acción que propuso y el ESTADO que quedó guardado. El texto del
 * modelo aquí es un mock — lo que se prueba es lo que el servidor le da y lo
 * que el servidor le acepta.
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
  catalogoParaPrompt: vi.fn().mockResolvedValue([]),
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

/** La fila de `conversation_state`, simulada — sobrevive de un turno a otro. */
let estadoActual: Record<string, unknown> | null = null;
let versionActual = 0;
const guardados: Record<string, unknown>[] = [];
let borrados = 0;

const guardarEstadoMock = vi.fn(async (entrada: { estado: Record<string, unknown> }) => {
  guardados.push(entrada.estado);
  estadoActual = entrada.estado;
  versionActual += 1;
  return { ok: true };
});
const leerEstadoConVersionMock = vi.fn(async () =>
  estadoActual ? { estado: estadoActual, version: versionActual } : null
);
const borrarEstadoMock = vi.fn(async () => {
  borrados += 1;
  estadoActual = null;
  versionActual = 0;
});

vi.mock("@/server/orders/estado", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/orders/estado")>();
  return {
    ...real,
    guardarEstado: (...a: unknown[]) =>
      guardarEstadoMock(...(a as [{ estado: Record<string, unknown> }])),
    leerEstadoConVersion: () => leerEstadoConVersionMock(),
    borrarEstado: () => borrarEstadoMock(),
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

type Producto = {
  id: string;
  nombre: string;
  categoria: string | null;
  precioCents: number | null;
  descripcion: string | null;
  grupos: unknown[];
};

const p = (id: string, nombre: string, precioCents: number | null = 1000000): Producto => ({
  id,
  nombre,
  categoria: null,
  precioCents,
  descripcion: null,
  grupos: [],
});

const PAVE = p("p1", "Pavé chocolate");

/*
 * Requisitos de cierre reales. Sin esto, F pasaría por la razón EQUIVOCADA:
 * un `fijar_dato` sobre un requisito que la ficha no declara lo tumba la
 * Compuerta 2, y el test diría verde sin haber ejercitado nunca la Compuerta
 * 4 — la que de verdad protege el nombre del perfil de WhatsApp.
 */
const FICHA_CON_REQUISITOS = JSON.stringify({
  cierre: {
    requisitos: [
      { id: "nombre", tipo: "texto", etiqueta: "tu nombre", obligatorio: true },
      {
        id: "direccion",
        tipo: "direccion",
        etiqueta: "la dirección de entrega",
        obligatorio: true,
      },
    ],
  },
});

function conversacion() {
  return {
    id: "cv_1",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function perfil(extra: Record<string, unknown> = {}) {
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
    ficha: FICHA_CON_REQUISITOS,
    ...extra,
  };
}

type Opciones = {
  perfil?: Record<string, unknown>;
  /** El nombre que WhatsApp trae del perfil del contacto. */
  contacto?: string | null;
  /** Lo que el modelo devuelve en su primera (y normalmente única) llamada. */
  respuesta?: Record<string, unknown>;
};

/** Un turno completo. Devuelve el prompt que recibió el modelo y su acción. */
async function turno(texto: string, opts: Opciones = {}) {
  selectQueue.push(
    [conversacion()],
    [perfil(opts.perfil)],
    [{ id: `msg_${Math.random()}`, direction: "in", text: texto, createdAt: new Date() }],
    [],
    [],
    [{ name: opts.contacto ?? null, phone: "573000000000" }],
    []
  );
  chatJson.mockResolvedValue({
    ok: true,
    raw: "{}",
    data: opts.respuesta ?? { action: "reply", text: "Claro que sí 😊" },
  });
  const { runAgentTurn } = await import("@/server/ai/pipeline");
  const accion = await runAgentTurn("cv_1");
  const mensajes = chatJson.mock.calls[0]?.[1] as { role: string; content: string }[] | undefined;
  return {
    accion,
    prompt: (mensajes ?? []).map((m) => m.content).join("\n---\n"),
  };
}

/** Un estado de pedido ya guardado, como si viniera de un turno anterior. */
function estadoConPave(extra: Record<string, unknown> = {}) {
  return {
    schema_version: 5,
    items: [
      {
        ofrecible: { id: "p1", nombre: "Pavé chocolate" },
        cantidad: 1,
        seleccion: [],
        gruposDeclinados: [],
      },
    ],
    datos: {},
    reserva: null,
    modalidadDeEntrega: null,
    entrega: null,
    totalCents: null,
    paso: "eligiendo",
    confirmado: false,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  chatJson.mockReset();
  catalogoDePedidosMock.mockReset().mockResolvedValue([PAVE]);
  catalogoDeMock.mockReset().mockResolvedValue([PAVE]);
  guardarEstadoMock.mockClear();
  leerEstadoConVersionMock.mockClear();
  borrarEstadoMock.mockClear();
  selectQueue.length = 0;
  guardados.length = 0;
  estadoActual = null;
  versionActual = 0;
  borrados = 0;
});

describe("A — pregunta por el domicilio con un pedido abierto", () => {
  it("el backend no le dice al modelo qué preguntó el cliente; el estado del pedido sí llega", async () => {
    // Doc 198 (25-sep-2026): entender la pregunta es del modelo. El backend
    // solo aporta datos estructurados: el pedido en curso.
    estadoActual = estadoConPave();
    versionActual = 1;

    const { prompt } = await turno("cuánto cuesta el domicilio?");

    expect(prompt).not.toContain("PLAN DEL TURNO");
    expect(prompt).toContain("PEDIDO EN CURSO");
  });
});

describe("B — la modalidad ya elegida, sin tarifa verificada", () => {
  /*
   * Es el caso de Lis, La Churra y Lashes: con `delivery_source='prompt'`
   * `estado.entrega` es SIEMPRE null, así que mientras `comoTexto()` solo
   * enseñaba `entrega`, la modalidad elegida era invisible y el bot volvía a
   * preguntar «¿cómo lo recibes?» veinticuatro segundos después.
   */
  it("el modelo ve la modalidad y se le dice que la tarifa no está verificada", async () => {
    estadoActual = estadoConPave({ modalidadDeEntrega: "domicilio", entrega: null });
    versionActual = 1;

    const { prompt } = await turno("listo");

    expect(prompt).toContain("MODALIDAD DE ENTREGA: domicilio");
    expect(prompt).toContain("no se la vuelvas a preguntar");
    expect(prompt).toContain("no la inventes");
    // Y NO se inventa una tarifa que nadie verificó.
    expect(prompt).not.toContain("ENTREGA VERIFICADA");
  });
});

describe("C — la modalidad elegida Y la tarifa ya verificada", () => {
  it("el modelo ve las dos cosas, y separadas", async () => {
    estadoActual = estadoConPave({
      modalidadDeEntrega: "domicilio",
      entrega: { tipo: "domicilio", zonaNombre: "Laureles", feeCents: 700000 },
    });
    versionActual = 1;

    const { prompt } = await turno("listo");

    expect(prompt).toContain("MODALIDAD DE ENTREGA: domicilio");
    expect(prompt).toContain("ENTREGA VERIFICADA");
    expect(prompt).toContain("Laureles");
    // Con tarifa real ya no hay nada que advertir.
    expect(prompt).not.toContain("no la inventes");
  });
});

describe("D — «es para un regalo»", () => {
  it("queda guardado como hecho del pedido, no como intención", async () => {
    estadoActual = estadoConPave();
    versionActual = 1;

    await turno("es para un regalo", {
      respuesta: {
        action: "reply",
        text: "¡Qué lindo detalle! 🎁 ¿Con cuál salsa se la preparo?",
        operaciones: [{ tipo: "marcar_regalo", esRegalo: true }],
      },
    });

    expect(guardados).toHaveLength(1);
    expect(guardados[0]!.paraRegalo).toBe(true);
    // Y no se coló como si fuera un producto ni un dato de cierre.
    expect((guardados[0]!.items as unknown[])).toHaveLength(1);
  });

  it("sobrevive al turno siguiente", async () => {
    estadoActual = estadoConPave({ paraRegalo: true });
    versionActual = 1;

    const { prompt } = await turno("y serían dos");

    expect(prompt).toContain("es para regalo");
  });
});

describe("E — el reinicio", () => {
  it("«0» borra el pedido entero, regalo y modalidad incluidos", async () => {
    estadoActual = estadoConPave({ paraRegalo: true, modalidadDeEntrega: "domicilio" });
    versionActual = 1;

    await turno("0");

    expect(borrados).toBe(1);
    expect(estadoActual).toBeNull();
  });
});

describe("F — el nombre del perfil de WhatsApp no es el nombre del cliente", () => {
  /*
   * El caso real: `estado.datos = {"nombre":"Luisa Duque"}` en una
   * conversación donde Luisa nunca escribió su nombre. El prompt le ordenaba
   * al modelo usar el del perfil «para completar el resumen del pedido».
   *
   * Dos correcciones, y esta prueba mira la segunda: el prompt ya no lo pide,
   * pero además el backend lo RECHAZA. Un guardarraíl que depende de que el
   * modelo obedezca no es un guardarraíl.
   */
  it("el backend rechaza fijarlo aunque el modelo lo proponga", async () => {
    estadoActual = estadoConPave();
    versionActual = 1;

    await turno("quiero uno para un amigo secreto", {
      contacto: "Juan Pérez",
      respuesta: {
        action: "reply",
        text: "¡Listo Juan!",
        operaciones: [{ tipo: "fijar_dato", requisitoId: "nombre", valor: "Juan Pérez" }],
      },
    });

    const ultimo = guardados[guardados.length - 1] as
      | { datos: Record<string, string | null> }
      | undefined;
    expect(ultimo?.datos?.nombre ?? null).toBeNull();
  });
});

describe("G — el nombre que el cliente SÍ escribió", () => {
  it("se persiste sin estorbo: el guardarraíl no es un muro", async () => {
    estadoActual = estadoConPave();
    versionActual = 1;

    await turno("Soy Juan Pérez", {
      contacto: "Juan Pérez",
      respuesta: {
        action: "reply",
        text: "¡Mucho gusto, Juan!",
        operaciones: [{ tipo: "fijar_dato", requisitoId: "nombre", valor: "Juan Pérez" }],
      },
    });

    const ultimo = guardados[guardados.length - 1] as
      | { datos: Record<string, string | null> }
      | undefined;
    expect(ultimo?.datos?.nombre).toBe("Juan Pérez");
  });
});

describe("H — el «undefined» de Lis", () => {
  it("un requisito sin etiqueta no llega nunca al prompt como «undefined»", async () => {
    estadoActual = estadoConPave({ datos: { direccion: "Cra 1 # 2-3" } });
    versionActual = 1;

    const { prompt } = await turno("listo", {
      perfil: {
        ficha: JSON.stringify({
          cierre: { requisitos: [{ id: "direccion", obligatorio: true }] },
        }),
      },
    });

    expect(prompt).not.toContain("undefined");
    expect(prompt).toContain("direccion");
  });
});

describe("I — la consulta intermedia no dispara el muro de preguntas", () => {
  /*
   * Lo que el cliente vio en MALIA fue un mensaje con siete preguntas de
   * siete puntos distintos. El arreglo no es otra frase en el prompt: es que
   * el plan diga explícitamente dónde continuar, y que CADENCIA —que ya
   * manda sobre el orden— siga estando.
   */
  it("la regla de cadencia llega entera al modelo", async () => {
    estadoActual = estadoConPave();
    versionActual = 1;

    const { CADENCIA } = await import("@/server/ai/generador/conducta");
    const { prompt } = await turno("¿cuánto cuesta el domicilio?", {
      perfil: { instructions: CADENCIA },
    });

    // La cadencia sigue entera (el "plan del turno" del backend se retiró, doc 198).
    expect(prompt).toContain("Nunca juntes preguntas de dos puntos en el mismo mensaje");
  });
});

describe("J — la corrección 2(a) sigue en pie a través del pipeline", () => {
  /*
   * Se mira el [SISTEMA] del segundo turno del modelo, no el prompt entero:
   * el bloque de catálogo lista legítimamente los 8 oz y los 16 oz — eso es
   * la carta. Lo que no puede pasar es que el servidor le CONFIRME un 7 oz
   * que no existe.
   */
  it("«2 pavés de 7 oz» cuando solo hay 8 oz y 16 oz: el servidor no lo confirma", async () => {
    const soloOchoYDieciseis = [p("a", "Pavé 8 oz"), p("b", "Pavé 16 oz")];
    catalogoDePedidosMock.mockResolvedValue(soloOchoYDieciseis);
    catalogoDeMock.mockResolvedValue(soloOchoYDieciseis);

    chatJson.mockReset();
    selectQueue.push(
      [conversacion()],
      [perfil({ consultasVerificadasEnabled: true })],
      [{ id: "msg_j", direction: "in", text: "me das 2 pavés de 7 oz", createdAt: new Date() }],
      [],
      [],
      [{ name: null, phone: "573000000000" }],
      []
    );
    chatJson
      .mockResolvedValueOnce({
        ok: true,
        raw: "{}",
        data: { action: "consultar_producto", consulta: "pavé de 7 oz" },
      })
      .mockResolvedValue({
        ok: true,
        raw: "{}",
        data: { action: "reply", text: "Ese tamaño no lo manejamos." },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    const segunda = chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const sistema = segunda.find((m) => m.content.includes("[SISTEMA]"));
    expect(sistema?.content).toMatch(/No encontré/);
    expect(sistema?.content).not.toMatch(/Pavé 8 oz/);
  });

  it("«me agregas 2 pavés más de 16 oz»: el 2 es cantidad, no tamaño", async () => {
    const { buscarProductos } = await import("@/server/catalog/buscar");
    const catalogo = [p("a", "Pavé 8 oz"), p("b", "Pavé 16 oz")] as never;

    expect(buscarProductos(catalogo, "me agregas 2 pavés más de 16 oz")).toMatchObject({
      status: "found",
    });
    expect(buscarProductos(catalogo, "2 pavés de 7 oz")).toMatchObject({ status: "not_found" });
  });
});

/**
 * K/L/M — la última auditoría, de punta a punta sobre `runAgentTurn`. Ya no es
 * "la compuerta rechaza": es que el FLUJO COMPLETO respeta la procedencia.
 */
describe("K — el bot pedía el nombre y el cliente responde suelto", () => {
  it("se guarda con procedencia del cliente (contexto de la pregunta previa)", async () => {
    estadoActual = estadoConPave(); // datos vacíos → el nombre venía pendiente
    versionActual = 1;

    await turno("Ana Gómez", {
      contacto: "Luisa Duque",
      respuesta: {
        action: "reply",
        text: "¡Listo, Ana! 😊",
        operaciones: [{ tipo: "fijar_dato", requisitoId: "nombre", valor: "Ana Gómez" }],
      },
    });

    const ultimo = guardados[guardados.length - 1] as
      | { datos: Record<string, string | null>; procedenciaDelNombre?: string }
      | undefined;
    expect(ultimo?.datos?.nombre).toBe("Ana Gómez");
    expect(ultimo?.procedenciaDelNombre).toBe("cliente");
  });
});

describe("L — nombre heredado sin procedencia", () => {
  it("el prompt lo sigue pidiendo: un valor sin procedencia no está confirmado", async () => {
    // Estado heredado: tiene el valor, no la procedencia.
    estadoActual = estadoConPave({ datos: { nombre: "Juan Pérez" } });
    versionActual = 1;

    const { prompt } = await turno("hola");

    // La ficha de este arnés etiqueta el requisito como "tu nombre".
    const falta = prompt.split("TE FALTA")[1] ?? "";
    expect(falta).toContain("tu nombre");
  });
});

describe("M — 'no es para regalo' con el modelo proponiendo regalo", () => {
  it("la negación no marca regalo: la operación se rechaza", async () => {
    estadoActual = estadoConPave();
    versionActual = 1;

    await turno("no es para regalo", {
      respuesta: {
        action: "reply",
        text: "De acuerdo 🙂",
        operaciones: [{ tipo: "marcar_regalo", esRegalo: true }],
      },
    });

    const ultimo = guardados[guardados.length - 1] as { paraRegalo?: boolean } | undefined;
    expect(ultimo?.paraRegalo ?? false).toBe(false);
  });
});

/**
 * Un SEGUNDO pedido en la misma conversación no se apila sobre el primero.
 *
 * El caso de Ricardo Paz (MALIA): pidió, pagó, y volvió a pedir en la misma
 * conversación. El segundo pedido se SUMABA al primero (9 ítems, $120.000) y el
 * guardarraíl financiero derivaba a una persona. Ahora, una operación nueva
 * sobre un pedido YA confirmado reinicia el pedido conservando al cliente.
 */
describe("segundo pedido: no se acumula sobre uno ya confirmado", () => {
  it("un agregar_item sobre un pedido confirmado empieza limpio (conservando datos)", async () => {
    estadoActual = estadoConPave({
      confirmado: true,
      paso: "confirmado",
      datos: { nombre: "Ricardo Paz", telefono: "573192244836" },
      procedenciaDelNombre: "cliente",
    });
    versionActual = 5;

    await turno("quiero otro pavé de chocolate", {
      respuesta: {
        action: "reply",
        text: "¡Listo! 🍰",
        operaciones: [{ tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }],
      },
    });

    const ultimo = guardados[guardados.length - 1] as
      | { items: unknown[]; confirmado: boolean; datos: Record<string, string | null> }
      | undefined;
    // Un solo ítem (el nuevo), NO dos: el pedido anterior no se arrastró.
    expect(ultimo?.items).toHaveLength(1);
    expect(ultimo?.confirmado).toBe(false);
    // El cliente se conserva: no se le vuelve a pedir nombre y teléfono.
    expect(ultimo?.datos?.nombre).toBe("Ricardo Paz");
    expect(ultimo?.datos?.telefono).toBe("573192244836");
  });
});
