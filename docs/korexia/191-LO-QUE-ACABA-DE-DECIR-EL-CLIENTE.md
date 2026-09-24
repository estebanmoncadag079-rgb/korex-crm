# 191 — Lo que acaba de decir el cliente

**24-sep-2026** · Rama `005-intencion-contexto-y-estado` · Estado: **en PR, sin
desplegar**

---

## El caso

MALIA, conversación `cv_zgm286k69bz1hmprf87a`:

```
17:15:42  CLIENTE  Y que costo tiene el domicilio?
17:15:58  BOT      Perfecto 😊 ¿Qué quieres y cuántos?
```

Dieciséis segundos. No fue una carrera de turnos ni un modelo distraído: la
capa que decide qué preguntar **solo miraba qué le falta al pedido**, nunca qué
acaba de escribir el cliente.

Y en Lis, veinticuatro segundos después de que la clienta dijera «a domicilio»,
el bot le preguntó cómo quería recibirlo.

Y en la misma conversación de MALIA, el pedido quedó guardado con
`datos.nombre = "Luisa Duque"` — un nombre que Luisa nunca escribió. Lo sacó
del perfil de WhatsApp, porque el prompt se lo ordenaba.

Tres síntomas, una forma común: **el backend sabía algo y no se lo enseñaba al
modelo, o el modelo entendía algo y el backend no tenía dónde guardarlo.**

---

## Por dónde pasa un turno

```
mensaje del cliente
   ↓
intención + contexto      leerIntencion()  — qué está haciendo en ESTE mensaje
   ↓
plan del turno            planDelTurno()   — qué se contesta primero, y dónde seguir
   ↓
prompt                    bloqueDelPlan() + comoTexto() + catálogo
   ↓
LLM                       interpreta y redacta
   ↓
validación del backend    aplicarOperaciones() — cuatro compuertas
   ↓
estado                    conversation_state
```

Las dos puntas son del backend. El modelo va en medio y **no decide hechos**:
los interpreta y los comunica.

---

## La regla de autoridad

> **Backend = autoridad. LLM = interpretación y comunicación.**

El backend decide qué existe, qué vale, qué está verificado y qué se guarda.
El modelo decide cómo se dice. Cuando los dos discrepan, gana el backend, y no
mediante una frase en el prompt: mediante una compuerta que rechaza.

Y la segunda mitad, que es la que faltaba:

> **Sin evidencia suficiente, el sistema representa «no se sabe». Nunca rellena
> por inferencia.**

De ahí salen tres decisiones que parecen limitaciones y son lo contrario:
`entrega` sigue en `null` mientras no haya tarifa verificada; el nombre del
perfil de WhatsApp no se convierte en el nombre del cliente; y donde el backend
no puede saber si hay un pedido a medias, el plan no afirma que no lo haya.

---

## Flujo de prioridad

Tres preguntas, en este orden, y ninguna sustituye a la siguiente:

1. **¿Qué acaba de pedir?** — `leerIntencion()`. Solo tres intenciones esperan
   respuesta: horario, entrega y precio.
2. **¿Qué hay que contestarle antes de seguir?** — `planDelTurno()`.
3. **¿Dónde se continúa?** — el punto de `CADENCIA` que tocaba, sin adelantar
   los demás.

`CADENCIA` sigue mandando sobre el ORDEN de lo que se pide. El plan solo mete
una cosa delante: contestar lo que preguntaron. Lo que **no** puede pasar es
que contestar una consulta abra la puerta a soltar el muro de preguntas —
nombre, teléfono, dirección, pago, confirmación— de golpe.

---

## Los cinco contratos

| Campo | Quién lo escribe | Qué significa | Qué NO significa |
|---|---|---|---|
| `modalidadDeEntrega` | el cliente, vía `fijar_modalidad` | cómo quiere recibirlo: lo ELIGIÓ | que haya tarifa, zona o dirección |
| `entrega` | el backend, contra la tabla de zonas | tarifa y zona VERIFICADAS | nada, mientras sea `null` — y con `delivery_source='prompt'` es siempre `null` |
| `paraRegalo` | el modelo, vía `marcar_regalo`, tras oírselo al cliente | dijo que es un regalo | no es requisito de cierre; no bloquea `notify_order` |
| `datos.nombre` | el cliente, y solo él | el nombre que escribió | no se rellena desde el perfil |
| `contact.name` | WhatsApp | de dónde escribe | **no** es un dato confirmado del pedido |

