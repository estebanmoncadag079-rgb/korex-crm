# Tasks: 003-backend-como-autoridad

**Input**: Documentos de diseño en `specs/003-backend-como-autoridad/`

**Prerequisitos**: [plan.md](plan.md), [spec.md](spec.md), [data-model.md](data-model.md)

**Tests**: solicitados explícitamente en `spec.md` ("Cómo se prueba") — incluidos.

**Alcance del rollout** (decidido 15-sep-2026, ver `spec.md`): los 2 verticales, en
los 4 negocios (La Churra, Lis, Lashes Valen, MALIA), activados a la vez. Sin fase de
observación previa con uno solo — compensado por T025-T026 antes de activar nada.

## Formato: `[ID] [P?] [Story?] Descripción con ruta de archivo`

- **[P]**: paralelizable (archivo distinto, sin dependencia de una tarea sin terminar)
- **[US1]/[US2]/[US4]**: historia de usuario de `spec.md` a la que pertenece
- Setup, Foundational y la fase final no llevan etiqueta de historia

---

## Fase 1: Setup

**Propósito**: confirmar los supuestos del plan antes de escribir las compuertas.

- [X] T001 Confirmar que `EstadoDelPedido` no necesita cambio de forma (leer
      `src/server/orders/estado.ts:154-160` y `SCHEMA_VERSION` en `estado.ts:68`);
      dejar la conclusión como comentario de cabecera al crear T002.
- [X] T002 [P] Crear `src/server/orders/operaciones.ts` con el tipo `Operacion`
      (unión discriminada Zod, `data-model.md` sección 1: `agregar_item`,
      `cambiar_cantidad`, `quitar_item`, `elegir_opcion`, `declinar_grupo`,
      `fijar_dato`, `fijar_modalidad`, `confirmar`) y la firma de
      `aplicarOperacion`, sin implementar las compuertas todavía. **Ninguna referencia
      por id**: `agregar_item`/`cambiar_cantidad`/`quitar_item`/`elegir_opcion`/
      `declinar_grupo` llevan `ofrecible` (nombre) y, donde aplica, `opciones?`
      reutilizando **el tipo `OpcionPropuesta` ya existente**
      (`src/server/orders/normalizar.ts:34` — importarlo, no redeclararlo).
      **Corrección del 16-sep-2026**: la versión original de esta tarea incluía
      `cancelar` en la unión, con el estado vaciándose vía `estadoVacio()`. Se
      retiró: "cancelar/empezar de cero" ya existe hoy, determinístico
      (`matchesReinicio`/`borrarEstado`, `pipeline.ts:4571-4582`), y no debe
      convertirse en una decisión del modelo — ver `data-model.md` sección 1.
- [X] T003 [P] Crear `src/server/appointments/operaciones.ts` con el tipo `Operacion`
      de citas (`fijar_servicio`, `fijar_horario`, `fijar_especialista`, `fijar_dato`,
      `confirmar`) y la misma firma de `aplicarOperacion`. **Por nombre**:
      `fijar_servicio`/`fijar_especialista` llevan el nombre, `fijar_horario` lleva
      `fecha`/`hora`/`especialista?` — nunca un id de `offered_slot`.
      **Corrección del 16-sep-2026**: mismo motivo que T002 — sin `cancelar`;
      el mecanismo determinístico ya cubre `EstadoDelPedido.reserva` porque no
      distingue vertical (`pipeline.ts:1090-1098`). `cancel_appointment`
      (cancelar una cita YA confirmada, `ai/actions.ts:282`) sigue existiendo
      igual, fuera de este motor de operaciones.

---

## Fase 2: Foundational — el motor de las tres compuertas (bloqueante)

**Propósito**: nada de la Fase 3 en adelante puede escribirse sin esto. Son funciones
puras, probables sin encender el modelo (`data-model.md` sección 3).

**⚠️ CRÍTICO**: ninguna historia de usuario empieza antes de que esta fase esté completa.

