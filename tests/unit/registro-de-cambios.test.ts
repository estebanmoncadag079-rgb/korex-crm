/**
 * La validación obligatoria: provocar un cambio controlado y comprobar que el
 * log responde a las cinco preguntas.
 *
 * El cambio que se reproduce es el real: el horario del salón revertido el
 * 15-ago a las 19:46:41 por `aplicarFicha`, mientras una prueba miraba otros
 * cinco campos.
 */
import { describe, expect, it, vi } from "vitest";
import {
  formatear,
  paraLog,
  registrarCambios,
  type Actor,
} from "@/server/registro-de-cambios";

const FILA_ANTES = {
  organizationId: "org_novxv78s08h12arzatr2",
  hoursOpen: "09:30",
  hoursClose: "18:30",
  instructions: "PROMPT".repeat(3000),
  enabled: false,
  ficha: '{"nombre":"Lashes Valen"}',
  updatedAt: new Date("2026-08-15T19:00:00Z"),
};

describe("el incidente del horario, reproducido", () => {
  it("responde las cinco preguntas de un vistazo", () => {
    const despues = {
      ...FILA_ANTES,
      hoursOpen: "09:00",
      hoursClose: "20:00",
      ficha: '{"nombre":"Lashes Valen","x":1}',
      updatedAt: new Date("2026-08-15T19:46:41.403Z"),
    };

    const cambios = registrarCambios({
      tabla: "agent_profile",
      registro: "org_novxv78s08h12arzatr2",
      antes: FILA_ANTES,
      despues,
      // `aplicarFicha` declara que toca la ficha… y toca el horario también.
      declarados: ["ficha", "updatedAt"],
      proceso: "aplicarFicha",
      actor: "script:reenviar-cuestionario",
      ahora: new Date("2026-08-15T19:46:41.403Z"),
    });

    const horario = cambios.filter((c) => c.campo.startsWith("hours"));
    expect(horario).toHaveLength(2);

    const abre = horario.find((c) => c.campo === "hoursOpen")!;
    expect(abre.valorAnterior).toBe("09:30"); // ¿cuál era el valor anterior?
    expect(abre.valorNuevo).toBe("09:00"); // ¿cuál es el nuevo?
    expect(abre.proceso).toBe("aplicarFicha"); // ¿qué proceso lo cambió?
    expect(abre.timestamp).toBe("2026-08-15T19:46:41.403Z"); // ¿cuándo?
    expect(abre.campo).toBe("hoursOpen"); // ¿qué cambió?

    // Y lo que ninguna lista de campos habría dicho:
    expect(abre.noDeclarado).toBe(true);
    expect(formatear(abre)).toContain("[NO DECLARADO]");
  });

  it("la línea es legible y cabe en un renglón", () => {
    const lineas = registrarCambios({
      tabla: "agent_profile",
      registro: "org_x",
      antes: { hoursOpen: "09:30" },
      despues: { hoursOpen: "09:00" },
      declarados: [],
      proceso: "aplicarFicha",
      actor: "user:abc123",
      ahora: new Date("2026-08-15T19:46:41.403Z"),
    }).map(formatear);
    const linea = lineas[0]!;

    expect(linea).toBe(
      "[cambio][NO DECLARADO] tabla=agent_profile registro=org_x campo=hoursOpen " +
        "valor_anterior=09:30 valor_nuevo=09:00 proceso=aplicarFicha actor=user:abc123 " +
        "timestamp=2026-08-15T19:46:41.403Z"
    );
    expect(linea.includes("\n")).toBe(false);
  });
});

