# 005 — GPT-5 Mini principal + Gemini salvavidas de cierre

**Estado:** implementado, sin desplegar — **v2, alcance ampliado a citas**
**Rama:** `004-separacion-conversacion-transcripcion` (continúa sobre la 004)
**Fecha:** 21-sep-2026 (mañana: v1 solo pedidos · tarde: v2, +citas)
**Excepción arquitectónica:** ver
[docs/korexia/189](../../docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md)
(y su Adenda) — decisión del dueño, con el choque contra
[doc 156](../../docs/korexia/156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX.md)
documentado explícitamente, no resuelto por cuenta propia.

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
[TODOS los guardarraíles existentes, sin tocar — 9 mecanismos, ver doc 156 §2.1]
   ↓
intentarRescatarTurno():
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
| Lashes Valen (`catalog_source='prompt'`) | Sin `state_source=backend`, no hay `estadoGuardado` que consultar. El detector no puede activarse ahí por construcción. |
| Cualquier otra acción del contrato (`send_image`, `move_stage`, `consult_availability`, etc.) | O ya degradan con gracia (Tipo 1, doc 156 §10), o tienen precondiciones deterministas ANTES del turno (Tipo 2) — ninguna necesita este mecanismo. |

## Archivos

| Archivo | Qué |
|---|---|
| `src/server/ai/recuperacion-de-turno.ts` | detector + orquestación para AMBOS dominios, motor `juicioYRedaccion` compartido, punto de entrada único `intentarRescatarTurno` |
| `src/lib/ai/modelos.ts` | `modeloDeRescate()` — mismo `OPENROUTER_FALLBACK_MODEL` que ya usa la cadena de salvavidas técnica |
| `src/server/ai/pipeline.ts` | el enganche: una sola llamada a `intentarRescatarTurno`, envuelta en `try/catch` |
| `src/server/appointments/policy.ts` | **sin tocar** — `puedeConfirmarCita` se reutiliza tal cual |
| `docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md` | la excepción + su Adenda de ampliación a citas |
| `tests/unit/recuperacion-de-turno.test.ts` | 29 pruebas: detector y orquestación de AMBOS dominios, el punto de entrada único, y la reproducción de los 6 casos medidos |
| `tests/unit/salvavidas-de-cierre-alcance.test.ts` | 10 pruebas de ALCANCE, actualizadas para verificar que pipeline.ts usa el punto de entrada único y que reschedule/cancel siguen fuera |
| `tests/unit/modelos-seguridad-y-multitenant.test.ts` | 4 pruebas — el módulo no filtra secretos ni discrimina por organización |

## Garantías de diseño, y cómo se prueban

| Garantía | Cómo se cumple | Prueba |
|---|---|---|
| Gemini no inventa datos comerciales | Montos, fecha, hora y servicio SIEMPRE salen de `estadoGuardado` | inyecta un modelo que MIENTE con cifras/fecha propias en AMBOS dominios — se ignoran |
| Máximo un fallback lógico por turno | `intentarRescatarTurno` prueba pedido, y solo si no aplica, cita — nunca las dos; cada rescate hace como mucho 2 llamadas | "hay un ÚNICO punto de entrada" + "máximo dos llamadas a chatJson en TODO el archivo" |
| Handoff legítimo no dispara nada | Los dos detectores exigen `estadoGuardado` completo antes de llamar a nada | 14 de los 15 casos de detector (7 por dominio) cubren los caminos que deben dar `false` |
| El backend sigue siendo la autoridad | Cero líneas nuevas en `orders/estado.ts`, `orders/policy.ts`, `appointments/policy.ts`, `catalog/`, los switches de ejecución | grep de diff — 0 cambios en esos archivos |
| Un fallo del mecanismo no tumba el turno | Todo el bloque en pipeline.ts va en `try/catch` | 10 pruebas preexistentes sin `OPENROUTER_*` en su entorno lo ejercitaron y pasan |
| Nunca un mensaje vacío al cliente | Si Gemini y GPT fallan ambos en la redacción, el respaldo final es el resumen determinista (nunca un modelo) | "si la redacción falla, usa un respaldo determinista — nunca un mensaje vacío" |
| Rollback sin código ni dato | `OPENROUTER_FALLBACK_MODEL` vacía apaga TODO el mecanismo (ambos dominios) | "sin OPENROUTER_FALLBACK_MODEL, el mecanismo entero queda apagado" |

## Observabilidad

- **Traza**: el evento `salvavidas_de_cierre` en `guardarrailes=`, igual que
  antes — ahora el log distingue `objetivo=pedido` / `objetivo=cita`.
- **Log**: `[rescate] <id>: objetivo=<pedido|cita>, acción original="X", salvavidas=<motivo> (<modelo>)`.
- **Costo**: cada llamada pasa por `chatJson` → `usage_event`, distinguible
  por `detail` (modelo real), sin cambios de esquema.

## Gate (v2, después de la ampliación)

```
typecheck            OK
lint                 0 avisos
suite                — a confirmar en este mismo ciclo
build                — a confirmar en este mismo ciclo
auditar:arquitectura — a confirmar en este mismo ciclo (pedido explícito)
árbol                limpio salvo lo listado arriba
```

## Rollback

Una variable: vaciar `OPENROUTER_FALLBACK_MODEL`. `modeloDeRescate()` pasa a
devolver `undefined`, `intentarRescatarTurno` devuelve `null` de inmediato
para AMBOS dominios sin llamar a ningún proveedor, y el turno se comporta
exactamente como si este spec no existiera. Sin migración, sin dato tocado,
sin ficha modificada.
