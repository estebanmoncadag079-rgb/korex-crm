# 184 — El horario con un solo dueño

**20-sep-2026** · Estado: implementado y **migrado en producción**, sin
desplegar. Pendiente de auditoría del dueño.

Continúa [183](183-EL-GENERADOR-QUE-DESHACIA-LAS-MIGRACIONES.md): el mismo
principio —una autoridad por dato— llevado al horario.

## Lo que pasó

La dueña de Lis desmarcó el domingo en su pantalla. El bot siguió tomando
pedidos ese domingo.

No fue el modelo. El horario vivía en **dos datos que podían contradecirse**:

```
hours_days       = "1,2,3,4,5,6"   ← el domingo NO está
hours_open_sunday = "14:00"        ← pero el domingo tiene franja propia
```

Y el resolutor (`rangoDelDia`, `prompts.ts`) miraba la franja de domingo
**antes de comprobar si el domingo estaba entre los días abiertos**. Peor:
`businessStatus` tenía un `tieneDomingoPropio` que se saltaba adrede esa
comprobación. Desmarcar el domingo no desmarcaba nada.

## La regla, ahora inviolable

> **Un día que no está en el horario está CERRADO. Y la única forma de decir
> que un día abre es ponerle su franja.**

```ts
type HorarioSemanal = Partial<Record<1|2|3|4|5|6|7, { abre: string; cierra: string }>>;
```

Un "domingo cerrado con horario de domingo" **dejó de ser representable**. No
hay que validarlo: no cabe en el tipo. Y el domingo deja de ser un caso
especial — es el día 7 y se comporta como el 1. Aquella excepción existía por
un caso real (un negocio que el domingo abre más tarde), pero resolverla con
dos columnas aparte convirtió un día normal en una rama del código, y esa
rama fue exactamente por donde se coló el fallo.

## Autoridad y derivados

```
ficha.horario.porDia            ← CANÓNICO. Lo escribe el negocio en su pantalla.
  ├── ficha.horario.dias/abre/cierra/abreDomingo/cierraDomingo   → derivado
  └── agent_profile.hours_*                                      → derivado
```

Los derivados existen para que el código ya desplegado siga leyendo algo
coherente y para poder mirar el horario desde SQL. **Se reescriben enteros
desde el canónico en cada guardado** (`horarioNormalizado`), así que no pueden
quedarse viejos — y si alguien los edita a mano, `pnpm auditar:arquitectura`
lo marca FAIL.

### Orden de lectura, y por qué

1. `ficha.horario.porDia` — el canónico.
2. **las columnas `hours_*`** — lo que producción usa HOY.
3. `ficha.horario` viejo — solo si no hay columnas.

**El 2 antes que el 3 no es un detalle.** Lashes Valen tiene `cierra: "22:30"`
en su ficha y `hours_close = "18:30"` en sus columnas: alguien corrigió el
cierre a mano el 15-ago y la respuesta del cuestionario se quedó como estaba.
El salón cierra a las 18:30. Leer la ficha vieja primero le habría abierto la
agenda **cuatro horas de más** el día del despliegue. Una migración no puede
cambiarle el horario a nadie.

## El congelado que ya no hace falta

`aplicarFicha` tenía las columnas congeladas tras el alta, porque reescribirlas
en cada reenvío del cuestionario revirtió el horario del salón el 15-ago a las
19:46:41. Ese congelado resolvía el síntoma y dejaba la causa: dos sitios con
el mismo dato.

Ahora las columnas **se reescriben siempre**, porque ya no mandan. Una
proyección no se congela: se recalcula, o se queda vieja y vuelve a
contradecir a su fuente — que es exactamente lo que pasó con el domingo de Lis.

Y así se cumple lo que faltaba: **un cambio normal de configuración llega al
runtime sin que nadie tenga que acordarse de ejecutar un script.**

## La UI

Una fila por día, cada una con su interruptor y su franja:

```
Lunes     ☑  10:00 a 19:00
…
Domingo   ☐  Cerrado
```

Desmarcar un día **borra su franja** en el mismo acto: no queda un horario
huérfano del que acordarse. Hay un botón para copiar la franja del primer día
marcado a todos los demás, porque el caso común sigue siendo el horario
uniforme. Y desaparece el *"¿el domingo tienes un horario distinto? Déjalo en
«algo más que debamos saber»"*, que era el origen del problema: mandaba un dato
estructurado a un campo de texto libre.

