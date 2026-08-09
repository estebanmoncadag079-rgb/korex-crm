# Escalar de 3 a 100 clientes: qué lo impide hoy

> **Dentro:** La máquina no es el problema · Los seis bloqueadores reales ·
> Por dónde se empieza (y por qué en ese orden) · Lo que NO hay que hacer

Diagnóstico del **8-ago-2026**, pedido por el dueño: *"no me sirve que funcione
con tres clientes, necesito que sirva igual para 3 que para 100"*. Revisita la
decisión del 3-ago de no implementar cola/RLS/rate-limit
([23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md)) — aquella se tomó con
el supuesto explícito de "un VPS de un núcleo operado por una persona". **El
supuesto cambió.**

## La máquina no es el problema

Medido en el VPS con 3 clientes en producción:

| Recurso | Uso real | Techo |
|---|---|---|
| App (`korex-crm_crm`) | **93 MB RAM · 0,00 % CPU** | 3,8 GB |
| Postgres | **41 MB RAM · 0,01 % CPU** | — |
| Disco | 9,5 GB | 48 GB |
| Conexiones a la base | 8 activas (pool `max: 10`) | 100 |
| Toda la base comprimida | **642 KB** | — |

El servidor está **ocioso**. Multiplicar por 30 el tráfico no lo mueve de sitio.
Lo que impide llegar a 100 clientes no es capacidad: son seis decisiones de
diseño que con 3 clientes no se notan y con 100 rompen.

## Los seis bloqueadores reales

### 1. El estado del agente vive en la memoria del proceso 🔴

`src/server/ai/pipeline.ts:70` guarda el debounce en un `Map` de `globalThis`
con `setTimeout`; `src/lib/rate-limit.ts:9` hace lo mismo. Consecuencias:

- **No se puede correr más de una réplica.** Dos procesos = dos temporizadores
  para la misma conversación = respuestas duplicadas al cliente. Ya estuvo a
  punto de pasar el 3-ago, cuando Swarm dejó dos contenedores vivos a la vez.
- **No hay despliegue sin corte** ni tolerancia a fallos: una sola instancia.
- **Un reinicio pierde turnos**: si el contenedor cae con un temporizador
  pendiente, ese cliente **nunca recibe respuesta** y no queda rastro.

Es el bloqueador raíz: mientras el estado esté en memoria, ninguna de las otras
soluciones de escalado se puede aplicar.

### 2. No hay cola: el webhook procesa síncrono 🔴

`api/webhooks/ycloud/[organizationId]/route.ts:65` llama a `handleYcloudEvent`
dentro del propio request, y ahí dentro se llama al LLM (segundos). Con 3
clientes sobra; con 100 en hora pico, YCloud ve timeouts, **reintenta**, y el
mismo mensaje se procesa dos veces.

La tabla `webhook_event` (Fase 0 del 3-ago) **guarda** el evento crudo, que era
lo correcto — pero **nadie la reprocesa**: los eventos marcados `fallido` se
quedan ahí. `webhook_event_org_idx` tiene **0 lecturas** desde que existe.

### 3. El aislamiento entre clientes depende de no olvidar un `where` 🟠

No hay Row-Level Security. Que los datos de La Churra no se mezclen con los de
Lis depende de que **cada consulta** lleve su `organizationId` a mano. Un solo
`where` olvidado en un `SELECT` filtra datos de un negocio a otro. Con 3
clientes es un susto; con 100 —y ahora con datos personales de las clientas de
un salón— es un incidente de privacidad que se cuenta a los afectados.

### 4. Dar de alta un cliente es artesanal 🔴 (el techo real del negocio)

Según [05-CLIENTES.md](05-CLIENTES.md), de los 9 pasos del alta: el **horario**
y la **marca** solo se ponen por SQL, el **KB** se carga a mano y el **prompt**
se copia de otro cliente y se adapta. Son horas de trabajo por cliente.

**100 clientes por este camino son ~100 jornadas de trabajo manual**, y cada una
con el mismo riesgo que se materializó el 7-ago: un catálogo cargado a mano con
los 12 retoques mal cotizados ([32-CATALOGO-SALON.md](32-CATALOGO-SALON.md)).
Este es el cuello de botella que primero se toca en la vida real — mucho antes
que la CPU.

### 5. Un servidor, una réplica, respaldo cada 6 horas 🟠

Si el VPS muere: caída hasta rearmarlo a mano, y **hasta 6 horas de
conversaciones perdidas**. Con 3 clientes es asumible. Con 100 no: hace falta
PITR (WAL continuo) y un tiempo de recuperación objetivo, probado.

### 6. No hay control por cliente 🟠

- **Sin rate-limit por organización**: un cliente con tráfico anómalo (o un bucle
  de un bot ajeno) consume el turno de todos los demás.
- **Sin panel de costo por cliente**: `usage_event` tiene 1.003 filas y nadie
  las explota. Con 100 clientes, facturar y detectar abusos a ojo es imposible.
  Ya estaba pendiente en [09-COSTOS.md](09-COSTOS.md).

**Higiene, aparte**: 12 tablas `*_backup_*` creadas a mano en la base de
producción, y una migración aplicada a mano que ya tumbó el arranque una vez.

## Por dónde se empieza (y por qué en ese orden)

El orden no es por dificultad: es por **qué desbloquea qué**.

| Fase | Qué | Desbloquea |
|---|---|---|
| **1** | Sacar el debounce y el rate-limit de la memoria a Postgres | Varias réplicas, despliegue sin corte, ningún turno perdido |
| **2** | Cola de trabajos (`pg-boss`, sobre el mismo Postgres). El webhook solo registra y encola; responde en milisegundos. Reintentos con backoff y reproceso de `webhook_event` fallidos | Absorber ráfagas sin timeouts ni duplicados |
| **3** | Alta de clientes autoservicio: pantallas de horario y marca, importador de catálogo/KB con verificación, plantilla de prompt por vertical | Que sumar el cliente 40 cueste 20 minutos, no un día |
| **4** | RLS + rate-limit por organización + panel de uso y costo por cliente | Aislamiento real, facturación y detección de abusos |
| **5** | Infraestructura: PITR, 2+ réplicas, base gestionada o réplica | Sobrevivir a la muerte del servidor |

Las fases **1 y 2 son solo código**, no cuestan dinero y no requieren cambiar de
infraestructura. La 5 sí es una decisión de presupuesto.

## Lo que NO hay que hacer

- **Cambiar de servidor todavía.** El VPS está al 2 % de su capacidad. Migrar
  ahora sería resolver el único problema que no se tiene.
- **Una instalación por cliente.** Ya está descartado en
  [00-INDICE.md](00-INDICE.md) y sigue siendo la peor idea disponible: obliga a
  repetir cada arreglo tantas veces como clientes haya.
- **Microservicios.** Un monolito con una cola atiende 100 clientes de sobra;
  lo que hoy falla es el estado en memoria, no el tamaño del proceso.
