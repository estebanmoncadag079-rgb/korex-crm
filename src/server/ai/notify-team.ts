import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  isYcloudEnabled,
  ycloudSendText,
  ycloudSendTemplate,
} from "@/lib/ycloud/client";
import { callGraphSend } from "@/server/inbox/send";
import {
  getCredentialsByOrg,
  normalizePhoneNumber,
} from "@/server/whatsapp/credentials";

/**
 * Aviso interno al equipo del negocio cuando se cierra un pedido.
 *
 * La API oficial de WhatsApp NO escribe a grupos: son mensajes 1:1 a los
 * números que el negocio configura en su agente. Y solo admite texto libre
 * hacia alguien que haya escrito al negocio en las últimas 24 h — por eso el
 * pedido se registra SIEMPRE en el CRM antes de intentar el aviso, y un fallo
 * aquí jamás tumba la toma del pedido.
 */

export type NotifyResult = {
  sent: number;
  failed: number;
  detail: string;
};

/**
 * Lista de destinatarios configurada por el negocio (CSV → E.164 sin '+').
 *
 * Se separa SOLO por coma, punto y coma o salto de línea: la gente escribe
 * "+57 304 683 8172" con espacios dentro del número, y partir por espacios lo
 * rompería en trozos. Se descarta lo que no tenga longitud de teléfono (8-15
 * dígitos, el máximo de E.164).
 */
export function parseNotifyPhones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const digits = normalizePhoneNumber(part);
    if (digits.length >= 8 && digits.length <= 15) seen.add(digits);
  }
  return [...seen];
}

/** Enlace directo para que el equipo le escriba al cliente de un toque. */
export function waMeLink(phone: string): string | null {
  const digits = normalizePhoneNumber(phone);
  if (!digits) return null;
  // 10 dígitos = número colombiano sin indicativo (el formato que teclea la gente).
  return `https://wa.me/${digits.length === 10 ? `57${digits}` : digits}`;
}

export async function notifyTeam(input: {
  organizationId: string;
  summary: string;
  customerPhone?: string | null;
}): Promise<NotifyResult> {
  const db = getDb();
  const rows = await db
    .select({
      notifyPhones: schema.agentProfile.notifyPhones,
      notifyTemplate: schema.agentProfile.notifyTemplate,
      notifyTemplateLang: schema.agentProfile.notifyTemplateLang,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, input.organizationId))
    .limit(1);

  const phones = parseNotifyPhones(rows[0]?.notifyPhones);
  const template = rows[0]?.notifyTemplate?.trim() || null;
  const templateLang = rows[0]?.notifyTemplateLang?.trim() || "es";
  if (phones.length === 0) {
    return {
      sent: 0,
      failed: 0,
      detail:
        "sin números de aviso configurados (el pedido queda solo en la bandeja)",
    };
  }

  const credentials = await getCredentialsByOrg(input.organizationId);
  if (!credentials) {
    return { sent: 0, failed: phones.length, detail: "sin número conectado" };
  }

  const link = input.customerPhone ? waMeLink(input.customerPhone) : null;
  const text = link ? `${input.summary}\n${link}` : input.summary;

  let sent = 0;
  const errors: string[] = [];
  for (const to of phones) {
    try {
      if (isYcloudEnabled()) {
        const from = credentials.displayPhoneNumber ?? "";
        // Con plantilla configurada se usa SIEMPRE: es lo único que atraviesa
        // la ventana de 24 h, y dentro de ella también vale.
        if (template) {
          await ycloudSendTemplate({
            from,
            to,
            name: template,
            language: templateLang,
            bodyParams: [text.replace(/\n/g, " · ")],
          });
        } else {
          await ycloudSendText({ from, to, text });
        }
      } else {
        await callGraphSend(credentials, {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        });
      }
      sent++;
    } catch (err) {
      errors.push(`${to}: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  if (errors.length > 0) {
    console.error(`[aviso pedido] fallaron ${errors.length}: ${errors.join(" | ")}`);
  }
  // "aceptado" ≠ "entregado": WhatsApp acepta el envío y puede rechazarlo
  // después (ventana de 24 h). Sin plantilla eso es lo normal, así que el
  // texto lo dice en vez de dar por bueno un aviso que quizá no llegó.
  const cierre = template ? "" : " (sin plantilla: puede rechazarse fuera de la ventana de 24 h)";
  return {
    sent,
    failed: errors.length,
    detail: errors.length
      ? `enviado a ${sent} de ${phones.length}${cierre} — ${errors.join(" | ")}`
      : `enviado a ${sent} número(s)${cierre}`,
  };
}

/** Teléfono del contacto de una conversación (para el enlace del aviso). */
export async function contactPhoneOf(contactId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ phone: schema.contact.phone })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  return rows[0]?.phone ?? null;
}
