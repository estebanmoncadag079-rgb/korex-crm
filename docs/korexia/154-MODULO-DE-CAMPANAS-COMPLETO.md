# El módulo de campañas, completo: costos reales, segmentación, aprobación y delivery

> **Dentro:** Qué quedó construido en las fases 10B-10I sobre el motor que
> ya existía (doc 153) · el worker real que faltaba · costos reales y de
> dónde sale el número · los cinco modos de audiencia · el flujo de
> aprobación · sincronización con YCloud · delivery status · cómo probarlo
> · qué falta

**3-sep-2026.** Cierra los cuatro bloqueadores que dejó abiertos
[153-AUDITORIA-CAMPANAS-CONTACTOS-COSTOS-VENTANA24H.md](153-AUDITORIA-CAMPANAS-CONTACTOS-COSTOS-VENTANA24H.md):
el motor no corría solo, no había costo real, no había segmentación, y no
había ninguna pantalla. Construido sobre el motor de campañas ya existente
(`motor.ts`/`cola.ts`/`worker.ts`/`recovery.ts`/`estados.ts`) — nada de eso
se rediseñó, solo se extendió.

## 1. El worker ya corre solo (Fase 10B)

`src/server/campaigns/worker-daemon.ts` — mismo patrón que
`src/server/ai/worker.ts` (sondeo + mantenimiento + `SIGTERM`/`SIGINT`).
**Apagado por defecto** (`CAMPAIGN_WORKER_ENABLED`, a diferencia del worker
de IA): un envío masivo real solo debe arrancar cuando alguien lo enciende
explícitamente. Variables nuevas en `.env` (todas con default operativo,
ninguna "oficial" — ajustables sin desplegar):

| Variable | Default | Qué controla |
|---|---|---|
| `CAMPAIGN_WORKER_ENABLED` | `false` | Si este proceso vacía la cola de campañas |
| `CAMPAIGN_WORKER_CONCURRENCY` | `2` | Envíos en vuelo a la vez (todas las organizaciones) |
| `CAMPAIGN_WORKER_POLL_MS` | `2000` | Cada cuánto se sondea la cola |
| `CAMPAIGN_RATE_LIMIT_MAX` / `_WINDOW_MS` | `20` / `60000` | Techo de seguridad de Korex por organización — **no** el límite de YCloud/Meta |

Antes de encender `CAMPAIGN_WORKER_ENABLED=1` en producción: confirmar el
rate limit con el propio proveedor primero.

## 2. Costo real (Fase 10C)

Nueva tabla `pricing_rate` (país + categoría + proveedor + tarifa +
vigencia + fuente) — reemplaza las constantes de `src/lib/cotizador.ts`
como fuente de verdad para lo que se REGISTRA (`cotizador.ts` sigue
existiendo tal cual, para la cotización de clientes nuevos, sin tocar).
**Vacía hoy a propósito**: sin tarifa cargada, todo mensaje se anota con
costo `0` — nunca se inventa un número. `POST /api/admin/pricing-rates`
(solo superadmin) para cargarla una vez confirmada contra el Business
Manager real; no hay UI todavía, solo API.

`usage_event` ahora también guarda `campaignId`/`recipientId`/`provider`/
`category`/`country`/`korexPriceUsd`/`marginUsd`/`pricingRateId` — trazable
hasta el envío exacto que lo generó, congelado en el momento (un cambio de
tarifa mañana no reescribe el costo de ayer).

**Conectado en los cuatro sitios que envían WhatsApp**: `sendText`/
`sendImage`/`sendDocument`/`sendInteractiveMenu` (`send.ts`, categoría
`service`), `sendTemplate` (`templates.ts`, categoría de la propia
plantilla), y el worker de campañas (`worker.ts`, categoría de
`templateSnapshot`). Todos vía `registrarEnvioWhatsappConCosto()`
(`pricing/rates.ts`) — fail-safe: un problema calculando el costo nunca
puede tumbar un envío que ya salió.

## 3. Segmentación (Fase 10E)

`campaign.audienceType` ahora admite cinco valores; `audienceFilter`
(jsonb) trae los parámetros de cada uno. Todos parten de
`contactosElegiblesParaMarketing()` — nunca reintroducen a alguien que esa
función ya excluye (archivado, opt-out, y ahora también **sin canal
real** — ver punto 8).

| `audienceType` | `audienceFilter` |
|---|---|
| `todos_los_contactos` | (ninguno) |
| `pipeline_stage` | `{ stageIds: string[] }` |
| `selected_contacts` | `{ contactIds: string[] }` — nunca confía en el frontend: se filtra contra los elegibles reales de esa organización |
| `fixed_count` | `{ limit, selectionStrategy: "oldest_first" }` |
| `budget` | `{ budgetUsd }` |

## 4. Los tres modos de envío (Fase 10F)

Los tres reutilizan `resolverAudiencia()`/`estimarCampana()`
(`campaigns/audiencia.ts`):

- **Todos**: `audienceType = "todos_los_contactos"`.
- **Cantidad fija**: `fixed_count`, orden determinista (más antiguos
  primero) — nunca aleatorio sin semilla, nunca "los primeros N" sin regla
  explícita.
- **Presupuesto**: `budget`, acumula en el mismo orden hasta no superar el
  monto — **sin arrastre de coma flotante**: `asignarPorPresupuesto()`
  suma en unidades enteras de 10⁻¹⁰ USD con `BigInt`, y solo convierte a
  `number` al final.

`GET /api/campaigns/[id]/estimate` — cuenta + costo, antes de confirmar
nada. Al pasar a `ready`/`pending_approval`, la estimación se **congela**
en `campaign.estimatedRecipients`/`estimatedCostUsd`/`rateSnapshot` — un
cambio de tarifa después no la reescribe.

