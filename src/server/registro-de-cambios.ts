/**
 * Registro de cambios en datos operativos — trazabilidad por LOG ESTRUCTURADO.
 *
 * **Por qué existe**: el 15-ago-2026 el horario del salón se revirtió dos veces.
 * La segunda pudo atribuirse porque el `updated_at` coincidía al segundo con una
 * ejecución conocida. **La primera no**: su marca ya había sido pisada por la
 * escritura siguiente. Reconstruir aquello costó una auditoría forense sobre
 * respaldos de 6 en 6 horas, y aun así quedó sin autor.
 *
 * Un `updated_at` responde *cuándo*. No responde *qué campo*, ni *qué valor
 * tenía antes*, ni *qué proceso lo hizo*. Esto sí.
 *
 * **Por qué log y no tabla** (decisión del dueño, 15-ago): no toca el esquema,
 * no necesita migración, y responde cinco de las seis preguntas desde el primer
 * despliegue. La tabla se decidirá cuando se sepa qué preguntas se hacen de
 * verdad al leer estos logs.
 *
 * Formato, una línea por CAMPO que cambia:
 *
 *   [cambio] tabla=agent_profile registro=org_x campo=hours_open
 *            valor_anterior=09:30 valor_nuevo=09:00
 *            proceso=aplicarFicha actor=user:abc timestamp=2026-08-15T19:46:41.403Z
 */
import { compararFila, type Fila } from "@/server/ai/generador/comparar-fila";

/**
 * Quién hizo el cambio. No siempre hay una persona detrás, y fingir que sí la
 * hay es peor que decir la verdad:
 *
 * - `user:<id>`   una persona autenticada en la web
 * - `script:<n>`  un script ejecutado a mano por el operador
 * - `pipeline`    el agente, durante una conversación
 * - `sistema`     arranque, migración, tarea programada
 */
export type Actor = `user:${string}` | `script:${string}` | "pipeline" | "sistema";

/**
 * Campos cuyo VALOR nunca se escribe en el log, pase lo que pase.
 *
 * Un registro de cambios acaba en un fichero que se lee a ojo y se pega en un
 * chat: es el último sitio donde debe aparecer un token de WhatsApp. De estos
 * campos se registra que cambiaron, no a qué.
 */
const SECRETOS = [
  "accessToken",
  "token",
  "apiKey",
  "password",
  "secret",
  "phoneNumberId",
  "wabaId",
];

/**
 * Campos con datos de una PERSONA: de estos se registra **que cambiaron y si
 * volvieron a un valor anterior**, nunca a qué.
 *
 * No es lo mismo que un secreto. Un token se oculta y punto; un teléfono hay
 * que poder seguirlo sin leerlo — «cambió» y «volvió al de antes» son preguntas
 * legítimas al investigar un pedido, y la huella las contesta las dos.
 *
 * ⚠️ **La comparación es EXACTA, no por substring.** Con `includes` bastaba
 * poner `"nombre"` para que `producto.nombre` —el nombre de un churro— quedara
 * oculto también, y ahí se pierde trazabilidad de negocio sin ganar privacidad.
 */
const PERSONALES = [
  "entrega.nombre",
  "entrega.telefono",
  "entrega.direccion",
  "notifyphones",
  "telefono",
  "direccion",
  "phone",
  "address",
];

/**
 * La red para el campo que alguien añada mañana.
 *
 * Siete dígitos seguidos dentro de un texto es un teléfono, un documento o una
 * cuenta. Se aplica **solo a cadenas**: `totalCents` son 1000000 y es un número,
 * no una persona.
 */
const PARECE_IDENTIFICADOR = /\d{7,}/;

/** A partir de aquí no se vuelca el valor: se resume. */
const LARGO_MAXIMO = 120;

function esSecreto(campo: string): boolean {
  const c = campo.toLowerCase();
  return SECRETOS.some((s) => c.includes(s.toLowerCase()));
}

function esPersonal(campo: string): boolean {
  return PERSONALES.includes(campo.toLowerCase());
}

/** Un número estable a partir del texto: mismo valor, misma huella. */
function huellaDe(texto: string): string {
  let huella = 0;
  for (let i = 0; i < texto.length; i++) {
    huella = (huella * 31 + texto.charCodeAt(i)) | 0;
  }
  return (huella >>> 0).toString(16);
}

/**
 * Un valor listo para el log: corto, en una línea y sin secretos.
 *
 * Los campos largos —`instructions` son 17.000 caracteres— se resumen con su
 * longitud y una huella. Con eso basta para saber **si** cambió y **si volvió**
 * a un valor anterior, que es la pregunta que se hace de verdad al investigar.
 */
