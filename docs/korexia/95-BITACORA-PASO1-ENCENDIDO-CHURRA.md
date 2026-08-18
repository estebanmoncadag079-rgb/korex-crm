# Paso 1 del encendido de La Churra: cinco escrituras en producción

> **Dentro:** Objetivo · El gate · Lo que decía la base real (y no coincidía) ·
> Las cinco escrituras aplicadas, en orden · El hallazgo de ADICIONES · El
> banco de escenarios propio · Los 8 criterios del doc 69 · Lo que quedó
> pendiente y por qué · Tabla de reversión · Cómo revertir cada cambio

**18-ago-2026.** Ejecución del "paso 1" que dejó pendiente
[93-PENDIENTES-17AGO.md](93-PENDIENTES-17AGO.md): los tres primeros puntos de
la tabla de encendido de La Churra (`org_lo5gdlt6k43z9fg1ling`), más el banco de
escenarios y la revisión de los 8 criterios del doc 69. **Trabajo de datos de un
cliente, no de arquitectura** — el núcleo no se tocó.

---

## 1 · Objetivo

Dejar el catálogo y la ficha de La Churra listos para que, cuando el dueño
decida, encender `state_source = 'backend'` no tropiece con nada que ya se
sabía roto: la repetición de salsas, el nombre del chocolate, y
`RECUBIERTO`/`ADICIONES` fuera de las tablas.

**Límites duros respetados**: solo `org_lo5gdlt6k43z9fg1ling`; no se ejecutó
`pnpm regenerar:flota`; no se tocó `agent_profile.state_source` de ningún
cliente real; no se hizo `git push` ni despliegue; nada de lo marcado
CONGELADO en [79](79-ARQUITECTURA-MULTIEMPRESA.md) se tocó.

---

## 2 · El gate, antes de tocar nada

```
pnpm test        → 782 passed | 66 skipped (848)
pnpm typecheck    → limpio
pnpm lint         → limpio
```

Verde. Se procedió.

---

## 3 · Lo que decía la base real, y no coincidía con lo esperado

Regla de oro del proyecto: verificar contra la base, no contra el documento.
Dos hallazgos, los dos reportados en el momento y **ninguno corregido por
cuenta propia** sin antes preguntar:

### 3.1 · La ficha se había editado 3 minutos antes de leerla

Al leer `agent_profile.ficha` de La Churra, `flujo.cierre` estaba en `null` y
`negocio.variantes` ya no traía el bloque `SALSAS/RECUBIERTO/ADICIONES` que
describe [91](91-CATALOGO-DE-LA-CHURRA.md) — solo el texto plano por
presentación (`"CHURRITA — $10.000-1 salsa a eleccion entre..."`). El registro
de cambios lo explicó: `proceso=aplicarFicha actor=user:n2W98…
timestamp=2026-08-18T01:53:37Z`, es decir, **una edición real del dueño desde
el CRM, minutos antes**, no una corrupción. Confirmado por el propio dueño:
*"soy yo, no se hicieron cambios de nada"* — el agente de Lashes Valen también
se apagó a propósito ese mismo momento, para trabajo aparte en esa cuenta.

**Consecuencia práctica**: los "cuatro sitios" del doc 91 ya no existían tal
cual en `ficha.variantes` (solo quedaban dos, dentro de `reglasPropias`), y
`cargar:opciones` daba **0 sentencias** porque no había de dónde leer
`RECUBIERTO`/`ADICIONES`.

### 3.2 · El formato de `variantes` cambió de forma legítima

`negocio.variantes` pasó del formato antiguo (`SALSAS: 🍯 AREQUIPE · …`, un
bloque global) al formato **"por producto"** que el propio parser documenta
como *"el que usa La Churra de verdad"* (`sembrar.ts`):

```
CHURRITA — $10.000-1 salsa a eleccion entre chocolate negro,arequipe,lechera,chocolate blanco
```

Este formato ya declaraba correctamente `chocolate negro` y `chocolate
blanco` — sin la ambigüedad que documentaba el doc 91. No había nada que
corregir ahí.

