/**
 * La ficha se lee y se guarda sin perder nada — y nadie puede saltarse la puerta.
 *
 * 🔴 **Por qué existe este archivo.** El 17-ago-2026, un script leyó dos fichas
 * de producción con `leerFicha()` —que las **aplana** para dárselas al
 * generador— y guardó ese resultado tal cual. Las dos perdieron
 * `schema_version`, `negocio`, `flujo` y `politicas`: el modelo construido dos
 * días antes para que el cuestionario del cliente no pise lo que escribió la
 * agencia. Se detectó porque una consulta de rutina devolvió `vertical` vacío.
 *
 * Lo peor no fue el error: fue que **la función correcta ya existía**
 * (`serializarComoEstaba`) y nada obligaba a usarla.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aSecciones,
  camposSinDueño,
  esPorSecciones,
  leerFichaAplanada,
  serializarComoEstaba,
} from "@/server/ai/generador/leer-ficha";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

/** Una ficha con TODO lo que hay que conservar, incluido `cierre`. */
const COMPLETA = {
  nombre: "Negocio de prueba",
  vertical: "pedidos",
  queVende: "lo que sea",
  catalogo: "COSA — $10.000\nOTRA — $20.000",
  tono: "cercano",
  ubicacion: "Cra 1 #2-3",
  horario: { abre: "9:00 AM", cierra: "6:00 PM", dias: [1, 2, 3, 4, 5] },
  entrega: { haceDomicilios: true, quienPagaElDomicilio: "el cliente" },
  pago: { formas: "efectivo", compruebaUnaPersona: true },
  saludoInicial: "Hola",
  reglasPropias: "el 0 reinicia",
  preguntasFrecuentes: [{ pregunta: "¿abren?", respuesta: "sí" }],
  escalarSiempre: ["devoluciones"],
  nuncaPrometer: ["nada de salud"],
  cierre: {
    requisitos: [
      { id: "nombre", tipo: "texto", etiqueta: "el nombre", obligatorio: true },
      {
        id: "direccion",
        tipo: "direccion",
        etiqueta: "la dirección",
        obligatorio: true,
        soloSi: "entrega.haceDomicilios",
      },
    ],
  },
} as unknown as FichaDelNegocio;

