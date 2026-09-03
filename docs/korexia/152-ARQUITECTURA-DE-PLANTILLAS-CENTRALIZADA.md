# Plantillas de WhatsApp: administración centralizada y dónde quedamos

> **Dentro:** Qué existe hoy en producción · El modelo de datos · El flujo
> completo (borrador → aprobación → campaña → envío) · Lo que se construyó
> pero **todavía no está desplegado** (imagen en el encabezado) · Cómo crear
> una plantilla hoy mismo

**1-sep-2026.** Continúa el pendiente #1 de
[29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md) y cierra
el hueco que dejaba abierto el
[131-WABA-ID-CAPTURADO-Y-USADO-EN-PLANTILLAS.md](131-WABA-ID-CAPTURADO-Y-USADO-EN-PLANTILLAS.md):
antes cada cliente tenía que gestionar sus propias plantillas contra Meta
desde su propia cuenta; ahora **solo Korex (superadmin) crea y somete
plantillas, para cualquier cliente, desde un panel único**.

## Qué existe HOY en producción

Panel `/admin/templates` (visible solo con `platformRole: "superadmin"`, o
sea, solo Korex). Desde ahí, para cualquier organización:

1. **Crear un borrador** — nombre, categoría (`UTILITY`/`MARKETING`), idioma,
   cuerpo del mensaje (máximo una variable `{{1}}`). Queda guardado en
   `status: "draft"`, 100% local, sin tocar ningún proveedor todavía.
2. **Enviarlo a aprobación** — un botón que llama a YCloud con las
   credenciales reales de ESA organización (la propia si trajo cuenta de
   YCloud, o la de la agencia si no). YCloud lo somete a Meta.
3. **Verificar estado** — Meta tarda en aprobar/rechazar; un botón
   "Verificar estado" consulta YCloud y actualiza `pending → approved` o
   `pending → rejected` (con el motivo real que dio Meta).

El cliente, en su propia cuenta (`/settings/templates`), ve **solo lectura**:
sus plantillas ya aprobadas, sin poder crear ni editar nada — evita que cada
negocio tenga que aprender a lidiar con Meta.

## El modelo de datos (tabla `template`)

Una fila por plantilla, con estas columnas relevantes:

| Columna | Qué guarda |
|---|---|
| `organizationId` | de qué cliente es (nunca compartida entre clientes) |
| `name` / `language` / `category` / `body` | el contenido, tal como lo ve Meta |
| `status` | `draft` → `pending` → `approved` / `rejected` |
| `provider` | `"ycloud"` (hoy el único con integración real) o `"graph"` (sin implementar) |
| `providerStatus` / `providerLastSyncAt` / `waTemplateId` | el estado CRUDO que devolvió YCloud, y su ID real allá — nunca inventado |
| `rejectionReason` | el motivo real que dio Meta, si rechazó |
| `components` | 🆕 header/footer opcionales (imagen, texto, pie de página) — ver más abajo |

La regla de oro que se respetó en todo esto: **nunca se afirma un resultado
sin certeza**. Si YCloud no confirma con claridad si la plantilla se creó o
no (un timeout, un error 500), el sistema la marca como "pendiente de
verificar" — nunca la da por aprobada ni por rechazada a ciegas, y nunca
reintenta solo (podría crear un duplicado en Meta).

## Lo nuevo: imagen en el encabezado — construido, **NO desplegado**

Esta semana se construyó el soporte completo para que una plantilla lleve
una **imagen arriba del texto** (además de un pie de página opcional):

- En el panel, al crear/editar un borrador: selector "Sin encabezado" /
  "Imagen", con las fotos YA subidas de ese cliente (las mismas que el
  agente usa para mandar fotos de producto — no hay que subir nada nuevo).
- Cuando se envía a aprobación, la imagen viaja a Meta como ejemplo del
  encabezado.
- Cuando la plantilla ya aprobada se usa en una campaña real, la imagen
  también viaja en cada envío (esto era el hueco: una plantilla se podía
  aprobar con imagen pero antes no se podía usar en un envío real).

**Todo esto pasó pruebas automáticas (49 pruebas nuevas, 1640 en total, sin
ningún fallo) pero no se subió a producción**: no hay `commit`, no hay
`push`, no hiciste el deploy en EasyPanel. Hoy en producción el panel sigue
mostrando solo "sin encabezado" — la opción de imagen aparecerá quien la vea
recién después de ese paso, pendiente de que lo autorices.

## Cómo crear una plantilla hoy (lo que ya funciona en vivo)

1. Entra a `/admin/templates` con tu cuenta de superadmin.
2. Elige la organización (ej. Lashes Valen).
3. "Nuevo borrador" → nombre (solo minúsculas y guiones bajos, se normaliza
   solo), categoría, idioma, cuerpo del mensaje.
4. Guardar borrador → "Enviar a aprobación" → confirmar.
5. YCloud lo somete a Meta. El estado pasa a `pending`; Meta suele tardar
   minutos a horas en resolver. "Verificar estado" para refrescarlo.

## Alternativa que se está usando ahora: crear la plantilla directamente en YCloud

Para no esperar el deploy de la función de imagen, la decisión de hoy fue
**crear esta plantilla concreta para Lashes Valen directamente desde el
dashboard web de YCloud** (fuera de nuestro panel) — Lashes Valen tiene su
**propia cuenta de YCloud** (no la de la agencia, ver
[60-CONECTAR-UN-CLIENTE-CON-SU-YCLOUD.md](60-CONECTAR-UN-CLIENTE-CON-SU-YCLOUD.md)),
así que el login es el de esa cuenta, no el panel de Korex.

Esa plantilla, creada por fuera, queda viviendo del lado de YCloud/Meta —
para que aparezca también en el CRM de Korex haría falta sincronizarla (hoy
no hay un botón para "traer" una plantilla creada afuera; es un pendiente,
no algo que exista todavía).

## Pendientes

- Subir a producción el soporte de imagen (`commit` + `push` + deploy en
  EasyPanel) — bloqueado únicamente por tu autorización explícita.
- No existe hoy un botón para "importar" una plantilla creada directamente
  en el dashboard de YCloud hacia el panel de Korex — si se crea por fuera,
  el CRM no se entera sola.
- Botones (`BUTTONS`) en plantillas: auditado, no implementado.
