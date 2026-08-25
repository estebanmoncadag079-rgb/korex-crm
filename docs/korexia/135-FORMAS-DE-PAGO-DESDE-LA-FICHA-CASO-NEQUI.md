# Formas de pago de PEDIDOS, resueltas desde la ficha — el caso Nequi

> **Dentro:** El incidente · Por qué no es el mismo bug que el 132 · La
> auditoría contra la propuesta externa de "Orchestrator + Validation
> Engine" · La causa raíz encontrada · Qué se construyó · Aplicado a Lis, con
> un tropiezo y su arreglo · Verificado en vivo · Estado de la flota · Nota
> sobre el modelo · Cómo revertir

**25-ago-2026.**

## El incidente

Captura real de WhatsApp, Lis Pastelería:

> CLIENTE: *te puedo pagar por nequi?*
> AGENTE: *¡Hola! 💗 Por ahora, solo aceptamos pagos por transferencia
> bancaria. Te daremos los datos cuando confirmes tu pedido. 😊*

Nequi, en Colombia, **es** una forma de transferir — el rechazo es
incoherente y le habría costado un cliente a un negocio que sí podía cobrar
esa venta.

## No es el mismo bug que el 132

[132-CONFIRMA-PAGO-SIN-VERIFICAR.md](132-CONFIRMA-PAGO-SIN-VERIFICAR.md)
también involucra la palabra "Nequi", y es fácil confundirlos: ahí el agente
**confirmaba un pago que nadie verificó** (el cliente solo avisó el medio,
y el bot dio el pedido por pagado). Aquí el problema es el opuesto: el
agente **rechaza** un medio de pago válido antes de llegar siquiera a
cobrar. Son dos causas raíz distintas, con dos arreglos distintos.

## La auditoría: ¿cuántas decisiones de negocio se le dejan al modelo?

El dueño propuso revisar la arquitectura con esta pregunta: si el LLM
interpreta de más, ¿cuántas decisiones de negocio todavía se le dejan a él
en vez de resolverlas antes, en el servidor?

Esa misma pregunta ya la había hecho, casi palabra por palabra, una
propuesta externa evaluada por cinco agentes apenas un día antes
([128-COHERENCIA-ARQUITECTURA-PROMPT-MAESTRO.md](128-COHERENCIA-ARQUITECTURA-PROMPT-MAESTRO.md)):
un **Orchestrator** (ya existe: `runAgentTurn`) y un **Validation Engine**
(ya existe: los guardarraíles de `pipeline.ts` y
`contenido-obligatorio.ts`). La auditoría de hoy aplicó ese mismo lente al
caso concreto de Nequi.

Hallazgo: el "Validation Engine" que ya existe **a propósito** solo cubre
literales inconfundibles por forma (enlaces, correos, teléfonos
internacionales — ver
[130](130-ORQUESTADOR-FORMALIZADO-Y-GUARDARRAIL-EXTENDIDO.md)). El caso
Nequi no es "faltó un literal obligatorio": es una interpretación semántica
de una regla de negocio, y ese tipo de error queda fuera del alcance que el
propio 130 se puso — no hay nada ahí que lo pudiera atrapar.

## La causa raíz

En el vertical de **citas**, el pago de un negocio ya se lee fresco desde
`ficha.pago` en cada turno, con instrucción de "cópialo tal cual, no lo
interpretes" (`pagoDeCitasParaElPrompt`,
[107-PAGO-ANTES-DE-LA-CITA.md](107-PAGO-ANTES-DE-LA-CITA.md)) — el mismo
principio que ya usa el horario (`estadoDelNegocio`), y por el mismo motivo:
"el modelo interpreta mal las fechas relativas" nunca fue el problema real,
era que le faltaba el dato resuelto.

En el vertical de **pedidos** (La Churra, Lis), ese mismo dato — `ficha.pago`
— existe en el CRM desde siempre, pero **nunca se inyectaba al prompt de esa
forma**: se "horneaba" una sola vez, como texto libre, dentro de
`instructions`, mezclado con decenas de reglas de tono. El modelo tenía que
interpretar esa prosa ante cualquier variante de pregunta, sin ningún dato
estructurado de apoyo.

Confirmado en vivo contra los tres negocios: los tres describían su
política de pago como una frase de texto libre distinta entre sí (La Churra
acepta efectivo con matices, Lashes Valen solo Nequi, Lis solo transferencia
sin mencionar sinónimos) — sin ningún control cruzado que pudiera detectar
una redacción ambigua o incoherente.

