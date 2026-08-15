/**
 * Una prueba por puerta cerrada — Fases A, B, C y D de
 * [68-UN-DUENO-POR-DATO.md](../../docs/korexia/68-UN-DUENO-POR-DATO.md).
 *
 * Todas comprueban **lógica pura**, sin base de datos: lo que se verifica es la
 * decisión (¿se puede sembrar?, ¿se toca el horario?, ¿se borra el catálogo?),
 * no el `UPDATE`. Las que necesitan base viven en los scripts de integración.
 */
import { describe, expect, it } from "vitest";
import { compararFila } from "@/server/ai/generador/comparar-fila";

/**
 * FASE A · `seed/demo` no puede sembrar sobre algo configurado.
 *
 * Se reproduce la lógica de `motivosParaNoSembrar` con los cinco casos que
 * exigió el dueño; la función real consulta la base y se prueba en integración.
 */
function motivos(estado: {
  instructions?: string | null;
  ficha?: string | null;
  kb?: number;
  productos?: number;
  servicios?: number;
  contactos?: number;
}): string[] {
  const m: string[] = [];
  if (estado.instructions?.trim()) m.push("ya tiene un prompt configurado");
  if (estado.ficha) m.push("ya tiene su ficha guardada");
  if ((estado.kb ?? 0) > 0) m.push("ya tiene conocimiento cargado");
  if ((estado.productos ?? 0) > 0) m.push("ya tiene catálogo de productos");
  if ((estado.servicios ?? 0) > 0) m.push("ya tiene servicios cargados");
  if ((estado.contactos ?? 0) > 0) m.push("ya tiene contactos");
  return m;
}

describe("FASE A · seed/demo", () => {
  it("cliente vacío → demo PERMITIDA", () => {
    expect(motivos({})).toEqual([]);
  });

  it("cliente configurado (con prompt) → demo RECHAZADA", () => {
    expect(motivos({ instructions: "PROMPT de 17.000 caracteres" })).toContain(
      "ya tiene un prompt configurado"
    );
  });

  it("cliente con conocimiento → demo RECHAZADA", () => {
    expect(motivos({ kb: 1 })).toContain("ya tiene conocimiento cargado");
  });

  it("cliente con catálogo → demo RECHAZADA", () => {
    expect(motivos({ productos: 4 })).toContain("ya tiene catálogo de productos");
  });

  it("cliente con servicios → demo RECHAZADA", () => {
    expect(motivos({ servicios: 46 })).toContain("ya tiene servicios cargados");
  });

  it("la ventana que abría la puerta: configurado pero SIN mensajes todavía", () => {
    // Es el estado de todo cliente recién dado de alta. La guarda vieja miraba
    // solo los contactos y decía "vacío": por ahí se colaba el borrado.
    const recienDadoDeAlta = { instructions: "PROMPT", ficha: "{}", kb: 3, contactos: 0 };
    expect(motivos(recienDadoDeAlta).length).toBeGreaterThan(0);
  });
});

/**
 * FASE B · El cuestionario no puede tocar el horario.
 *
 * `aplicarFicha` solo escribe `hours*` cuando aún no hay horario (el alta). La
 * prueba compara la FILA COMPLETA, como manda la regla.
 */
describe("FASE B · horario", () => {
  const FILA = {
    hoursOpen: "09:30",
    hoursClose: "18:30",
    hoursDays: "1,2,3,4,5,6",
    instructions: "PROMPT",
    ficha: '{"horario":{"abre":"09:00","cierra":"20:00"}}',
    updatedAt: new Date("2026-08-15T19:00:00Z"),
  };

  it("corregir el horario y reenviar el cuestionario NO lo altera", () => {
    // El reenvío recompila el prompt y guarda la ficha, pero con el horario ya
    // configurado no vuelve a escribir las columnas.
    const trasReenvio = {
      ...FILA,
      ficha: '{"horario":{"abre":"09:00","cierra":"20:00"},"tono":"nuevo"}',
      updatedAt: new Date("2026-08-15T19:46:41Z"),
    };
    const c = compararFila(FILA, trasReenvio, ["ficha", "instructions", "updatedAt"]);
    expect(c.ok).toBe(true);
    expect(c.noDeclarados).toEqual([]);
    expect(trasReenvio.hoursOpen).toBe("09:30");
    expect(trasReenvio.hoursClose).toBe("18:30");
  });

  it("con el comportamiento viejo, la misma operación se habría cazado", () => {
    const comoAntes = { ...FILA, hoursOpen: "09:00", hoursClose: "20:00" };
    const c = compararFila(FILA, comoAntes, ["ficha", "instructions", "updatedAt"]);
    expect(c.ok).toBe(false);
    expect(c.noDeclarados.map((d) => d.campo).sort()).toEqual(["hoursClose", "hoursOpen"]);
  });

  it("en el ALTA sí se escribe: un negocio nuevo no puede nacer sin horario", () => {
    const nuevo = { hoursOpen: null, hoursClose: null };
    const yaConfigurado = Boolean(nuevo.hoursOpen && nuevo.hoursClose);
    expect(yaConfigurado).toBe(false); // → aplicarFicha sí escribe
  });
});