**Dependencia real dentro de cada archivo — nada de esto es paralelo internamente.**
T004→T005→T006→T007 son ediciones **secuenciales del mismo archivo**
(`orders/operaciones.ts`): T007 (`aplicarOperaciones`) llama a las tres compuertas de
T004-T006, así que no puede escribirse antes de que existan. Dos agentes o personas
no deben tocar `orders/operaciones.ts` a la vez sin respetar este orden. Lo mismo para
T008→T009→T010 sobre `appointments/operaciones.ts`. **Lo único genuinamente paralelo
es la cadena completa de un vertical contra la del otro**, porque son archivos
distintos sin dependencia cruzada: T004 y T008 pueden empezar al mismo tiempo (ambos
solo necesitan T002/T003 respectivamente).

- [X] T004 [P] Compuerta 1 en `src/server/orders/operaciones.ts` (depende de T002):
      la operación existe en la lista cerrada y aplica a este vertical (Zod ya cubre
      la forma; añadir el chequeo de "vertical correcto" — un negocio de pedidos no
      acepta `fijar_servicio`).
- [X] T005 Compuerta 2 en `src/server/orders/operaciones.ts` (depende de T004, mismo
      archivo — NO paralelo): resolver el `ofrecible` (y `grupo`/`opcion` cuando
      aplique) **por nombre** contra el catálogo real, reutilizando
      `buscarProductos`/`buscarOpciones` de `src/server/catalog/buscar.ts` — ningún
      buscador nuevo. Para `cambiar_cantidad`/`quitar_item`/`elegir_opcion`/
      `declinar_grupo`, el nombre (+ `opciones?` si hace falta desambiguar) se
      resuelve contra `estado.items`, no contra el catálogo — es una línea que ya
      está en el pedido, no una nueva.
- [X] T006 Compuerta 3 en `src/server/orders/operaciones.ts` (depende de T005, mismo
      archivo — NO paralelo): adaptar las reglas de `validarPropuesta`/
      `normalizarPedido` (`src/server/orders/estado.ts:304`,
      `src/server/orders/normalizar.ts:751`) para validar UNA operación contra el
      estado actual, no un estado completo contra el catálogo.
- [X] T007 `aplicarOperacion` + `aplicarOperaciones` (lote, **atómico**) en
      `src/server/orders/operaciones.ts` (depende de T004-T006, mismo archivo — NO
      paralelo, y funcionalmente NECESITA que las tres compuertas ya existan porque
      las llama en secuencia para cada operación): fold en orden sobre una copia en
      memoria del estado guardado; si CUALQUIERA falla, descartar todo lo calculado y
      no llamar `guardarEstado` — el estado en la base no cambia (`data-model.md`
      sección 2, corregida 15-sep-2026: lote atómico, no persistencia parcial).
- [X] T008 [P] Compuerta 1 en `src/server/appointments/operaciones.ts` (depende de
      T003; en paralelo con TODA la cadena T004-T007 de arriba — archivo distinto,
      sin dependencia cruzada), análoga a T004.
- [X] T009 Compuerta 2 en `src/server/appointments/operaciones.ts` (depende de T008,
      mismo archivo — NO paralelo): resolver **por nombre**, nunca por id. Reutilizar
      `buscarServicio` (ya existe en el código — localizar su definición exacta antes
      de escribir; NO depende de crear `consultar_servicio`, que es un paso posterior
      y no bloqueante para esta feature) para `fijar_servicio`/`fijar_especialista`, y
      `src/server/appointments/queries.ts` (`disponibilidadRealMultiple`) para
      re-verificar que la tupla `fecha`/`hora`/`especialista?` de `fijar_horario`
      sigue siendo un horario real y disponible — nunca un id de `offered_slot`.
- [X] T010 Compuerta 3 + `aplicarOperacion`/`aplicarOperaciones` (lote, **atómico**)
      en `src/server/appointments/operaciones.ts` (depende de T009, mismo archivo —
      NO paralelo), análogo a T006-T007 para la reserva.
- [X] T011 Tests unitarios sin LLM (depende de T007 Y T010 — ambas cadenas completas):
      `tests/unit/orders-operaciones.test.ts` y
      `tests/unit/appointments-operaciones.test.ts` — cada compuerta rechazando por
      separado, y el caso central de la corrección: un lote de 3 operaciones donde la
      2ª pasa sus propias compuertas pero la 3ª falla → **cero cambios persistidos**,
      ni siquiera la 1ª y 2ª (el ejemplo de falla en `data-model.md` sección 6).

