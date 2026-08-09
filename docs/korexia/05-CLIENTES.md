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

> 🔑 **Regla del negocio: una cuenta de YCloud POR CLIENTE** (decisión del
> dueño, 6-ago-2026). Cada cliente trae su cuenta y su portafolio, así que
> **el límite de 2 números por portafolio NO limita cuántos clientes caben**:
> no hay techo por ese lado y la verificación de negocio en Meta sigue sin
> urgir. Lo que **no** se hace es abrir cuentas extra a nombre de la agencia
> para saltarse ese límite — lo prohíbe el contrato de YCloud.

Con su propia cuenta de YCloud:

1. Pegar **solo la API key** y guardar
2. La pantalla devuelve la **URL del webhook**
3. Crear el webhook en la consola del cliente con **los dos eventos**
4. Pegar el secreto `whsec_…` que devuelve YCloud

Cada campo tiene su propio botón **"Guardar claves"**. Los campos se vacían al
guardar porque son contraseñas: el mensaje de confirmación dice cuál entró.

> 📜 **El historial se aprueba UNA vez y no tiene vuelta atrás.** En
> coexistencia, durante el signup **al dueño le llega un mensaje de Facebook
> Business en su propio WhatsApp** —no en el navegador de quien hace el alta—
> con *Connect* y luego **Confirm**: ese *Confirm* autoriza a compartir su
> historial de chats. Si lo ignora, **Meta no envía nada, nunca**, y solo se
> recupera desconectando y reconectando el número. **Avísale antes y está
> pendiente de su teléfono ese día.** El evento `whatsapp.smb.history` queda
> guardado solo en `webhook_event` aunque aún no haya código que lo procese
> — ver [21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md).

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

Fue el primer cliente y el conejillo de indias de casi todo; su bot anterior
(no oficial) se apagó el 26-jul. Detalle propio: los nombres de las salsas van
**en mayúsculas** por pedido del dueño, porque se leen mejor en WhatsApp.

## Lis Pastelería — cremosos y tortas, Cali

| | |
|---|---|
| Organización | `org_lispasteleria0001` |
| Número | `573158339990` · WABA `190143772066943` |
| Cuenta YCloud | **propia del cliente** |
| Horario | 10:00–20:00 lunes a sábado · **14:00–19:00 domingo** (desde el 3-ago-2026) |
| Agente | **encendido** desde el 31-jul-2026 |
| Conocimiento | 12 entradas |
| Avisos de pedido | **ninguno** (a propósito, ver abajo) |
| Marca | rosa `#e91e8c` |

Su contenido salió del bot anterior: 11 productos con precios, 11 toppings,
cuántos lleva cada tamaño, domicilios por Yango, pago **solo por
transferencia** y el flujo de regalo con tarjeta.

> 🎂 **Lis NO hace tortas personalizadas** (corregido el 9-ago-2026). Sí hace
> **tortas completas con decoración ESTÁNDAR** en tres sabores —red velvet,
> chocolate y zanahoria—, bajo encargo y con precio y tiempo que confirma el
> equipo.
>
> Hasta hoy el conocimiento decía que las personalizadas "se preparan por
> encargo", y el agente le contestó a una clienta que **"¡las tortas
> personalizadas son nuestra especialidad!"**. No se lo inventó: hizo lo que
> decían sus datos. La lección se repite — *cuando el dato está mal, el agente
> no falla: miente con seguridad*. Se corrigieron las **dos** entradas del
> `kb_entry` y las `escalation_rules`, y se verificó contra el modelo real con
> `/root/probar-tortas.py`, que además prueba la variante "quiero una torta con
> foto" (nadie pregunta siempre con la misma palabra).

**Respecto a su bot viejo pierde** el aviso al grupo de WhatsApp (Meta no deja
escribir en grupos por la API) y los estados de pedido automáticos ("en
preparación", "despachado"…). **Gana** que se acabaron los cortes de conexión
cada 50 minutos y el riesgo de que le bloqueen el número.

⚠️ **`notify_phones` vaciado a propósito (1-ago-2026)**: Lis no tiene equipo,
atiende y despacha todo ella misma directamente desde el WhatsApp del negocio
(el mismo número de arriba, `...9990`, por coexistencia). Pidió explícitamente
**no replicar pedidos ni avisos a ningún otro número** — antes tenía puesto un
celular personal (`573164240795`), que además resultó ser un número que le
escribe al bot como si fuera clienta (sin confirmar si es ella probando o
alguien más). Si en el futuro se pregunta por qué a Lis no le llega ningún
aviso de WhatsApp: es esta decisión, no un fallo. Causa raíz completa de la
investigación que llevó a esto (mensajes que no se respondían) en
[07-BITACORA.md](07-BITACORA.md), entrada del 1-ago-2026.

### Prueba del agente (31-jul-2026)

Antes de encenderlo se corrió un pedido completo contra el modelo real:
**5 turnos, 5 respuestas válidas, sin reintentos**. Acertó en todo lo que
importa — avisó de que estaba fuera de horario sin anunciar un cierre falso,
recitó los precios exactos, supo que el Cremoso de 16 oz lleva 3 toppings,
calculó bien el total y cerró con `notify_order` completo.

La herramienta quedó en el servidor como `/root/probar-lis.py`: sirve de
plantilla para validar el agente de **cualquier** cliente sin gastar WhatsApp.

Detalle menor sin corregir: con el negocio cerrado, el resumen repite la
etiqueta "Entrega" en dos líneas. El contenido es correcto.

Su bot anterior **ya no existe**: Meta le cerró la sesión al conectar el número
a la API, y el servicio se borró del servidor el 31-jul.

### Actualización 3-ago-2026 (noche)

Menú inicial numerado (1. Ver menú · 2. Hacer un pedido · 3. Preguntas
frecuentes · 4. Hablar con un asesor), regla de escalado para no inventar
tortas grandes/personalizadas, y la explicación del domicilio movida a línea
fija del resumen del pedido (antes era una instrucción suelta que el modelo
omitía). Detalle completo en
[23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md).

## korex.ia — la agencia

Organización propia, sin número ni conocimiento. Es la casa desde la que se
administran los demás: la cuenta con `platform_role = 'superadmin'` es miembro
solo de esta.