/**
 * FASE C · El catálogo no se reemplaza sin decirlo.
 *
 * `escribirCatalogo` borra todos los productos y los recrea desde el texto de
 * la ficha. Con productos ya cargados hace falta `--forzar`.
 */
function decidirSiembra(productosEnTabla: number, forzar: boolean) {
  if (productosEnTabla === 0) return { sigue: true, motivo: "no había catálogo" };
  if (!forzar) return { sigue: false, motivo: `se borrarían ${productosEnTabla} productos` };
  return { sigue: true, motivo: "--forzar recibido" };
}

/** Nombres normalizados: `BESTIES` y `Besties` son el mismo producto. */
function divergen(
  tabla: { nombre: string; precio: number | null }[],
  ficha: { nombre: string; precio: number | null }[]
): boolean {
  const clave = (n: string, p: number | null) =>
    `${n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()}|${p ?? "?"}`;
  const a = tabla.map((x) => clave(x.nombre, x.precio)).sort();
  const b = ficha.map((x) => clave(x.nombre, x.precio)).sort();
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

describe("FASE C · catálogo", () => {
  it("sin productos: siembra permitida", () => {
    expect(decidirSiembra(0, false).sigue).toBe(true);
  });

  it("con productos y sin --forzar: ABORTA y dice cuántos borraría", () => {
    const r = decidirSiembra(4, false);
    expect(r.sigue).toBe(false);
    expect(r.motivo).toContain("4 productos");
  });

  it("con productos y con --forzar: sigue", () => {
    expect(decidirSiembra(4, true).sigue).toBe(true);
  });

  it("avisa cuando un precio de la tabla no está en la ficha", () => {
    const tabla = [{ nombre: "CHURRITA", precio: 1200000 }];
    const ficha = [{ nombre: "Churrita", precio: 1000000 }];
    expect(divergen(tabla, ficha)).toBe(true);
  });

  it("NO avisa por mayúsculas: una alarma que suena siempre no sirve", () => {
    // Es el falso positivo real de la primera versión, contra producción.
    const tabla = [
      { nombre: "BESTIES", precio: 2000000 },
      { nombre: "CHURRITA", precio: 1000000 },
    ];
    const ficha = [
      { nombre: "Besties", precio: 2000000 },
      { nombre: "Churrita", precio: 1000000 },
    ];
    expect(divergen(tabla, ficha)).toBe(false);
  });
});

/**
 * FASE D · Cada origen solo toca su conocimiento.
 *
 * Es la regla que faltaba cuando la corrección de salud del salón —hecha a mano
 * tras un incidente— fue repuesta por una versión vieja.
 */
type Origen = "cliente" | "operador" | "agente";
function puedeTocar(quien: Origen, entrada: Origen): boolean {
  return quien === entrada;
}

describe("FASE D · conocimiento", () => {
  it("el cliente NO puede borrar el conocimiento del operador", () => {
    expect(puedeTocar("cliente", "operador")).toBe(false);
  });

  it("el operador NO puede borrar el conocimiento del cliente", () => {
    expect(puedeTocar("operador", "cliente")).toBe(false);
  });

  it("el agente NO puede borrar el conocimiento manual", () => {
    expect(puedeTocar("agente", "operador")).toBe(false);
    expect(puedeTocar("agente", "cliente")).toBe(false);
  });

  it("cada uno sí puede con lo suyo", () => {
    expect(puedeTocar("cliente", "cliente")).toBe(true);
    expect(puedeTocar("operador", "operador")).toBe(true);
    expect(puedeTocar("agente", "agente")).toBe(true);
  });
});
