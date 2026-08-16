/**
 * Los logs no llevan datos de personas — y no pueden volver a llevarlos.
 *
 * El 16-ago-2026 se encontró que dos webhooks volcaban `JSON.stringify(event)`
 * entero: teléfono del cliente, su nombre de perfil y el texto de su mensaje,
 * en el log del contenedor. Uno de los dos se disparaba con los mensajes
 * `unsupported`, que llegan a diario.
 *
 * Aquí hay dos cosas: las pruebas del saneador, y **una prueba de arquitectura**
 * que recorre el código y falla si alguien vuelve a volcar una estructura
 * completa dentro de un `console.*`. La regla escrita se olvida; esta no.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventoParaLog, resumirTexto, sanearEvento } from "@/server/registro-de-cambios";

/** Un entrante de YCloud como los de verdad, con todo lo que trae de sensible. */
const EVENTO = {
  id: "evt_01J9",
  type: "whatsapp.inbound_message.received",
  apiVersion: "v2",
  whatsappInboundMessage: {
    id: "wamid.HBgMNTczMTU4",
    wabaId: "102938475",
    from: "+573165345762",
    fromUserId: "BSUID-9f8a7b6c5d4e",
    to: "573158339990",
    type: "text",
    customerProfile: { name: "Andrea Gómez", username: "andre.g" },
    text: { body: "Hola, quiero una churrita para la Cra 5 #4-32" },
    sendTime: "2026-08-16T01:02:03Z",
  },
};