Se preguntó al dueño cómo proceder ante la falta de `RECUBIERTO`/`ADICIONES` en
ese bloque. Respuesta: *"toma la decisión más acertada, recuerda que korex es
una plataforma que haremos para que funcione con múltiples tipos de empresas,
el núcleo no se toca y el CRM es la fuente de verdad"*. Decisión tomada:
**conservar íntegras las cuatro líneas que el dueño acababa de escribir** y
**añadir** —no reemplazar— las dos líneas de `RECUBIERTO`/`ADICIONES` en el
mismo formato que el parser ya soporta. Nada de esto toca el núcleo: es
contenido de la ficha de un cliente, escrito con la misma herramienta
(`serializarComoEstaba`) que usa el CRM.

---

## 4 · Las cinco escrituras aplicadas, en orden

Todas contra `org_lo5gdlt6k43z9fg1ling`, todas con simulación previa idéntica a
lo aplicado, todas con registro de cambios y comparación de fila completa en
verde (sin `[NO DECLARADO]`).

### 4.1 · `permite_repeticion = true` en los cuatro grupos SALSA

```
pnpm repeticion org_lo5gdlt6k43z9fg1ling SALSA --si --aplicar
```

Antes: `CHURRITA/BESTIES/FAMILY BOX` en `no`, `MEGA BOX` ya en `SÍ` (por la
migración `0023`, aritmética). Después: los cuatro en `SÍ`. **3 filas
tocadas**, coincide exactamente con la simulación del doc 91.

### 4.2 · Corrección de `reglasPropias` y `variantes` — script nuevo

Como el bloque de doc 91 ya no existía en `ficha.variantes`, se escribió
`scripts/corregir-ficha-churra.ts` (nuevo, committeado, específico de esta
organización — se niega a correr contra cualquier otra):

- `reglasPropias`: **3 ocurrencias** de `"CHOCOLATE"` sin `NEGRO`/`BLANCO` →
  `"CHOCOLATE NEGRO"` (una en el ejemplo de formato, dos en el bloque de la
  pregunta — mensaje 2).
- `negocio.variantes`: se **añadieron** dos líneas al final, sin tocar las
  cuatro que el dueño acababa de escribir:
  ```
  RECUBIERTO (elige 1): ✨ Azúcar-canela · ✨ Azúcar sola · ✨ Ambas · ✨ Sin azúcar
  ADICIONES (opcionales, se cobran aparte): 🍫 Salsa de CHOCOLATE NEGRO $2.000 · 🤍 Salsa de CHOCOLATE BLANCO $2.000 · 🐄 LECHERA $1.500 · 🍯 AREQUIPE $1.500 · 💧 Botella de agua $2.000
  ```
  Los precios y nombres de adición vienen del dueño (18-ago): *"solo existen
  salsa de chocolate negro y salsa chocolate blanco... esas mismas también
  existen como adición... vale dos mil cada una"*. `LECHERA`/`AREQUIPE`/`agua`
  se conservaron de la ficha anterior — nadie pidió quitarlas.

Escrito con `serializarComoEstaba(fichaCruda, fichaPatched)`, nunca con lo que
devuelve `leerFichaAplanada` a secas — cumple el guardarraíl de
[84](84-EL-MODELO-DE-LA-FICHA.md) (`tests/unit/ficha-ida-y-vuelta.test.ts`
sigue en verde). Antes de aplicar, se probó el bloque nuevo contra
`leerCatalogoDeTexto` en un script aparte: resolvió `RECUBIERTO min=1 max=1
sin revisar` y `ADICIONES` con los cinco precios exactos en centavos.

**Riesgo verificado y descartado**: comparación de fila completa tras escribir
— solo `ficha` cambió, nada `[NO DECLARADO]`.

### 4.3 · Restauración de `flujo.cierre.requisitos`

```
pnpm migrar:requisitos org_lo5gdlt6k43z9fg1ling --aplicar
```