Los dos primeros son la pareja que más se confunde. En el prompt salen con
nombres distintos a propósito: `MODALIDAD DE ENTREGA` y `ENTREGA VERIFICADA`.

`paraRegalo` y `modalidadDeEntrega` son opcionales, y por eso
`SCHEMA_VERSION` **no sube**: subirla haría que los contenedores todavía sin
desplegar descartaran los pedidos en vuelo.

---

## Qué se cambió

| Incidente | Causa | Corrección |
|---|---|---|
| Consulta ignorada | `intencion.ts` no lo llamaba nadie | F1 — el pipeline lo llama y pasa `PLAN DEL TURNO` |
| Modalidad perdida | `comoTexto()` solo leía `entrega` | F2 — enseña la modalidad, sin inventar tarifa |
| Modalidad invisible en auditoría | `aplanar()` no la llevaba | F3 |
| Nombre inferido | el prompt lo ordenaba | F4 — prompt reescrito **y** Compuerta 4 en el backend |
| Regalo perdido | no existía el campo | F5 — `paraRegalo` + `marcar_regalo` |
| `undefined: ya está` | requisito sin etiqueta | F6 (código) — cae al `id` |

`intencion.ts` llevaba desde el **15-ago-2026** escrito, probado y en verde, y
hasta hoy el único fichero que lo importaba era su propio test. Código muerto
con cobertura del 100%: lo peor de los dos mundos, porque la suite decía «esto
funciona» mientras el fallo seguía en producción. Las pruebas nuevas llaman a
`runAgentTurn` y miran el prompt real, no al módulo — un test que importe el
módulo volvería a pasar el día que alguien lo desconecte.

---

## Lo que NO se tocó, y por qué

- **Citas.** El bug existe igual en un salón, pero la mitad útil del plan
  (`continuarEnElMismoMensaje`) se calcula con `estadoGuardado.items`, que ahí
  no existe. Saldría siempre `false` y el bloque afirmaría «no hay nada en
  curso» en mitad de una reserva. Hace falta antes un equivalente de «reserva
  en curso».
- **Negocios sin `state_source='backend'`** (Camilabrandcol hoy): reciben la
  prioridad, pero el plan se redacta sin afirmar si hay pedido en curso.
- **El reinicio.** Lo resuelve `matchesReinicio` de forma determinista antes de
  llamar al modelo. `plan.reiniciar` se ignora a propósito: pedirle al modelo
  que colabore en algo ya decidido solo abre la puerta a que un turno confuso
  arrastre un pedido cancelado.
- **La ficha de Lis.** El `undefined` tiene dos mitades; esta rama trae la del
  código. La del dato —ponerle `etiqueta` y `tipo` al requisito de dirección—
  toca producción y va aparte.
- **La regla comercial del link del catálogo de Lis**, la presentación de
  opciones de MALIA, la carrera de cola (C9), Rappi, `delivery_source`: fuera
  de este lote, por decisión explícita.

---

## Cómo revertir

Todo el cambio es de código, sin migración y sin tocar datos. `git revert` del
merge y desplegar el SHA anterior deja el sistema exactamente como estaba: los
estados guardados que lleven `paraRegalo` o `modalidadDeEntrega` los ignora un
lector viejo, porque son claves opcionales y `SCHEMA_VERSION` no subió.

---

## Pendiente

1. El dato de Lis (`etiqueta` + `tipo` del requisito de dirección) y la
   regeneración de **solo** esa organización, con respaldo y diff.
2. `pnpm probar:escenarios` con los diez escenarios nuevos A–J: necesita el
   túnel a producción y gasta saldo de OpenRouter — lo ejecuta el dueño.
3. Citas, cuando exista «reserva en curso».
