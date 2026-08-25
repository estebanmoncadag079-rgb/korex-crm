# Auditoría: ¿La Churra, Lis y Lashes Valen se mezclan entre sí?

> **Dentro:** Por qué se pidió · El archivo huérfano del bot viejo de Lis · El
> servicio paralelo que ya no existe · La garantía estructural contra el
> cruce de mensajes · Conclusión

**25-ago-2026.** El dueño pidió investigar a fondo si los tres negocios
tienen información cruzada o duplicada, y si el bot podía estar tomando
datos de un lugar que no fuera el CRM — sospecha concreta: que al migrar a
Lis a la arquitectura nueva quedó una copia de su información vieja dando
vueltas por algún lado.

---

## El archivo huérfano de Lis

`clientes/lis-pasteleria/config-negocio-del-bot-viejo.js` es la configuración
completa de un bot anterior a Vocero (Baileys standalone, sin IA): menú,
precios y **datos bancarios reales** (llave, cuenta, cédula del titular) en
texto plano.

Grep exhaustivo sobre `vocero/src` no encontró ninguna referencia — ningún
proceso de producción lo lee ni lo importa. No era un canal de fuga activo,
pero sí datos sensibles sentados sin control de acceso. Se archivó fuera de
la carpeta activa: `clientes/_archivado-no-usar/lis-pasteleria-config-bot-viejo-31jul2026.js`.

## El servicio paralelo que ya no existe

Las notas de infraestructura (29-jul-2026) mencionaban un servicio aparte,
`bot-liz-sin-ia_agente-liz`, corriendo en el VPS junto al CRM — un bot de
WhatsApp independiente para Lis, con su propia sesión de Baileys. Si eso
siguiera activo, sería la explicación real de una respuesta doble: dos bots
pudiendo contestarle al mismo cliente con catálogos distintos.

Se listaron todos los contenedores del servidor (activos y detenidos,
`docker ps -a`): **ese servicio ya no existe**, ni corriendo ni parado. Solo
queda el CRM, su base de datos, el bot de Telegram, y restos ya muertos de
`churra-ia` (consistente con que se retiró el 29-jul).

## La garantía contra el cruce de mensajes es de la base de datos, no del código

Se revisó cómo el sistema decide a qué negocio pertenece un mensaje entrante:
`getCredentialsByPhoneNumberId` resuelve por `phone_number_id` (Meta) contra
`meta_credentials`. Esa tabla tiene **tres índices únicos**:
`meta_credentials_org_uq`, `meta_credentials_phone_uq` y
`meta_credentials_display_phone_uq`. Es decir: es físicamente imposible que
dos organizaciones queden resueltas al mismo número — la base de datos
rechazaría el registro antes de que pudiera pasar, no depende de que nadie se
acuerde de filtrar bien.

Todas las queries de dominio revisadas (conversación, catálogo, kb, leads,
contactos) filtran explícitamente por `organization_id`, reforzadas por el
helper `scoped()` (`src/lib/db/tenant.ts`), que exige el tenant como
argumento obligatorio.

## Lo que SÍ hubo, y ya estaba resuelto antes de esta auditoría

El 19-20-ago, al migrar a Lis, su catálogo quedó duplicado **dentro de su
propio prompt** (una copia manual en `instructions` + otra inyectada en
tiempo real desde las tablas) — documentado en
[115-LIS-POR-SECCIONES-Y-EL-CATALOGO-DUPLICADO.md](115-LIS-POR-SECCIONES-Y-EL-CATALOGO-DUPLICADO.md).
Es información doble real, pero **dentro de un mismo cliente**, no cruzada
con otro negocio, y ya corregido y verificado con pruebas antes de esta
auditoría.

## Conclusión

No hay fuga ni mezcla de información entre La Churra, Lis y Lashes Valen.
Las dos sospechas concretas (el archivo del bot viejo, un segundo bot
corriendo en paralelo) se descartaron con evidencia directa del servidor y
la base de datos, no por inferencia. El único caso real de "información
doble" que existió fue interno a Lis y ya estaba cerrado.
