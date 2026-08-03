# Bitácora: qué se cambió y por qué

> **Dentro:** 2/3-ago-2026 — nombres de usuario de WhatsApp (BSUID): el bot no respondía · 1-ago-2026 (tarde/noche) — el vertical de citas y el bot que no respondía · 1-ago-2026 (mañana) — cotizador y el celular

Historial de los cambios que llegaron a producción. Lo más reciente arriba.
Las horas van en **UTC** salvo que diga "Colombia" (UTC−5). Entradas más
antiguas en [20-BITACORA-31JUL-TARDE-NOCHE.md](20-BITACORA-31JUL-TARDE-NOCHE.md)
y [12-BITACORA-ANTERIOR.md](12-BITACORA-ANTERIOR.md).

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

---

## 1-ago-2026 (mañana) — cotizador, y la aplicación en el celular

### El costo lo mandan los mensajes, no las conversaciones

La tabla de precios cobraba "por conversación" como si todos los negocios
cerraran igual. No lo hacen: **La Churra manda 6,7 mensajes por conversación y
Lis 8,3**, y un negocio que necesitara 20 costaría más del doble.

Hay **cotizador en `/admin`** con esa variable como campo. El modelo sale de
medir, no de estimar: **0,0020 USD por respuesta** del agente, con las 38
llamadas registradas dando 0,00197 en La Churra y 0,00202 en Lis. Coinciden
porque lo que domina es el prompt del sistema, que se manda entero en cada turno.

Efecto incómodo: el margen real de los planes baja del 87 al **79 %**. La cifra
anterior salía del costo medio de hoy, donde el bot solo responde unas 3 veces
por conversación y el resto lo atiende una persona. Ver
[14-COTIZAR.md](14-COTIZAR.md) y [15-VENDER.md](15-VENDER.md).

### Fotos: se transcriben, no se resumen

Un pedido escrito a mano acababa como "[IMAGEN] Hoja con un pedido escrito a
mano". Ahora son tres casos —comprobante, texto e imagen— y el texto se copia
entero. Los productos se describen por lo que los distingue (capas, envase,
toppings) para que el agente los empareje con su catálogo.
[13-AUDIO-E-IMAGENES.md](13-AUDIO-E-IMAGENES.md).

### La aplicación se puede usar desde un celular

Estaba construida **solo para escritorio**. En un teléfono el menú ocupaba media
pantalla y el resto se salía por el borde. 27 archivos, solo presentación —ni un
fichero de `src/server`, `src/lib` o `src/app/api`—, y dos bugs de verdad por el
camino: en Safari de iOS **no se podía contestar un mensaje**, y en el embudo las
tarjetas **cambiaban de etapa al deslizar** la lista. [18-MOVIL.md](18-MOVIL.md).

### Tres despliegues que no llegaron a producción

Se construyó con la etiqueta `korex-crm:latest` en vez de
`easypanel/korex-crm/crm:latest`. Cada build terminó bien, cada reinicio dijo
`converged` y la web respondía 200 — mientras se construía **una imagen que no
usa nadie**. Además la carpeta de la que construye EasyPanel se quedó sin
sincronizar, así que el siguiente Desplegar habría revertido tres
funcionalidades. Corregido y documentado en
[02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md).
