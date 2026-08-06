# Bitácora: 4 al 6 de agosto de 2026 — cinco casos de "no respondió", y la vez que el despliegue no llevaba nada

> **Dentro:** El hilo de la sesión · Los cinco casos, uno por uno · El
> mecanismo que estaba detrás de tres de ellos · Los dos repos que se
> revisaron · El despliegue vacío · Qué quedó desplegado · Qué quedó abierto

Sesión disparada por reportes del dueño, uno detrás de otro, todos con la
misma forma: **"el bot no respondió"**. Cada uno se investigó con la base de
datos y el payload crudo de YCloud — nunca por teoría — y **tres de los cinco
resultaron ser la misma causa de fondo**. Las horas van en **UTC** salvo que
diga "Colombia" (UTC−5).

## El hilo de la sesión

1. Un mensaje sin responder en Lis → resultó que **Meta lo entregó vacío**.
2. Revisión del upstream Vocero CRM → destapó un **bug latente de identidad**.
3. Revisión de `nea-agent` → destapó que **una respuesta podía perderse**.
4. Venta perdida en La Churra (Jorge) → el **turno que no debía correr**.
5. Carta no enviada en Lis (Tatis) → **el mensaje que se cuela**.

## Los cinco casos, uno por uno

### 1. Heidy (Lis, 4-ago): Meta lo entregó vacío

`type: "unsupported"`, error `131051`, `unsupported: {type: "unknown"}`. Ni
Meta sabe qué era: no hay contenido que recuperar por ninguna vía. Primer uso
real de la tabla `webhook_event` creada la noche anterior — antes esto se
habría quedado en suposición. **No se tocó código**: decisión del dueño de
dejar el comportamiento como está. Detalle y consultas de diagnóstico en
[24-MENSAJES-UNSUPPORTED.md](24-MENSAJES-UNSUPPORTED.md).

### 2. Identidad partida (latente, encontrado el 5-ago)

El parser hacía `waUserId: m.from ? null : m.fromUserId` —tiraba el BSUID
cuando llegaba el teléfono— apoyado en un comentario que afirmaba "nunca
vienen los dos juntos". **Falso: 98 de 99 eventos reales traen los dos.** El
día que Meta dejara de mandar `from` para un cliente conocido, habría entrado
como contacto y conversación nuevos, con el historial partido. Ahora se
guardan ambas señales y el contacto se reconoce por cualquiera, rellenando la
que falte. Ver [25-UPSTREAM-VOCERO.md](25-UPSTREAM-VOCERO.md).

### 3. La respuesta que se perdía al fallar el envío

Cualquier fallo de envío que no fuera "ventana cerrada" subía hasta
`executeTurn`, que solo lo escribía en el registro: **el texto ya generado y
pagado desaparecía sin fila, sin relevo y sin aviso**. Ahora se reintenta lo
pasajero (red, `5xx`, `429`) y, si aun así no sale, se guarda como `failed` y
la conversación pasa a una persona. Ver [26-NEA-AGENT.md](26-NEA-AGENT.md).

### 4. Jorge (La Churra, 2-ago): la venta perdida

Escribió "Azur y canela" y se corrigió con "Azúcar y canela" mientras el
agente respondía. El agente contestó **bien**… y nueve segundos después soltó
"te comunico con una persona". Estaba a un paso de cerrar un pedido de 14
churritos y no volvió a escribir.

### 5. Tatis (Lis, 5-ago): la carta que no llegó

Preguntó por el domicilio y 4 s después eligió "1" del menú. Le contestaron lo
del domicilio; **el "1" quedó guardado por detrás de esa respuesta y nunca
recibió la carta**, y encima el turno siguiente derivó a un humano. Eran dos
cosas distintas y se atendió una sola.

Los casos 4 y 5, completos, en
[27-VENTA-PERDIDA-JORGE.md](27-VENTA-PERDIDA-JORGE.md).

## El mecanismo que estaba detrás de tres de ellos