## Qué se construyó

Mismo patrón que `catalog_source` (Fase 1, 15-ago-2026): un interruptor
nuevo, apagado por defecto, que se enciende cliente por cliente.

- **`payment_source`** en `agent_profile` (migración
  `0028_formas_de_pago_estructuradas.sql`): `'prompt'` (comportamiento de
  siempre) o `'ficha'` (el pago se lee fresco desde `ficha.pago` en cada
  turno, como ya hace citas).
- **`pagoDePedidosParaElPrompt`** (`src/server/ai/prompts.ts`): arma una
  sección aparte con las formas de pago del CRM como **única fuente**, y
  prohíbe el rechazo categórico ante un método no nombrado explícitamente —
  el modelo no puede inventar que Nequi cuenta si el negocio no lo declaró,
  pero tampoco puede negarlo de plano: tiene que decir que lo confirma.
- **`scripts/migrar-pago.ts`** (`pnpm migrar:pago <orgId> [--aplicar]`):
  mismo patrón que `migrar-catalogo.ts`. Exige `ficha.pago.formas` no vacío
  antes de encender el flag, y quita de `instructions` el bloque de pago que
  quedaría duplicado — mismo problema que ya tuvo el catálogo de Lis
  ([115](115-LIS-POR-SECCIONES-Y-EL-CATALOGO-DUPLICADO.md)).

982 pruebas, 0 fallos. `tsc --noEmit` limpio.

## Aplicado a Lis, con un tropiezo real por el camino

Al declarar de nuevo las formas de pago desde el CRM, el texto quedó dos
veces con el mismo defecto de redacción — primero en `instructions`
("*No se recibe efectivo, bancolombia,nequi o llave*", leído literal: niega
justo lo que se quería aceptar), después en `ficha.negocio.pago.formas`
(la ficha real de Lis usa el formato **por secciones** del 20-ago, así que
el dato vive en `ficha.negocio.pago`, no en `ficha.pago` — `leerFicha()` ya
lo normaliza, sin que hiciera falta tocar el pipeline). Se corrigió a:
*"Transferencia bancaria — incluye Bancolombia, Nequi y pago por llave. No
se recibe efectivo (los domicilios van por Yango)."*

La escritura directa a la base de datos de producción quedó bloqueada por
el propio entorno de ejecución (correcto: es una escritura sobre datos
reales de un cliente) — la corrección del texto la aplicó el dueño desde el
CRM, y `migrar:pago --aplicar` lo corrió también el dueño, no el asistente.

## Verificado en vivo

Conversación real contra el pipeline de producción (`is_test`, nunca toca
WhatsApp), repitiendo el incidente original:

| | Antes | Después |
|---|---|---|
| *"te puedo pagar por nequi?"* | *"solo aceptamos pagos por transferencia bancaria"* | *"Sí, claro que sí. Puedes pagar por Nequi, Bancolombia o por llave. Te daré los datos una vez que confirmes todo tu pedido."* |

## Estado de la flota

| Negocio | `payment_source` |
|---|---|
| La Churra | `prompt` (sin cambios) |
| Lashes Valen | `prompt` (sin cambios; su pago de citas ya usa el mecanismo equivalente desde antes) |
| **Lis Pastelería** | **`ficha`** ✅ |

## Nota: se probó cambiar de modelo antes de encontrar esta causa

Antes de la auditoría de arquitectura, se corrió el banco de 24 escenarios
del Laboratorio contra Lis con GPT-5 Mini como candidato a reemplazar
`google/gemini-2.5-flash`. Resultado: **6 fallas de 24 contra 3 del modelo
actual** (5 reales, descontando un falso positivo del propio banco de
pruebas), incluida una regla de negocio explícita rota (prometió entregar
dentro de un apartamento) que el modelo actual sí cumplía, y 5-7× más lento
por turno (12-17 s vs 2-3 s) por ser un modelo de razonamiento. Se descartó.
La lección: cambiar de modelo no ataca la causa cuando el problema es que
al modelo —cualquiera— le falta el dato, no el criterio.

## Cómo revertir

```
pnpm migrar:pago org_lispasteleria0001 --apagar
```

Vuelve `payment_source` a `'prompt'`. El texto de `instructions` **no se
restaura solo** — el texto anterior a la limpieza quedó impreso en la
consola de esa corrida (no en una tabla de respaldo), así que si hace falta
reponerlo hay que tomarlo de ahí o rehacerlo a mano.