Simulación previa idéntica a lo que había antes de la edición del dueño:
`nombre`, `telefono`, `direccion` (con `soloSi: entrega.haceDomicilios`), los
tres obligatorios. Este script ya usa el patrón seguro (`aSecciones`
condicional) desde que se corrigió el incidente del 17-ago — no hizo falta
tocarlo.

### 4.4 · Carga de `RECUBIERTO` y `ADICIONES` en las tablas

```
pnpm cargar:opciones org_lo5gdlt6k43z9fg1ling --aplicar
```

**40 INSERT, 0 UPDATE, 0 DELETE** — exactamente lo que medía el doc 69. Una
opción excluida por ambigüedad (`"Ambas"`, decisión pendiente del dueño desde
el 16-ago, sin cambios). `ADICIONES` salió marcada `🟠 REVISAR: no dice cuántas
se eligen` en las cuatro presentaciones — es el comportamiento correcto: nadie
declaró un máximo, así que queda en "todas" (5), consistente con como estaba
antes de tener tablas.

### 4.5 · `permite_repeticion = true` en los cuatro grupos ADICIONES

**Hallazgo, reportado antes de tocarlo**: recién cargadas, las `ADICIONES`
quedaron en `permite_repeticion = false` (valor por defecto del script), pero
`reglasPropias` dice explícitamente *"Adiciones: sí se pueden repetir... no le
digas que repite, pregúntale si quiere sumar otra"*. Con la Fase 2 encendida y
sin este ajuste, pedir dos salsas de chocolate negro como adición se habría
rechazado. Preguntado al dueño → **sí, aplicar ahora**:

```
pnpm repeticion org_lo5gdlt6k43z9fg1ling ADICIONES --si --aplicar
```

**4 filas tocadas.**

### Estado final verificado contra la base (no contra ningún documento)

```
CHURRITA   · SALSA        min=1 max=1 opciones=4  repite=SÍ
BESTIES    · SALSA        min=2 max=2 opciones=4  repite=SÍ
FAMILY BOX · SALSA        min=3 max=3 opciones=4  repite=SÍ
MEGA BOX   · SALSA        min=5 max=5 opciones=4  repite=SÍ  (aritmética: sin repetir no cierra)
CHURRITA   · RECUBIERTO   min=1 max=1 opciones=3  repite=no
BESTIES    · RECUBIERTO   min=1 max=1 opciones=3  repite=no
FAMILY BOX · RECUBIERTO   min=1 max=1 opciones=3  repite=no
MEGA BOX   · RECUBIERTO   min=1 max=1 opciones=3  repite=no
CHURRITA   · ADICIONES    min=0 max=5 opciones=5  repite=SÍ
BESTIES    · ADICIONES    min=0 max=5 opciones=5  repite=SÍ
FAMILY BOX · ADICIONES    min=0 max=5 opciones=5  repite=SÍ
MEGA BOX   · ADICIONES    min=0 max=5 opciones=5  repite=SÍ
```

---

## 5 · El banco de escenarios propio de La Churra

`scripts/probar-estado.ts`, **Bloque A** reescrito por completo: el catálogo
ficticio (`SENCILLO`/`CAJA GRANDE`) se reemplazó por las cuatro presentaciones
reales, con `SALSA`/`RECUBIERTO`/`ADICIONES` — mismos nombres, mismas
opciones, mismos precios que quedaron en producción tras el punto 4. Se
mantiene la estructura A1–A9 del script (nada de Bloque B — citas — se tocó).

Lo más relevante, más allá de renombrar productos:

- **A3** ahora usa el Mega Box de verdad (5 de 4 sabores) y añade el caso de
  la regla de ADICIONES-repite recién aplicada: dos "Botella de agua" como
  adición se cobran las dos, no se rechazan.
- **A6** sustituye el caso ficticio de "opción de otro producto" por la
  ambigüedad **real** de La Churra documentada en el doc 91: `"arequipe"` sin
  decir el grupo existe a la vez como salsa incluida y como adición de
  $1.500 — sin grupo, el backend pregunta en vez de adivinar.
