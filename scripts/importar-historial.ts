/**
 * Baja el historial de WhatsApp desde la API de YCloud y lo guarda en el CRM.
 *
 * **Por qué existe**: al activar la coexistencia, WhatsApp sincroniza hasta 6
 * meses de chats y YCloud los reenvía por webhook
 * ([59](../docs/korexia/59-APRENDER-DEL-HISTORIAL.md)). Pero si el endpoint del
 * webhook se crea DESPUÉS de esa sincronización —que es lo normal cuando el
 * cliente trae su propia cuenta de YCloud— ese lote ya pasó y **no se
 * reintenta**. Le ocurrió a Lashes Valen el 14-ago-2026.
 *
 * Este script recupera lo que quedó guardado en YCloud, sin depender del
 * webhook.
 *
 * ⚠️ **Solo trae los mensajes SALIENTES.** `/whatsapp/messages` devuelve lo que
 * envió el negocio; los entrantes (`/whatsapp/inboundMessages`) responden
 * `404 · No message available`: YCloud no los expone. Se pierde qué preguntó
 * cada clienta, pero se conserva **lo que contestó el negocio**, que es
 * justamente donde el aprendizaje busca el conocimiento
 * ([11](../docs/korexia/11-APRENDIZAJE.md)).
 *
 * Uso:
 *   pnpm importar:historial <organizationId>            → cuenta, no escribe
 *   pnpm importar:historial <organizationId> --aplicar  → guarda
 */
import { readFileSync } from "node:fs";

function envVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    return readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim();
  } catch {
    return undefined;
  }
}
for (const n of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const organizationId = process.argv[2]!;
const aplicar = process.argv.includes("--aplicar");
if (!organizationId) {
  console.error("Uso: pnpm importar:historial <organizationId> [--aplicar]");
  process.exit(1);
}

const { getCredentialsByOrg } = await import("@/server/whatsapp/credentials");
const { ingestHistoryMessage } = await import("@/server/inbox/ingest");

const cred = await getCredentialsByOrg(organizationId);
if (!cred?.token) {
  console.error(
    `[historial] ${organizationId} no tiene API key propia de YCloud guardada.`
  );
  process.exit(1);
}

/** Un mensaje tal como lo devuelve YCloud. */
type MensajeYcloud = {
  wamid?: string;
  id?: string;
  from?: string;
  to?: string;
  toUserId?: string;
  type?: string;
  text?: { body?: string } | string;
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
  sendTime?: string;
  createTime?: string;
};

const PAGINA = 100;
/** Tope de seguridad: 6 meses de un salón pequeño caben de sobra. */
const MAX = 5000;

function textoDe(m: MensajeYcloud): string | null {
  if (typeof m.text === "string") return m.text;
  return (
    m.text?.body ??
    m.image?.caption ??
    m.video?.caption ??
    m.document?.caption ??
    null
  );
}

let offset = 0;
let leidos = 0;
let guardados = 0;
let repetidos = 0;
let sinTexto = 0;
let sinDestinatario = 0;
let masAntiguo: string | null = null;

while (leidos < MAX) {
  const res = await fetch(
    `https://api.ycloud.com/v2/whatsapp/messages?limit=${PAGINA}&offset=${offset}`,
    { headers: { "X-API-Key": cred.token, accept: "application/json" } }
  );
  if (!res.ok) {
    console.error(`[historial] YCloud respondió ${res.status}; se detiene aquí`);
    break;
  }
  const data = (await res.json()) as { items?: MensajeYcloud[] };
  const items = data.items ?? [];
  if (items.length === 0) break;

  for (const m of items) {
    leidos++;
    const waMessageId = m.wamid ?? m.id;
    const fecha = m.sendTime ?? m.createTime;
    if (fecha && (!masAntiguo || fecha < masAntiguo)) masAntiguo = fecha;

    const texto = textoDe(m);
    if (!waMessageId) continue;
    // Sin texto no aporta nada al conocimiento: un sticker o un audio del que
    // no se guarda transcripción es una fila muda en la conversación.
    if (!texto) {
      sinTexto++;
      continue;
    }
    if (!m.to && !m.toUserId) {
      sinDestinatario++;
      continue;
    }

    if (!aplicar) continue;
    const { guardado } = await ingestHistoryMessage({
      organizationId,
      direction: "out",
      customerPhone: m.to ? m.to.replace(/^\+/, "") : null,
      customerWaUserId: m.toUserId ?? null,
      waMessageId,
      type: m.type ?? "text",
      text: texto,
      timestamp: String(
        Math.floor((fecha ? Date.parse(fecha) : Date.now()) / 1000)
      ),
    });
    if (guardado) guardados++;
    else repetidos++;
  }

  offset += items.length;
  if (items.length < PAGINA) break;
}

console.log(`[historial] leídos de YCloud: ${leidos}`);
console.log(`[historial] el más antiguo: ${masAntiguo ?? "—"}`);
console.log(`[historial] sin texto (audio, sticker, foto sin pie): ${sinTexto}`);
if (sinDestinatario) console.log(`[historial] sin destinatario: ${sinDestinatario}`);
if (aplicar) {
  console.log(`[historial] GUARDADOS: ${guardados} · ya estaban: ${repetidos}`);
} else {
  console.log("[historial] nada escrito (falta --aplicar)");
}
process.exit(0);
