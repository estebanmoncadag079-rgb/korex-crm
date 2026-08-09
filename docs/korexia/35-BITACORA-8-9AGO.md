# Bitácora: 8 y 9 de agosto de 2026

> **Dentro:** El catálogo oficial del salón y los 12 retoques mal cotizados ·
> Diagnóstico de escalabilidad: la máquina no era el problema · La cola de
> turnos (fases 1 y 2) · Pruebas contra Postgres real, algo nuevo en el repo ·
> Desplegado y verificado · Lo que se decidió NO hacer

Sesión disparada por dos peticiones del dueño: cargar el catálogo oficial del
salón, y **"no me sirve que funcione con tres clientes, necesito que sirva
igual para 3 que para 100"**.

---

## 1. El catálogo oficial del salón y los 12 retoques mal cotizados

La dueña entregó el PDF oficial (LASHES VALEN STUDIO, 10 páginas). Al
contrastarlo con lo cargado a mano el 7-ago aparecieron **los 12 retoques con
el precio equivocado**: el agente habría cotizado un retoque de Volumen 3D en
20.000 cuando vale 80.000, y un Baby Volumen 2D en 30.000 cuando vale 75.000.

**Causa**: cada retoque tiene **dos precios** (10-15 días y 20 días) y se había
cargado uno solo por servicio, tomando valores de otra lista. Los 34 servicios
principales sí coincidían.

**Detalle que importa para la próxima vez**: el PDF es de Canva y su texto sale
**por columnas, con los precios desordenados** — en la página de Volumen
3D/Ruso/Americano salen invertidos. Cada precio se verificó **mirando la página
renderizada**, no la extracción de texto. Transcripción completa en
[32-CATALOGO-SALON.md](32-CATALOGO-SALON.md).

Ahora son 46 servicios (17 retoques) y hay categoría propia "Cejas y Lifting".
Aplicado y verificado en `org_novxv78s08h12arzatr2`.

## 2. Diagnóstico de escalabilidad: la máquina no era el problema

Antes de tocar nada se midió el VPS con los 3 clientes en producción:

| Recurso | Uso real |
|---|---|
| App | **93 MB RAM · 0,00 % CPU** |
| Postgres | 41 MB · 0,01 % CPU |
| Base completa | **16 MB** |
| Conexiones | 8 de 100 (pool `max: 10`) |

El servidor está ocioso. Lo que impedía crecer eran **seis decisiones de
diseño**, no capacidad — con el alta manual de clientes como techo real del
negocio, muy por delante de cualquier límite técnico. Diagnóstico completo en
[33-ESCALABILIDAD.md](33-ESCALABILIDAD.md).

Esto **revisita explícitamente la decisión del 3-ago** de no implementar
cola/RLS/rate-limit ([23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md)).
Aquella se tomó con el supuesto "un VPS de un núcleo operado por una persona",
y el supuesto cambió. La decisión de entonces no fue un error: fue correcta
para lo que se sabía.

## 3. La cola de turnos (fases 1 y 2)

El debounce del agente vivía en un `Map` de `globalThis` con `setTimeout`. Eso
ataba la instalación a **una sola instancia**: dos réplicas respondían dos
veces al mismo cliente, y un reinicio con un turno pendiente lo perdía para
siempre sin dejar rastro.

**El debounce y la cola son el mismo problema**, así que son una sola tabla:
`agent_job.run_at` es "cuándo toca ejecutarlo" y cada mensaje nuevo lo empuja.
Sin dependencias nuevas — con 10-25 clientes, `pg-boss` habría sido una pieza
más que mantener sin ganar nada. Cómo funciona:
[34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md).

También salió de memoria el **rate-limit** (con 3 réplicas, "10 intentos por
IP" eran 30) y ahora los **`webhook_event` fallidos se reprocesan** con espera
creciente: guardarlos (Fase 0 del 3-ago) evitó perderlos, pero nadie los
miraba y el cliente seguía sin respuesta.

## 4. Pruebas contra Postgres real: algo nuevo en el repo

Hasta ahora todas las pruebas eran unitarias, sin base. Con la coalescencia
viviendo en un índice único parcial y un `ON CONFLICT`, **el SQL pasó a ser la
lógica** — y un doble solo habría probado el doble.

Se añadió `tests/integration/`, que corre contra Postgres de verdad y **se
salta solo si no hay `TEST_DATABASE_URL`**, para que `pnpm test` siga
funcionando sin base a mano. Se ejecutaron contra una base desechable en el VPS
por túnel SSH (borrada al terminar). Receta en
[34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md).

Cubren lo que de verdad podía romperse: que dos workers no tomen el mismo
trabajo, que un turno colgado vuelva a la cola, los reintentos y el techo del
aplazamiento. **419 pruebas en verde**, typecheck y lint limpios.

> Los 2 errores que reporta vitest son de `ycloud-reintento-envio.test.ts`,
> **preexistentes** y ajenos a este cambio (una promesa rechazada sin manejar).
> Anotados como deuda en [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md).

## 5. Desplegado y verificado (9-ago, 05:25 UTC)

Los tres pasos completos: gate local → commit y push → `git archive` + `scp` a
`/etc/easypanel/projects/korex-crm/crm/code` (con respaldo previo en
`/root/code-respaldo-antes-sync-20260809-051951`) → Desplegar.

**Verificado DENTRO del contenedor**, como manda la regla que ya falló dos
veces:

```
[migrate] migraciones aplicadas      ← la aplicó el contenedor, no se tocó a mano
[worker] cola de turnos arrancada (1-01f60658)
```

Más `\d agent_job` en la base real (con su índice único parcial) y la cola
vacía. La migración se dejó al arranque del contenedor a propósito: aplicarla
a mano fue lo que tumbó el servicio el 3-ago.

## 6. Lo que se decidió NO hacer

- **Cambiar de servidor.** El VPS está al 2 % de su capacidad; migrar ahora
  sería resolver el único problema que no se tiene.
- **`pg-boss` u otra cola externa.** Una tabla con `run_at` cubre 100 clientes
  de sobra y no añade nada que mantener.
- **Subir a varias réplicas el mismo día.** El cambio lo habilita, no lo
  activa. Conviene separarlo del despliegue que lo hizo posible.
- **El ensayo de migración de base de datos.** Se explicó y quedó apuntado; no
  urge con 4 organizaciones, y no es lo que acerca a los 100 clientes.
