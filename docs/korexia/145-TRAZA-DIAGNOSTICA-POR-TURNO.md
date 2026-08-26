# 145 — Trazabilidad diagnóstica por turno

26-ago-2026.

## El problema que resuelve

Reconstruir un incidente ("el bot respondió algo incorrecto") significaba,
hasta ahora, leer a mano media docena de líneas de log con prefijos
distintos (`[producto]`, `[pago]`, `[agente]`, `[citas]`, `[metrica]`),
dispersas por el archivo, sin nada que las una salvo el `conversationId`
repetido y la cercanía de sus timestamps. Es exactamente el trabajo que
costó reconstruir el incidente de "Luisa" (26-ago-2026, doc 144: los dos
saludos duplicados) — había que cruzar la tabla `message`, los logs de
consola y el estado de `conversation` a mano, sin ningún punto único de
entrada.

## Fase 1 — Qué existía y qué faltaba

**Ya existía** (auditado antes de escribir nada):
- `registro-de-cambios.ts`: log estructurado con redacción de datos
  personales (`paraLog`, `resumirTexto`) — la decisión ya tomada en el
  proyecto de "log antes que tabla nueva" (15-ago-2026).
- `registrarMetricaDeEstado` (`orders/estado.ts`): una línea `[metrica]`
  por turno, pero solo para la Fase 2 (`conversation_state`) — no dice qué
  acción se eligió, si hubo consulta factual, ni si hubo guardarraíl.
- Logs sueltos en `pipeline.ts`: cada guardarraíl imprime su propia línea
  (`[producto]`, `[pago]`, `[citas]`, `[agente]...`) sin ningún campo común
  que las agrupe como "un solo turno".
- `usage_event` (tabla): correlaciona el COSTO de cada llamada al LLM con
  un `ref` como `conv:<id>/producto-contradicho` — útil, pero no dice el
  resultado de la decisión, solo que hubo una llamada con ese propósito.
- `conversation.handoffAt`/`handoffReason`: solo cinco valores posibles
  (`cliente`, `modelo`, `error`, `ventana`, `operador`) — no distingue un
  proveedor caído de una salida inválida del modelo tras agotar la
  recuperación.

**Lo que faltaba**: un punto único, por turno, que consolide qué se
verificó, qué guardarraíl actuó, si hubo recuperación de una salida
parcial, y cómo terminó — sin tener que grepear cinco prefijos distintos y
adivinar por la hora cuáles pertenecen al mismo turno.

## Arquitectura mínima elegida

Una línea `[traza]` por turno, mismo patrón que `registrarMetricaDeEstado`
(nunca tabla nueva, nunca infraestructura de observabilidad aparte). Un
acumulador (`TrazaDelTurno`, `src/server/ai/traza.ts`) se crea una vez en
`runAgentTurn`, justo antes de la primera llamada al modelo, y se va
anotando en los MISMOS puntos donde el pipeline ya generaba sus logs de
hoy — es instrumentación pura, ninguna decisión existente cambia.

```
CLIENTE: "¿Tienen torta de chocolate?"
  ↓
[traza] deteccion_factual="torta de chocolate"
  ↓
BACKEND: consultar_producto → found, Porción Chocolate
  ↓
[traza] hechos=producto:"torta de chocolate"=found@backend
  ↓
LLM: reply
  ↓
GUARDARRAÍLES: contenido_obligatorio (el link del catálogo) → corrige
  ↓
[traza] guardarrailes=contenido_obligatorio:corrigio
  ↓
[traza] accion=reply categorias=fact_verified|guardrail_corrected handoff=no
```

**Nunca vuelca el texto del cliente.** El mensaje real ya vive en
`message.text`; la traza lleva `mensajeId` (el id de esa fila, un dato
técnico) y `resumirTexto()` (longitud + huella) — suficiente para confirmar
"es el mismo mensaje" sin duplicar un dato que podría ser personal en un
log de servidor.

## Categorías (pueden combinarse en un mismo turno)

`normal` · `fact_verified` · `guardrail_corrected` ·
`model_output_partial_recovered` · `model_output_invalid` ·
`provider_error` · `backend_error` · `handoff` — implementadas como
`Set<string>`, no un enum cerrado: agregar una categoría nueva no rompe
nada existente.

## Causas de handoff, con nombre real (no genérico)

