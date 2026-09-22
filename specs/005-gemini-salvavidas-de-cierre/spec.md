# 005 — GPT-5 Mini principal + Gemini salvavidas de cierre

**Estado:** implementado, sin desplegar — **v4, con deliveryFeeCents resuelto**
**Rama:** `004-separacion-conversacion-transcripcion` (continúa sobre la 004)
**Fecha:** 21-sep-2026 (mañana: v1 solo pedidos · tarde: v2 +citas · noche: v3 correcciones de auditoría · noche: v4 deliveryFeeCents)
**Excepción arquitectónica:** ver
[docs/korexia/189](../../docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md)
(y sus Adendas) — decisión del dueño, con el choque contra
[doc 156](../../docs/korexia/156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX.md)
documentado explícitamente, no resuelto por cuenta propia.

## Corrección tras auditoría independiente (v3)

Una auditoría independiente del commit `26bf657` (v2) concluyó **REQUIERE
CORRECCIÓN**, con tres hallazgos reales verificados contra el código y
contra producción. Los tres se corrigieron aquí, sin ampliar el mecanismo
más allá de lo ya descrito y sin tocar doc 156:

1. **La acción rescatada no pasaba por `inconsistenciaFinancieraDePedido` ni
   por `bloqueDeDomicilioPendiente`** — vivían antes del punto donde el
   rescate convertía la acción, así que nunca la veían. Corregido moviendo
   el enganche a ANTES del primer `if (action.action === "notify_order")`
   del pipeline, sin duplicar ningún guardarraíl.
2. **`OPENROUTER_FALLBACK_MODEL` compartía responsabilidad** con más de 30
   llamadas ajenas (guardarraíles reactivos, `aprendizaje.ts`,
   `lab/judge.ts`). Corregido con una variable propia,
   `OPENROUTER_RECOVERY_MODEL`, sin caída automática entre las dos.
3. **Esta misma documentación afirmaba que Lashes Valen estaba fuera** de
   alcance por falta de `state_source=backend`. Es falso — Lashes Valen sí
   lo tiene (es el valor aprobado para `citas`), y el salvavidas de citas sí
   puede activarse ahí. Corregido en las tablas de abajo y en doc 189.

Detalle completo de cada corrección en la tercera Adenda de doc 189.

## Corrección funcional: `deliveryFeeCents` (v4)

El hallazgo 1 de la corrección v3 dejó anotado, sin resolver a propósito
(fuera del alcance de esa corrección), que el rescate de PEDIDO no poblaba
`deliveryFeeCents` — un domicilio ya verificado con tarifa distinta de cero
no se reflejaba en los montos estructurados del cierre rescatado. El dueño
pidió corregirlo antes de deploy, no solo dejarlo documentado.

**De dónde sale `deliveryFeeCents` en un cierre NORMAL** (investigado, no
supuesto): ni siquiera un cierre propuesto por GPT lo CALCULA — GPT lo
escribe en su JSON, y `inconsistenciaFinancieraDePedido`
(`anuncio-de-cierre.ts`) lo VALIDA contra `entregaPersistida` (variable de
`pipeline.ts`, que lee `EstadoDelPedido.entrega` — verificado por
`consultar_domicilio` y persistido entre turnos, independiente de
`state_source`). Si no coincide, el pipeline reintenta con GPT hasta que
coincide o deriva. La autoridad nunca fue "quién calcula", sino "contra qué
se valida" — y esa fuente es `entregaPersistida`.

**Cómo quedó reutilizada esa misma autoridad en el rescate**: como el
rescate no tiene ninguna cifra de GPT que validar (GPT nunca propuso
`notify_order`), se construye directamente desde `entregaPersistida` — la
MISMA variable, pasada tal cual desde `pipeline.ts` — con una función nueva,
`cifrasNumericasDelCierre` (`anuncio-de-cierre.ts`), extraída de
`bloqueDeCifrasVerificadas` (que hasta ahora solo producía texto) para que
las dos compartan una única aritmética. Nunca Gemini, nunca texto libre,
nunca hardcodeado.

| Caso | `deliveryFeeCents` | `totalCents` |
|---|---|---|
| Sin domicilio / modalidad sin resolver | `null` | `subtotalCents` |
| Recogida en el local | `null` | `subtotalCents` |
| Domicilio con tarifa verificada (incluida `$0`) | la tarifa | `subtotalCents + tarifa` |
| Domicilio pendiente de verificar | `null` — **nunca inventada** | `subtotalCents` |

