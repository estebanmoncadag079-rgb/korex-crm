# La venta que se perdió porque el cliente se corrigió a sí mismo

> **Dentro:** Lo que pasó · La secuencia exacta · Por qué el bot enmudeció ·
> El patrón que ya va por tres incidentes · El arreglo · Lo que queda abierto

**Jorge, La Churra, 2-ago-2026 18:32 Colombia.** Un pedido de 14 churritos, con
salsas y recubrimiento ya elegidos, que terminó en "te comunico con una
persona" y no volvió a escribir. El agente era perfectamente capaz de
cerrarlo: de hecho lo estaba cerrando bien.

## La secuencia exacta

Sacada de la base de datos (`created_at`, hora del servidor en UTC; Colombia
es UTC−5):

| Hora | Quién | Qué |
|---|---|---|
| 23:32:20.511 | agente | "¡Perfecto! Chocolate y Arequipe para tus salsitas…" |
| 23:32:22.000 | Jorge | **"Azur y canela"** ← se equivocó escribiendo |
| 23:32:33.547 | Jorge | **"Azúcar y canela"** ← se corrigió, 11 s después |
| 23:32:34.497 | agente | "¡Excelente elección! Azúcar y canela para tus churritos. 😋" |
| 23:32:43.481 | agente | **"Dame un momentico 🙏 Te comunico con una persona…"** |

La conversación quedó con `handoff_reason = 'error'`. **El agente entendió
perfectamente** —respondió bien al typo— y aun así se derivó a sí mismo nueve
segundos después.

## Por qué el bot enmudeció

1. El primer mensaje ("Azur y canela") programó el turno con el debounce de
   `AGENT_COALESCE_MS` (6 s).
2. La corrección llegó **con el turno ya en marcha**. `scheduleAgentTurn` hace
   `entry.pending = true` en ese caso, así que al terminar el primer turno se
   disparó un **segundo turno**.
3. Ese segundo turno **no tenía nada que contestar**: la respuesta del agente
   ya se había guardado, así que el historial terminaba con ella.
4. `toChatHistory` mapea los mensajes salientes como `role: "assistant"`. El
   array quedó terminando en `assistant`, sin ningún turno de usuario después.
5. **google/gemini-2.5-flash devuelve `content: null` en ese caso.** Sin
   contenido, el turno se dio por fallido → `derivarAUnaPersona` con razón
   `error` → el cliente recibió el "dame un momentico".

Nada de esto fue un fallo del proveedor ni del prompt: fue un turno que nunca
debió ejecutarse.

## El patrón que ya va por tres incidentes

Que el array termine en algo que no sea `user` deja mudo a Gemini. Es el mismo
mecanismo, por tres caminos distintos:

| Cuándo | Cómo llegó ahí | Qué se hizo |
|---|---|---|
| 1-ago | El loop de `consult_availability` cerraba con un mensaje `system` | Se cambió a `user` **solo ahí** |
| 1-ago | El mensaje real del cliente quedaba invisible (`unsupported`) y el último era la respuesta del agente | Marcador de texto para que no desapareciera |
| **2-ago** | **Un segundo turno sin nada nuevo que responder** | **Este documento** |

Las dos primeras veces se tapó el camino concreto, no el mecanismo. Vale la
pena tenerlo presente ante cualquier "el bot no responde" nuevo: **si el
último mensaje que ve el modelo no es del cliente, va a devolver vacío.**

## El arreglo

En `runAgentTurn`, justo después de cargar el historial: **si el último
mensaje no es entrante, el turno se omite antes de llamar al modelo.**

```ts
const ultimo = history[history.length - 1];
if (ultimo && ultimo.direction !== "in") {
  console.info(`[agente] turno omitido en ${conversationId}: …`);
  return null;
}
```

Es determinista, no depende del modelo, y además **ahorra la llamada** (y su
costo) en cada turno de estos. Cubierto por
`tests/unit/turno-sin-nada-nuevo.test.ts`, que reproduce la secuencia de Jorge
tal cual y comprueba que no se llama al modelo, no se envía nada al cliente y
no se avisa al equipo — y que un turno normal (mensaje del cliente al final)
sigue corriendo.

