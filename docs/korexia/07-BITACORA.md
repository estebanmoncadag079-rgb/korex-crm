# Bitácora: qué se cambió y por qué

> **Dentro:** 3-ago-2026 — auditoría con 3 agentes (seguridad, refactor, código) · 2/3-ago-2026 — nombres de usuario de WhatsApp (BSUID): el bot no respondía · 1-ago-2026 (tarde/noche) — el vertical de citas y el bot que no respondía

Historial de los cambios que llegaron a producción. Lo más reciente arriba.
Las horas van en **UTC** salvo que diga "Colombia" (UTC−5). Entradas más
antiguas en [20-BITACORA-31JUL-TARDE-NOCHE.md](20-BITACORA-31JUL-TARDE-NOCHE.md)
y [12-BITACORA-ANTERIOR.md](12-BITACORA-ANTERIOR.md).

---

## 3-ago-2026 — auditoría con 3 agentes: seguridad, refactorización y código

Tres agentes en paralelo revisaron todo el proyecto en modo solo-reporte;
después se aplicó todo lo que valía la pena. Detalle completo en
[22-AUDITORIA-3AGO.md](22-AUDITORIA-3AGO.md) y en
[10-SEGURIDAD.md](10-SEGURIDAD.md) (la parte de seguridad).

Lo más importante: un cliente podía **silenciar o reactivar el agente de
otro** (escritura sin `scoped()` en `clearHandoff`/`markHumanTookOver`), y el
**rate-limit del login se evadía** falsificando `X-Forwarded-For` — grave
porque no hay 2FA y la contraseña del superadmin sigue expuesta. Ambos
corregidos. También: `sendTemplate` **no funcionaba** para La Churra ni Lis
(usaba Meta directo en vez de YCloud), una variable de plantilla con `$`
corrompía el texto guardado, y Next.js subió a 15.5.22 (corrige un SSRF
CVSS 8.3). El resto fue deduplicación sin cambiar comportamiento. 347 pruebas
(44 archivos, 15 nuevas), `typecheck`, `lint` y `build` en verde.

**Desplegado y verificado el mismo día**: el dueño desplegó desde EasyPanel
(esto, más las dos tandas anteriores — citas y BSUID — que seguían sin
confirmar). Verificación real, no solo "converged": contenedor nuevo creado
después de la sincronización, `[migrate] migraciones aplicadas` en el log de
arranque, columna `wa_user_id` presente en la tabla `contact` de producción,
y el bundle compilado contiene `avanzarLeadSilencioso` (código de hoy). Se
corrió además `pnpm probar:citas` **directamente en el contenedor real**
contra `org_novxv78s08h12arzatr2`: ciclo agendar → reprogramar → cancelar
completo, sin duplicar ni confirmar en falso — detalle en
[19-CITAS.md](19-CITAS.md).

---

## 2/3-ago-2026 — nombres de usuario de WhatsApp (BSUID): otra causa de "el bot no responde"

Michel Vargas (clienta de Lis) le respondió a un Estado del negocio y el
agente no contestó — el mismo síntoma que Fernando el 31-jul, pero con una
causa distinta y más de fondo. El log de descarte (agregado esa vez) mostró
`fromUserId` en vez de `from`: **WhatsApp lanzó "nombres de usuario" en 2026**
— quien lo activa oculta su teléfono al negocio, y en su lugar YCloud manda un
identificador estable por negocio (Business-Scoped User ID, formato
`"CO.xxxx…"`). Se confirmó que afecta **tanto a Lis como a La Churra** por
igual (no es un problema de un cliente puntual) y, por documentación de Meta,
que **se puede seguir respondiendo** mandando ese identificador como
destinatario — no es una vía muerta.

Arreglo completo (guardar el contacto y poder responderle), de punta a punta:

- **Esquema**: `contact.phone` pasa a admitir `NULL` y se agrega
  `contact.wa_user_id`, con su propio índice único por organización
  (`contact_org_wa_user_id_uq`) — dos NULL no chocan entre sí en Postgres, así
  que conviven contactos sin teléfono y contactos sin `wa_user_id` sin
  problema. Migración aditiva, `0011_nervous_doctor_octopus.sql`.
- **Webhook de YCloud**: `parseYcloudInbound`/`parseYcloudEcho` aceptan
  `fromUserId`/`toUserId` como alternativa a `from`/`to` (nunca vienen los
  dos juntos, verificado con el payload real).
- **Contacto**: `getOrCreateContact` identifica y evita duplicar por
  `wa_user_id` cuando no hay teléfono, en vez de inventar uno.
- **Envío**: `sendText` y el envío de plantillas responden con el
  `wa_user_id` tal cual cuando no hay teléfono, igual que aceptan un número.
- **Agente y bandeja**: el prompt no inventa ni pide un teléfono para estos
  contactos; la UI (bandeja, ficha del contacto) muestra "Sin teléfono
  (usuario de WhatsApp)" en vez de un valor vacío o `null` a la vista.

`typecheck`, `lint` y las 332 pruebas (42 archivos, incluidas
`tests/unit/ycloud-username.test.ts` e `tests/unit/ingest-wa-username.test.ts`,
nuevas para este caso) pasan limpio. **Queda sincronizar a la carpeta de
EasyPanel y desplegar** — no se puede probar con el Laboratorio (nunca toca
WhatsApp real) ni hay forma segura de simular un contacto BSUID real; la
verificación definitiva es la próxima vez que escriba un cliente con nombre
de usuario activado.

---

## 1-ago-2026 (tarde/noche) — el vertical de citas y el bot que no respondía

### Segundo vertical de negocio: citas

