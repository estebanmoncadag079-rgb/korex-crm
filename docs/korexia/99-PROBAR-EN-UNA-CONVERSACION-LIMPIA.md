# Probar en una conversación limpia

> **Dentro:** El caso · Qué se arregló · Por qué el arreglo parecía no
> funcionar · Las dos pruebas, lado a lado · La regla · Por qué esto todavía
> no cierra el riesgo · Cómo revertir

**18-ago-2026.** Un arreglo correcto, desplegado y verificado dentro del
contenedor pareció no funcionar durante casi dos horas. No falló el arreglo:
falló **dónde se probó**. Este documento existe para que la próxima vez el
diagnóstico no cueste esas dos horas.

---

## El caso

El agente del salón rechazaba citas a las 6:30 PM —su hora exacta de cierre—
inventándose que *"las citas deben empezar como máximo a las 5:30 PM para poder
cerrar a las 6:30 PM"*. Esa regla **no existe en este negocio**: el salón cierra
cuando termina la última cita del día.

El relato completo del arreglo está en
[97-BITACORA-RESERVA-MULTIPLE.md](97-BITACORA-RESERVA-MULTIPLE.md), §15 a §18.
Aquí solo interesa lo que pasó **después** de arreglarlo.

## Qué se arregló, y dónde

| Commit | Hora | Qué |
|---|---|---|
| `70ef95a` | 13:49 | El motor: `calcularDisponibilidad` ofrece hasta la hora de cierre inclusive (`logic.ts`) |
| `6ed3fdf` | 14:42 | El prompt: el contrato de citas y la línea del horario (`prompts.ts`) |
| `123df6b` | 15:02 | El recordatorio final, que es lo último que lee el modelo (`prompts.ts`) |

Tres sitios distintos del prompt sosteniendo la misma regla real, más el motor
que ya la calculaba bien.

## Por qué parecía que no funcionaba

A las 15:05 (Colombia) el contenedor nuevo ya estaba arriba con los tres
cambios. Y el agente **seguía respondiendo lo mismo** a las 15:06 y a las 15:07.

La respuesta de las 15:06 era **idéntica, palabra por palabra**, a la que había
dado a las 14:51 — antes del arreglo.

Esa es la firma del problema, y este proyecto ya la conocía: está escrita en la
cabecera de `src/server/ai/anuncio-de-cierre.ts` desde el 29-jul-2026.

> Un mensaje falso que queda en el historial de la conversación **se reproduce
> a sí mismo**. Medido entonces contra el modelo real: **5 de cada 6 turnos**
> repetían el cierre falso, pese a que el prompt decía ABIERTO tres veces.

El modelo prefiere ser coherente con lo que él mismo escribió antes que con el
dato que le da el sistema. Y la conversación donde se estaba probando era
justamente aquella en la que el agente ya había escrito la frase equivocada
cuatro veces.

**El arreglo nuevo no puede ganarle a una frase vieja que el modelo tiene
delante.** No importa cuántas veces se lo diga el prompt.

## Las dos pruebas, lado a lado

Misma hora del día, mismo negocio, mismo servicio, mismo código desplegado:

| | Conversación de la captura | Número nuevo (17:19) |
|---|---|---|
| Historial previo | 4 respuestas con la regla inventada | vacío |
| *"¿puedo agendar a las 6:30?"* | *"el horario máximo… ya es más tarde que eso"* | **"Para Press on, tengo disponibilidad hoy a las 6:30 PM"** |
| Resultado | ❌ handoff a una persona | ✅ ofrece la cita |

El servicio de la prueba buena —**Press on**, 120 minutos— es exactamente el
caso que originó todo: el que a las 18:30 termina pasadas las 20:30 y que el
motor rechazaba antes del commit `70ef95a`.

## La regla

> ⛔ **Un arreglo de prompt NO se verifica en la conversación donde se vio el
> fallo.** Se prueba desde un contacto limpio, sin historial. En la
> conversación contaminada, el modelo repite su propia respuesta vieja y el
> arreglo parece no funcionar aunque esté perfecto.

Y su corolario, que es el que cuesta dinero:

> Un "sigue sin funcionar" en la conversación de siempre **no es evidencia de
> que el arreglo falle**. Antes de escribir una línea más de código, repetir la
> prueba desde un número limpio.

Encaja con lo que ya dicen [51-LABORATORIO-PUERTA-A-PRODUCCION.md](51-LABORATORIO-PUERTA-A-PRODUCCION.md)
y [75-COMO-SE-DOCUMENTA.md](75-COMO-SE-DOCUMENTA.md): *una prueba que puede
pasar por la razón equivocada no verifica nada* — y aquí, al revés, **falló por
la razón equivocada**.