describe("ida y vuelta: guardar una ficha no puede perder nada", () => {
  it("plana → secciones → plana devuelve EXACTAMENTE lo mismo", () => {
    const ida = aSecciones(COMPLETA);
    const vuelta = leerFichaAplanada(JSON.stringify(ida));
    expect(vuelta).toEqual(COMPLETA);
  });

  it("y conserva los seis campos que importan, uno a uno", () => {
    const guardada = JSON.parse(JSON.stringify(aSecciones(COMPLETA)));

    expect(guardada.schema_version).toBe(2);
    expect(guardada.negocio).toBeDefined();
    expect(guardada.flujo).toBeDefined();
    expect(guardada.politicas).toBeDefined();
    // `catalogo` es del negocio; `cierre`, del flujo: lo escribe la agencia.
    expect(guardada.negocio.catalogo).toBe(COMPLETA.catalogo);
    expect(guardada.flujo.cierre.requisitos).toHaveLength(2);
  });

  it("ningún campo se queda sin dueño: si alguien añade uno, esto lo caza", () => {
    expect(camposSinDueño(COMPLETA)).toEqual([]);
  });

  it("`serializarComoEstaba` respeta la forma en que estaba guardada", () => {
    const enSecciones = JSON.stringify(aSecciones(COMPLETA));
    const enPlano = JSON.stringify(COMPLETA);

    // Guardada por secciones → sale por secciones.
    expect(esPorSecciones(JSON.parse(serializarComoEstaba(enSecciones, COMPLETA)))).toBe(true);
    // Guardada plana → sale plana. Convertirla sería decidir por quien la creó.
    expect(esPorSecciones(JSON.parse(serializarComoEstaba(enPlano, COMPLETA)))).toBe(false);
  });

  /*
   * EL ERROR DEL 17-AGO, reproducido: así es como se pierden las secciones.
   * Se fija aquí para que quede claro qué NO hay que hacer, y que el día que
   * alguien lo haga, esta prueba explique por qué está mal.
   */
  it("guardar lo que devuelve `leerFichaAplanada` PIERDE las secciones", () => {
    const guardadaBien = JSON.stringify(aSecciones(COMPLETA));
    const leida = leerFichaAplanada(guardadaBien)!;

    const malGuardada = JSON.parse(JSON.stringify(leida)); // ← el error
    expect(malGuardada.schema_version).toBeUndefined();
    expect(malGuardada.negocio).toBeUndefined();

    const bienGuardada = JSON.parse(serializarComoEstaba(guardadaBien, leida));
    expect(bienGuardada.schema_version).toBe(2);
    expect(bienGuardada.negocio).toBeDefined();
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * EL GUARDARRAÍL: nadie escribe `ficha` sin pasar por la puerta.
 * ────────────────────────────────────────────────────────────────────────
 */
function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) archivosTs(ruta, acc);
    else if (/\.tsx?$/.test(entrada)) acc.push(ruta);
  }
  return acc;
}

/**
 * Es seguro este valor escrito en `ficha:`?
 *
 * Se mira DE DONDE SALE, no si el archivo menciona la puerta en alguna linea
 * suelta: esa comprobacion laxa dejaba pasar cualquier escritura nueva en un
 * archivo que ya la usara, que es justo el caso en el que alguien se equivoca.
 */
function escrituraSegura(codigo: string, crudo: string): boolean {
  // `JSON.stringify(x)` no aporta nada: lo que importa es de dónde sale `x`.
  const valor = crudo.match(/^JSON\.stringify\((.+)\)$/)?.[1]?.trim() ?? crudo;
  // Pasa por la puerta, ahi mismo.
  if (/serializarComoEstaba|aSecciones/.test(valor)) return true;
  // Un string crudo de la base o de un respaldo: no se transformo.
  if (/^(previo|original|antes|guardada)\./.test(valor)) return true;
  // Una variable: se busca COMO SE CONSTRUYO.
  const nombre = valor.match(/^[A-Za-z_$][\w$]*$/)?.[0];
  if (!nombre) return false;
  /*
   * Se parte por `;` —así una declaración multilínea sigue siendo un trozo— y
   * se busca la que declara esa variable. Sin construir expresiones regulares
   * al vuelo: una barra mal escapada convierte el guardarraíl en un "siempre
   * pasa" sin que nadie se entere. Pasó al escribir esta misma función.
   */
  const declaracion = codigo
    .split(";")
    .find((trozo) =>
      ["const", "let", "var"].some(
        (kw) => trozo.includes(`${kw} ${nombre} `) || trozo.includes(`${kw} ${nombre}=`)
      )
    );
  if (!declaracion) return false;
  /*
   * Segura si pasó por la puerta… o si es el string CRUDO que se acaba de leer
   * de la base (`fila.ficha`): eso no se transformó, así que no pudo perder
   * nada. Es el caso del rollback de `convertir-ficha`.
   */
  return /serializarComoEstaba|aSecciones|previo\.|antes\.|\.ficha\b/.test(declaracion);
}


describe("regla: una ficha transformada nunca se persiste", () => {
  it("toda escritura de `ficha` pasa por serializarComoEstaba o aSecciones", () => {
    const culpables: string[] = [];
    const raices = [join(process.cwd(), "src"), join(process.cwd(), "scripts")];

    for (const raiz of raices) {
      for (const archivo of archivosTs(raiz)) {
        const codigo = readFileSync(archivo, "utf8");
        // Cada `.set({ ... ficha: X ... })` de drizzle.
        for (const m of codigo.matchAll(/\.set\(\{[^}]*\bficha:\s*([^,}]+)/g)) {
          const valor = m[1]!.trim();
          if (!escrituraSegura(codigo, valor)) {
            culpables.push(`${archivo.replace(process.cwd(), "")}: ficha: ${valor}`);
          }
        }
      }
    }

    /*
     * Si esto falla: la ficha se está guardando desde una representación que
     * pudo perder las secciones. La salida es `serializarComoEstaba(cruda, ficha)`.
     */
    expect(culpables).toEqual([]);
  });

  /*
   * Un guardarraíl que nunca ha fallado no demuestra nada. Aquí se le da de
   * comer EL CÓDIGO EXACTO que rompió las dos fichas del 17-ago.
   */
  it("EL DETECTOR DETECTA: el código que rompió las fichas lo dispara", () => {
    const elError = `
      const cruda = leerFicha(p.ficha);
      const nueva = JSON.stringify({ ...cruda, cierre: { requisitos: sugeridos } });
      await db.update(schema.agentProfile).set({ ficha: nueva, updatedAt: new Date() });
    `;
    expect(escrituraSegura(elError, "nueva")).toBe(false);

    const corregido = `
      const nueva = serializarComoEstaba(p.ficha, conCierre);
      await db.update(schema.agentProfile).set({ ficha: nueva, updatedAt: new Date() });
    `;
    expect(escrituraSegura(corregido, "nueva")).toBe(true);
  });

  it("no se pasa de listo: guardar un respaldo crudo sigue estando permitido", () => {
    const respaldo = `await db.update(x).set({ ficha: previo.ficha });`;
    expect(escrituraSegura(respaldo, "previo.ficha")).toBe(true);
  });
});