El último caso replica el comportamiento de un cierre normal con domicilio
pendiente (`bloqueDeDomicilioPendiente`: no bloquea el cierre, solo aclara
que el domicilio se confirma aparte) — nunca asume `$0` ni ninguna otra
cifra.

**Citas, verificado explícitamente**: `book_appointment` no tiene ningún
campo de precio/tarifa en su contrato (`servicios`, `fecha`, `hora`,
`especialista?`, `farewell?` — nada más). El rescate de cita ya poblaba los
cuatro campos relevantes desde antes de esta corrección; no había un vacío
estructural equivalente que resolver.

## Objetivo

`openai/gpt-5-mini` como modelo conversacional principal (ahorro de costo).
Medido contra las mismas 325 entradas que `google/gemini-3.7-flash`, cerró
**0 de 6** pedidos donde el cliente confirmó con una frase coloquial. El
dueño pidió generalizar el salvavidas a los cuatro casos de la arquitectura
—no solo `notify_order`— con la decisión de arquitectura ya tomada, sin
volver a medir antes de implementar.

## Arquitectura implementada (v2)

```
CLIENTE
   ↓
GPT-5 Mini (principal) — interpreta, decide acción, redacta
   ↓
[guardarraíles que NO dependen del cierre — disponibilidad, producto,
 domicilio contradicho — sin tocar]
   ↓
intentarRescatarTurno():                              ← reubicado en v3
   ¿pedido backend-completo Y acción != notify_order?
      SÍ → intenta rescate de PEDIDO (puedeConfirmarPedido)
      NO → ¿cita backend-completa Y acción != book_appointment?
              SÍ → intenta rescate de CITA (puedeConfirmarCita)
              NO → null, no hay nada que rescatar
   │
   └─ (como mucho UNA de las dos ramas se ejecuta)
        ↓
     Gemini 3.8 Flash — UNA pregunta: ¿esto es la acción de cierre?
        │
       NO / falla ──────────────────► sigue con la acción original de GPT
        │
       SÍ
        ↓
     GPT-5 Mini redacta summary/farewell (o Gemini, si esa llamada falla;
     si ambas fallan, un resumen determinista del backend — nunca vacío)
        ↓
[guardarraíles DEL CIERRE — inconsistenciaFinancieraDePedido,             ← en v3, ahora SÍ
 bloqueDeDomicilioPendiente, "pedido ya confirmado", requisitos              ven la acción
 de cierre, "el cliente vio el resumen" — mismo código, sin tocar]           rescatada
   ↓
BACKEND (puedeConfirmarPedido+ejecutarConfirmacionDePedido, o
         puedeConfirmarCita+el switch de citas — SIN TOCAR NINGUNO)
   ↓
RESPUESTA
```

Audio: sin cambios respecto a la rama 004 — sigue yendo a
`OPENROUTER_TRANSCRIPTION_MODEL` (Gemini), nunca al conversacional.

## Los cuatro casos de la arquitectura, y qué los cubre exactamente

El dueño pidió cubrir cuatro categorías. En este código son la MISMA
condición —hoja backend-completa, acción de cierre no elegida— aplicada a
dos acciones, no cuatro detectores independientes (eso sí sería inventar
cuatro heurísticas sin respaldo, lo que la tarea prohíbe explícitamente).

| # | Caso pedido | Cubierto | Cómo |
|---|---|---|---|
| 1 | GPT no logra resolver una intención conocida | ✅ para pedidos y citas | la intención "confirmar" es exactamente lo que el detector reconoce vía backend |
| 2 | GPT produce un handoff evitable | ✅ para pedidos y citas | un `handoff` con hoja backend-completa detrás dispara el rescate |
| 3 | GPT no identifica una acción ejecutable | ✅ para `notify_order`/`book_appointment` | son las dos únicas acciones con una Policy de "¿está listo?" que invertir |
| 4 | Falla en un cierre que el backend puede validar | ✅ pedidos (`puedeConfirmarPedido`) y citas (`puedeConfirmarCita`) | reutiliza ambas Policies sin modificarlas |

**Cobertura real, con nombre y apellido:**