**Si el último mensaje que ve el modelo no es del cliente,
google/gemini-2.5-flash devuelve `content: null`.** Sin contenido, el turno se
da por fallido y dispara el handoff de error.

Ya había aparecido dos veces antes, y las dos se tapó el camino concreto en
vez del mecanismo:

| Cuándo | Cómo se llegó | Qué se hizo entonces |
|---|---|---|
| 1-ago | El loop de disponibilidad cerraba con un `system` | Se cambió a `user` **solo ahí** |
| 1-ago | El mensaje del cliente quedaba invisible (`unsupported`) | Marcador de texto |
| 2-ago (Jorge) | Un segundo turno sin nada que responder | Omitir el turno |
| 5-ago (Tatis) | Un mensaje que se cuela y queda por detrás | **Marca de procesados** |

El cierre real es la marca `conversation.last_turn_inbound_at`: registra hasta
qué mensaje del cliente llegó cada turno, se guarda **antes** de llamar al
modelo (un turno que falle no puede repetirse en bucle), y los pendientes se
reordenan **al final** del historial. Así el array **nunca termina en
`assistant`**, que es la raíz de los cuatro.

De paso se encontró el porqué de la frecuencia: `AGENT_COALESCE_MS` estaba en
**3 s** (no en los 6 del código). Con 3 segundos, a un cliente le basta
escribir su segunda frase 4 s después para caer en el turno ya en marcha.
**Volvió a 6 s** por decisión del dueño. Las dos capas se complementan: el
código tolera la carrera, el debounce la hace rara.

## Los dos repos que se revisaron

- **`kevinrivm/vocero-crm`** (el upstream): **no tiene motor de citas** — el de
  korex.ia es propio. El merge quedó descartado con evidencia: 102 commits
  propios contra 17, base común del 10-jul y 17 archivos en conflicto,
  incluidas las migraciones de Drizzle.
- **`kevinrivm/nea-agent`**: microservicio Python **mono-negocio** (cero
  rastro de `organization`). No se adopta; se portaron tres ideas a mano.
- **Google Calendar no existe en ninguno de los dos.** Sigue siendo trabajo
  nuevo.

## El despliegue que no llevaba nada

El 5-ago el dueño pulsó Desplegar dando por hecho que el trabajo estaba
listo. **No lo estaba**: seguía sin commitear y sin sincronizar la carpeta de
EasyPanel, así que se reconstruyó el código del 3-ago. El servicio quedó nuevo
y `healthy` — y sin ninguno de los arreglos.

Se detectó porque el paso 5 se verifica **dentro del contenedor**: `grep` de
los textos del código nuevo y `\d offered_slot` en la base, los dos en NO. Es
la segunda vez que pasa (el 1-ago fue por el otro extremo). La regla quedó
anotada en [02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md): **"ya desplegué" no
cierra nada; lo cierra la evidencia dentro del contenedor.**

## Qué quedó desplegado

Dos despliegues verificados con evidencia real, no con un "converged":

| Commit | Qué | Verificado |
|---|---|---|
| `3dfb91b` | Identidad, cola de envíos, solo-lo-ofrecido, turno de Jorge, anti off-topic | 5-ago 20:19 UTC · tabla `offered_slot`, textos en el bundle, migración 15 |
| `ef2f836` | Marca de procesados (Tatis) + atender varias preguntas | 6-ago 02:46 UTC · columna `last_turn_inbound_at`, migración 16, `AGENT_COALESCE_MS=6000` |

**384 pruebas** (14 nuevas), `typecheck`, `lint` y `build` en verde. Las dos
migraciones las aplicó el arranque del contenedor, nunca a mano — la lección
del 3-ago se respetó.

El arreglo de identidad **ya se ve en datos reales**: los contactos que
escriben desde el despliegue quedan con las dos señales.

## Qué quedó abierto

Lo pendiente de decidir está en
[21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md): el backfill de identidad, los
adjuntos y fotos, el seguimiento único y el detector de hostilidad.