export function paraLog(campo: string, valor: unknown): string {
  if (esSecreto(campo)) return "<oculto>";
  if (valor === null) return "null";
  if (valor === undefined) return "ausente";
  if (valor instanceof Date) return valor.toISOString();

  const texto = typeof valor === "object" ? JSON.stringify(valor) : String(valor);

  /*
   * El dato de una persona no se escribe, ni corto ni largo.
   *
   * Sin esto, encender la Fase 2 habría llenado el log del contenedor de
   * teléfonos y direcciones de clientes finales — `entrega.telefono` cabe de
   * sobra en los 120 caracteres, así que salía tal cual. La huella conserva lo
   * único que se pregunta al investigar: si cambió, y si volvió al de antes.
   */
  if (esPersonal(campo) || (typeof valor === "string" && PARECE_IDENTIFICADOR.test(texto))) {
    return `<personal · ${texto.length} caracteres · huella ${huellaDe(texto)}>`;
  }

  if (texto.length <= LARGO_MAXIMO) {
    // Los saltos de línea romperían "una línea por cambio".
    return texto.replace(/\s+/g, " ");
  }
  return `<${texto.length} caracteres · huella ${huellaDe(texto)}>`;
}

/**
 * Claves cuyo valor de TEXTO se conserva en claro dentro de un evento: son
 * identificadores y metadatos, nunca contenido escrito por una persona.
 *
 * Es una **lista de lo permitido**, al revés que `PERSONALES`. En un evento de
 * webhook todo lo que no sea un identificador conocido es, por defecto,
 * contenido del usuario — y lo que llegue mañana con un nombre que nadie previó
 * también. Es la única forma de que un campo nuevo no se vuelque solo.
 */
const IDENTIFICADORES = [
  "id",
  "type",
  "wabaid",
  "status",
  "mimetype",
  "sendtime",
  "createtime",
  "updatetime",
  "timestamp",
  "errorcode",
  "code",
  "direction",
  "event",
  "version",
  "apiversion",
];

/** Un texto libre reducido a lo que se puede escribir: cuánto medía y cuál era. */
export function resumirTexto(valor: unknown): string {
  if (valor === null) return "null";
  if (valor === undefined) return "ausente";
  const texto = String(valor);
  return `<${texto.length} caracteres · huella ${huellaDe(texto)}>`;
}

/** Hasta dónde se baja en un objeto anidado antes de resumirlo entero. */
const PROFUNDIDAD_MAXIMA = 6;

/**
 * Un evento entrante, listo para el log: **se conservan todas las CLAVES y se
 * resumen los VALORES de texto** que no sean identificadores.
 *
 * Por qué así y no una lista de campos a tapar: los dos volcados que esto
 * sustituye existían para diagnosticar **qué campo traía el dato** cuando el
 * parser fallaba — el 2-ago-2026 se descubrió así que algunos clientes mandan
 * `fromUserId` en vez de `from`. Esa pregunta se responde viendo las claves,
 * no los valores. Con esto se sigue viendo una clave que nadie esperaba, y su
 * huella distingue un valor de otro sin escribir ninguno de los dos.
 *
 * **Nunca lanza**: un evento con ciclos o un objeto raro no puede tumbar el
 * webhook que se está registrando.
 */
export function sanearEvento(valor: unknown, profundidad = 0): unknown {
  if (valor === null || valor === undefined) return valor ?? null;
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (valor instanceof Date) return valor.toISOString();

  if (typeof valor === "string") return resumirTexto(valor);

  if (profundidad >= PROFUNDIDAD_MAXIMA) return "<anidado>";

  if (Array.isArray(valor)) {
    return valor.map((v) => sanearEvento(v, profundidad + 1));
  }

  if (typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (esSecreto(clave)) {
        salida[clave] = "<oculto>";
      } else if (typeof v === "string" && IDENTIFICADORES.includes(clave.toLowerCase())) {
        // Un identificador se conserva, pero acotado: nada de textos largos
        // colándose por una clave llamada `code`.
        salida[clave] = v.length <= LARGO_MAXIMO ? v : resumirTexto(v);
      } else {
        salida[clave] = sanearEvento(v, profundidad + 1);
      }
    }
    return salida;
  }

  return "<no serializable>";
}

