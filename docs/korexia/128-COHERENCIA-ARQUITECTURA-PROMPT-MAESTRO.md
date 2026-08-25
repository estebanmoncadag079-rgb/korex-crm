# Coherencia de la arquitectura frente al "prompt maestro" externo

> **Dentro:** Qué proponía la propuesta externa y qué de eso ya existía · Por
> qué el scope de esta ronda (A, B, C) no viola ninguna regla vigente · Qué
> queda pospuesto y con qué razón · La hoja de ruta para las rondas futuras ·
> Los pendientes de esta ronda (129, 130, 131)
>
> **24-ago-2026.** Documento de coherencia, no de cambios de código. Cierra la
> revisión que hicieron cinco agentes de una propuesta externa contra el repo
> real, y fija por escrito qué se hace en esta ronda y qué NO, para que quien
> retome no reabra lo ya decidido.

> ⚠️ **Aviso de nombres.** Aquí hay dos cosas que se llaman "prompt maestro" y
> no son la misma. Una es [`REGLAS-DE-ARQUITECTURA.md`](../../REGLAS-DE-ARQUITECTURA.md)
> —el documento de gobierno del dueño, que se titula literalmente "Prompt
> maestro para proteger la arquitectura de VOCERO"—. La otra es la **propuesta
> de un colaborador externo**: un prompt de 54 secciones para evolucionar la
> arquitectura hacia Orchestrator + Flow Engine + Validation Engine +
> BehaviorRules editables desde el CRM + campañas de remarketing. En este
> documento, "el prompt maestro externo" o "la propuesta externa" es SIEMPRE la
> segunda. Cuando cito las reglas del dueño digo "las reglas de arquitectura".

---

## Qué proponía la propuesta externa, y qué de eso ya existía

La propuesta externa pedía construir cinco piezas: un **Orchestrator** que
coordine el turno del agente, un **Validation Engine** que garantice por código
lo que el modelo no cumple solo, un **Flow Engine** genérico para describir el
flujo conversacional como datos, unas **BehaviorRules** editables desde el CRM
que cambien la conducta del agente sin tocar código, y **campañas de
remarketing** masivo por WhatsApp. Cinco agentes auditaron cada pieza contra el
código real. El resultado corto: **dos de las cinco ya existen con otro nombre,
una está prohibida por decisión ya tomada, y dos son trabajo real que aún no se
justifica.**

El **Orchestrator ya existe**: es `runAgentTurn` en
[`src/server/ai/pipeline.ts`](../../src/server/ai/pipeline.ts). Es la función
que arma el contexto, llama al modelo, aplica los guardarraíles y decide la
salida del turno. El **Validation Engine también existe**: son los 7-9
guardarraíles que comprueban el hecho en el servidor cuando el prompt no basta,
repartidos entre `pipeline.ts`,
[`src/server/ai/anuncio-de-cierre.ts`](../../src/server/ai/anuncio-de-cierre.ts)
y [`src/server/ai/contenido-obligatorio.ts`](../../src/server/ai/contenido-obligatorio.ts),
y documentados en [38-GUARDARRAILES.md](38-GUARDARRAILES.md) y
[125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md).
El séptimo guardarraíl (`contenido-obligatorio.ts`) ya es **genérico y
data-driven**: lee `kb_entry` y `reglasPropias` del CRM y fuerza el contenido
sin una sola palabra de "catálogo" ni de ningún sector — pero **a propósito**
solo cubre literales verificables (enlaces), porque un enlace o está exacto en
la respuesta o no está, y una frase de tono no tiene literal que comprobar sin
otra llamada no determinista al modelo ([125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md)).
El **multi-tenant por `organizationId`** que la propuesta daba por construir ya
es sólido: FKs compuestas, sin huecos.

