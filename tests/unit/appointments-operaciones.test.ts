import { beforeEach, describe, expect, it, vi } from "vitest";
import { aplicarOperacion, aplicarOperaciones, type Operacion, type ContextoOperaciones } from "@/server/appointments/operaciones";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import type { ServiceRow, BusinessHours } from "@/server/appointments/logic";
import type { StaffRow } from "@/server/appointments/queries";
import type { Requisito } from "@/server/ai/generador/ficha";
import { horarioSemanalDesdeLegacy } from "@/server/horario";

/**
 * T011 — feature 003-backend-como-autoridad. Sin LLM y sin base real:
 * `resolverEspecialistaMultiple`/`disponibilidadRealMultiple` consultan la
 * base (`appointments/queries.ts`), así que se mockean — mismo patrón que ya
 * usa `pipeline-especialista-verificada.test.ts` para este mismo módulo.
 * `buscarServicio`/`normalizarFecha`/`esFechaValida` (`./logic`) son puras: se
 * usan reales, sin mock.
 */
const resolverEspecialistaMultiple = vi.fn();
const disponibilidadRealMultiple = vi.fn();
vi.mock("@/server/appointments/queries", () => ({
  resolverEspecialistaMultiple: (...a: unknown[]) => resolverEspecialistaMultiple(...a),
  disponibilidadRealMultiple: (...a: unknown[]) => disponibilidadRealMultiple(...a),
}));

const MANICURE: ServiceRow = { id: "srv_mani", name: "Manicure", category: null, priceCents: 500000, durationMin: 45 };
const PEDICURE: ServiceRow = { id: "srv_pedi", name: "Pedicure", category: null, priceCents: 600000, durationMin: 60 };
const SERVICIOS = [MANICURE, PEDICURE];

const VALENTINA: StaffRow = { id: "staff_val", name: "Valentina" };
const CAMILA: StaffRow = { id: "staff_cam", name: "Camila" };
const STAFF = [VALENTINA, CAMILA];

// Abierto todos los días a propósito: lo que este archivo prueba es
// `aplicarOperacion`/`aplicarOperaciones`, no `esFechaValida` (función pura,
// ya existente, sin cambios) — abrir siempre evita que la fecha elegida para
// cada test dependa de en qué día de la semana cae.
const HOURS: BusinessHours = horarioSemanalDesdeLegacy({ abre: "09:00", cierra: "18:00", dias: "1,2,3,4,5,6,7" });
const AHORA = new Date("2026-01-01T15:00:00.000Z");
const FECHA_FUTURA = "15/01/2026";

const REQUISITOS: Requisito[] = [{ id: "telefono", tipo: "telefono", etiqueta: "tu teléfono", obligatorio: true }];

function contexto(overrides?: Partial<ContextoOperaciones>): ContextoOperaciones {
  return {
    organizationId: "org_test",
    servicios: SERVICIOS,
    staff: STAFF,
    requisitos: REQUISITOS,
    hours: HOURS,
    now: AHORA,
    ...overrides,
  };
}

/** Aplica una operación y falla el test (con el motivo del rechazo) si no pasó. */
async function aplicarOk(estado: EstadoDelPedido, operacion: Operacion, ctx = contexto()): Promise<EstadoDelPedido> {
  const r = await aplicarOperacion(estado, operacion, ctx);
  if (!r.ok) throw new Error(`se esperaba éxito, rechazó: ${r.motivo}`);
  return r.estado;
}

beforeEach(() => {
  resolverEspecialistaMultiple.mockReset();
  disponibilidadRealMultiple.mockReset();
});

