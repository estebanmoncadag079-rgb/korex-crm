# 156 — Decisión de arquitectura del motor conversacional de Korex

7-sep-2026. **Auditoría y diseño, sin implementación.** Ningún archivo de
código, esquema, migración o prompt fue tocado para producir este documento.
Todo lo que sigue está anclado en código real (`archivo:línea`), en incidentes
ya documentados en esta carpeta, o en los dos bugs de producción corregidos
esta misma semana (duplicación de `notify_order` y "¿tienen chocolate
blanco?"), cuyo diagnóstico completo se usó como evidencia de primera mano.

## 1. Objetivo

Determinar si Korex necesita un orquestador (o cualquier otra capa nueva)
para su motor conversacional, o si el problema real es otro. La pregunta que
manda no es "¿qué arquitectura de agentes es la más moderna?" sino: **¿qué
categoría de errores sigue produciendo Korex, y qué pieza —si falta
alguna— los cerraría de raíz en vez de uno por uno?**

Veredicto adelantado (desarrollado en las secciones 8 y 12): **no hace falta
un orquestador general, un clasificador de intención, una state machine para
toda la conversación ni un framework multi-agente.** Hace falta una pieza
pequeña y muy específica —una autorización previa a cualquier acción
IRREVERSIBLE, respaldada por hechos que el backend ya posee— que hoy no
existe como concepto único: existe repetida, a mano, una vez por incidente.

## 2. Estado actual — reconstrucción del flujo real

### 2.1 El camino de un mensaje, con archivo y línea

```
MENSAJE ENTRANTE (webhook YCloud/Meta)
  └─ src/server/inbox/ingest.ts → processMessagesValue()
       dedup por wa_message_id, guarda el mensaje, decide si despierta al agente
       (ventana 24h, eco propio, handoff activo, IA apagada)
  └─ src/server/ai/cola.ts → encolarTurno()
       INSERT ... ON CONFLICT (coalescencia): un turno pendiente por conversación,
       el `run_at` se empuja con cada mensaje nuevo (debounce compartido entre réplicas)
  └─ worker (src/server/ai/worker.ts) → tomarTrabajo()
       UPDATE ... FOR UPDATE SKIP LOCKED: un turno a la vez por conversación,
       tope de concurrencia por organización, genera un `generation` (token de posesión)
  └─ src/server/ai/pipeline.ts → runAgentTurn(conversationId, opts)
       1. lee conversation + agentProfile + historial (HISTORY_LIMIT=20)
       2. entrantesSinResponder() calcula `pendientes` (qué quedó sin contestar)
       3. si state_source='backend': leerEstado() (conversation_state, Fase 2)
       4. arma `messages` (system prompt + historial) — buildAgentSystemPrompt()
       5. PRECHECKS deterministas (antes de la 1ª llamada al modelo):
          detectarConsultaFactualDeProducto/Pago → buscarProductos/resolverMetodoDePago
          → si aplica, inyecta un hecho [SISTEMA] YA VERIFICADO antes de preguntarle nada al modelo
       6. 1ª llamada al modelo → chatJson/chatJsonConEstado(AgentAction, messages)
       7. si state_source='backend': guardarEstadoPropuesto() valida la propuesta
          contra el catálogo real (validarPropuesta, orders/estado.ts) y la persiste
          — NUNCA bloquea la respuesta si no valida (ver 2.3)
       8. bucles de acciones INTERNAS (consult_availability, consultar_producto,
          consultar_medio_pago, consultar_domicilio): el backend resuelve el hecho
          real y se lo devuelve al modelo EN EL MISMO TURNO, hasta 2 veces
       9. GUARDARRAÍLES REACTIVOS (después de que el modelo ya respondió):
          inconsistencia financiera, cierre falso, cita fantasma, recurso
          prometido, contradice hecho verificado, niega disponibilidad sin
          verificar, pago sin verificar, turno mudo, pedido ya confirmado (NUEVO,
          6-sep-2026) — cada uno detecta un patrón y reintenta UNA vez con una
          corrección; si insiste, deriva a una persona
      10. switch(action.action) → EJECUCIÓN real: notify_order, book_appointment,
          reschedule_appointment, cancel_appointment, send_image, send_menu,
          update_lead, move_stage, handoff, reply
      11. siguePoseyendoElTrabajo() (fencing, Fase 11-A) antes de cada efecto
          externo — deliverReply, deliverImage, notifyTeam, book/reschedule/cancel
      12. applyHandoff() / clearHandoff() según corresponda
  └─ RESPUESTA (sendText/sendImage/sendDocument vía YCloud) o efecto de backend
     (fila nueva, notificación al equipo, cita creada)
```

Este flujo **ya existe, casi completo, hoy**. No es un pipeline plano e
ingenuo: tiene precondiciones deterministas antes del modelo (paso 5), un
validador de estado después (paso 7), consultas verificadas dentro del mismo
turno (paso 8) y una batería de guardarraíles reactivos (paso 9). El error
más común al diagnosticar Korex "desde fuera" es asumir que no hay ninguna
capa de decisión — la hay, solo que está repartida en 9 mecanismos distintos,
construidos uno por incidente, sin un contrato común entre ellos.

### 2.2 Quién decide qué, en la práctica

| Decisión | Quién la toma HOY | Evidencia |
|---|---|---|
| Interpretar lenguaje natural | El LLM | `chatJson`/`chatJsonConEstado` |
| ¿Existe el producto/opción/zona/método de pago? | El BACKEND, determinista | `buscarProductos`/`buscarOpciones` (`catalog/buscar.ts`), `resolverZonaDeEntrega` (`delivery/zonas.ts`), `resolverMetodoDePago` (`pagos/metodo.ts`) |
| ¿Hay cupo para una cita? | El BACKEND, determinista | `disponibilidadReal`/`disponibilidadRealMultiple` (`appointments/queries.ts`) |
| ¿El pedido propuesto es posible (producto real, cantidad válida, requisitos cubiertos)? | El BACKEND, determinista — pero **no bloqueante** | `validarPropuesta` (`orders/estado.ts:304`) |
| ¿El cliente CONFIRMÓ? | **El LLM**, leyendo el historial en prosa | `CONTRATO_DE_ACCIONES` (`prompts.ts:394`): "Cuando el cliente confirme un pedido... → notify_order" — instrucción en lenguaje natural, sin ningún dato estructurado que la respalde |
| ¿Esta confirmación es la MISMA que una anterior? | El BACKEND, determinista (recién corregido) | `registrarConfirmacionDePedido` (mensajes) + `ultimaConfirmacionDe`/producto nuevo (pedido) — `confirmacion-de-pedido.ts`, `pipeline.ts` |
| ¿El total/domicilio cuadra? | El BACKEND, determinista | `inconsistenciaFinancieraDePedido` (`anuncio-de-cierre.ts`) |
| ¿El texto de la respuesta miente sobre lo que se ejecutó? | El BACKEND, por regex, DESPUÉS del hecho | `anunciaCitaAgendada`, `anunciaCierre`, `prometeRecursoSinEnviar`, `confirmaPagoSinVerificar` |
| ¿Se puede ejecutar la acción AHORA (ownership, ventana 24h)? | El BACKEND, determinista | `siguePoseyendoElTrabajo` (`cola.ts:370`) |

La fila que more importa: **la confirmación de un pedido —el momento exacto
en que se dispara dinero, WhatsApp real al equipo y una fila permanente— es
la ÚNICA decisión de la tabla que sigue delegada 100% a la interpretación del
modelo sobre texto libre**, mientras que decisiones de mucho menor riesgo
(¿existe el producto?, ¿hay cupo?) ya pasan por un verificador determinista
desde hace semanas. Eso no es casualidad: es la secuencia real de incidentes
(sección 4) empujando la arquitectura, un guardarraíl a la vez, sin que nadie
haya escrito todavía la regla general que los unifica.

### 2.3 El hallazgo estructural más importante de esta auditoría

**Existen DOS "estados" del pedido, y no se hablan entre sí.**

1. `EstadoDelPedido` (`orders/estado.ts`) — Fase 2. Backend-validado, con
   catálogo real, correcto por diseño ("el LLM propone, el backend valida y
   es la fuente de verdad", `estado.ts:4`). Pero es **deliberadamente no
   bloqueante**: si la propuesta no valida, el turno sigue igual y el
   cliente recibe su respuesta (`estado.ts:1296-1301`, "un estado que no
   valida no puede convertirse en un turno perdido"). Es decir: es un canal
   de **observación y ayuda al modelo**, no una autoridad sobre lo que se
   ejecuta.
2. El `action` que decide el switch de `pipeline.ts` (paso 10 de 2.1) —
   viene de la interpretación libre del modelo sobre el historial, con
   guardarraíles reactivos parchados encima. **Nunca consulta
   `EstadoDelPedido.confirmado` ni `EstadoDelPedido.items` para decidir si
   ejecutar `notify_order`.**

La prueba más directa de que esto es un problema real, no teórico: **al
corregir el bug de reconfirmación esta semana (incidente 1, sección 4), la
solución NO pudo apoyarse en `EstadoDelPedido.confirmado`** —aunque ese campo
existe, se persiste cada turno y describe exactamente lo que hacía falta—
precisamente porque es un campo que **el propio modelo vuelve a proponer
cada turno**, así que un modelo confundido lo pondría en `true` otra vez sin
que eso demuestre nada. Hubo que construir una señal completamente aparte
(`ultimaConfirmacionDe` + verificación de producto nuevo contra `pendientes`)
que ni siquiera toca `conversation_state`. Ese es el síntoma exacto de un
estado fragmentado: la pieza que en teoría ya resuelve el problema no puede
usarse para resolverlo, porque no es autoritativa.

## 3. Mapa de responsabilidades

| Responsabilidad | Módulo actual | Quién decide | Fuente de verdad | ¿Determinista? | ¿Depende del LLM? | Riesgo |
|---|---|---|---|---|---|---|
| Intención (qué quiere el cliente) | Ninguno estructurado — el LLM la infiere dentro de su elección de `action` | LLM | Historial en prosa | No | Sí, 100% | Medio — sin clasificador aparte, pero tampoco hay evidencia de que un clasificador lo arreglara (ver 3.1 y 6) |
| Entidades (producto, zona, método de pago, servicio) | `catalog/buscar.ts`, `delivery/zonas.ts`, `pagos/metodo.ts`, `appointments/logic.ts` — 4 matchers independientes, mismo algoritmo copiado | Backend | Catálogo/tablas reales | Sí | No (una vez que el LLM decide CONSULTAR) | Bajo — cada uno ya se probó contra un incidente real |
| Tipo de entidad | Implícito en qué acción trae el campo (`consulta` es producto, `zona` es domicilio…) | — | — | — | — | Bajo hoy, pero no escala: cada entidad nueva es un matcher nuevo copiado, no una instancia de un tipo común |
| Contexto (qué pasó antes en la conversación) | `HISTORY_LIMIT=20` mensajes crudos + `[SISTEMA]` inyectados este turno | LLM interpreta | Historial de `message` | No | Sí | Alto — ver problema F |
| Estado (carrito, datos, reserva) | `EstadoDelPedido` (`conversation_state`) | Backend valida, LLM propone | `conversation_state.estado` | Sí (la validación) | Sí (el contenido) | Medio — correcto pero desconectado de ejecución (2.3) |
| Confirmación | Interpretación de texto libre por el modelo | LLM | Nada estructurado | No | Sí, 100% | **Alto** — fue el incidente 1 |
| Ambigüedad (varios candidatos) | `multiple_matches` en cada matcher; sin concepto común | Backend detecta, LLM pregunta | Resultado del matcher | Sí | Parcial | Bajo |
| Datos faltantes | `requisitosPendientesDe`/`validarPropuesta` | Backend | Ficha + `conversation_state` | Sí | No | Bajo |
| Precios | `product.precioCents`, `resolverZonaDeEntrega` | Backend | `product`, `delivery_zone` | Sí | No | Bajo |
| Disponibilidad (citas) | `disponibilidadReal` | Backend | `appointment`, `resourceService` | Sí | No | Bajo |
| Domicilio | `resolverZonaDeEntrega` + `EntregaVerificada` (Fase 10V-X, sin desplegar) | Backend | `delivery_zone` + `conversation_state.entrega` | Sí | No | Medio — persistencia entre turnos aún no está en producción (incidente 6) |
| Pago (qué método/si es válido) | `resolverMetodoDePago` | Backend | `ficha.pago.formas` | Sí | No | Bajo |
| Pago (número/cuenta exacta) | `ficha.pago.datosDeCuenta`, texto libre reproducido por el modelo | LLM reproduce | Ninguna verificación de fidelidad | No | Sí, 100% | **Alto** — incidente 2 |
| Acción propuesta | `AgentAction` (discriminated union, `actions.ts`) | LLM | — | — | Sí | — |
| Acción permitida (autorización) | Guardarraíles reactivos, uno por patrón, DESPUÉS de que el modelo ya decidió | Backend, pero solo para lo que ya tiene guardarraíl | Ad hoc por guardarraíl | Sí donde existe | Débil (parcial) | **Alto** — sección 3 (problema J) |
| Ejecución | `switch(action.action)` en `pipeline.ts` | Backend | — | Sí | No | Bajo (la ejecución en sí es sólida) |
| Handoff | `applyHandoff`/`clearHandoff` (`handoff-policy.ts`) | Backend, reglas de texto + inactividad | `conversation.handoffAt/handoffReason` | Sí | Parcial (detección de frases) | Medio — la reactivación automática reintroduce contexto viejo (incidente 10) |
| Idempotencia (mismo evento) | `UNIQUE` + claim atómico (`order_confirmation`, `agent_job.generation`) | Backend | Postgres | Sí | No | Bajo — muy sólido |
| Idempotencia (mismo pedido, evento distinto) | **No existía hasta el 6-sep-2026** | Backend (nuevo) | `order_confirmation` + `buscarProductos` sobre historial | Sí | No | Bajo ya corregido; **cero cobertura** para citas (`reschedule`/`cancel`) — hallazgo abierto |

### 3.1 Problemas estructurales, con evidencia (no opinión)

**A. Contexto confundido con intención.** `HISTORY_LIMIT=20` mensajes se
insertan crudos en `messages`; no hay ninguna marca de qué es "lo que se
está discutiendo ahora" contra "lo que ya se cerró". Doc
[151](151-CONTEXTO-TEMPORAL-EN-EL-HISTORIAL.md) documenta el caso literal:
un "Hola" tras 11 días de silencio se leyó como si el pedido de hace 11 días
siguiera vigente — se corrigió inyectando un `[SISTEMA]` de salto temporal,
pero solo para el silencio largo, no para el caso general.

**B. Intención anterior arrastrada al cambiar de tema.** Mismo mecanismo que
A: nada limpia "de qué se estaba hablando" cuando el tema cambia dentro de
la misma conversación activa (sin silencio de por medio). El incidente 1
(sección 4) es la variante más grave: el pedido ya cerrado se sigue leyendo
como objeto de conversación válido.

**C. Inferencia confundida con confirmación.** Ver 2.3 y la fila
"Confirmación" de la matriz. `notify_order` es la única acción irreversible
sin ningún hecho estructurado detrás de la decisión de disparar.

**D. Entidad confundida con otra entidad.** Doc 143 documenta exactamente
esto para productos: `coincide()` (`catalog/buscar.ts`) fusionaba "limón"
con "limonada" y "chocolate" con "choconuez" por compartir prefijo — corregido
esta semana (Fase 10S, sin desplegar). El mismo algoritmo de matching se
copió 4 veces (producto, opción, zona, servicio de cita); el bug se corrigió
en UNA de las cuatro copias.

**E. Acción propuesta confundida con acción permitida.** Es el problema J
descrito abajo, mirado desde el otro lado: nada impide, a nivel de tipo, que
el modelo "proponga" `notify_order` cuando el backend ya sabe que no
corresponde. La propuesta y el permiso viven en el mismo campo (`action`).

**F. Historial usado como fuente de verdad.** Confirmado en el propio
código: `pipeline.ts` arma `messages` a partir de `history` (20 mensajes
crudos) y dentro del `switch`, ninguna acción irreversible consulta una
fuente distinta al **texto que el modelo acaba de producir sobre ese
historial**. El backend interviene DESPUÉS (guardarraíles), nunca ANTES
como precondición de tipo "no ejecutes si no tienes esta prueba".

**G. LLM tomando decisiones que deberían ser deterministas.** Confirmación
de pedido (incidente 1), transcripción exacta de datos de pago (incidente 2),
mapeo de ocasión→categoría ("algo para cumpleaños", incidentes 4/5,
doc 143 lo declara TIPO B — abierto a propósito, sin backend detrás).

**H. Backend sin autoridad suficiente.** El propio `orders/estado.ts` lo
admite en su comentario de cabecera: es fuente de verdad para lo que
VALIDA, pero nunca bloquea el turno si no valida. Es coherente y correcto
para su propósito (no perder un turno por un error de extracción), pero deja
un vacío real: **no hay NINGÚN lugar donde el backend pueda decir "esta
acción no se ejecuta" antes del hecho**, salvo los guardarraíles reactivos
que corrigen DESPUÉS.

**I. Estado duplicado o fragmentado.** Ya cubierto en 2.3:
`EstadoDelPedido` vs. lo que realmente decide la ejecución. Se suma
`EntregaVerificada` (Fase 10V-X, sin desplegar) como un TERCER estado
paralelo, deliberadamente independiente de `state_source` por la razón
documentada en `estado.ts:625-636` — una decisión defendible dado el punto
de partida, pero que aumenta la fragmentación en vez de reducirla.

**J. Guardarraíles que existen porque falta una abstracción superior.**
La evidencia más contundente de todo este documento. Cuatro guardarraíles
independientes —cierre falso, cita fantasma, recurso prometido, pago sin
verificar— resuelven el MISMO problema: *"el modelo escribió con `reply`
algo que afirma una acción, y esa acción nunca se ejecutó."*
`anuncio-de-cierre.ts:118` lo dice con estas palabras: *"Mismo patrón que la
cita fantasma, con otra cara"*. Cada uno es una lista de expresiones
regulares calibrada contra un incidente real, con su propia corrección, su
propio texto, su propio reintento. Ninguno comparte código con los demás
más allá de copiar el molde. Un guardarraíl NUEVO nace cada vez que el
modelo encuentra una frase nueva para prometer algo que no hizo — no porque
falte inteligencia en el regex, sino porque no existe el concepto **"lo que
el texto afirma debe coincidir con lo que el `action` realmente ejecutó"**
como invariante de una sola pieza.

**K. Lógica de negocio dentro de `pipeline.ts`.** `pipeline.ts` mide más de
3.800 líneas en HEAD. Contiene: construcción del prompt, 4 bucles de
consulta verificada, 9 guardarraíles reactivos, el switch de 16 acciones, y
la lógica de idempotencia de `notify_order`. No es "espagueti" —cada bloque
está bien documentado y probado—, pero es un solo archivo que absorbe
CUALQUIER responsabilidad nueva, porque no hay un lugar obvio distinto donde
ponerla. Ese es el mecanismo concreto por el que "un incidente = un
guardarraíl más en este archivo" se ha vuelto el patrón por defecto.

**L. Herramientas difíciles de seleccionar por falta de clasificación
semántica.** No hay evidencia real de esto en el código: `AgentAction` es
un discriminated union con descripciones inline razonablemente claras, y
`esquema-json-de-accion.test.ts` obliga a mantenerlas sincronizadas.
Los incidentes de "eligió mal la acción" que sí existen (doc 141, "torta de
chocolate" no conectó con "Porción Chocolate") no eran de clasificación de
intención sino de **entidades** — exactamente el problema D, ya resuelto con
matchers deterministas, no con un router semántico nuevo.

**M. Acciones irreversibles sin precondiciones suficientes.** `notify_order`
(incidente 1, corregido), `book_appointment`/`reschedule_appointment`/
`cancel_appointment` (**sin corregir** — comparten el mismo patrón de
`notify_order` antes de esta semana: nada impide reconfirmar una cita ya
creada si el cliente escribe algo después que el modelo interprete como
nueva confirmación).

**N. Reutilización incorrecta de información de un pedido/cita anterior.**
Es el mismo mecanismo que A/B/C, mirado desde el dato: sin un límite
explícito de "hasta dónde llega ESTE pedido", cualquier dato de un pedido
cerrado (dirección, producto, total) sigue disponible para que el modelo lo
recicle en el siguiente. Doc 151 lo confirma para el caso de silencio largo;
el incidente 1 lo confirma para el caso de conversación activa sin
silencio.

## 4. Incidentes reales, analizados uno por uno

Para cada uno: causa raíz, módulo que decidió mal, qué faltó, y si el
problema es de LLM, arquitectura, estado, datos o autorización.

### 1. Pedido confirmado → mensaje nuevo → reconfirmación

- **Causa raíz**: `registrarConfirmacionDePedido` deduplica por hash de
  `pendientes` (los mensajes que disparan ESTE turno) — protege que el
  MISMO lote no confirme dos veces, pero un mensaje distinto genera una
  clave distinta. `handoff-policy.ts:21` (`HANDOFF_RESUME_HOURS=2`) reactiva
  el agente automáticamente, sin intervención humana, reintroduciendo TODO
  el historial —incluida la conversación de cierre ya resuelta— al modelo.
- **Módulo que decidió mal**: el LLM, en su segunda llamada, releyendo un
  historial sin ninguna marca de "esto ya se cerró".
- **Qué faltó**: una autoridad backend, independiente del texto, que
  respondiera "¿ya existe una confirmación vigente para este pedido?" antes
  de ejecutar.
- **¿LLM / arquitectura / estado / datos / autorización?**: arquitectura y
  autorización. El LLM se comportó de forma razonable dado lo que vio; el
  backend nunca tuvo la oportunidad de vetarlo.
- **Solución estructural**: la implementada esta semana —`ultimaConfirmacionDe`
  + verificación de producto nuevo contra el historial posterior— es
  exactamente la forma reducida de la pieza que falta en general (sección 7).

### 2. "¿Me regalas el número para transferir?"

- **Causa raíz**: `detectarConsultaFactualDeMedioPago` (`pagos/deteccion.ts`)
  solo reconoce "¿acepta X?" (booleano); no existe ningún patrón para "dame
  el dato exacto". `ficha.pago.datosDeCuenta` (`generador/ficha.ts:185-188`)
  es texto libre, "TAL CUAL se los va a dar el agente al cliente" — sin
  ninguna verificación de que lo reproducido coincida con lo guardado.
- **Módulo que decidió mal**: ninguno decidió activamente mal — es una
  AUSENCIA. El modelo transcribe de memoria un valor de alto riesgo
  (dinero real) sin que nada compare la transcripción contra el dato
  guardado.
- **Qué faltó**: una categoría de verificación distinta a "¿es cierto?"
  (binario) — "¿es EXACTAMENTE esto?" (fidelidad de un valor estructurado
  de alto riesgo).
- **¿LLM / arquitectura / estado / datos / autorización?**: datos y
  arquitectura. El dato existe y es correcto; la arquitectura no distingue
  "responder sobre un hecho" de "reproducir un valor exacto".
- **Solución estructural**: no una consulta verificada más (sería igual a
  las demás) — una categoría nueva de guardarraíl de FIDELIDAD: comparar el
  valor reproducido en el `reply` contra el dato guardado, byte a byte o por
  contención de dígitos, cuando el campo está marcado como "de alto riesgo"
  en la ficha (dinero, cuentas, teléfonos de destino).

### 3. "¿Tienen chocolate blanco?"

- **Causa raíz**: `buscarProductos` solo compara contra nombres de
  PRODUCTO; "chocolate blanco" es una OPCIÓN (`producto.grupos[].opciones[]`).
  "No encontrado en una fuente" se leyó como "no existe", sin consultar la
  segunda fuente.
- **Módulo que decidió mal**: el precheck determinista mismo
  (`detectarConsultaFactualDeProducto` → `buscarProductos`) — dio un
  `not_found` VERIFICADO pero incompleto.
- **Qué faltó**: `buscarOpciones` (construida esta semana) — el mismo
  patrón, un nivel más abajo en la jerarquía de entidades.
- **¿LLM / arquitectura / estado / datos / autorización?**: arquitectura
  (cobertura incompleta de un patrón ya correcto, no un patrón equivocado).
- **Solución estructural**: ya aplicada. Generaliza a: cualquier "no
  encontrado" en una jerarquía de entidades (producto → opción, servicio →
  variante) debe agotar TODOS los niveles antes de declarar inexistencia.

### 4 y 5. "Es de feliz cumpleaños" / "¿Tienes algo para cumpleaños?"

- **Causa raíz**: doc 143 clasifica estas preguntas como TIPO B
  (`143-VERIFICACION-FACTUAL-FORZADA.md:49`) — deliberadamente NO forzadas
  contra el catálogo real. Es una decisión correcta para su alcance
  original (no convertir cada pregunta abierta en una búsqueda estructurada
  imposible de acertar), pero deja sin cubrir la categoría completa
  "ocasión → recomendación": el modelo recomienda leyendo el catálogo en
  prosa, la misma ruta probabilística que causó el incidente original de
  "torta de chocolate".
- **Módulo que decidió mal**: ninguno con autoridad — es zona gris por
  diseño.
- **Qué faltó**: no un forzado de tipo A/B (correcto tal como está para
  preguntas realmente abiertas), sino una CATEGORÍA nueva de entidad
  ("ocasión") que el catálogo pudiera declarar (`product.ocasiones: []`,
  configurable por negocio) para que "cumpleaños" resuelva contra datos
  reales sin convertirse en una búsqueda de producto exacto.
- **¿LLM / arquitectura / estado / datos / autorización?**: datos —falta el
  campo en el catálogo, no falta backend genérico.
- **Solución estructural**: NO construir esto ahora. Es exactamente la
  clase de capacidad de vertical (Regla de Arquitectura #2: "capacidad
  reutilizable, nunca pensada para un solo cliente") que se implementa
  cuando un negocio real la necesite y se mida el impacto, igual que se hizo
  con `catalog_source`/`delivery_source`/`payment_source`.

### 6. Inconsistencia de domicilio (Kachipay)

- **Causa raíz**: `consultar_domicilio` verificaba la tarifa, pero esa
  verificación vivía SOLO en `messages` del turno donde se consultó — nunca
  se persistía. Un cliente que preguntaba la tarifa y confirmaba varios
  mensajes después perdía la verificación, y el modelo podía escribir
  cualquier número en el resumen.
- **Módulo que decidió mal**: el mismo patrón que el incidente 1 —
  información verificada, efímera, que el modelo tenía que "recordar" sin
  ningún respaldo backend.
- **Qué faltó**: persistencia de la verificación entre turnos.
- **¿LLM / arquitectura / estado / datos / autorización?**: estado.
- **Solución estructural**: `EntregaVerificada` (Fase 10V-X, `estado.ts:140`)
  ya la construye — **implementada, sin desplegar**. Es la MISMA forma de
  solución que el incidente 1 (un hecho backend que sobrevive al turno),
  aplicada a un dominio distinto, construida ANTES de que el patrón se
  reconociera como general. Evidencia adicional de que el patrón ya se está
  repitiendo por instinto, sin que nadie lo haya nombrado todavía.

### 7. Acción prometida pero no ejecutada

- **Causa raíz**: `reply` (texto libre) y la ejecución real de una acción
  (`send_image`, etc.) están completamente desacopladas a nivel de tipo. El
  modelo puede escribir "te comparto nuestro catálogo" sin emitir
  `send_image`. Documentado en vivo, doc
  [101](101-GUARDARRAIL-RECURSO-PROMETIDO.md): *"El modelo escribió la
  promesa con `reply` y nunca pidió la acción que de verdad manda algo."*
- **Módulo que decidió mal**: el LLM, generando texto sin la acción
  correspondiente; nada en el esquema lo impide.
- **Qué faltó**: la invariante genérica "un `reply` que afirma una acción
  debe venir acompañado de esa acción, o el sistema lo detecta" — hoy
  existe una vez por cada frase-molde encontrada en producción (4 familias
  de regex distintas: cierre falso, cita fantasma, recurso prometido, pago
  sin verificar).
- **¿LLM / arquitectura / estado / datos / autorización?**: arquitectura
  (falta la abstracción — problema J).
- **Solución estructural**: no urgente de resolver hoy (los 4 guardarraíles
  existentes cubren los casos reales conocidos), pero es el candidato
  número uno para una consolidación futura: un único verificador de
  consistencia texto↔acción, parametrizado por los verbos de compromiso de
  cada vertical, en vez de 4 archivos de regex independientes.

### 8. Cita prometida pero no creada

- **Caso real (7-ago-2026, doc 101)**: a un "si confirmo" suelto, sin nada
  agendado en la conversación, el modelo respondió *"¡Te agendamos para el
  jueves 13 de agosto a las 10:00 con Laura...!"* — con `reply`, no con
  `book_appointment`. Se inventó servicio, día, hora y especialista. No se
  guardó ninguna cita.
- **Módulo que decidió mal**: el LLM. `ANUNCIOS_DE_CITA`
  (`anuncio-de-cierre.ts:90-98`) es la misma familia del incidente 7,
  aplicada a citas.
- **Qué faltó / solución estructural**: idéntico al incidente 7 — es el
  MISMO problema de fondo (J), con otra cara de dominio.
- **¿LLM / arquitectura / estado / datos / autorización?**: arquitectura.

### 9. Pago declarado confirmado sin evidencia

- **Caso real**: la clienta avisó el MEDIO de pago ("pago por nequi") y el
  bot respondió "¡Recibimos tu pago con éxito!" — sin ningún comprobante.
  El prompt ya lo prohibía explícitamente y no bastó (doc
  [132](132-CONFIRMA-PAGO-SIN-VERIFICAR.md)).
- **Módulo que decidió mal**: el LLM, confundiendo "mencionó CÓMO va a
  pagar" con "YA pagó".
- **Qué faltó**: el mismo patrón texto↔acción del incidente 7/8, pero sin
  ninguna acción "acción de pago" que ejecutar contra la cual comparar —
  aquí no hay backend de pagos real (Korex no procesa pagos, solo los
  espera y verifica el comprobante a mano). El guardarraíl es
  necesariamente de texto (calibrado contra 82 respuestas reales, 0 falsos
  positivos), porque no hay una "verdad backend" de si el pago llegó — es
  la única categoría de los 10 incidentes donde el backend NO puede ser la
  autoridad, porque el hecho ocurre fuera del sistema.
- **¿LLM / arquitectura / estado / datos / autorización?**: LLM,
  genuinamente — este es el único de los 10 donde "el modelo se equivocó"
  SÍ es la causa suficiente, precisamente porque no hay ningún dato backend
  que pudiera haberlo evitado.
- **Solución estructural**: la que ya existe (guardarraíl de texto
  calibrado) es la correcta para este caso. No generalizar de más: no todo
  incidente tiene una fuente de verdad backend esperando a ser conectada.

### 10. Conversación reactivada después de handoff

- **Causa raíz**: mismo mecanismo que el incidente 1 —
  `shouldResumeByInactivity` (`handoff-policy.ts:94`, 2 horas) reactiva el
  agente automáticamente y reintroduce el historial completo, sin ninguna
  marca de qué parte de ese historial sigue "vigente". Doc
  [151](151-CONTEXTO-TEMPORAL-EN-EL-HISTORIAL.md) documenta el caso: un
  "Hola" tras 11 días de silencio se interpretó como si el pedido de hace
  11 días siguiera en curso.
- **Módulo que decidió mal**: el LLM, sin ninguna ayuda backend sobre
  antigüedad/vigencia del contexto que está leyendo.
- **Qué faltó**: exactamente lo mismo que el incidente 1 — es la MISMA
  causa raíz, dos síntomas distintos (uno dispara una acción irreversible,
  el otro solo confunde la respuesta).
- **¿LLM / arquitectura / estado / datos / autorización?**: arquitectura y
  estado.
- **Solución estructural**: doc 151 ya resolvió el caso de silencio largo
  (marca `[SISTEMA]` de salto temporal). El incidente 1 resolvió el caso de
  reconfirmación tras handoff. Falta la pieza que los une: un solo concepto
  de "vigencia del contexto" en vez de dos parches independientes que
  cubren cada uno una fracción del mismo problema.

### Síntesis de los 10 incidentes

7 de 10 comparten la MISMA causa raíz estructural: **falta una autoridad
backend, persistente entre turnos, que decida "esto sigue vigente / esto ya
se cerró / esto es una entidad real"**, en vez de dejar que el modelo lo
infiera del historial crudo cada vez. Los otros 3 (4/5 recomendación por
ocasión, 9 pago sin evidencia) son genuinamente distintos: uno es una
categoría de dato faltante en el catálogo, y uno es un caso donde el LLM
realmente es la única fuente posible. Ningún incidente de los 10 se explica
por "falta un orquestador que decida qué intención tiene el mensaje" — la
elección de acción, en sí, casi nunca fue la causa.

## 5. Alternativas arquitectónicas comparadas

| Alternativa | Exactitud | Confiabilidad | Complejidad | Latencia | Coste | Mantenibilidad | Observabilidad | Multi-tenant | Rollback | Riesgo regresión | Compatibilidad hoy | Migración |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. Actual mejorada (generalizar patrones ya probados) | Alta (ya evidenciado por 5+ casos resueltos) | Alta | Baja | Sin cambio | Sin cambio | Media (crece `pipeline.ts` salvo que se extraiga) | Ya tiene `[traza]` por turno (doc 145) | Ya scoped por diseño | Trivial (por archivo) | Bajo | Total | Ninguna |
| 2. Intent classifier tradicional | Media — no ataca ninguno de los 10 incidentes reales | Media | Media | +1 llamada o modelo propio | + | Media | Nueva | Igual | Media | Medio | Parcial | Media |
| 3. Intent + entity router | Media-alta para entidades (ya existe, disperso); intención no es el problema medido | Media | Alta | + | + | Baja si se generaliza el matcher | Nueva | Igual | Media | Medio | Parcial | Media-alta |
| 4. Decision orchestrator general | Depende del diseño; sobredimensionado para el problema medido | Media (más piezas, más fallos) | Alta | + | + | Baja al principio, alta a 2 años (nueva capa a mantener aparte del código de negocio) | Nueva, hay que construirla | Hay que rediseñarlo | Difícil (todo o nada) | **Alto** | Baja (reescritura de `pipeline.ts`) | Alta |
| 5. State machine (para TODA la conversación) | Baja — las conversaciones reales de Korex no son secuenciales (ver 6) | Alta para lo que modela, frágil para lo que no | Alta | Sin cambio | Sin cambio | Baja al principio, alta cuando aparece un estado no previsto | Nueva | Igual | Media | Alto | Baja | Alta |
| 6. Workflow engine (Temporal, etc.) | Alta para orquestación de pasos largos (recordatorios, campañas) | Alta | Alta (infra nueva) | + | ++ (otro servicio) | Media | Buena (nativa del engine) | Hay que diseñarlo | Media | Bajo si se usa SOLO donde ya se necesita (recordatorios) | Parcial | Media, acotada |
| 7. Multi-agente | Baja para este problema — ningún incidente de los 10 requiere más de un "razonador" | Baja (más superficie de fallo) | Muy alta | ++ | ++ | Baja | Muy difícil | Hay que rediseñarlo | Difícil | **Alto** | Baja | Muy alta |
| 8. LangGraph / framework externo | Depende del framework, no de Korex | Depende de una dependencia externa | Alta (curva + acoplamiento) | + | + | Media (menos código propio, más "magia" ajena) | Depende del framework | Hay que verificarlo | Difícil (atado al framework) | **Alto** | Baja | Alta |
| 9. Híbrida LLM + policy engine determinista, ACOTADA a acciones irreversibles | Alta (es la generalización directa de lo que ya funcionó 5 veces) | Alta | Baja-media | Sin cambio perceptible (ya se hacen 1-2 llamadas extra hoy) | Marginal | Alta (una pieza, un contrato) | Se extiende la traza existente | Ya scoped | Fácil (feature flag por acción) | Bajo | Total | Baja-media, incremental |
| 10. Otra: extraer el switch de ejecución a un módulo propio, sin motor de decisión nuevo | Igual a la actual | Igual | Baja | Sin cambio | Sin cambio | Alta (separa "decidir" de "ejecutar" sin inventar concepto nuevo) | Igual | Igual | Trivial | Bajo | Total | Baja |

**Selección: 9, combinada con 1 y con una versión acotada de 10** (no un
orquestador general — una "Policy" pequeña, específica de acciones
irreversibles, más la extracción de código como higiene, no como
arquitectura nueva). Se descartan explícitamente 4, 5, 7 y 8: ninguno de los
10 incidentes reales los necesita, y los cuatro comparten el mismo defecto —
alto riesgo de regresión, alta complejidad de migración, y ninguna evidencia
de que resuelvan una categoría de error que el patrón ya usado (consulta
verificada + guardarraíl reactivo) no resuelva igual de bien con muchísimo
menos riesgo.

## 6. Qué debe decidir el LLM (y qué no) — verificado contra el código, no contra la intuición

**Sí debe decidir/hacer el LLM** (confirmado por 6 semanas de uso real sin
incidentes en estas categorías):
- Entender lenguaje natural y mapearlo a UNA acción del contrato (`AgentAction`).
- Redactar texto natural, empático, en el tono del negocio.
- Decidir CUÁNDO consultar un hecho (`consultar_producto`, `consult_availability`…) — el modelo elige el momento, nunca el resultado.
- Detectar ambigüedad y preguntar (cuando el backend le devuelve `multiple_matches`).
- Interpretar referencias razonables dentro del turno actual ("el mismo de antes", "ese").

**No debe decidir el LLM** (cada uno con un incidente real que lo prueba):
- Si un producto/opción/zona/servicio EXISTE → `buscarProductos`/`buscarOpciones`/`resolverZonaDeEntrega` (incidente 3, doc 141/143).
- El precio o el total → siempre calculado por el backend (`normalizarPedido`).
- La disponibilidad de una cita → `disponibilidadReal`.
- **Si un pedido/cita YA fue confirmado** → recién movido al backend (incidente 1); antes de esta semana, sí lo decidía el LLM, y ahí estaba el bug.
- El valor EXACTO de un dato de alto riesgo (número de cuenta) → sigue sin backend, incidente 2 abierto.
- Si el negocio está abierto/cerrado → ya calculado por el servidor (`businessStatus`), con guardarraíl si el modelo lo contradice.

Verificación explícita pedida por el encargo: **ningún ejemplo de la lista
"qué no debe decidir" se aceptó porque fuera el esperado** — los seis están
respaldados por un incidente documentado con causa raíz confirmada, no por
la plantilla genérica de "un LLM nunca debe decidir precios."

## 7. La pieza que falta: contrato conceptual

No se propone un "Intent Orchestrator". Se propone una **Autorización de
Acciones Irreversibles** ("Policy" a partir de aquí), estrictamente acotada:
solo interviene para `notify_order`, `book_appointment`,
`reschedule_appointment`, `cancel_appointment` — las cuatro acciones que hoy
producen un efecto externo real e irreversible (mensaje de WhatsApp al
equipo, fila permanente, cita en la agenda de otra persona). Todo lo demás
del pipeline queda exactamente igual.

| Concepto | Significado en Korex | Quién lo produce | Quién lo modifica | Quién tiene autoridad | Dónde vive | ¿Persiste? | ¿Solo memoria del turno? |
|---|---|---|---|---|---|---|---|
| **Entity** | Un producto, opción, zona, servicio, método de pago — ya existe, disperso en 4 matchers | Backend (`buscarProductos` y análogos) | Nadie tras resolverse | Backend | Donde ya vive cada matcher — no se mueve | No (se resuelve cada vez, es barato) | Sí, del turno |
| **EntityType** | Implícito hoy (qué campo de la acción lo trae). No hace falta como tipo explícito — no hay evidencia de que su ausencia haya causado un incidente | — | — | — | — | — | — |
| **ProposedAction** | Lo que el LLM decide (`AgentAction` tal cual existe) | LLM | — | — | `actions.ts` (sin cambios) | No | Sí |
| **SourceAuthority** | Marca si un dato viene VERIFICADO por backend o INFERIDO por el modelo — hoy implícito en el nombre de la variable (`resultadoProducto` vs `action.summary`), nunca explícito en el tipo | Backend, al resolver una consulta verificada | Nadie | — | Se anota en la traza (`traza.ts`, ya existe parcialmente) | No hace falta persistirlo | Sí, del turno |
| **ConfirmationStatus** | **NUEVO, el único concepto realmente nuevo**: ¿esta acción irreversible ya tiene una confirmación vigente para ESTE objeto (pedido/cita)? | Backend, al ejecutar con éxito | Nadie directamente — solo se supera cuando el backend detecta contenido nuevo (producto nombrado de nuevo) | Backend, exclusivamente — el LLM nunca lo escribe | Tabla existente (`order_confirmation`) + su análogo para citas (no existe aún, hallazgo abierto) | Sí, en Postgres | No |
| **AllowedAction** | El resultado de pasar `ProposedAction` por la Policy: `{ok:true}` o `{ok:false, motivo, correccion}` | Backend | — | Backend | Nueva función pequeña por acción irreversible (no un motor genérico) | No | Sí, del turno |
| **ExecutionResult** | Ya existe (`notifyTeam`'s `NotifyResult`, `crearCitaMultiple`'s resultado) | Backend | — | Backend | Donde ya vive | Parcial (via `order_confirmation.notify_status`) | — |
| **Ambiguity** | Ya existe como `multiple_matches` en cada matcher — no hace falta un tipo común, ninguna evidencia de que la falta de uno haya causado un incidente | Backend | — | — | — | No | Sí |
| **MissingData** | Ya existe (`requisitosPendientesDe`, `dudas` de `Validacion`) | Backend | — | — | — | No | Sí |
| **State** | `EstadoDelPedido` — existe, correcto, pero desconectado (2.3) | LLM propone, backend valida | Backend | Backend (solo para lo que valida) | `conversation_state` | Sí | — |
| **TurnRelation** | **No existe hoy** como concepto explícito (qué relación tiene este turno con el anterior: continúa/cierra/es nuevo). Los incidentes 1/6/10 son variantes del mismo vacío | — | — | — | — | — | — |

**Deliberadamente NO se proponen** como tipos nuevos: `Intent` (la elección
de `action` ya cumple ese rol, y ningún incidente prueba que falte una capa
encima), `EntityType` (implícito, sin costo demostrado), `Policy` como motor
genérico de reglas (los 4 casos irreversibles caben en 4 funciones
pequeñas, una por acción — un motor de reglas sería la abstracción antes de
tener evidencia de que hace falta, exactamente el error que este documento
existe para evitar).

## 8. `conversation_state`: qué se reutiliza, qué se amplía

**No se propone crear un segundo `conversation_state`.** La tabla y el
mecanismo de `orders/estado.ts` (validación contra catálogo real,
versión optimista, registro de cambios campo a campo) son sólidos y ya
están probados. Se propone exactamente una ampliación, no un reemplazo:

- **Reutilizar tal cual**: `EstadoDelPedido.items/datos/reserva/totalCents`,
  el mecanismo de versión (`versionEsperada`), el registro de cambios.
- **Ampliar**: dar a `ConfirmationStatus` (sección 7) su propio lugar —
  NO dentro de `EstadoDelPedido` (que es propuesto por el modelo cada turno
  y por diseño no autoritativo), sino junto a `order_confirmation`, que YA
  es la tabla backend-only, nunca tocada por el LLM. Es la ubicación
  correcta por la misma razón documentada en `estado.ts:625-636` para
  `EntregaVerificada`: la independencia de `state_source` es exactamente lo
  que se necesita, porque los 3 negocios reales de pedidos ya tienen
  `catalog_source='tabla'` (necesario para la Policy) pero **no todos**
  necesitan el Fase 2 completo encendido para beneficiarse de la
  autorización de reconfirmación.
- **Por qué no ampliar `EstadoDelPedido` en su lugar**: haría el mismo
  campo (`confirmado`) doblemente responsable — de lo que el modelo cree Y
  de lo que el backend autoriza — cuando el problema exacto de la sección
  2.3 es que esas dos cosas necesitan vivir separadas para que una no
  contamine a la otra.

## 9. Integración con `pipeline.ts`

**Opción D: convivir, con el switch de ejecución extraído como módulo
propio.** Ni reemplazar `pipeline.ts` (C es sobredimensionado: el 90% del
archivo — construcción de prompt, consultas verificadas, guardarraíles
reactivos existentes— no tiene ningún problema que justifique tocarlo), ni
meter la Policy DENTRO del switch actual (mezclaría, otra vez, "decidir" con
"ejecutar", el mismo patrón que causó el problema J).

Concretamente:
- `pipeline.ts` sigue orquestando el turno completo (construcción de
  prompt, bucles de consulta, guardarraíles de texto) — cero riesgo de
  regresión en el 90% del archivo que ya funciona.
- **Antes** de cada uno de los 4 `case` irreversibles del switch, una
  llamada a la Policy correspondiente (`autorizarNotifyOrder`,
  `autorizarBookAppointment`, etc.) — funciones nuevas, pequeñas, en un
  módulo nuevo (`server/ai/policy.ts` o junto a cada dominio:
  `orders/policy.ts`, `appointments/policy.ts` — a decidir en la
  implementación, no aquí).
- Si la Policy rechaza: mismo patrón YA EXISTENTE de reintento con
  corrección (usado por los 9 guardarraíles actuales) — no un mecanismo
  nuevo de control de flujo.

Riesgo de migración: bajo. Es agregar 4 llamadas a 4 funciones nuevas en 4
puntos ya identificados y ya modificados esta semana para 1 de los 4
(`notify_order`).

## 10. Guardarraíles — auditoría y clasificación

| Guardarraíl | Archivo | Tipo |
|---|---|---|
| `siguePoseyendoElTrabajo` (ownership fencing) | `cola.ts:370` | **TIPO 1** — seguridad de concurrencia, debe permanecer intacto |
| `UNIQUE(conversation_id, idempotency_key)` en `order_confirmation` | `schema.ts` | **TIPO 1** — permanece |
| `ultimaConfirmacionDe` + verificación de producto nuevo | `pipeline.ts`, `confirmacion-de-pedido.ts` | **TIPO 4** — pertenece al backend; es exactamente el germen de la Policy (sección 7), ya vive donde debe |
| Consultas verificadas (`consultar_producto`, `consult_availability`, `consultar_domicilio`, `consultar_medio_pago`) | `pipeline.ts` (bucles), `catalog/deteccion.ts`, `pagos/deteccion.ts` | **TIPO 2** — patrón general, correcto, debería ser lo que el futuro motor GENERALIZA (nueva entidad = nuevo matcher con la misma forma), no lo que reemplaza |
| `inconsistenciaFinancieraDePedido` | `anuncio-de-cierre.ts` | **TIPO 2** — regla de negocio genérica (el total debe cuadrar), candidata a vivir dentro de la Policy de `notify_order` en vez de aparte |
| Cierre falso / cita fantasma / recurso prometido / pago sin verificar | `anuncio-de-cierre.ts` | **TIPO 2, con reserva** — cuatro instancias del MISMO patrón (problema J); no se recomienda eliminar ninguna hoy (cada una previene un incidente real y calibrado), pero si en el futuro se construye el verificador texto↔acción genérico de la sección 4 (incidentes 7/8), estas cuatro deberían colapsar en uno |
| Turno mudo (`textosAlCliente(action).length === 0`) | `pipeline.ts` | **TIPO 1** — garantía de UX básica, sin relación con el motor de decisión, permanece |
| `send_image`/`send_menu` degradan a `reply` si no hay recurso | `actions.ts`, `pipeline.ts` | **TIPO 1** — comprobar el hecho antes de prometer, principio ya correcto, permanece |
| Financiero/domicilio persistido (`EntregaVerificada`) | `estado.ts` (sin desplegar) | **TIPO 2** — mismo patrón que `ConfirmationStatus`; candidato a fusionarse conceptualmente cuando se implemente la Policy (ambos son "hechos backend que sobreviven al turno") |

**Ningún guardarraíl se recomienda eliminar en este documento.** Coherente
con la instrucción del encargo: no se propone quitar código para reducirlo,
solo se clasifica para saber cuáles absorbe la nueva pieza (TIPO 2/4) y
cuáles quedan exactamente donde están (TIPO 1).

## 11. Estrategia de evals

Casos base = los 10 incidentes reales de la sección 4, más los ya cubiertos
por guardarraíles existentes (torta de chocolate, Nequi, alergia, cierre
falso, cita fantasma — ya tienen `tests/unit/*.test.ts`, reutilizables tal
cual como evals, no hace falta reinventarlos).

Cada caso nuevo debe evaluar, como pide el encargo:

```
caso: { mensaje, historial_previo, estado_previo }
  → intención esperada (la acción que DEBERÍA elegir el modelo)
  → entidad esperada (si aplica: producto/zona/servicio resuelto)
  → relación con turno anterior (continúa / pedido nuevo / fuera de tema)
  → estado esperado tras el turno
  → datos confirmados (qué debía saber ya, sin volver a preguntar)
  → ambigüedad esperada (si corresponde, multiple_matches)
  → acción propuesta por el modelo (lo que realmente devuelve)
  → acción PERMITIDA por la Policy (lo que el backend deja ejecutar)
  → resultado final esperado (qué le llega al cliente / al equipo / a la BD)
```

Esto ya es, casi campo por campo, lo que la traza por turno (doc 145,
`registrarTrazaDelTurno`) captura hoy — **la infraestructura de evaluación
ya existe**, solo falta convertir la traza en aserciones automatizadas en
vez de un log para revisar a mano. Ejecución: como los tests actuales
(`pnpm test`), en CI/gate local antes de cualquier deploy — mismo mecanismo
que ya obliga `CLAUDE.md`, no un pipeline de evaluación aparte.

## 12. Arquitectura objetivo

```
ENTRADA (webhook, ya sólido)
  → COLA (cola.ts, ya sólida: debounce, ownership, reintentos)
    → INTERPRETACIÓN (LLM + prompt, con precondiciones deterministas YA delante
       para hechos consultables: producto, zona, pago, disponibilidad)
      → PROPUESTA (AgentAction — sin cambios de forma)
        → [NUEVO, SOLO PARA LAS 4 ACCIONES IRREVERSIBLES] POLICY:
             ¿existe ConfirmationStatus vigente para este objeto?
             ¿el contenido nuevo del turno lo supera?
             → AllowedAction { ok, motivo }
        → GUARDARRAÍLES REACTIVOS (los que ya existen, sin tocar)
      → EJECUCIÓN (switch actual, sin cambios de estructura)
    → RESULTADO (efecto real: mensaje, fila, notificación)
  → RESPUESTA
```

Esto usa la estructura ENTRADA→INTERPRETACIÓN→DECISIÓN→POLÍTICA→BACKEND→
EJECUCIÓN→RESULTADO→RESPUESTA sugerida en el encargo, pero **no porque el
encargo la sugiriera**: coincide, campo por campo, con el flujo que YA
existe hoy en `pipeline.ts` (sección 2.1), con una sola inserción nueva
(POLÍTICA, acotada a 4 acciones). Si la evidencia hubiera señalado un flujo
distinto —y se buscó activamente esa posibilidad en la sección 3— este
documento diría otra cosa.

## 13. Plan de migración

**FASE 0 (ya hecha, esta semana)**: la Policy de `notify_order`
(`ultimaConfirmacionDe` + verificación de producto) es, sin haberlo
planeado así, la primera instancia real de la sección 7. Sirve como prueba
de concepto ya desplegada y en producción.

**FASE 1 (hecha, 9-sep-2026)**: `orders/policy.ts`. Se extrajeron dos cosas:
la DECISIÓN de si un turno puede confirmar (`puedeConfirmarPedido`, con el
contrato `AllowedAction` de la sección 7 — `{ok:true}` o `{ok:false, motivo,
correccion}`) y la EJECUCIÓN del cierre (`ejecutarConfirmacionDePedido`, las
196 líneas del `case`). `pipeline.ts` pasó de 4.933 a 4.755 líneas.

La línea de corte es "decidir vs. reaccionar": la Policy devuelve un
veredicto y nada más — reintentar con el modelo, derivar a una persona y
anotar la traza siguen en el pipeline, que es quien conduce el turno. Los
efectos que el pipeline posee (`deliverReply`, `asegurarOwnershipVigente`,
`appendLeadNote`, `applyHandoff`) se pasan por parámetro: evita el ciclo de
imports entre los dos módulos y deja explícito todo lo que la Policy puede
tocar del mundo exterior.

**El guardarraíl financiero se dejó fuera a propósito**, aunque esta fase lo
nombraba. No es una decisión sobre la acción propuesta sino una comprobación
sobre el TEXTO que el modelo va a enviar, y vive entretejida con el bucle de
reintentos del turno: moverlo sería reescribirlo, y esta fase se definió como
riesgo cero.

Ganancia inesperada: la decisión era imposible de probar sola —hacía falta
montar el pipeline entero— y ahora es una función pura con seis pruebas
(`tests/unit/policy-pedido.test.ts`) que cubren sus cuatro caminos.

**FASE 2 (hecha, 8-sep-2026)**: construir el equivalente para `book_appointment` — tabla
`appointment_booking_confirmation` (ya diseñada en el trabajo no
comiteado de esta sesión, Prioridad 5 del "Programa de mejora integral" —
reutilizable) + la misma verificación de "servicio nuevo mencionado desde
la última reserva" usando `buscarServicio`. Cierra el hallazgo M de la
sección 3 para citas.

**FASE 3 (hecha, 8-sep-2026)**: extender a
`reschedule_appointment`/`cancel_appointment` — quedaron con la misma
idempotencia y el mismo barrido de reintentos que el cierre de pedidos
(`appointment_booking_confirmation.kind`, migración 0042).

**FASE 4** (opcional, sin fecha): si aparecen 2+ incidentes NUEVOS de la
familia "texto promete, acción no ejecuta" (incidentes 7/8) después de las
fases 1-3, considerar consolidar los 4 guardarraíles de esa familia en un
verificador único. No antes: consolidar sin una tercera repetición real
sería diseñar sobre suposición, exactamente lo que este documento existe
para evitar.

**Qué permanece intacto en las 4 fases**: `cola.ts`, el switch de
ejecución, los 9 guardarraíles reactivos existentes, `EstadoDelPedido`/Fase
2, el contrato `AgentAction`, el prompt, YCloud/ingest. **Qué se modifica**:
la ubicación de 1 `case` por fase (extracción, no reescritura) + 1 tabla
nueva por vertical irreversible que aún no la tenga. **Qué se deprecia**:
nada. **Qué se mantiene temporalmente sin tocar**: `reschedule`/`cancel`
appointment sin protección hasta la Fase 3 — riesgo conocido, documentado,
aceptado hasta entonces.

Rollback en cada fase: revertir el commit de extracción (Fase 1-3 son
mudanzas de código, no cambios de esquema irreversibles salvo la tabla
nueva de Fase 2, que es puramente aditiva y con su propio rollback en SQL,
mismo patrón que toda migración de este proyecto).

## 14. Riesgos

- **Riesgo de sobre-generalizar la Policy antes de tener 3+ casos reales
  por acción.** Mitigado por el plan de migración: una acción a la vez,
  nunca un motor genérico de reglas de entrada.
- **Riesgo de que `EstadoDelPedido`/Fase 2 y `ConfirmationStatus` terminen
  divergiendo igual que hoy divergen `EstadoDelPedido` y la ejecución.**
  Mitigado a propósito: `ConfirmationStatus` vive junto a
  `order_confirmation` (backend-only, nunca escrito por el LLM), no dentro
  de `EstadoDelPedido` — ver sección 8.
- **Riesgo de que extraer código de `pipeline.ts` introduzca una regresión
  silenciosa por transcripción.** Mitigado por la suite existente (185+
  archivos, 1850+ pruebas) como red antes de cada fase.
- **Riesgo real, no mitigado por este plan**: el incidente 2 (dato de pago
  exacto sin verificación de fidelidad) sigue abierto y no está en ninguna
  fase — es una categoría de guardarraíl distinta (fidelidad de valor, no
  autorización de acción) que merece su propio diseño, no incluido aquí
  por estar fuera del alcance de "motor conversacional" estricto.

## 15. Decisiones descartadas

- Orquestador general de intención (C) — sin evidencia de que la elección
  de intención sea la causa de algún incidente real.
- State machine para toda la conversación (E) — las conversaciones reales
  no son secuenciales; forzarlas a estados predefinidos rompería el 90%
  de los turnos que hoy funcionan bien sin ellos.
- Multi-agente (7) y LangGraph/framework externo (8) — alto riesgo, alta
  complejidad, cero evidencia de necesidad, dependencia externa no
  auditada por este equipo.
- Ampliar `EstadoDelPedido` para que también autorice ejecución (en vez
  de crear `ConfirmationStatus` aparte) — repetiría la mezcla de
  responsabilidades que causó el incidente 1.
- Tipar `Intent`/`EntityType`/`Policy` como conceptos genéricos nuevos en
  el código — sin evidencia de que su ausencia haya costado un incidente;
  se prefiere una función pequeña por acción irreversible.
- Resolver ahora el vacío de "ocasión → recomendación" (incidentes 4/5) —
  es una capacidad de vertical (Regla #2 de arquitectura), no un problema
  del motor; se implementa cuando un negocio real la necesite, medida
  primero.
- Eliminar cualquier guardarraíl existente — ninguno se identificó como
  puramente redundante; todos previenen un incidente real y calibrado.

## 16. Decisiones pendientes (para el dueño, no para esta auditoría)

- ¿Autorizar la Fase 1 (extracción de `notify_order` a `orders/policy.ts`)
  como primer paso, o esperar a acumular más evidencia con la Policy tal
  como quedó esta semana, dentro de `pipeline.ts`?
- ¿Priorizar el incidente 2 (dato de pago exacto) antes o después de citas
  (Fases 2-3)? Es el único hallazgo de "Alto" riesgo sin ningún trabajo
  iniciado.
- ¿Vale la pena, alguna vez, construir `product.ocasiones` (incidentes
  4/5) para algún cliente real, o el catálogo en prosa sigue siendo
  suficiente medido contra el volumen real de esas preguntas?
- Si en el futuro aparece un vertical genuinamente distinto (por ejemplo,
  uno con flujos de aprobación multi-paso, no solo confirmar/no
  confirmar), reevaluar si un workflow engine (alternativa 6) se
  justifica SOLO para ese caso — no para todo Korex.

---

## Apéndice: archivos revisados para esta auditoría

`src/server/ai/pipeline.ts` (completo, en profundidad — turno real,
incidentes 1 y 3 corregidos esta semana con lectura línea por línea) ·
`src/server/ai/actions.ts` (completo) · `src/server/ai/cola.ts` (completo) ·
`src/server/ai/confirmacion-de-pedido.ts` (completo, editado esta semana) ·
`src/server/ai/anuncio-de-cierre.ts` (guardarraíles, en profundidad) ·
`src/server/ai/handoff-policy.ts` (completo) · `src/server/orders/estado.ts`
(completo) · `src/server/orders/intencion.ts` (completo — confirmado
huérfano, sin ningún import en el resto del código) · `src/server/catalog/
buscar.ts` (completo, construido esta semana) · `src/server/catalog/
deteccion.ts`, `src/server/pagos/deteccion.ts` (completos) ·
`src/server/pagos/metodo.ts`, `src/server/delivery/zonas.ts`,
`src/server/catalog/queries.ts` (estructura/firmas) · `src/server/ai/
prompts.ts` (contrato de acciones, en profundidad) · `src/lib/db/schema.ts`
(tablas `conversation`, `conversation_state`, `order_confirmation`,
`agent_job`) · `docs/korexia/00-INDICE.md`, `101`, `132`, `142`, `143`,
`145`, `149`, `151` (incidentes documentados usados como evidencia) ·
`REGLAS-DE-ARQUITECTURA.md` (marco de decisión ya vigente en el proyecto).

No se leyeron línea por línea (solo estructura/firmas, sin impacto en las
conclusiones): `orders/normalizar.ts`, `orders/extraer.ts`,
`generador/conducta.ts`, `generador/generar.ts`, `appointments/queries.ts`
completo (se verificó su contrato de retorno, no su implementación
interna).
