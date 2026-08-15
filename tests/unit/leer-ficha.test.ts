/**
 * El lector tolerante y el guardarraíl de migración — paso 1 de
 * [68-UN-DUENO-POR-DATO.md](../../docs/korexia/68-UN-DUENO-POR-DATO.md).
 *
 * Lo que estas pruebas protegen: que desplegar el lector **no cambie nada**
 * mientras no haya ningún cliente convertido, y que la conversión aborte si
 * tocara el prompt, `enabled` o `appointmentsEnabled`.
 */
import { describe, expect, it } from "vitest";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import {
  aSecciones,
  aplanar,
  camposSinDueño,
  esPorSecciones,
  leerFicha,
} from "@/server/ai/generador/leer-ficha";
import { verificarAntesDeMigrar } from "@/server/ai/generador/verificar-migracion";

const FICHA_PLANA = {
  nombre: "La Churra",
  queVende: "churros",
  vertical: "pedidos",
  horario: { dias: ["lun"], abre: "12:30", cierra: "20:30" },
  tono: "cercano",
  reglasPropias: ["si escribe 0, reinicia"],
  saludoInicial: "¡Hola Churr@!",
  escalarSiempre: ["reclamos"],
  nuncaPrometer: ["que no irrita los ojos"],
} as unknown as FichaDelNegocio;

describe("entiende las dos formas", () => {
  it("una ficha plana se lee tal cual (es el 100 % de la flota hoy)", () => {
    const leida = leerFicha(JSON.stringify(FICHA_PLANA));
    expect(leida).toEqual(FICHA_PLANA);
  });

  it("una ficha por secciones se aplana al leerla", () => {
    const porSecciones = JSON.stringify(aSecciones(FICHA_PLANA));
    expect(leerFicha(porSecciones)).toEqual(FICHA_PLANA);
  });

  it("ida y vuelta sin pérdida: es la condición para poder convertir", () => {
    expect(aplanar(aSecciones(FICHA_PLANA))).toEqual(FICHA_PLANA);
  });

  it("sin ficha (Lis) devuelve null, no revienta", () => {
    expect(leerFicha(null)).toBeNull();
    expect(leerFicha("")).toBeNull();
    expect(leerFicha("   ")).toBeNull();
  });

  it("una ficha rota devuelve null: no se toca a quien no se entiende", () => {
    expect(leerFicha("{esto no es json")).toBeNull();
  });

  it("solo trata como secciones lo que lo declara", () => {
    expect(esPorSecciones({ schema_version: 2, negocio: {}, flujo: {}, politicas: {} })).toBe(true);
    expect(esPorSecciones(FICHA_PLANA)).toBe(false);
    expect(esPorSecciones(null)).toBe(false);
  });
});

describe("cada campo tiene dueño", () => {
  it("reparte flujo y políticas fuera de negocio", () => {
    const v2 = aSecciones(FICHA_PLANA);
    expect(Object.keys(v2.flujo).sort()).toEqual(["reglasPropias", "saludoInicial"]);
    expect(Object.keys(v2.politicas).sort()).toEqual(["escalarSiempre", "nuncaPrometer"]);
    expect(v2.negocio.nombre).toBe("La Churra");
  });

  it("avisa de un campo nuevo sin dueño en vez de tirarlo", () => {
    // Es lo que pasó con `escalarSiempre` y `nuncaPrometer`: se perdían en
    // silencio porque nadie los había asignado a una sección.
    const conCampoNuevo = { ...FICHA_PLANA, algoNuevo: "x" } as unknown as FichaDelNegocio;
    expect(camposSinDueño(conCampoNuevo)).toEqual(["algoNuevo"]);
    expect(camposSinDueño(FICHA_PLANA)).toEqual([]);
  });
});

describe("el guardarraíl aborta la migración", () => {
  const base = {
    instructions: "PROMPT",
    greeting: "hola",
    escalationRules: "escalar",
    enabled: true,
    appointmentsEnabled: false,
  };

  it("deja pasar cuando no cambia nada", () => {
    const r = verificarAntesDeMigrar(base, { ...base });
    expect(r.ok).toBe(true);
    expect(r.fallos).toEqual([]);
  });

  it("aborta si el prompt recompilado no es idéntico", () => {
    const r = verificarAntesDeMigrar(base, { ...base, instructions: "PROMPT distinto" });
    expect(r.ok).toBe(false);
    expect(r.detalle.prompt).toBe(false);
    expect(r.fallos[0]).toContain("NO es idéntico");
  });

  it("aborta si le apagaría el agente al cliente", () => {
    const r = verificarAntesDeMigrar(base, { ...base, enabled: false });
    expect(r.ok).toBe(false);
    expect(r.fallos.join(" ")).toContain("es del CLIENTE");
  });

  it("aborta si tocara el vertical que contrató la agencia", () => {
    const r = verificarAntesDeMigrar(base, { ...base, appointmentsEnabled: true });
    expect(r.ok).toBe(false);
    expect(r.fallos.join(" ")).toContain("es de la AGENCIA");
  });

  it("un solo fallo basta para abortar, y los lista todos", () => {
    const r = verificarAntesDeMigrar(base, {
      instructions: "otro",
      greeting: "otro",
      escalationRules: "otro",
      enabled: false,
      appointmentsEnabled: true,
    });
    expect(r.ok).toBe(false);
    expect(r.fallos).toHaveLength(5);
  });
});
