# Aprender de los chats que ya existían

> **Dentro:** Lo que se perdía · Qué manda WhatsApp · La regla que lo hace
> seguro · Aprender de seis meses · Qué hacer al conectar un cliente

14-ago-2026, conectando el salón: *"necesito que el bot aprenda también por
medio de la coexistencia, de los chats anteriores"*.

## Lo que se perdía

Al activar la **coexistencia**, WhatsApp sincroniza **hasta 6 meses de chats
anteriores** y YCloud los reenvía como `whatsapp.smb.history`. La app procesaba
dos tipos de evento —el mensaje nuevo y el eco de lo que el equipo escribe desde
el celular— y **este caía en el `evento ignorado`**.

Con él se perdía lo mejor que tiene un negocio que lleva años atendiendo por
WhatsApp: **lo que ya le ha contestado a sus clientas**. Ahí están la dirección,
el parqueadero, las formas de pago, qué pasa si llueve, cuánto dura de verdad un
volumen ruso — todo dicho con sus palabras.

## La regla que lo hace seguro

`ingestHistoryMessage` **solo guarda**. Cada cosa que NO hace tiene su motivo:

| No hace | Si lo hiciera |
|---|---|
| Despertar al agente | El negocio amanece con el bot respondiendo a decenas de clientas sobre pedidos de hace meses |
| Tocar `lastInboundAt` | Es lo que decide la ventana de 24 h de WhatsApp: una fecha vieja puede cerrar la de una conversación viva |
| Marcar relevo humano | Que alguien respondiera en mayo no significa que hoy esté atendiendo esa conversación a mano |
| Transcribir audios y fotos | Cientos de llamadas al modelo por material viejo, y los enlaces de medios de WhatsApp caducan |

> 🔑 Es el motivo de que sea una función aparte y no un parámetro de las otras
> dos. La prueba que lo fija comprueba justo eso: que el evento de historial
> **no** pasa por `ingestInboundMessage`.

También se respeta el nombre del contacto que ya tuviera: el historial trae el
de hace seis meses, y pisar el actual sería cambiar hacia atrás lo que el equipo
ya ve bien.

## Aprender de seis meses

En **Agente → Aprendizaje** hay ahora dos botones:

- **Buscar aprendizajes** — la última semana, como siempre.
- **Aprender del historial** — incluye los chats importados. Sube el tope de
  400 a 1.200 mensajes.

Dos cosas que no eran obvias:

- **La ventana de días no había que tocarla.** El filtro es por `createdAt`
  (cuándo se guardó la fila), y el historial se guarda el día que se importa.
- **El orden sí.** Todas esas filas nacen con casi el mismo `createdAt`, así que
  ordenar por ahí mezclaba conversaciones de meses distintos y el modelo leía
  diálogos descosidos. Ahora se ordena por `waTimestamp` — cuándo se dijo de
  verdad.

Lo demás no cambia: **nada entra al conocimiento sin que una persona lo
apruebe** ([11-APRENDIZAJE.md](11-APRENDIZAJE.md)).

## Qué hacer al conectar un cliente

1. En el alta de YCloud, **autorizar la sincronización del historial** y dejar
   la app de WhatsApp Business abierta mientras sincroniza.
2. Esperar a que dejen de entrar mensajes (llegan en lote).
3. **Agente → Aprendizaje → "Aprender del historial"**, una sola vez.
4. Aprobar lo que sirva. Es el atajo más rápido que hay para llenarle el
   conocimiento a un negocio que ya venía atendiendo por WhatsApp.

> ⚠️ Si el número se conecta **antes** de desplegar esto, el historial llega, se
> ignora y **no se reintenta**: WhatsApp no lo vuelve a mandar. En ese caso queda
> el camino manual (exportar los chats desde el teléfono) o vivir sin él.
