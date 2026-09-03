import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 10B — `worker-daemon.ts`: el proceso que de verdad vacía
 * `campaign_send_job`. Cubre específicamente el bug real encontrado en la
 * propia autoauditoría de esta fase: la primera versión hacía `await
 * procesarUnEnvioDeCampana(...)` DENTRO del `while` de sondeo, así que
 * `CAMPAIGN_WORKER_CONCURRENCY > 1` no tenía ningún efecto — el bucle
 * esperaba a que cada envío completo terminara antes de reclamar el
 * siguiente. Corregido separando reclamo (secuencial) de procesamiento
 * (sin esperar) — este archivo prueba que la concurrencia real ahora sí
 * ocurre, y que respeta el límite configurado.
 */

const reclamarTrabajoDeCampanaMock = vi.fn();
vi.mock("@/server/campaigns/cola", () => ({
  reclamarTrabajoDeCampana: (...args: unknown[]) => reclamarTrabajoDeCampanaMock(...args),
}));

const resolverTrabajoTomadoMock = vi.fn();
vi.mock("@/server/campaigns/worker", () => ({
  resolverTrabajoTomado: (...args: unknown[]) => resolverTrabajoTomadoMock(...args),
}));

const rescatarHuerfanosDeCampanaMock = vi.fn();
vi.mock("@/server/campaigns/recovery", () => ({
  rescatarHuerfanosDeCampana: (...args: unknown[]) => rescatarHuerfanosDeCampanaMock(...args),
}));

vi.mock("@/server/whatsapp/templates", () => ({
  enviarTemplateAlProveedor: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    CAMPAIGN_WORKER_ENABLED: false,
    CAMPAIGN_WORKER_CONCURRENCY: 2,
    CAMPAIGN_WORKER_POLL_MS: 2000,
    CAMPAIGN_RATE_LIMIT_MAX: 20,
    CAMPAIGN_RATE_LIMIT_WINDOW_MS: 60000,
  }),
}));

beforeEach(() => {
  reclamarTrabajoDeCampanaMock.mockReset();
  resolverTrabajoTomadoMock.mockReset();
  rescatarHuerfanosDeCampanaMock.mockReset();
});

function trabajo(id: string) {
  return { jobId: id, recipientId: `r_${id}`, campaignId: "cmp_1", organizationId: "org_1", attempts: 1 };
}