- **A9 — la regla 10 — usa el caso real que falló en producción** (doc 92):
  *"Churrita arequipe / Besties chocolate y chocolate"*. Aquí va literal:
  Churrita con arequipe + Besties con dos chocolate negro (repetición dentro
  de un pedido de dos productos), confirmado con los tres datos, contra la
  base de verdad.

**Decisión de alcance, anotada**: el fixture de `probar-estado.ts` pasa a ser
específico de La Churra (antes era genérico). Es un *script* de un solo
cliente, no el núcleo — la misma categoría que `corregir-ficha-churra.ts` o
`fichas-de-clientes.ts`. Si mañana hace falta un banco genérico de nuevo (para
un tercer cliente de pedidos, por ejemplo Lis), se decide entonces —no antes,
por la misma regla que ya dejó escrita el doc 79 sobre no generalizar sin un
segundo caso real delante.

### Resultado de la corrida (`pnpm probar:estado`, dos veces, contra clientes efímeros)

```
53 comprobaciones · 0 fallos (🔴) · 0 [NO DECLARADO]
✅ TODO PASA
```

Bloque A (los 9 puntos, con el catálogo de La Churra) y Bloque B (citas,
intacto) en verde. Al cierre: **la flota real no cambió una sola fila**
(`C1`), no queda `conversation_state` en ninguna de las dos conversaciones
efímeras (`C2`), y los dos clientes efímeros (`org_c846caqc69ajlv8cvfq4`,
`org_ouft4qrl19ghnf05w9tv`) se borraron sin dejar huérfanos. **Nunca se tocó
`org_lo5gdlt6k43z9fg1ling`** durante esta corrida — el catálogo de prueba se
escribe en la organización efímera, no se lee de la real.

---

## 6 · Los 8 criterios de [69-FASE-2-ESTADO-ESTRUCTURADO.md](69-FASE-2-ESTADO-ESTRUCTURADO.md)

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Cero `[NO DECLARADO]` tras el banco de escenarios | ✅ | `grep -c "\[NO DECLARADO\]"` sobre la corrida completa → **0** |
| 2 | Cero estados persistidos que no pasen el validador | ✅ *(en el banco)* | `guardarEstado` solo se llama tras un `validarPropuesta.ok === true`; los 5 casos de corrupción (A6) nunca se persisten, y se comprueba que el estado guardado bueno sigue intacto después. Sin datos de producción real: la bandera sigue apagada en todos los clientes |
| 3 | El total del servidor coincide con el resumen en el 100 % de los pedidos | ✅ *(en el banco)* | Los 6 totales calculados en la corrida (A2, A3×2, A5, A9) coinciden exactamente con lo esperado a mano |
| 4 | Rollback demostrado sobre ese cliente | 🟠 **parcial** | El mecanismo de rollback (`schema_version` futuro → se ignora; `borrarEstado`) está demostrado en el banco de escenarios, **no contra `org_lo5gdlt6k43z9fg1ling`** — tocar su `state_source` está explícitamente prohibido en este encargo. Las dos sentencias SQL siguen documentadas en el doc 69 |
| 5 | Latencia p90 por debajo de 4 s | 🟠 **sin remedir hoy** | Sigue en pie el dato del 15-ago (B: 2.172 ms medios sobre 20 turnos reales), pero no se corrió una medición nueva porque exige regenerar el prompt (paso 6, saltado por decisión del dueño — ver §7) |
| 6 | Recubierto y adiciones cargados en el cliente donde se encienda | ✅ | Verificado leyendo la base real de `org_lo5gdlt6k43z9fg1ling` tras el punto 4.4: los 4 productos tienen `RECUBIERTO` (3 opciones) y `ADICIONES` (5 opciones) |
| 7 | Comparación de fila completa en verde | ✅ | Las cinco escrituras del §4 pasaron por `conRegistro`/`compararFila`; ninguna marcó `[NO DECLARADO]` |
| 8 | Un pedido completo revisado a ojo por el dueño | 🔴 **pendiente, no lo puede cerrar el asistente** | Queda para Esteban |

---

## 7 · Lo que quedó pendiente y por qué

### Paso 6 (regla 13, remedición) — saltado por decisión del dueño