/** `sanearEvento` ya listo para interpolar en una línea de log. */
export function eventoParaLog(evento: unknown): string {
  try {
    return JSON.stringify(sanearEvento(evento));
  } catch (err) {
    return `<no se pudo sanear: ${(err as Error).message}>`;
  }
}

export type Cambio = {
  tabla: string;
  registro: string;
  campo: string;
  valorAnterior: string;
  valorNuevo: string;
  proceso: string;
  actor: Actor;
  timestamp: string;
  /** `true` si el escritor NO declaró que iba a tocar este campo. */
  noDeclarado: boolean;
};

export function formatear(c: Cambio): string {
  return (
    `[cambio]${c.noDeclarado ? "[NO DECLARADO]" : ""} tabla=${c.tabla} registro=${c.registro} ` +
    `campo=${c.campo} valor_anterior=${c.valorAnterior} valor_nuevo=${c.valorNuevo} ` +
    `proceso=${c.proceso} actor=${c.actor} timestamp=${c.timestamp}`
  );
}

/**
 * El ÚNICO punto de instrumentación. Toda escritura de datos operativos pasa
 * por aquí: se le da la fila entera antes y después, y él decide qué registrar.
 *
 * No lanza nunca: un fallo registrando no puede tumbar la operación que se está
 * registrando. Si algo va mal, se pierde la traza, no el pedido del cliente.
 *
 * @param declarados Campos que el proceso dice que va a cambiar. Los que
 *   cambien sin estar declarados se marcan `[NO DECLARADO]`, que es la señal
 *   que habría cazado lo del horario el mismo día.
 */
export function registrarCambios(entrada: {
  tabla: string;
  registro: string;
  antes: Fila;
  despues: Fila;
  declarados: readonly string[];
  proceso: string;
  actor: Actor;
  ahora?: Date;
}): Cambio[] {
  try {
    const { declarados: cambiados, noDeclarados } = compararFila(
      entrada.antes,
      entrada.despues,
      entrada.declarados
    );
    const timestamp = (entrada.ahora ?? new Date()).toISOString();

    const cambios: Cambio[] = [...cambiados, ...noDeclarados].map((d) => ({
      tabla: entrada.tabla,
      registro: entrada.registro,
      campo: d.campo,
      valorAnterior: paraLog(d.campo, d.de),
      valorNuevo: paraLog(d.campo, d.a),
      proceso: entrada.proceso,
      actor: entrada.actor,
      timestamp,
      noDeclarado: noDeclarados.some((n) => n.campo === d.campo),
    }));

    for (const c of cambios) console.log(formatear(c));
    return cambios;
  } catch (err) {
    // Ni siquiera esto puede romper una escritura.
    console.warn(`[cambio] no se pudo registrar: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Envuelve una escritura y la registra: lee la fila entera antes, ejecuta, lee
 * la fila entera después y anota lo que cambió.
 *
 * Existe para que instrumentar un proceso cueste tres líneas. Cuanto más caro
 * sea instrumentar, más sitios quedarán sin instrumentar — y el que falte será
 * justo por donde entre el próximo cambio silencioso.
 *
 * **No altera el flujo**: devuelve lo que devuelva la operación, y si algo falla
 * registrando, la operación ya ocurrió y su resultado se respeta.
 */
export async function conRegistro<T>(
  entrada: {
    tabla: string;
    registro: string;
    /** Lee la fila COMPLETA. `null` si aún no existe (un alta). */
    leerFila: () => Promise<Fila | null>;
    declarados: readonly string[];
    proceso: string;
    actor: Actor;
  },
  operacion: () => Promise<T>
): Promise<T> {
  let antes: Fila | null = null;
  try {
    antes = await entrada.leerFila();
  } catch {
    antes = null; // no poder leer el antes no puede impedir la escritura
  }

  const resultado = await operacion();

  try {
    const despues = await entrada.leerFila();
    if (antes && despues) {
      registrarCambios({
        tabla: entrada.tabla,
        registro: entrada.registro,
        antes,
        despues,
        declarados: entrada.declarados,
        proceso: entrada.proceso,
        actor: entrada.actor,
      });
    } else if (!antes && despues) {
      console.log(
        `[cambio] tabla=${entrada.tabla} registro=${entrada.registro} campo=<fila nueva> ` +
          `valor_anterior=ausente valor_nuevo=<creada> proceso=${entrada.proceso} ` +
          `actor=${entrada.actor} timestamp=${new Date().toISOString()}`
      );
    }
  } catch (err) {
    console.warn(`[cambio] no se pudo registrar: ${(err as Error).message}`);
  }

  return resultado;
}
