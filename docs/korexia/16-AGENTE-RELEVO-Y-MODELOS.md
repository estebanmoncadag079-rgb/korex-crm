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

En producción hay **un solo modelo: `google/gemini-2.5-flash`**. Es el mismo
para todos los clientes y también el que hace de juez en el Laboratorio (la
variable `OPENROUTER_JUDGE_MODEL` existe pero no está configurada, así que cae
en el principal).

El cambio a Gemini bajó el costo por pedido un **92 %** y además es más rápido.

### NO hay modelo de respaldo, y ya no puede volver por descuido

Si Gemini agota sus tres intentos, **la conversación pasa a una persona**. No se
gasta una llamada en otro modelo. Decisión del dueño, y el razonamiento es
sensato: si el modelo principal no logra resolver una conversación, lo que
necesita ese cliente no es otro modelo, es **una persona**.

> 🔑 **Se tomó dos veces, y la primera no se cumplió.** El 31-jul-2026 se retiró
> la variable `OPENROUTER_FALLBACK_MODEL`… **del `.env` de `/opt/korex-crm/`**,
> dejándola puesta en las variables del servicio de EasyPanel. Como el código
> seguía soportándola, `anthropic/claude-sonnet-4.5` **siguió entrando en las
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

El 13-ago-2026 se eliminó **el código del respaldo**, no solo la variable.
Definir `OPENROUTER_FALLBACK_MODEL` ya no hace nada: `chatJson` llama a un único
modelo y devuelve su resultado. (Conviene borrarla igualmente del servicio en
EasyPanel, por no dejar mentiras a la vista.)

**Efecto secundario, aceptado a sabiendas**: el juez del Laboratorio tampoco
tiene red. Si no devuelve un veredicto legible, ese caso queda en `judge_failed`
y el reporte lo muestra sin calificar. Es preferible un hueco visible a un
veredicto emitido por otro modelo — y en el Laboratorio no hay ningún cliente
esperando respuesta.

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
