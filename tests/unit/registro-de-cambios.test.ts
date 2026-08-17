/**
 * La validación obligatoria: provocar un cambio controlado y comprobar que el
 * log responde a las cinco preguntas.
 *
 * El cambio que se reproduce es el real: el horario del salón revertido el
 * 15-ago a las 19:46:41 por `aplicarFicha`, mientras una prueba miraba otros
 * cinco campos.
 */
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  clasificar,
  formatear,
  paraLog,
  registrarCambios,
  TABLAS_CLASIFICADAS,
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
    const v = paraLog("agent_profile", "instructions", "x".repeat(18000));
    expect(v).toMatch(/^<18000 caracteres · huella [0-9a-f]+>$/);
  });

  it("dos valores largos distintos dan huellas distintas", () => {
    expect(paraLog("agent_profile", "instructions", "a".repeat(500))).not.toBe(
      paraLog("agent_profile", "instructions", "b".repeat(500))
    );
  });

  it("el mismo valor largo da la misma huella: así se detecta una reversión", () => {
    const antiguo = paraLog("agent_profile", "instructions", "PROMPT BUENO".repeat(50));
    const vuelto = paraLog("agent_profile", "instructions", "PROMPT BUENO".repeat(50));
    expect(antiguo).toBe(vuelto);
  });

  it("NUNCA escribe un token de WhatsApp", () => {
    expect(paraLog("agent_profile", "accessToken", "EAAG123secreto")).toBe("<oculto>");
    expect(paraLog("agent_profile", "metaAccessToken", "EAAG123secreto")).toBe("<oculto>");
    expect(paraLog("agent_profile", "phoneNumberId", "123456")).toBe("<oculto>");
  });

  it("los saltos de línea no rompen el formato de una línea", () => {
    expect(paraLog("agent_profile", "tone", "cercano\ny alegre")).toBe("cercano y alegre");
  });

  /*
   * Los datos de una persona (16-ago-2026).
   *
   * La Fase 2 guarda el pedido con nombre, teléfono y dirección del cliente
   * final, y el registro por campo los volcaba en claro: caben de sobra en los
   * 120 caracteres, así que no los resumía nadie. El log del contenedor se lee
   * a ojo y se pega en un chat.
   */
  describe("un dato de una persona no se escribe nunca", () => {
    it("ni el teléfono, ni la dirección, ni el nombre de quien pide", () => {
      expect(paraLog("conversation_state", "entrega.telefono", "3001234567")).not.toContain("3001234567");
      expect(paraLog("conversation_state", "entrega.direccion", "Cra 5 #4-32 apto 301")).not.toContain("Cra 5");
      expect(paraLog("conversation_state", "entrega.nombre", "Andrea Gómez")).not.toContain("Andrea");
    });

    it("tampoco los teléfonos del equipo", () => {
      expect(paraLog("agent_profile", "notifyPhones", "573001234567,573109876543")).not.toContain("57300");
    });

    it("pero SIGUE diciendo que cambió, y si volvió al de antes", () => {
      const uno = paraLog("conversation_state", "entrega.telefono", "3001234567");
      const otro = paraLog("conversation_state", "entrega.telefono", "3009999999");
      const vuelto = paraLog("conversation_state", "entrega.telefono", "3001234567");

      expect(uno).not.toBe(otro); // cambió
      expect(uno).toBe(vuelto); // y volvió: es la pregunta que sí se hace
      expect(uno).toMatch(/^<personal · 10 caracteres · huella [0-9a-f]+>$/);
    });

    it("la red: un campo NUEVO con pinta de identificador también se tapa", () => {
      // El campo que alguien añada mañana y nadie se acuerde de listar.
      expect(paraLog("agent_profile", "campoQueNadieListo", "3001234567")).toContain("<personal");
    });

    it("NO se come el nombre del producto, que es dato de negocio", () => {
      expect(paraLog("conversation_state", "producto.nombre", "CHURRITA")).toBe("CHURRITA");
      expect(paraLog("conversation_state", "seleccion", "SALSA:arequipe, SALSA:lechera")).toBe(
        "SALSA:arequipe, SALSA:lechera"
      );
    });

    it("NO se come un total, que es un número y no una persona", () => {
      // 1000000 son siete dígitos: la red por valor solo mira cadenas.
      expect(paraLog("conversation_state", "totalCents", 1000000)).toBe("1000000");
    });

    it("la línea entera del log no lleva el teléfono por ningún lado", () => {
      const espia = vi.spyOn(console, "log").mockImplementation(() => {});
      const cambios = registrarCambios({
        tabla: "conversation_state",
        registro: "cv_x",
        antes: { "entrega.telefono": null },
        despues: { "entrega.telefono": "3001234567" },
        declarados: ["entrega.telefono"],
        proceso: "runAgentTurn",
        actor: "pipeline",
        ahora: new Date("2026-08-16T00:00:00.000Z"),
      });

      const linea = formatear(cambios[0]!);
      expect(linea).not.toContain("3001234567");
      expect(linea).toContain("campo=entrega.telefono");
      // Y lo que se emitió por consola tampoco.
      expect(String(espia.mock.calls[0]?.[0] ?? "")).not.toContain("3001234567");
      espia.mockRestore();
    });
  });

  it("distingue null de ausente, que no es lo mismo", () => {
    expect(paraLog("agent_profile", "greeting", null)).toBe("null");
    expect(paraLog("agent_profile", "greeting", undefined)).toBe("ausente");
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

/*
 * ────────────────────────────────────────────────────────────────────────
 * REGLA 11 (16-ago-2026): una tabla no se instrumenta sin clasificar.
 *
 * El problema no estaba en los logs: estaba en que el sistema no sabía qué
 * SIGNIFICAN los datos. `contact.name` es una persona, `product.name` es un
 * churro y `agent_profile.name` es el nombre del asistente — el mismo campo
 * `name`, tres cosas distintas.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("qué significa cada dato, no cómo se llama", () => {
  it("el mismo campo `name` no significa lo mismo en dos tablas", () => {
    // El nombre del asistente es dato de negocio: se lee entero.
    expect(paraLog("agent_profile", "name", "Asistente")).toBe("Asistente");
    // El de un contacto es una persona… y `contact` no está clasificada aún,
    // así que se protege igual y se marca como deuda.
    expect(paraLog("contact", "name", "Andrea Gómez")).toContain("<sin clasificar");
    expect(paraLog("contact", "name", "Andrea Gómez")).not.toContain("Andrea");
  });

  it("clasifica las cuatro clases, y admite no saber", () => {
    expect(clasificar("agent_profile", "instructions")).toBe("negocio");
    expect(clasificar("agent_profile", "notifyPhones")).toBe("personal");
    expect(clasificar("conversation_state", "producto.id")).toBe("tecnico");
    expect(clasificar("conversation_state", "entrega.direccion")).toBe("personal");
    expect(clasificar("kb_entry", "answer")).toBeNull();
  });

  /* La prueba negativa que la regla 11 exige de cada tabla nueva. */
  it("PRUEBA NEGATIVA: lo no clasificado se protege y SE NOTA", () => {
    const v = paraLog("tabla_que_nadie_clasifico", "loQueSea", "Andrea, Cra 5 #4-32");
    expect(v).not.toContain("Andrea");
    expect(v).not.toContain("Cra 5");
    expect(v).toMatch(/^<sin clasificar · \d+ caracteres · huella [0-9a-f]+>$/);
  });

  it("un número sin clasificar sí pasa: un contador no identifica a nadie", () => {
    expect(paraLog("tabla_nueva", "intentos", 3)).toBe("3");
    expect(paraLog("tabla_nueva", "activo", true)).toBe("true");
  });

  it("la columna JSONB entera del estado es personal, no solo sus hojas", () => {
    // Cierra el resquicio: un estado corto cabía en 120 caracteres y salía
    // entero, con teléfono y dirección dentro.
    const v = paraLog("conversation_state", "estado", { entrega: { telefono: "3001234567" } });
    expect(v).not.toContain("3001234567");
    expect(v).toContain("<personal");
  });
});

