# Fase 10A — Auditoría: campañas, contactos, pipeline, plantillas YCloud, costos y ventana 24h

> **Dentro:** Los 24 puntos del reporte pedido · el hallazgo más urgente NO es
> de campañas (cambia el costo de CUALQUIER conversación desde el
> 1-oct-2026) · qué del motor de campañas ya existe y qué le falta para
> poder usarse · veredicto final

**2-sep-2026.** Auditoría de solo lectura — nada de código tocado, nada
desplegado, nada llamado contra YCloud/Meta real. Responde al pedido de
"FASE 10A — AUDITORÍA ARQUITECTÓNICA COMPLETA" para diseñar el módulo de
campañas de marketing (segmentación, presupuesto, costos) para clientes como
Lashes Valen. Continúa
[152-ARQUITECTURA-DE-PLANTILLAS-CENTRALIZADA.md](152-ARQUITECTURA-DE-PLANTILLAS-CENTRALIZADA.md).

## ⚠️ Hallazgo más urgente — no es de campañas, es de TODO el negocio

Meta anunció oficialmente (confirmado contra `developers.facebook.com`,
página `pricing/non-template-messages`): **a partir del 1-oct-2026, deja de
ser gratis CUALQUIER mensaje de texto libre que el bot mande dentro de la
ventana de 24 horas** ("service message" — hoy gratis desde nov-2024). Se
cobrará "a la misma tarifa que utility/authentication en ese país". Meta
publica las tarifas exactas antes del 1-sep-2026 (hoy 2-sep, deberían ya
estar publicadas — pendiente de ir a revisarlas en el Business Manager
real). Esto afecta **cada respuesta normal del agente de IA a un cliente**,
no solo campañas de marketing — hoy `costUsd` de esos mensajes se guarda
siempre en 0 (ver punto 8). **Faltan 29 días.**

## 1. Arquitectura actual — qué existe / parcial / no existe

| Área | Estado |
|---|---|
| Plantillas (crear, aprobar, editar) | ✅ Completo, en producción, panel `/admin/templates` |
| Motor de campañas (dominio + BD) | ✅ Completo y probado — **sin UI, sin API, sin bucle de ejecución real** |
| Contactos | ✅ Existe, con opt-out de marketing |
| Pipeline (etapas) | ✅ Existe, pero sin selección múltiple ni tags |
| Segmentación de audiencia | ⛔ No existe — solo `"todos_los_contactos"` |
| Ventana de 24h | ✅ Bien calculada, pero el worker de campañas nunca la consulta |
| Costos de WhatsApp (trackeo real) | ⛔ No existe — siempre `costUsd = 0` |
| Pricing configurable | ⛔ No existe — constantes hardcodeadas, solo para cotizar clientes nuevos |
| Delivery status (sent/delivered/read) | 🟡 Código existe, pero desconectado del webhook de YCloud real |
| Importación histórica de contactos | ⛔ No existe (sí existe importar *mensajes* desde YCloud, no contactos desde CSV) |
| Aprobación cliente→superadmin | ⛔ No existe ningún precedente así en todo el sistema |
| Multi-tenant | ✅ Sólido y consistente (`scoped()`) en todas las áreas relevantes |

## 2. Contactos

Tabla `contact` (`schema.ts:112-161`): `phone` (nullable), `waUserId`,
`name`, `archivedAt` (fecha, no booleano), `marketingOptOut` +
`marketingOptOutAt`, `organizationId`. **No tiene** columna de tags, "última
compra" ni "tipo de contacto" — la única relación de estado vive en la tabla
`lead` (pipeline).

Elegibilidad para marketing (`contactosElegiblesParaMarketing`,
`src/server/contacts.ts:43-57`): excluye **archivados** y **opt-out** — nada
más. **No excluye contactos sin teléfono** (uno con solo `waUserId` cuenta
como elegible hoy). Hay una segunda verificación (`tieneOptOutDeMarketing`)
justo antes de cada envío individual, ya conectada al worker de campañas —
así que un opt-out hecho DESPUÉS de crear la campaña sí se respeta.

