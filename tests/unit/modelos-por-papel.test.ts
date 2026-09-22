/**
 * Una variable no puede decidir cuatro cosas distintas.
 *
 * ## El incidente que lo pide
 *
 * 21-sep-2026. El dueño abrió el panel de producción para cambiar el modelo
 * conversacional a `openai/gpt-5-mini` y bajar el gasto de IA. Con el código
 * de entonces, `OPENROUTER_MODEL` mandaba a la vez sobre:
 *
 *   · la conversación,
 *   · la transcripción de notas de voz,
 *   · la descripción de imágenes (comprobantes de pago),
 *   · la lectura de cartas para el catálogo.
 *
 * Y `gpt-5-mini` **no acepta audio** — comprobado en el registro del
 * proveedor: `entrada: text, image, file`. Guardar ese cambio habría dejado
 * sin entender 805 audios al mes en cinco negocios, sin un solo error
 * visible en el CRM.
 *
 * Aquí se fija el contrato de los papeles: quién conversa y quién lee medios
 * se eligen por separado, y nadie lee la variable en crudo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getEnv()` cachea el entorno la primera vez que alguien lo pide, así que
 * cada prueba recarga el módulo. Mismo motivo —y misma solución— que en
 * `ai-adapter.test.ts`.
 */
const cargar = async () => {
  vi.resetModules();
  return import("@/lib/ai/modelos");
};

const baseEnv = () => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
};

beforeEach(() => {
  vi.restoreAllMocks();
  baseEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cada papel elige su modelo", () => {
  it("el que conversa sale de OPENROUTER_MODEL", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-5-mini");
    const { modeloQueConversa } = await cargar();
    expect(modeloQueConversa()).toBe("openai/gpt-5-mini");
  });

  it("el que lee medios sale de OPENROUTER_TRANSCRIPTION_MODEL", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-5-mini");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "google/gemini-3.7-flash");
    const { modeloQueLeeMedios } = await cargar();
    expect(modeloQueLeeMedios()).toBe("google/gemini-3.7-flash");
  });

  it("son independientes: cambiar el de conversación no toca el de medios", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-5-mini");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "google/gemini-3.7-flash");
    const { modeloQueConversa, modeloQueLeeMedios } = await cargar();
    // Este es el caso exacto del incidente: el conversacional es sordo y el
    // audio sigue yendo a uno que oye.
    expect(modeloQueConversa()).toBe("openai/gpt-5-mini");
    expect(modeloQueLeeMedios()).toBe("google/gemini-3.7-flash");
    expect(modeloQueLeeMedios()).not.toBe(modeloQueConversa());
  });

  it("el juez usa el suyo, y si no hay, el de conversación", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "conversador");
    const sinJuez = await cargar();
    expect(sinJuez.modeloQueJuzga()).toBe("conversador");

    vi.stubEnv("OPENROUTER_JUDGE_MODEL", "juez-aparte");
    const conJuez = await cargar();
    expect(conJuez.modeloQueJuzga()).toBe("juez-aparte");
  });
});

describe("sin la variable nueva, todo se comporta como antes", () => {
  it("el que lee medios cae en el de conversación", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "google/gemini-3.7-flash");
    const { modeloQueLeeMedios } = await cargar();
    // Cero regresión para quien no configure nada: es lo que hacía el código
    // viejo, que leía la misma variable.
    expect(modeloQueLeeMedios()).toBe("google/gemini-3.7-flash");
  });

  it("y lo AVISA, porque es justo la trampa del incidente", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-5-mini");
    const { modeloQueLeeMedios } = await cargar();
    modeloQueLeeMedios();
    expect(warn).toHaveBeenCalled();
    const dicho = warn.mock.calls.map((c) => String(c[0])).join(" ");
    expect(dicho).toMatch(/OPENROUTER_TRANSCRIPTION_MODEL/);
    // Tiene que nombrar la consecuencia, no solo la variable: quien lea esto
    // a las 3 de la mañana necesita saber qué se rompe.
    expect(dicho).toMatch(/audio|voz/i);
  });

  it("no avisa cuando sí está configurada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-5-mini");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "google/gemini-3.7-flash");
    const { modeloQueLeeMedios } = await cargar();
    modeloQueLeeMedios();
    expect(warn).not.toHaveBeenCalled();
  });

  it("una variable vacía cuenta como ausente, no como modelo llamado ''", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "google/gemini-3.7-flash");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "");
    const { modeloQueLeeMedios } = await cargar();
    expect(modeloQueLeeMedios()).toBe("google/gemini-3.7-flash");
  });

  it("sin ningún modelo configurado, devuelve undefined en vez de inventarse uno", async () => {
    const { modeloQueConversa, modeloQueLeeMedios } = await cargar();
    expect(modeloQueConversa()).toBeUndefined();
    expect(modeloQueLeeMedios()).toBeUndefined();
  });
});

describe("los espacios sobrantes no rompen nada", () => {
  /**
   * El 21-sep-2026 el dueño pegó `OPENROUTER_MODEL= openai/gpt-5-mini` en el
   * panel. La cadena de salvavidas hacía `.trim()` y las rutas de medios no,
   * así que el mismo espacio habría roto el audio y las imágenes mientras la
   * conversación seguía funcionando. Ahora se limpia en un solo sitio.
   */
  it("se limpian en los tres papeles", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "  openai/gpt-5-mini  ");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", " google/gemini-3.7-flash ");
    vi.stubEnv("OPENROUTER_JUDGE_MODEL", "\tjuez ");
    const m = await cargar();
    expect(m.modeloQueConversa()).toBe("openai/gpt-5-mini");
    expect(m.modeloQueLeeMedios()).toBe("google/gemini-3.7-flash");
    expect(m.modeloQueJuzga()).toBe("juez");
  });

  it("una variable con solo espacios cuenta como ausente", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "google/gemini-3.7-flash");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "   ");
    const { modeloQueLeeMedios } = await cargar();
    expect(modeloQueLeeMedios()).toBe("google/gemini-3.7-flash");
  });
});