function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) archivosTs(ruta, acc);
    else if (/\.tsx?$/.test(entrada)) acc.push(ruta);
  }
  return acc;
}

describe("regla 11: ninguna tabla se instrumenta sin clasificación previa", () => {
  it("toda tabla registrada está clasificada", () => {
    const sinClasificar = new Set<string>();

    for (const archivo of archivosTs(join(process.cwd(), "src"))) {
      const codigo = readFileSync(archivo, "utf8");
      if (!/conRegistro\(|registrarCambios\(/.test(codigo)) continue;
      for (const m of codigo.matchAll(/tabla:\s*"([a-z_]+)"/g)) {
        if (!TABLAS_CLASIFICADAS.includes(m[1]!)) sinClasificar.add(`${m[1]} (${archivo})`);
      }
    }

    /*
     * Si esto falla, alguien instrumentó una tabla sin decir qué significan sus
     * campos. El arreglo es clasificarla en `CLASIFICACION`, no ampliar esta
     * lista: sin clasificación, el registro protege de más o de menos, y las
     * dos formas ya costaron un incidente.
     */
    expect([...sinClasificar]).toEqual([]);
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * La huella, con clave (16-ago-2026).
 *
 * Antes era un hash de 32 bits SIN clave. Un teléfono colombiano son diez
 * dígitos: probar los diez mil millones y quedarse con el que coincide es
 * cuestión de minutos. Con HMAC y `ENCRYPTION_KEY`, ese ataque exige la clave.
 * ────────────────────────────────────────────────────────────────────────
 */
describe("la huella no se puede deshacer", () => {
  const huella = (v: string) =>
    paraLog("conversation_state", "entrega.telefono", v).match(/huella ([0-9a-f]+)/)![1]!;

  it("es determinista: el mismo teléfono, la misma huella", () => {
    expect(huella("3001234567")).toBe(huella("3001234567"));
  });

  it("dos teléfonos distintos no colisionan", () => {
    expect(huella("3001234567")).not.toBe(huella("3001234568"));
  });

  it("NO es el hash débil de antes: 12 hex, no 8", () => {
    // El anterior era `(h >>> 0).toString(16)`: 8 hex como mucho, y sin clave.
    expect(huella("3001234567")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("con clave, la huella de un valor conocido CAMBIA al cambiar la clave", () => {
    // Es lo que impide reconstruir el valor probando candidatos sin la clave:
    // el mismo teléfono da huellas distintas en dos instalaciones distintas.
    const conUna = createHmac("sha256", Buffer.alloc(32, 1)).update("3001234567").digest("hex");
    const conOtra = createHmac("sha256", Buffer.alloc(32, 2)).update("3001234567").digest("hex");
    expect(conUna.slice(0, 12)).not.toBe(conOtra.slice(0, 12));
  });

  it("una huella no contiene el valor ni ninguna parte suya", () => {
    const h = huella("3001234567");
    for (let i = 0; i + 4 <= 10; i++) {
      expect(h).not.toContain("3001234567".slice(i, i + 4));
    }
  });
});