describe("aplicarOperacion — citas", () => {
  describe("fijar_servicio", () => {
    it("resuelve el nombre contra el catálogo real de servicios y agrega la línea", async () => {
      const r = await aplicarOperacion(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.items).toHaveLength(1);
      expect(r.estado.items[0]!.ofrecible).toEqual({ id: "srv_mani", nombre: "Manicure" });
      expect(r.estado.items[0]!.totalCents).toBe(500000);
    });

    it("Compuerta 2: un nombre que no resuelve contra el catálogo rechaza", async () => {
      const r = await aplicarOperacion(estadoVacio(), { tipo: "fijar_servicio", servicio: "Corte de cabello" }, contexto());
      expect(r.ok).toBe(false);
      expect(resolverEspecialistaMultiple).not.toHaveBeenCalled();
    });

    it("una visita de varios servicios agrega una línea por cada uno (manos y pies)", async () => {
      const conManicure = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      const conAmbos = await aplicarOk(conManicure, { tipo: "fijar_servicio", servicio: "Pedicure" });
      expect(conAmbos.items.map((i) => i.ofrecible.nombre)).toEqual(["Manicure", "Pedicure"]);
    });
  });

  describe("fijar_especialista", () => {
    it("rechaza si todavía no se fijó ningún servicio (no hay contra qué verificar)", async () => {
      const r = await aplicarOperacion(estadoVacio(), { tipo: "fijar_especialista", especialista: "Valentina" }, contexto());
      expect(r.ok).toBe(false);
      expect(resolverEspecialistaMultiple).not.toHaveBeenCalled();
    });

    it("resuelve el nombre y guarda el id + nombre canónico en reserva — nunca el id crudo al modelo", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "staff_val" });

      const r = await aplicarOperacion(conServicio, { tipo: "fijar_especialista", especialista: "Valentina" }, contexto());

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(resolverEspecialistaMultiple).toHaveBeenCalledWith("org_test", ["srv_mani"], "Valentina");
      expect(r.estado.reserva).toEqual({ fecha: null, hora: null, duracionMin: null, recursoId: "staff_val", recursoNombre: "Valentina" });
    });

    it("si nadie atiende esa combinación, rechaza con las opciones reales", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      resolverEspecialistaMultiple.mockResolvedValue({ ok: false, opciones: ["Camila"] });

      const r = await aplicarOperacion(conServicio, { tipo: "fijar_especialista", especialista: "Valentina" }, contexto());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.correccion).toContain("Camila");
    });

    it("si nadie atiende esa combinación de servicios en absoluto, rechaza sin opciones", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      resolverEspecialistaMultiple.mockResolvedValue({ ok: false, opciones: [] });

      const r = await aplicarOperacion(conServicio, { tipo: "fijar_especialista", especialista: "Valentina" }, contexto());
      expect(r.ok).toBe(false);
    });

    it("si el id resuelto no aparece en el roster del contexto, rechaza en vez de inventar un nombre", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "staff_desconocido" });

      const r = await aplicarOperacion(conServicio, { tipo: "fijar_especialista", especialista: "Valentina" }, contexto());
      expect(r.ok).toBe(false);
    });
  });

  describe("fijar_horario", () => {
    it("rechaza si todavía no se fijó ningún servicio", async () => {
      const r = await aplicarOperacion(estadoVacio(), { tipo: "fijar_horario", fecha: FECHA_FUTURA, hora: "10:00" }, contexto());
      expect(r.ok).toBe(false);
      expect(disponibilidadRealMultiple).not.toHaveBeenCalled();
    });

    it("una fecha inválida rechaza sin siquiera consultar disponibilidad", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      const r = await aplicarOperacion(conServicio, { tipo: "fijar_horario", fecha: "no-es-una-fecha", hora: "10:00" }, contexto());
      expect(r.ok).toBe(false);
      expect(disponibilidadRealMultiple).not.toHaveBeenCalled();
    });

    it("re-verifica contra disponibilidadRealMultiple: si la hora ya no está libre, rechaza con las horas reales", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      disponibilidadRealMultiple.mockResolvedValue({ "11:00": ["staff_val"] });

      const r = await aplicarOperacion(conServicio, { tipo: "fijar_horario", fecha: FECHA_FUTURA, hora: "10:00" }, contexto());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.correccion).toContain("11:00");
    });

    it("sin especialista (ni en la operación ni ya fijado): fija fecha/hora y deja el recurso sin resolver", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      disponibilidadRealMultiple.mockResolvedValue({ "10:00": ["staff_val", "staff_cam"] });

      const r = await aplicarOperacion(conServicio, { tipo: "fijar_horario", fecha: FECHA_FUTURA, hora: "10:00" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(disponibilidadRealMultiple).toHaveBeenCalledWith(
        expect.objectContaining({ staffIdPreferido: undefined, fecha: FECHA_FUTURA })
      );
      expect(r.estado.reserva).toEqual({ fecha: FECHA_FUTURA, hora: "10:00", duracionMin: 45, recursoId: null, recursoNombre: null });
    });

    it("con especialista en la misma operación: resuelve el nombre y lo usa como preferencia real", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "staff_val" });
      disponibilidadRealMultiple.mockResolvedValue({ "10:00": ["staff_val"] });

      const r = await aplicarOperacion(
        conServicio,
        { tipo: "fijar_horario", fecha: FECHA_FUTURA, hora: "10:00", especialista: "Valentina" },
        contexto()
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(disponibilidadRealMultiple).toHaveBeenCalledWith(expect.objectContaining({ staffIdPreferido: "staff_val" }));
      expect(r.estado.reserva).toEqual({ fecha: FECHA_FUTURA, hora: "10:00", duracionMin: 45, recursoId: "staff_val", recursoNombre: "Valentina" });
    });

    it("reutiliza el especialista ya fijado en un turno anterior, sin volver a preguntar por su nombre", async () => {
      const conServicio = await aplicarOk(estadoVacio(), { tipo: "fijar_servicio", servicio: "Manicure" });
      resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "staff_val" });
      const conEspecialista = await aplicarOk(conServicio, { tipo: "fijar_especialista", especialista: "Valentina" });

      disponibilidadRealMultiple.mockResolvedValue({ "10:00": ["staff_val"] });
      const r = await aplicarOperacion(conEspecialista, { tipo: "fijar_horario", fecha: FECHA_FUTURA, hora: "10:00" }, contexto());

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(resolverEspecialistaMultiple).toHaveBeenCalledTimes(1); // solo la llamada de fijar_especialista, no una segunda
      expect(disponibilidadRealMultiple).toHaveBeenCalledWith(expect.objectContaining({ staffIdPreferido: "staff_val" }));
      expect(r.estado.reserva!.recursoNombre).toBe("Valentina");
    });
  });

  describe("fijar_dato", () => {
    it("Compuerta 2: rechaza un requisito que este negocio no declaró", async () => {
      const r = await aplicarOperacion(estadoVacio(), { tipo: "fijar_dato", requisitoId: "direccion", valor: "x" }, contexto());
      expect(r.ok).toBe(false);
    });

    it("con las dos compuertas en verde, guarda el dato", async () => {
      const r = await aplicarOperacion(estadoVacio(), { tipo: "fijar_dato", requisitoId: "telefono", valor: "3001234567" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.datos.telefono).toBe("3001234567");
    });
  });

  describe("confirmar", () => {
    it("solo marca confirmado:true en memoria — sin validar si la reserva está completa", async () => {
      const r = await aplicarOperacion(estadoVacio(), { tipo: "confirmar" }, contexto());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.estado.confirmado).toBe(true);
    });
  });

  it("un tipo desconocido (bypaseando Zod) cae al rechazo exhaustivo, no revienta", async () => {
    const invalida = { tipo: "cancelar" } as unknown as Operacion;
    const r = await aplicarOperacion(estadoVacio(), invalida, contexto());
    expect(r.ok).toBe(false);
  });
});

