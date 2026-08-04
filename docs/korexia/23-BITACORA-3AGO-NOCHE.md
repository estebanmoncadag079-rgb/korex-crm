# Bitácora: 3-ago-2026 (tarde/noche) — cuatro bugs reales de "el bot no responde" y una revisión de arquitectura

> **Dentro:** Isabella — handoff sin sentido por una edición de WhatsApp ·
> Texto real de una edición · Handoff mudo al pedir un asesor · El bug más
> grave: BSUID rechazado como teléfono · Revisión de arquitectura: tabla
> `webhook_event` y quitar `after()` · Incidente de despliegue (migración
> aplicada a mano) · Horario propio del domingo · Menú inicial y contenido de
> Lis

Sesión larga disparada por el dueño reportando varios "el bot no responde"
seguidos con Lis Pastelería. Cada caso se investigó con evidencia real (la
base de datos y los logs del contenedor), nunca por teoría. Las horas van en
**UTC** salvo que diga "Colombia" (UTC−5).

---

## 1. Isabella Polanco — handoff sin sentido por una edición de WhatsApp

Isabella editó un mensaje de texto ("Para ni" → "Para mi"). YCloud mandó esa
edición como un evento `type: "edit"` sin texto — el código convertía eso en
el marcador `[mensaje no compatible: tipo "edit"...]` (arreglo del 1-ago para
que las reacciones a Estados no desaparecieran) y se lo pasaba al agente
**como si el cliente lo hubiera escrito**. El modelo, confundido, ejecutó la
acción `handoff` — y como Lis no tiene número de aviso (decisión del dueño,
ver [05-CLIENTES.md](05-CLIENTES.md)), la clienta quedó esperando hasta que
Karen lo notó por su cuenta y cerró el pedido a mano.

**Arreglo**: `ingestInboundMessage` ya no dispara el turno del agente cuando
el mensaje no trae texto ni adjunto — se sigue guardando (visible en la
bandeja), pero no se le pasa al modelo como si fuera contenido real. Se
agregó además un log del evento YCloud completo en ese caso, para poder ver
la próxima vez qué trae realmente un tipo desconocido.

## 2. El texto real de una edición SÍ viaja — solo que en otro campo

Reproduciendo el caso en vivo, el log agregado en el punto 1 mostró el
payload completo de una edición real:

```json
"type": "edit",
"edit": { "originalMessageId": "wamid...", "message": { "type": "text", "text": { "body": "quiero un cremoso de 16 oz" } } }
```

`edit.message.text.body` trae el texto corregido — el parser nunca lo leía.
**Arreglo**: `parseYcloudInbound` extrae ese campo y normaliza el tipo a
`"text"`: el agente ahora sí ve y responde al contenido editado, en vez de
solo evitar la reacción confusa (mejora más completa que el punto 1).

## 3. El cliente pide un asesor y el bot no decía nada

Al probar "me puedes pasar con un asesor?", el bot no mandó **ningún**
mensaje antes de pasar a modo humano. Causa: el patrón de respaldo (FR-022,
`matchesHandoffIntent`, corta el turno ANTES de llamar al modelo cuando el
texto matchea frases como "un asesor") solo hacía `applyHandoff` a secas, sin
avisar a nadie — a diferencia del camino de "error" (fallo del proveedor),
que sí usa `derivarAUnaPersona` (avisa al cliente y notifica al equipo).

**Arreglo**: ese camino ahora reusa `derivarAUnaPersona`, con un resumen
propio para el equipo ("un cliente pidió hablar con una persona").

## 4. El bug más grave: BSUID rechazado como número de teléfono

Nathalia (clienta nueva de Lis, con nombre de usuario de WhatsApp activado —
ver el arreglo del 2/3-ago en [07-BITACORA.md](07-BITACORA.md)) escribió
"Buenas tardes" y el bot no respondió. Al intentar contestarle **a mano**
desde la bandeja, el CRM mostró: `Invalid E.164 phone number:
CO.38528566123409360`.

Causa raíz (confirmada con la documentación oficial de YCloud vía
`docs.ycloud.com/reference/whatsapp_message-send-directly`): `sendDirectly`
exige **uno** de dos campos — `to` (E.164) o `recipient` (BSUID) — nunca el
BSUID por `to`. El arreglo del 2/3-ago guardaba bien estos contactos, pero al
**responder** siempre mandaba el valor (fuera teléfono o BSUID) por `to`. Esto
rompía tanto la respuesta automática del agente como cualquier respuesta
manual desde la bandeja, para **cualquier cliente con nombre de usuario
activado, en cualquier negocio**.

**Arreglo**: `resolveRecipient` (en `@/lib/meta/client`) devuelve ahora un
tipo discriminado `RecipientTarget` (`{kind:"phone"|"waUserId", value}`) en
vez de un string plano; `ycloudSendText`/`ycloudSendTemplate` arman el
payload con el campo correcto según el tipo. Detalle completo, con el ejemplo
de payload real, en [03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md).

---

## 5. Revisión de arquitectura: tabla `webhook_event` y quitar `after()`

