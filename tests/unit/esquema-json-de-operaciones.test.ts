import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { esquemaDeOperaciones } from "@/server/ai/pipeline";
import { Operacion as OperacionPedidos } from "@/server/orders/operaciones";
import { Operacion as OperacionCitas } from "@/server/appointments/operaciones";
import { estadoVacio } from "@/server/orders/estado";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * T012 (feature 003-backend-como-autoridad) — contrato del esquema JSON que
 * `esquemaDeOperaciones` construiría para el proveedor. **Esta función no
 * tiene llamador todavía** (T013 la conecta a `chatJsonConEstado`), así que
 * esto prueba el CONTRATO en aislamiento, no un turno real del pipeline —
 * eso es T016.
 *
 * Mismo mecanismo de "prueba de deriva" que ya protege `CAMPOS_DE_ACCION`
 * contra `AgentAction` (`tests/unit/esquema-json-de-accion.test.ts`): el
 * proyecto no tiene `zod-to-json-schema`, así que lo que evita que el JSON
 * escrito a mano y la unión de Zod se separen es un test que los cruza, no
 * una derivación automática.
 */

type JsonSchemaObjeto = {
  type: string;
  properties: Record<string, { type?: unknown; enum?: unknown[] }>;
  required: string[];
  additionalProperties?: boolean;
};

const REQUISITOS: Requisito[] = [{ id: "direccion", tipo: "direccion", etiqueta: "la dirección de entrega", obligatorio: true }];
const MODALIDADES = ["domicilio", "recoger"];

function itemSchema(vertical: "pedidos" | "citas"): JsonSchemaObjeto {
  const raiz = esquemaDeOperaciones(REQUISITOS, vertical, vertical === "pedidos" ? MODALIDADES : []) as {
    properties: { operaciones: { items: JsonSchemaObjeto } };
  };
  return raiz.properties.operaciones.items;
}

/** El `enum` de `tipo` — siempre presente en este esquema, ver `esquemaDeOperaciones`. */
function enumDeTipo(schema: JsonSchemaObjeto): string[] {
  return (schema.properties.tipo?.enum ?? []) as string[];
}

/**
 * Mismo criterio de "modo estricto" que ya comprueba
 * `esquema-json-de-accion.test.ts` sobre `formatoDeRespuestaConEstado`: toda
 * propiedad presente debe estar declarada (`additionalProperties: false`),
 * toda declarada debe estar presente (aunque sea en `null`), y si `tipo`
 * tiene `enum`, el valor debe estar en la lista.
 */
function cumpleElEsquema(payload: Record<string, unknown>, schema: JsonSchemaObjeto): boolean {
  const declaradas = new Set(Object.keys(schema.properties));
  if (schema.additionalProperties === false) {
    for (const k of Object.keys(payload)) if (!declaradas.has(k)) return false;
  }
  for (const req of schema.required) if (!(req in payload)) return false;
  const tipoEnum = enumDeTipo(schema);
  if (tipoEnum.length && !tipoEnum.includes(payload.tipo as string)) return false;
  return true;
}

/** Completa una operación parcial con `null` en todo lo demás requerido — el modo estricto obliga a emitir TODAS las propiedades. */
function completar(schema: JsonSchemaObjeto, parcial: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const req of schema.required) base[req] = null;
  return { ...base, ...parcial };
}