✅ **Desplegado el 5-ago-2026 20:19 UTC** (commit `3dfb91b`), verificado dentro
del contenedor. Tras el despliegue, La Churra y Lis atendieron pedidos reales
completos —incluido uno con comprobante de pago y confirmación— **sin un solo
mensaje en `failed` ni un handoff de error**.

---

# Segunda parte: Tatis, y el mensaje que sí se perdía

El caso real que faltaba llegó el mismo día. **Tatis, Lis Pastelería, 5-ago
13:47 Colombia** (18:47 UTC, **1 h 32 min antes** de que el arreglo de arriba
estuviera en producción):

| Hora | Quién | Qué |
|---|---|---|
| 18:46:59 | Tatis | "Depronto ya tienen servicio a domi?" |
| 18:47:03.074 | Tatis | **"1"** (Ver menú y precios) |
| 18:47:03.995 | agente | "¡Claro que sí! Hacemos domicilios por *Yango*…" |
| 18:47:15 | agente | "Dame un momentico… te comunico con una persona" |

Mismo mecanismo que Jorge, con una consecuencia peor: **el "1" quedó guardado
por detrás de la respuesta y nunca recibió la carta**. Eran dos cosas
distintas —una pregunta y una opción del menú— y se atendió una sola.

## Por qué pasa tan seguido: el debounce está en 3 s

`AGENT_COALESCE_MS=3000` en producción (no el default de 6000). Con 3
segundos, a un cliente le basta escribir su segunda frase 4 s después para
caer justo en el turno en marcha. La agrupación de ráfagas casi no llega a
hacer su trabajo.

## El cierre: una marca de hasta dónde llegó cada turno

El límite que quedaba abierto arriba ya no lo está. `conversation.
last_turn_inbound_at` (migración `0015_thin_shriek.sql`) registra hasta qué
mensaje del cliente llegó el último turno, y `entrantesSinResponder()` compara
contra esa marca:

- **Sin pendientes** → el turno se omite antes de llamar al modelo (el caso
  Jorge, que ahorra además la llamada).
- **Con pendientes** → el turno corre, y los pendientes se **reordenan al
  final** del historial: el modelo ve su respuesta anterior y, después, lo que
  el cliente sigue esperando. Que es exactamente lo que pasó visto desde el
  chat — y de paso garantiza que el array **nunca termine en `assistant`**,
  que es la raíz de todo esto.

La marca se guarda **antes** de llamar al modelo: si el turno falla a mitad,
esos mensajes no pueden volver a dispararlo en bucle.

Para conversaciones anteriores a la columna (marca nula) se cae al criterio
del 5-ago —los entrantes que hay después de la última respuesta—, que no falla
en falso y solo se queda corto justo en el caso de carrera.

**Además**, una regla nueva en el contrato de acciones: si el cliente manda
varias cosas seguidas, se atienden **todas**, en el orden en que las escribió,
y eso nunca es motivo para escalar a una persona.

## El debounce vuelve a 6 segundos (decidido el 5-ago-2026)

Con 3000, estos dos mensajes caían en turnos distintos; con 6000 caen en el
**mismo** turno y el cliente recibe UNA respuesta que cubre las dos cosas, en
vez de dos sueltas. Cuesta 3 segundos más de espera en todas las respuestas, y
el dueño lo aprobó a cambio de esto.

Las dos capas se complementan y ninguna sustituye a la otra: **el código ya
tolera la carrera** (nada se pierde aunque ocurra) y **el debounce la hace
poco frecuente**.

⚠️ Ese valor **no está en el código** —el repo trae 6000 por defecto— sino en
la configuración del servicio de EasyPanel. Cambiarlo por SSH con `docker
service update` dura hasta el siguiente Desplegar. Ver
[04-AGENTE-IA.md](04-AGENTE-IA.md).