describe("la cadena de salvavidas", () => {
  it("es el principal y detrás los dos respaldos, sin espacios", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "principal");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", " salvavidas-1 ");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL_2", "salvavidas-2");
    const { cadenaDeSalvavidas } = await cargar();
    expect(cadenaDeSalvavidas("principal")).toEqual([
      "principal",
      "salvavidas-1",
      "salvavidas-2",
    ]);
  });

  it("omite los que no estén configurados", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "principal");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL_2", "solo-el-segundo");
    const { cadenaDeSalvavidas } = await cargar();
    expect(cadenaDeSalvavidas("principal")).toEqual(["principal", "solo-el-segundo"]);
  });

  it("sin respaldos, la cadena es solo el principal", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "principal");
    const { cadenaDeSalvavidas } = await cargar();
    expect(cadenaDeSalvavidas("principal")).toEqual(["principal"]);
  });

  it("la cadena es de la CONVERSACIÓN: leer medios no encadena", async () => {
    // Un salvavidas conversacional puede ser sordo. Si el audio encadenara,
    // el respaldo recibiría un audio que no sabe procesar y el fallo saldría
    // como "el proveedor falló" en vez de "está mal configurado".
    vi.stubEnv("OPENROUTER_MODEL", "conversador");
    vi.stubEnv("OPENROUTER_TRANSCRIPTION_MODEL", "oyente");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "salvavidas-sordo");
    const { modeloQueLeeMedios } = await cargar();
    expect(modeloQueLeeMedios()).toBe("oyente");
  });
});

/**
 * El salvavidas de RECUPERACIÓN DE TURNO (`docs/korexia/189`) tiene su
 * PROPIA variable, `OPENROUTER_RECOVERY_MODEL`, separada de
 * `OPENROUTER_FALLBACK_MODEL` desde el 21-sep-2026 (tarde).
 *
 * ## Por qué se separó (segundo incidente del mismo día)
 *
 * Una auditoría independiente del commit `26bf657` encontró que
 * `modeloDeRescate()` leía `OPENROUTER_FALLBACK_MODEL` — la MISMA variable
 * que `cadenaDeSalvavidas` usa dentro de `chatJson` para el fallback
 * TÉCNICO de más de 30 llamadas del pipeline, más `aprendizaje.ts` y el
 * juez del Laboratorio. Configurar el salvavidas semántico cambiaba, sin
 * que nadie lo pidiera, el comportamiento de todo lo demás. Es el mismo
 * patrón exacto que ya motivó separar `OPENROUTER_TRANSCRIPTION_MODEL` de
 * `OPENROUTER_MODEL` unas horas antes — una variable no puede decidir dos
 * cosas que alguien necesita poder cambiar por separado.
 */
describe("el salvavidas de recuperación de turno tiene su propia variable", () => {
  it("modeloDeRescate lee OPENROUTER_RECOVERY_MODEL", async () => {
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { modeloDeRescate } = await cargar();
    expect(modeloDeRescate()).toBe("google/gemini-3.8-flash");
  });

  it("NO cae a OPENROUTER_FALLBACK_MODEL si falta — no se reacopla por la puerta de atrás", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "google/gemini-3.7-flash");
    const { modeloDeRescate } = await cargar();
    expect(modeloDeRescate()).toBeUndefined();
  });

  it("cambiar OPENROUTER_RECOVERY_MODEL no toca la cadena de salvavidas técnica", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "conversador");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "salvavidas-tecnico");
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { cadenaDeSalvavidas, modeloDeRescate } = await cargar();
    // La cadena técnica sigue viendo SOLO OPENROUTER_FALLBACK_MODEL.
    expect(cadenaDeSalvavidas("conversador")).toEqual(["conversador", "salvavidas-tecnico"]);
    // Y el salvavidas de recuperación sigue viendo SOLO su propia variable.
    expect(modeloDeRescate()).toBe("google/gemini-3.8-flash");
  });

  it("cambiar OPENROUTER_RECOVERY_MODEL no toca el modelo del juez", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "conversador");
    vi.stubEnv("OPENROUTER_JUDGE_MODEL", "juez-de-siempre");
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "google/gemini-3.8-flash");
    const { modeloQueJuzga, modeloDeRescate } = await cargar();
    expect(modeloQueJuzga()).toBe("juez-de-siempre");
    expect(modeloDeRescate()).toBe("google/gemini-3.8-flash");
  });

  it("se limpia igual que los demás papeles", async () => {
    vi.stubEnv("OPENROUTER_RECOVERY_MODEL", "  google/gemini-3.8-flash  ");
    const { modeloDeRescate } = await cargar();
    expect(modeloDeRescate()).toBe("google/gemini-3.8-flash");
  });

  it("sin configurar, el mecanismo queda apagado (undefined, no un modelo inventado)", async () => {
    const { modeloDeRescate } = await cargar();
    expect(modeloDeRescate()).toBeUndefined();
  });
});
