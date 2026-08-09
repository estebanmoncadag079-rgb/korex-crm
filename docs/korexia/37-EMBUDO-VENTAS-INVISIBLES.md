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