Construido de cero para dos posibles clientes de peluquería/estética:
catálogo de servicios y personal, motor de disponibilidad (portado de
`BOT VALENTINA CON IA`), y cuatro acciones nuevas del agente para consultar
horarios reales, agendar, reprogramar y cancelar. Opt-in por cliente
(`agent_profile.appointmentsEnabled`) — La Churra y Lis no cambian en nada.
Detalle completo, arquitectura y cómo probarlo en
[19-CITAS.md](19-CITAS.md).

Dos bugs reales encontrados **probándolo de verdad**, no en revisión de
código:

- **Gemini devolvía `content: null`** cuando el último mensaje del array
  enviado a OpenRouter no era de rol `user` (confirmado con una llamada
  directa al proveedor, sin pasar por la app). Pasaba en el loop de
  `consult_availability` (le entregaba al modelo la disponibilidad real como
  mensaje `system`) y, se descubrió después, en el mecanismo YA EXISTENTE de
  "corrección de cierre falso" — mismo patrón, nunca antes verificado en vivo.
  Arreglo: ese mensaje pasa a rol `user`, igual que ya hacía `toChatHistory`
  con los mensajes de una persona del equipo.
- **El modelo confirmaba una cita con `reply` sin ejecutar `book_appointment`**
  — le dijo a una clienta de prueba "quedaste agendada" para un domingo (el
  negocio cierra los domingos) sin que la cita se guardara. Se agregó la
  misma regla dura que ya prohíbe esto para pedidos (`notify_order`).

### Por qué el bot de Lis no respondía algunos mensajes — causa raíz real

Fernando (cliente de Lis) reaccionó/respondió a un Estado de WhatsApp que
publicó el negocio, dos veces en el mismo día, y ninguna de las dos tuvo
respuesta del agente. Investigado a fondo (no se adivinó, se leyeron logs y
la base de datos reales) — dos causas distintas, ambas confirmadas:

1. **El evento de webhook llegó sin el campo `from`** (aunque `type` decía
   `"text"`). `parseYcloudInbound` exige `id`+`wabaId`+`from`: sin uno de los
   tres descarta el evento **antes de guardar nada** — el mensaje se perdió
   sin dejar ni una fila en la base. Evidencia real, del log del contenedor
   que corría en ese momento:
   ```
   [ycloud webhook] MENSAJE DESCARTADO: el evento no trae los datos mínimos
   (id=6a6e20ab48b6207dc2cd5a9f, wabaId=190143772066943, from=falta, type=text)
   ```
2. **Mensajes `type: "unsupported"` se guardaban con `text: NULL`**, y
   `toChatHistory` descarta cualquier fila sin texto al armar lo que ve el
   agente — quedaban invisibles para la IA aunque estuvieran en la base.
   Cuando el mensaje invisible era el último, el turno terminaba con el
   mismo bug del `content: null` de arriba.

Arreglos, los tres desplegados:

- El descarte por falta de datos ahora **loguea el paquete completo** del
  evento (antes solo un resumen de 4 campos), para tener el payload real la
  próxima vez en vez de reconstruirlo a medias.
- Un mensaje sin texto ni adjunto ya no se guarda con `text: NULL`: lleva un
  marcador (`[mensaje no compatible: tipo "..."]`) que lo mantiene visible
  para el agente. Prueba de regresión en
  `tests/unit/mensaje-no-compatible.test.ts`.
- **Aviso al equipo por WhatsApp**, reusando `notifyTeam` (el mismo mecanismo
  del aviso de pedidos): cuando un evento se pierde sin poder guardarse, o
  cuando el agente falla y deriva a una persona. Antes solo quedaba un log;
  ahora alguien se entera en el momento en vez de que el cliente escriba
  enojado por no recibir respuesta.

**Decisión del dueño, aparte**: para Lis, `agent_profile.notify_phones` se
vació — no tiene equipo, y no quiere que se replique nada a ningún otro
número. Todo se ve y se despacha desde el WhatsApp del negocio. Ver
[05-CLIENTES.md](05-CLIENTES.md).

### El Laboratorio: solo la agencia, y ya reconoce citas

Restringido a `superadmin` (page + los 3 endpoints de `/api/lab`): cada
corrida cuesta ~33 llamadas al modelo que paga la agencia, y no tenía sentido
dejar que un cliente lo disparara a discreción. Para probar el agente de un
cliente puntual: "Entrar como" ese cliente en `/admin` y correr el Laboratorio
ahí (`session.organizationId` sigue al cliente impersonado). El juez y el
runner también reconocen ahora el vertical de citas cuando aplica — antes
solo conocían el contrato de pedidos.

### Recordatorio de cita: un botón, no un cron

Decisión del dueño: nada de recordatorios automáticos. Botón **"Recordar"**
en `/appointments`, lo aprieta el personal cuando decida. Si el cliente no le
ha escrito al negocio en las últimas 24 h, WhatsApp no deja mandar texto
libre — el botón lo explica en vez de fallar en silencio.

### Estado del despliegue al cierre de la sesión

Varios commits quedaron **sincronizados en la carpeta de EasyPanel pero sin
confirmar que ya se desplegaron**: el arreglo de "confirmó sin agendar", el
Laboratorio (restricción + citas) y el recordatorio manual. Antes de seguir,
desplegar y volver a correr `pnpm probar:citas` completo (agendar,
reprogramar, cancelar) para confirmar que el bug de la fecha equivocada
(domingo) no reaparece.

Entradas del 1-ago-2026 (mañana) — cotizador y el celular — en
[20-BITACORA-31JUL-TARDE-NOCHE.md](20-BITACORA-31JUL-TARDE-NOCHE.md).