describe("esquemaDeOperaciones (T012) — contrato aislado, sin llamador todavía", () => {
  describe("una operación válida por variante — pedidos", () => {
    const schema = itemSchema("pedidos");
    const casos: Record<string, unknown>[] = [
      { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 },
      { tipo: "cambiar_cantidad", ofrecible: "Pavé chocolate", cantidad: 2 },
      { tipo: "quitar_item", ofrecible: "Pavé chocolate" },
      { tipo: "elegir_opcion", ofrecible: "Waffle", grupo: "Toppings", opcion: "Arequipe" },
      { tipo: "declinar_grupo", ofrecible: "Waffle", grupo: "Toppings" },
      { tipo: "fijar_dato", requisitoId: "direccion", valor: "Cra 1 # 2-3" },
      { tipo: "fijar_modalidad", modalidad: "domicilio" },
      { tipo: "confirmar" },
    ];
    it.each(casos)("$tipo", (parcial) => {
      expect(cumpleElEsquema(completar(schema, parcial), schema)).toBe(true);
    });
  });

  describe("una operación válida por variante — citas", () => {
    const schema = itemSchema("citas");
    const casos: Record<string, unknown>[] = [
      { tipo: "fijar_servicio", servicio: "Manicure" },
      { tipo: "fijar_horario", fecha: "15/01/2026", hora: "10:00", especialista: "Valentina" },
      { tipo: "fijar_especialista", especialista: "Valentina" },
      { tipo: "fijar_dato", requisitoId: "direccion", valor: "3001234567" },
      { tipo: "confirmar" },
    ];
    it.each(casos)("$tipo", (parcial) => {
      expect(cumpleElEsquema(completar(schema, parcial), schema)).toBe(true);
    });
  });

  it("un tipo de citas no existe en el esquema de pedidos, y viceversa", () => {
    const pedidos = itemSchema("pedidos");
    const citas = itemSchema("citas");
    expect(cumpleElEsquema(completar(pedidos, { tipo: "fijar_servicio", servicio: "Manicure" }), pedidos)).toBe(false);
    expect(cumpleElEsquema(completar(citas, { tipo: "agregar_item", ofrecible: "Pavé" }), citas)).toBe(false);
  });

  it("`fijar_modalidad` no aparece en el esquema si el negocio solo ofrece una modalidad", () => {
    const raiz = esquemaDeOperaciones(REQUISITOS, "pedidos", ["domicilio"]) as {
      properties: { operaciones: { items: JsonSchemaObjeto } };
    };
    expect(enumDeTipo(raiz.properties.operaciones.items)).not.toContain("fijar_modalidad");
  });

  it("varias operaciones: cada una se valida por separado, en cualquier combinación", () => {
    const schema = itemSchema("pedidos");
    const lote = [
      completar(schema, { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 }),
      completar(schema, { tipo: "fijar_dato", requisitoId: "direccion", valor: "Ciudad 2000" }),
    ];
    expect(lote.every((op) => cumpleElEsquema(op, schema))).toBe(true);
  });

  it("campos adicionales no declarados rechazan (additionalProperties: false)", () => {
    const schema = itemSchema("pedidos");
    const conCampoExtra = { ...completar(schema, { tipo: "confirmar" }), precioCents: 1000000 };
    expect(cumpleElEsquema(conCampoExtra, schema)).toBe(false);
  });

  it("un campo obligatorio ausente rechaza (modo estricto: todo declarado va en required)", () => {
    const schema = itemSchema("pedidos");
    const completa = completar(schema, { tipo: "agregar_item", ofrecible: "Pavé chocolate", opciones: [], cantidad: 1 });
    const { cantidad: _cantidad, ...sinCantidad } = completa;
    expect(cumpleElEsquema(sinCantidad, schema)).toBe(false);
  });

  it("el estado completo (EstadoDelPedido) NO es el contrato esperado — no tiene `tipo` ni encaja en additionalProperties:false", () => {
    const schema = itemSchema("pedidos");
    // Tal como lo devuelve `estadoVacio()`: items/datos/paso/confirmado/... —
    // exactamente lo que el modelo emitía ANTES de esta feature, y lo que
    // T013 dejará de pedir.
    expect(cumpleElEsquema(estadoVacio() as unknown as Record<string, unknown>, schema)).toBe(false);
  });

  it("strict: additionalProperties:false en la raíz y en cada operación, y required cubre exactamente las propiedades declaradas", () => {
    const raiz = esquemaDeOperaciones(REQUISITOS, "pedidos", MODALIDADES) as JsonSchemaObjeto & {
      properties: { operaciones: JsonSchemaObjeto & { items: JsonSchemaObjeto } };
    };
    expect(raiz.additionalProperties).toBe(false);
    expect(raiz.required).toEqual(["operaciones"]);

    const item = raiz.properties.operaciones.items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  });
});

/**
 * La prueba de deriva: el JSON escrito a mano no puede separarse en silencio
 * de la unión de Zod que de verdad valida `Operacion` (`orders/operaciones.ts`
 * T002, `appointments/operaciones.ts` T003) — esas dos uniones son la fuente
 * de verdad, esta función solo las traduce a JSON-schema.
 */
describe("esquemaDeOperaciones no se separa de las uniones de Zod (orders/appointments)", () => {
  /**
   * `union.options` (unión discriminada de Zod) no tipa bien como parámetro
   * genérico entre `OperacionPedidos`/`OperacionCitas` (cada una es un tipo
   * literal distinto) — mismo criterio pragmático que ya usa
   * `esquema-json-de-accion.test.ts` (`AgentAction as unknown as {...}`) para
   * llegar a los internos de Zod sin pelear con sus genéricos.
   */
  function tiposYCamposDe(union: unknown) {
    const opciones = (union as { options: z.ZodObject<z.ZodRawShape>[] }).options;
    const tipos: string[] = [];
    const campos = new Set<string>();
    for (const opcion of opciones) {
      const literal = opcion.shape.tipo as unknown as { _def: { value: string } };
      tipos.push(literal._def.value);
      for (const campo of Object.keys(opcion.shape)) if (campo !== "tipo") campos.add(campo);
    }
    return { tipos, campos };
  }

  it("todos los `tipo` de pedidos están en el enum del esquema de pedidos", () => {
    const { tipos } = tiposYCamposDe(OperacionPedidos);
    const enumDelSchema = enumDeTipo(itemSchema("pedidos"));
    // fijar_modalidad depende de `modalidadesOfrecidas.length > 1` (aquí sí,
    // por MODALIDADES arriba) — con eso puesto, deben coincidir exactamente.
    expect([...tipos].sort()).toEqual([...enumDelSchema].sort());
  });

  it("todos los `tipo` de citas están en el enum del esquema de citas", () => {
    const { tipos } = tiposYCamposDe(OperacionCitas);
    const enumDelSchema = enumDeTipo(itemSchema("citas"));
    expect([...tipos].sort()).toEqual([...enumDelSchema].sort());
  });

  it("todo campo de las operaciones de pedidos está declarado en el esquema JSON", () => {
    const { campos } = tiposYCamposDe(OperacionPedidos);
    const declaradas = new Set(Object.keys(itemSchema("pedidos").properties));
    const faltan = [...campos].filter((c) => !declaradas.has(c));
    expect(faltan, `campos de Operacion (pedidos) que el esquema JSON no declara: ${faltan.join(", ")}`).toEqual([]);
  });

  it("todo campo de las operaciones de citas está declarado en el esquema JSON", () => {
    const { campos } = tiposYCamposDe(OperacionCitas);
    const declaradas = new Set(Object.keys(itemSchema("citas").properties));
    const faltan = [...campos].filter((c) => !declaradas.has(c));
    expect(faltan, `campos de Operacion (citas) que el esquema JSON no declara: ${faltan.join(", ")}`).toEqual([]);
  });
});
