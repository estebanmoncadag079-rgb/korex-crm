# El WABA ID real de Meta, para cuentas propias de YCloud

> **Dentro:** El problema · Qué cambia (la columna nueva) · De dónde saldrá el
> dato · Decisiones del modelo de datos · Cómo revertir · Lo que este cambio NO
> hace todavía

**24-ago-2026.** Solo el esquema. Añade dónde guardar el WABA ID **real de
Meta** de un cliente que trae su **propia cuenta de YCloud**, separado del
identificador sintético `ycloud:<numero>` que hoy ocupa `meta_credentials.waba_id`.

Sale del pendiente #1 de
[29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md).

## El problema

`createTemplate` (`src/server/whatsapp/templates.ts`) crea plantillas llamando
a Meta Graph API con `creds.wabaId`. Eso funciona para los clientes que van por
la cuenta de la agencia o por Meta directo, porque ahí `waba_id` **es** un WABA
real.

Pero un cliente con **cuenta propia de YCloud** —o sea, todos los nuevos— no
expone su WABA de Meta al conectarse. `saveYcloudNumber`
(`src/server/whatsapp/credentials.ts`) guarda:

```
waba_id         = "ycloud:<numero>"   ← SINTÉTICO, no es un WABA de Meta
phone_number_id = "ycloud:<numero>"
```

Ese `ycloud:<numero>` sirve para enrutar el webhook, pero Graph no lo reconoce.
Resultado: **crear plantillas desde el CRM falla para esos clientes**, y una
plantilla de utilidad es lo único que atraviesa la ventana de 24 h para
recordar una cita (ver 29-RECORDATORIOS).

## Qué cambia

Una columna nueva, aditiva y nullable, en la tabla `meta_credentials`:

| | |
|---|---|
| Tabla | `meta_credentials` |
| Columna nueva (SQL) | **`meta_waba_id`** |
| Campo en Drizzle | **`metaWabaId`** |
| Tipo | `text`, **NULLABLE**, sin default, sin UNIQUE |
| Migración | `drizzle/0027_waba_id_real_ycloud.sql` |

> 🔑 **Para el siguiente agente:** el dato se lee y escribe en
> `meta_credentials.meta_waba_id` (Drizzle: `schema.metaCredentials.metaWabaId`).
> Es la columna que debe consumir la lógica de captura (del webhook de YCloud o
> de `GET /v2/whatsapp/phoneNumbers`) y la de creación de plantillas.

`waba_id` **se conserva intacto**: sigue siendo lo que enruta (incluido el
`ycloud:<numero>`). `meta_waba_id` es un dato aparte, no un reemplazo.

## De dónde saldrá el dato

El WABA real ya viaja hasta nosotros, hoy no se guarda:

- **En los webhooks de YCloud**: `src/server/inbox/ycloud-webhook.ts` ya parsea
  un campo `wabaId` en cada evento entrante — ese es el real.
- **Bajo demanda**: `GET /v2/whatsapp/phoneNumbers` de YCloud lo devuelve por
  número.

Persistirlo en `meta_waba_id` es lo que habilita, en un paso posterior, que
`createTemplate` use el WABA correcto en vez del sintético.

## Decisiones del modelo de datos

- **En `meta_credentials`, no en `organization`.** Todo lo de la conexión de
  WhatsApp (tokens, secreto del webhook, `phone_number_id`, `waba_id`) ya vive
  aquí, 1:1 con la organización vía `meta_credentials_org_uq`. El WABA real es
  más de lo mismo.
- **NULLABLE, sin default.** NULL es un estado legítimo y esperado: la cuenta de
  la agencia y Meta directo no lo necesitan (su `waba_id` ya es el real), y una
  cuenta propia de YCloud lo tendrá NULL hasta que se capture. Al ser nullable,
  la migración **no reescribe ni invalida** ninguna fila existente.
- **Sin UNIQUE**, igual que `waba_id` (que tampoco lo tiene). La unicidad de la
  fila ya la da `meta_credentials_org_uq` (una fila por organización); no hace
  falta una FK compuesta porque esta columna no cuelga ningún hijo.
- **Escrita a mano**, como la 0019 a la 0026. `drizzle-kit generate` diffiza
  contra el snapshot de la 0020 (desactualizado) y ha propuesto recrear
  columnas existentes; ver la trampa #1 de
  [63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md](63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md). La
  entrada idx 27 se añadió al `drizzle/meta/_journal.json` a mano, igual que las
  anteriores.

## Cómo revertir

La migración es aditiva; deshacerla es una sola sentencia, segura en cualquier
momento mientras nada la lea aún:

```sql
ALTER TABLE "meta_credentials" DROP COLUMN "meta_waba_id";
```

(Habría que quitar también `metaWabaId` de `schema.ts` y la entrada idx 27 del
journal.) No hay datos que perder: la columna nace vacía.

## Lo que este cambio NO hace todavía

Esto es **solo el sitio donde guardar el dato**. Quedan, para otro agente:

1. **Capturar** el `wabaId` real del webhook de YCloud (o de
   `GET /v2/whatsapp/phoneNumbers`) y escribirlo en `meta_waba_id`.
2. **Usarlo** en `createTemplate`: preferir `meta_waba_id` cuando `waba_id`
   empiece por `ycloud:`, para que Graph reciba un WABA que reconoce.
3. Los pendientes #2 y #3 de 29-RECORDATORIOS (caer a la plantilla cuando la
   ventana esté cerrada, y automatizar el recordatorio) siguen abiertos.