## 5. Aprobación cliente→superadmin (Fase 10I)

Estados nuevos, aditivos (el camino directo `draft → ready` sigue
funcionando igual, sin aprobación, para cuando el superadmin arma la
campaña él mismo):

```
draft → pending_approval → ready → … (igual que antes)
              ↓
          rejected → draft (el cliente ajusta y reintenta)
```

`solicitarAprobacionCampana()` congela snapshot de plantilla Y estimación
en el mismo momento (el superadmin revisa exactamente lo que se pidió, no
una versión que cambió mientras esperaba). `aprobarCampana()` es
deliberadamente más estrecho que la máquina de estados genérica: **solo**
aplica desde `pending_approval`, nunca se puede confundir con "esto ni
pasó por aprobación". Toda acción (solicitar/aprobar/rechazar) queda
auditada vía `conRegistro()` (mismo sistema ya usado en todo el proyecto).

**Quién puede qué**, mismo principio que ya rige plantillas/aprendizaje/
Laboratorio ("todo lo que cuesta dinero de la agencia, solo el
superadmin"):

| Acción | Cliente | Superadmin |
|---|---|---|
| Crear borrador, editarlo, ver estimación | ✅ | ✅ |
| Solicitar aprobación | ✅ | — |
| Aprobar / rechazar | ❌ | ✅ |
| Preparar sin aprobación, iniciar, pausar, reanudar, cancelar | ❌ | ✅ |

## 6. YCloud → Korex (Fase 10D)

`sincronizarTemplatesYCloud()` (`src/server/whatsapp/sync-ycloud-templates.ts`)
— primer caller real de `listarTemplatesYCloud()`, que existía desde la
Fase 9D sin que nadie la llamara (doc 153). `POST /api/admin/templates/sync-ycloud`
(superadmin, `{organizationId}`). Upsert por `waTemplateId`, o por
`name+language` si Korex ya la conocía como borrador sin ID todavía —
nunca duplica. Una plantilla que YA NO aparece en YCloud (se borró allá)
**no se elimina** — pasa a `status: "rejected"` con motivo explícito
("Ya no aparece en YCloud..."), lo que la excluye de campañas nuevas sin
mentir en `providerStatus` (esa columna solo guarda el dato crudo real del
proveedor).

**Decisión de arquitectura — imagen de una plantilla sincronizada**: no
hay ningún `media_asset` de Korex detrás de una plantilla creada en
YCloud, así que se agregó un tercer tipo de header,
`{ type: "IMAGE_URL"; url }` (junto al `{ type: "IMAGE"; mediaAssetId }`
ya existente desde Fase 9P) — una URL ya resuelta y pública que YCloud/Meta
ya aprobaron, reusada en cada envío real. Solo lo produce la
sincronización; crearlo a mano vía la API se rechaza explícitamente.

## 7. Delivery status (Fase 10H)

El webhook de YCloud (el canal real de producción — el legacy de Meta
directo ya lo tenía) ahora reconoce `whatsapp.message.updated`
(`sent`/`delivered`/`read`/`failed`), confirmado contra
`docs.ycloud.com/reference/whatsapp-message-updated-webhook-examples`
(nunca asumido). Resuelve la organización por el propio mensaje
(`waMessageId`, único en toda la tabla) en vez de por `wabaId` — más
robusto, no depende de que este evento en particular traiga ese campo.
`campaignRecipient.deliveredAt`/`readAt` se anotan aparte de `status`
(que sigue significando solo "el proveedor aceptó el envío") — mismo
orden monotónico ya probado de `message.status` (`isUpgrade()`), sin
máquina de estados nueva.

## 8. Un bug real encontrado en la propia autoauditoría

Un contacto sin teléfono NI `waUserId` pasaba la elegibilidad de
campañas, y `resolveRecipient()` fallaba recién dentro del worker — que
revierte el job a `pending` sin marcarlo `failed` (esa rama es solo para
errores de precondición). El mismo recipient se habría reclamado una y
otra vez, sin poder cerrarse nunca. Corregido en la raíz:
`contactosElegiblesParaMarketing()` (`src/server/contacts.ts`) ahora
también exige `tieneCanalUtilizable()` — nunca llega a crearse el
`campaign_recipient`.

## Cómo probarlo hoy (sin tocar producción)

1. `CAMPAIGN_WORKER_ENABLED` sigue en `0` en todos los entornos reales —
   nada envía nada hasta que se encienda a propósito.
2. `pricing_rate` está vacía — todo costo se anota en `0` hasta cargar la
   tarifa real (`POST /api/admin/pricing-rates`, superadmin).
3. `/campaigns` ya está en el menú, visible para cualquier usuario — el
   cliente puede crear un borrador y pedir aprobación; solo el superadmin
   ve los botones de preparar/aprobar/iniciar.

## Pendiente (declarado, no oculto)

- **UI de tarifas**: hoy solo hay API (`/api/admin/pricing-rates`), sin
  pantalla — cargar la tarifa real requiere una llamada directa al
  endpoint.
- **`budget` a gran escala**: `resolverAudiencia()` calcula el costo
  contacto por contacto en secuencia — aceptable al volumen actual
  (decenas/cientos), no optimizado para miles (agrupar por país reduciría
  las consultas repetidas).
- **Botones de plantilla**: siguen sin implementarse (ya documentado desde
  Fase 9P) — la sincronización tampoco los extrae.
- **Pruebas de concurrencia real contra Postgres**: los escenarios de dos
  workers/`FOR UPDATE SKIP LOCKED` ya estaban cubiertos por
  `tests/integration/campaign-*.test.ts` (Fase 4-6, sin tocar en esta
  ronda) — se saltan en este entorno por no tener una base de datos de
  prueba disponible; correrán en CI/con Postgres real.
