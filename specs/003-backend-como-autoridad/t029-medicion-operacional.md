# T029 — Medición operacional Feature 003

> Ejecutado 16-sep-2026, ~21:00-21:45 UTC. Solo lectura contra producción real.
> Ningún cambio de código, configuración, flags, modelo ni deploy.

## 0. Advertencia de alcance (léase antes que el resto)

**No existe una baseline PRE-Feature-003 completa y comparable. Por tanto, estos
resultados no deben interpretarse como una medición de mejora porcentual
respecto al sistema anterior. Constituyen la primera medición operacional
documentada de Feature 003 sobre tráfico real.**

Adicionalmente, y esto es el hallazgo central de esta corrida: **en el período
observable no hubo tráfico real accionable de La Churra**. Este documento
reporta esa ausencia con toda la evidencia que la sustenta, en vez de
sustituirla por datos de otro tipo.

---

## 1. Estado de producción (verificado en el momento de esta medición)

| Campo | Valor | Cómo se verificó |
|---|---|---|
| Commit desplegado | `ca020e7349d747e1203b7c9adba4cc2380074c78` | `curl https://crm.korexia.online/api/health` → `{"ok":true,"commit":"ca020e7...","campaignWorkerEnabled":false}` |
| Health | `ok:true`, HTTP 200 | mismo curl |
| Deploy | run `35141552542`, iniciado `2026-09-16T19:36:16Z`, convergido `19:44:02.8Z`, health OK `19:44:03.0Z` | `gh run view --job=... --log` |
| La Churra — `state_source` | `backend` | `SELECT` directo a `agent_profile` (túnel SSH read-only) |
| La Churra — `catalog_source` | `tabla` | ídem |
| La Churra — `enabled` | `true` | ídem |
| La Churra — `appointments_enabled` | `false` | ídem |
| La Churra — `updated_at` | `2026-09-09 22:36:23.084` (sin cambios desde entonces) | ídem |
| Lis / MALIA | `state_source=prompt`, `enabled=true` | ídem — sin drift respecto al checkpoint anterior |
| Lashes Valen / Camilabrandcol | `state_source=backend`, `enabled=false` | ídem — sin drift |
| **Modelo real configurado en el contenedor** | `OPENROUTER_MODEL=google/gemini-3.7-flash` | `docker inspect <container> --format '{{range .Config.Env}}...'` sobre el contenedor real corriendo (no sobre `.env` local) |
| `OPENROUTER_FALLBACK_MODEL` | `google/gemini-3.7-flash` (idéntico al principal) | ídem |
| `OPENROUTER_JUDGE_MODEL` | `google/gemini-3.7-flash` (idéntico al principal) | ídem |

**Hallazgo a reportar, no a corregir aquí**: `CLAUDE.md` documenta
`OPENROUTER_MODEL=google/gemini-2.5-flash` como el modelo real de producción.
**Verificado directamente en el contenedor que corre ahora mismo, el modelo
configurado es `google/gemini-3.7-flash`**, y el fallback/juez apuntan al
mismo modelo que el principal (sin diversidad real de salvavidas). Esto es
una desactualización de la documentación, no un cambio que yo haya hecho — la
señalo porque afecta directamente el punto "J" del documento de handoff
(cualquier plan de cambio de modelo debe partir de este dato verificado, no
del documentado).

**Repositorio local** (no productivo, informativo): rama
`003-backend-como-autoridad`, HEAD `854ea4b6f6f0ac7c1ea2cc004916904a4c931a7c`
(el fix de T028), **sin pushear** (`origin/003-backend-como-autoridad` sigue en
`ca020e7`), sin mezclar a `main`. `git status` limpio salvo los dos archivos
sueltos preexistentes (`docs/korexia/157-AUDITORIA-DEL-PLAN-SDD.md`,
`tsconfig.scripts.json`), ninguno tocado.

---

## 2. Período medido, y por qué no produjo turnos

