# El agente de IA: cómo decide y responde

## La idea de fondo

El agente **no conversa libremente**: en cada turno devuelve **una sola acción**
en formato JSON. Eso permite que el sistema haga cosas de verdad (mover un
lead, avisar de un pedido, pasar a un humano) y no solo escribir texto.

Las acciones posibles:

| Acción | Qué hace |
|---|---|
| `reply` | Responder al cliente |
| `update_lead` | Guardar una nota en la ficha (con respuesta opcional) |
| `move_stage` | Mover el lead de etapa en el embudo |
| `notify_order` | **El cliente confirmó un pedido**: avisa al equipo y cierra |
| `handoff` | Pasar la conversación a una persona |
| `none` | No responder nada |

## Qué se le manda al modelo en cada turno

1. **Quién es y cómo debe comportarse** → `agent_profile.instructions`
   (el prompt, en la base de datos)
2. **Si el negocio está abierto o cerrado ahora mismo** → lo calcula el servidor
3. **El conocimiento del negocio** → las entradas de `kb_entry`
4. **La ficha del contacto** → su teléfono y nombre, para no preguntárselos
5. **El contrato de acciones** → qué puede devolver y con qué reglas
6. **El historial** de la conversación

## El horario lo calcula el servidor, no el modelo

Esto fue un cambio importante y conviene entender por qué.

Pedirle al modelo que comparara la hora con un horario escrito en palabras
falló **en los dos sentidos**: primero dijo estar **abierto a medianoche**
(leyó "12:02 am" como dentro de "12:30 pm – 8:30 pm"); al reforzar la
instrucción, pasó a decir **"ya cerramos" a las 15:40**.

La solución fue **quitarle la decisión**. El horario vive en columnas
(`hours_open`, `hours_close`, `hours_days` con 1 = lunes … 7 = domingo), el
servidor resuelve el estado y se lo entrega dicho:

> `EL NEGOCIO ESTÁ ABIERTO ahora mismo: atiende con normalidad y NO menciones reagendar.`

Distingue además tres situaciones, porque no son lo mismo:

- **Abierto** → atender normal.
- **Cerrado pero abre más tarde HOY** → *"abrimos a las 10:00, te tomo el
  pedido"*. Antes decía "te lo dejo para mañana" a alguien que escribía una
  hora antes de abrir: una venta regalada cada mañana.
- **Cerrado y hoy ya no abre** → tomar el pedido y reagendarlo.

Sin horario configurado no se le dice nada: mejor callar que afirmar en falso.

> ⚠️ **Es un equilibrio frágil.** Reforzar solo el caso "cerrado" hizo que
> anunciara cierres falsos estando abierto. En el prompt tienen que estar
> **los dos ejemplos, simétricos**, y al principio.

Cubierto por pruebas (`horario-negocio.test.ts`), incluidos los bordes exactos
de apertura y cierre y los días que el negocio no abre.

## El guardarraíl del cierre falso

Aun con todo lo anterior, el 29-jul-2026 el agente de La Churra le dijo a un
cliente *"ya cerramos"* **a las 2 de la tarde, con el negocio abierto**.

La causa no era el horario: **se estaba copiando a sí mismo**. Ese mensaje
había salido una vez, quedó en el historial, y el modelo prefería ser coherente
con lo que ya había dicho antes que con el dato del sistema. Medido contra el
modelo real: **9 de cada 10 turnos repetían el cierre falso** cuando ese
mensaje estaba en el historial; **0 de 8** cuando no estaba.

El arreglo (`src/server/ai/anuncio-de-cierre.ts`) es un **guardarraíl**: si el
negocio está abierto y la respuesta anuncia un cierre, se descarta y se le pide
al modelo que la reescriba, diciéndole explícitamente que eso es falso.

## Cómo se agrupan los mensajes

Los clientes escriben en ráfagas ("hola" / "quiero pedir" / "un cremoso"). Si
el agente respondiera a cada uno, contestaría tres veces a medias.

Por eso **espera 3 segundos** desde el último mensaje antes de responder
(`AGENT_COALESCE_MS`), y cada mensaje nuevo reinicia la cuenta.

**Excepción: el primer mensaje de una conversación no espera.** El saludo sale
al instante, porque ahí el cliente está mirando la pantalla sin nada que leer.

### Cuánto tarda en responder

Medido en producción (27-jul-2026):

| Parte | Tiempo |
|---|---|
| Espera deliberada | 3 s (antes 6) |
| El modelo piensa | 2–4 s |
| Envío por YCloud | < 1 s |
| Entrega del webhook | ~2 s |

Total percibido: **unos 8–10 segundos**. El saludo, al saltarse la espera, baja
a ~5 s.

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
