/**
 * Máquina de estados de campañas — diseñada en la auditoría de idempotencia
 * (Fase 4A, 2-sep-2026) e implementada aquí (Fase 4C).
 *
 * Nada en este módulo toca la base de datos, un proveedor de WhatsApp, ni el
 * futuro worker de envío: es solo el vocabulario y las transiciones válidas,
 * para que `cola.ts`/`recovery.ts` las apliquen y los tests las verifiquen sin
 * ambigüedad sobre qué se considera un salto de estado legítimo.
 */

export type CampaignRecipientStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "indeterminado";

export type CampaignSendJobStatus = "pendiente" | "corriendo" | "fallido";

/**
 * A dónde puede ir cada estado de `campaign_recipient`.
 *
 * `sending` es la pieza central: se escribe ANTES de llamar al proveedor (el
 * "outbox" local de la Fase 4A), así que desde ahí SOLO hay dos caminos
 * seguros — `sent`/`failed` cuando el proveedor respondió algo explícito, y
 * `pending` únicamente cuando la llamada NUNCA llegó a completarse (una
 * excepción de red clara, antes de cualquier respuesta). Cualquier otra
 * forma de salir de `sending` sin una respuesta inequívoca del proveedor cae
 * en `indeterminado` — y desde ahí no hay transición automática posible:
 * todas las salidas de `indeterminado` son manuales a propósito.
 */
const TRANSICIONES_RECIPIENT: Record<
  CampaignRecipientStatus,
  readonly CampaignRecipientStatus[]
> = {
  pending: ["sending", "skipped"],
  sending: ["sent", "failed", "pending", "indeterminado"],
  sent: [],
  failed: ["pending"],
  skipped: [],
  // Nunca aparece como origen de una transición automática — solo un humano
  // decide sacar un recipient de aquí (`salidaManualDeIndeterminado`).
  indeterminado: ["pending", "sent", "failed"],
};

/** ¿Es válida esta transición según el diseño de la Fase 4A? Pura, sin efectos. */
export function transicionRecipientValida(
  desde: CampaignRecipientStatus,
  hacia: CampaignRecipientStatus
): boolean {
  return TRANSICIONES_RECIPIENT[desde].includes(hacia);
}

/**
 * Las únicas transiciones que un proceso automático (worker, recovery) puede
 * ejecutar sin intervención humana. Deliberadamente más estrecho que
 * `transicionRecipientValida`: `indeterminado → *` es sintácticamente válido
 * (para que un humano pueda hacerlo desde el panel), pero NUNCA debe
 * ejecutarlo un proceso automático — por eso las funciones de `cola.ts` y
 * `recovery.ts` deben comprobar contra esta lista, no contra la anterior.
 */
const TRANSICIONES_AUTOMATICAS_PERMITIDAS: readonly [
  CampaignRecipientStatus,
  CampaignRecipientStatus,
][] = [
  ["pending", "sending"],
  ["pending", "skipped"],
  ["sending", "sent"],
  ["sending", "failed"],
  ["sending", "pending"],
  ["sending", "indeterminado"],
  ["failed", "pending"],
];

export function transicionAutomaticaPermitida(
  desde: CampaignRecipientStatus,
  hacia: CampaignRecipientStatus
): boolean {
  return TRANSICIONES_AUTOMATICAS_PERMITIDAS.some(
    ([d, h]) => d === desde && h === hacia
  );
}
