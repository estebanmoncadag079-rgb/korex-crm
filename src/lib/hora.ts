/**
 * Una sola forma de entender la hora que escribe una persona.
 *
 * Hasta el 13-ago-2026 había DOS lectores distintos del horario del negocio, y
 * ninguno aceptaba lo que un cliente escribe de verdad:
 *
 * - `toMinutes` (prompts.ts) exigía `HH:MM` con una expresión regular y
 *   devolvía `null` → el agente no sabía si el negocio estaba abierto.
 * - `horaAMin` (appointments/logic.ts) hacía `Number("9 AM")` → **NaN**, y con
 *   NaN la ventana del día no genera ni un hueco: la agenda entera parece
 *   llena, todos los días y para todos los servicios.
 *
 * El salón de pruebas guardó su horario como `9 AM` / `8 PM` y el agente pasó
 * dos días rechazando cada cita —"ese día está full"— con la agenda vacía. Nada
 * falló de forma visible: ni un error, ni un log, ni un aviso en el panel.
 *
 * Por eso esto vive en `lib/` y lo usan los dos: el formato de la hora no es
 * asunto de las citas ni del prompt, es del dato.
 */

/**
 * Lo que escriba una persona → `"HH:MM"` en 24 h, o `null` si no hay forma de
 * entenderlo.
 *
 * Acepta `9`, `9:30`, `21:00`, `9 AM`, `9am`, `9:30 p.m.` y sus variantes con
 * mayúsculas, espacios o puntos. Sin sufijo se interpreta como 24 h, que es
 * como lo escriben los clientes que ya lo tenían bien (`12:30`, `20:00`).
 */
export function normalizarHora(texto: string | null | undefined): string | null {
  // Fuera espacios y puntos: "9 AM" → "9am", "9:30 p. m." → "9:30pm".
  const t = (texto ?? "").toLowerCase().replace(/[.\s]/g, "");
  if (!t) return null;

  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;

  let hora = Number(m[1]);
  const minuto = Number(m[2] ?? 0);
  const sufijo = m[3];
  if (minuto > 59) return null;

  if (sufijo) {
    // Con AM/PM el reloj es de 12: "0 pm" o "13 pm" no significan nada.
    if (hora < 1 || hora > 12) return null;
    if (sufijo === "am") hora = hora === 12 ? 0 : hora;
    else hora = hora === 12 ? 12 : hora + 12;
  } else if (hora > 23) {
    return null;
  }

  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

/** Minutos desde medianoche, o `null` si la hora no se entiende. */
export function horaAMinutos(texto: string | null | undefined): number | null {
  const hhmm = normalizarHora(texto);
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}
