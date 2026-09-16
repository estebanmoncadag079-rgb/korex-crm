import { describe, expect, it } from "vitest";
import { puedeConfirmarCita } from "@/server/appointments/policy";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * T018 (feature 003-backend-como-autoridad) — el equivalente de
 * `policy-pedido.test.ts` (T017) para citas. Función pura, síncrona: sin
 * mocks de base de datos.
 */

const REQUISITOS: Requisito[] = [
  { id: "telefono", tipo: "telefono", etiqueta: "tu teléfono", obligatorio: true },
];

const ITEM_MANICURE = { ofrecible: { id: "srv_mani", nombre: "Manicure" }, cantidad: 1, seleccion: [], totalCents: 500000 };

describe("puedeConfirmarCita", () => {
  it("sin estadoGuardado (state_source!='backend'): no exige nada, pasa", () => {
    const v = puedeConfirmarCita({ requisitos: REQUISITOS });
    expect(v.ok).toBe(true);
  });

  it("sin servicio resuelto: rechaza", () => {
    const estado: EstadoDelPedido = { ...estadoVacio(), items: [] };
    const v = puedeConfirmarCita({ estadoGuardado: estado, requisitos: REQUISITOS });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("ningún servicio resuelto");
  });

  it("con servicio pero sin horario verificado por el backend: rechaza", () => {
    const estado: EstadoDelPedido = { ...estadoVacio(), items: [ITEM_MANICURE], reserva: null };
    const v = puedeConfirmarCita({ estadoGuardado: estado, requisitos: REQUISITOS });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("horario verificado");
  });

  it("con servicio y horario, pero falta un requisito obligatorio: rechaza y dice cuál", () => {
    const estado: EstadoDelPedido = {
      ...estadoVacio(),
      items: [ITEM_MANICURE],
      reserva: { fecha: "15/01/2026", hora: "10:00", duracionMin: 45, recursoId: null, recursoNombre: null },
      datos: {},
    };
    const v = puedeConfirmarCita({ estadoGuardado: estado, requisitos: REQUISITOS });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.motivo).toContain("telefono");
      expect(v.correccion).toContain("tu teléfono");
    }
  });

  it("sin especialista resuelto (recursoId:null) NO rechaza — es un estado válido, se resuelve al agendar", () => {
    // Mismo criterio que appointments/operaciones.ts (T009): sin preferencia
    // de especialista, `fijar_horario` deja recursoId:null a propósito —
    // no es un dato faltante, es "cualquiera de los que atienden".
    const estado: EstadoDelPedido = {
      ...estadoVacio(),
      items: [ITEM_MANICURE],
      reserva: { fecha: "15/01/2026", hora: "10:00", duracionMin: 45, recursoId: null, recursoNombre: null },
      datos: { telefono: "3001234567" },
    };
    const v = puedeConfirmarCita({ estadoGuardado: estado, requisitos: REQUISITOS });
    expect(v.ok).toBe(true);
  });

  it("hoja completa: pasa", () => {
    const estado: EstadoDelPedido = {
      ...estadoVacio(),
      items: [ITEM_MANICURE],
      reserva: { fecha: "15/01/2026", hora: "10:00", duracionMin: 45, recursoId: "staff_val", recursoNombre: "Valentina" },
      datos: { telefono: "3001234567" },
    };
    const v = puedeConfirmarCita({ estadoGuardado: estado, requisitos: REQUISITOS });
    expect(v.ok).toBe(true);
  });
});
