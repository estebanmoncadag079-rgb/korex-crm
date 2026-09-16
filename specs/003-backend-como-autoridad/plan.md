# Plan: 003-backend-como-autoridad

**Spec**: [spec.md](spec.md) · **Branch**: `003-backend-como-autoridad`

## Resumen

Paso 2 del plan aprobado el 15-sep-2026 y Principio 7 de `REGLAS-DE-ARQUITECTURA.md`.
Sustituye "el modelo propone el pedido/reserva completos" por "el modelo propone
operaciones de un conjunto cerrado, y el backend las valida y aplica sobre el estado
guardado". Sin dependencias nuevas, sin migración de esquema, sin llamada adicional al
LLM por turno.

## Contexto técnico

- **Lenguaje/stack**: TypeScript existente (Next.js 15, Drizzle/Postgres). Sin
  dependencias nuevas.
- **Almacenamiento**: reutiliza `conversation_state.estado` (JSONB, ya existe,
  `schema.ts:1598`). Sin migración: el `schema_version` de `EstadoDelPedido` sube en 1
  si cambia la forma interna de algún campo; si no cambia, no sube.
- **Pruebas**: Vitest para las operaciones como funciones puras (sin LLM) + suite
  existente de `tests/unit/pipeline-*.test.ts` + `pnpm probar:estado` /
  `probar:escenarios` / `probar:citas` contra datos reales.
- **Plataforma**: el monolito actual, sin cambios de despliegue.
- **Restricción dura** (viene del spec): cero llamadas nuevas al LLM por turno. Las
  operaciones viajan en la misma llamada donde hoy viaja `chatJsonConEstado`
  (`pipeline.ts:4884`).
- **Alcance (decidido 15-sep-2026):** los 2 verticales, en los 4 negocios, activados
  a la vez — no escalonado. El interruptor por organización (`state_source`/
  `catalog_source`, `auth/arquitectura.ts`) se conserva como mecanismo de reversión
  individual, pero no se usa como fase de observación previa: la verificación de los
  4 en verde ocurre ANTES de activar cualquiera, no progresivamente después.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I. Seguridad de datos | Sin cambio: no se introduce manejo nuevo de secretos ni de datos sensibles. **PASA** |
| II. Soberanía | Cero dependencias de runtime nuevas; todo vive en el adaptador OpenRouter y Postgres ya existentes. **PASA** |
| III. Multi-tenancy | Cada función de operación recibe `organizationId` y resuelve contra catálogo/agenda ya filtrados por `scoped()`. Se declara como requisito explícito de la Fase 1 de tasks. **PASA, con requisito explícito** |
| IV. Idempotencia | `order_confirmation` y `appointment_booking_confirmation` no cambian de contrato; siguen siendo la barrera anti-duplicado. **PASA** |
| V. Calidad verificable | Gate típico + pruebas nuevas de las operaciones como funciones puras. **PASA** |
| VI. Specs antes de código | Es la razón de este documento: cambia el contrato de `AgentAction`/`EstadoDelPedido`, compartido por el núcleo — spec.md ya escrito y en revisión. **PASA** |
| VII. Trazabilidad | Las 3 decisiones de negocio quedaron resueltas y registradas en `spec.md` ("Decisiones", 15-sep-2026), incluido el riesgo advertido y reafirmado del rollout simultáneo. **PASA** |
| VIII. Foco vertical | Pedidos y citas son los dos verticales ya soportados; no se amplía el dominio. **PASA** |
| IX. Verificación en vivo | Self-test con `probar:estado`/`probar:escenarios`/`probar:citas` contra los 4 negocios reales, en verde, **antes** de activar el interruptor en cualquiera — no hay fase de observación con uno solo primero, así que este gate es lo único que sustituye a esa observación. **PASA, con la compensación anterior como condición** |

**Sin violaciones.** Complexity Tracking: no aplica.

**Nota de riesgo (Principio VII):** el dueño confirmó explícitamente activar los 4
negocios y los 2 verticales a la vez, sin ventana de observación con uno solo,
advertido del precedente de MALIA (`auth/arquitectura.ts:6-12`). Queda registrado
aquí y en `spec.md` para que quien implemente no reintroduzca por su cuenta un
despliegue escalonado que ya no es lo acordado, ni tampoco omita la compensación de
la fila IX de arriba.

## Estructura del proyecto (rutas reales)

```text
specs/003-backend-como-autoridad/
├── plan.md              # este archivo
└── data-model.md        # el conjunto de operaciones y sus tres compuertas

src/server/
├── orders/
│   ├── estado.ts                # SIN CAMBIOS DE FORMA — EstadoDelPedido, guardarEstado, leerEstadoConVersion
│   ├── operaciones.ts            # NUEVO — aplica una Operacion sobre EstadoDelPedido: 3 compuertas, puro, sin I/O de red
│   └── policy.ts                 # AMPLÍA puedeConfirmarPedido: hoy solo mira idempotencia: pasa a leer el estado guardado
├── appointments/
│   ├── queries.ts                # SIN CAMBIOS — sigue siendo la única fuente de disponibilidad real
│   └── operaciones.ts            # NUEVO — mismo patrón que orders/operaciones.ts para la reserva
├── ai/
│   ├── actions.ts                 # CAMBIA — el bloque de "estado completo" de chatJsonConEstado se sustituye por el esquema de operaciones (data-model.md)
│   ├── pipeline.ts                # CAMBIA — en el punto de chatJsonConEstado (~4884) y validarPropuesta (estado.ts:304): aplicar operaciones en orden vía *operaciones.ts, no reemplazar el estado
│   └── notify-team.ts             # CAMBIA — el resumen al equipo se compone desde el estado guardado; el texto del modelo pasa a ser el mensaje para el cliente, no el registro
```

**Decisión de diseño — un módulo por vertical, no uno genérico.** `orders/operaciones.ts`
y `appointments/operaciones.ts` comparten la MISMA forma (tres compuertas, mismo tipo de
resultado) pero no código: cada uno resuelve contra su propio catálogo
(`buscarProductos` vs. `buscarServicio`/disponibilidad real) y sus propios requisitos.
Evita construir un motor genérico antes de tener dos casos reales que lo justifiquen —
mismo criterio que descartó el orquestador de intención en `docs/korexia/156`.

**Nada de esto toca:** `cola.ts`, la ingesta, el envío, la ventana de 24h, las cuatro
consultas verificadas (se reutilizan tal cual, son las que dan los identificadores), ni
ninguno de los 24 guardarraíles existentes.

## Siguiente paso

`/speckit-tasks` genera `tasks.md` (dependency-ordered) a partir de este plan y de
`data-model.md`, cuando el dueño lo pida. No se genera aquí.
