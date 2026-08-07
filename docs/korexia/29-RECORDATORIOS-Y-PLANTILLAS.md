# Recordatorios de cita y plantillas de WhatsApp

> **Dentro:** El problema de fondo · Por qué octubre NO lo arregla · La
> plantilla de utilidad: qué cuesta · Quién la crea y dónde · El texto listo
> para registrar · Qué falta en el CRM

Sale de [19-CITAS.md](19-CITAS.md), al entrar el **primer cliente real de
citas** (un salón de belleza, 7-ago-2026). Afecta a cualquier negocio que
agende con antelación.

## El problema de fondo

Meta solo deja enviar **texto libre** a quien le haya escrito al negocio en
las **últimas 24 horas**. Un salón agenda con días de antelación: la clienta
reserva el lunes para el viernes, y el jueves su ventana lleva tres días
cerrada.

Consecuencia, tal como está hoy:

| Lo que el salón quiere hacer | Qué pasa sin plantilla |
|---|---|
| Recordar la cita el día antes | ❌ no se puede enviar |
| Avisar de un cambio de especialista | ❌ se mueve la cita y la clienta no se entera |
| Avisar de que se canceló el día | ❌ igual: llega y no hay nadie |
| Recordar una cita **del mismo día** | ✅ si escribió hoy |

El botón *Recordar* y la cascada **no fallan en silencio**: devuelven a quién
no se pudo avisar, para que el salón la llame. Pero llamar una por una no es
el producto que se vende.

## Por qué octubre NO lo arregla

Confusión que ya surgió y conviene dejar zanjada: **que desde el 1-oct-2026
Meta cobre todos los mensajes salientes no elimina la ventana de 24 horas.**

- **El cobro** es *cuánto cuesta* un mensaje.
- **La ventana** es *qué se puede enviar* y cuándo.

Lo que cambia en octubre es que también se cobrarán las respuestas dentro de
la ventana. Fuera de ella **seguirá haciendo falta una plantilla aprobada**.
Pagar no da derecho a mandar texto libre.

## La plantilla de utilidad: qué cuesta

Es lo único que atraviesa una ventana cerrada. Categoría **UTILITY** (no
marketing, que es 15 veces más cara).

| | |
|---|---|
| Costo en Colombia | **0,0008 USD** por envío (~3 pesos) |
| Salón con 20 citas/día | menos de **2.000 COP al mes** |
| Aprobación de Meta | de minutos a un día |

Esto **reabre a propósito** la decisión de "sin plantillas" tomada en
[08-PENDIENTES.md](08-PENDIENTES.md). Aquella era para los avisos de pedido,
donde **hay alternativa** (el equipo mantiene su ventana abierta escribiéndole
al negocio). Para recordarle una cita a un cliente **no hay alternativa**, y a
3 pesos el argumento del costo ya no aplica. Aprobado por el dueño el
7-ago-2026.

## Quién la crea y dónde

**La crea el dueño de la agencia, en la consola de YCloud del cliente** — no
la agencia en la suya, porque cada cliente tiene su propia cuenta (ver
[05-CLIENTES.md](05-CLIENTES.md)). YCloud la manda a Meta a aprobar.

⚠️ **No se puede crear antes de conectar el número**: la plantilla vive en la
WABA del cliente, que no existe hasta el signup.

## El texto listo para registrar

Nombre: `recordatorio_cita` · Idioma: `es` · Categoría: **UTILITY**

```
Hola {{1}} 👋 Te recordamos tu cita de {{2}} el {{3}} a las {{4}}.
Si necesitas cambiarla o cancelarla, escríbenos por aquí. ¡Te esperamos!
```

Variables, en orden: **1** nombre de la clienta · **2** servicio · **3** fecha
· **4** hora.

> Meta rechaza plantillas de utilidad que suenen a promoción. Nada de ofertas,
> descuentos ni "aprovecha": esta solo informa de una cita que la clienta ya
> tiene, que es justo lo que la categoría permite.

## Qué falta en el CRM

1. **Crear plantillas desde el CRM no sirve para clientes con cuenta propia de
   YCloud** (o sea, todos los nuevos). `createTemplate` va por Graph con el
   `wabaId` guardado, que en esos casos es `ycloud:<numero>` y no un WABA
   real. YCloud sí tiene API — `POST /v2/whatsapp/templates`, pide el `wabaId`
   real, que hoy **no se guarda** para esos clientes (llega en el webhook, se
   podría tomar de ahí o de `GET /v2/whatsapp/phoneNumbers`).
2. **Enviar el recordatorio por plantilla cuando la ventana esté cerrada**:
   hoy `remind` y la cascada solo intentan texto libre. Falta caer a la
   plantilla en vez de reportar el fallo.
3. **Automatizar el recordatorio** (24 h antes). Solo tiene sentido con lo
   anterior hecho; hasta entonces el botón manual es lo que hay.