La regla 13 del doc 66 (comparar extracción en una llamada contra dos) **ya se
ejecutó el 15-ago** y ganó la estrategia B (la que está implementada). Lo que
el doc 93 anota como pendiente parece ser volver a medirla **con el prompt ya
corregido dentro** — pero eso exige `pnpm regenerar:flota` contra el cliente
real, prohibido en este encargo. Preguntado, decisión del dueño: **saltar el
paso 6** por ahora; no bloquea el resto.

### Criterio 5 (latencia p90) — no remedido, mismo motivo

Depende del mismo `regenerar:flota`. Queda con el dato del 15-ago como última
medición conocida.

### Criterio 8 — reservado a una persona

No es una omisión: el propio doc 69 lo escribe así, y el encargo lo repite —
"no por el asistente".

### Sin ejecutar todavía, y explícitamente fuera de este paso

`pnpm regenerar:flota` (deja listo el prompt corregido, pero **cambia lo que
ven los cuatro clientes reales**) y encender `state_source = 'backend'` para
La Churra. Las dos decisiones son de Esteban.

---

## 8 · Tabla de reversión

Amplía la de [91-CATALOGO-DE-LA-CHURRA.md](91-CATALOGO-DE-LA-CHURRA.md#reversión)
con lo aplicado hoy. Ninguna de estas operaciones tocó una migración ni un
esquema — todo es reversible con datos.

| Cambio | Cómo se vuelve atrás |
|---|---|
| SALSA → repite | `pnpm repeticion org_lo5gdlt6k43z9fg1ling SALSA --no --aplicar` |
| ADICIONES → repite | `pnpm repeticion org_lo5gdlt6k43z9fg1ling ADICIONES --no --aplicar` |
| `reglasPropias`/`variantes` (script nuevo) | El registro de cambios guarda el valor anterior (huella, no texto plano — es `personal`); restaurar exige el respaldo de las 21:30 del 17-ago o anterior a la corrida (`vocero-20260817-2130.sql.gz` en el VPS) |
| `flujo.cierre.requisitos` | `DELETE` del campo `cierre` de la ficha, o restaurar desde el mismo respaldo — el registro de cambios marca el `updatedAt` exacto (`2026-08-18T02:46:25Z`) |
| Las opciones cargadas (`RECUBIERTO`/`ADICIONES`) | `DELETE FROM product_option_group WHERE organization_id='org_lo5gdlt6k43z9fg1ling' AND name IN ('RECUBIERTO','ADICIONES')` — son `INSERT` aditivos, nada se pisó; el `DELETE` en cascada se lleva las opciones |
| `scripts/probar-estado.ts` (banco de escenarios) | `git revert` del commit — no toca ninguna base, es solo el script |
| El prompt | Sigue **sin regenerar**: nada de lo de hoy cambió lo que el agente dice hasta que alguien corra `pnpm regenerar:flota` |

---

## 9 · Resumen para el juez

**Aplicado de verdad en producción** (§4, cinco escrituras, todas verificadas
contra la base y con fila completa en verde): repetición en SALSA, corrección
de `reglasPropias`/`variantes`, restauración de `cierre.requisitos`, carga de
`RECUBIERTO`/`ADICIONES` (40 filas), repetición en ADICIONES.

**Listo pero SIN ejecutar, a propósito**: `pnpm regenerar:flota` y el
encendido de `state_source`. Las dos son decisiones de Esteban, explícitamente
fuera de este encargo.

**Banco de pruebas**: 53 comprobaciones, 0 fallos, contra un cliente efímero
que se creó y se borró en la misma corrida — nunca contra La Churra real.

**Lo que no coincidió con los documentos de hoy, y se reportó en vez de
corregirse en silencio**: la ficha ya no traía el bloque
`SALSAS/RECUBIERTO/ADICIONES` que describía el doc 91 (edición legítima del
dueño, minutos antes de la revisión) y las `ADICIONES` recién cargadas no
heredaron la regla de repetición que ya declaraba `reglasPropias`. Las dos
veces se preguntó antes de escribir.