`customer_requested_human` (patrón FR-022, ya existía como `reason:"cliente"`),
`model_output_recovery_failed` (un guardarraíl agotó su único reintento),
`model_output_invalid` (la salida no cumplió el contrato ni tras recuperar),
`provider_error` (el proveedor de IA falló), `backend_error` (una consulta
al backend —producto/pago/disponibilidad— falló su propio reintento),
`missing_required_information` (requisito declarado por el negocio, sin
cumplir), `business_rule` (el modelo derivó por su cuenta — caso real,
"Retiro de acrílicas", doc 144). `conversation.handoffReason` sigue
mostrando solo `"error"`/`"modelo"`/etc., sin romper lo que ya cuenta por
ese valor; la causa fina vive únicamente en el log.

## Qué quedó instrumentado — y qué no (límite honesto de esta ronda)

**Instrumentado**: el precheck factual de producto, los bucles de
`consultar_producto`/`consultar_medio_pago`/`consult_availability`, y los
guardarraíles `producto_contradicho`, `pago_contradicho`,
`disponibilidad_sin_verificar`, `cierre_falso`, `cita_fantasma`,
`recurso_prometido`, `pago_sin_verificar`, `turno_mudo`,
`requisito_faltante`, `contenido_obligatorio`; la recuperación de Nivel 1
(`send_menu` sin `reply`) y Nivel 2 (`chatJsonConEstado`, doc 144); y el
punto único de cierre justo antes del switch de ejecución, que cubre reply,
send_menu, notify_order, book_appointment, move_stage y handoff.

**No instrumentado en esta ronda** (mismo patrón, extensión mecánica si se
necesita): `producto_olvidado`, `resumen_mal_armado`/`sin_total` — estos NO
derivan a una persona (se corrigen o se registran y se sigue), así que su
impacto en un incidente real es menor. Tampoco los handoffs que ocurren
ANTES de la primera llamada al modelo (`ventana` cerrada, cliente pide
asesor por frase de respaldo) — esos ya tienen su causa exacta en
`conversation.handoffReason` sin ambigüedad, así que no se pierde
diagnóstico por no duplicarlos aquí.

## Hallazgo de la prueba controlada (nuevo, no corregido en esta ronda)

Con "¿Puedo pagar por Nequi?" contra Lis, la traza mostró
`categorias=normal hechos=-` — el modelo respondió correctamente (Nequi sí
está en la ficha) **sin pasar por `consultar_medio_pago`**. Es el mismo
patrón que motivó el doc 143 para productos: el pago todavía depende de que
el modelo decida verificar por su cuenta, sin un precheck forzado
equivalente. Se documenta como hallazgo — no se corrige aquí, fuera del
alcance autorizado para esta ronda.

## Pruebas

**Automatizadas**: 14 nuevas — `tests/unit/traza-del-turno.test.ts` (9,
el módulo aislado: redacción del mensaje, cada categoría, que nunca
lanza) y `tests/unit/pipeline-traza-del-turno.test.ts` (5, los escenarios
exactos pedidos: consulta factual exitosa, consulta abierta sin marcar
falso positivo, `send_menu` sin `reply` recuperado, guardarraíl que
corrige, handoff con causa específica). `tsc --noEmit` y `eslint` limpios.
Suite completa: **1089 pruebas, 0 fallos**, sin regresiones.

**Controlada, contra la base real de Lis** (mismo mecanismo que 142/143/144):

| Mensaje | Traza |
|---|---|
| "Hola, buenas noches" | `categorias=normal` — sin verificación, sin guardarraíl, sin handoff |
| "¿Tienen torta de chocolate?" | `fact_verified\|guardrail_corrected` — producto found, y el guardarraíl de contenido obligatorio forzó el link del catálogo |
| "¿Qué tienen de chocolate?" | `guardrail_corrected` (mismo link forzado), **sin** `fact_verified` — no forzó una búsqueda única, como debía |
| "¿Cuánto cuesta la torta de chocolate?" | `fact_verified` — mismo producto, precio real |
| "¿Puedo pagar por Nequi?" | `normal` — **hallazgo**: el modelo no verificó, aunque acertó |
| "¿Tienen cupcakes de vainilla?" | `fact_verified\|guardrail_corrected` — `not_found`, no inventó |

## Lo que NO cambió (preservado a propósito)

- Ninguna decisión del pipeline se alteró: cada línea agregada anota lo que
  YA iba a pasar, nunca decide nada nuevo.
- El prompt maestro, `conducta.ts`, el LLM, y la lógica de productos/pagos/
  citas/`send_menu` de las rondas anteriores: sin cambios.
- Sin tabla nueva, sin migración, sin infraestructura de observabilidad
  aparte — un archivo nuevo (`traza.ts`) con el mismo patrón que ya existía
  dos veces en el proyecto.
