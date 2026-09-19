# 157 — Auditoría del plan para adoptar SDD en Korex

7-sep-2026. **Solo auditoría.** Ningún archivo de código, esquema, migración,
prompt o configuración fue modificado. Sin commit, sin push, sin deploy.

## Qué se auditó y con qué evidencia

| Auditado | Evidencia recogida |
|---|---|
| `.specify/` | 40 archivos: constitución, templates (spec/plan/checklist), scripts PowerShell, extensiones git y agent-context |
| `specs/` | 15 archivos en 2 features: `001-vocero-core` (completa, con 5 contratos) y `002-diseno-atlas-white-label` |
| `docs/korexia/` | 157 documentos |
| `CLAUDE.md`, `REGLAS-DE-ARQUITECTURA.md`, `.specify/memory/constitution.md` | Leídos completos |
| `tests/` | 216 archivos de prueba; se identificaron los de arquitectura/contrato |
| `.github/workflows/deploy.yml` | Leído; historial de ejecuciones consultado con `gh` |
| Fechas reales | `git log` por zona del repositorio |
| Remotos | `git remote -v`, `gh repo view` |

## El hallazgo que cambia el diagnóstico

**Korex ya adoptó SDD una vez. Duró dos días.**

```
.specify/ (constitución, templates, scripts)  último cambio: 2026-07-09
specs/001-vocero-core/spec.md                 último cambio: 2026-07-09
specs/002-diseno-atlas-white-label/spec.md    último cambio: 2026-07-10
docs/korexia/                                 activo hasta:  2026-09-03
src/ y tests/                                 activos hoy:   2026-09-07
```

Entre el 10 de julio y hoy hay **dos meses de desarrollo intenso**: 157
documentos, 216 archivos de prueba, tres incidentes de producción corregidos
solo esta semana. **Nada de eso pasó por `specs/`.**

El plan propuesto pregunta *"¿cómo adoptamos SDD?"*. La pregunta correcta,
visto el repositorio, es **"¿por qué el SDD que ya instalamos se abandonó a
los dos días, y qué impide que vuelva a pasar?"**. El plan no la hace, y sin
respuesta las once fases nuevas corren exactamente el mismo destino.

## Veredicto general

**REQUIERE CAMBIOS — con riesgo alto de sobrearquitectura.**

El plan es correcto en el diagnóstico de fondo (hace falta orden y autoridad)
y equivocado en la escala: propone construir once fases de proceso sobre un
proyecto donde **el proceso ya existe, está escrito, y no se usa**. Añadir
más reglas escritas a un cuerpo de reglas que se incumple no produce
cumplimiento: produce más documentación muerta.

## Lo que ya existe y NO debemos duplicar

Esta es la sección más importante de la auditoría. Seis de las once fases
propuestas construyen algo que ya está en el repositorio.

### 1. La constitución, con nueve principios (ya escrita, incumplida)

`.specify/memory/constitution.md` ya define:

```
I.   Seguridad de Datos Primero (NO NEGOCIABLE)
II.  Soberanía / Self-Hosted (ENDURECIDO)
III. Multi-Tenancy Real
IV.  Idempotencia en Integraciones Externas
V.   Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)
VI.  Specs Antes de Código          ← ya obliga a lo que la FASE 5 propone
VII. Trazabilidad de Decisiones     ← ya obliga a lo que la FASE 9 propone
VIII.Foco Vertical
IX.  Verificación de Comportamiento en Vivo (NO NEGOCIABLE)
```

Más las secciones *Restricciones de Plataforma*, *Flujo de Desarrollo y
Puertas de Calidad* y *Governance*.

**El principio VI ("Specs Antes de Código") lleva dos meses sin cumplirse.**
La Fase 5 del plan propone escribir reglas para las IAs que en buena parte ya
están ahí. El problema nunca fue que faltara la regla.

### 2. Gates de arquitectura ejecutables (la FASE 8 los da por inexistentes)

No son documentos: son pruebas que corren en cada `pnpm test`.

| Prueba | Qué protege |
|---|---|
| `tests/unit/arquitectura-aprobada.test.ts` | Que un cliente nuevo nazca con catálogo y estado en tablas, no en el prompt; que pedidos no contrate citas |
| `tests/unit/vertical-fuente-unica.test.ts` | Una sola fuente para el vertical; un vertical nuevo no rompe nada |
| `tests/unit/tenant.test.ts` | Aislamiento multi-tenant |
| `tests/unit/esquema-json-de-accion.test.ts` | Deriva de contrato: recorre la unión de acciones y falla si falta una descripción |
| `tests/unit/provision-organization-arquitectura.test.ts` | Arquitectura en el alta de clientes |
| `tests/unit/propiedad-de-la-ficha.test.ts` | Un dueño por dato |