El dueño pidió una revisión externa de la arquitectura (12 recomendaciones en
4 fases). Evaluación honesta: la Fase 0 (capturar el webhook crudo antes de
procesar) era de alto valor y bajo costo — se implementó. El resto (cola con
`pg-boss`, debounce persistente, Row-Level Security, rate-limit por
organización) se evaluó y se **decidió NO implementar por ahora**: el VPS es
de un solo núcleo operado por una persona, y ninguno de los 4 bugs reales de
esta sesión tuvo que ver con fallos de infraestructura — los cuatro fueron
bugs de lógica. Quedó registrado para revisitar si el negocio crece lo
suficiente. Detalle de la evaluación completa en
[21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md).

Lo implementado: tabla `webhook_event` (payload crudo, headers, firma,
organización resuelta, estado `recibido`/`procesado`/`fallido`, error,
intentos) — el `INSERT` ocurre ANTES de procesar el evento; si falla, se
responde `5xx`. Se quitó `after()` de los dos webhooks de YCloud: el
procesamiento corre en el mismo request en vez de "en segundo plano", porque
esto es un contenedor de larga vida (Docker Swarm), no una función serverless
que se apague al responder — `after()` resolvía un problema que aquí no
existe, y a cambio ocultaba fallos de procesamiento sin dejar rastro alguno.

## 6. Incidente de despliegue: una migración aplicada a mano rompió el arranque

Al aplicar la migración de `webhook_event` **manualmente por SQL** (en vez de
dejar que el propio arranque del contenedor la corriera), la tabla quedó
creada pero **sin registro** en `drizzle.__drizzle_migrations`. Al desplegar,
el contenedor nuevo intentó recrearla, falló ("ya existe"), y entró en un
ciclo de reinicios de ~15 minutos. Diagnosticando el problema se cometió un
segundo error: se borró por error el registro de control de OTRA migración ya
aplicada legítimamente (la de `wa_user_id`, punto 4), lo que hizo que el
contenedor también intentara reaplicar esa.

Se leyó el código fuente real del migrador (`drizzle-orm/pg-core/dialect.js`)
para entender el algoritmo exacto: **solo mira el `created_at` más reciente
registrado**, no compara hash por migración. Con eso se reconstruyó
correctamente la tabla de control (hashes SHA-256 calculados sobre el
contenido real de cada archivo, tal como sale de `git archive`). Efecto
secundario del ciclo de fallos: Swarm pausó automáticamente el `update` y
dejaron **dos contenedores corriendo a la vez** (riesgo real: el debounce del
agente vive en memoria de cada proceso, dos réplicas activas podrían
duplicar respuestas) — se forzó `docker service update --force` para
completar la transición a una sola réplica.

**Ningún mensaje real se perdió**: el contenedor viejo nunca dejó de estar
`healthy` durante el incidente.

**Lección aplicada de inmediato**: la migración siguiente (horario de
domingo, punto 7) se dejó para que el propio `migrate.mjs` del contenedor la
aplicara al arrancar — confirmado en el log (`[migrate] migraciones
aplicadas`), sin ningún reinicio.

---

## 7. Horario propio del domingo

El modelo de datos solo tenía UN rango de horas para toda la semana — no se
podía expresar "L-S 10-20, domingo 14-19" (lo que pidió el dueño para Lis).
Se agregaron `agent_profile.hoursOpenSunday`/`hoursCloseSunday` (nullable):
si ambos están definidos, el domingo SIEMPRE usa ese rango, sin necesidad de
que el 7 esté en `hoursDays`. `businessStatus`/`abreMasTardeHoy` (y el
mensaje "abre a las X" del prompt) resuelven el rango del día real en vez de
asumir siempre el genérico. El motor de citas no se toca — los campos son
opcionales y ese módulo no los lee. Dato aplicado a Lis: L-S 10:00-20:00,
domingo 14:00-19:00.

## 8. Menú inicial y contenido de Lis (datos, no código)

A pedido del dueño, Lis tiene ahora un saludo con menú numerado (1. Ver menú
y precios · 2. Hacer un pedido · 3. Preguntas frecuentes · 4. Hablar con un
asesor), con instrucciones de enrutamiento que reusan lo que ya existía (el
enlace de la carta, el flujo normal de pedido, el KB para FAQ, `handoff` para
asesor) — sin obligar al cliente a usar el menú si ya dice directamente qué
quiere. Verificado en vivo: las 4 opciones responden bien.

Dos ajustes de contenido más, encontrados probando pedidos reales: (a) la
regla "no inventes tortas grandes/personalizadas" pasó de estar solo en
`instructions` (donde el modelo la pasó por alto una vez, respondiendo que
"solo se manejan porciones") a estar TAMBIÉN en `escalationRules` (el campo
pensado para esto, con más peso); (b) la explicación del domicilio (se paga
al repartidor, no entran a apartamentos/CC, valor exacto se confirma cuando
sale el pedido) nunca se enviaba en ningún punto del flujo real — existía
como instrucción suelta en prosa ("avísale que...") sin un lugar fijo donde
debiera aparecer. Se convirtió en una línea obligatoria del template del
resumen del pedido, y se armonizó con el KB.

**Recordatorio**: todo esto es contenido de la organización de Lis
(`agent_profile.greeting`/`instructions`, `kb_entry`), no código — no afecta
a La Churra ni a ningún otro cliente a menos que se le configure lo mismo a
propósito. Ver [00-INDICE.md](00-INDICE.md), tabla "Qué se toca / A quién
afecta".