describe("un evento entrante, listo para el log", () => {
  const salida = eventoParaLog(EVENTO);

  it("no lleva el teléfono, ni el nombre, ni lo que escribió el cliente", () => {
    expect(salida).not.toContain("573165345762");
    expect(salida).not.toContain("Andrea");
    expect(salida).not.toContain("andre.g");
    expect(salida).not.toContain("churrita");
    expect(salida).not.toContain("Cra 5");
    expect(salida).not.toContain("BSUID");
  });

  it("SÍ lleva lo que sirve para reconstruir la secuencia", () => {
    expect(salida).toContain("evt_01J9");
    expect(salida).toContain("whatsapp.inbound_message.received");
    expect(salida).toContain("wamid.HBgMNTczMTU4");
    expect(salida).toContain("2026-08-16T01:02:03Z");
  });

  /*
   * `wabaId` estaba clasificado como SECRETO desde la instrumentación de
   * agosto. El saneador respeta esa decisión en vez de pisarla: la clave se ve
   * —hizo falta para saber que el evento la traía—, el valor no.
   */
  it("un campo ya clasificado como secreto sigue siéndolo aquí", () => {
    expect(salida).toContain("wabaId");
    expect(salida).not.toContain("102938475");
  });

  /*
   * La razón de ser del volcado que esto sustituye: el 2-ago-2026 se descubrió
   * así que algunos clientes mandan `fromUserId` en vez de `from`. Esa pregunta
   * se responde viendo QUÉ CLAVES vienen, no sus valores.
   */
  it("conserva TODAS las claves, incluida una que nadie esperaba", () => {
    expect(salida).toContain("fromUserId");
    expect(salida).toContain("customerProfile");

    const raro = eventoParaLog({ id: "e1", campoNuevoDeYcloud: "573001112233" });
    expect(raro).toContain("campoNuevoDeYcloud");
    expect(raro).not.toContain("573001112233");
  });

  it("dos valores distintos se distinguen; el mismo valor se reconoce", () => {
    expect(resumirTexto("+573165345762")).not.toBe(resumirTexto("+573001112233"));
    expect(resumirTexto("+573165345762")).toBe(resumirTexto("+573165345762"));
  });

  it("un token no se resume: se oculta", () => {
    expect(eventoParaLog({ accessToken: "EAAG123" })).toContain("<oculto>");
    expect(eventoParaLog({ accessToken: "EAAG123" })).not.toContain("EAAG123");
  });

  it("no lanza nunca: ni con ciclos, ni con lo que no se puede serializar", () => {
    const ciclo: Record<string, unknown> = { id: "e1" };
    ciclo.yo = ciclo;
    expect(() => eventoParaLog(ciclo)).not.toThrow();
    expect(eventoParaLog(ciclo)).toContain("e1");

    expect(() => sanearEvento(undefined)).not.toThrow();
    expect(() => sanearEvento(() => {})).not.toThrow();
  });

  it("un anidamiento absurdo se corta en vez de crecer sin fin", () => {
    let hondo: Record<string, unknown> = { fondo: "573001112233" };
    for (let i = 0; i < 20; i++) hondo = { nivel: hondo };
    const salida = eventoParaLog(hondo);
    expect(salida).toContain("<anidado>");
    expect(salida).not.toContain("573001112233");
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────
 * La regla permanente, verificada sobre el código real.
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

/** El argumento completo de cada `console.*`, con paréntesis balanceados. */
function llamadasAConsole(codigo: string): string[] {
  const llamadas: string[] = [];
  const re = /console\.(log|info|warn|error|debug)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) {
    let i = m.index + m[0].length;
    let abiertos = 1;
    while (i < codigo.length && abiertos > 0) {
      if (codigo[i] === "(") abiertos++;
      else if (codigo[i] === ")") abiertos--;
      i++;
    }
    llamadas.push(codigo.slice(m.index, i));
  }
  return llamadas;
}

/** Las interpolaciones `${…}` de una llamada, con llaves balanceadas. */
function interpolaciones(texto: string): string[] {
  const out: string[] = [];
  const re = /\$\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    let i = m.index + 2;
    let abiertas = 1;
    while (i < texto.length && abiertas > 0) {
      if (texto[i] === "{") abiertas++;
      else if (texto[i] === "}") abiertas--;
      i++;
    }
    out.push(texto.slice(m.index + 2, i - 1).replace(/\s+/g, " ").trim());
  }
  return out;
}

/**
 * Lo que no puede interpolarse crudo en un log: son datos de la persona que
 * escribe, no del negocio.
 *
 * `businessPhone`, `msg.to` y `phoneNumberId` **no están** a propósito: son el
 * número comercial del cliente-empresa y un id de Meta, y sin ellos el aviso
 * *"mensaje para un número sin cliente"* no sirve para nada — que es
 * exactamente para lo que se escribió.
 */
const PROHIBIDO_CRUDO = [
  /\.phone\b/i,
  // `.from` es el teléfono del cliente en los eventos de WhatsApp. `Array.from`
  // queda fuera por el negativo: es lo único legítimo que acaba igual.
  /(?<!Array)\.from\b/,
  /\.telefono\b/i,
  /\.direccion\b/i,
  /\.address\b/i,
  /\.text\b/i,
  /\.body\b/i,
  /\bwaUserId\b/,
  /\bfromUserId\b/,
  /\bprofileName\b/,
  /\.caption\b/i,
  /\bcustomerProfile\b/,
];

/** Pasar por el saneador es la salida buena, no una excepción. */
const SANEADO = /resumirTexto\(|paraLog\(|eventoParaLog\(/;

describe("regla del proyecto: ningún log interpola un dato personal crudo", () => {
  it("todo dato de una persona sale por el saneador", () => {
    const culpables: string[] = [];

    for (const archivo of archivosTs(join(process.cwd(), "src"))) {
      const codigo = readFileSync(archivo, "utf8");
      if (!codigo.includes("console.")) continue;

      for (const llamada of llamadasAConsole(codigo)) {
        for (const expr of interpolaciones(llamada)) {
          if (SANEADO.test(expr)) continue;
          if (PROHIBIDO_CRUDO.some((re) => re.test(expr))) {
            culpables.push(`${archivo.replace(process.cwd(), "")}: \${${expr.slice(0, 60)}}`);
          }
        }
      }
    }

    /*
     * Si esto falla: envolver el valor en `resumirTexto()`. Se conserva poder
     * distinguir un valor de otro —y ver si dos son el mismo— sin escribirlo.
     */
    expect(culpables).toEqual([]);
  });

  /*
   * Un guardarraíl que nunca ha fallado no demuestra nada: podría estar
   * buscando algo que no existe. Aquí se le da de comer las dos fugas REALES
   * del 16-ago y sus versiones corregidas.
   */
  it("el detector detecta: las dos fugas reales del 16-ago lo disparan", () => {
    const antes = [
      'console.warn(`from=${m?.from ?? "falta"}`);',
      'console.warn(`tel=${c.phone ?? "-"}, bsuid=${c.waUserId ?? "-"}`);',
    ];
    for (const codigo of antes) {
      const exprs = llamadasAConsole(codigo).flatMap(interpolaciones);
      expect(exprs.some((e) => PROHIBIDO_CRUDO.some((re) => re.test(e)))).toBe(true);
    }

    const despues = [
      'console.warn(`from=${m?.from ? resumirTexto(m.from) : "falta"}`);',
      'console.warn(`tel=${c.phone ? resumirTexto(c.phone) : "-"}`);',
    ];
    for (const codigo of despues) {
      const exprs = llamadasAConsole(codigo).flatMap(interpolaciones);
      expect(exprs.every((e) => SANEADO.test(e) || !PROHIBIDO_CRUDO.some((re) => re.test(e)))).toBe(
        true
      );
    }
  });

  it("no se pasa de listo: el teléfono del NEGOCIO sigue pudiendo registrarse", () => {
    const codigo = 'console.warn(`número sin cliente (to=${msg.to}, waba=${msg.wabaId})`);';
    const exprs = llamadasAConsole(codigo).flatMap(interpolaciones);
    expect(exprs.some((e) => PROHIBIDO_CRUDO.some((re) => re.test(e)))).toBe(false);
  });
});

describe("regla del proyecto: ningún log vuelca una estructura completa", () => {
  it("no hay un solo `console.*` que serialice un objeto entero", () => {
    const culpables: string[] = [];

    for (const archivo of archivosTs(join(process.cwd(), "src"))) {
      const codigo = readFileSync(archivo, "utf8");
      if (!codigo.includes("console.")) continue;

      for (const llamada of llamadasAConsole(codigo)) {
        if (/JSON\.stringify|util\.inspect|inspect\(/.test(llamada)) {
          culpables.push(`${archivo.replace(process.cwd(), "")}: ${llamada.slice(0, 90)}…`);
        }
      }
    }

    /*
     * Si esto falla, el arreglo NO es añadir una excepción: es pasar el objeto
     * por `eventoParaLog()` o `resumirTexto()`, que conservan las claves y la
     * huella sin escribir el contenido.
     */
    expect(culpables).toEqual([]);
  });
});
