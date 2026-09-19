# HANDOFF — Cambio de modelo post Feature 003

> Documento de referencia para cuando se decida cambiar el modelo/proveedor
> LLM de La Churra (o de cualquier negocio con `state_source='backend'`).
> **No autoriza ni ejecuta ningún cambio de modelo.** Escrito 16-sep-2026,
> verificado contra producción real en el momento de escribirlo.

---

## A. Estado actual (verificado, no documentado de memoria)

| Campo | Valor |
|---|---|
| Arquitectura | Feature 003 "backend-como-autoridad", desplegada |
| Commit desplegado en producción | `ca020e7349d747e1203b7c9adba4cc2380074c78` (confirmado vía `/api/health`) |
| Fix de T028 | commit `854ea4b6f6f0ac7c1ea2cc004916904a4c931a7c`, en la rama `003-backend-como-autoridad`, **NO pusheado, NO mergeado, NO desplegado todavía** |
| Modelo real configurado en el contenedor | `google/gemini-3.7-flash` (verificado con `docker inspect` sobre el contenedor real — **no coincide con `google/gemini-2.5-flash` que documenta `CLAUDE.md`**; la documentación quedó desactualizada) |
| `OPENROUTER_FALLBACK_MODEL` | `google/gemini-3.7-flash` — idéntico al principal, sin diversidad real de salvavidas |
| `OPENROUTER_JUDGE_MODEL` | `google/gemini-3.7-flash` — idéntico al principal |
| Proveedor | OpenRouter (capa de compatibilidad sobre Google/otros) |
| Organización activa con Feature 003 | Solo **La Churra** (`org_lo5gdlt6k43z9fg1ling`): `state_source=backend`, `catalog_source=tabla`, `enabled=true` |
| Lis Pastelería / MALIA | `state_source=prompt` (temporalmente, contención de la Fase 1 de rollout — NO son parte de Feature 003 todavía) |
| Lashes Valen / Camilabrandcol | `state_source=backend`, `enabled=false` (agente apagado, sin tráfico real) |

---

## B. Arquitectura aprobada

```
Cliente escribe
      ↓
LLM interpreta la intención del turno
      ↓
LLM propone una lista de Operacion[] — un conjunto CERRADO de verbos,
nunca texto libre ni un id inventado
      ↓
Korex (el pipeline) orquesta: recibe la lista, la pasa a la Compuerta 1
      ↓
Backend valida (3 compuertas, ver sección D)
      ↓
Backend resuelve catálogo/estado real (productos, opciones, servicios,
horarios — todo contra tablas reales, nunca contra lo que el modelo recuerde)
      ↓
Backend calcula (precios, totales, disponibilidad)
      ↓
Backend persiste (conversation_state, atómico — todo o nada)
      ↓
LLM comunica al cliente lo que el backend ya decidió
```

**Responsabilidad de cada capa:**
- **LLM**: entender lenguaje natural y elegir QUÉ operación(es) corresponden a lo que el cliente acaba de decir. Nunca calcula, nunca decide si algo es válido, nunca inventa un identificador.
- **Korex (pipeline.ts)**: recibe la propuesta cruda del modelo, la sanea (`sinNulos`, ver sección F), la valida contra el esquema, y decide qué hacer con el veredicto (aplicar, reintentar con el modelo, o dejar el estado intacto).
- **Backend (orders/operaciones.ts, appointments/operaciones.ts, orders/policy.ts)**: la única autoridad sobre datos reales. Resuelve nombres contra catálogo, calcula todo lo numérico, decide si un cierre puede ejecutarse de verdad.

---

## C. Contrato de operaciones (verificado contra el código actual, no inventado)

### Pedidos (`src/server/orders/operaciones.ts`)

| Operación | Campos | Qué hace |
|---|---|---|
| `agregar_item` | `ofrecible`, `opciones[]`, `cantidad` | agrega una línea nueva, resuelta contra el catálogo real |
| `cambiar_cantidad` | `ofrecible`, `opciones?[]`, `cantidad` | cambia la cantidad de una línea YA existente |
| `quitar_item` | `ofrecible`, `opciones?[]` | quita una línea existente |
| `elegir_opcion` | `ofrecible`, `opciones?[]`, `grupo`, `opcion` | agrega una opción de grupo a un ítem ya pedido |
| `declinar_grupo` | `ofrecible`, `opciones?[]`, `grupo` | marca un grupo opcional como rechazado explícitamente |
| `fijar_dato` | `requisitoId`, `valor` | guarda un dato de cierre (nombre, teléfono, dirección…) |
| `fijar_modalidad` | `modalidad` | fija cómo se entrega (domicilio/recogida), solo si el negocio ofrece más de una |
| `confirmar` | (sin campos) | marca la intención de cerrar — **no ejecuta el cierre por sí sola**, ver sección D |