describe("qué se escribe y qué no", () => {
  it("un prompt de 18.000 caracteres se resume, no se vuelca", () => {
    const v = paraLog("instructions", "x".repeat(18000));
    expect(v).toMatch(/^<18000 caracteres · huella [0-9a-f]+>$/);
  });

  it("dos valores largos distintos dan huellas distintas", () => {
    expect(paraLog("instructions", "a".repeat(500))).not.toBe(
      paraLog("instructions", "b".repeat(500))
    );
  });

  it("el mismo valor largo da la misma huella: así se detecta una reversión", () => {
    const antiguo = paraLog("instructions", "PROMPT BUENO".repeat(50));
    const vuelto = paraLog("instructions", "PROMPT BUENO".repeat(50));
    expect(antiguo).toBe(vuelto);
  });

  it("NUNCA escribe un token de WhatsApp", () => {
    expect(paraLog("accessToken", "EAAG123secreto")).toBe("<oculto>");
    expect(paraLog("metaAccessToken", "EAAG123secreto")).toBe("<oculto>");
    expect(paraLog("phoneNumberId", "123456")).toBe("<oculto>");
  });

  it("los saltos de línea no rompen el formato de una línea", () => {
    expect(paraLog("tone", "cercano\ny alegre")).toBe("cercano y alegre");
  });

  it("distingue null de ausente, que no es lo mismo", () => {
    expect(paraLog("greeting", null)).toBe("null");
    expect(paraLog("greeting", undefined)).toBe("ausente");
  });
});

describe("no puede romper la operación que registra", () => {
  it("un fallo interno no lanza", () => {
    const circular: Record<string, unknown> = {};
    circular.yo = circular; // JSON.stringify lanza sobre esto
    expect(() =>
      registrarCambios({
        tabla: "t",
        registro: "r",
        antes: { campo: 1 },
        despues: { campo: circular },
        declarados: [],
        proceso: "p",
        actor: "sistema" as Actor,
      })
    ).not.toThrow();
  });

  it("una escritura que no cambia nada no ensucia el log", () => {
    const espia = vi.spyOn(console, "log").mockImplementation(() => {});
    const cambios = registrarCambios({
      tabla: "agent_profile",
      registro: "org_x",
      antes: FILA_ANTES,
      despues: { ...FILA_ANTES },
      declarados: ["ficha"],
      proceso: "regenerar:flota",
      actor: "script:regenerar-flota",
    });
    expect(cambios).toHaveLength(0);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});

describe("la instrumentación es PASIVA (criterio de despliegue)", () => {
  it("no modifica las filas que recibe: ni congeladas se queja", () => {
    const antes = Object.freeze({ hoursOpen: "09:30", enabled: true });
    const despues = Object.freeze({ hoursOpen: "09:00", enabled: true });
    const espia = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(() =>
      registrarCambios({
        tabla: "agent_profile",
        registro: "org_x",
        antes,
        despues,
        declarados: [],
        proceso: "aplicarFicha",
        actor: "sistema",
      })
    ).not.toThrow();

    // Los valores siguen exactamente como llegaron.
    expect(antes).toEqual({ hoursOpen: "09:30", enabled: true });
    expect(despues).toEqual({ hoursOpen: "09:00", enabled: true });
    espia.mockRestore();
  });

  it("no impide ni altera el cambio: solo lo cuenta", () => {
    // Lo que devuelve es una LECTURA de lo que ya pasó. Aunque el registro
    // marque [NO DECLARADO], el valor nuevo sigue siendo el valor nuevo.
    const despues = { hoursOpen: "09:00" };
    const espia = vi.spyOn(console, "log").mockImplementation(() => {});
    const cambios = registrarCambios({
      tabla: "agent_profile",
      registro: "org_x",
      antes: { hoursOpen: "09:30" },
      despues,
      declarados: [],
      proceso: "aplicarFicha",
      actor: "sistema",
    });
    expect(cambios[0]!.noDeclarado).toBe(true);
    expect(despues.hoursOpen).toBe("09:00"); // no lo revirtió
    espia.mockRestore();
  });

  it("si el propio logger falla, la operación continúa", () => {
    const espia = vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("stdout cerrado");
    });
    expect(() =>
      registrarCambios({
        tabla: "t",
        registro: "r",
        antes: { a: 1 },
        despues: { a: 2 },
        declarados: ["a"],
        proceso: "p",
        actor: "sistema",
      })
    ).not.toThrow();
    espia.mockRestore();
  });
});
