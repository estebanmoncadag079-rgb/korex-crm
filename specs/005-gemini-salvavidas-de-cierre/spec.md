# 005 — GPT-5 Mini principal + Gemini salvavidas de cierre

**Estado:** implementado, sin desplegar
**Rama:** `004-separacion-conversacion-transcripcion` (continúa sobre la 004)
**Fecha:** 21-sep-2026
**Excepción arquitectónica:** ver
[docs/korexia/189](../../docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md)
— decisión del dueño, con el choque contra
[doc 156](../../docs/korexia/156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX.md)
documentado explícitamente, no resuelto por cuenta propia.

## Objetivo

`openai/gpt-5-mini` como modelo conversacional principal (ahorro de costo,
~$45/mes proyectado). Medido contra las mismas 325 entradas que
`google/gemini-3.7-flash`, cerró **0 de 6** pedidos donde el cliente confirmó
con una frase coloquial. Este spec implementa un salvavidas ACOTADO —no un
segundo modelo conversacional— para recuperar esa categoría específica de
fallo, sin tocar la autoridad del backend.

## Arquitectura implementada

```
CLIENTE
   ↓
GPT-5 Mini (principal) — interpreta, decide acción, redacta
   ↓
[TODOS los guardarraíles existentes, sin tocar — 9 mecanismos, ver doc 156 §2.1]
   ↓
¿pedido backend-completo (state_source=backend) Y acción != notify_order?
   │
  NO ──────────────────────────────► sigue igual que siempre
   │
  SÍ
   ↓
Gemini 3.8 Flash — UNA pregunta: ¿esto es una confirmación?
   │
  NO / falla ──────────────────────► sigue con la acción original de GPT
   │
  SÍ (propone notify_order)
   ↓
GPT-5 Mini redacta summary/farewell (o Gemini, si esa llamada falla)
   ↓
BACKEND (puedeConfirmarPedido + ejecutarConfirmacionDePedido — SIN TOCAR)
   ↓
RESPUESTA
```

Audio: sin cambios respecto a la rama 004 — sigue yendo a
`OPENROUTER_TRANSCRIPTION_MODEL` (Gemini), nunca al conversacional.

## Por qué el detector es acotado, no genérico