**Checkpoint**: el motor de operaciones queda probado de forma aislada, sin tocar
`pipeline.ts` todavía.

---

## Fase 3: US2 — El modelo propone operaciones, no estados (P1)

**Meta**: sustituir el "estado completo" que hoy emite el modelo por una lista de
operaciones, aplicadas sobre el estado guardado.

**Prueba independiente**: con el pipeline mockeado, un turno que solo menciona un
cambio de dirección no altera los ítems ya guardados (criterio #2 de US2 en spec.md).

- [X] T012 [US2] Sustituir `esquemaDelEstado` (`src/server/ai/pipeline.ts:4779-4869`)
      por el esquema de `Operacion[]` de `data-model.md` sección 1.
      **Corrección del 16-sep-2026**: implementado como función NUEVA
      (`esquemaDeOperaciones`), sin tocar `esquemaDelEstado` — decisión
      explícita de Esteban para que T012 no dependa de tocar T013/T014 (ver
      commit). `esquemaDelEstado` sigue viva y en uso hasta T013.
- [X] T013 [US2] Modificar `chatJsonConEstado` (`pipeline.ts:4884`) para que el campo
      que pide al proveedor sea `operaciones: Operacion[]` en vez del estado completo.
      **Nota (16-sep-2026)**: implementada junto con T014 en el mismo commit — cambiar
      lo que `chatJsonConEstado` devuelve rompe de inmediato su único llamador
      (`guardarEstadoPropuesto`), así que las dos tareas son atómicas en la práctica.
      `esquemaDelEstado` (la función vieja) se retiró: cero llamadores fuera de este
      punto, nada más dependía de ella.
- [X] T014 [US2] Donde hoy se llama `validarPropuesta` tras `chatJsonConEstado`:
      sustituir por `aplicarOperaciones` (T007/T010) sobre el estado leído con
      `leerEstadoConVersion` (`estado.ts:536`). **Lote atómico**: `guardarEstado`
      (`estado.ts:564`) se llama SOLO si el lote entero tuvo éxito; si cualquier
      operación falla, no se llama en absoluto y el estado en la base queda igual
      que antes del turno (`data-model.md` sección 2).
- [X] T015 [US2] Si el lote se detiene en un rechazo, encadenar la `correccion` de esa
      operación al mecanismo de reintento YA existente (el mismo patrón que usan los
      24 guardarraíles de `anuncio-de-cierre.ts`) — no crear un mecanismo nuevo.
      **Confirmado sin cambios adicionales**: el mecanismo genérico ya existente
      (`pipeline.ts`, `estadoRecienGuardado?.rechazo`) solo necesitaba que
      `guardarEstadoPropuesto` siguiera devolviendo `{motivos, preguntas}` — verificado
      con datos reales en `pipeline-propuesta-rechazada.test.ts`.
- [X] T016 [US2] (depende de T012-T015) Test de integración con el pipeline mockeado: un turno que solo
      cambia un dato no toca los ítems; una operación que nombra un producto
      inexistente en el catálogo rechaza en Compuerta 2 (no en Compuerta 1, que solo
      mira la forma).

**Checkpoint**: el modelo ya no reescribe el pedido/reserva completos. El guardarraíl
`producto-olvidado` debería dejar de dispararse en las pruebas de esta fase.

---

## Fase 4: US1 — El estado guardado decide el cierre (P1)

**Meta**: que `confirmar` decida leyendo el estado guardado, no el párrafo del modelo;
el resumen al equipo se compone desde el estado.

**Prueba independiente**: un intento de `confirmar` con el estado incompleto no
ejecuta el cierre, y el backend devuelve qué falta (criterio #2 de US1).

- [X] T017 [US1] Ampliar `puedeConfirmarPedido` (`src/server/orders/policy.ts:93`)
      para leer el estado guardado (ítems resueltos, total calculado, requisitos
      cubiertos) ADEMÁS de la verificación de idempotencia que ya tiene — sin
      quitarla. **Bug real encontrado y corregido en el camino (16-sep-2026)**:
      `aplicarOperacion` (T004-T006/T008-T010) nunca recalculaba el `totalCents`
      AGREGADO del pedido/reserva —solo el de cada línea—, así que confirmar
      habría rechazado SIEMPRE. Corregido en `orders/operaciones.ts` y
      `appointments/operaciones.ts` con un wrapper que recalcula el total tras
      cada operación, para los dos verticales.
- [X] T018 [P] [US1] Crear el equivalente para citas: la reserva solo se agenda si el
      backend tiene servicio resuelto, horario ofrecido por él y los requisitos
      cubiertos, contra `appointment_booking_confirmation`. Implementado como
      `puedeConfirmarCita` (`appointments/policy.ts`, nuevo) — sin el chequeo de
      idempotencia de pedidos (citas ya lo resuelve distinto, por lote de
      mensajes disparadores, `registrarConfirmacionDeCita`). Acotado a
      `reservas.length === 1`: el estado solo modela una reserva por
      conversación, así que `book_appointment` con varias personas sigue sin
      cambios.
- [X] T019 [US1] Componer el resumen al equipo (en el flujo de `notify_order`,
      `src/server/ai/notify-team.ts` y su punto de llamada) desde el estado guardado,
      no desde el `summary` de texto libre del modelo — mismo formato de mensaje de
      WhatsApp (decisión "déjalo como está"), cambia de dónde salen las cifras.
      **Ya existía** (`bloqueDeCifrasVerificadas`, Fase 11-C, anterior a esta
      feature): adjunta "Subtotal/Total" verificados al `summary`/`farewell` de
      `notify_order`, dejando el detalle de ítems y el tono al modelo — exactamente
      el diseño que pedía esta tarea. Lo único que faltaba era que usara el total de
      ESTE turno, resuelto con la reasignación de `estadoGuardado` de T017/T018.
      `notify-team.ts` no necesitó cambios: reenvía el `summary` ya compuesto sin
      tocarlo. Probado de punta a punta en `pipeline-operaciones-integracion.test.ts`.
- [X] T020 [US1] (depende de T017) Test: `confirmar` con un requisito obligatorio sin cubrir no
      ejecuta `ejecutarConfirmacionDePedido`; el cliente recibe la pregunta
      pendiente, no una derivación.

**Checkpoint**: el párrafo del modelo deja de ser el registro del pedido; pasa a ser
el mensaje que lee una persona.

---

## Fase 5: US4 — Un rechazo se conversa, no se deriva (P1)

**Meta**: ningún rechazo de operación ni fallo de formato del proveedor deriva
automáticamente a una persona.

**Prueba independiente**: reproducir el caso de `docs/korexia/144` ("Hola, buenas
noches" con un campo auxiliar omitido) y confirmar que ya no deriva.

- [ ] T021 [US4] Localizar el punto donde hoy un fallo de validación de Zod dispara
      handoff con `reason:"error"` (`pipeline.ts`, cerca del manejo de
      `chatJsonConEstado`/`chatJson`) y sustituirlo por reintento con la corrección
      (mismo mecanismo de T015) — nunca handoff automático.
- [ ] T022 [US4] Confirmar que derivar sigue siendo posible SOLO por decisión del
      negocio (el cliente lo pide, o una regla explícita de escalado) — no tocar
      `matchesHandoffIntent` (`src/server/ai/handoff.ts:10`) ni las reglas de
      escalado de la ficha.
- [ ] T023 [US4] (depende de T021-T022) Test de regresión del caso `docs/korexia/144`: reproducir el
      turno con el campo auxiliar omitido y confirmar 0% de derivación en repeticiones
      (mismo criterio de calibración que usó ese incidente: 71% → 0%).

**Checkpoint**: las 4 historias de usuario completas y probadas de forma aislada, sin
haber activado todavía ningún negocio real.

---

## Fase final: rollout simultáneo (4 negocios, 2 verticales) + verificación en vivo

**Condición de la Constitution Check (Principio IX)**: esta secuencia es la única
compensación por no tener fase de observación previa con un solo cliente. No se
salta ningún paso.

- [ ] T024 Gate técnico completo: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- [ ] T025 `pnpm probar:estado`, `pnpm probar:escenarios`, `pnpm probar:citas` contra
      los 4 negocios reales — los tres en verde ANTES de tocar cualquier interruptor.
- [ ] T026 Probar el apagado individual: con los 4 interruptores encendidos, apagar
      el de UNA organización y confirmar que las otras tres no se afectan (mitigación
      específica del riesgo aceptado del rollout simultáneo).
- [ ] T027 Activar `state_source`/`catalog_source` en los 4 negocios y los 2
      verticales a la vez, vía `arquitecturaAprobadaPara`/
      `validarConfiguracionArquitectonica` (`src/server/auth/arquitectura.ts`).
- [ ] T028 Verificación en vivo (Principio IX): ejercer al menos un turno real por
      negocio (agregar ítem/cambiar dato/confirmar, o agendar cita) y confirmar en la
      traza (`src/server/ai/traza.ts`) que el origen de la decisión de cierre es
      `backend`, no `llm`.
- [ ] T029 Medir los 3 números del Paso 1 del plan general (llamadas al modelo por
      turno, latencia, proporción `backend` vs `llm`) contra la línea base, y
      confirmar que la tasa de disparo de los 24 guardarraíles bajó o se mantuvo —
      nunca subió.
- [ ] T030 Documentar en `docs/korexia/` (siguiente número disponible tras el 157)
      el cambio completo: código + pruebas + documento + cómo revertir, en el mismo
      commit (regla de `CLAUDE.md`).

---

## Dependencias

- **Setup (Fase 1)** → sin dependencias, empieza de inmediato.
- **Foundational (Fase 2)** → depende de Setup. **Bloquea** las fases 3, 4 y 5.
- **US2 (Fase 3)** → depende de Foundational. Debe completarse antes que US1: la
  autoridad del estado (Fase 4) no tiene sentido mientras el modelo siga
  reescribiendo el estado completo.
- **US1 (Fase 4)** → depende de US2 (necesita que las operaciones ya mantengan el
  estado correctamente antes de confiar en él para decidir el cierre).
- **US4 (Fase 5)** → depende de Foundational (reutiliza el mismo mecanismo de
  reintento de T015). Puede desarrollarse en paralelo con US1 una vez completada US2.
- **Fase final** → depende de que Fases 3, 4 y 5 estén completas y probadas.

## Ejemplo de paralelismo — Fase 2

**Solo el INICIO de cada cadena es paralelo entre sí.** Todo lo demás, dentro de un
mismo archivo, es estrictamente secuencial — dos agentes no deben escribir
`orders/operaciones.ts` (o `appointments/operaciones.ts`) a la vez.

```text
# Lo único que puede empezar en paralelo, una vez creados T002 y T003:
Tarea A: "Compuerta 1 en src/server/orders/operaciones.ts (T004)"
Tarea B: "Compuerta 1 en src/server/appointments/operaciones.ts (T008)"

# El resto de cada cadena es secuencial DENTRO de su propio hilo:
# Hilo A: T004 → T005 → T006 → T007  (mismo archivo, un agente a la vez)
# Hilo B: T008 → T009 → T010          (mismo archivo, un agente a la vez)

# T011 espera a que AMBOS hilos terminen (T007 y T010) antes de empezar.
```

## Estrategia de implementación

**No hay MVP parcial**: las 4 historias son P1 y el rollout aprobado es simultáneo en
los 4 negocios y los 2 verticales — no se activa nada hasta completar las Fases 1-5.
El orden Fase 2 → 3 → 4 → 5 no es de prioridad de negocio (las 4 valen igual), es de
**dependencia técnica**: no se puede validar el cierre por estado (US1) antes de que
las operaciones mantengan el estado correctamente (US2), y ambas necesitan el motor
de compuertas (Foundational) primero.

1. Fase 1 + Fase 2 → motor de operaciones probado, sin tocar el pipeline real.
2. Fase 3 (US2) → el modelo ya no reescribe el pedido entero. **Detenerse y validar**
   con T016 antes de seguir.
3. Fase 4 (US1) → el estado manda en el cierre. **Detenerse y validar** con T020.
4. Fase 5 (US4) → los rechazos dejan de derivar. **Detenerse y validar** con T023.
5. Fase final → gate completo + verificación en los 4 negocios reales + activación
   simultánea + medición contra la línea base.
