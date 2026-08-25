# WABA ID real: capturado del webhook y usado en plantillas

> **Dentro:** Qué se implementó · De dónde sale el dato en producción · Cómo
> se prueba · Qué pasa si `metaWabaId` sigue NULL · Cómo revertir

**24-ago-2026.** Cierra los pendientes 1 y 2 del doc 129 (la columna
`meta_waba_id` ya existía; este cambio la llena y la consume).

Sale del pendiente #1 de
[29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md).

## Qué se implementó

### 1. Captura automática (`credentials.ts` + `ycloud-events.ts`)

Nueva función `captureMetaWabaId(organizationId, realWabaId)` en
`src/server/whatsapp/credentials.ts`:

- Solo escribe si el valor actual de `meta_waba_id` es NULL o cambió.
- Descarta cualquier valor que empiece por `"ycloud:"` (sintético, no es un
  WABA real) para evitar sobreescribir el real con basura.
- Es un `UPDATE` con `WHERE ... (meta_waba_id IS NULL OR meta_waba_id != $1)`:
  noop si el dato ya está correcto.

`src/server/inbox/ycloud-events.ts` la llama —fire-and-forget con `.catch`—
después de resolver el route para los tres tipos de evento de YCloud que
traen `wabaId`:

| Evento YCloud | Campo del que viene | Handler |
|---|---|---|
| `whatsapp.inbound_message.received` | `whatsappInboundMessage.wabaId` | `handleYcloudEvent` |
| `whatsapp.smb.message.echoes` | `whatsappMessage.wabaId` | `handleEcho` |
| `whatsapp.smb.history` | `whatsappInboundMessage.wabaId` o `whatsappMessage.wabaId` | `handleHistory` |

Fire-and-forget deliberado: un fallo al guardar el WABA ID no puede bloquear
la ingesta del mensaje — el cliente sigue recibiendo atención, y el error
queda en el log del contenedor.

### 2. Uso en plantillas (`templates.ts`)

Nueva función exportada `resolveWabaId(creds)`:

- Si `creds.wabaId` **no** empieza por `"ycloud:"` → es un WABA real (agencia
  o Meta directo). Se devuelve tal cual, sin tocar nada.
- Si empieza por `"ycloud:"` y `creds.metaWabaId` tiene valor → se devuelve
  `metaWabaId`. Graph recibe el WABA que sí reconoce.
- Si empieza por `"ycloud:"` y `metaWabaId` es NULL → lanza `TemplateError`
  con código `"not_connected"` y un mensaje explícito (ver sección siguiente).

`resolveWabaId` se aplica en:
- `createTemplate` — antes de la llamada `POST /{waba}/message_templates`.
- `syncTemplates` — antes de la llamada `GET /{waba}/message_templates`.

El tipo `Credentials` (mismo archivo) ahora incluye `metaWabaId: string | null`,
mapeado desde `meta_credentials.meta_waba_id` en `toCredentials()`.

## De dónde sale el dato en producción

El `wabaId` real viaja en cada evento que YCloud envía al webhook. Con los
clientes actuales:

- **La Churra** y **Lis**: cuentas propias de YCloud. El primer mensaje que
  procese el webhook después de este despliegue escribe el WABA real en
  `meta_credentials.meta_waba_id`.
- **Clientes de agencia** (si los hubiera con `wabaId` no sintético): no les
  aplica, `resolveWabaId` devuelve el `wabaId` existente.

No hay fetch bajo demanda a `GET /v2/whatsapp/phoneNumbers` de YCloud: el
webhook ya trae el dato en cada mensaje y es suficiente. Añadir un fetch activo
sería más código y más superficie de fallo para el mismo resultado.

## Cómo se prueba

### Tests unitarios (sin base de datos)

```bash
pnpm vitest run tests/unit/templates.test.ts
```

Cubre `resolveWabaId` en tres escenarios:

1. WABA real (agencia/Meta directo) → pasa sin tocar nada.
2. Cuenta YCloud con `metaWabaId` capturado → devuelve el real.
3. Cuenta YCloud sin `metaWabaId` → lanza `TemplateError` con mensaje claro.

### Verificación en producción

Después del despliegue, con el primer mensaje entrante de Lashes Valen (o
cualquier cliente con cuenta propia de YCloud):

```sql
SELECT organization_id, waba_id, meta_waba_id, updated_at
FROM meta_credentials
WHERE waba_id LIKE 'ycloud:%';
```

Si `meta_waba_id` tiene un valor numérico (el WABA ID real de Meta), la
captura funcionó. A partir de ese momento `createTemplate` y `syncTemplates`
funcionan para ese cliente.

## Qué pasa si `metaWabaId` sigue NULL

`createTemplate` y `syncTemplates` lanzan `TemplateError("not_connected", ...)` con
este mensaje:

> El WABA ID real de Meta no está disponible aún para este cliente.
> Se captura automáticamente del primer mensaje que reciba el número
> a través del webhook de YCloud. Verifica que el webhook esté
> configurado y que el número haya recibido al menos un mensaje desde
> que se dio de alta. Si el problema persiste, revisa la tabla
> meta_credentials (columna meta_waba_id) para confirmar que se pobló.

La API devuelve HTTP 409. El panel muestra ese texto al usuario.

Causa habitual si el dato no llega: el webhook del cliente en YCloud no está
suscrito a ningún evento (ver la advertencia de Lis del 30-jul-2026 en
[03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md)).

## Cómo revertir

El cambio es aditivo. Para volver al comportamiento anterior (siempre usar
`creds.wabaId`, falle o no contra Graph):

1. En `templates.ts`: reemplazar `resolveWabaId(creds)` por `creds.wabaId`
   en `createTemplate` y `syncTemplates`, y borrar la función `resolveWabaId`.
2. En `ycloud-events.ts`: borrar las tres llamadas a `captureMetaWabaId` y
   el import.
3. En `credentials.ts`: borrar `captureMetaWabaId`, quitar `metaWabaId` del
   tipo `Credentials` y de `toCredentials`, y quitar `isNull`, `ne`, `or` del
   import de drizzle-orm.

La columna `meta_waba_id` en la base **no hace falta tocarla** (es nullable y
puede quedarse sin datos indefinidamente sin efecto). Si se quiere quitar del
todo:

```sql
ALTER TABLE "meta_credentials" DROP COLUMN "meta_waba_id";
```

(Y quitar `metaWabaId` de `schema.ts` y la entrada idx 27 del journal.)

## Archivos modificados

| Archivo | Qué cambió |
|---|---|
| `src/server/whatsapp/credentials.ts` | `metaWabaId` en tipo + `toCredentials` + nueva `captureMetaWabaId` |
| `src/server/inbox/ycloud-events.ts` | Import + tres llamadas fire-and-forget a `captureMetaWabaId` |
| `src/server/whatsapp/templates.ts` | Nueva `resolveWabaId` (exportada) + usada en `createTemplate` y `syncTemplates` |
| `tests/unit/templates.test.ts` | Tres casos de prueba para `resolveWabaId` |
