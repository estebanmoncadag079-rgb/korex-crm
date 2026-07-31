# WhatsApp: cómo entran y salen los mensajes

## Por qué YCloud y no Meta directo

korex.ia no habla con Meta directamente: usa **YCloud** como intermediario
oficial (BSP). Motivos:

- Conectar un número es un formulario guiado (*Embedded Signup*), sin montar
  una app propia en Meta para cada cliente.
- **YCloud no cobra margen** sobre los mensajes: pasa la tarifa de Meta tal cual.
- Se le paga a YCloud, nunca a Meta: no hay que meter tarjeta en el Business
  Manager de cada cliente.

El código conserva **también** el camino directo a Meta (por si un cliente trae
su propia app), y decide solo cuál usar: si el `phone_number_id` empieza por
`ycloud:`, sale por YCloud; si no, por Meta.

## Cómo entra un mensaje

YCloud manda los eventos por **webhook**, y aquí está el detalle clave:
**los webhooks son por CUENTA, no por número**. Una cuenta puede tener varios
números de varios clientes, así que hay que repartir los mensajes.

**El reparto se hace por el número de destino.** El evento trae a qué número
escribió el cliente; se busca de quién es ese número y el mensaje entra en la
bandeja de esa organización. **Un número que no sea de nadie se descarta** con
un aviso en el registro, en vez de meterlo en un cliente al azar.

### Las dos puertas de entrada

| Ruta | Para qué |
|---|---|
| `/api/webhooks/ycloud` | La cuenta de YCloud **de la agencia** |
| `/api/webhooks/ycloud/<organizationId>` | La cuenta **propia de un cliente** |

Hacen falta dos porque la **firma se verifica antes** de poder leer el
contenido: hay que saber qué secreto usar sin haber abierto el sobre. La ruta
del cliente lleva su organización en la dirección, así se sabe.

Si un cliente no tiene secreto propio guardado, su puerta devuelve **404** —
nunca cae al secreto de la agencia.

### Los dos eventos que hay que suscribir

Al crear el webhook en YCloud hay que marcar **los dos**:

```
whatsapp.inbound_message.received   → mensajes que escriben los clientes
whatsapp.smb.message.echoes         → lo que el negocio responde desde el celular
```

El segundo es el que permite la **coexistencia**: cuando alguien del equipo
contesta desde el teléfono, el mensaje aparece en la bandeja y **el agente le
cede el turno** en vez de hablar encima.

> ⚠️ **Fallo real (30-jul-2026)**: el webhook de Lis se creó **sin marcar
> ningún evento**. La URL respondía correctamente (401, validando firma) pero
> YCloud **no enviaba nada** y los mensajes no llegaban.
> **Cómo distinguirlo**: mirar en el registro de Traefik si hay peticiones al
> webhook **desde una IP que no sea la del servidor**. Si solo aparecen las
> propias, el problema es la suscripción a eventos, no el secreto.

### Diagnóstico rápido de una puerta

Enviar cualquier cosa a la ruta del cliente y mirar el código:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  'https://crm.korexia.online/api/webhooks/ycloud/<organizationId>' -d '{"t":1}'
```

| Respuesta | Qué significa |
|---|---|
| **404** | No hay secreto guardado → YCloud no puede entregar |
| **401** | Secreto presente y validando firma → **correcto** |
| **200** | Procesado (es lo que responde a un evento real y bien firmado) |

## Cómo sale un mensaje

Se envía a YCloud (`/v2/whatsapp/messages/sendDirectly`) indicando el número
del negocio y el del cliente. La clave que se usa depende del cliente: la suya
si tiene cuenta propia, la de la agencia si no.

## La ventana de 24 horas (esto define lo que se puede y no se puede hacer)

Meta solo deja enviar **texto libre** a alguien que le haya escrito al negocio
en las **últimas 24 horas**. Fuera de esa ventana hay que usar una **plantilla
aprobada**, y **las plantillas se cobran**.

Consecuencias prácticas:

- **Responder a un cliente siempre funciona** (él acaba de escribir).
- **Avisar al equipo de un pedido nuevo puede fallar**, si esa persona no le ha
  escrito al negocio ese día.
- **Decisión tomada: no se usan plantillas**, porque se pagan por envío.
  El equipo mantiene la ventana abierta escribiéndole al número del negocio de
  vez en cuando (basta un mensaje al día).

Esto pesa más cuando el aviso va a **un solo número** (el caso de Lis): si esa
persona tiene la ventana cerrada, nadie se entera del pedido hasta que abra el
CRM.

## Coexistencia: el número en el celular y en la API a la vez

Al conectar un número se elige entre:

- **"Conecta una app de WhatsApp Business"** → **coexistencia**: el negocio
  conserva su WhatsApp en el teléfono **y** la API atiende. Es lo que usan La
  Churra y Lis.
- **"Crear una cuenta de WhatsApp Business"** → el número pasa solo a la API y
  se pierde la app del teléfono.

> ⚠️ **La coexistencia cierra las sesiones de WhatsApp Web.** Cualquier bot no
> oficial (Baileys, whatsapp-web.js…) que colgara de ese número **deja de
> funcionar en el momento del signup**. Le pasó a Lis el 31-jul-2026 a las
> 00:57 UTC: Meta cerró la sesión con código 401 y su bot viejo quedó mudo.
> **Hay que tenerlo previsto**: si el bot nuevo no está listo, el negocio se
> queda sin atención automática.

**La API oficial NO aparece en "Dispositivos vinculados" del teléfono.** Esa
lista es solo para WhatsApp Web y de escritorio. Que esté vacía es lo normal y
correcto; no significa que algo falte.

## Qué se guarda y qué no

- Los **mensajes de texto** se guardan enteros en la base.
- Las **imágenes (comprobantes de pago)** **no se almacenan**: se guarda el
  enlace y se descargan de YCloud cuando alguien las abre, a través de
  `/api/media/[id]` (así la clave nunca llega al navegador). **YCloud solo las
  conserva 30 días**: pasado ese plazo se pierden, y ningún respaldo las trae.

## Límites del número

Cada número tiene un límite de **conversaciones nuevas iniciadas por el
negocio** cada 24 h. Los dos actuales están en `TIER_250` (250 al día), que
sobra para el volumen real (~15 conversaciones diarias por negocio). Meta lo
sube solo según calidad y uso.

La **calidad** (verde / amarilla / roja) baja si los clientes bloquean o
reportan el número. La Churra está en **verde**.

Sin verificar el negocio en Meta se pueden tener hasta 2 números por
portafolio; con la verificación, hasta 20.