## Qué se migró (producción, 20-sep-2026)

Respaldo automático: `agent_profile_bk_horario_20260920`.

| Cliente | antes | después | columnas |
|---|---|---|---|
| **La Churra** | lun-dom 12:30–20:30 | igual, con `porDia` | idénticas |
| **Lis** | lun-sáb 10:00–20:00, dom CERRADO | igual, con `porDia` | idénticas |
| **MALIA** | lun-dom 11:00–19:00 | igual, con `porDia` | idénticas |
| **Lashes Valen** | ficha 22:30 ≠ columnas 18:30 | 🟠 **NO migrado** | sin tocar |
| Camilabrandcol, korex.ia | sin horario | sin tocar | — |

**Ni un solo prompt cambió** (`regenerar:flota`: los cuatro "sin cambios") y
ninguna columna se movió. La migración añade el canónico y nada más. Volver a
pasarla no hace nada (0 migrarían, 3 ya estaban).

> 🟠 **Lashes Valen requiere una decisión de negocio.** Su ficha dice que
> cierra a las 22:30 y sus columnas a las 18:30. El motor de citas lleva desde
> el 15-ago usando las 18:30, así que **hoy funciona con 18:30 y nada ha
> cambiado**. Nadie puede decidir desde la base cuál es el bueno: hay que
> preguntarle al salón. Cuando se sepa, se corrige desde su pantalla y
> `pnpm migrar:horario org_novxv78s08h12arzatr2 --aplicar` lo cierra.

## El auditor nuevo

`pnpm auditar:arquitectura` gana una sección de coherencia del horario, con
seis casos. Dos tumban el gate y cuatro informan:

| Caso | ¿Bloquea? | Qué detecta |
|---|---|---|
| `franja_de_dia_cerrado` | **sí** | el estado exacto de Lis: horario de un día cerrado |
| `derivados_desalineados` | **sí** | las columnas no dicen lo que dice la ficha |
| `horario_en_instructions` | no | el prompt lleva un horario escrito dentro |
| `ficha_sin_migrar` | no | todavía sin `porDia` |
| `derivados_con_perdida` | no | horario por día que las columnas no saben expresar (H-3) |
| `sin_horario` | no | no hay horario configurado |

`horario_en_instructions` **avisa y no bloquea**, y es deliberado: el backend
ya no lee el horario del prompt, así que no puede romper una decisión — es
riesgo de que el modelo *diga* algo viejo. Y a veces es información legítima
que el canónico no sabe expresar: **Lis distingue el horario de pedidos por
WhatsApp (10:00–20:00) del de su local físico (13:00–20:00)**, y eso no cabe en
`porDia`. Bloquear ahí dejaría el gate en rojo permanente por un dato correcto.

Encontró las dos contradicciones de arriba **la primera vez que se ejecutó**.

## Pedidos programados: lo que el producto SÍ hace

No se implementó ningún bloqueo del tipo *"si el negocio está cerrado ahora, no
atiendas"*. Un cliente que escribe un domingo para agendar el lunes es una
venta.

Verificado en el código: **`EstadoDelPedido` no tiene fecha de servicio ni de
entrega — Korex no soporta pedidos programados.** No hay ninguna fecha futura
que validar, y no se inventa una aquí. En CITAS sí la hay, y `esFechaValida` la
valida contra el horario canónico: se puede agendar el lunes desde un domingo
cerrado, y no se puede agendar PARA un día cerrado. La decisión la toma la
fecha del servicio, nunca el reloj del momento.

## Archivos

