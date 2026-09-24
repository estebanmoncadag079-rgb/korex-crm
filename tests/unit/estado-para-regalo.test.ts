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
};

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
      CONTEXTO
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