**No existe `cancelar`** en esta unión — decisión de diseño explícita
(16-sep-2026): "empezar de cero" ya es un mecanismo determinístico y anterior
al modelo (`matchesReinicio`/`borrarEstado`, por palabra clave configurable
por negocio), y no se convirtió en una `Operacion` para no duplicar esa
lógica ni dejarla depender de que el modelo la dispare bien.

### Citas (`src/server/appointments/operaciones.ts`)

| Operación | Campos | Qué hace |
|---|---|---|
| `fijar_servicio` | `servicio` | elige un servicio del catálogo de citas |
| `fijar_horario` | `fecha`, `hora`, `especialista?` | fija la cita a una tupla que el backend YA ofreció — se reverifica contra disponibilidad real al aplicarla, nunca se acepta un horario inventado |
| `fijar_especialista` | `especialista` | elige con quién, aparte de la fecha |
| `fijar_dato` | `requisitoId`, `valor` | igual que en pedidos |
| `confirmar` | (sin campos) | igual que en pedidos, mismo principio |

`fijar_modalidad` no existe en citas (no aplica al vertical). Tampoco existe
`cancelar` aquí, por el mismo motivo que en pedidos.

**Regla que gobierna las dos uniones**: ninguna operación referencia por id.
`ofrecible`, `servicio`, `especialista`, `grupo`, `opcion` son siempre el
NOMBRE tal como aparece en el catálogo real — el backend los vuelve a
resolver contra la tabla real en el momento de aplicar la operación
(`resolverAgregarItem`/`buscarItemExistente` en pedidos,
`buscarServicio`/`resolverEspecialistaMultiple` en citas). El modelo nunca ve
ni recuerda un id de un turno anterior.

---

## D. Las tres compuertas (`data-model.md` sección 3, verificadas en `aplicarOperacion`)

1. **¿Existe la operación y aplica a este vertical?** — Zod la rechaza antes de que el código de negocio la vea (unión discriminada, `additionalProperties:false` en el JSON-schema del proveedor).
2. **¿Sus parámetros resuelven contra datos reales?** — el nombre debe encontrar una fila real en el catálogo/estado (`normalizarPedido`, `buscarItemExistente`, `buscarServicio`).
3. **¿El estado actual la permite?** — reglas de negocio puntuales (cantidad ≥ 1, el requisito existe, la modalidad es una de las que el negocio ofrece).