| Acción de cierre | Autoridad backend reutilizada | Estado |
|---|---|---|
| `notify_order` (pedidos) | `puedeConfirmarPedido` (`orders/policy.ts`) | cubierto |
| `book_appointment` (citas) | `puedeConfirmarCita` (`appointments/policy.ts`) | cubierto (nuevo en v2) |

**Explícitamente FUERA de alcance — y por qué, con la misma vara:**

| Qué queda fuera | Por qué no se cubre |
|---|---|
| `reschedule_appointment` | Su Policy (doc 156 Fase 3) es de idempotencia, no de "¿está completo?". No hay hecho backend que invertir sin caer en heurística de texto. |
| `cancel_appointment` | Mismo motivo que reschedule. |
| Cualquier handoff sin pedido NI cita backend-completos detrás | Sigue siendo, siempre, un handoff legítimo — el mecanismo no lo toca. |
| Cualquier otra acción del contrato (`send_image`, `move_stage`, `consult_availability`, etc.) | O ya degradan con gracia (Tipo 1, doc 156 §10), o tienen precondiciones deterministas ANTES del turno (Tipo 2) — ninguna necesita este mecanismo. |

**Lashes Valen NO está fuera de alcance** — corrección v3, ver arriba. Tiene
`state_source=backend` (el valor aprobado para `citas`, verificado en
`server/auth/arquitectura.ts` y en la auditoría de arquitectura: 🟢
alineada) y 66 estados reales con `reserva.fecha` poblada. El salvavidas de
citas sí puede activarse ahí. `catalog_source='prompt'` en ese negocio no es
una señal de autoridad ausente: es el valor esperado en `citas`, porque los
servicios viven en `resourceService`/`service`, no en el catálogo de
pedidos.

## Archivos

| Archivo | Qué |
|---|---|
| `src/server/ai/recuperacion-de-turno.ts` | detector + orquestación para AMBOS dominios, motor `juicioYRedaccion` compartido, punto de entrada único `intentarRescatarTurno` |
| `src/lib/env.ts` | **v3** — variable nueva `OPENROUTER_RECOVERY_MODEL`, separada de `OPENROUTER_FALLBACK_MODEL` |
| `src/lib/ai/modelos.ts` | `modeloDeRescate()` — **v3**: lee `OPENROUTER_RECOVERY_MODEL`, propia, sin caer a `OPENROUTER_FALLBACK_MODEL` |
| `src/server/ai/pipeline.ts` | el enganche: una sola llamada a `intentarRescatarTurno`, envuelta en `try/catch` — **v3: reubicado** antes de los guardarraíles del cierre |
| `src/server/appointments/policy.ts` | **sin tocar** — `puedeConfirmarCita` se reutiliza tal cual |
| `src/server/orders/policy.ts` | **sin tocar** |
| `src/server/ai/anuncio-de-cierre.ts` | **v4** — nueva función exportada `cifrasNumericasDelCierre` (la aritmética de `deliveryFeeCents`, extraída para reutilizarla desde el rescate); `bloqueDeCifrasVerificadas` la usa internamente para su rama de domicilio — comportamiento de texto sin cambios, verificado con su suite existente |
| `docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md` | la excepción + Adendas (citas, corrección v3, `deliveryFeeCents` v4) |
| `tests/unit/recuperacion-de-turno.test.ts` | 35 pruebas: detector y orquestación de AMBOS dominios, el punto de entrada único, la separación de variables, `deliveryFeeCents` en sus cinco casos, y la reproducción de los 6 casos medidos |
| `tests/unit/salvavidas-de-cierre-alcance.test.ts` | 15 pruebas de ALCANCE — punto de entrada único, reubicación del enganche, `deliveryFeeCents` reutiliza la autoridad backend, citas sin vacío estructural |
| `tests/unit/cifras-las-escribe-el-backend.test.ts` | **v4** — +14 pruebas: `cifrasNumericasDelCierre` en sus cuatro casos y su coherencia aritmética |
| `tests/unit/modelos-por-papel.test.ts` | **v3** — +6 pruebas: `modeloDeRescate` es independiente del juez, de `aprendizaje` y de la cadena técnica |
| `tests/unit/modelos-seguridad-y-multitenant.test.ts` | 4 pruebas — el módulo no filtra secretos ni discrimina por organización |

## Garantías de diseño, y cómo se prueban

