# El embudo no veía la mitad de las ventas

> **Dentro:** El reporte · La causa · Los números · Por qué un botón no bastaba
> · Lo que se hizo · Cómo se cierra un lead hoy · Lo que sigue sin cubrirse

Reportado por el dueño el **9-ago-2026**: un cliente de Lis pagó, se le
despachó, y su tarjeta seguía en "En conversación" en vez de "Cliente". *"Y como
ese hay muchos."*

## La causa

El embudo se cerraba **solo cuando el AGENTE emitía `notify_order`**
(`pipeline.ts` → `onLeadWon`). Era el único camino.

En Lis el agente casi nunca interviene: **Karen atiende ella misma desde el
WhatsApp del negocio**, por coexistencia ([05-CLIENTES.md](05-CLIENTES.md)). El
turno del agente no corre, no hay acción, y el lead se queda donde estaba
aunque el pedido se cobre y se entregue.

En el caso reportado se ve exacto:

```
handoff_reason = 'operador'
todos los mensajes salientes con ai_generated = false
  ↳ incluido "✅🩷 ¡Listo! Recibimos tu pago"  ← lo escribió ella, no el bot
```

Por lo mismo, la etapa **"Interesado" tenía 0 leads**: solo se llega ahí si el
agente emite `move_stage`.

## Los números (medidos antes de tocar nada)

| Etapa | Leads | Con comprobante de pago |
|---|---|---|
| En conversación | 51 | **15** |
| Cliente | 16 | 11 |

**46 de las conversaciones las atendió una persona.** El tablero decía 16
clientes cuando había 31: **casi la mitad de las ventas eran invisibles**, y con
ellas cualquier cuenta de conversión.

Los 15 se movieron a "Cliente" el mismo día, verificando antes que todos
tuvieran un comprobante registrado.

## Por qué un botón, solo, no bastaba

La solución evidente era un botón "marcar como cliente" en la bandeja. **Para
Lis no habría servido**: Karen responde desde su celular y no entra al CRM a
contestar. Un botón en una pantalla que no usa no arregla nada.

Lo único que llega al sistema pase lo que pase es el **comprobante de pago**:
entra como imagen, se lee y se guarda como `[COMPROBANTE] Nequi · $44.000 · …`
([`ai/transcribir.ts`](../../src/server/ai/transcribir.ts)). Esa es la única
señal de venta que no depende de que nadie recuerde hacer nada.

Se hicieron **las dos cosas**, porque cubren casos distintos.

## Lo que se hizo

**1. Cierre automático por comprobante.** Al ingerir un mensaje entrante, si es
un comprobante, el lead pasa a la etapa de cierre — lo atienda el agente o una
persona.

Exige que el mensaje sea una **imagen**: la marca `[COMPROBANTE]` la escribe el
sistema al leer la foto, así que un cliente que teclee esa palabra no se
auto-asciende a cliente. Hay prueba de eso.

**2. Botón "Marcar cliente" en la cabecera de la conversación.** Para lo que se
cobra en efectivo o por una vía que no deja rastro en el chat. Pulsarlo de más
no hace daño: `onLeadWon` ignora al lead que ya estaba ganado.

## Cómo se cierra un lead hoy

| Camino | Cuándo | Desde |
|---|---|---|
| `notify_order` del agente | El agente confirma un pedido | 31-jul |
| **Comprobante de pago** | Entra la foto de una transferencia | **9-ago** |
| **Botón en la bandeja** | Alguien lo decide a mano | **9-ago** |
| Arrastrar en el tablero | Corrección manual | siempre |

## Lo que sigue sin cubrirse

- **Un comprobante no prueba que el pago sea válido.** Eso lo revisa el equipo
  ([16-COMPROBANTES.md](16-COMPROBANTES.md) y la decisión del 1-ago de no
  automatizar la verificación). Aquí solo se afirma que la conversación dejó de
  ser una consulta; si alguien manda un comprobante y luego cancela, la tarjeta
  se arrastra de vuelta.
- **"Interesado" seguirá casi vacío** en los negocios que atienden a mano: es
  una etapa que solo mueve el agente. No es un fallo, pero conviene saberlo
  antes de sacar conclusiones del tablero.
- **Los leads perdidos no se marcan solos.** Nadie mueve nada a "Perdido", así
  que esa columna no significa nada todavía.

---

## El otro lado del embudo: los que se enfrían (9-ago-2026, tarde)

Cerrado el agujero de las ventas invisibles quedaba el simétrico, y el dueño lo
señaló: *"los clientes que se enfrían son importantes y deben ir allí"*.

### Por qué la columna de perdidos marcaba 0

Solo se llegaba de dos maneras: que el AGENTE emitiera `move_stage` —y para eso
el cliente tenía que **anunciar** que se iba ("ya compré en otro lado"), cosa que
casi nadie hace— o arrastrando la tarjeta a mano. No existía ningún camino
automático. Resultado: "En conversación" acumulaba vivos y muertos juntos.

### La regla: 2 días de silencio

El dueño descartó los 7 y 15 días que se le propusieron, con razón: *"para
clientes que están pidiendo comida y servicios de peluquería son antojos y una
necesidad inmediata"*. Los datos le daban la razón — medido sobre 68 tarjetas en
columnas abiertas:

| Umbral | Tarjetas que se moverían |
|---|---|
| 2 días | **49** |
| 7 días | 17 |
| 15 días | **0** |

Con 15 días la función no habría hecho nada.

**Se mide desde el último mensaje ENTRANTE** (`conversation.last_inbound_at`), no
desde la última actividad: si contara la actividad general, bastaría con que el
negocio escribiera para recalentar la tarjeta aunque el cliente nunca contestara
— justo al revés de lo que se busca.

### Lo que hizo obligatoria la segunda pieza

Un umbral corto sin retorno automático es una trampa:

> Cliente pregunta el lunes → el miércoles se enfría → **el jueves vuelve y hace
> un pedido** → su tarjeta se queda en "Por recuperar" mientras compra.

Con 15 días eso pasa poco; con 2, todo el tiempo. Por eso `reactivarLeadPorMensaje`
sube la tarjeta al llegar un mensaje entrante. **Solo desde la etapa de
enfriamiento**: un lead ganado que escribe de nuevo sigue siendo cliente, que era
la razón original de que un lead cerrado no se reabriera.

### Dónde vive

| Pieza | Dónde |
|---|---|
| `DIAS_PARA_ENFRIAR = 2`, `enfriarLeadsInactivos`, `reactivarLeadPorMensaje` | `server/inbox/lead-activity.ts` |
| Disparo cada 10 min | `server/ai/worker.ts` (ciclo de mantenimiento) |
| Retorno al escribir | `server/inbox/ingest.ts` |
| "Sin responder hace X días" en la tarjeta | `components/pipeline/pipeline-client.tsx` |

Nada de esto mira el NOMBRE de la etapa, solo su `kind`: por eso el ancla `lost`
pudo pasar a llamarse **"Por recuperar"** (también en `SEED_STAGES`) sin tocar
una línea de lógica, y cada cliente puede renombrarla desde el tablero.

### Probado contra Postgres real

`tests/integration/enfriamiento-leads.test.ts`, 9 casos: que baje el frío, que no
toque al activo, que **no enfríe a quien nunca escribió** (la subconsulta da NULL),
que no saque a un ganado, que sea idempotente, que el umbral mande, y los tres del
retorno. Las pruebas encontraron un fallo real antes de desplegar: el driver
revienta al enlazar un `Date` dentro de un `sql` crudo, así que la fecha va como
texto ISO con cast explícito.
