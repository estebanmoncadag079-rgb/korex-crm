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

## 🔴 Lo primero: esto no está medido

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

### 3. "Cada cliente quiere un orden distinto" no tiene evidencia

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

> ⚠️ **El estado lo escribe el LLM: es entrada no confiable.** Cada `productId` se
> resuelve con `scoped()` contra el catálogo de ESA organización, y **el total lo
> recalcula el servidor**, nunca el número que diga el modelo. Es el criterio que
> ya usan `resolveStage` y `send_image`.

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

Escrito el 15-ago-2026 a partir de cuatro revisiones en paralelo. **Es un plan
propuesto, no aprobado.** La Fase 0 (medir) es condición para todo lo demás, y
las cinco objeciones siguen abiertas.

Lo que sí está decidido y verificado: el diagnóstico técnico es correcto —el
pedido no existe como dato y el prompt le pide al modelo que haga de base de
datos—, y la arquitectura de destino **ya funciona en el vertical de citas**.
