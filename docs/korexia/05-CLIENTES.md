# Clientes: cómo se dan de alta y cuál es su estado

> **Dentro:** Todo el código es compartido · Dar de alta un cliente · Trampas conocidas · La Churra — churrería, Jamundí · Lis Pastelería — cremosos y tortas, Cali · korex.ia — la agencia

> 🔒 **En este archivo no hay contraseñas ni claves.** Viven en el gestor de
> contraseñas del dueño y en `/opt/korex-crm/.env` del servidor. No se escriben
> en el repositorio aunque sea privado.

## Todo el código es compartido

Conviene tenerlo claro antes de nada: korex.ia es **una sola instalación** con
un contenedor y una base de datos. **Los arreglos llegan a todos los clientes a
la vez**, sin copiar nada.

Lo único propio de cada cliente son **sus datos**: prompt, conocimiento,
horario, marca, número y teléfonos de aviso. Por eso un cliente nuevo nace ya
con todas las mejoras hechas para los anteriores, y un fallo que se arregle
para uno mejora a los demás el mismo día.

## Dar de alta un cliente

### 1. Crear el cliente

En `/admin` → **Nuevo cliente**: nombre del negocio, nombre y correo del dueño,
y una contraseña temporal. Nace con el embudo sembrado, el **agente apagado** y
el conocimiento vacío. Anotar el `organizationId` que devuelve.

### 2. Su marca

Para que no vea "korex.ia" dentro de su propio CRM: nombre y color en
`organization.metadata`. Hoy se hace por base de datos o desde
`/settings/branding` entrando como el cliente.

### 3. El conocimiento del negocio

Menú, precios, horario, ubicación, domicilios y formas de pago, en `kb_entry`.
**Es la parte que más tiempo lleva** porque hay que sentarse con el cliente.

### 4. El prompt del agente

Se parte del de otro cliente y se adapta. Regla importante: **no repetir en el
prompt los datos que ya están en el conocimiento** — se pagan dos veces en cada
mensaje.

> ⚠️ **Con una excepción**: lo que el bot debe **recitar textualmente** (el menú
> con sus cifras, la lista de opciones) tiene que estar **en el prompt**, aunque
> se duplique. Al sacarlo, el modelo mostró una sola presentación y **se
> inventó las cantidades**.

### 5. El horario

`hours_open`, `hours_close` y `hours_days` (1 = lunes … 7 = domingo). Sin esto
el agente no sabe si está abierto. **Hoy solo por base de datos, no hay
pantalla.**

### 6. Los teléfonos de aviso

`notify_phones`: a quién le llega el pedido por WhatsApp. Formato internacional
sin el `+`, separados por comas.

### 7. Conectar el número

En `/admin` → cliente → **Número de WhatsApp**. Solo la agencia; el cliente no
ve esa pantalla.

Si el cliente trae **su propia cuenta de YCloud** (recomendado):

1. Pegar **solo la API key** y guardar
2. La pantalla devuelve la **URL del webhook**
3. Crear el webhook en la consola del cliente con **los dos eventos**
4. Pegar el secreto `whsec_…` que devuelve YCloud

Cada campo tiene su propio botón **"Guardar claves"**. Los campos se vacían al
guardar porque son contraseñas: el mensaje de confirmación dice cuál entró.

### 8. Probar ANTES de apagar nada

Un pedido completo, hasta el aviso al equipo. Nunca un mensaje suelto.

### 9. Encender el agente y apagar lo viejo

`enabled = true` y, si había un bot anterior, apagarlo **en el mismo
movimiento**: dos bots en el mismo número responden dos veces.

## Trampas conocidas

- **Crear el cliente ANTES de conectar su número.** Si llega un mensaje a un
  número sin dueño, se descarta.
- **La ventana de 24 h** para los avisos de pedido (ver
  [03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md)).
- **Enseñar al equipo el relevo**: cada mensaje que manden desde el celular
  silencia al agente 2 horas en esa conversación.
- **Los números del equipo aparecerán en la bandeja** cuando escriban al
  negocio para mantener su ventana abierta. Es normal.

---

# Estado real de los clientes (31-jul-2026)

## La Churra — churrería, Jamundí

| | |
|---|---|
| Organización | `org_lo5gdlt6k43z9fg1ling` |
| Número | `573155136091` · calidad **verde** · TIER_250 |
| Cuenta YCloud | la de la **agencia** |
| Horario | 12:30–20:30, **todos los días** |
| Agente | **encendido** |
| Conocimiento | 14 entradas |
| Avisos de pedido | 3 teléfonos del equipo |

Fue el primer cliente y el conejillo de indias de casi todo. Su bot anterior
(no oficial) se apagó el 26-jul y desde entonces atiende korex.ia.

Detalle propio: los nombres de las salsas van **en mayúsculas** por pedido del
dueño, porque se leen mejor en WhatsApp.

## Lis Pastelería — cremosos y tortas, Cali

| | |
|---|---|
| Organización | `org_lispasteleria0001` |
| Número | `573158339990` · WABA `190143772066943` |
| Cuenta YCloud | **propia del cliente** |
| Horario | 10:00–20:00, **lunes a sábado** (domingo cerrado) |
| Agente | **encendido** desde el 31-jul-2026 |
| Conocimiento | 12 entradas |
| Avisos de pedido | 1 teléfono (la dueña) |
| Marca | rosa `#e91e8c` |

Su contenido salió del bot anterior: 11 productos con precios, 11 toppings,
cuántos lleva cada tamaño, domicilios por Yango, pago **solo por
transferencia** y el flujo de regalo con tarjeta.

**Lo que se pierde respecto a su bot viejo**, y conviene que lo sepa:

- **El aviso al grupo de WhatsApp**: Meta no permite escribir en grupos por la
  API. Ahora el aviso va al celular de la dueña.
- **Los estados de pedido automáticos** ("en preparación", "despachado"…) que
  enviaba su panel anterior.

**Lo que gana**: se acabaron los cortes de conexión cada 50 minutos que sufría
su bot no oficial, y el riesgo de que le bloqueen el número.

### Prueba del agente (31-jul-2026)

Antes de encenderlo se corrió una conversación de pedido completa contra el
modelo real, con su prompt y su conocimiento: **5 turnos, 5 respuestas válidas,
sin reintentos**.

Acertó en todo lo que importa: avisó de que estaba **fuera de horario** y
ofreció coordinar para las 10:00 (sin anunciar un cierre falso), recitó el menú
con los precios exactos, supo que **el Cremoso de 16 oz lleva 3 toppings**,
hizo las preguntas en mayúsculas y negrita, calculó bien el total y cerró con
`notify_order`. El resumen para el equipo salió completo: producto, toppings,
nombre, celular, dirección, total y forma de pago.

La herramienta de prueba quedó en el servidor como `/root/probar-lis.py`; sirve
de plantilla para validar el agente de cualquier cliente **sin gastar WhatsApp
ni arriesgar una conversación real**.

Detalle menor observado: cuando el negocio está cerrado, el resumen repite la
etiqueta "Entrega" en dos líneas (la dirección y el aviso de coordinación). No
es un error —el contenido es correcto— pero se puede pulir en el prompt.

Su bot anterior **ya no existe**: Meta le cerró la sesión al conectar el número
a la API, y el servicio se borró del servidor el 31-jul.

## korex.ia — la agencia

Organización propia, sin número ni conocimiento. Es la casa desde la que se
administran los demás: la cuenta con `platform_role = 'superadmin'` es miembro
solo de esta.
