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

### El modelo de respaldo se retiró (31-jul-2026)

Antes, si Gemini agotaba sus tres intentos, se gastaba una llamada en
`anthropic/claude-sonnet-4.5` antes de rendirse. **Decisión del dueño: se
quita.** El razonamiento es sensato — si el modelo principal no logra resolver
una conversación, lo que necesita ese cliente no es otro modelo, es **una
persona**.

Así que ahora, cuando el agente no puede resolver: **avisa al cliente y deriva
a un asesor**. Se retiró la variable `OPENROUTER_FALLBACK_MODEL` del servicio;
el código la sigue soportando, así que reactivarlo es volver a definirla.

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