**Definición de "turno" usada** (la misma que ya usa la instrumentación, no
una definición nueva): un turno es una ejecución de `runAgentTurn(conversationId)`
—una invocación del pipeline por un mensaje entrante procesable—, que
siempre emite exactamente una línea `[traza]` al terminar
(`registrarTrazaDelTurno`, `src/server/ai/traza.ts`). Cuando además el
negocio tiene `state_source='backend'`, ese mismo turno también emite una
línea `[metrica] evento=estado` (`registrarMetricaDeEstado`,
`guardarEstadoPropuesto` en `pipeline.ts`).

**Ventana observada**: desde que el contenedor actual arrancó
(`2026-09-16T19:43:52Z`, confirmado por `docker inspect --format
'{{.State.StartedAt}}'`) hasta el momento de esta medición
(`~2026-09-16T21:30Z`) — **1 hora 46 minutos**, sin ningún redeploy de por
medio (mismo contenedor, mismo `container_id` todo el tiempo).

**Fuente de la medición**: descargué el log completo del contenedor real
(`docker logs <container_id>`, solo lectura) — 652 líneas totales — y lo
crucé contra la base de datos real (`message`/`conversation`, filtrando
`organization_id='org_lo5gdlt6k43z9fg1ling'` y `is_test=false`).

**Resultado**:
- **0 líneas `[metrica]` u `[traza]` mencionan `org=org_lo5gdlt6k43z9fg1ling`** en todo el log del contenedor. Las únicas organizaciones con actividad en esa ventana fueron MALIA (`org_kf1suh8q9dtbmcq3f3ba`, 49 líneas) y Lis Pastelería (`org_lispasteleria0001`, 15 líneas) — ninguna de las dos relevante para esta medición (ambas en `state_source='prompt'`, fuera del alcance de Feature 003 en esta fase).
- **Verificación cruzada contra la base de datos**: en toda la ventana post-deploy hubo exactamente **1 mensaje real (`is_test=false`)** de La Churra — y no generó ningún turno. Investigué por qué: es un mensaje de tipo WhatsApp `unsupported` (`[mensaje no compatible: tipo "unsupported"...]`), de un contacto que ya tiene el mismo patrón repetido desde el 8-ago-2026. Confirmé que **no existe ninguna fila en `agent_job` para esa conversación** — el pipeline correctamente NO encola un turno para un mensaje no soportado (comportamiento documentado y esperado, `docs/korexia/24-MENSAJES-UNSUPPORTED.md`), así que no hay nada que este mensaje debiera haber generado.

| Campo | Valor |
|---|---|
| Inicio de la ventana | `2026-09-16T19:43:52Z` (arranque del contenedor de Feature 003) |
| Fin de la ventana | `2026-09-16T21:30Z` (momento de esta medición) |
| Duración | 1h 46min |
| **Turnos reales de La Churra** | **0** |
| Mensajes reales de La Churra (`is_test=false`) | 1 (tipo `unsupported`, no genera turno) |
| Mensajes `is_test=true` de La Churra en la misma ventana | 36 (mis propias pruebas de T028/fix-verify — **excluidos explícitamente de esta medición**, tal como pediste) |
| Conversaciones reales involucradas | 0 (ninguna generó un turno) |

**Conclusión de esta sección: no hay muestra que medir.** No es un error de instrumentación ni un log incompleto — verifiqué ambos lados (el log del contenedor y la base de datos) y coinciden: no hubo tráfico real accionable de La Churra en la ventana observable.

---

## 3. Llamadas al modelo por turno

**No calculable — N=0.** No hay ningún turno real sobre el cual promediar, mediar, o tomar mínimo/máximo.

## 4. Latencia

**No calculable — N=0.**

Aclaración de metodología (para cuando sí haya datos): la instrumentación
existente mide dos cosas distintas y nunca deben mezclarse:
- `ms_modelo` — tiempo de la llamada a `chatJsonConEstado` (el proveedor LLM), medido en `pipeline.ts` (`t0`/`Date.now()` alrededor de la llamada).
- `ms_backend` — tiempo de `guardarEstadoPropuesto` (resolver catálogo, aplicar operaciones, persistir), medido por separado en la misma línea `[metrica]`.
- Ninguna de las dos es "el turno completo" (que incluiría además el resto del pipeline: guardarraíles, reintentos, envío de la respuesta).

