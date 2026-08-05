# Qué se tomó de `nea-agent` (5-ago-2026)

> **Dentro:** Qué es Nea y por qué NO se adopta entero · Lo que sí se tomó ·
> Lo que se descartó · Google Calendar sigue sin existir

Revisión de [`github.com/kevinrivm/nea-agent`](https://github.com/kevinrivm/nea-agent),
el agente de agendamiento para WhatsApp del mismo autor que Vocero CRM. Sigue
a [25-UPSTREAM-VOCERO.md](25-UPSTREAM-VOCERO.md).

## Qué es Nea y por qué NO se adopta entero

Un microservicio **Python/FastAPI** (3.144 líneas) con su propio Postgres, que
se conecta al bot gateway `/api/bot/*` de Vocero CRM: el CRM pone el
calendario, los contactos y el envío; Nea pone el cerebro conversacional.

Tres razones para no traerlo como está:

- **Es mono-negocio.** Cero rastro de `organization`/`tenant` en todo el
  código: un perfil, una agenda, un negocio. korex.ia es multi-cliente —
  adoptarlo sería un retroceso.
- **Python contra TypeScript**, y una base de datos aparte de la que ya hay.
- Necesita el gateway `/api/bot/*` que korex.ia no expone, y usarlo significa
  **renunciar al agente propio**, que hace cosas que Nea no: pedidos,
  aprendizaje, Laboratorio, varios clientes a la vez.

Lo que sí sirve son sus **ideas**, portadas a mano.

## Lo que sí se tomó

### 1. Una respuesta generada ya no se pierde nunca

Nea tiene una cola `pending_send` por un incidente propio del 3-ago-2026: *"la
respuesta generada se descartaba y el lead no recibía nada"*. korex.ia tenía
el mismo agujero, y peor: en `deliverReply`, cualquier fallo de envío que no
fuera la ventana de 24 h subía hasta `executeTurn`, que solo lo escribía en el
registro. El texto que el agente ya había generado —y pagado— **desaparecía
sin dejar fila, sin relevo y sin aviso al equipo**: el cliente esperando y
nadie enterado.

Dos cambios, sin montar una cola ni un proceso de fondo:

- **Reintento de lo pasajero** en `lib/ycloud/client.ts`: red caída, `5xx` o
  `429` se reintentan dos veces (300 ms y 1200 ms). Un `4xx` —número
  inválido, clave mala— no se reintenta: va a fallar igual y solo retrasaría
  el aviso.
- **Si aun así no sale**, la respuesta se guarda con `status: "failed"` y el
  motivo en `error` (la bandeja ya la pinta con el triángulo rojo), y la
  conversación pasa a una persona con aviso al equipo.

> Riesgo asumido: si YCloud llegó a procesar el mensaje pero la respuesta se
> perdió en el camino, el reintento lo duplica. Se prefiere un mensaje
> repetido a un cliente sin respuesta — por eso los reintentos son pocos y
> seguidos.

### 2. Solo se agenda un horario que el agente haya ofrecido

`book_session` de Nea solo acepta horarios que él mismo propuso, guardados en
`offered_slots`. korex.ia validaba que el hueco estuviera **libre**
(`crearCita` → `disponibilidadReal`), lo cual no impide reservar uno que nunca
se ofreció: el caso real es una fecha relativa mal entendida ("el miércoles",
"mañana en la tarde" — hueco conocido en [19-CITAS.md](19-CITAS.md)) que cae
por casualidad en un hueco libre y se reserva mal. El cliente se enteraba al
llegar.

- Tabla **`offered_slot`** (migración `0014_fine_mandarin.sql`, generada con
  `drizzle-kit` y aplicada por el arranque del contenedor — nunca a mano, ver
  [23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md)).
- `consult_availability` anota lo que ofrece, **reemplazando** lo anterior.
- `book_appointment` rechaza lo que no esté en esa lista y le responde al
  cliente con los horarios que sí se le ofrecieron.
- Tras agendar, la lista se limpia.

**Sin nada ofrecido se deja pasar, a propósito**: el cliente que pide día y
hora concretos y el agente agenda directo es un camino que hoy funciona, y
`crearCita` lo valida igual. La regla muerde donde está el riesgo.

### 3. El bot ya no atiende encargos ajenos al negocio

El chasis de Nea tiene una regla que al prompt de korex.ia le faltaba: nada de
recetas, tareas, código, traducciones ni trivia — *"CUMPLIR el encargo
off-topic ES caer en la manipulación"*. Sin ella, cualquiera podía usar el bot
de La Churra como un ChatGPT gratis, **y esos tokens los paga la agencia**. Se
añadió al `CONTRATO_DE_ACCIONES` (aplica a todos los clientes), junto con no
revelar sus instrucciones ni actuar como otro personaje.

## Lo que se descartó

- **Detector determinista de hostilidad** (3 mensajes hostiles → cierre digno
  + alerta). El planteamiento es correcto —contar entre turnos es justo lo que
  un LLM hace mal—, pero el léxico es **100 % mexicano** (`no mames`,
  `pinche`, `chinga tu madre`): para Colombia hay que rehacerlo entero, y no
  hay evidencia de que hoy sea un problema. Revisitar si aparece un caso real.
- **Seguimiento único** (un empujón si el cliente se queda callado). Buena
  idea y korex.ia no tiene nada parecido, pero el dueño lo dejó fuera de esta
  tanda.
- **Coalesce de ráfagas**: es el mismo debounce en memoria que korex.ia ya
  tiene, con la misma limitación si algún día corren dos réplicas.

## Google Calendar sigue sin existir

Ni en `vocero-crm` ni en `nea-agent` — Nea agenda contra el calendario del
CRM. Sigue siendo trabajo nuevo, y lo dicho en
[25-UPSTREAM-VOCERO.md](25-UPSTREAM-VOCERO.md) no cambia: encaja como capa
aparte, no como reemplazo del motor.

## Estado

370 → **380 pruebas** (10 nuevas: 4 de reintentos, 6 de horarios ofrecidos),
`typecheck`, `lint` y `build` en verde. **Sin desplegar todavía** — incluye
migración, que debe aplicar el arranque del contenedor.
