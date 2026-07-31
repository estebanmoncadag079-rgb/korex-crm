# Contador de costos por cliente

## Para qué existe

La agencia cobra **mensualidades fijas**. Antes se sabía el gasto total —mirando
el saldo de OpenRouter— pero no **cuánto de ese gasto era de cada negocio**. Sin
ese reparto no se puede saber si un cliente deja margen o se lo come, ni poner
precio a uno nuevo con criterio.

Y pesa más desde el **1 de octubre de 2026**, cuando Meta empiece a cobrar todos
los mensajes salientes.

## Dónde se ve

En **`/admin`**, encima de la lista de clientes: el consumo del **mes en curso**
por cliente, con respuestas de IA, su costo, mensajes enviados y el total, en
**dólares y en pesos**.

Los pesos son orientativos (a 4.000 COP por dólar, fijo en el código). Sirven
para dimensionar, no para facturar: no se consulta ninguna API de divisas.

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
