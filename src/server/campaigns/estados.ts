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
  /**
   * `sending → skipped` (Fase 6A): el worker sigue el orden pedido —
   * reclamar primero (evidencia de intento, sending), revalidar opt-out
   * DESPUÉS — así que el recipient ya puede estar en `sending` cuando se
   * descubre que hay que omitirlo. No se revalida opt-out antes del claim
   * a propósito: el orden lo fija el diseño del worker, no esta función.
   */
  sending: ["sent", "failed", "pending", "indeterminado", "skipped"],
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
  ["sending", "skipped"],
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

/**
 * Máquina de estados de `campaign` (Fase 6A) — mismo espíritu que la de
 * `campaign_recipient`: nada de transiciones arbitrarias, nada de estados
 * inventados. Los 8 valores ya existen en el schema desde la Fase 3C.
 */
export type CampaignStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "processing"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

const TRANSICIONES_CAMPAIGN: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["scheduled", "processing", "cancelled"],
  scheduled: ["processing", "cancelled"],
  // `paused` (401/reconexión, Fase 6A punto 14) y `failed` (error
  // estructural, no destinatarios individuales) son los dos únicos destinos
  // de una campaña que ya está corriendo, además del cierre normal.
  processing: ["paused", "completed", "failed"],
  paused: ["processing", "cancelled"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function transicionCampanaValida(
  desde: CampaignStatus,
  hacia: CampaignStatus
): boolean {
  return TRANSICIONES_CAMPAIGN[desde].includes(hacia);
}
