# El estado deja de vivir en el prompt: plan y objeciones

> **Dentro:** Lo que hay que medir antes de empezar · El diagnóstico · Lo que ya
> está construido · Las cinco objeciones serias · El roadmap por fases · El
> diseño de datos · Qué NO hacer · La secuencia segura · Qué le pasa a Lis

**15-ago-2026.** Documento de arquitectura para sacar del prompt el estado de la
conversación. Lo revisaron cuatro agentes en paralelo —arquitectura, base de
datos, crítica de metodología e ingeniería—, y **no están de acuerdo entre
ellos**. Este documento recoge el plan *y* las objeciones, porque las objeciones
son la parte más valiosa.

---

## ✅ Fase 0 EJECUTADA (15-ago-2026): los números cambian el plan

Se midió antes de construir nada, y **el resultado no respalda el refactor
completo**. Tres de las cuatro mediciones están hechas.

### 1. La tasa real de desorden: el caso típico ya funciona

Mensajes salientes por **sesión de pedido** (agrupado por día, para no sumar
varios pedidos del mismo contacto), sobre **167 conversaciones reales**:

| Cliente | Mediana | Media | p90 | Máx |
|---|---|---|---|---|
| **La Churra** | **3** | **4,9** | 12 | 26 |
| Lis Pastelería | 6 | 8,8 | **21,4** | 41 |
| Lashes Valen | 4 | 6,2 | 13,2 | 34 |

**La Churra ya cumple el objetivo de 5 mensajes.** No hay ningún 79 % aquí: el
pedido mediano se resuelve en 3 mensajes.

> 🔍 **El dato que más importa**: la sesión de **26 mensajes** del 15-ago que
> disparó toda esta discusión era **del propio dueño probando** (número acabado
> en 8172). Los días anteriores, con clientes reales, La Churra promedia entre
> **2 y 5**. El fallo que se vio en las capturas es real, pero **su frecuencia
> con clientes reales es baja**.

**Dónde sí hay dinero**: en la cola, no en la mediana. El p90 de Lis es 21,4
mensajes y su máximo 41. Una de cada diez conversaciones se descontrola.

### 2. El A/B de modelo: la sospecha no se sostiene

Mismo prompt (el de Lis, sin tocar), mismo catálogo, 24 escenarios, solo cambia
el modelo:

| Modelo | Fallas | Veredicto |
|---|---|---|
| `google/gemini-2.5-flash` | **0** | — |
| `openai/gpt-4.1-mini` | **2** | 1 real (repreguntó un nombre ya dado) + 1 probable falso positivo del test |

**Gemini no es peor.** La intuición de que GPT-4.1 mini obedecía mejor no se
confirma en el banco.

### 3. El coste: al revés de lo que todos suponíamos

| Modelo | tokens in | tokens out | **Coste por llamada** |
|---|---|---|---|
| `gpt-4.1-mini` | 10.098 | 116 | **0,0023067 USD** |
| `gemini-2.5-flash` | 11.371 | 148 | **0,0029497 USD** |

**GPT-4.1 mini sale un 22 % MÁS BARATO en la práctica**, pese a tener un precio
de entrada más alto por millón de tokens (0,40 contra 0,30). Dos razones: su
salida cuesta menos (1,60 contra 2,50) y **es más conciso** — genera menos tokens
de salida y arrastra menos historial.

Lección para el proyecto: **el precio de tarifa no predice el coste real**. Hay
que medirlo con el prompt de verdad.

### 4. Tasa de extracción fallida: **NO medida**

Requiere un prototipo del extractor. Queda pendiente, y sigue siendo la
condición para la Fase 2.

### ⚠️ Qué se concluye — y qué NO se puede concluir

Lo primero, una corrección al propio diseño de esta Fase 0:

> **Se midió el síntoma equivocado.** Estas mediciones cuentan mensajes, y el
> objetivo del refactor **nunca fue reducir mensajes**: es **dejar de depender de
> un prompt de 18.000 caracteres por cliente** para poder crecer a decenas o
> cientos de negocios. Ese problema **no se mide con las conversaciones de hoy**,
> porque no se manifiesta en la conversación: se manifiesta en el alta y el
> mantenimiento — que es justo lo que [33-ESCALABILIDAD.md](33-ESCALABILIDAD.md)
> ya señalaba como el techo real.

Y una corrección de interpretación, aportada por el dueño:

> **El p90 alto de Lis no es un fallo: es su negocio.** Tortas por encargo,
> personalizaciones y dedicatorias necesitan más idas y venidas que una caja de
> churros. Contar sus 21 mensajes como "desorden" fue un error de lectura de este
> documento. Un pedido largo ahí es un pedido bien atendido.

Con eso dicho, lo que los números **sí** sostienen:

- El diagnóstico técnico es correcto: el pedido no existe como dato.
- **El caso conversacional típico no está roto** (La Churra, mediana 3). Así que
  el refactor **no se justifica como arreglo de un fallo urgente**…
- …pero **sí se justifica como escalabilidad**, que es su motivo real y que estas
  mediciones no tocan.
- **Cambiar de modelo no está justificado** por calidad. Si algún día se hace,
  que sea por coste — y entonces el candidato es GPT-4.1 mini, no al revés.

**Lo que queda por medir de verdad** (y no se hizo, porque se midió lo otro):
cuánto cuesta hoy dar de alta y mantener un cliente, y cuánto costaría con el
catálogo en tablas. Esa es la métrica del objetivo real.

---

## 🔴 El apartado original: por qué se exigió medir

**No existe ningún número que diga cuántos pedidos se pierden hoy por desorden
de mensajes.** Todo el diagnóstico sale de unas capturas de WhatsApp de una
noche.

Eso choca de frente con el mayor acierto documentado del proyecto. El fallo del
resumen de Lis **se midió antes de construir nada**: 24 conversaciones, **79 %**
de pedidos sin datos de pago, y 0 de 12 en La Churra
([38-GUARDARRAILES.md](38-GUARDARRAILES.md)). Ese número justificó el trabajo y
dijo dónde estaba el problema.

Aquí no hay 79 %. Hay una impresión.

> **Regla que se saca**: antes de la primera línea de código de este plan, medir
> la tasa real de desorden sobre conversaciones reales. Si el número es pequeño,
> este documento entero puede esperar.

### Y hay dos cosas abiertas que sí duelen hoy

Ninguna de las dos es este refactor
([36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md)):

1. **La contraseña del superadmin sigue sin cambiar** desde el 31-jul. Es el
   pendiente más barato de cerrar y el de peor consecuencia.
2. **El salón sigue apagado** ([57-PENDIENTES-14AGO.md](57-PENDIENTES-14AGO.md)):
   un cliente conectado que no factura porque falta encenderlo.

Y el techo real del negocio, según [33-ESCALABILIDAD.md](33-ESCALABILIDAD.md),
**no es la arquitectura del prompt: es el alta manual**. La máquina está al 2 %.

---

## El diagnóstico

El prompt le pide al modelo que haga de base de datos. No es una interpretación:
está escrito literalmente en tres sitios del código.

| Instrucción en el prompt | Dónde |
|---|---|
| *"Antes de preguntar cualquier cosa, relee lo que el cliente ya escribió"* | `conducta.ts:83-91` |
| *"Cuenta con cuidado… multiplica cada precio por su cantidad… repasa la cuenta"* | `conducta.ts:323-325` |
| *"JAMÁS emitas notify_order con algo sin decidir… 'POR CONFIRMAR' no es cerrar"* | `prompts.ts:375` |

Son **tres súplicas al modelo para que recuerde, sume y no se salte pasos**.
Existen porque no hay nada más que lo haga: el pedido no existe como dato en
ninguna parte. Vive entero en el historial del chat (`pipeline.ts:144`,
`HISTORY_LIMIT = 20`) y el modelo lo reconstruye en cada turno. Solo se
materializa al final, y como **texto libre que compone el propio modelo**:
`notify_order.summary` es un `z.string()` (`actions.ts:31-34`).

Verificado leyendo el esquema completo: **no hay tabla de pedido ni columna de
pedido en curso.**

---

## Lo que ya está construido (y no hay que rehacer)

El hallazgo más útil de la revisión: **esto no es un rediseño. El vertical de
citas ya funciona así desde hace meses.**

