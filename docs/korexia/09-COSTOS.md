# Contador de costos por cliente

> **Dentro:** Para qué existe · Dónde se ve · La columna que hay que mirar · Qué se anota y cuándo · Tres decisiones que conviene entender · Dos garantías del diseño · Lo que aún falta · Cómo consultarlo sin la pantalla

## Para qué existe

La agencia cobra **mensualidades fijas**. Antes se sabía el gasto total —mirando
el saldo de OpenRouter— pero no **cuánto de ese gasto era de cada negocio**. Sin
ese reparto no se puede saber si un cliente deja margen o se lo come, ni poner
precio a uno nuevo con criterio.

Y pesa más desde el **1 de octubre de 2026**, cuando Meta empiece a cobrar todos
los mensajes salientes.

## Dónde se ve

En **`/admin`**, encima de la lista de clientes: el consumo del **mes en curso**
por cliente, con respuestas de IA, su costo, mensajes enviados y el total.

**Todo va en dólares**, que es la moneda en la que se paga a los proveedores y
en la que llegan los importes. Se probó mostrar también pesos con una tasa fija
y se quitó: era una cifra que envejecía sola y no cuadraba con ninguna factura
real. Si algún día hace falta en pesos, que sea con una tasa consultada, no
inventada.

## La columna que hay que mirar

**Costo por llamada** (añadida el 9-ago-2026): el gasto de IA dividido entre el
número de llamadas. Es el dato que se vigila, y no el total del mes.

El total sube por dos motivos que se parecen en la pantalla y no se parecen en
nada en la realidad: **hay más tráfico** —que es lo que se busca— o **cada
llamada se encareció** —que es un problema—. El total solo no los distingue;
el cociente sí.

Sube cuando **crece el prompt del sistema**, que se manda entero en cada turno
y domina el costo (~94 % es entrada), o cuando aparecen llamadas que no son del
agente: transcribir notas de voz, reintentos por JSON mal formado, el rescate
con el modelo caro de respaldo.

Se muestra con **cinco decimales** a propósito. Lo que se vigila son movimientos
pequeños: Lis pasó de 0,00202 (medido en julio con 38 llamadas, ver
`src/lib/cotizador.ts`) a **0,00288** en agosto —un 43 % más— mientras La Churra
seguía clavada en 0,00198. Con menos resolución ese desvío avanza a saltos en
vez de verse venir.

El total de la fila de abajo es un **promedio ponderado** (gasto total ÷
llamadas totales), no la media de la columna: así un cliente con cuatro llamadas
no pesa lo mismo que uno con trescientas. Un cliente sin llamadas muestra una
raya, no `$0` — no gastó porque no hubo tráfico, que no es lo mismo que atender
gratis.

## Qué se anota y cuándo

Cada gasto se registra **en el momento en que ocurre**, en la tabla
`usage_event`:

| Campo | Qué guarda |
|---|---|
| `kind` | `ia` (una llamada al modelo) o `whatsapp` (un mensaje saliente) |
| `detail` | el modelo usado, o el tipo de mensaje |
| `tokens_in` / `tokens_out` | tokens de entrada y salida |
| `cost_usd` | el importe, decimal exacto de 10 decimales |
| `ref` | de dónde salió: la conversación o el `wamid` |

> ⚠️ **"Respuestas IA" son llamadas al modelo, no mensajes enviados**, y por eso
> casi siempre son más que la columna de mensajes. Se anotan desde tres sitios:
> `pipeline.ts` (el agente, contando los reintentos), `transcribir.ts` (pasar
> una nota de voz a texto) y `aprendizaje.ts` — los dos últimos gastan IA sin
> escribirle nada a nadie. En agosto de 2026: Lis 295 llamadas / 247 mensajes,
> La Churra 101 / 96, y la Peluquería Demo 223 / 0 por ser el laboratorio de
> pruebas, sin número conectado.
>
> **Los mensajes son solo los SALIENTES.** Los que escribe el cliente no se
> cuentan: son gratis siempre. Y como el registro está en el punto único de
> envío (`send.ts`), incluye también los que manda una persona desde el CRM
> durante un relevo, no solo los del bot.

## Tres decisiones que conviene entender

**1. El costo de la IA no se estima: lo dice el proveedor.**
OpenRouter devuelve el importe exacto de cada llamada si se le pide con
`usage: { include: true }`. Estimarlo por tokens y tarifa se desviaría en cuanto
cambien los precios o el modelo.

**2. Se suma lo de TODOS los intentos, no solo el que salió bien.**
Un turno puede costar tres llamadas fallidas más un rescate con el modelo caro
de respaldo. Contar solo la respuesta buena escondería justo los turnos más
caros — que son los que hay que detectar.

**3. Los mensajes de WhatsApp se cuentan aunque hoy cuesten cero.**
Dentro de la ventana de 24 h Meta no cobra las respuestas, así que hoy se anotan
a 0. Pero **contar el tráfico real desde ahora** es lo que permite proyectar la
factura de octubre con datos en vez de con suposiciones. El panel lo dice
explícitamente: cuántos mensajes van este mes y cuánto costarían con la tarifa
nueva.

## Dos garantías del diseño

**Anotar nunca puede tumbar una conversación.** Si el registro falla, se avisa
por consola y se sigue atendiendo. Perder una línea de contabilidad es molesto;
dejar a un cliente sin respuesta por no poder anotarla, inaceptable.

**Los importes se guardan como decimal exacto, no en coma flotante.** Son
fracciones de centavo que se suman miles de veces, y en flotante el total acaba
desviándose.

## Lo que aún falta

**El precio real de cada mensaje de WhatsApp.** Se cuentan, pero se registran a
costo 0. YCloud informa el importe de forma **asíncrona** (no en la respuesta
del envío), así que hay que traerlo después — consultando su API o suscribiendo
el evento de actualización de estado. Es el mismo trabajo pendiente que el de
los estados de mensaje.

Mientras Meta no cobre, el cero es correcto. **Antes de octubre hay que
cerrarlo.**

## Cómo consultarlo sin la pantalla

```sql
SELECT o.name,
       count(*) FILTER (WHERE u.kind = 'ia')       AS respuestas_ia,
       sum(u.cost_usd) FILTER (WHERE u.kind = 'ia') AS costo_ia,
       count(*) FILTER (WHERE u.kind = 'whatsapp') AS mensajes
  FROM usage_event u
  JOIN organization o ON o.id = u.organization_id
 WHERE u.created_at >= date_trunc('month', now())
 GROUP BY o.name;
```