| Garantía | Cómo se cumple | Prueba |
|---|---|---|
| Gemini no inventa datos comerciales | Montos (incluido `deliveryFeeCents`), fecha, hora y servicio SIEMPRE salen de `estadoGuardado`/`entregaPersistida` | inyecta un modelo que MIENTE con cifras/fecha propias en AMBOS dominios — se ignoran |
| **`deliveryFeeCents` sale de la misma autoridad que un cierre normal** | **v4**: `cifrasNumericasDelCierre`, construida desde `entregaPersistida` — nunca inventa una tarifa cuando el domicilio está pendiente | 5 casos: sin domicilio, con tarifa, pendiente, tarifa $0, y coherencia `total = subtotal + fee` |
| Máximo un fallback lógico por turno | `intentarRescatarTurno` prueba pedido, y solo si no aplica, cita — nunca las dos; cada rescate hace como mucho 2 llamadas | "hay un ÚNICO punto de entrada" + "máximo dos llamadas a chatJson en TODO el archivo" |
| Handoff legítimo no dispara nada | Los dos detectores exigen `estadoGuardado` completo antes de llamar a nada | 14 de los 15 casos de detector (7 por dominio) cubren los caminos que deben dar `false` |
| El backend sigue siendo la autoridad | Cero líneas nuevas en `orders/estado.ts`, `orders/policy.ts`, `appointments/policy.ts`, `catalog/`, los switches de ejecución | grep de diff — 0 cambios en esos archivos |
| **La acción rescatada pasa por los MISMOS guardarraíles que un cierre normal** | **v3**: el enganche se reubicó antes de `inconsistenciaFinancieraDePedido`/`bloqueDeDomicilioPendiente`/"pedido ya confirmado" — el mismo código, sin duplicar | verificado leyendo `pipeline.ts` línea por línea; hallazgo de la auditoría independiente, corregido |
| Un fallo del mecanismo no tumba el turno | Todo el bloque en pipeline.ts va en `try/catch` | 10 pruebas preexistentes sin `OPENROUTER_*` en su entorno lo ejercitaron y pasan |
| Nunca un mensaje vacío al cliente | Si Gemini y GPT fallan ambos en la redacción, el respaldo final es el resumen determinista (nunca un modelo) | "si la redacción falla, usa un respaldo determinista — nunca un mensaje vacío" |
| **La variable no comparte responsabilidad con nada más** | **v3**: `OPENROUTER_RECOVERY_MODEL` es propia; `OPENROUTER_FALLBACK_MODEL` no la conoce | grep: `OPENROUTER_RECOVERY_MODEL` solo se lee en `modeloDeRescate()` — verificado, no solo diseñado |
| Rollback sin código ni dato | `OPENROUTER_RECOVERY_MODEL` vacía apaga TODO el mecanismo (ambos dominios), sin tocar el fallback técnico ni el juez ni el aprendizaje | "sin OPENROUTER_RECOVERY_MODEL, el mecanismo entero queda apagado" |

## Observabilidad

- **Traza**: el evento `salvavidas_de_cierre` en `guardarrailes=`, igual que
  antes — ahora el log distingue `objetivo=pedido` / `objetivo=cita`.
- **Log**: `[rescate] <id>: objetivo=<pedido|cita>, acción original="X", salvavidas=<motivo> (<modelo>)`.
- **Costo**: cada llamada pasa por `chatJson` → `usage_event`, distinguible
  por `detail` (modelo real), sin cambios de esquema.

## Gate (v3, después de las tres correcciones)

```
typecheck            OK
lint                 0 avisos
suite                ver informe final de este ciclo
build                ver informe final de este ciclo
auditar:arquitectura ver informe final de este ciclo (pedido explícito)
árbol                limpio salvo lo listado en este spec
```

## Rollback

Una variable: vaciar `OPENROUTER_RECOVERY_MODEL`. `modeloDeRescate()` pasa a
devolver `undefined`, `intentarRescatarTurno` devuelve `null` de inmediato
para AMBOS dominios sin llamar a ningún proveedor, y el turno se comporta
exactamente como si este spec no existiera. `OPENROUTER_FALLBACK_MODEL`
—el fallback técnico, el juez, el aprendizaje— no se ve afectado por este
rollback ni por ningún valor que tome esta variable nueva. Sin migración,
sin dato tocado, sin ficha modificada.