| Pieza de la propuesta | Ya existe en | 
|---|---|
| El servidor resuelve el hecho y se lo da masticado al modelo | `consult_availability`: `pipeline.ts:535-574`, `227-303` |
| El dato vive en una tabla, no en el prompt | `appointment` (`schema.ts:464-512`), `service` |
| No se ofrece lo que no existe | `offered_slot` (`schema.ts:526-546`), `pipeline.ts:1019-1038` |
| Horario y calendario calculados fuera del prompt | `prompts.ts:132, 169, 317, 424, 505` |
| Capacidad activable por cliente | `agent_profile.appointmentsEnabled` (`schema.ts:371`) |
| Catálogo fuera del prompt | `generar.ts:50-54` lo excluye a propósito en citas |
| Un dato ya entregado resuelto en pedidos | ficha del contacto: *"ya la tienes: no la preguntes"* (`prompts.ts:484-498`) |

**La frontera Nivel 1 / Nivel 2 también existe ya.** Las etapas universales son
`meta(vertical)` en `conducta.ts:272-326` (para pedidos: saludar → qué quiere →
opciones → regalo → datos → resumen → pago). El qué se dice en cada etapa son
las `reglasPropias` de la ficha. Y la regla de desempate se añadió el 15-ago:
las reglas propias *"mandan sobre todo lo anterior"* (`generar.ts:174-176`).

> En una frase: **no hay que inventar una arquitectura, hay que portar a pedidos
> la que ya corre en citas.**

---

## Las cinco objeciones serias

De la revisión adversarial. Ninguna se ha resuelto todavía.

### 1. El plan aprieta donde el proyecto ya aprendió a aflojar

El incidente del 13-ago: el modelo escribió `"label"` en vez de `"etiqueta"`,
el esquema Zod lo rechazó, se agotaron los reintentos y **la conversación acabó
derivada a una persona con la foto lista para enviar** (`actions.ts:49-70`).

**El arreglo no fue exigirle mejor el campo: fue aceptar los dos**, con el
criterio *"comprobar el hecho, no confiar en la intención"*.

El estado estructurado exige que el modelo emita JSON fiable **en cada turno**.
Cada campo obligatorio nuevo es otra forma de rechazo duro → reintentos
agotados → **handoff falso silencioso**, que es el peor fallo del sistema porque
no aparece en ningún log. El plan convierte esa superficie de fallo en el camino
principal en vez del excepcional.

**Qué lo resolvería**: medir la tasa de extracción fallida en un prototipo antes
de comprometer la arquitectura. Si es <1-2 %, la objeción cae.

### 2. Nadie ha calculado el coste

[09-COSTOS.md](09-COSTOS.md): *"sube cuando crece el prompt del sistema, que se
manda entero en cada turno y domina el costo (~94 % es entrada)"*, y se suma **lo
de todos los intentos, no solo el que salió bien**. Precedente medido: *"dos
llamadas a Sonnet costaron el 22 % del mes de Lis"*.

Y hay un techo de latencia: **YCloud exige responder en menos de 6 segundos**.

El plan tiene un lado que abarata (sacar catálogo y políticas reduce la entrada,
que es el 94 %) y otro que encarece (llamadas de extracción). **El neto no está
calculado.** Comprometerse sin esa cuenta es justo lo que el proyecto se prohíbe.

### 3. Lo del flujo en dos niveles ya está construido (y la objeción sigue en pie)

El dueño pidió *"separar el flujo universal de un restaurante o de un salón de
las reglas propias de cada negocio, para tener flexibilidad sin duplicar
prompts"*. **Eso existe hoy, con esos dos niveles exactos:**

| Nivel | Qué es | Dónde |
|---|---|---|
| **Universal por vertical** | Las etapas: saludar → qué quiere → opciones → regalo → datos → resumen → pago | `meta(vertical)`, `conducta.ts:272-326` |
| **Propio del negocio** | Qué se dice en cada etapa, con qué palabras y emojis | `reglasPropias` de la ficha, `ficha.ts:146` |
| **Desempate** | *"Estas reglas mandan sobre todo lo anterior"* | `generar.ts:174-176`, añadido el 15-ago |

Ojo a un detalle importante: `meta()` entrega **etapas, no palabras**. No dice
*"muestra las cuatro presentaciones primero"* — eso lo pone cada cliente. Así que
la flexibilidad que se pide ya está, y no duplica prompts.

Lo que faltaba no era la separación: era **la regla de desempate**, porque las
reglas del negocio se leían 70 líneas más abajo que el orden universal y perdían.
Eso se arregló el 15-ago y es lo que hay que probar antes de construir nada más.

Dicho eso, la objeción de fondo **sigue en pie**:



[45-GENERADOR-DE-PROMPTS.md](45-GENERADOR-DE-PROMPTS.md) clasifica *"dónde va el
resumen, que termina antes de la despedida, el orden"* explícitamente como
**"¿Única por cliente? ❌ No"** — estructura universal, escrita una vez en
`conducta.ts`. Ese principio es el que permite `regenerar:flota`.

Y los datos que hay apuntan al revés: el mismo orden deseado fallaba en Lis
(79 %) y funcionaba en La Churra (0/12). La diferencia **no era un flujo
distinto: era un prompt mal escrito** (dos plantillas pegadas).

**No hay ningún caso documentado de un cliente que quiera de verdad otro orden
de cierre.** Si el flujo entero baja a la ficha de cada cliente, una lección
nueva sobre el orden deja de propagarse con un comando — se pierde justo lo que
costó construir.

> Esto contradice la decisión tomada el 15-ago. No significa que la decisión sea
> mala: significa que **hace falta un contraejemplo real** antes de moverla.

### 4. Otra fuente de verdad más

Ya hay un incidente por fuentes que se pisan: una corrección de salud verificada
**se deshizo sola** porque el cuestionario regeneraba desde `metadata`
([61-UNA-SOLA-PUERTA.md](61-UNA-SOLA-PUERTA.md)).

El estado estructurado añade una fuente más (el objeto del backend) compitiendo
con prompt + historial + KB + ficha. Para un proyecto llevado por una persona,
cada fuente nueva es otro sitio donde algo se pisa a las once de la noche.

### 5. La hipótesis del modelo nunca se ha probado limpia

El dueño sospecha que `gpt-4.1-mini` iba mejor que `gemini-2.5-flash`. **No está
medido en ningún sitio.** Y hay precedente de comparaciones contaminadas: casi se
descarta Gemini por error cuando la causa real era otra (el historial se le
pasaba como texto plano).

Decidir *"no es el modelo, es la arquitectura"* sin un A/B limpio es tan
arriesgado como lo contrario. **Cuesta una tarde y unos centavos.**

---

## El objetivo, escrito para que no se vuelva a desviar

**No es reducir mensajes. No es arreglar un bot que responde mal.**

> Es que **el conocimiento estructurado viva en el backend y el prompt se ocupe
> solo del comportamiento conversacional**, para que korex.ia pueda sostener
> muchos negocios sin mantener un prompt enorme por cada uno.

Todo lo demás —menos contradicciones, menos coste de entrada, menos mensajes— son
efectos secundarios agradables, no la meta. Si una fase no acerca a ese objetivo,
no pertenece a este plan.

Y la condición innegociable, en palabras del dueño: *"no vamos a sacrificar la
arquitectura por un cambio apresurado"*. Crecimiento **incremental**, con
**bandera por cliente**, **migraciones aditivas** y **rollback fácil**.

---

## Antes de la Fase 1: lo urgente va primero

Decisión del dueño, y coincide con [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md):

1. 🔴 **Cambiar la contraseña del superadmin.** Abierta desde el 31-jul.
2. 🔴 **Encender el salón.** Es un cliente conectado que no factura.

Ninguna arquitectura compensa tener una brecha abierta y un cliente sin cobrar.

---

## La Churra es el laboratorio; Lis llega la última y ya validada

También decisión del dueño, y es la que más baja el riesgo:

> Cada fase se prueba en **La Churra**, en condiciones reales, hasta que
> demuestre valor. Solo entonces llega a Lis — con rollback inmediato y con la
> confianza de que esa arquitectura ya funcionó en producción.

Por qué funciona: La Churra ya tiene ficha, su catálogo es simple (4
presentaciones), su volumen es menor y su pedido mediano son 3 mensajes. Es el
banco de pruebas más honesto que hay, porque **es un negocio real con clientes
reales**, no un espejo.

Orden definitivo: **Lashes Valen (apagado) → La Churra (laboratorio) → Lis (la
última, ya validada)**.

---

## El roadmap por fases

Orden por **secuencia segura**, no por dificultad.

### Fase 0 — Medir (obligatoria, y hoy no está hecha)

Nada de lo demás empieza sin esto:

1. **La tasa real de desorden** sobre conversaciones reales, como se midió el
   79 % del resumen.