## 5. Backend vs LLM

**No calculable — N=0.** Metodología prevista (sin datos que aplicarle
todavía): el campo `hechos[]` de cada `[traza]`
(`agregarHecho`/`HechoConsultado`, `traza.ts`) marca `origen: "backend" |
"crm" | "llm"` por cada dato que el agente usó para responder (producto,
método de pago, disponibilidad, domicilio). "Backend" = el dato se verificó
contra una tabla real antes de responder; "LLM" = el modelo lo generó sin
verificación server-side. Sin turnos, no hay `hechos[]` que contar.

## 6. Guardarraíles

Identifiqué los guardarraíles **realmente instrumentados** con nombre propio
en `pipeline.ts` (los que `agregarGuardarrail(traza, "<nombre>", corrigió)`
puede registrar — este es el mecanismo real y medible, el mismo que ya usa
`traza.ts`):

| guardarraíl | disparos | tasa | contexto |
|---|---|---|---|
| `propuesta_rechazada` | 0 | N/A (sin turnos) | Compuerta 2/3 de operaciones rechazó y se avisó al modelo (T015) |
| `disponibilidad_sin_verificar` | 0 | N/A | citas: afirmó/negó disponibilidad sin consultar |
| `producto_contradicho` | 0 | N/A | contradijo un hecho de producto ya verificado |
| `producto_ambiguo_sin_preguntar` | 0 | N/A | asumió un candidato ambiguo sin preguntar |
| `pago_contradicho` | 0 | N/A | contradijo el método de pago verificado |
| `domicilio_en_bucle` | 0 | N/A | pidió consultar domicilio ya agotado |
| `domicilio_contradicho` | 0 | N/A | contradijo la tarifa de domicilio verificada |
| `inconsistencia_financiera` | 0 | N/A | el total del texto no cuadra con lo calculado |
| `pedido_ya_confirmado` | 0 | N/A | insistió en confirmar un pedido ya cerrado |
| `cierre_falso` | 0 | N/A | anunció que el negocio está cerrado, estando abierto |
| `cita_fantasma` | 0 | N/A | confirmó una cita sin haberla agendado |
| `recurso_prometido` | 0 | N/A | prometió un recurso sin enviarlo |
| `humano_prometido` | 0 | N/A | prometió un humano sin derivar |
| `pago_sin_verificar` | 0 | N/A | confirmó pago sin verificarlo |
| `datos_de_cuenta_contradichos` | 0 | N/A | contradijo los datos de cuenta declarados |
| `turno_mudo` | 0 | N/A | el turno se quedó sin respuesta |
| `requisito_faltante` | 0 | N/A | cerró sin un requisito obligatorio cubierto |
| `contenido_obligatorio` | 0 | N/A | falta contenido obligatorio del CRM |
| `appointment_incomplete_services` | 0 | N/A | cita con servicios incompletos |
| **Total agregado** | **0** | **N/A** | |

**Nota importante sobre la cifra "24"**: `tasks.md` (T015) cita "los 24
guardarraíles de `anuncio-de-cierre.ts`" como referencia histórica. Contando
exactamente los que hoy tienen un nombre propio instrumentado vía
`agregarGuardarrail` en `pipeline.ts` (el mecanismo que de verdad se puede
medir en `[traza]`), encontré **19**, listados arriba. No encontré un
inventario exhaustivo que documente cuáles 5 más completarían los 24 — no
inventé esos 5 ni forcé la cifra. Reporto los 19 reales y la discrepancia,
tal como pediste ("si una métrica no puede calcularse, decláralo").

## 7. Errores / rechazos

**No calculable — N=0.** Distinción metodológica (para cuando sí haya
datos, y que confirmé leyendo el código): `guardarEstadoPropuesto`
(`pipeline.ts`) usa `registrarMetricaDeEstado` con un campo `resultado` de
**4 valores mutuamente excluyentes**, que nunca deben mezclarse entre sí ni
con "guardarraíl disparado":
- `guardado` — el lote de operaciones pasó las 3 compuertas y se persistió.
- `rechazado` — `aplicarOperaciones` rechazó el lote (Compuerta 2/3) — esto SÍ dispara el guardarraíl `propuesta_rechazada`.
- `sin_propuesta` — el modelo no emitió `operaciones` este turno (legítimo: preguntó algo, saludó).
- `error` — las `operaciones` no pasaron ni la Compuerta 1 (Zod) — **esto es exactamente lo que T028 encontró y corrigió, y explícitamente NO cuenta como guardarraíl disparado** (es un evento de esquema, antes de que exista una "operación" que evaluar).