describe("aplicarOperaciones — lote atómico (data-model.md sección 2)", () => {
  it("lote vacío: no cambia nada, devuelve el mismo estado", async () => {
    const inicial = estadoVacio();
    const r = await aplicarOperaciones(inicial, [], contexto());
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    expect(r.estadoFinal).toBe(inicial);
  });

  it("todas las operaciones pasan: se aplican en orden sobre el estado final", async () => {
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "staff_val" });
    const operaciones: Operacion[] = [
      { tipo: "fijar_servicio", servicio: "Manicure" },
      { tipo: "fijar_especialista", especialista: "Valentina" },
    ];
    const r = await aplicarOperaciones(estadoVacio(), operaciones, contexto());
    expect(r.persistido).toBe(true);
    if (!r.persistido) return;
    expect(r.estadoFinal.items).toHaveLength(1);
    expect(r.estadoFinal.reserva!.recursoNombre).toBe("Valentina");
  });

  /**
   * El caso central de la corrección de atomicidad (data-model.md sección 6,
   * corregido el 16-sep-2026 — mismo criterio que el equivalente de pedidos):
   * la operación 3 falla por una regla real (requisito no declarado), no por
   * algo inventado.
   */
  it("si la operación 3 de 3 falla, NINGUNA se persiste — ni siquiera las dos que sí habían pasado", async () => {
    const estadoInicial = estadoVacio();
    resolverEspecialistaMultiple.mockResolvedValue({ ok: true, staffId: "staff_val" });
    const operaciones: Operacion[] = [
      { tipo: "fijar_servicio", servicio: "Manicure" },
      { tipo: "fijar_especialista", especialista: "Valentina" },
      { tipo: "fijar_dato", requisitoId: "no-declarado", valor: "x" },
    ];
    const r = await aplicarOperaciones(estadoInicial, operaciones, contexto());

    expect(r.persistido).toBe(false);
    if (r.persistido) return;
    expect(r.operacionFallida).toBe(2);
    expect("estadoFinal" in r).toBe(false);

    expect(estadoInicial.items).toHaveLength(0);
    expect(estadoInicial.reserva).toBeNull();
  });
});