2. **El A/B de modelo**: mismo prompt fijo, conversación completa hasta
   `notify_order`, contra `gemini-2.5-flash` y `gpt-4.1-mini`. Una prueba de un
   solo mensaje engaña.
3. **La cuenta del coste**: `(prompt reducido × turnos) + (llamadas de
   extracción × prompt)` contra el coste actual por conversación.
4. **La tasa de extracción fallida** en un prototipo del extractor.

Esfuerzo: **1-2 días**. Riesgo: nulo. Y puede ahorrar semanas.

### Fase 1 — El catálogo de pedidos sale del prompt a una tabla

El paso con mejor relación impacto/riesgo, y con precedente literal
([58-EL-CATALOGO-VIVE-EN-SERVICIOS.md](58-EL-CATALOGO-VIVE-EN-SERVICIOS.md)).
Deja los precios en tabla, que es lo que permite que la Fase 2 calcule totales.

- **Toca**: `schema.ts` (tablas nuevas), `prompts.ts` (render), `generar.ts:50-63`
  (dejar de embeber), pantalla de catálogo, `aplicar.ts` (sembrar).
- **Esfuerzo**: M (1-2 semanas). Lo difícil es el modelo de datos de Lis.
- **Verificación**: `pnpm probar:agente` hasta el cierre con prompt viejo vs
  nuevo, y el banco de 24 escenarios sin regresiones.

### Fase 2 — El estado estructurado (el premio)

El backend mantiene el pedido, inyecta *"YA TIENES: … FALTA: …"* y **calcula el
total él mismo** contra los precios de la Fase 1. Permite **borrar** del prompt
las tres súplicas de la tabla del diagnóstico.

- **Esfuerzo**: L (3-5 semanas con pruebas). **Riesgo alto**: toca el cierre de
  los clientes que facturan.
- **Los guardarraíles se quedan** durante toda la transición: estado y
  guardarraíl son capas distintas.
- **Verificación**: banco de escenarios + Laboratorio con juez, sin bajar de la
  puntuación de hoy. Contra el pipeline real, no solo unit tests — el 13-ago
  tres bugs pasaron 482 tests y solo aparecieron ejecutando el modelo.

### Fase 3 — Formalizar el motor de capacidades: **diferida**

Con 2 verticales y 3 clientes no paga. Hágase como subproducto de la Fase 2 solo
si de verdad reduce las ramas `if (vertical === "citas")`.

---

## La regla que manda sobre todo el diseño

Lo formuló el dueño al revisar el plan, y es el principio rector:

> **El LLM nunca es dueño del estado. Solo sugiere cambios. El backend los
> valida y es la fuente de verdad.**

No es un matiz de redacción: cambia quién responde cuando algo no cuadra. El
modelo *propone* `{producto: "Churrita", cantidad: 2}`; el servidor comprueba que
ese producto existe **en esa organización**, que el precio es el de la tabla y
que el total lo suma él. Si la propuesta no valida, se degrada — nunca se
persiste a ciegas.

Es el mismo criterio que ya gobierna `resolveStage`, `send_image` y
`offered_slot`: *comprobar el hecho, no confiar en la intención*.

De aquí se deduce lo que **no** se puede hacer: pedirle al modelo el total, o
guardar un `productId` sin resolverlo, o aceptar un estado que el servidor no
sepa reconstruir por su cuenta.

---

## El diseño de datos

### Estado de la conversación → tabla propia, JSONB, reemplazo completo

`conversation_state`, **1:1 con la conversación** (PK = `conversation_id`), con
una columna `jsonb` que el backend **reemplaza entera** en cada turno.

- **Por qué no columnas fijas**: cada vertical y cada cliente tienen campos
  distintos; sería decenas de columnas nulas y un `ALTER TABLE` por capricho.
- **Por qué no EAV**: N filas por lectura en el camino caliente.
- **Por qué no JSONB dentro de `conversation`**: es la tabla del inbox, se
  escanea en tiempo real; reescribirla cada turno la engorda con versiones
  muertas.
- **Por qué reemplazo completo y no deltas**: elimina toda una familia de bugs de
  merge. Es seguro porque la cola ya garantiza **un solo turno por conversación a
  la vez** ([34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md)).

**Índices**: solo la PK para el camino caliente. **Nada de GIN sobre el JSONB**:
no se consulta por dentro en caliente, sería coste de escritura a cambio de nada.

