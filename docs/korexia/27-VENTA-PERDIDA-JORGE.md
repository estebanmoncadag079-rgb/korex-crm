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

## Lo que queda abierto

Si un mensaje llega en el segundo escaso que va **entre que el turno lee el
historial y guarda su respuesta**, ese mensaje se queda sin contestar: el
turno siguiente lo verá "por detrás" de la respuesta y se omitirá. Antes de
este arreglo ese caso disparaba el handoff falso, que tampoco lo contestaba —
así que no empeora nada, pero tampoco lo cierra.

Cerrarlo del todo pide **registrar hasta qué mensaje procesó cada turno** (una
marca por conversación) y, cuando queden entrantes sin procesar, ponerlos al
final del array en vez de omitir el turno. Es trabajo aparte y todavía no hay
un caso real que lo pida.