Lo que la propuesta pedía y **no existe** es un **Flow Engine** genérico y unas
**BehaviorRules** libres — y el dueño ya decidió **explícitamente NO
construirlos todavía**: [112-PLAN-ALINEAR-LA-FLOTA.md](112-PLAN-ALINEAR-LA-FLOTA.md)
y la deuda viva de [121-PENDIENTES-20AGO.md](121-PENDIENTES-20AGO.md) dejan
escrito *"esperar a un tercer vertical antes de generalizar: con dos casos no se
sabe qué se está generalizando"*, y [66-REGLAS-FASE-2.md](66-REGLAS-FASE-2.md)
prohíbe tocar el flujo conversacional y usar enums cerrados de estado. Las
**plantillas de WhatsApp** están a ~60%: existen, pero falta capturar el
`wabaId` real de los clientes con cuenta propia de YCloud —hoy usan un `wabaId`
falso tipo `ycloud:<numero>` y `createTemplate` falla contra Graph API para
ellos ([29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md),
"Qué falta en el CRM")— y falta soporte de botones y variables múltiples. Las
**campañas de remarketing masivo** están al 0% y **no se recomienda
construirlas todavía**: falta infraestructura de calidad de número y opt-out, y
no antes de que las plantillas estén completas ni de tener más clientes que
justifiquen el caso de uso.

### Resumen: las cinco piezas de la propuesta

| Pieza propuesta | Estado real | Dónde |
|---|---|---|
| Orchestrator | ✅ **Ya existe** como `runAgentTurn` | `src/server/ai/pipeline.ts` |
| Validation Engine | ✅ **Ya existe**: 7-9 guardarraíles, el 7º ya data-driven | `pipeline.ts`, `anuncio-de-cierre.ts`, `contenido-obligatorio.ts` · docs [38](38-GUARDARRAILES.md), [125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md) |
| Multi-tenant por `organizationId` | ✅ **Ya sólido**: FKs compuestas, sin huecos | esquema |
| Flow Engine / BehaviorRules libres | ⛔ **No existe, y NO se construye aún** por decisión tomada | [112](112-PLAN-ALINEAR-LA-FLOTA.md), [121](121-PENDIENTES-20AGO.md), [66](66-REGLAS-FASE-2.md) |
| Plantillas de WhatsApp | 🟡 ~60%: falta el `wabaId` real y botones/variables | [29](29-RECORDATORIOS-Y-PLANTILLAS.md) |
| Campañas de remarketing masivo | ⬜ 0%, y **NO se construyen aún** | este doc, hoja de ruta |

---

## El scope de esta ronda: A, B, C — y por qué no viola ninguna regla

La ronda aprobada por el dueño ejecuta **tres tareas acotadas en paralelo**, y
deja fuera **explícitamente** Flow Engine, BehaviorRules libres y campañas:

| | Tarea | Quién | Doc |
|---|---|---|---|
| **A** | Formalizar/documentar que Orchestrator + Validation Engine ya existen | (esta tarea) | **128** (este) |
| **B** | Cerrar el hueco del `wabaId` real en plantillas | `experto-bd` audita → `dev-bots-whatsapp` implementa | **129** |
| **C** | Extender el patrón del guardarraíl 7 a más **reglas literales verificables** definidas desde el CRM, sin tocar flujo/estado | `programador-senior` | **130** |

Ninguna de las tres toca el núcleo con un concepto de negocio, ninguna cambia
cómo conversa el agente, y ninguna intenta construir "todas las fases a la vez".
Verificación regla por regla:

**A — solo documentación.** No toca código. No hay nada que clasificar en el
árbol de [`REGLAS-DE-ARQUITECTURA.md`](../../REGLAS-DE-ARQUITECTURA.md) porque no
modifica la plataforma: escribe lo que ya es cierto.