**El "0" para reiniciar** es un paso determinista **antes** del LLM (como
`matchesHandoffIntent`, `pipeline.ts:445`): borra el estado y arranca limpio
aunque el modelo esté confundido. **Cambiar de opinión** no necesita nada: el
estado se reemplaza entero.

> ⚠️ **El estado lo *propone* el LLM: es entrada no confiable.** Cada `productId` se
> resuelve con `scoped()` contra el catálogo de ESA organización, y **el total lo
> recalcula el servidor**, nunca el número que diga el modelo. Es el criterio que
> ya usan `resolveStage` y `send_image`.

### Dos campos que no son opcionales a 200 clientes

Los pidió el dueño, y los dos son baratos ahora e imposibles de retroencajar
después:

**1. `schema_version` en cada fila de estado.** Un entero. El día que cambie la
forma del JSON habrá conversaciones vivas con la forma vieja, y sin versión no
hay forma de saber cuál es cuál salvo adivinando por las claves presentes. Con
versión, el pipeline sabe si migrar al vuelo o descartar y empezar limpio.

A 3 clientes parece burocracia; a 200 es la diferencia entre desplegar un cambio
de esquema y no poder tocarlo nunca.

**2. Métricas básicas, para no navegar a ciegas.** El proyecto ya sabe lo que
cuesta no medir: este documento existe porque no hay un número del problema que
pretende resolver. Lo mínimo, emitido desde el pipeline:

| Métrica | Para qué |
|---|---|
| Turnos por pedido cerrado | Es **dinero directo** desde el 1-oct-2026 |
| Estados que no validan / total | La objeción #1: si sube, la extracción falla |
| Pedidos abandonados por `paso` | Dónde se cae la gente de verdad |
| Coste por conversación | La objeción #2, medida en continuo |

El campo `paso` de la tabla existe precisamente para que la cuarta sea un
`GROUP BY` y no una arqueología del historial.

### Capacidades → booleanos en `agent_profile` + `module_config jsonb`

`agent_profile` ya se lee una vez por turno (`pipeline.ts:361`): poner los flags
ahí cuesta **cero joins y cero lecturas extra**, que era la restricción dura. Una
tabla `org_module` añadiría una consulta por turno.

`appointments_enabled` → `agenda_enabled` **por vía aditiva en tres tiempos**
(añadir + backfill → doble escritura → `DROP` semanas después). Un rename directo
es destructivo.

### Catálogo de pedidos → tabla nueva, no reutilizar `service`

`service` tiene `durationMin NOT NULL` (sin sentido para un churro) y está
acoplado a la restricción de solape y a `staff_service`. Además los productos
necesitan opciones con precio, que los servicios no tienen.

`product` + `product_option_group` + `product_option`, donde
`priceDeltaCents` cubre **tamaños y adiciones con el mismo mecanismo**.

Dos detalles que vienen de incidentes reales:
- **`priceCents` NULLABLE a propósito**: *"no lo escribió"* no es *"vale 0"*.
- **Tabla de revisión humana antes de escribir filas**: en el catálogo del salón
  hubo **12 precios equivocados que nadie vio**
  ([32-CATALOGO-SALON.md](32-CATALOGO-SALON.md)).

### Aislamiento entre clientes

Hubo una fuga real entre tenants por un `UPDATE` filtrado solo por `id`
([10-SEGURIDAD.md](10-SEGURIDAD.md)). El diseño lo cierra con **FK compuestas
`(organization_id, parent_id)`**: hace *estructuralmente imposible* colgar una
opción de un producto de otra organización. Es la respuesta a nivel de motor, no
de disciplina.

### Migraciones

La base entera pesa 16 MB y la tabla mayor tiene 282 filas: casi todo es seguro
en caliente. Aun así, primero aditivo y la limpieza semanas después.

| Paso | ¿Caliente? |
|---|---|
| Añadir columnas de módulos + backfill | ✅ |
| Crear tablas de catálogo y estado (vacías) | ✅ |
| Migrar el texto a filas, **por org, con revisión humana** | ✅ (no es DDL) |
| Voltear el prompt a filas | ✅ (solo código) |
| `DROP COLUMN`, `SET NOT NULL` | ⚠️ **diferido**, tras respaldo |

**El interruptor de rollback**: `catalog_source ('prompt' | 'tabla')` por
organización, por defecto `'prompt'`. Se voltea solo cuando el catálogo está
revisado, y volver atrás es un `UPDATE` de una fila.

