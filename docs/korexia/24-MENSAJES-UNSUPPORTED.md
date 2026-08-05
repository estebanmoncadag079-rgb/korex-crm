# Mensajes que Meta entrega vacíos (`type: "unsupported"`)

> **Dentro:** Qué es y por qué el bot no responde · El paquete real que manda
> YCloud · Cómo se ve en la bandeja · Cada cuánto pasa · Por qué se decidió
> dejarlo así · Cómo reconocerlo en 30 segundos

Un cliente escribe algo, **para él el mensaje sale normal**, y el negocio no
responde nada. No es un fallo del CRM ni del agente: **Meta entrega el evento
sin ningún contenido**. Este documento existe para no volver a investigarlo
desde cero — pasa cada pocos días, en todos los clientes.

## Qué es y por qué el bot no responde

Cuando la Cloud API de Meta recibe un tipo de mensaje que todavía no soporta,
entrega el evento igual pero **vacío**: sin texto, sin adjunto y **sin decir
siquiera qué clase de contenido era**. Ese contenido no se puede recuperar por
ninguna vía — no está en el evento, y no hay otro sitio de dónde sacarlo.

El CRM hace dos cosas con él, las dos a propósito:

1. **Lo guarda**, con un marcador de texto (`[mensaje no compatible: tipo
   "unsupported", revisa WhatsApp directamente]`), para que quede visible en el
   hilo y nadie crea que se perdió. Lo pone `textoDeMensaje()` en
   `src/server/inbox/ingest.ts` — arreglo del 1-ago-2026, porque
   `toChatHistory` descarta las filas sin texto y estos mensajes desaparecían.
2. **No dispara el turno del agente** (`if (!texto && !input.mediaUrl) return;`,
   mismo archivo). Es el guardia del 3-ago-2026: pasarle el marcador al modelo
   como si el cliente lo hubiera escrito lo confunde — el caso de Isabella
   terminó con el modelo ejecutando `handoff` sin motivo. Ver
   [23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md).

Consecuencia: **silencio total hacia el cliente**, y nadie se entera salvo que
alguien mire la bandeja.

## El paquete real que manda YCloud

Capturado en `webhook_event` el **4-ago-2026 16:35 UTC** (11:35 Colombia),
conversación de Heidy Chinguad en Lis Pastelería:

```json
{
  "type": "whatsapp.inbound_message.received",
  "whatsappInboundMessage": {
    "from": "+573165345762",
    "type": "unsupported",
    "errors": [{
      "code": "131051",
      "title": "Message type unknown",
      "error_data": { "details": "Message type is currently not supported." }
    }],
    "unsupported": { "type": "unknown" },
    "fromUserId": "CO.1031124232991481",
    "customerProfile": { "name": "Heidy Chinguad", "username": "HeidyChinguad" }
  }
}
```

Lo que confirma este payload, y antes solo se suponía:

- **El contenido no viaja en ningún campo alternativo.** `unsupported.type` es
  literalmente `"unknown"`: ni Meta sabe qué era.
- **El evento se procesó bien** (`status = 'procesado'`): la entrada funciona,
  el mensaje quedó guardado. No es el caso del 1-ago, donde el evento llegaba
  sin `from` y se descartaba entero sin dejar fila.
- **No tiene que ver con los nombres de usuario de WhatsApp.** Heidy tiene uno
  activado (`username`, `fromUserId`), pero YCloud mandó igual su teléfono en
  `from` y el contacto quedó bien guardado. Es otra familia de problema — ver
  [03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md).

Esta captura es exactamente para lo que se creó la tabla `webhook_event` la
noche anterior: la primera vez que se pudo mirar el evento crudo en vez de
deducirlo.

## Cómo se ve en la bandeja

Como un adjunto con la etiqueta genérica **"Contenido"** (`mediaLabel()`
devuelve eso para cualquier tipo que no conozca) seguida del marcador. No hay
nada que abrir: el adjunto no existe, es solo cómo se pinta un tipo
desconocido.

## Cada cuánto pasa

**18 mensajes** entre el 28-jul y el 4-ago-2026: **9 en La Churra y 9 en Lis
Pastelería**, repartidos en 6 días distintos (hasta 5 en un mismo día).
Consulta usada:

```sql
select date(wa_timestamp) as dia, count(*) from message
where type = 'unsupported' and direction = 'in' group by 1 order by 1 desc;
```

## Por qué se decidió dejarlo así (4-ago-2026)

Se evaluó responder automáticamente algo fijo y sin IA ("no me llegó bien ese
mensaje, ¿me lo puedes escribir?"), solo cuando no hubiera relevo humano
activo y con un límite anti-repetición. **El dueño decidió no tocar el
código** y dejar el comportamiento actual: el mensaje se ve en la bandeja y el
negocio contesta a mano si hace falta. Queda documentado por si el caso se
vuelve más frecuente o algún cliente se queja.

## Cómo reconocerlo en 30 segundos

Ante un "el bot no le respondió a X", antes que nada:

```sql
-- 1. ¿El mensaje llegó vacío?
select direction, type, left(text, 60), wa_timestamp
from message where conversation_id = '<id>' order by wa_timestamp desc limit 5;
--    type = 'unsupported' + el marcador → es esto, no hay más que investigar.

-- 2. Confirmarlo con el evento crudo
select jsonb_pretty(payload) from webhook_event
where raw_body like '%<telefono>%' order by received_at desc limit 1;
--    errors[0].code = '131051' → Meta no soporta ese tipo de mensaje.
```

Si el `type` **no** es `unsupported`, el problema es otro: seguir por el
checklist de causas confirmadas de "el bot no responde".
