# Bitácora: 7 de agosto de 2026 — el salón de belleza, y todo lo que faltaba para atenderlo

> **Dentro:** El hilo · Lo que el agente no sabía · Lo que la dueña no podía
> hacer · Lo que se descartó y por qué · Qué quedó desplegado · Qué falta para
> el día 1

El día empezó con un aviso del dueño: **"ya conseguí el cliente de citas"**.
El vertical llevaba una semana escrito pero nunca lo había usado un negocio de
verdad. Todo lo que sigue salió de probarlo con su catálogo real antes de
abrirle la puerta.

## El hilo

1. Probar el vertical con el catálogo del salón → **tres bugs de fecha**.
2. El dueño pide la **cascada de agenda** y pregunta por los recordatorios →
   aparece el muro de la ventana de 24 h.
3. Tanda de **35 escenarios** → el horario inventado y las citas fantasma.
4. "¿La dueña tiene todas las funcionalidades?" → **no podía agendar ella
   misma**, que era el agujero más caro.
5. Calendario visual, rediseño con el agente de UX y selector de fecha.

## Lo que el agente no sabía (y por eso mentía)

Los cinco fallos de comportamiento del día tenían la **misma forma**: no era
que el modelo razonara mal, es que **le faltaba el dato** y lo rellenaba solo.

| Le faltaba | Qué decía | Arreglo |
|---|---|---|
| El **año** | *"el lunes 10 de agosto ya pasó"*, un viernes 7 | `nowForBusiness` lo incluye |
| Qué día cae cada fecha | *"el lunes 9"* siendo el 9 domingo | **CALENDARIO** de 14 días ya resuelto |
| El **horario** del negocio | *"de 8:00 a 19:00"* y *"de 9 am a 6 pm"*, siendo 09:00–19:00 | `horarioLegible`, siempre en el prompt |
| Que el formato ISO vale | rechazaba `2026-08-10` como fecha inválida | `normalizarFecha` acepta los dos |
| — | *"te agendamos el jueves 13 con Laura"* sin agendar nada | guardarraíl en el **servidor** |

Los tres primeros estaban anotados desde el 3-ago como *"el modelo interpreta
mal las fechas relativas"*. **No era el modelo.** Y dos de ellos tenían
**pruebas en el repo que codificaban el bug** (esperaban que el ISO se
rechazara y que la fecha llegara sin normalizar).

> **La regla que se repite en todo el proyecto**: la aritmética y los datos
> duros los resuelve el servidor y se le entregan resueltos. Igual que con el
> horario de atención y la disponibilidad. Cuando se le pide al modelo que
> calcule o que recuerde, inventa — con total seguridad.

El de la **cita fantasma** merece aparte: a un `si confirmo` suelto respondió
*"¡Te agendamos para el jueves 13 a las 10:00 con Laura para Baño de acrílico
o poligel!"* — con `reply`, no con `book_appointment`. Servicio, día, hora y
especialista, todo inventado, **ninguna cita guardada**. El prompt ya lo
prohibía con todas las letras; no bastó. Ahora se comprueba en el servidor,
con el mismo mecanismo que frena los cierres falsos. Ver
[30-SALON-PRUEBAS.md](30-SALON-PRUEBAS.md).

## Lo que la dueña no podía hacer

**Agendar ella misma.** Las citas **solo nacían por WhatsApp**: la clienta que
llama por teléfono o llega al local no existía en la agenda, así que el agente
daba ese hueco por libre **y se lo ofrecía a otra**. Era el agujero más caro
de todos y no lo habría visto nadie hasta el primer choque real.

Se añadió, y con ello:

- **Calendario del día** en rejilla, una columna por especialista, con
  selector para saltar a cualquier fecha.
- **Cascada**: pasar el día de una especialista a otra, o liberarlo.
- El **rediseño lo hizo el agente de UX** contra el sistema real del proyecto.
  Encontró más de lo pedido: `<select>` crudos cuyo `text-sm` provocaba el
  zoom de iOS, un hex suelto donde la marca es configurable, y bloques de 15
  min ilegibles. Extrajo una primitiva `ui/select.tsx` del patrón que ya
  estaba repetido en bandeja y plantillas.

Detalle de todo en [19-CITAS.md](19-CITAS.md).

## Lo que se descartó, y por qué

- **"Quita lo de la ventana de 24 h, en octubre Meta cobra todo"** — la
  premisa era falsa y se verificó: el cobro cambia *cuánto cuesta*, no *qué se
  puede enviar*. Fuera de la ventana **seguirá haciendo falta plantilla**.
  Pagar no da derecho a texto libre. Ver
  [29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md).
- **Firebase** — no resuelve ningún problema que exista hoy, y cambiaría el
  costo fijo del VPS por costo variable justo donde están calculados los
  márgenes. Mismo razonamiento que con `pg-boss` y RLS el 3-ago.
- **Recortar lo que el modelo VE** — al limitar los horarios "a 3", el primer
  intento hizo que tratara esos 3 como los únicos y le negara a una clienta
  una hora libre. Se recorta lo que **dice**, no lo que **ve**.

## Qué quedó desplegado

Ocho despliegues verificados dentro del contenedor (no un "converged"):

| Commit | Qué |
|---|---|
| `b9ecce4` | Al devolver el turno, el agente continúa · audios y fotos del negocio |
| `b5e17f6` | La fecha ISO ya no se lee como "ya pasó" |
| `0be4772` | Cascada: mover o liberar el día de una especialista |
| `d3a7523` | El año y el calendario de 14 días |
| `23f5fee` | Ofrecer 3 horarios, no 17 |
| `988db28` | El horario deja de inventarse · guardarraíl de cita fantasma |
| `208c31e` | Agendar a mano · calendario del día · rediseño UX |
| `6572406` | Selector de fecha · el calendario pide su día al servidor |

**407 pruebas** (de 389 al empezar el día), `typecheck`, `lint` y `build` en
verde en cada una.

## Qué falta para el día 1 del salón

En [21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md), sección del salón. Lo que no
puede saltarse: **cargarle el conocimiento (KB)** — con el KB vacío el agente
inventó una dirección durante las pruebas — y **confirmar su horario real**,
porque todo lo demás cuelga de ahí.