---

## Qué NO hacer

1. **No añadir tool-calling nativo** para el estado. El contrato de una acción
   JSON por turno ya funciona y cambiar la frontera de `lib/ai` reabre el bug
   documentado de `content: null` de Gemini (`pipeline.ts:549-557`).
2. **No construir el motor de capacidades con toggles finos ahora.** Para 2
   verticales es la trampa que [33-ESCALABILIDAD.md](33-ESCALABILIDAD.md) ya
   descarta.
3. **No quitar los guardarraíles** al meter el estado: son capas distintas.
4. **No mezclar RLS ni rate-limit** en este roadmap: es el otro eje.
5. **No migrar el prompt de Lis como parte de esto.** Va la última, siempre.

---

## La secuencia segura

**Orden de despliegue entre clientes**, de menor a mayor riesgo de negocio:

1. Un cliente nuevo o de prueba (nace corto, no hay nada que comparar)
2. **Lashes Valen** — agente apagado: el banco de pruebas más barato
3. **La Churra** — encendida, pero menos crítica; ya tiene ficha
4. **Lis, la última** — la que más factura, `pausado: true`

**La bandera**: no inventar una nueva. Reutilizar el patrón de
`appointmentsEnabled` — un booleano en `agent_profile`, apagado por defecto. Con
la bandera apagada, el pipeline corre exactamente como hoy, y **estado ausente ==
comportamiento actual**. El rollback es apagar la bandera, sin desplegar.

Respaldo obligatorio de `agent_profile` antes de tocar (el script ya lo hace).

---

## Qué le pasa a Lis

Hay que decidirlo **antes de empezar**, no en la fase 3.

Lis es la que más factura, tiene el prompt más largo (17.058 caracteres) y está
**sin migrar a propósito**: su Laboratorio quedó en 83-75 frente a los 92 de su
prompt actual. El enfoque de prompt generado **ya perdió dos veces** contra el
hecho a mano: La Churra el 13-ago (se saltaba el resumen por dilución,
[48-AFINAR-PROMPTS.md](48-AFINAR-PROMPTS.md)) y Lis el 14-ago.

Las dos salidas son incómodas y hay que elegir con los ojos abiertos:

- **Se queda fuera**: dos sistemas que mantener a la vez, indefinidamente.
- **Se migra**: al cambio más grande hecho hasta la fecha, con el historial de
  que migrarla ya la degradó dos veces.

---

## Estado de este documento

Escrito el 15-ago-2026 a partir de cuatro revisiones en paralelo, y revisado
después por el dueño.

**Veredicto del dueño: 9/10 como dirección, condicionado a dos cosas** — medir
primero, y desplegar por una secuencia segura (cliente de prueba o negocio
apagado antes que los que facturan). Ambas están recogidas arriba: Fase 0 y la
secuencia de cuatro escalones.

Sus tres aportes ya están incorporados: la regla de propiedad del estado (que
pasó a ser el principio rector del diseño), el `schema_version` y las métricas
básicas.

**Estado tras la Fase 0 (15-ago, noche):**

| | |
|---|---|
| Objetivo | **Confirmado y reescrito**: escalar sin un prompt gigante por cliente. No es reducir mensajes |
| Urgente antes de nada | Contraseña del superadmin · encender el salón |
| Fase 1 (catálogo a tablas) | **Aprobada**. Beneficio claro y reduce contradicciones |
| Fase 2 (estado estructurado) | **En espera de un piloto que la justifique**, con bandera por cliente y rollback |
| Laboratorio | **La Churra**, en condiciones reales. Lis la última y ya validada |
| Cambio de modelo | **Descartado** por calidad (Gemini 0 fallas contra 2) |

De las cinco objeciones: la tercera quedó resuelta (el flujo en dos niveles ya
existe); la primera se atendió con la Fase 0 —aunque midiendo el síntoma
equivocado, ver arriba—; **la segunda (fragilidad de la extracción), la cuarta
(otra fuente de verdad) y la quinta siguen abiertas** y son condición para la
Fase 2, no para la Fase 1.

Lo que sí está decidido y verificado: el diagnóstico técnico es correcto —el
pedido no existe como dato y el prompt le pide al modelo que haga de base de
datos—, y la arquitectura de destino **ya funciona en el vertical de citas**.
