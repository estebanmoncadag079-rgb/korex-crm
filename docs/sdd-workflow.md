# El flujo SDD (Spec-Driven Development)

## Cuándo se usa este flujo (Fase 4, 8-sep-2026)

Korex heredó el aparataje de Spec Kit del template de Vocero, que lo usó para
construir el producto base (`specs/001-vocero-core`, `specs/002-diseno-atlas-
white-label`). Para el trabajo normal de korex.ia como instalación real —
configuración de un cliente, capacidades de un vertical, capacidades
globales del CRM, incidentes— **este flujo NO aplica**: se resuelve y
documenta directo en `docs/korexia/`, siguiendo
[75-COMO-SE-DOCUMENTA.md](korexia/75-COMO-SE-DOCUMENTA.md). Ver la jerarquía
documental en [`CLAUDE.md`](../CLAUDE.md).

El flujo completo de abajo (`specify → clarify → plan → tasks → analyze →
implement`) se reserva para la categoría **"cambio arquitectónico"** de
[`REGLAS-DE-ARQUITECTURA.md`](../REGLAS-DE-ARQUITECTURA.md) — cuando una
solicitud obliga a modificar cómo funciona la plataforma, no solo su
configuración. Ahí sí: **specs antes de código**, con una especificación
previa que describa el **comportamiento observable**, no la implementación.
Las capacidades de Spec Kit siguen intactas y disponibles para ese caso.

## El flujo Spec Kit

```
specify → clarify → plan → tasks → analyze → implement
```

| Paso | Skill | Produce |
|------|-------|---------|
| Especificar | `/speckit-specify` | `spec.md` (qué y por qué, sin cómo) |
| Aclarar | `/speckit-clarify` | preguntas resueltas, encodadas en el spec |
| Planear | `/speckit-plan` | `plan.md` + research/data-model/contracts/quickstart |
| Tareas | `/speckit-tasks` | `tasks.md` (dependency-ordered) |
| Analizar | `/speckit-analyze` | chequeo de consistencia entre spec/plan/tasks |
| Implementar | `/speckit-implement` | el código, tarea por tarea |

Apoyos: `/speckit-checklist`, `/speckit-constitution`, `/speckit-taskstoissues`, y los
`/speckit-git-*` (feature branch, commit, init, remote, validate).

Cada feature vive en `specs/NNN-nombre/`. El `tasks.md` es tu **estado durable**: si se
corta el contexto, reanudas desde ahí.

## El Loop SDD (modo Objetivo)

Cuando das un **objetivo** en vez de micro-prompts, el orquestador corre este loop de forma
autónoma (skill `loop-sdd`), y vuelve a ti **solo** al verificar en vivo o al bloquearse:

```
        ┌─────────────────────────────────────────────┐
        │                                             ▼
   Discover ──► Plan ──► Execute ──► Verify ──► (¿verde?)
   (lee spec/   (plan/   (implement) (gate +     │  no → Iterate ┐
    código/     tasks/               self-test    │               │
    memoria)    analyze)             E2E +        │ sí            │
                                     camino       ▼               │
                                     infeliz)   ✅ Hecho          │
                                                                  │
        ◄─────────────────── diagnostica y corrige ───────────────┘
```

- **Discover** — Lee el estado real. Agrupa TODAS las preguntas bloqueantes y hazlas UNA
  vez. Si puedes resolver con defaults sensatos o leyendo el código, no preguntes.
- **Plan / Execute** — Spec Kit como arriba.
- **Verify (obligatorio, lo hace Claude)** — gate técnico **y** self-test de comportamiento
  E2E + camino infeliz. Evidencia observable, no un 2xx.
- **Iterate** — cada fix vuelve al loop, no a la bandeja del dueño. Sin *spin*.

### Condición de paro
- ✅ Objetivo verde **en vivo**, verificado por Claude, con evidencia.
- ⛔ Bloqueo real: decisión de producto ambigua · falta de credenciales/acceso · acción
  irreversible o hacia afuera (merge a `main`, borrado, comunicación externa, gastar
  dinero) · techo de costo/tiempo.

Ver la *Definición de Hecho REFORZADA* y *Modo Objetivo — Loop SDD* en
[`CLAUDE.md`](../CLAUDE.md).
