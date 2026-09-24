import { describe, expect, it } from "vitest";
import { aplicarOperacion, type ContextoOperaciones } from "@/server/orders/operaciones";
import { aplanar, estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import { comoTexto } from "@/server/orders/extraer";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * "Es para un regalo" necesitaba un sitio donde vivir.
 *
 * `CADENCIA` le pide al agente conservar lo que el cliente adelanta, pero el
 * estado no tenía ningún campo para ello: `items`, `datos`, `reserva`,
 * `modalidadDeEntrega`, `entrega`, `totalCents`, `paso`, `confirmado` y nada
 * más. Un "es para un detalle" solo sobrevivía en el historial del chat.
 *
 * Caso real (MALIA, 24-sep-2026, conv cv_zgm286k69bz1hmprf87a): la clienta
 * dijo *"es para un endulce de amigos secretos"* y el estado guardado quedó en
 * `datos: {"nombre":"Luisa Duque"}` — del regalo, ni rastro. Funcionó porque
 * el modelo lo leyó del historial, y el historial se trunca.
 *
 * 🛑 **El backend no infiere.** Este campo solo se escribe cuando el modelo
 * propone la operación tras oírselo al cliente. "Lo necesito para el sábado"
 * no es un regalo, y aquí no hay ninguna heurística que lo convierta en uno.
 *
 * 🛑 **No es un requisito de cierre.** Nunca aparece en `TE FALTA` ni bloquea
 * `notify_order`: es contexto para conversar, no un dato que haya que reunir.
 */
const CONTEXTO: ContextoOperaciones = {
  organizationId: "org_1",
  catalogo: [],
  requisitos: [],
  modalidadesOfrecidas: ["domicilio", "recogida"],
  // La evidencia del regalo es lo que el cliente dijo EN ESTE turno, no lo que
  // dijo en un pedido anterior (Bloqueador 2, 2.ª auditoría).
  mensajeDelTurno: "es para un regalo",
};

/** Fija lo que el cliente dijo EN ESTE turno (la evidencia aplicable). */
const conTurno = (mensajeDelTurno: string): ContextoOperaciones => ({
  ...CONTEXTO,
  mensajeDelTurno,
});

/** Un turno con evidencia vieja en el historial pero NO en el mensaje actual. */
const conHistorialViejo = (
  mensajeDelTurno: string,
  historial: string[]
): ContextoOperaciones => ({
  ...CONTEXTO,
  mensajeDelTurno,
  dichoPorElCliente: historial,
});

const conPedido = (extra: Partial<EstadoDelPedido> = {}): EstadoDelPedido => ({
  ...estadoVacio(),
  items: [
    {
      ofrecible: { id: "p1", nombre: "Cremoso 12 oz" },
      cantidad: 1,
      seleccion: [],
      gruposDeclinados: [],
      totalCents: 1800000,
    },
  ],
  totalCents: 1800000,
  ...extra,
});

describe("paraRegalo: un hecho que el cliente aporta, con contrato propio", () => {
  it("el modelo lo propone y el backend lo guarda", () => {
    const r = aplicarOperacion(conPedido(), { tipo: "marcar_regalo", esRegalo: true }, CONTEXTO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estado.paraRegalo).toBe(true);
  });

  it("y se puede desmarcar si el cliente se corrige", () => {
    const r = aplicarOperacion(
      conPedido({ paraRegalo: true }),
      { tipo: "marcar_regalo", esRegalo: false },
      conTurno("no, finalmente es para mí")
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estado.paraRegalo).toBe(false);
  });

  it("sobrevive al turno siguiente: está en el estado, no en el historial", () => {
    const primero = aplicarOperacion(conPedido(), { tipo: "marcar_regalo", esRegalo: true }, CONTEXTO);
    expect(primero.ok).toBe(true);
    if (!primero.ok) return;
    // Turno 2: el cliente cambia la cantidad; el regalo sigue ahí.
    const segundo = aplicarOperacion(
      primero.estado,
      { tipo: "cambiar_cantidad", ofrecible: "Cremoso 12 oz", cantidad: 2 },
      CONTEXTO
    );
    expect(segundo.ok).toBe(true);
    if (segundo.ok) expect(segundo.estado.paraRegalo).toBe(true);
  });

  it("el reinicio lo borra, como todo lo demás del pedido", () => {
    // `estadoVacio()` es lo que deja `borrarEstado` en el reinicio por palabra
    // clave. No debe arrastrar el regalo del pedido anterior.
    expect(estadoVacio().paraRegalo).toBeUndefined();
  });
});

/**
 * Bloqueador 2 de la auditoría: `marcar_regalo` NO puede escribir el hecho solo
 * porque el modelo lo proponga — el backend es la autoridad. Solo se acepta con
 * evidencia de que el cliente lo dijo, y solo se desmarca con una corrección
 * compatible. Sin evidencia, se rechaza: es preferible preguntar a inventar.
 */
describe("paraRegalo: el backend exige evidencia, no la palabra del modelo", () => {
  const marcar = (esRegalo: boolean) => ({ tipo: "marcar_regalo", esRegalo }) as const;

  it('"es para un regalo" es evidencia suficiente', () => {
    expect(aplicarOperacion(conPedido(), marcar(true), conTurno("es para un regalo")).ok).toBe(true);
  });

  it('"es para un detalle" también', () => {
    expect(aplicarOperacion(conPedido(), marcar(true), conTurno("es para un detalle")).ok).toBe(true);
  });

  it('"es para un amigo secreto" también', () => {
    expect(
      aplicarOperacion(conPedido(), marcar(true), conTurno("es para un amigo secreto")).ok
    ).toBe(true);
  });

  it('"lo necesito para el sábado" NO es evidencia de regalo', () => {
    const r = aplicarOperacion(conPedido(), marcar(true), conTurno("lo necesito para el sábado"));
    expect(r.ok).toBe(false);
  });

  it('"es para mí" NO convierte el pedido en regalo', () => {
    expect(aplicarOperacion(conPedido(), marcar(true), conTurno("es para mí")).ok).toBe(false);
  });

  it("el modelo propone true sin que el cliente lo diga → se rechaza", () => {
    const r = aplicarOperacion(conPedido(), marcar(true), conTurno("quiero dos cremosos"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.correccion).toMatch(/regalo/i);
  });

  it("desmarcar sin ninguna corrección del cliente → se rechaza", () => {
    // El cliente dijo que era regalo y nunca se retractó: el modelo no puede
    // borrarlo por su cuenta.
    const r = aplicarOperacion(
      conPedido({ paraRegalo: true }),
      marcar(false),
      conTurno("es para un regalo")
    );
    expect(r.ok).toBe(false);
  });

  it('"finalmente no es para regalo" SÍ desmarca', () => {
    const r = aplicarOperacion(
      conPedido({ paraRegalo: true }),
      marcar(false),
      conTurno("finalmente no es para regalo")
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estado.paraRegalo).toBe(false);
  });

  it("EL DETECTOR DETECTA: mismo marcar(true), la evidencia decide", () => {
    const con = aplicarOperacion(conPedido(), marcar(true), conTurno("es un regalo para mi mamá"));
    const sin = aplicarOperacion(conPedido(), marcar(true), conTurno("me lo llevo el viernes"));
    expect(con.ok).toBe(true);
    expect(sin.ok).toBe(false);
  });

  /*
   * 2.ª auditoría, casos negativos duros. La evidencia tiene que ser del TURNO
   * actual y de verdad hablar de un regalo — no una palabra suelta ni una frase
   * de un pedido anterior que quedó en el historial.
   */
  it('"torta sorpresa" NO marca regalo: "sorpresa" en el nombre de un producto no es evidencia', () => {
    const r = aplicarOperacion(conPedido(), marcar(true), conTurno("quiero una torta sorpresa"));
    expect(r.ok).toBe(false);
  });

  it('"es para mi consumo" NO marca regalo', () => {
    expect(aplicarOperacion(conPedido(), marcar(true), conTurno("es para mi consumo")).ok).toBe(false);
  });

  it("evidencia de un pedido anterior (en el historial, no en el mensaje del turno) NO se reutiliza", () => {
    // El cliente dijo "es para un regalo" en un pedido pasado; en ESTE turno
    // solo pide más cantidad. No se puede marcar regalo por lo viejo.
    const r = aplicarOperacion(
      conPedido(),
      marcar(true),
      conHistorialViejo("y serían dos", ["es para un regalo", "y serían dos"])
    );
    expect(r.ok).toBe(false);
  });

  /*
   * Última auditoría: una MISMA frase no puede ser evidencia positiva y
   * negativa a la vez. "no es para regalo" contiene "regalo", pero es una
   * negación — para marcar(true) hace falta evidencia positiva inequívoca.
   */
  it('"no es para regalo" con marcar(true) → RECHAZADO (la negación no es evidencia positiva)', () => {
    const r = aplicarOperacion(conPedido(), marcar(true), conTurno("no es para regalo"));
    expect(r.ok).toBe(false);
  });

  it('"no es para regalo" con marcar(false) → aceptado (es una corrección válida)', () => {
    const r = aplicarOperacion(conPedido({ paraRegalo: true }), marcar(false), conTurno("no es para regalo"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estado.paraRegalo).toBe(false);
  });

  it("EL DETECTOR DETECTA (compatibilidad): misma frase, true rechaza / false acepta", () => {
    const verdad = aplicarOperacion(conPedido(), marcar(true), conTurno("no es para regalo"));
    const falso = aplicarOperacion(conPedido({ paraRegalo: true }), marcar(false), conTurno("no es para regalo"));
    expect(verdad.ok).toBe(false);
    expect(falso.ok).toBe(true);
  });

  it("EL DETECTOR DETECTA (scope): misma frase de regalo, en el turno acepta / en el historial no", () => {
    const enElTurno = aplicarOperacion(conPedido(), marcar(true), conTurno("es para un regalo"));
    const soloEnElHistorial = aplicarOperacion(
      conPedido(),
      marcar(true),
      conHistorialViejo("dos por favor", ["es para un regalo", "dos por favor"])
    );
    expect(enElTurno.ok).toBe(true);
    expect(soloEnElHistorial.ok).toBe(false);
  });
});

describe("paraRegalo: cómo lo ve el modelo", () => {
  const REQS: Requisito[] = [
    { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
  ];

  it("se le dice como CONTEXTO, no como un dato pendiente", () => {
    const texto = comoTexto(conPedido({ paraRegalo: true }), [], []);
    expect(texto).toContain("CONTEXTO DEL PEDIDO: es para regalo");
  });

  it("NUNCA aparece en TE FALTA", () => {
    const texto = comoTexto(conPedido({ paraRegalo: true }), [], REQS);
    const falta = texto.split("TE FALTA")[1] ?? "";
    expect(falta).not.toMatch(/regalo/i);
  });

  it("no bloquea el cierre: con todo lo demás resuelto, sigue diciendo que no falta nada", () => {
    const texto = comoTexto(
      conPedido({ paraRegalo: true, datos: { nombre: "Nicole" } }),
      [],
      REQS
    );
    expect(texto).toContain("No falta nada");
  });

  it("si NO es regalo, no se dice nada: el bloque no se ensucia", () => {
    expect(comoTexto(conPedido({ paraRegalo: false }), [], [])).not.toMatch(/regalo/i);
    expect(comoTexto(conPedido(), [], [])).not.toMatch(/regalo/i);
  });

  it("es observable en el registro de cambios", () => {
    expect(aplanar(conPedido({ paraRegalo: true }))).toMatchObject({ paraRegalo: true });
    expect(aplanar(conPedido())).toMatchObject({ paraRegalo: null });
  });
});