La tarea pidió explícitamente **no usar reglas ingenuas** ("si la respuesta
es corta → Gemini"). La única forma de cumplir eso sin inventar una heurística
de texto es no activar el salvavidas para NADA que no tenga una fuente
backend-autoritativa detrás. Hoy esa fuente solo existe para **el cierre de
pedidos** (`notify_order`), vía `puedeConfirmarPedido`
(`orders/policy.ts`) — la misma función que hoy solo se usa para RECHAZAR un
cierre mal disparado, reutilizada aquí sin modificar una línea.

**Deliberadamente fuera de alcance** (documentado, no resuelto):
citas (`book_appointment`/`reschedule`/`cancel` — existe un mecanismo
análogo, `appointment_booking_confirmation`, pero sin evidencia medida de que
GPT-5 Mini falle ahí); cualquier handoff sin una hoja de pedido
backend-verificada detrás; Lashes Valen (`catalog_source='prompt'`, sin señal
backend).

## Archivos

| Archivo | Qué |
|---|---|
| `src/server/ai/recuperacion-de-turno.ts` | **nuevo** — el detector (`accionEvitablementeNoCerrada`) y la orquestación (`intentarRescateDeCierre`) |
| `src/lib/ai/modelos.ts` | `modeloDeRescate()` — mismo `OPENROUTER_FALLBACK_MODEL` que ya usa la cadena de salvavidas técnica, reutilizado |
| `src/server/ai/pipeline.ts` | el enganche: una llamada al detector + rescate, envuelta en `try/catch`, justo antes del bloque existente de `notify_order` |
| `docs/korexia/189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md` | la excepción documentada sobre doc 156 |
| `tests/unit/recuperacion-de-turno.test.ts` | 14 pruebas: detector + orquestación, incluida la reproducción de los 6 casos medidos |
| `tests/unit/salvavidas-de-cierre-alcance.test.ts` | 9 pruebas de ALCANCE — que nadie generalice esto a "cualquier handoff" sin darse cuenta |
| `tests/unit/modelos-seguridad-y-multitenant.test.ts` | +4 pruebas — el módulo nuevo no filtra secretos ni discrimina por organización |

## Garantías de diseño, y cómo se prueban

| Garantía | Cómo se cumple | Prueba |
|---|---|---|
| Gemini no inventa precios | Los montos (`subtotalCents`/`totalCents`) SIEMPRE salen de `estadoGuardado`, nunca se leen de la respuesta de ningún modelo | "los montos... SIEMPRE salen del backend" — inyecta un modelo que MIENTE con cifras propias y verifica que se ignoran |
| Máximo un fallback por turno | Sin recursión ni loop: `intentarRescateDeCierre` hace como mucho 2 llamadas (juicio + redacción), nunca se re-invoca a sí misma | "máximo dos llamadas a chatJson por intento" + "nunca reintenta el rescate una segunda vez dentro del mismo turno" |
| Handoff legítimo no dispara el salvavidas | El detector exige `estadoGuardado` completo (ítems, total, requisitos) — un handoff por falta de datos, o sin catálogo, no cumple la condición | 5 de las 8 pruebas del detector cubren exactamente los caminos que deben dar `false` |
| El backend sigue siendo la autoridad | Cero líneas nuevas en `orders/estado.ts`, `orders/policy.ts` (se REUTILIZA, no se modifica), `catalog/`, el `switch` de ejecución | grep de diff — 0 cambios en esos archivos |
| Un fallo del mecanismo no tumba el turno | Todo el bloque en pipeline.ts va en `try/catch`; un error de red o de configuración deja `action` intacta | descubierto por la propia suite: 10 pruebas existentes con entornos sin `OPENROUTER_*` lo ejercitaron y hoy pasan |
| Rollback sin código ni dato | `OPENROUTER_FALLBACK_MODEL` vacía apaga el mecanismo entero (`modeloDeRescate()` devuelve `undefined`) | "sin OPENROUTER_FALLBACK_MODEL, el mecanismo entero queda apagado" |

## Observabilidad

- **Traza** (`registrarTrazaDelTurno`): el evento `salvavidas_de_cierre`
  aparece en `guardarrailes=` de cada turno, con `corrigio=true/false` —
  mismo mecanismo que los otros 9 guardarraíles del pipeline, sin campo
  nuevo en el esquema.
- **Log**: `[rescate] <conversationId>: acción original="X", salvavidas=<motivo> (<modelo>)`
  — nunca el texto del cliente ni datos personales (probado).
- **Costo**: cada llamada (juicio de Gemini, redacción de GPT si aplica) pasa
  por `chatJson`, así que se registra en `usage_event` como cualquier otra
  — se puede distinguir por `detail` (el modelo real) sin cambios.
- **Pendiente, no implementado en este spec**: contadores agregados
  (`fallback_rate`, `successful_fallbacks` como métrica de panel) — hoy se
  derivan consultando `usage_event`/la traza, no hay una vista nueva. Si el
  volumen lo justifica, es trabajo de panel, no de este mecanismo.

## Gate

```
typecheck            OK
lint                 0 avisos
typecheck:scripts    24 errores preexistentes, 0 míos (verificado por archivo)
suite                2.659 / 2.659  (254 archivos)
build                OK
árbol                limpio
```

## Lo que NO se ejecutó, y por qué

- **`probar:escenarios`/`probar:agente` contra producción**: hacen llamadas
  reales a LLM y tienen costo — no son necesarias para validar ESTE cambio de
  código (la suite unitaria ya ejercita el pipeline completo con red
  simulada) y no hay autorización para gastar más en esta fase.
- **Réplica real de los 6 casos medidos con el mecanismo activo**: los datos
  de esa medición (contactos y conversaciones de prueba) ya se limpiaron de
  producción. Reproducirlo exigiría una corrida nueva, con costo — se ofrece
  como paso siguiente antes de decidir producción, no se ejecutó por cuenta
  propia.
- **Deploy**: no autorizado. Ver rollback abajo.

## Rollback

Una variable: vaciar `OPENROUTER_FALLBACK_MODEL`. `modeloDeRescate()` pasa a
devolver `undefined`, `intentarRescateDeCierre` retorna `rescatado:false` sin
llamar a ningún proveedor, y el turno se comporta exactamente como si este
spec no existiera. Sin migración, sin dato tocado, sin ficha modificada.

Para volver también el modelo conversacional a Gemini: `OPENROUTER_MODEL=google/gemini-3.7-flash`
— entonces el salvavidas simplemente nunca encuentra nada que rescatar (Gemini
como principal no tuvo el problema medido).
