import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Iniciales (máx 2) para el avatar de un contacto. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

/* Paleta desaturada del handoff (AV): sobria sobre fondo claro. */
const AVATAR_COLORS = [
  "bg-[#5b7291]", // steel
  "bg-[#647082]", // slate
  "bg-[#6f8378]", // sage
  "bg-[#8c7d68]", // taupe
  "bg-[#9c7169]", // clay
  "bg-[#77708c]", // dusk
  "bg-[#4f7d78]", // tealm
  "bg-[#6b7280]", // graphite
] as const;

/** Color estable por contacto: hash simple del id/teléfono → misma clase siempre. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** Null = contacto identificado por nombre de usuario de WhatsApp, sin teléfono visible. */
export function formatPhone(phone: string | null): string {
  return phone ? `+${phone}` : "Sin teléfono (usuario de WhatsApp)";
}

/**
 * El celular tal como lo teclea el salón al agendar a mano → E.164 sin "+".
 *
 * Importa más de lo que parece: es lo que une la cita con la conversación de
 * WhatsApp de esa clienta. Guardado con otro formato, la cita cuelga de un
 * contacto distinto — el agente no sabría que ya tiene cita y el botón de
 * recordar le escribiría a nadie. Y en un salón lo teclean como les sale:
 * "300 123 4567", "+57 300…", con guiones o los 10 dígitos pelados.
 */
export function normalizarTelefonoCo(entrada: string): string | null {
  const d = entrada.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) return `57${d}`;
  if (d.length === 12 && d.startsWith("57")) return d;
  // Otro país: se acepta tal cual si tiene un largo razonable.
  return d.length >= 8 && d.length <= 15 ? d : null;
}
