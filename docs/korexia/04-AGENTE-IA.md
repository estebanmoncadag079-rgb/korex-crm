# El agente de IA: cómo decide y responde

> **Dentro:** La idea de fondo · Qué se le manda al modelo en cada turno · El horario lo calcula el servidor, no el modelo · El guardarraíl del cierre falso · Cómo se agrupan los mensajes · Y lo demás del agente

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

### Horario propio del domingo (desde el 3-ago-2026)

Hasta el 3-ago solo existía UN rango de horas para toda la semana — no se
podía expresar "entre semana 10-20, domingo 14-19" (el caso real de Lis).
`agent_profile.hoursOpenSunday`/`hoursCloseSunday` (nullable) resuelven esto:
si ambos están definidos, el domingo SIEMPRE usa ese rango — sin necesidad de
que el 7 esté en `hoursDays` — en vez del genérico. Es opcional: sin
configurar, el domingo se comporta exactamente igual que antes. El motor de
citas no lo usa (los campos son opcionales en su `BusinessHours` y ese módulo
no los lee).

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

## Mensajes sin texto no disparan al agente (desde el 3-ago-2026)

Un mensaje sin texto ni adjunto (edición de WhatsApp, reacción/respuesta a un
Estado, tipo no soportado) se guarda con un marcador para que no desaparezca
del hilo — pero **ya no dispara un turno del agente**. Antes sí lo hacía, y
el modelo, viendo ese marcador como si fuera lo que el cliente escribió,
podía reaccionar sin sentido: caso real, ejecutó `handoff` al ver `[mensaje
no compatible: tipo "edit"...]`, y como el negocio no tiene número de aviso
configurado, el cliente quedó esperando sin que nadie se enterara. El mensaje
se sigue viendo en la bandeja para que un humano lo atienda si hace falta.
Cuando el caso es una **edición** de un mensaje de texto, además, el texto
real corregido sí se lee (`edit.message.text.body` del evento de YCloud) y
se le pasa al agente normal — no todo termina en el marcador. Detalle en
[23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md).

## Cuando el cliente pide un asesor, siempre se avisa

El patrón de respaldo que fuerza `handoff` al detectar frases como "un
asesor" (`matchesHandoffIntent`, corta el turno ANTES de llamar al modelo)
avisa ahora al cliente ("dame un momentico, te comunico con una persona") **y**
notifica al equipo — reusa el mismo mecanismo que ya existía para cuando
falla el proveedor de IA (`derivarAUnaPersona`). Antes marcaba el handoff en
silencio, sin decir nada: el cliente pedía hablar con alguien y el bot
simplemente dejaba de responder, sin ninguna confirmación.

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

## Y lo demás del agente

El relevo con las personas, el aviso de pedido, los modelos, qué pasa cuando el
agente no puede resolver y el Laboratorio están en
**[16-AGENTE-RELEVO-Y-MODELOS.md](16-AGENTE-RELEVO-Y-MODELOS.md)**.