| Archivo | Qué |
|---|---|
| `src/server/horario.ts` | **nuevo** — el modelo canónico y la función de dominio |
| `src/server/horario-auditoria.ts` | **nuevo** — los cinco casos de incoherencia |
| `src/server/ai/prompts.ts` | `businessStatus`, `horarioLegible`, `abreMasTardeHoy`, el calendario — sin ramas por día |
| `src/server/appointments/logic.ts` | `BusinessHours` pasa a ser el canónico; la disponibilidad recibe **la franja del día** |
| `src/server/appointments/queries.ts` | el panel lee el mismo horario que el agente |
| `src/server/ai/pipeline.ts` · `src/server/lab/runner.ts` | ídem |
| `src/server/ai/generador/ficha.ts` · `aplicar.ts` | `porDia` en la ficha; derivados recalculados en cada guardado |
| `src/components/onboarding/onboarding-wizard.tsx` | la UI por día |
| `scripts/migrar-horario.ts` | **nuevo** — `pnpm migrar:horario` |
| `scripts/auditar-arquitectura.ts` · `restaurar-horario.ts` | al día con el modelo nuevo |
| `tests/unit/horario-canonico.test.ts` · `horario-backend-autoridad.test.ts` | **nuevos** — 44 pruebas |
| `tests/unit/horario-negocio.test.ts` · `lis-domingo-cerrado.test.ts` | reescritas (ver abajo) |

### Dos pruebas que cambiaron de sentido, y el cambio ES el arreglo

- `horario-negocio.test.ts` fijaba que el domingo abría *"aunque el 7 no esté
  en days"*. Eso era literalmente el incidente. Lo que aquel diseño quería
  resolver —domingo con horario propio— sigue resuelto y probado, solo que
  ahora se dice poniéndole su franja al día 7.
- `lis-domingo-cerrado.test.ts` documentaba que con la franja huérfana el
  negocio se abría igual. Ahora exige lo contrario.

## Cómo revertir

- **El código**: revertir el commit. Los derivados siguen escritos y correctos,
  así que el código viejo lee las columnas y se comporta como siempre.
- **Los datos**: `agent_profile_bk_horario_20260920` tiene la fila completa de
  cada cliente. La migración además **no cambió ninguna columna ni ningún
  prompt** — solo añadió `porDia` a tres fichas—, así que revertir el código
  sin tocar los datos ya deja todo como estaba.

## La auditoría independiente, y los cuatro fallos que encontró

Terminada la implementación se hizo una auditoría aparte, sin tocar código,
con una consigna: **demostrar** que la arquitectura se sostiene, no afirmarlo.
Se ejecutaron cuatro casos contra el código real:

| Caso | Esperado | Resultado |
|---|---|---|
| A · `porDia` lunes 10–20 | lunes abierto en esa franja | ✅ |
| B · `porDia` sin domingo | domingo cerrado | ✅ |
| C · `porDia` sin domingo **+ columnas con domingo 14–19** | **domingo cerrado** | ✅ |
| D · `porDia` domingo 14–19 + columnas domingo 10–20 | gana `porDia` | ✅ |

El caso C es el que importa: las columnas no pueden ganar. La autoridad única
está demostrada, no supuesta.

La auditoría encontró además cuatro cosas que la implementación no había visto:

### H-1 · Un día marcado sin horas desaparecía en silencio

**Y era un fallo que introdujo este mismo rediseño.** La pantalla dejaba
marcar un día y dejar sus horas en blanco; al guardar, la franja vacía se
descartaba y el día se esfumaba **sin un solo aviso**. El administrador veía
el lunes marcado, guardaba, y el bot trataba el lunes como cerrado.

Es la misma clase de fallo que este trabajo vino a cerrar —la pantalla
diciendo una cosa y el backend otra—, solo que hacia el lado seguro: se
pierden ventas en vez de prometer imposibles. Da igual la dirección.

Corregido en tres capas: `faltantesDeLaFicha` nombra el día y frena el alta
(`diasDeclaradosSinHoraValida`), la pantalla pinta el campo en rojo y no deja
avanzar, y la comprobación exige que la hora sea **legible**, no solo que
exista — una garantía que el modelo viejo sí tenía y que el nuevo había
perdido por el camino.

### H-2 · El auditor no corría en ningún gate

Su propio encabezado dice que *"un validador que no corre nunca no protege de
ninguna regresión"*. Seguía siendo cierto de él: `pnpm auditar:arquitectura`
existe y nadie lo invoca. **Sigue pendiente** (ver abajo).

### H-3 · El horario por día no cabe en las columnas

Las columnas solo saben decir una franja para toda la semana: con lunes
08:00–12:00 y sábado 14:00–22:00 escriben 08:00–12:00. No es una
contradicción —es pérdida—, así que el chequeo de desalineación lo daba por
bueno. Importa mientras haya código leyendo columnas: ofrecería el sábado
hasta las 12:00. Ahora el auditor lo **avisa** (`derivados_con_perdida`), sin
bloquear: no hay nada roto, hay algo que las columnas no saben.