## Se midió el riesgo, y era mucho menor de lo que parecía

Este documento afirmaba primero que hacía falta un guardarraíl para limpiar las
conversaciones contaminadas. **Se midió, y no**:

```sql
-- conversaciones del salón con la frase falsa escrita: 1
-- ...y de esas, aún dentro de la ventana del historial (20 mensajes): 1
```

**Una sola conversación, y es la de pruebas del dueño.** Ninguna clienta real.
El historial que ve el modelo son los últimos `HISTORY_LIMIT = 20` mensajes,
así que la frase **caduca sola** conforme la conversación avanza.

Queda escrito porque la corrección la hizo el dueño —*"ya no necesitamos
guardarraíl para el horario"*— y tenía razón: **construirlo habría sido código
nuevo en el núcleo para un problema de una conversación de pruebas que se
resuelve solo.** La regla 4 de [REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md)
—*¿se puede resolver sin tocar el código?*— existe justo para esto.

### Lo que sí sigue siendo cierto

Cualquier clienta a la que el agente ya le dijera *"el horario máximo para
agendar es 6:30 PM"* seguiría recibiendo esa respuesta mientras la frase siga
dentro de esos 20 mensajes, porque el modelo se copia de su propio historial.

El mecanismo que sí lo cura ya existe en el proyecto y está probado para dos
casos gemelos —el cierre falso y la cita fantasma—: el **guardarraíl del
servidor** de `anuncio-de-cierre.ts`, que hace dos cosas que el prompt no puede
hacer:

1. **Retira la frase del historial** que ve el agente (`toChatHistory`),
   sustituyéndola por `MENSAJE_RETIRADO`, y
2. **frena el mensaje antes de que salga** y rehace el turno
   (`CORRECCION_DE_CIERRE_FALSO`, en `runAgentTurn`).

Sus expresiones regulares hoy **no cubren** estas frases: buscan *"ya cerramos"*
o *"estamos cerrados"*, no *"el horario máximo para agendar es"*, *"ya es más
tarde que eso"* ni *"deben empezar como máximo a las"*.

**Decidido el 18-ago: NO se amplía**, por la medición de arriba. Se deja
descrito para que, si algún día la frase aparece en conversaciones reales, ya
esté claro dónde se toca y por qué. Es un cambio genérico —no menciona
salones ni servicios—, no toca el núcleo, no necesita migración ni escribir en
producción.

### Y una deuda de arquitectura, anotada aparte

El arreglo cambió una constante universal (*"la cita debe terminar antes del
cierre"*) por la constante opuesta (*"puede empezar hasta el cierre"*). Sigue
siendo **una regla de negocio dentro del código**, y falla la pregunta
obligatoria de [79-ARQUITECTURA-MULTIEMPRESA.md](79-ARQUITECTURA-MULTIEMPRESA.md):
una clínica cuyo edificio cierra a las 18:00 no puede expresar lo contrario.

Lo correcto según [REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md)
(categoría 3, capacidad global del CRM) sería un dato configurable
—`cierreLimita: "inicio" | "fin"`, columna aditiva con default, mismo patrón que
`hours_open_sunday`— para que el núcleo solo lea *"hasta cuándo se puede
empezar"* sin saber qué es un salón. **Anotado, no implementado.**

## Cómo se verificó (18-ago-2026)

Lo que se comprobó, y con qué —no de memoria, contra la máquina:

```bash
# 1. Que el código VIVE dentro del contenedor (no solo en la carpeta de EasyPanel)
docker exec <contenedor> grep -ro "EMPEZAR una cita" .next/server | wc -l   # → 2
docker exec <contenedor> grep -ro "incluida la hora exacta de cierre" .next/server | wc -l   # → 2

# 2. Que el vertical de citas está encendido (si no, las 3 frases NO se inyectan)
select hours_open, hours_close, appointments_enabled from agent_profile …
# → 09:30 | 18:30 | t
```

La tercera comprobación —la que de verdad cerró el caso— **no fue técnica**:
escribirle al agente desde un número sin historial.

## Cómo revertir

Los tres commits son independientes entre sí:

```bash
git revert 123df6b   # el recordatorio final
git revert 6ed3fdf   # el contrato de citas y la línea del horario
git revert 70ef95a   # el motor: vuelve a exigir que la cita termine antes del cierre
```

No tocan esquema, no tocan ninguna cita ya agendada y no requieren regenerar el
prompt de nadie: las tres frases se ensamblan en cada mensaje, no viven en
`agent_profile.instructions`.

⚠️ Revertir `70ef95a` **vuelve a rechazar** los servicios largos a la hora de
cierre, que es el fallo original.