Opt-out: **manual únicamente**, un checkbox en el CRM
(`contacts-client.tsx:214`). **No existe manejo automático de "STOP" por
WhatsApp** — si un cliente escribe "no me escriban más", nadie lo convierte
en `marketingOptOut = true` solo.

## 3. Pipeline como fuente de audiencia

Es una tabla aparte (`pipelineStage` + `lead`), no una columna en `contact`.
Un contacto tiene como mucho un `lead` (relación 1:1). Etapas sembradas por
defecto (`provisioning.ts:24-30`): **Nuevo, En conversación, Interesado,
Cliente, Por recuperar** — los nombres son editables por cliente, pero el
sistema siempre mira `kind` (`open`/`won`/`lost`), nunca el texto. **No
existen tags** de contactos en ningún lado del schema.

## 4. Segmentación

`campaign.audienceType` es un enum con **un solo valor posible hoy:
`"todos_los_contactos"`** (`schema.ts:1437`, comentario explícito: "existe
para no romper el schema cuando llegue segmentación real"). No hay
segmentar por etapa de pipeline, ni por múltiples etapas, ni por tags (no
existen), ni selección manual de contactos específicos — nada de eso está
construido todavía, ni a nivel de dato ni de UI.

## 5. Contactos específicos / selección múltiple

**No existe ninguna selección múltiple de contactos en la UI hoy** — ni en
Pipeline ni en Contactos. El único checkbox real es el de opt-out de UN
contacto dentro de su modal de edición. No hay forma hoy de decir "estos 10
contactos exactos" desde la interfaz.

## 6. Todos los contactos elegibles

Cubierto por `contactosElegiblesParaMarketing()` (punto 2) — reutilizada
literalmente por `motor.ts:216` al materializar audiencia. Es la única
lógica de audiencia que existe hoy, y ya funciona.

## 7. Opt-out — todo el camino

Doble verificación real y ya probada: al materializar audiencia (excluye
opt-out de entrada) **y** justo antes de cada envío individual en el worker
(`worker.ts:236`, revalida por si cambió mientras el job esperaba en cola).
Un opt-out después de crear el recipient pero antes del envío **sí se
respeta** — no hay hueco encontrado en esta auditoría.

## 8. Ventana de 24 horas

`src/server/inbox/window.ts` (26 líneas): `isWindowOpen(lastInboundAt)` —
estricto, `now - lastInboundAt < 24h`, fuente `conversation.lastInboundAt`.
No hay campo `windowExpiresAt` materializado, se calcula al vuelo. Ya la usan
el pipeline de IA y el envío manual del inbox. **El worker de campañas
nunca la consulta** — coherente, porque un envío de campaña siempre es vía
plantilla (por definición, fuera de ventana). Pero con el cambio de Meta de
octubre (punto ⚠️ arriba), esta ventana deja de significar "gratis vs
plantilla obligatoria" — pasa a significar solo "formato libre permitido vs
plantilla obligatoria", **el costo ya no depende de ella para mensajes de
servicio**. Hay que separar estas dos reglas en el diseño, tal como pediste.

## 9. Reglas de plantilla fuera de 24h

Confirmado contra la documentación oficial de Meta (no memoria): ventana
cerrada → solo se puede enviar plantilla. Dentro de ventana → cualquier
formato. Esa regla de FORMATO no cambia con el anuncio de octubre — lo que
cambia es la regla de COSTO (antes gratis dentro de ventana, desde
1-oct-2026 se cobra igual que utility/authentication).

## 10. Plantillas YCloud

El modelo de `template` (draft→pending→approved→rejected,
`waTemplateId`/`provider`/`providerStatus`/`components`) está completo (ver
doc 152). Existen DOS mecanismos de sincronización distintos:
- `syncTemplates()` — pull vía **Graph** de Meta, botón manual "Sincronizar"
  en `/settings/templates`. Funciona, pero manual, sin cron.
- `listarTemplatesYCloud()` — existe y está probada, pero **nunca se llama
  desde ningún otro archivo del proyecto**. Código muerto en producción.

Ninguna plantilla `draft`/`pending`/`rejected` puede usarse para enviar —
`enviarTemplateAlProveedor()` exige `status === "approved"` (ya validado en
Fase 9H).

## 11. Template source of truth

Ya implementado correctamente: `campaign.templateSnapshot` congela
name/language/category/body/components al momento de pasar a `ready`
(`congelarTemplateSnapshot`, `motor.ts:137`). Una campaña nunca vuelve a leer
el template vivo — probado explícitamente con inmutabilidad (ver Fase 9P,
esta misma sesión). Ninguna campaña modifica la plantilla en YCloud.

## 12. Campaign model

Tres tablas completas y bien diseñadas: `campaign` (8 estados:
`draft→ready→scheduled→processing→paused→completed/cancelled/failed`),
`campaignRecipient` (`pending/sending/sent/failed/skipped/indeterminado`,
`UNIQUE(campaignId, contactId)`), `campaignSendJob` (cola con `FOR UPDATE
SKIP LOCKED`, `UNIQUE(recipientId)` — un recipient tiene como mucho un job
en toda su vida). Existen `pausarCampana`/`reanudarCampana`/
`cancelarCampana`/`completarCampana`/`intentarCompletarCampana` (automática,
con `FOR UPDATE` para resolver la carrera de cerrar el último recipient).
**No existe ningún campo de costo/presupuesto** (`estimatedRecipients`,
`estimatedCost`, `actualCost` — ninguno existe; los contadores se derivan
con `COUNT` sobre `campaignRecipient`, deliberadamente no persistidos).

## 13. Audience snapshot

Ya implementado y correcto para lo único que existe hoy (todos los
contactos): `materializarAudienciaDeCampana()` crea una fila
`campaignRecipient` por contacto elegible EN ESE MOMENTO, con `UNIQUE
(campaignId, contactId)` — un contacto que entra al pipeline después no se
agrega solo. El mismo patrón, extendido a segmentación real, es directo de
construir (es el mismo mecanismo, solo con un filtro distinto antes del
`INSERT`).

## 14. Costos Meta (fuente oficial: `developers.facebook.com`)

- Vigente desde 1-jul-2025: se cobra **por plantilla entregada**, no por
  conversación. Categorías: **marketing, utility, authentication**
  (+ authentication-international). Todo mensaje NO-plantilla es gratis
  — **hasta el 1-oct-2026** (ver hallazgo ⚠️ arriba).
- Ventana CSW = 24h desde que el cliente escribe: dentro, cualquier formato;
  plantillas *utility* dentro de CSW son gratis — **hasta el 1-oct-2026**.
- Ventana FEP = 72h cuando el cliente entra por anuncio "Click-to-WhatsApp":
  todo gratis durante esa ventana (esto no cambia con el anuncio de
  octubre).
- Cambios ya confirmados oficialmente para 2026: nuevas monedas de
  facturación (COP incluido, desde 1-abr-2026), ajustes de tarifa en varios
  países desde jul-2026, y el cambio crítico del 1-oct-2026 ya descrito.
- **Cifras exactas por país (ej. Colombia) NO están confirmadas
  directamente en la doc oficial que pude leer** — fuentes agregadoras de
  terceros (no oficiales) dan un orden de magnitud de ~$0.003 USD utility /
  ~$0.006 USD authentication para Colombia, pero **hay que verificarlas en
  el Business Manager real de Meta antes de usarlas en cualquier cálculo**
  — el propio Meta dice que publica las tarifas de octubre recién por estos
  días (antes del 1-sep-2026).

## 15. Costos YCloud (fuente oficial: `ycloud.com/pricing`)

- Suscripción mensual: Free ($0), Growth ($39), Pro ($89), Enterprise
  ($399) — independiente del costo de mensajes.
- **Cero margen sobre el costo de Meta** ("Zero Mark-up Charges on WhatsApp
  Messages") — YCloud traslada el costo de Meta 1:1, vía una billetera
  (wallet) con créditos que se descuentan automáticamente.
- El margen de YCloud está en la suscripción, no en el mensaje.

## 16. Pricing Korex (lo que existe hoy)

Constantes hardcodeadas en `src/lib/cotizador.ts` (`COSTO_RESPUESTA_IA_USD`,
`TARIFA_MENSAJE_USD`, `TARIFA_MARKETING_USD = 0.0125`, con un comentario que
literalmente dice "rate card de abril-2026: reverificar cuando Meta publique
la definitiva"). Solo se usan para **simular/cotizar precio a clientes
nuevos** desde el panel admin — no están conectadas a `usage_event` ni a
ninguna facturación real. **No existe ninguna tabla de tarifas por
país/categoría/proveedor con vigencia (`effectiveFrom`/`effectiveTo`)**.

## 17-18. Costo real trackeado

`usage_event` (`schema.ts:1047-1068`) trackea **de verdad y con precisión**
el costo de IA (`kind: "ia"`, `costUsd` decimal exacto, viene directo de
OpenRouter). Para WhatsApp (`kind: "whatsapp"`), la función
`registrarUsoWhatsapp` acepta un `costUsd` opcional **pero ningún punto del
código se lo pasa nunca** — queda siempre en 0. Y lo más importante para
esta fase: **`registrarUsoWhatsapp` no se llama nunca desde
`src/server/campaigns/`** — los envíos de plantillas de marketing (el
mensaje más caro que existe) **no se registran ni siquiera en conteo**, mucho
menos en costo. El propio doc `09-COSTOS.md` ya admitía esto como pendiente
antes de octubre.

## 19-21. Modos de envío (presupuesto fijo / cantidad fija / todos)

Ninguno de los tres existe hoy — son diseño nuevo. Con la infraestructura
actual (`materializarAudienciaDeCampana` + costo por destinatario, una vez
que exista), los tres se resuelven con la misma mecánica: calcular
elegibles → aplicar el límite (por costo acumulado, por cantidad, o
ninguno) → congelar exactamente esos recipients. El orden de selección para
"100 de X" (más antiguos / más recientes / manual) es una decisión de
producto pendiente — no la asumo, la dejo como pregunta abierta para ti.

## 22. Costo estimado vs real

No existe ninguno de los dos campos hoy (`estimatedCost`/`actualCost` no
están en el schema de `campaign`). El estimado necesita: contar elegibles →
clasificar por ventana abierta/cerrada (post-octubre, esto ya no exime de
costo, solo de exigir plantilla) → multiplicar por tarifa de categoría/país.
El real necesita que `registrarUsoWhatsapp` sí se llame desde el worker de
campañas con el costo verdadero.

## 23. Auditoría de pricing / 24. Facturación y margen

Nada de esto existe todavía — ni tabla de tarifas versionada, ni
`providerCost`/`korexPrice`/`margin` en ningún lado. Es diseño nuevo
completo, apoyado en el patrón ya usado por `usage_event` (que si trackea
bien para IA).

## Segmentación desde Pipeline / UI esperada / preview / variables / duplicados

- **Pipeline con selección múltiple**: no existe, hay que construirlo.
- **UI de campañas**: no existe ninguna pantalla ni ruta — el flujo completo
  que describiste (Nueva campaña → plantilla → preview → audiencia → modo →
  costo → revisión → aprobación → enviar) es 100% diseño nuevo de
  frontend+API sobre un backend que ya existe.
- **Preview con imagen/body/footer/variable**: el dato ya existe
  (`templateSnapshot.components`, Fase 9P de esta misma sesión) — falta
  solo el componente de UI que lo renderice en el contexto de campañas
  (ya existe algo parecido en `/admin/templates`, reutilizable).
- **Variables por recipient**: el motor ya resuelve `{{1}}` por contacto al
  momento del envío (`renderBody`, ya usado en `worker.ts`) — sin tocar la
  plantilla original. Ya funciona para el caso de un solo destinatario; para
  campañas de N destinatarios es la misma función, solo falta pasarle el
  nombre de cada contacto en el loop del worker (ya está estructurado para
  eso).
- **Duplicados**: cubierto por `UNIQUE(campaignId, contactId)` en
  `campaignRecipient` y `UNIQUE(recipientId)` en `campaignSendJob` — no se
  puede crear dos veces el mismo destinatario en la misma campaña.

## Idempotencia y recovery

Sólido: `FOR UPDATE SKIP LOCKED` para reclamar trabajo (dos workers nunca
toman el mismo job — garantía de Postgres, no de la aplicación),
`onConflictDoNothing` por `waMessageId` al insertar el mensaje (un envío
duplicado del proveedor no genera dos filas), reintentos limitados
(`MAX_INTENTOS_CAMPANA = 2`, backoff `[30s, 180s]`, valores marcados como
"propuestos" sin dato real que los confirme todavía). Un resultado
`AMBIGUOUS_FAILURE` (no se sabe si el proveedor procesó) nunca se reintenta
solo — queda para `rescatarHuerfanosDeCampana()`.

**Pero — hallazgo crítico de esta sección**: `rescatarHuerfanosDeCampana()`
existe, está bien escrita, y **nadie la llama nunca en producción**. No hay
cron, no hay `setInterval`, no hay endpoint. A diferencia del worker de
turnos de IA (`src/server/ai/worker.ts`), que sí tiene su propio sondeo y
mantenimiento arrancados por `arrancarWorker()`, **el worker de campañas no
tiene ningún equivalente**. El único punto de entrada operativo hoy es un
script manual de un solo envío (`scripts/ejecutar-primer-envio-controlado.ts`).

## Rate limit

Existe el mecanismo (`checkRateLimit`, clave `campaign_send:<orgId>`, en BD
—no en memoria, así que sí sirve con varias réplicas), pero **no tiene
ningún valor configurado en ningún lugar real** — solo aparece un valor de
ejemplo en un test. `CONCURRENCIA_CAMPANA_POR_ORG = 1` (una sola campaña
enviando a la vez por organización) es un valor "propuesto", no medido
contra nada real todavía.

## Delivery (webhooks de sent/delivered/read/failed)

El código de escritura existe y es correcto (`applyStatusUpdate`, orden
monotónico, nunca retrocede de `read` a `delivered`) — **pero solo está
conectado al webhook LEGACY de Meta directo**, el que korex.ia no usa. El
webhook real de producción (YCloud) descarta silenciamente cualquier evento
de estado de entrega (`console.info("evento ignorado")`). Hoy
`campaignRecipient.status = "sent"` solo significa "el proveedor aceptó el
envío" — nunca se entera si de verdad se entregó o se leyó.

## Multi-tenant y permisos

`scoped()` (`src/lib/db/tenant.ts`) es sólido: exige `organizationId` no
vacío (lanza si no), combina siempre con `AND` el resto de condiciones. Se
usa consistentemente en las 22 áreas de dominio relevantes, campañas
incluidas. **No hay ningún hueco encontrado** en esta auditoría.

Permisos: `withAuth` (cualquier sesión válida) vs `withPlatformAdmin`
(exige `platformRole = "superadmin"`). Todo lo que cuesta dinero de la
agencia o toca la conexión con Meta/YCloud está cerrado al cliente — mismo
patrón ya aplicado a plantillas, aprendizaje del agente y Laboratorio.
**No existe ningún flujo de "cliente solicita, superadmin aprueba"** en
todo el sistema — el precedente más cercano (`learningProposal`,
propuesta→aprobación) lo ejecuta el superadmin en ambos extremos. Si
quieres que el cliente pueda al menos ARMAR el borrador de una campaña y
pedir aprobación, es un patrón nuevo, sin precedente que copiar.

## Import histórico

No existe ningún importador de contactos por CSV/Excel. Sí existe
`scripts/importar-historial.ts`, pero importa **mensajes** desde el
historial de YCloud (para reconstruir conversaciones ya existentes), no
contactos nuevos desde un archivo externo del negocio.

## Migraciones propuestas (sin ejecutar ninguna)

- `campaign`: agregar `audienceFilter` (jsonb: tipo de segmento + criterios),
  `estimatedRecipients`, `estimatedCostUsd`, `actualCostUsd`, `currency`,
  `approvedBy`/`approvedAt` (si se decide el flujo de aprobación).
- Nueva tabla `pricing_rate`: `country`, `category`, `provider`,
  `unitCostUsd`, `effectiveFrom`, `effectiveTo` — fuente única de tarifas,
  en vez de constantes en `cotizador.ts`.
- `contact`: si se quiere permitir tags, una tabla `contact_tag` (no una
  columna array, para poder filtrar con índice).
- Conectar `applyStatusUpdate` al despachador de eventos de YCloud
  (`ycloud-events.ts`) para los tipos de evento de status que hoy se
  descartan.

## Roadmap propuesto

- **10B** — Conectar el worker de campañas a un bucle real (sondeo +
  mantenimiento, igual que `ai/worker.ts`) y fijar valores reales de rate
  limit/concurrencia. Sin esto, nada de lo demás importa: el motor no
  corre solo.
- **10C** — Trackear costo real de WhatsApp (`registrarUsoWhatsapp` con
  `costUsd` real, incluida la tabla `pricing_rate`) — bloqueante también
  para el punto ⚠️ de octubre, no solo para campañas.
- **10D** — Segmentación básica: filtro por etapa(s) de pipeline +
  selección manual de contactos específicos (UI de checkboxes en Pipeline).
- **10E** — Estimación de costo antes de enviar (los tres modos: todos /
  cantidad fija / presupuesto).
- **10F** — Pantalla de campañas (crear, preview, revisar, confirmar).
- **10G** — Conectar delivery status del webhook de YCloud real.
- **10H** — Flujo de aprobación cliente→superadmin, si se decide que el
  cliente arma el borrador.

## MVP mínimo para lanzar con Lashes Valen

Sin segmentación, sin presupuesto variable, un solo envío controlado a un
grupo pequeño (los "10 contactos de prueba" que describiste) necesita, como
mínimo: 10B (que el worker corra solo) + 10C (saber cuánto costó de
verdad) + una pantalla mínima para elegir plantilla + escribir a mano los
10 IDs de contacto (sin esperar a la UI de segmentación completa). Eso es
lo más chico que tiene sentido probar con dinero real.

## Bloqueadores

1. El motor de campañas **no corre solo** en producción — es el bloqueador
   más duro, nada envía nada hasta resolverlo.
2. **Cero costo real trackeado** para WhatsApp, ni en campañas ni en
   conversaciones normales — y el cambio de Meta de octubre lo vuelve
   urgente para TODO el negocio, no solo campañas.
3. Cero segmentación (solo "todos los contactos").
4. Cero UI de campañas.

## Riesgos

- Si se lanza una campaña real sin conectar el rate limit, no hay techo que
  evite saturar la cuenta de YCloud del cliente o gatillar límites de Meta.
- Las tarifas usadas hoy en `cotizador.ts` están marcadas por el propio
  código como desactualizadas ("reverificar cuando Meta publique la
  definitiva") — no usarlas para cobrar de verdad sin antes confirmar
  contra el Business Manager real.
- El cambio de octubre-2026 puede tomar por sorpresa el costo operativo de
  los tres clientes actuales si no se instrumenta el trackeo antes de esa
  fecha.

## Recomendaciones

Atacar primero lo que **no es exclusivo de campañas**: conectar el trackeo
de costo real de WhatsApp (punto ⚠️) antes del 1-oct-2026, porque afecta a
La Churra, Lis y Lashes Valen hoy mismo, con o sin módulo de campañas.
Recién después, construir campañas sobre esa base de costos ya sólida —
en vez de construir un cálculo de costo "solo para campañas" que habría que
rehacer en un mes cuando cambien las reglas para todo lo demás.

## Veredicto

**B) BLOQUEADORES ARQUITECTÓNICOS** — no por falta de cimientos (el motor
transaccional, la idempotencia, el multi-tenant y el snapshot de plantilla
son sólidos y ya están probados), sino por piezas puntuales y ya
identificadas que faltan antes de poder lanzar: el worker no corre solo, no
hay costo real trackeado, no hay segmentación, y no hay ninguna pantalla.
Ninguno de estos cuatro exige rediseñar lo que ya existe — son extensiones
sobre una base que la auditoría confirma que está bien hecha.