**B — capacidad global del CRM, ya empezada.** Capturar el `wabaId` real de un
cliente con cuenta propia de YCloud es un **dato de configuración** que hoy no
se guarda ([29](29-RECORDATORIOS-Y-PLANTILLAS.md)). Sirve a **cualquier**
negocio que agende con antelación (la regla 5 de arquitectura: *"¿puede
utilizarlo cualquier negocio sin modificar el núcleo?"* → sí). No mete ningún
concepto de sector en el núcleo: una plantilla es infraestructura de WhatsApp,
no una salsa ni una pestaña. Clasificación: **capacidad global del CRM**, y ya
existía a medias — se completa, no se inventa.

**C — la misma capacidad del guardarraíl 7, extendida.** El guardarraíl de
contenido obligatorio ya es genérico y lee del CRM
([125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md)). Extender su patrón
a **más reglas literales verificables** (siempre literales — enlaces, teléfonos,
llaves de pago; nunca frases de tono ni prohibiciones que no tengan un literal
que comprobar) es más de lo mismo, para toda la flota. **Respeta el límite que
el propio 125 se puso**: no verifica lo que no se puede verificar por código sin
otra llamada no determinista al modelo. Y **no toca el flujo ni el estado** — es
la línea roja que separa a C del Flow Engine.

Contra las reglas que más fácil se rompen:

| Regla | Fuente | ¿La respeta esta ronda? |
|---|---|---|
| No tocar el flujo conversacional | [66](66-REGLAS-FASE-2.md), regla 12 | ✅ Ninguna de A/B/C cambia `saludar → opciones → datos → resumen → cobrar` |
| Prohibido `enum` cerrado para el estado | [66](66-REGLAS-FASE-2.md), regla 4 | ✅ Nadie toca `conversation_state` ni su forma |
| El LLM nunca es dueño del estado | [66](66-REGLAS-FASE-2.md), regla 2 | ✅ C solo comprueba literales en el servidor, no le da el estado al modelo |
| Implementar solo el mínimo código de la siguiente fase; no rediseñar | [66](66-REGLAS-FASE-2.md), instrucción final | ✅ Se hacen 3 tareas acotadas; Flow Engine/campañas quedan fuera **a propósito** |
| El núcleo no conoce conceptos de negocio | [REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md), principio 1 | ✅ B es infraestructura de WhatsApp; C lee reglas del CRM, no las codifica |
| Toda regla específica vive en el CRM, no en el código | [REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md), principios 2 y 3 | ✅ C es precisamente eso: la regla la escribe el dueño en el CRM |

> 🔑 La instrucción final de [66](66-REGLAS-FASE-2.md) es la que más pesa aquí:
> *"No propongas rediseños. No optimices prematuramente. No cambies la
> arquitectura existente. Implementa únicamente la mínima cantidad de código
> necesaria para completar la siguiente fase."* La propuesta externa pedía las
> cinco piezas a la vez; esta ronda hace tres cosas pequeñas y verificables, y
> **eso es justo lo contrario de "implementar todas las fases simultáneamente".**

---

## Qué queda pospuesto, y con qué razón

No es "no", es "todavía no", y cada aplazamiento tiene su condición de salida:

| Pospuesto | Razón | Qué lo desbloquea |
|---|---|---|
| **Flow Engine genérico** (flujo como datos) | Con dos verticales no se sabe qué se está generalizando; la regla 12 de [66](66-REGLAS-FASE-2.md) prohíbe tocar el flujo, y hoy tres ramas de vertical *"son solo vocabulario"* ([121](121-PENDIENTES-20AGO.md), deuda viva) | **Un tercer vertical real** que enseñe qué varía de verdad |
| **BehaviorRules libres** (cambiar conducta desde el CRM sin límite) | La conducta común vive en `conducta.ts` y NO se edita cliente por cliente a propósito ([61](61-UNA-SOLA-PUERTA.md)); una regla libre que el modelo interpreta es texto, no garantía. El único patrón seguro hoy es el literal verificable (C) | Un mecanismo que verifique por código lo que la regla promete, no solo lo declare |
| **Campañas de remarketing masivo** | Falta infraestructura de **calidad de número y opt-out** (mandar masivo sin ella quema el número), y no antes de que las plantillas estén completas ni de tener más clientes que lo justifiquen | Plantillas completas (B + botones/variables) **+** opt-out **+** volumen de clientes que lo pida |

---

## Hoja de ruta para las rondas futuras

En el mismo espíritu de [112-PLAN-ALINEAR-LA-FLOTA.md](112-PLAN-ALINEAR-LA-FLOTA.md):
ordenado por riesgo, una cosa por vez, y nada que no tenga una razón medible
para existir. **Esto es orientación, no compromiso** — cada punto entra solo tras
su clasificación en [`REGLAS-DE-ARQUITECTURA.md`](../../REGLAS-DE-ARQUITECTURA.md).

1. **Completar las plantillas de WhatsApp** (después de B). Botones y variables
   múltiples; **enviar el recordatorio por plantilla cuando la ventana de 24 h
   esté cerrada** (hoy `remind` y la cascada solo intentan texto libre y
   reportan el fallo); y por último **automatizar el recordatorio 24 h antes**,
   que solo tiene sentido con lo anterior hecho
   ([29](29-RECORDATORIOS-Y-PLANTILLAS.md), "Qué falta en el CRM", puntos 2 y 3).
   Riesgo bajo, valor directo para el vertical de citas.

2. **Editor seguro de reglas literales verificables desde el CRM** (evolución de
   C). Que el dueño declare desde una pantalla qué literal es obligatorio ante
   qué disparador, sin tocar código — pero **solo literales**, manteniendo la
   línea del [125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md): nada que
   no se pueda comprobar por código de forma determinista. Es el techo honesto
   de las "BehaviorRules" sin caer en el Flow Engine.

3. **Infraestructura de calidad de número y opt-out.** Prerrequisito **duro** de
   cualquier campaña: registro de opt-out por contacto, respeto del "no me
   escribas más", y vigilancia de la calidad del número en Meta. Sin esto, una
   campaña quema el número del cliente. Se construye **antes** que las campañas,
   no con ellas.

4. **Campañas de remarketing masivo.** Solo cuando 1 y 3 estén hechos y haya
   clientes que lo pidan. Categoría de plantilla MARKETING (15× más cara que
   UTILITY — [29](29-RECORDATORIOS-Y-PLANTILLAS.md)), así que además hay que
   medir que el caso de uso paga su costo.

5. **Flow Engine / generalización del vertical.** El último, y bloqueado por el
   tercer vertical real ([121](121-PENDIENTES-20AGO.md), deuda viva). Hasta que
   exista, generalizar es adivinar.

---

## PENDIENTES DE ESTA RONDA

Esta ronda ejecuta A, B y C en paralelo. **A** queda cerrado con este documento
(128). Lo demás quedará en los tres documentos siguientes — se reservan los
números aquí para que quien retome sepa exactamente dónde mirar, aunque el
contenido lo escriben sus autores:

| Doc | Tarea | Autor | Qué contendrá |
|---|---|---|---|
| **128** | A — coherencia arquitectura vs. propuesta externa | (este) | ✅ Este documento |
| **129** | B — el `wabaId` real en plantillas | `experto-bd` (audita el dato) → `dev-bots-whatsapp` (implementa) | Dónde llega el `wabaId` real en el webhook / `GET /v2/whatsapp/phoneNumbers`, dónde guardarlo para clientes con cuenta propia de YCloud, y `createTemplate` yendo por la API de YCloud (`POST /v2/whatsapp/templates`) en vez de por Graph con el `ycloud:<numero>` falso. Base: [29](29-RECORDATORIOS-Y-PLANTILLAS.md), "Qué falta en el CRM", punto 1 |
| **130** | C — extender el patrón del guardarraíl 7 | `programador-senior` | Qué reglas literales verificables adicionales se cubren (siempre literales: enlaces, teléfonos, llaves de pago), cómo se leen del CRM sin campo nuevo, la medición antes/después con el pipeline real, y la confirmación de que **no se tocó flujo ni estado**. Base: [125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md), [38](38-GUARDARRAILES.md) |
| **131** | El cierre de la ronda | el agente que sigue | Reservado: la verificación **dentro del contenedor** del despliegue de B y C (regla infalible: un contenedor `healthy` NO prueba que lleve el cambio — [02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md)), y la bitácora de qué entró y qué NO |

> ⚠️ **El [00-INDICE.md](00-INDICE.md) NO se toca en esta ronda por cada agente
> por separado.** Lo actualiza el dueño al final con las entradas 128-131 juntas,
> para que varios procesos en paralelo no se pisen el mismo archivo. Si estás
> leyendo esto y 129/130/131 aún no existen, es porque sus procesos siguen
> corriendo o aún no arrancaron — no es que se hayan perdido.