### H-4 · Dos caminos con fallback opuesto ante un horario vacío

`horarioDeLaFila` respeta `porDia: {}` como "cierro toda la semana";
`aplicarFicha` caía a las columnas. Semánticas contrarias para el mismo dato,
hoy inalcanzables porque la ficha no se puede guardar sin días. Alineado: la
ficha que ya declaró su canónico manda, aunque declare cero días.

### Y un quinto, ajeno a este trabajo: la suite de citas llevaba rota los domingos

Al correr por fin `citas-motor.test.ts` contra Postgres real apareció un fallo
que **no era del rediseño**. Su ayudante de fechas hacía «hoy + N, y si cae
domingo lo corro al lunes», de modo que con hoy domingo N=7 y N=8 daban **la
misma fecha**: la prueba movía la cita al mismo día y hora y después exigía
que ese hueco estuviera libre. Imposible con cualquier implementación.

Llevaba fallando **todos los domingos y solo los domingos**, y nadie lo había
visto porque esas pruebas se saltan solas sin base de datos. Ahora cuenta días
hábiles, así que dos N distintos dan siempre dos fechas distintas.

## Verificación contra Postgres real

Con una base desechable (contenedor aparte en el VPS, borrado al terminar):

| | |
|---|---|
| `ficha-no-pisa-conocimiento` | **5/5** — ejercita `aplicarFicha`, la función cuyo manejo de columnas pasó de "congelado" a "siempre derivado". Era el mayor riesgo sin verificar |
| `citas-motor` | **24/24** — incluye *"rechaza un día que el salón no atiende (domingo)"* y toda la disponibilidad, que ahora recibe la franja del día |

## Lo que el horario por día NO sabe decir: las observaciones

`porDia` resuelve *cuándo atiende el negocio*. No resuelve todo lo que un
negocio necesita contar sobre sus horarios, y el caso real es Lis:

```
Pedidos por WhatsApp:  10:00 – 20:00   ← el horario OPERATIVO
Punto físico:          13:00 – 20:00   ← no cabe en porDia
```

La tentación era añadir `horarioLocal`. Detrás habrían venido
`horarioInstagram`, `horarioEntrega`, `horarioFestivos`: un campo estructurado
por cada particularidad de cada negocio, que es justo lo que una plataforma
multi-cliente no puede permitirse.

La solución es un **texto libre** —`ficha.observacionesHorario`— que explica y
**no puede decidir nada**:

```
porDia:         domingo ausente          → CERRADO
observaciones:  "Los domingos atendemos de 10 a 14"

Resultado: domingo CERRADO. El texto no abre nada.
```

### Por qué no puede decidir nada

No es una regla que alguien deba recordar: **es el tipo**. `businessStatus` y
`franjaDelDia` solo aceptan `HorarioSemanal`, que es un mapa de día a franja.
Una cadena de texto no cabe ahí. Para que una observación abriera un día
haría falta cambiar una firma a propósito, no despistarse.

### Por qué vive FUERA de `ficha.horario`

Porque `horarioNormalizado` reescribe `ficha.horario` entero en cada guardado:
un campo hermano dentro de ese objeto se borraría solo. **Es la misma trampa
de H-1**, y se evita por construcción — el normalizador no puede perder lo que
nunca maneja.

### Dónde llega

Al prompt de cada turno, junto al horario y con el aviso de que no manda:

> ACLARACIONES DEL NEGOCIO SOBRE SU HORARIO (las escribió el negocio y puedes
> contárselas al cliente si vienen a cuento; esto NO decide si se atiende ni
> cambia el horario de arriba — lo de arriba manda siempre): …

**No va a `instructions`.** Ahí se congelaría y volvería a ser una segunda
fuente: el mismo criterio que ya se aplicó al catálogo y a los pagos
([183](183-EL-GENERADOR-QUE-DESHACIA-LAS-MIGRACIONES.md)).

### Sin migración

El campo es opcional y vacío por defecto. Ningún negocio necesita que se le
invente un texto, así que **no hay migración**: quien lo quiera, lo escribe en
su pantalla.

## H-2: la auditoría entra en el camino del despliegue

