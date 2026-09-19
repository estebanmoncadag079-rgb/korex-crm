# El agente: relevo, avisos, modelos y Laboratorio

> **Dentro:** El relevo entre el agente y las personas · El aviso de pedido · Los modelos · Cuando el agente no puede: se avisa y se deriva · El Laboratorio

Segunda parte de [04-AGENTE-IA.md](04-AGENTE-IA.md), que explica cómo decide y
responde. Aquí está lo que pasa **alrededor** de esa decisión: cuándo calla para
que atienda una persona, cómo avisa de un pedido, qué modelo corre y cómo se
prueba todo sin gastar la paciencia de clientes reales.

## El relevo entre el agente y las personas

Un negocio real atiende a mano cuando hace falta. El sistema lo contempla:

**El agente calla cuando una persona toma la conversación**, ya sea escribiendo
desde la bandeja o **desde el celular** (gracias al evento de ecos).

**Vuelve a hablar** de cuatro maneras:
1. El operador lo dice ("te dejo con el asistente", "sigue tú bot")
2. El atajo **`#bot`** (solo eso en el mensaje)
3. El cliente escribe **`0`**
4. Pasan **2 horas** sin actividad

> ⚠️ **Esto genera falsas alarmas de "el bot no responde".** Pasó el 27-jul:
> alguien saludó desde el celular a las 14:39 y el agente calló, correctamente,
> durante 2 horas. **Al diagnosticar, mirar SIEMPRE primero `handoff_reason`.**
>
> Y ojo: `#bot` escrito **desde el celular sí lo ve el cliente** (el mensaje ya
> salió por WhatsApp antes de que llegue el eco). Desde el celular es mejor una
> frase natural.

### Al devolver el turno, el agente CONTINÚA (6-ago-2026)

Antes, el comando solo quitaba el relevo: el agente quedaba despierto pero
**mudo** hasta que el cliente volviera a escribir. **Caso real de Lis**: la
clienta escribió "Cremoso de 7 Oz" (18:16:43), Lis devolvió el turno
(18:18:30) y el agente no dijo nada durante **5 minutos**, hasta que la
clienta escribió "Gracias" — solo entonces soltó la respuesta que ya tenía
lista. El día anterior, con otra clienta, Lis tuvo que escribir la respuesta a
mano y repetir el comando.

Ahora, tanto el comando desde el celular como el botón **Reactivar IA** de la
bandeja disparan el turno en el acto. Si el cliente no tiene nada pendiente,
el turno **se omite solo** (`entrantesSinResponder`, ver
[27-VENTA-PERDIDA-JORGE.md](27-VENTA-PERDIDA-JORGE.md)): el agente no suelta
un mensaje de la nada.

### Y sabe qué resolvió la persona, aunque fuera por voz o foto

Lo que escribe una persona del negocio ya le llegaba al agente marcado como
*"lo escribió una persona del negocio, NO tú"*. Desde hoy, sus **notas de voz
se transcriben y sus fotos se describen**, igual que las del cliente — antes
eran invisibles y el agente podía retomar contradiciendo lo que la persona
acababa de resolver por audio.

La foto del negocio se lee con una instrucción **propia**: el negocio no se
paga a sí mismo, así que ahí no se busca un comprobante (lo que sí se hace con
las del cliente, ver [13-AUDIO-E-IMAGENES.md](13-AUDIO-E-IMAGENES.md)). Efecto
secundario útil: **el comando dicho en una nota de voz también devuelve el
turno**, porque la frase se busca sobre el texto ya transcrito.

## El aviso de pedido

Cuando el cliente confirma, el agente usa `notify_order`:

1. Registra el pedido como nota en la ficha del contacto
2. Se lo manda **por WhatsApp a los teléfonos del equipo**, uno a uno
3. Deja la conversación en manos de una persona

**La API oficial de Meta no puede escribir en grupos**, así que los avisos van
1:1 a `agent_profile.notify_phones`. Y aplica la ventana de 24 horas: si esa
persona no le escribió al negocio ese día, **el aviso falla**.

## Los modelos

### Estado actual (verificado el 16-sep-2026 contra el contenedor real y el código — ver `specs/003-backend-como-autoridad/handoff-cambio-modelo.md` sección A)

- **Modelo principal**: `google/gemini-3.7-flash` (no `gemini-2.5-flash`: ese
  fue el modelo hasta que se cambió, ver "Historia" más abajo). Es el mismo
  para todos los clientes.
- **`OPENROUTER_JUDGE_MODEL` SÍ está configurada** en producción, apuntando
  hoy al mismo modelo que el principal (`google/gemini-3.7-flash`).
- **SÍ existe modelo de respaldo, con código real detrás.** `chatJson`
  (`src/lib/ai/index.ts`) arma una cadena `[modelo, OPENROUTER_FALLBACK_MODEL,
  OPENROUTER_FALLBACK_MODEL_2]`: si el primero agota sus tres intentos sin
  devolver nada usable, escala al siguiente de la cadena — hasta dos
  salvavidas. Esto es **código vigente hoy**, reinstalado el 9-sep-2026 (ver
  "Historia" abajo) — no es una variable muerta.
- **En producción, `OPENROUTER_FALLBACK_MODEL` y `OPENROUTER_JUDGE_MODEL`
  apuntan hoy al mismo modelo que el principal** (`google/gemini-3.7-flash`
  los tres). El mecanismo de respaldo funciona, pero sin diversidad real:
  si el modelo falla, reintenta contra sí mismo dos veces más, no contra un
  proveedor distinto.