La Fase 8 pide "evaluar si crear architecture checks, contract tests, tenant
isolation tests". **Los seis ya existen y están verdes.** Lo que falta no es
crearlos: es un inventario que diga cuáles son y por qué no se tocan.

### 3. El pipeline de producción completo (la FASE 10, ya automatizada)

`.github/workflows/deploy.yml` ya implementa, literalmente, la cadena que la
Fase 10 propone:

- valida el formato del commit **antes** de tocar el repositorio;
- confirma que el commit es ancestro de `origin/main`;
- corre `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `build`;
- exige escribir **CONFIRMAR** más un Environment `production` protegido
  (barrera verificada del lado del servidor, no solo en la interfaz);
- ejecuta `scripts/deploy.sh`.

**Y tiene cero ejecuciones en el repositorio de Korex.** Está construido,
probado en su diseño y sin usar. Los tres despliegues de esta semana —
incluidos los dos que hice yo — se hicieron **a mano por SSH**, saltándose
todas esas barreras. No por desconocimiento del riesgo: porque nadie encendió
lo que ya estaba hecho.

Es el mismo patrón que las specs: infraestructura construida y abandonada.

### 4. El flujo SDD ya está documentado

`docs/sdd-workflow.md` existe desde el 26-jul. `specs/README.md` explica la
estructura de carpetas y qué comando genera cada artefacto. La Fase 7
propone escribir un workflow que ya está escrito.

### 5. La jerarquía de autoridad ya está declarada (parcialmente)

`CLAUDE.md` ya dice, en su primer recuadro:

> **Cuando este archivo y `docs/korexia/` se contradigan, manda
> `docs/korexia/`** — y arregla este archivo.

Y `REGLAS-DE-ARQUITECTURA.md` ya es "el filtro obligatorio para cualquier
cambio, de cualquier IA, en cualquier sesión", con las cuatro categorías de
clasificación obligatoria. La Fase 1 no parte de cero: parte de una jerarquía
existente e incompleta.

### 6. La trazabilidad de decisiones ya existe, y mejor hecha que un ADR

La Fase 9 propone documentar contexto / problema / evidencia / alternativas /
decisión / consecuencias / estado. Los documentos de `docs/korexia/` **ya
hacen eso**, y añaden dos cosas que un ADR clásico no tiene y que aquí han
resultado decisivas: **la medición previa** ("por qué se midió antes de
construir", doc 101) y **cómo revertir**.

Ejemplos verificados: doc 101 (guardarraíl del recurso prometido), doc 132
(pago sin verificar, calibrado contra 82 respuestas reales), doc 143
(verificación factual forzada), doc 149 (confirmación por servicio en citas).

Sustituir esto por una plantilla de ADR sería un retroceso.

## Por qué murió el SDD la primera vez (hipótesis sostenida por la evidencia)

El trabajo real de Korex, medido en su propia documentación, **no son
features planeables: son incidentes de producción**. De los 157 documentos,
35 son explícitamente bitácoras, auditorías, incidentes o listas de
pendientes; y el grueso del resto nace de un fallo concreto en un cliente
real (Lis, La Churra, Lashes Valen, MALIA).

Un ciclo `SPEC → CLARIFY → ARCHITECTURE → PLAN → IMPLEMENT → TEST → AUDIT →
DEPLOY → OBSERVE → UPDATE` (doce pasos) **no cabe** cuando el bot está
repitiendo el resumen a una clienta que ya confirmó y cada hora cuesta
pedidos. Esta semana hubo tres incidentes así. Ninguno habría podido esperar
a una spec aprobada.

Lo que sí sobrevivió dos meses fue el documento de incidente con causa raíz,
evidencia y cómo revertir — porque devuelve valor el mismo día.

**Conclusión: el SDD de Korex debe construirse alrededor del incidente, que
es su unidad real de trabajo, no alrededor del feature, que es la unidad de
un producto greenfield.** El plan propuesto está diseñado para lo segundo.

## Qué adoptaría tal cual

- **FASE 0 (auditoría documental)** — necesaria y urgente. Con 157
  documentos y solo algunos marcados "⚪ Superado por…" a mano en el índice,
  el riesgo de que una IA lea un documento viejo como vigente es real y ya
  se materializó: el propio índice advierte que *"hubo cuatro anteriores que
  decían «LÉEME AL RETOMAR» y ya están marcados como superados: describen
  sistemas que no existen"*.
- **FASE 4 (invariantes descubiertos desde el código)** — útil, y ya
  empezada sin nombre: los seis tests de arquitectura SON invariantes
  ejecutables. Falta el inventario que los nombre.
- La regla fundamental que ya trajiste: *"antes de construir una pieza nueva,
  demostrar que no existe ya una que pueda extenderse"*. Es la mejor parte
  del plan y debería ser el principio X de la constitución.

## Qué modificaría

| Fase | Problema | Corrección |
|---|---|---|
| **1 — Jerarquía** | Propone 6 niveles (constitution → architecture → specs → plan → code → tests) | Sobran dos. Y falta la regla dura: **ante conflicto entre documento y código, manda el código, y el documento se corrige o se marca superado el mismo día.** Un documento que describe algo que el código no hace es un bug de documentación, no una discrepancia a debatir |
| **5 — Reglas para IAs** | Nueve pasos por cambio | Nadie sigue nueve pasos para arreglar una regex. Dos reglas duras bastan (ver plan final) |
| **6 — Lifecycle** | Siete estados | Con 2 specs en 2 meses, siete estados es contabilidad de una fábrica que no existe. Tres: **VIGENTE / IMPLEMENTADO / SUPERADO** |
| **7 — Workflow** | Doce pasos para cambios grandes | Correcto tener dos carriles, mal calibrados. El carril rápido debe ser el **normal**, no la excepción |
| **9 — ADRs** | Plantilla nueva de 7 campos | Usar el formato de `docs/korexia/` que ya funciona, añadiéndole solo **estado** (vigente/superado) |

## Qué eliminaría

- **FASE 2 y FASE 3 como fases.** Son un párrafo cada una, no un proyecto.
  "Qué vive en cada raíz" se escribe en 10 líneas dentro de `CLAUDE.md`.
- **El lifecycle de siete estados.**
- **Cualquier gate nuevo que no sea un test ejecutable.** Un "architecture
  check" que sea una revisión manual no se mantiene: se salta. Los seis que
  existen funcionan precisamente porque son `pnpm test`.
- **La idea de que `specs/` sea el hogar de la verdad.** Dos meses de
  evidencia dicen que la verdad vive en `docs/korexia/` y en los tests.
  Forzar el retorno a `specs/` es pelear contra el flujo real del proyecto.

## Qué falta en el plan (huecos serios)

1. **No pregunta por qué falló la primera adopción.** Es el hueco central.
2. **No contempla el trabajo reactivo.** Los incidentes son la unidad real y
   el plan no tiene carril para ellos más allá de un "flujo reducido" sin
   definir.
3. **No retira nada.** Añade 5 artefactos nuevos a un repositorio que ya
   tiene cinco fuentes con autoridad (constitución, `REGLAS-DE-ARQUITECTURA`,
   `CLAUDE.md`, `docs/korexia/`, `specs/`). **Ese es el riesgo real de
   segunda fuente de verdad: ya vamos por la quinta.**
4. **No dice quién marca un documento como superado, ni cuándo.** Sin eso,
   la Fase 0 se hace una vez y se degrada en un mes.
5. **Ignora una trampa operativa real y activa**: `gh` en este repositorio
   apunta por defecto a **`kevinrivm/vocero-crm`** (el upstream), no a
   `estebanmoncadag079-rgb/korex-crm`. Cualquier IA que consulte PRs, CI o
   issues verá datos **del proyecto equivocado** — con ramas, features
   (`fix(003)`, `fix(015)`, integraciones con Google) e historial que no
   existen en Korex, y que además contradicen la constitución vigente aquí.
   En esta misma auditoría estuve a punto de tomar ese historial como propio.
   Es el riesgo de "IA interpretando información ajena como vigente" en su
   forma más concreta, y el plan no lo cubre.

## Jerarquía de autoridad real recomendada

No la propuesta de seis niveles. La que corresponde a cómo se decide de
verdad en Korex:

```
1. CÓDIGO + PRUEBAS EN VERDE          ← la única verdad ejecutable
2. CONSTITUCIÓN + REGLAS-DE-ARQUITECTURA   ← lo que el código NO puede violar
3. docs/korexia/ VIGENTE              ← por qué el código es así (causa raíz, evidencia)
4. CLAUDE.md                          ← cómo trabajar aquí (operativo)
5. specs/                             ← solo para obra nueva grande y planeable
```

Con dos reglas duras:

- **Ante conflicto entre un documento y el código, gana el código** y el
  documento se corrige o se marca superado en el mismo cambio. La
  documentación describe; no gobierna.
- **La constitución es la excepción**: si el código la viola, el bug está en
  el código. Es el único caso en que un documento manda sobre la
  implementación.

## Riesgo de sobrearquitectura, fase por fase

| Fase | Clasificación | Razón |
|---|---|---|
| 0 — Auditoría documental | **NECESARIA** | 157 docs, vigencia sin marcar, riesgo ya materializado |
| 1 — Jerarquía de autoridad | **NECESARIA** (simplificada) | Hoy hay 5 fuentes sin orden explícito |
| 2 — Consolidación documental | **ÚTIL** (no es una fase: es parte de la 0) | |
| 3 — Responsabilidad de raíces | **ÚTIL** (10 líneas en `CLAUDE.md`) | |
| 4 — Invariantes y contratos | **NECESARIA** | Ya existen sin inventario; es lo que protege el dinero |
| 5 — Reglas para IAs | **ÚTIL** si son 2 reglas; **INNECESARIA** si son 9 pasos | |
| 6 — Lifecycle de 7 estados | **INNECESARIA** | Contabilidad sin producción que contabilizar |
| 7 — Workflow de 12 pasos | **PREMATURA** | Diseñado para features; Korex vive de incidentes |
| 8 — Gates | **NECESARIA solo como inventario**; crear gates nuevos es **PREMATURO** | Los seis que importan ya existen y están verdes |
| 9 — Decisiones arquitectónicas | **INNECESARIA como formato nuevo** | Ya existe y mejor hecho en `docs/korexia/` |
| 10 — Producción | **NECESARIA, pero de ejecución, no de diseño** | Ya está construida y con 0 usos |

## SDD para brownfield: cómo lo adaptaría

Tres diferencias respecto al SDD de manual:

1. **La spec se escribe DESPUÉS de la auditoría del código, nunca antes.** En
   greenfield la spec define la realidad; aquí la realidad ya existe y la
   spec la describe. Toda spec de Korex debe empezar por "qué hace hoy el
   código" con `archivo:línea`, como hicieron los docs 156 y este.
2. **La unidad es el incidente, no el feature.** El documento de incidente
   (causa raíz, evidencia, medición, arreglo, cómo revertir) ya es el
   artefacto SDD de Korex. Reconocerlo formalmente en vez de sustituirlo.
3. **El invariante se descubre, no se decreta.** Un invariante de Korex es
   algo que ya está protegido por una prueba en verde. Si no hay prueba, no
   es invariante: es una intención.

## Múltiples IAs: cómo evitar arquitecturas paralelas

El riesgo no es teórico: hay dos repositorios vivos (`korex-crm` y el
upstream `vocero-crm`), con un merge ya descartado (doc 25), y la herramienta
`gh` apuntando al equivocado por defecto.

Cuatro medidas, en orden de eficacia:

1. **Reglas ejecutables antes que escritas.** Una IA puede ignorar un
   párrafo; no puede ignorar un test rojo. Todo invariante que importe debe
   tener su prueba — es lo que ya hacen los seis tests de arquitectura.
2. **Marcar la vigencia en el propio archivo, no solo en el índice.** Una
   cabecera `> ⚪ SUPERADO por [NNN]` en la primera línea del documento. Una
   IA que abre el archivo directamente (lo normal) nunca ve el índice.
3. **Un solo documento de "estado actual"**, enlazado desde `CLAUDE.md`, que
   diga qué está vivo hoy. Ya existe el mecanismo (`121-PENDIENTES-20AGO.md`
   marcado como "el único vigente"), pero tiene 18 días y el proyecto se
   mueve cada semana.
4. **Fijar `gh` al repositorio correcto** y advertirlo en `CLAUDE.md`. Es una
   línea de configuración y evita que una IA razone sobre el proyecto
   equivocado.

## Plan final corregido

**FASE 0 — Marcar la vigencia de los 157 documentos.**
Cabecera de estado en cada archivo (VIGENTE / HISTÓRICO / SUPERADO POR N).
Sin reescribir contenido, sin borrar nada. Es lo único que hoy protege a una
IA de implementar sobre información muerta.

**FASE 1 — Escribir la jerarquía de autoridad de 5 niveles** (la de arriba) en
`CLAUDE.md`, con las dos reglas duras de conflicto. Media página.

**FASE 2 — Inventario de invariantes.** Un documento que liste los seis tests
de arquitectura existentes y qué protege cada uno, más los invariantes que
hoy NO tienen prueba (ownership de citas, idempotencia de
`reschedule`/`cancel`). Ese inventario es la lista de trabajo real.

**FASE 3 — Encender el CI que ya existe.** Ejecutar `deploy.yml` una vez, de
verdad, y hacerlo el único camino a producción. Retira el despliegue manual
por SSH.

**FASE 4 — Dos reglas para IAs** (no nueve pasos):
1. Antes de crear una pieza nueva, demostrar por escrito que no existe una
   extensible (tu regla, la mejor del plan).
2. Ningún cambio entra sin el gate en verde ni sin decir qué documento
   vigente queda afectado.

**FASE 5 — Un solo carril de trabajo, con dos velocidades.**
- *Incidente* (lo normal): diagnóstico con evidencia real → arreglo mínimo →
  prueba que lo habría cazado → gate → documento con causa raíz y reversión.
  Es lo que ya se hace; solo hay que nombrarlo.
- *Obra nueva grande* (lo raro): ahí sí `specs/`, empezando por auditoría del
  código existente.

**FASE 6 (solo cuando haya un segundo desarrollador estable) — Lifecycle de
specs, ramas y revisión por pares.** Hoy sería contabilidad vacía.

## Primera implementación recomendada

**Encender el CI de despliegue que ya existe** (`deploy.yml`, cero
ejecuciones).

Por qué esa y no la documental:

- Es la única acción del plan que **retira riesgo el mismo día**: hoy
  producción se toca a mano por SSH, y esta semana ocurrió tres veces.
- No añade proceso nuevo: **usa lo construido**.
- Es medible en un intento: o el workflow despliega, o no.
- Y es la prueba de fuego del diagnóstico de esta auditoría: si algo tan
  hecho y tan barato lleva meses sin usarse, el problema de Korex no es que
  falte proceso.

Segunda, inmediatamente después: la cabecera de vigencia en los documentos.

## Qué NO debemos hacer

- **No escribir una constitución nueva.** Hay una, con nueve principios. Se
  extiende, no se sustituye.
- **No crear plantillas de ADR.** `docs/korexia/` ya es mejor.
- **No mover la documentación viva a `specs/`.**
- **No crear gates que no sean ejecutables.**
- **No adoptar el lifecycle de siete estados ni el workflow de doce pasos.**
- **No renombrar mecanismos existentes** para que suenen a SDD (el propio
  plan lo prohíbe y conviene repetirlo).
- **No hacer la Fase 0 una sola vez**: sin dueño y sin momento definido, la
  vigencia se degrada en semanas.
- **No dejar `gh` apuntando al upstream.**
- **No empezar por escribir proceso.** Empezar por usar lo que ya está hecho.

## ¿Aguanta este SDD el Korex de dentro de tres años?

**Sí, con dos piezas que hoy no están y que el plan tampoco pide:**

1. **Invariantes con prueba, no con párrafo.** Es lo único que sobrevive a un
   cambio de desarrollador, de IA o de modelo. Los seis tests actuales son la
   semilla correcta; falta cubrir citas y las acciones irreversibles
   restantes.
2. **Un documento de estado vigente que se actualice por obligación del
   propio gate**, no por disciplina. Mientras dependa de que alguien se
   acuerde, se degradará — es exactamente lo que le pasó a `specs/`.

Con múltiples verticales y muchos clientes, lo que escala no es el proceso
documental: es que **la regla importante sea ejecutable**. Un test de
arquitectura protege igual con 3 clientes que con 300, y con una IA que con
diez. Una spec aprobada no protege nada si nadie la lee.

## Decisiones rechazadas en esta auditoría

| Rechazada | Motivo |
|---|---|
| Adoptar las 11 fases como están | Sobrearquitectura: 6 de 11 duplican algo existente |
| Lifecycle de 7 estados | Sin producción de specs que lo justifique |
| Workflow de 12 pasos como flujo principal | Incompatible con el trabajo real (incidentes) |
| Plantilla de ADR nueva | `docs/korexia/` ya lo hace mejor (incluye medición y reversión) |
| Devolver la documentación viva a `specs/` | Dos meses de evidencia dicen lo contrario |
| Empezar por documentación | La primera acción con retorno real es encender el CI existente |
| Tratar el plan como una adopción nueva | Es una **re**adopción; ignorar el fracaso previo repetiría el resultado |

---

**ARCHIVOS DE CÓDIGO MODIFICADOS: NINGUNO**
**COMMIT: NINGUNO**
**DEPLOY: NINGUNO**
