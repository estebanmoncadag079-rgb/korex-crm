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

/** A partir de aquí no se vuelca el valor: se resume. */
const LARGO_MAXIMO = 120;

function esSecreto(campo: string): boolean {
  const c = campo.toLowerCase();
  return SECRETOS.some((s) => c.includes(s.toLowerCase()));
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
  if (texto.length <= LARGO_MAXIMO) {
    // Los saltos de línea romperían "una línea por cambio".
    return texto.replace(/\s+/g, " ");
  }
  let huella = 0;
  for (let i = 0; i < texto.length; i++) {
    huella = (huella * 31 + texto.charCodeAt(i)) | 0;
  }
  return `<${texto.length} caracteres · huella ${(huella >>> 0).toString(16)}>`;
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