El gate de CI (typecheck, lint, tests, build) mira el **código**. El incidente
que originó todo esto no fue un bug de código: fue **una fila incoherente**
que llevaba semanas ahí. Ahora el despliegue audita antes de tocar nada.

El paso va en el job `deploy`, **antes** de `scripts/deploy.sh`, y usa la
misma llave SSH que ya tenía — sin abrir ningún camino nuevo al servidor. El
auditor es solo lectura: detecta, informa y devuelve 1. Nunca escribe, nunca
"repara", nunca migra.

### Sin camino fail-open

La primera versión hacía `exit 0` cuando faltaba `DEPLOY_DB_URL`: *"aviso y
dejo pasar"*. El dueño lo rechazó, con razón — eso convierte una auditoría
obligatoria en una sugerencia, y bastaba con no crear el secreto para
desactivar el guardarraíl sin que nadie se enterara. **Un gate que se apaga
solo no es un gate.**

Ahora **todo** lo que impida completar la auditoría detiene el despliegue:

| Situación | Resultado |
|---|---|
| falta `DEPLOY_DB_URL` | `::error` + **exit 1** |
| no se abre el túnel | `::error` + **exit 1** |
| la base no responde en 15 s | `::error` + **exit 1** |
| el auditor encuentra una incoherencia | **exit 1** (su propio código) |
| la auditoría corre entera y pasa | ✅ sigue el despliegue |

`set -euo pipefail`, sin `continue-on-error`, sin `if:` que lo salte, y el
auditor es **lo último que se ejecuta** — de modo que su código de salida *es*
el del paso. El `|| true` del cierre del túnel no lo toca: un `trap EXIT` que
no llama a `exit` conserva el código que lo disparó (comprobado, no supuesto).

> ⚠️ **`DEPLOY_DB_URL` hay que crearlo.** Es una cadena de conexión de **solo
> lectura** en los secretos del Environment `production`. Hasta que exista,
> **el despliegue por GitHub Actions no pasará del paso de auditoría** — y eso
> es exactamente lo que se pidió: sin auditoría no hay deploy.

`tests/unit/gate-auditoria-en-deploy.test.ts` (13 comprobaciones) impide que el
paso se quite, se mueva después del despliegue, o recupere un camino
fail-open. Se verificó **inyectando el fail-open a propósito**: tres
comprobaciones se ponen rojas.

> 🔍 Y ahí apareció otra vez el mismo fallo de fondo, esta vez en la propia
> prueba: uno de sus `expect` llevaba un carácter de **retroceso** (`0x08`) en
> lugar de ``, por un escape mal cerrado al generarla. El regex era
> `/exit 0/` y **no coincidía con nada**: la comprobación estaba
> verde sin proteger. Se descubrió porque al inyectar el fail-open esa prueba
> concreta no saltó. Corregido y vuelto a verificar.

## Hallazgo de seguridad, para otra tarea

Al buscar una forma segura de que el auditor llegara a la base se comprobó que
**el `authorized_keys` del usuario `deploy` no tiene ninguna restricción**: ni
`command=`, ni `no-port-forwarding`. El *sudo* sí está acotado a un único
script (`deploy ALL=(root) NOPASSWD: /usr/local/bin/korex-deploy.sh *`), pero
el acceso SSH permite cualquier comando como `deploy` y abrir túneles.

Los documentos [160](160-IDENTIDAD-DE-DEPLOY-MINIMO-PRIVILEGIO.md) a
[162](162-VERIFICACION-DE-PROCEDENCIA-DEL-SHA-DE-DEPLOY.md) lo describen como
mínimo privilegio, y eso es cierto **solo del sudo**.

**No se tocó**: endurecerlo es una tarea aparte, y hacerlo a la ligera deja el
despliegue sin funcionar. Queda anotado.

## Qué queda

1. **Lashes Valen**: decidir 18:30 vs 22:30 (arriba).
2. **Lis**: decidir si el horario del local físico se queda en sus reglas
   propias (hoy) o merece un campo estructurado propio.
3. **Desplegar**, tras la auditoría. Hasta entonces producción sigue con el
   código viejo leyendo las columnas, que están intactas.
4. `hours_*` **no se borran**. Se quedan como derivados hasta que algo demuestre
   que nadie las lee; quitarlas hoy solo añadiría riesgo.
