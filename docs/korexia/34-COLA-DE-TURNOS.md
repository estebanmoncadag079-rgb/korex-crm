# La cola de turnos del agente

> **Dentro:** Qué cambió y por qué · Cómo funciona · El reparto entre clientes ·
> Qué mirar cuando algo va mal · Levantar varias réplicas · Probarlo con una
> base desechable

Implementación de las **fases 1 y 2** de
[33-ESCALABILIDAD.md](33-ESCALABILIDAD.md) (8-ago-2026). Sustituye el debounce
en memoria por una cola en Postgres.

## Qué cambió y por qué

Antes, el turno del agente vivía en un `Map` de `globalThis` con `setTimeout`
dentro de `server/ai/pipeline.ts`. Tres cosas fallaban:

| Síntoma | Causa |
|---|---|
| Dos réplicas responden dos veces al mismo cliente | Cada proceso tenía su propio temporizador. Estuvo a punto de pasar el 3-ago, cuando Swarm dejó dos contenedores vivos |
| Un reinicio deja a un cliente sin respuesta, sin rastro | El turno era un `setTimeout` en memoria: al morir el proceso, desaparecía |
| Un fallo del modelo se pierde en un `console.error` | No había reintentos |

Ahora el trabajo está en la tabla `agent_job` y lo ejecuta un worker
(`server/ai/worker.ts`) que corre dentro del mismo proceso de la app — pero
**puede haber varios a la vez**, porque el reparto lo hace Postgres con
`FOR UPDATE SKIP LOCKED`.

**Lo que NO cambió** es la conducta que ya se había afinado con clientes
reales: se espera `AGENT_COALESCE_MS` para agrupar las ráfagas, el primer
mensaje de una conversación se responde sin esperar (`immediate`), solo corre
un turno a la vez por conversación, y lo que llega a mitad de turno se atiende
junto en el siguiente.

## Cómo funciona

**El debounce y la cola son la misma cosa**: `run_at` es "cuándo toca
ejecutarlo". Cada mensaje nuevo empuja ese instante hacia adelante.

```
mensaje → encolarTurno()  ─┐
mensaje → encolarTurno()  ─┼→  UN registro en agent_job, run_at empujado
mensaje → encolarTurno()  ─┘        │
                                    ▼  (vence run_at)
                            worker: tomarTrabajo()  ← SKIP LOCKED
                                    │
                          runAgentTurn() ── ok ──→ DELETE
                                    └──── falla ─→ reintento con espera
```

Piezas, todas en `server/ai/cola.ts`:

| Función | Qué hace |
|---|---|
| `encolarTurno` | `ON CONFLICT` sobre el índice único parcial: si ya hay pendiente, empuja su `run_at` en vez de crear otro |
| `tomarTrabajo` | Toma uno vencido y lo marca `corriendo`. El `NOT EXISTS` impone un turno a la vez por conversación |
| `completarTrabajo` | Lo borra. La tabla guarda pendientes, no historia |
| `fallarTrabajo` | Reprograma con espera creciente (10 s, 1 min, 5 min, 15 min) hasta `MAX_INTENTOS`; después queda `fallido` |
| `rescatarHuerfanos` | Devuelve a la cola lo que quedó `corriendo` en un proceso muerto |

### El reparto entre clientes (9-ago-2026)

Ninguna organización puede tener más de **`CONCURRENCIA_POR_ORG` (2)** turnos
corriendo a la vez, de los 4 que atiende el worker. Se añadió al saber que
entraba un cliente que vende ~10× lo de Lis: sin tope, su hora pico se llevaba
los cuatro huecos y los demás negocios hacían cola detrás — sus clientes
esperando sin saber por qué.

Es un límite de **simultaneidad, no de cuánto se atiende**: lo que no entra
ahora entra en el sondeo siguiente, un segundo después. Va en el `WHERE` de
`tomarTrabajo`, así que lo aplica Postgres y vale igual con una réplica que con
cinco.

Cuatro constantes con motivo, no elegidas al azar:

- **`HUERFANO_TRAS_MS` = 5 min.** Tiene que ser holgadamente mayor que el turno
  más lento: rescatar demasiado pronto duplicaría una respuesta que todavía
  viene en camino, justo lo que la cola vino a evitar.