- **El juez del Laboratorio SÍ tiene red.** `judgeCase` (`src/server/lab/
  judge.ts`) llama a `chatJson` con `judge:true`, que pasa por la misma
  cadena de salvavidas de arriba. Solo si el modelo del juez **y** los dos
  salvavidas fallan, el caso queda `judge_failed`.
- Agotada la cadena entera: fuera del Laboratorio la conversación pasa a una
  persona (ver más abajo); dentro del Laboratorio el caso queda
  `judge_failed` y el reporte lo muestra sin calificar. El rescate humano
  sigue siendo el último escalón — los salvavidas se meten antes, nunca en
  su lugar.

El cambio de Sonnet a Gemini como modelo principal bajó el costo por pedido un
**92 %** y además es más rápido.

### Historia: dos retiros del modelo de respaldo y su reposición

Esta sección explica **cómo se llegó** al estado de arriba — no describe el
comportamiento actual, que es el bloque anterior.

**31-jul-2026 y 13-ago-2026 — se retiró el respaldo, dos veces.** Decisión
del dueño en su momento: si el modelo principal no logra resolver una
conversación, lo que necesita ese cliente no es otro modelo, es una persona.

> 🔑 **La primera vez no se cumplió.** El 31-jul-2026 se retiró la variable
> `OPENROUTER_FALLBACK_MODEL`… **del `.env` de `/opt/korex-crm/`**, dejándola
> puesta en las variables del servicio de EasyPanel. Como el código seguía
> soportándola, `anthropic/claude-sonnet-4.5` **siguió entrando en las
> conversaciones dos semanas** mientras este documento afirmaba que se había
> quitado. Se descubrió el 13-ago probando el salón, al ver en el log
> `[ia] google/gemini-2.5-flash no devolvió una respuesta usable; reintentando
> con anthropic/claude-sonnet-4.5`.
>
> La lección no es sobre modelos: **retirar una variable no retira una
> conducta**. Mientras el código la soporte, cualquiera puede reactivarla sin
> saberlo, y el `.env` que uno mira no tiene por qué ser el que lee el
> contenedor. Para ver qué hay de verdad:
> `docker exec <contenedor> printenv | grep OPENROUTER`.

El 13-ago-2026 sí se eliminó **el código del respaldo**, no solo la variable:
`chatJson` llamaba a un único modelo y devolvía su resultado, sin cadena.
Efecto secundario aceptado en su momento: el juez del Laboratorio tampoco
tenía red.

**9-sep-2026 — el dueño se retractó** y pidió reponer el respaldo, esta vez
con dos escalones (`OPENROUTER_FALLBACK_MODEL` y `OPENROUTER_FALLBACK_MODEL_2`),
para medir si ayudan antes de decidir el modelo de diario (commit `0ef1a58`,
`src/lib/ai/index.ts`). Con esa reposición, el juez del Laboratorio recuperó
la misma red automáticamente, porque pasa por la misma función `chatJson`
(commit `517f27c`, anterior al primer retiro, dejó ya conectado ese camino).
Esto es lo que corrigió el estado descrito arriba: la sección de "Estado
actual" ya no es la de este apartado histórico.

> ⚠️ **Nunca cambiar de modelo sin probar una conversación completa hasta el
> aviso al equipo.** Una prueba de un solo mensaje da 4/4 a casi cualquier
> modelo y **engaña**: en conversación real, los modelos flojos abandonan el
> formato JSON al segundo o tercer turno. Fue así como casi se descarta Gemini
> por error, cuando el problema real era otro (el historial se le devolvía como
> texto plano y copiaba ese formato).

**Todo va por OpenRouter**, así que **si se acaba el saldo el agente enmudece**.
Pasó el 29-jul: el CRM funcionando y el agente mudo todo el día, sin que nada
avisara. Ante un "el bot no responde", **mirar el saldo antes que nada**.

## Cuando el agente no puede: se avisa y se deriva

Si el modelo agota sus tres intentos —o si insiste en anunciar un cierre falso
con el negocio abierto— la conversación pasa a una persona. Y **antes de
marcarla, se le dice al cliente**:

> *"Dame un momentico 🙏 Te comunico con una persona del equipo para ayudarte mejor."*

El aviso es neutro para que sirva a cualquier negocio de la instancia, y no
menciona ningún fallo técnico: al cliente no le aporta saber que un modelo
devolvió algo ilegible, solo que ya viene alguien.

**El orden importa**: el aviso sale ANTES de marcar el handoff, porque al
marcarlo la conversación queda en silencio y ya no saldría nada. Y si el aviso
no se puede enviar, la derivación ocurre igual — lo importante es que quede en
la bandeja para que alguien la atienda.

Antes de esto, el sistema marcaba la conversación y ahí terminaba: el cliente
se quedaba mirando el chat sin saber si lo habían leído.

## El Laboratorio

En `/lab`: clientes simulados conversan con el agente y un modelo "juez"
puntúa el resultado. Sirve para probar cambios **sin gastar la paciencia de
clientes reales**.

Los guiones actuales son genéricos (nacieron para una ferretería), así que hay
que leerlos con criterio para churrería o pastelería.

Detalle bien resuelto: las pruebas se ejecutan **con el reloj puesto en horario
comercial**, porque si no, a las diez de la noche el agente contestaba —con
razón— que estaba cerrado, y el juez lo puntuaba como error.
