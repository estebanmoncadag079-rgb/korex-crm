# 150 — Varias horas sin ninguna traza en producción, con actividad real

27-ago-2026.

## El hallazgo

Al auditar el incidente de Lau (doc 149) se buscó la línea `[traza]`
correspondiente en los logs de producción y no apareció ninguna — de hecho,
`docker logs` del contenedor `korex-crm_crm` no mostró **nada** entre
2026-08-27 ~04:18 y ~12:23 UTC, pese a que en ese rango sí hubo actividad real
(confirmado luego: 19 turnos de IA reales, 11 de Lis Pastelería y 8 de Lashes
Valen, con respuestas correctas entregadas a clientes reales).

Se investigó como pidió el usuario: sin asumir la causa, descartando
hipótesis con evidencia antes de proponer nada.

## Hipótesis descartadas, con evidencia

- **Rotación de logs**: descartada. El driver es `json-file` con
  `max-size=10m`/`max-file=3`, pero el archivo real en disco
  (`/var/lib/docker/containers/.../*-json.log`) pesaba **6.7 KB** — muy lejos
  del límite — y no existía ningún archivo rotado (`.log.1`). Nunca rotó.
- **Disco lleno**: descartada. `df -h` mostró 23% de uso.
- **Memoria/OOM**: descartada. `free -h` con margen sano, `dmesg` sin ninguna
  entrada de "out of memory", `docker inspect` confirma `OOMKilled=false`.
- **Reinicio o cambio de instancia**: descartada. El contenedor
  (`98a33559df38`) arrancó a las 02:27:08 UTC y corrió CONTINUO durante toda
  la ventana muda y después (`RestartCount=0`, `Up` sin interrupciones según
  `docker service ps`); no hubo ningún redeploy ni segunda réplica en el medio.
- **Fallo del daemon de Docker**: descartada. `journalctl -u docker` en esa
  ventana solo tiene mensajes rutinarios de gossip de red, sin errores.
- **Bug en el código de `[traza]`**: descartada. Se reprodujo el pipeline REAL
  corriendo localmente contra la MISMA base de datos de producción
  (`pnpm probar:citas org_novxv78s08h12arzatr2 ...`) y cada turno generó su
  línea `[traza]` en la consola sin excepción — el código funciona.
- **"No había nada que registrar"**: descartada. Al principio pareció que sí
  (una consulta SQL directa a `message` no encontró nada en el rango), pero
  era un error de la propia consulta, no de producción: ver la nota de abajo.
  Con la comparación corregida, hay 19 turnos de IA reales en esa ventana.

### Nota técnica para quien vuelva a investigar esto con SQL directo

`message.created_at` es `timestamp WITHOUT time zone`. El valor almacenado es
la hora de Bogotá tal cual, sin marca de zona. Leído por el camino normal
(Drizzle/el driver), sale correcto con sufijo `Z` — pero si alguien compara a
mano contra un límite tipo `'2026-08-27T04:18:00Z'::timestamptz`, Postgres lo
convierte usando el timezone de la sesión y el resultado sale silenciosamente
mal (así se llegó, al principio, a la conclusión errónea de que no había
tráfico). Para un rango manual, comparar contra literales sin `Z` y sin cast a
`timestamptz` (`created_at >= '2026-08-26 23:18:00'::timestamp`).

## Segunda observación (28-ago-2026): también pasa turno por turno, no solo por horas

Al investigar un reporte distinto (Lis Pastelería, contacto "Laura Stefanny",
turno de las 18:02 del 27-ago) se buscó el `[traza]` de ESE turno puntual y
tampoco apareció — pero esta vez NO fue un apagón de horas: en la misma
ventana de 35 minutos, otra conversación de la MISMA organización sí dejó sus
7 líneas `[traza]` con total normalidad. Es decir, el problema también ocurre
de forma puntual, turno por turno, no solo como un apagón sostenido. Esto
encaja mejor con la hipótesis ya anotada (un atasco de `stdout` bajo
escritura concurrente) que con una causa que afecte todo el proceso por
horas — pero sigue siendo una hipótesis, no una causa confirmada.

## Lo que queda, sin confirmar

Descartado todo lo anterior, lo único que encaja con la evidencia (proceso
sano y continuo, sin errores de infraestructura, código correcto, actividad
real que sí se procesó y respondió bien a los clientes) es algún tipo de
estancamiento en la **entrega** de la salida estándar (`stdout`) del proceso
Node hacia el archivo de log del contenedor — un "atasco" que deja de
escribirse por un rato y luego se recupera solo, sin que el proceso se entere
(las respuestas a los clientes no dependen de ese canal, así que el servicio
nunca se vio afectado). **Esto es una hipótesis razonable, no un hecho
confirmado** — no se pudo verificar en vivo sin poder observar el proceso
mientras ocurre.

## Cobertura verificada de `registrarTrazaDelTurno`

Se confirmó que todos los caminos de salida de `runAgentTurn` que sí generan
una decisión pasan por `registrarTrazaDelTurno` (el punto único antes del
switch de ejecución, más los `return` tempranos de handoff y el de
`move_stage`, cada uno con su propio registro). El nuevo guardarraíl de la
Parte 1 (doc 149) también pasa por ahí sin problema — no necesitó ningún
cambio nuevo, solo se verificó.

Hay una ruta que **deliberadamente no genera traza**, y es correcta que no lo
haga: cuando la conversación ya está en manos de una persona (`handoffAt`
puesto), `runAgentTurn` sale antes de crear la traza — no hay turno de agente
ni decisión que trazar, solo enrutamiento. Está cubierta explícitamente por
el Escenario 10 de `tests/unit/pipeline-traza-del-turno.test.ts`, para que
quede documentado que es una ausencia por diseño, no un hueco.

`tests/unit/pipeline-traza-del-turno.test.ts` ahora cubre los 8 escenarios
pedidos: respuesta normal, consulta factual, guardarraíl, `book_appointment`,
handoff después del LLM, retorno anticipado antes del LLM (por diseño, sin
traza), excepción controlada del proveedor, y acción interna
(`consult_availability` con hecho verificado).

## Recomendación (NO implementada — requiere autorización aparte)

Para que la PRÓXIMA vez esto se pueda diagnosticar en minutos en vez de horas:
agregar un log de "latido" (`[heartbeat]`) cada pocos minutos desde el propio
worker en proceso (`src/server/ai/worker.ts`, que ya corre en el mismo
proceso y ya tiene un ciclo periódico — el mismo que hoy solo habla cuando
mueve tarjetas por enfriamiento). Si la próxima vez el latido también
desaparece, el estancamiento es total (algo bloquea TODA la salida del
proceso); si el latido sigue apareciendo pero `[traza]` no, el problema está
en otro lado más específico. Es un cambio mínimo, puramente diagnóstico, y
**no se implementó en este trabajo** — queda pendiente de que el usuario lo
autorice explícitamente.