- **`ESPERA_MAXIMA_MS` = 45 s.** Techo del aplazamiento. Sin él, quien escribe
  sin parar no sería atendido nunca.
- **`CONCURRENCIA_MAX` = 4** (en `worker.ts`). Sin límite, una ráfaga de varios
  clientes lanzaría decenas de llamadas al modelo desde un VPS de un núcleo.
- **`CONCURRENCIA_POR_ORG` = 2.** La mitad del cupo: el negocio más grande
  nunca deja a los demás sin sitio.

## Qué mirar cuando algo va mal

Todo está en una tabla, así que se ve con SQL:

```sql
-- ¿Se está atascando algo?
SELECT status, count(*) FROM agent_job GROUP BY status;

-- Turnos que fracasaron del todo: un cliente se quedó sin respuesta.
SELECT conversation_id, attempts, last_error, updated_at
  FROM agent_job WHERE status = 'fallido' ORDER BY updated_at DESC;

-- Webhooks que aún no se pudieron procesar.
SELECT id, source, attempts, error FROM webhook_event
 WHERE status = 'fallido' ORDER BY received_at DESC LIMIT 20;
```

En los logs del contenedor: `[worker]` marca el arranque, los rescates y los
turnos agotados.

> ⚠️ **`status='fallido'` en `agent_job` significa que alguien no recibió
> respuesta.**

### Ya no hay que acordarse de mirarlo (9-ago-2026)

`monitor-bots-alerta.sh` (cron cada 15 min) vigila la cola y avisa por
Telegram. Se le añadieron dos señales que **el chequeo de salud de Docker no
puede ver**, porque en ambos casos la web responde con normalidad:

| Señal | Qué significa | Aviso |
|---|---|---|
| `status='fallido'` nuevos desde la última revisión | Alguien escribió y se quedó sin respuesta tras agotar los 5 intentos | 🔴 con el error registrado, para contestarle a mano |
| `pendiente` con `run_at` vencido hace **más de 10 min** | El worker no está vaciando la cola: **el bot está mudo con el contenedor sano** | 🟡 con la instrucción de reiniciar el CRM |

Diez minutos es margen de sobra: el debounce normal son segundos, así que ese
retraso no es carga, es que nadie está atendiendo la cola.

Los mensajes **no se pierden** cuando pasa: quedan en `agent_job` y se atienden
al reanudar. El total acumulado de turnos fallidos sale además en el latido
diario del monitor.

**Probado el 9-ago** insertando un `agent_job` fallido de mentira: la alerta
llegó a Telegram y la fila se borró después.

## Levantar varias réplicas

Ya es seguro, y es el motivo de todo esto. En EasyPanel se sube el número de
réplicas del servicio `korex-crm_crm`. Cada una arranca su worker y todas tiran
de la misma cola sin pisarse.

`AGENT_WORKER_ENABLED=0` deja una instancia que solo sirve el panel y no toma
turnos — útil para aislar un problema sin dejar de atender WhatsApp.

## Probarlo con una base desechable

Las pruebas de `tests/integration/` necesitan Postgres de verdad (el SQL **es**
la lógica: un doble solo probaría el doble) y se saltan solas sin
`TEST_DATABASE_URL`.

```bash
# 1. Base desechable en el VPS
ssh -i ~/.ssh/churrabot_key root@2.25.159.117 \
  "docker exec korex-crm-postgres-1 psql -U postgres -c 'CREATE DATABASE vocero_test;'"

# 2. Túnel (la base no escucha en la IP pública, solo en la red de Docker)
ssh -i ~/.ssh/churrabot_key -f -N -L 15433:172.16.1.1:5433 root@2.25.159.117

# 3. Migrar y correr
export TEST_DATABASE_URL="postgres://postgres:LA_CLAVE@localhost:15433/vocero_test"
DATABASE_URL="$TEST_DATABASE_URL" npx drizzle-kit migrate
npx vitest run tests/integration

# 4. Al terminar, borrar la base y cerrar el túnel
```

Cubren lo que importa: la coalescencia, que dos workers no tomen el mismo
trabajo, que un turno colgado vuelva a la cola, los reintentos y el techo del
aplazamiento.