describe("sondearParaTests: concurrencia real (no secuencial)", () => {
  it("A: con concurrencia=2 y 3 trabajos disponibles, reclama y lanza 2 en paralelo — SIN esperar a que el primero termine", async () => {
    // Promesas controladas manualmente: nunca se resuelven durante el test,
    // así que si `sondear` esperara cada una antes de reclamar la
    // siguiente, jamás llegaría a reclamar la segunda.
    let resolverPrimero!: (v: unknown) => void;
    const primeroPendiente = new Promise((r) => (resolverPrimero = r));
    let resolverSegundo!: (v: unknown) => void;
    const segundoPendiente = new Promise((r) => (resolverSegundo = r));

    reclamarTrabajoDeCampanaMock
      .mockResolvedValueOnce(trabajo("j1"))
      .mockResolvedValueOnce(trabajo("j2"))
      .mockResolvedValueOnce(null); // el 3er reclamo no ocurre: concurrencia=2 ya está llena
    resolverTrabajoTomadoMock
      .mockReturnValueOnce(primeroPendiente)
      .mockReturnValueOnce(segundoPendiente);

    const { sondearParaTests } = await import("@/server/campaigns/worker-daemon");
    const estado = { id: "w1", timerSondeo: null, timerMantenimiento: null, enVuelo: 0, parando: false };

    await sondearParaTests(estado);

    // Los DOS trabajos se reclamaron y se lanzaron, aunque ninguno haya
    // "terminado" todavía (las promesas siguen pendientes) — prueba directa
    // de que el reclamo no espera al procesamiento.
    expect(reclamarTrabajoDeCampanaMock).toHaveBeenCalledTimes(2);
    expect(resolverTrabajoTomadoMock).toHaveBeenCalledTimes(2);
    expect(estado.enVuelo).toBe(2); // ambos siguen "en vuelo"

    // Limpieza: resolver las pendientes para no dejar handles colgando.
    resolverPrimero({ outcome: "enviado", messageId: "m1" });
    resolverSegundo({ outcome: "enviado", messageId: "m2" });
    await Promise.resolve();
  });

  it("B: sin trabajo pendiente — reclama una vez, no lanza nada", async () => {
    reclamarTrabajoDeCampanaMock.mockResolvedValueOnce(null);
    const { sondearParaTests } = await import("@/server/campaigns/worker-daemon");
    const estado = { id: "w1", timerSondeo: null, timerMantenimiento: null, enVuelo: 0, parando: false };

    await sondearParaTests(estado);
    expect(reclamarTrabajoDeCampanaMock).toHaveBeenCalledTimes(1);
    expect(resolverTrabajoTomadoMock).not.toHaveBeenCalled();
    expect(estado.enVuelo).toBe(0);
  });

  it("C: worker parando — no reclama nada", async () => {
    const { sondearParaTests } = await import("@/server/campaigns/worker-daemon");
    const estado = { id: "w1", timerSondeo: null, timerMantenimiento: null, enVuelo: 0, parando: true };

    await sondearParaTests(estado);
    expect(reclamarTrabajoDeCampanaMock).not.toHaveBeenCalled();
  });

  it("D: enVuelo ya en el límite de concurrencia — no reclama nada más", async () => {
    const { sondearParaTests } = await import("@/server/campaigns/worker-daemon");
    const estado = { id: "w1", timerSondeo: null, timerMantenimiento: null, enVuelo: 2, parando: false };

    await sondearParaTests(estado);
    expect(reclamarTrabajoDeCampanaMock).not.toHaveBeenCalled();
  });

  it("E: al terminar un trabajo (resuelto), enVuelo decrece — libera cupo para el siguiente sondeo", async () => {
    reclamarTrabajoDeCampanaMock.mockResolvedValueOnce(trabajo("j1")).mockResolvedValueOnce(null);
    resolverTrabajoTomadoMock.mockResolvedValueOnce({ outcome: "enviado", messageId: "m1" });
    const { sondearParaTests } = await import("@/server/campaigns/worker-daemon");
    const estado = { id: "w1", timerSondeo: null, timerMantenimiento: null, enVuelo: 0, parando: false };

    await sondearParaTests(estado);
    // Deja que el `.finally()` de la promesa ya resuelta se ejecute.
    await new Promise((r) => setTimeout(r, 0));
    expect(estado.enVuelo).toBe(0);
  });

  it("F: reclamo falla (error de DB) — no lanza, no queda enVuelo colgado", async () => {
    reclamarTrabajoDeCampanaMock.mockRejectedValueOnce(new Error("DB caída"));
    const { sondearParaTests } = await import("@/server/campaigns/worker-daemon");
    const estado = { id: "w1", timerSondeo: null, timerMantenimiento: null, enVuelo: 0, parando: false };

    await expect(sondearParaTests(estado)).resolves.toBeUndefined();
    expect(estado.enVuelo).toBe(0);
  });

  it("G: el procesamiento de un trabajo lanza una excepción — se captura, enVuelo se libera igual", async () => {
    reclamarTrabajoDeCampanaMock.mockResolvedValueOnce(trabajo("j1")).mockResolvedValueOnce(null);
    resolverTrabajoTomadoMock.mockRejectedValueOnce(new Error("boom"));
    const { sondearParaTests } = await import("@/server/campaigns/worker-daemon");
    const estado = { id: "w1", timerSondeo: null, timerMantenimiento: null, enVuelo: 0, parando: false };

    await sondearParaTests(estado);
    await new Promise((r) => setTimeout(r, 0));
    expect(estado.enVuelo).toBe(0);
  });
});

describe("arrancarWorkerDeCampanas: apagado por defecto", () => {
  it("H: CAMPAIGN_WORKER_ENABLED=false (default) — no arranca ningún timer", async () => {
    const { arrancarWorkerDeCampanas, _resetWorkerDeCampanasParaTests } = await import("@/server/campaigns/worker-daemon");
    _resetWorkerDeCampanasParaTests();
    arrancarWorkerDeCampanas();
    // No hay forma directa de inspeccionar el estado global desde afuera,
    // pero al menos confirma que no lanza y que rescatarHuerfanos (llamado
    // solo si arranca) nunca se dispara.
    expect(rescatarHuerfanosDeCampanaMock).not.toHaveBeenCalled();
    _resetWorkerDeCampanasParaTests();
  });
});