Si **cualquiera** falla: la operación se rechaza con `{motivo, correccion}`;
si falla dentro de un lote, **el lote entero se descarta** (`aplicarOperaciones`,
`src/server/orders/operaciones.ts:620-634`) — ni siquiera las operaciones
anteriores que sí habían pasado se aplican. Confirmado con test dedicado
(`tests/unit/orders-operaciones.test.ts`, "si la operación 2 de 3 falla,
NINGUNA se persiste") y re-confirmado en vivo durante T028.

`confirmar` es la excepción documentada: dentro de `aplicarOperacion` solo
marca `confirmado:true` EN MEMORIA — la autoridad real sobre si eso cierra
de verdad la tiene `puedeConfirmarPedido` (`src/server/orders/policy.ts`),
que corre DESPUÉS de guardado el lote y exige: al menos un ítem resuelto,
total ya calculado, y todo requisito `obligatorio` cubierto.

---

## E. Fuente de verdad

El modelo **no puede determinar por sí mismo**:

- precio definitivo de un producto/servicio
- subtotal o total del pedido
- costo de domicilio
- disponibilidad real de un horario/especialista
- si el estado persistido está completo
- si un cierre puede ejecutarse de verdad
- cualquier identificador interno (id de producto, de opción, de zona)

Todo lo anterior se resuelve, calcula y decide en el backend
(`orders/operaciones.ts`, `orders/policy.ts`, `orders/estado.ts`,
`appointments/*`). El modelo solo interpreta intención humana y elige
operaciones de la lista cerrada — nunca redacta un hecho de negocio.

---

## F. Corrección T028 (resumen para quien no leyó el checkpoint completo)

- **Causa raíz**: el JSON-schema que el proveedor recibe declara todo campo
  como `[tipo, "null"]` (modo estricto: hay que emitir todo, `null` = no
  aplica). Pero `cambiar_cantidad`/`quitar_item`/`elegir_opcion`/
  `declinar_grupo` (pedidos) y `fijar_horario` (citas) declaran su campo
  opcional (`opciones`/`especialista`) como `.optional()` en Zod — que acepta
  *ausente*, no `null`. La `accion` completa ya se saneaba con `sinNulos`
  antes de validar; cada elemento de `operaciones[]` no.
- **Síntoma**: un modelo que sigue la convención del propio esquema
  (`opciones:null` = "no aplica") tumbaba la Compuerta 1 del **lote entero**,
  en silencio — sin aviso al modelo, sin retry. Reproducido en vivo contra La
  Churra en producción real con `gpt-5-mini`: 4 turnos seguidos donde el
  texto del agente decía cosas que el backend nunca guardó.
- **Fix**: commit `854ea4b6f6f0ac7c1ea2cc004916904a4c931a7c` — aplica
  `sinNulos` a cada elemento de `operaciones[]` antes de `.safeParse()`, en
  `guardarEstadoPropuesto` (`pipeline.ts`). Reutiliza la función existente,
  sin tocar el contrato de `Operacion`, sin nuevas llamadas al modelo, sin
  tocar las tres compuertas.
- **Tests**: 6 nuevos (`tests/unit/saneo-null-en-operaciones.test.ts`),
  suite completa 226 archivos / 2285 tests / 0 fallos.
- **gpt-5-mini** (post-fix): el mismo guion que falló antes ahora persiste
  correctamente en cada turno, y llega a confirmar un pedido real con cifras
  verificadas por el backend.
- **gemini-2.5-flash** (post-fix, prueba aislada por proceso): sin cambio de
  comportamiento — ya funcionaba, sigue funcionando igual.
- **Estado**: commiteado en `003-backend-como-autoridad`, **no pusheado, no
  mergeado, no desplegado**.

---

## G. Comportamiento real observado (T029)

Ver [t029-medicion-operacional.md](t029-medicion-operacional.md) completo.
Resumen: en la única ventana observable de tráfico real bajo Feature 003
(1h46min desde el deploy), **no hubo ningún turno real accionable de La
Churra** — volumen de tráfico real bajo (1-9 mensajes/día típico) y ningún
mensaje procesable llegó en esa ventana. Las 4 métricas (llamadas al modelo,
latencia, proporción backend/LLM, disparo de guardarraíles) quedan **sin
dato**, no estimadas ni inventadas. La metodología y las fuentes exactas
quedan documentadas para la próxima medición.

---

## H. Qué NO debe modificarse durante el cambio de modelo

El cambio de modelo/proveedor es, por diseño, un cambio que solo debe tocar
`OPENROUTER_MODEL` (y análogos) — nada de código de negocio. **No debe
modificarse:**

- la arquitectura de este documento (sección B)
- el contrato de `Operacion` (sección C) — ni añadir campos, ni cambiar tipos, ni renombrar
- los resolvedores por nombre (`normalizarPedido`, `buscarServicio`, etc.)
- la persistencia (`guardarEstado`, `conversation_state`)
- la atomicidad del lote (`aplicarOperaciones`)
- ninguno de los 19 guardarraíles instrumentados (sección de guardarraíles del informe T029)
- las reglas de negocio de `orders/policy.ts` (`puedeConfirmarPedido`)
- ninguna herramienta backend existente

El objetivo de la fase posterior es **cambiar únicamente el proveedor/modelo
y medir** — si el nuevo modelo necesita que el CÓDIGO cambie para funcionar
bien, eso es una señal de que el contrato no es suficientemente robusto
frente a variación de proveedor, y merece su propia discusión, no un parche
apresurado en medio de la migración.

---

## I. Plan para cambiar el modelo (a futuro — NO ejecutar todavía)

1. **Identificar el modelo candidato** — con su nombre exacto de OpenRouter.
2. **Verificar compatibilidad con structured output / JSON schema estricto**
   — el mecanismo entero depende de que el proveedor respete
   `response_format: json_schema` con `additionalProperties:false` (ver el
   comentario de `chatJsonConEstado`, medido contra `gemini-2.5-flash`
   0-de-3 sin esquema forzado vs 3-de-3 con él). Un modelo que no soporte
   esto de forma confiable no es candidato viable sin rediseñar el contrato.
3. **Verificar el schema** — correr `tests/unit/esquema-json-de-operaciones.test.ts`
   y `tests/unit/saneo-null-en-operaciones.test.ts` sin tocarlos, para
   confirmar que el contrato sigue siendo el mismo antes de tocar nada de
   configuración.
4. **Ejecutar pruebas controladas** — sandbox `is_test`, mismo mecanismo que
   T028 usó (`runAgentTurn` directo, conversación efímera, nunca WhatsApp
   real), con guiones que cubran: agregar/cambiar/quitar/elegir/declinar,
   un producto inexistente, un lote con una operación inválida, cambio de
   opinión, y confirmar.
5. **Comparar** contra el modelo actual, en el mismo guion:
   - calidad (¿la respuesta al cliente es coherente y correcta?)
   - llamadas al modelo por turno
   - latencia
   - errores (Compuerta 1 — Zod)
   - rechazos (Compuerta 2/3)
   - operaciones correctas vs incorrectas
6. **Sandbox** — validar contra el catálogo REAL de La Churra (mismo patrón
   de T028: leer `agent_profile`/`product`/`product_option_group` reales,
   nunca un catálogo ficticio).
7. **Canary controlado** — si existe mecanismo para servir el modelo nuevo a
   una fracción del tráfico; si no existe, documentarlo como una limitación
   antes de proceder directo a producción completa.
8. **Producción** — cambiar `OPENROUTER_MODEL` (y evaluar si
   `OPENROUTER_FALLBACK_MODEL`/`OPENROUTER_JUDGE_MODEL` deben diversificarse
   en vez de seguir apuntando al mismo modelo que el principal, como están
   hoy).
9. **Monitoreo** — repetir la medición de T029 (misma metodología, mismas
   fuentes) sobre una ventana con tráfico real suficiente.
10. **Rollback** — ver criterios en la sección J. Revertir es un solo cambio
    de variable de entorno, sin tocar código ni base de datos.

---

## J. Criterios de rollback (observables, no subjetivos)

Revertir `OPENROUTER_MODEL` al valor anterior si, medido con la misma
metodología de T029, ocurre cualquiera de:

- **Aumento significativo de `resultado=error`** (Compuerta 1 — Zod) por
  turno, respecto al modelo anterior en el mismo tipo de tráfico.
- **Aumento de `resultado=rechazado`** que no se explique por un cambio real
  en lo que piden los clientes (i.e., el modelo nuevo propone operaciones que
  no resuelven contra el catálogo con más frecuencia).
- **Divergencia entre lo que el LLM le dice al cliente y lo que
  `conversation_state` realmente guardó** — exactamente el patrón que T028
  encontró y corrigió; si un modelo nuevo lo reintroduce por otra vía, es
  motivo de rollback inmediato, no de parche.
- **Aumento de latencia** (`ms_modelo`) más allá de un umbral que el dueño
  del negocio considere aceptable para la experiencia del cliente.
- **Aumento de llamadas al modelo por turno** (por ejemplo, si el modelo
  nuevo dispara más reintentos de Nivel 2 por salida inválida).
- **Aumento de handoffs** (`categorias.has("handoff")` en `[traza]`) sin que
  haya un aumento correspondiente en la dificultad real de las conversaciones.
- **Cualquier fallo de structured output** que no exista con el modelo
  actual (el `bruto.ok === false` de `chatJson`, o el reintento de Nivel 2 de
  `chatJsonConEstado` fallando repetidamente).

Ninguno de estos criterios depende de una opinión — todos son contables
directamente desde `[metrica]`/`[traza]`, con la misma metodología que este
documento y el informe T029 ya dejaron establecida.

---

**Este documento no autoriza ni programa ningún cambio de modelo. Es
material de referencia para cuando esa decisión se tome explícitamente,
después de revisar el checkpoint de T029.**
