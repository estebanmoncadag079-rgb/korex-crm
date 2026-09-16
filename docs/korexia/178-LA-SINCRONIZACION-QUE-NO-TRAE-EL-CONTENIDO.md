# 178 — La sincronización que no trae el contenido

**15-sep-2026.** Segunda capa del mismo incidente de Camilabrandcol
([175](175-LA-VARIABLE-DEL-ENCABEZADO.md)). El arreglo de 175 ya está en
producción y es correcto; esto es lo que sigue fallando después de él.

## El incidente

Camilabrandcol editó `ventana_cerrada_23h` directamente en YCloud para
quitarle la variable del encabezado, y Meta la volvió a aprobar. Al intentar
enviarla desde Korex:

1. La pantalla seguía pidiendo "Valor de {{1}} en el encabezado" — como si la
   plantilla todavía la tuviera.
2. Al enviar, con un valor puesto, Meta volvió a rechazar:
   ```
   (#132000) Number of parameters does not match the expected number of params
   ```

El arreglo de 175 (detectar la variable del encabezado) funciona bien — el
problema es que Korex nunca se enteró de que la plantilla **cambió**.

## La causa

Hay dos caminos de sincronización, y el que ve un negocio normal no trae
contenido:

| Sincronización | Dónde | Qué actualiza |
|---|---|---|
| `syncTemplates()` (Graph, pull de estados) | `/api/templates/sync` — botón "Sincronizar" en Configuración → Plantillas, **el único que un negocio normal puede usar** | `templates.ts:874-882`: **solo** `status`, `rejectionReason`, `waTemplateId`. Nunca toca `body` ni `components`. |
| `sincronizarTemplatesYCloud()` | `/api/admin/templates/sync-ycloud` — botón "Traer de YCloud" en `/admin/templates`, **exclusivo de superadmin** | `sync-ycloud-templates.ts:107-125`: `body` y `components` completos, **siempre**, sin condicionarlo a que el estado haya cambiado. |

El estado de la plantilla (`status`) ya decía "aprobada" antes y después de la
edición de Camilabrandcol —seguía aprobada, solo cambió el contenido—, así
que ni siquiera el primer camino tenía algo que actualizar. El resultado:
`template.components.header.text` se quedó congelado en
`"{{1}} Estamos para ayudarte"` en la base de Korex, mientras YCloud ya tenía
la versión sin la variable.

La pantalla y el envío (arreglo de 175) leen exactamente ese dato congelado:
piden y mandan un parámetro de encabezado que Meta ya no espera.

## Por qué no es solo Camilabrandcol

**Cualquier negocio que edite una plantilla ya sincronizada, en YCloud o en
Meta directamente, queda con el mismo problema — en silencio, sin ningún
aviso.** El botón que un cliente normal tiene a mano (`/api/templates/sync`)
nunca va a corregirlo, sin importar cuántas veces lo presione: por diseño,
solo mira si cambió el estado de aprobación, nunca el contenido.

## Arreglo inmediato (aplicado hoy, sin código nuevo)

La sincronización que SÍ trae el contenido completo ya existe y ya está
desplegada (`sincronizarTemplatesYCloud`, commits `c993be6`/`2552a52`, en
`origin/main` desde antes de hoy) — solo estaba detrás del panel de
superadmin.

**Lo que se hizo:** desde `/admin/templates`, filtrar por la organización de
Camilabrandcol y presionar **"Traer de YCloud"**. Eso sobrescribe
`body`/`components` con el contenido real y vigente de YCloud —
incondicionalmente, sin importar si el estado de aprobación cambió— y deja el
encabezado sin la variable, tal como está aprobado ahora.

**Verificado en vivo (15-sep-2026, 09:26 UTC):** tras correr la
sincronización, se reintentó el envío de `ventana_cerrada_23h` a un contacto
real (`CO.2231688914065633`). **El `#132000` no volvió a aparecer** — el
mensaje se aceptó y se insertó (`msg_19vb8927p6217ojpokjz`). Confirmado
leyendo `message.error` directo de producción (solo lectura, vía el túnel
documentado en este archivo, sesión cerrada después de consultar): el arreglo
de esta capa quedó probado.

**Pero el mensaje terminó en `status: "failed"` por una causa totalmente
distinta**, ajena a plantillas: `error = "Business account has been locked."`
Meta bloqueó la cuenta de WhatsApp Business de Camilabrandcol. Esto:

- No lo causa ni lo arregla nada de este documento ni del código de Korex.
- No es un error de parámetros ni de sincronización — es un estado de cuenta
  que solo se resuelve desde el Administrador comercial / WhatsApp Manager de
  Meta (revisar motivo del bloqueo y apelar o corregir lo que Meta señale).
- Confirma, de rebote, que el arreglo de esta sección SÍ funcionó: si el
  header siguiera desincronizado, el error habría sido `#132000` de nuevo, no
  uno de cuenta bloqueada.

## Arreglo de fondo (pendiente, NO implementado — para hacer después)

El botón de autoservicio (`/api/templates/sync` → `syncTemplates()`,
`templates.ts:836-886`) debe dejar de ser "solo estados" y traer también el
contenido, igual que ya hace `sincronizarTemplatesYCloud()`. Sin esto, **todo
negocio que no sea la agencia queda sin forma de corregir esto por su
cuenta** — depende de que alguien de korex.ia entre al panel de superadmin
cada vez.

Puntos a resolver en esa fase (no decidir aquí, solo dejarlos anotados):

1. `syncTemplates()` usa Graph API (`GET {waba}/message_templates`) sin pedir
   el campo `components` — hay que agregarlo a la solicitud antes de poder
   usarlo (`templates.ts:847`).
2. Decidir si `syncTemplates()` (Graph) y `sincronizarTemplatesYCloud()`
   (YCloud) se **unifican** en un solo camino, o si cada negocio corre el que
   corresponda según cómo gestione sus plantillas (`provider` en el schema ya
   distingue `"ycloud"` de plantillas creadas en Korex/Graph) — hoy son dos
   funciones independientes que no se hablan.
3. Si se unifica, decidir qué pasa con una plantilla `provider: null`
   (borrador local, nunca enviado a ningún proveedor) — ninguna de las dos
   sincronizaciones debería tocarla.
4. Considerar disparar esta sincronización de contenido automáticamente
   cuando llega el webhook `message_template_status_update`
   (`applyTemplateStatusEvent`, `templates.ts:889`) en vez de depender
   siempre de un clic — aunque el comentario de `syncTemplates` ya advierte
   que los webhooks de plantillas no siguen el override de callback en modo
   agencia (DV-VC-04/DV-VC-15), así que esto necesita revisarse contra esa
   limitación antes de asumir que resuelve el caso general.

## Cómo revertir el arreglo inmediato

No aplica: no se tocó código, solo se corrió una sincronización de datos ya
existente. Si el contenido traído de YCloud fuera incorrecto por algún
motivo, se corrige volviendo a correr la misma sincronización una vez YCloud
tenga el dato correcto — es idempotente (`sync-ycloud-templates.ts:74`, mismo
resultado si se corre dos veces seguidas sin cambios).
