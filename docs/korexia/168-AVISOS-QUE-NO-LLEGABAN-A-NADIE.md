# 168 — 31 pedidos confirmados que no le llegaron a nadie

**Fecha:** 8-sep-2026 · **Negocios afectados:** MALIA, Lis Pastelería, La Churra

## Lo que se vio

Una clienta de MALIA (Carol) confirmó su pedido a las 23:43. El agente le
respondió *"Dame un momentico 🙏 Te comunico con una persona del equipo"* y
derivó la conversación. **Nadie vino en 14 minutos.** Carol escribió cinco
veces:

```
23:47:53  "Eso estoy esperando hace rato"
23:51:17  "???"
23:54:23  "Ya no hay servicio??"
23:56:38  "??? Estoy esperando respuesta"
23:56:53  "Para saber si me venderán los postres o no"
23:57:51  ← recién aquí contestó una persona
```

## La causa

El campo *"Avisar pedidos a estos WhatsApp"* (`agent_profile.notify_phones`)
estaba **vacío** en MALIA, Lis Pastelería, La Churra y korex.ia. Solo Lashes
Valen lo tenía configurado.

Sin números, `notifyTeam` no tiene a quién escribir: ni el aviso de pedido, ni
el aviso de derivación. El pedido queda solo en la bandeja, y alguien tiene que
estar mirándola.

Alcance real, medido en producción:

```sql
SELECT o.name, c.notify_status, count(*), min(c.created_at)::date
  FROM order_confirmation c JOIN organization o ON o.id = c.organization_id
 GROUP BY 1,2;

 MALIA | Paves . Postres | fallo_recuperable | 29 | 2026-09-05
 Lis Pastelería          | fallo_recuperable |  1 | 2026-09-05
 La Churra               | fallo_recuperable |  1 | 2026-09-07
```

**31 confirmaciones de pedido en toda la plataforma. Cero entregadas. Ninguna,
nunca.**

## Por qué es un fallo del producto y no del negocio

El sistema **lo sabía**, con precisión, las 31 veces. Lo escribió en la base:

```
notify_detail = "sin números de aviso configurados (el pedido queda solo en la bandeja)"   × 31
```

El diagnóstico era perfecto y **no existía una sola superficie donde alguien
pudiera verlo**:

1. **En la base** el estado guardado era `fallo_recuperable` — que suena a hipo
   pasajero de WhatsApp, algo que se arregla solo. Se gastaban los 5 reintentos
   contra el vacío y se rendía.
2. **En los logs** no quedaba ni una línea: `notificarEquipoDeHandoff`
   descartaba entero el `NotifyResult` de `notifyTeam`, y `notifyTeam` devolvía
   el caso "sin números" en silencio.
3. **En el CRM** la pantalla del agente mostraba el campo vacío como cualquier
   otro campo opcional, con una nota gris explicando cómo llenarlo.

Reconstruir esto hubo que hacerlo desde SQL contra producción.

## Lo que se cambió

| Archivo | Cambio |
|---|---|
| `src/server/ai/notify-team.ts` | `NotifyResult.sinDestinatarios` — "no había a quién avisar" deja de ser indistinguible de "el envío falló" (los dos daban `sent: 0`). Y un `console.error` que nombra dónde se arregla. |
| `src/server/ai/pipeline.ts` | `notificarEquipoDeHandoff` deja de descartar el resultado: si se le prometió una persona al cliente y el aviso no llegó a nadie, queda en los logs. No lanza — la derivación en sí es correcta y la conversación tiene que quedar marcada pase lo que pase. |
| `src/components/agent/agent-client.tsx` | Aviso ámbar visible en `/agente` cuando el campo está vacío. Dice la **consecuencia** ("Nadie está recibiendo los pedidos"), no el estado ("campo vacío"). |
| `tests/unit/notify-team.test.ts` | Dos comprobaciones: la bandera distingue de verdad, y el caso queda en los logs. |

## Lo que NO arregla el código

Poner los números es configuración de cada negocio. Y hay una trampa
operativa: **WhatsApp solo deja escribirle a quien le haya escrito al negocio
en las últimas 24 h.** Sin una plantilla aprobada, el aviso funciona un día y
vuelve a morir en silencio. Lashes Valen lo resolvió con la plantilla `Citas
confirmadas`; MALIA, Lis y La Churra no tienen ninguna
(`agent_profile.notify_template` vacío).

## Contexto: las otras dos causas del mismo incidente

1. **El barrio Villa Nueva no estaba en la tabla de zonas de MALIA.** El
   guardarraíl financiero exige una tarifa verificada para cerrar; sin la zona
   no hay forma de producirla, y el pedido muere al cerrar —después de que la
   clienta ya confirmó todo—. Las 4 activaciones del guardarraíl de ese día
   fueron todas `domicilio-no-verificado`, ninguna un total mentido. Lía creó
   la zona a las 23:57:11, 14 minutos después. **Cali tiene ~340 barrios y la
   tabla tiene 38: el caso se repetirá.**
2. **El equipo escribe en los mismos hilos que el agente** — 101 mensajes de
   personas contra 273 del agente en 6 horas. A las 23:37 una persona escribió
   *"Serían en total 38.000 con el domicilio incluido"*; el agente leyó ese
   mensaje en el historial a las 23:42 y adoptó el $38.000 como compromiso
   propio, sin poder sostenerlo después. Ver `memory/equipo-escribe-en-los-chats.md`.

## Cómo revertir

`git revert` del commit. Nada de esto cambia el esquema ni la configuración de
ningún negocio: es una bandera en un tipo de retorno, dos `console.error` y un
bloque de aviso en una pantalla. Revertirlo devuelve el silencio anterior.