Handoffs: el campo `traza.handoffCausa`/`categorias.has("handoff")` en
`[traza]`. Confirmaciones: el campo `guardadoConfirmadoTrue` de
`guardarEstadoPropuesto`. Ninguno tiene datos que reportar en esta ventana.

## 8. Evidencia (resumen por métrica)

| Qué | Fuente | Cómo |
|---|---|---|
| Commit/health | `https://crm.korexia.online/api/health` | `curl`, verificado en el momento |
| Deploy timestamp | GitHub Actions, run `35141552542` | `gh run view --job=<id> --log` |
| Config de las 5 organizaciones | tabla `agent_profile`, producción | `SELECT` vía túnel SSH read-only, sin escrituras |
| Contenedor activo | Docker Swarm, servidor `2.25.159.117` | `docker service ps`, `docker inspect` (solo lectura) |
| Modelo real configurado | variables de entorno del contenedor real | `docker inspect --format '{{range .Config.Env}}...'` |
| Log de aplicación | contenedor `03fb2ef9cb55...` | `docker logs <id>` (solo lectura), 652 líneas, descargado y grepeado, luego borrado |
| Tráfico real de La Churra | tablas `message`/`conversation`/`agent_job`, producción | consultas SQL directas, filtrando `is_test=false` y el rango de tiempo del contenedor actual |
| Guardarraíles instrumentados | `src/server/ai/pipeline.ts` (código fuente, esta rama) | `grep agregarGuardarrail` |

**Filtros aplicados en todas las consultas**: `organization_id =
'org_lo5gdlt6k43z9fg1ling'` exclusivamente; `is_test = false` exclusivamente
para conteo de tráfico real; rango de tiempo acotado al contenedor
actualmente corriendo (sin mezclar con la ventana PRE ni con corridas de
T028). Ningún dato de sandbox se contó como parte de esta medición — los 36
mensajes `is_test=true` de La Churra en esta misma ventana se identificaron y
se excluyeron explícitamente (no se promediaron, no se mezclaron).

**Control de calidad realizado antes de reportar**: verifiqué que no hay
duplicados (cada `message.id` es único, cero solapamiento de conversaciones),
que ninguna conversación real generó más de un conteo, y — un hallazgo
metodológico propio de esta sesión — descubrí y corregí un problema de
interpretación de zona horaria del *driver* JS de Postgres al leer columnas
`timestamp without time zone` (el valor crudo en la base es UTC correcto;
lo que se corrompía era la conversión a objeto `Date` en mi cliente local).
Todas las consultas de este informe usan `::text` y literales de timestamp
sin `Z`, verificados contra dos puntos de referencia conocidos
independientemente (timestamps que yo mismo generé y pude comparar).

---

## Conclusión exacta de T029

**T029 no pudo producir las 4 métricas solicitadas porque no hubo tráfico
real accionable de La Churra en la ventana observable (1h46min desde que el
código de Feature 003 está corriendo).** Esto no es una falla de la
instrumentación —verifiqué que funciona correctamente observando actividad
real de otras dos organizaciones en la misma ventana— ni una falla de
Feature 003. Es, simplemente, que La Churra tiene un volumen de tráfico real
bajo (1-9 mensajes reales en un día típico, según el historial de las
últimas 3 semanas) y no llegó ningún mensaje procesable en esta ventana
concreta.

**Este documento deja establecida la metodología, las fuentes y las
definiciones exactas** que deberán usarse la próxima vez que se repita esta
medición — sea porque se re-ejecuta T029 tras acumular más tiempo de tráfico
real, o porque se usa esta misma metodología para comparar un cambio de
modelo (Sección I del documento de handoff).
