# Conectar un cliente que trae su propia cuenta de YCloud

> **Dentro:** Por qué este camino · El orden que evita sustos · Los dos muros de
> Meta · Cómo se verifica sin adivinar · Lo que pisa la configuración a mano ·
> La receta corta

14-ago-2026, conectando **Lashes Valen**. El primer cliente que llega con su
propia cuenta de YCloud, y el que destapó todo lo que faltaba escribir.

## Por qué este camino

Hay dos formas de conectar un número:

| | Quién paga los mensajes | Cupo de número |
|---|---|---|
| Cuenta de **la agencia** (La Churra) | la agencia | consume uno suyo |
| **Cuenta propia del cliente** (Lis, Lashes Valen) | el cliente | aporta el suyo |

La segunda quita el techo de crecimiento: la agencia no adelanta gasto ni se
queda sin cupos. A cambio, cada cuenta firma sus webhooks con **su propio
secreto**, y por eso existe una puerta por cliente:
`/api/webhooks/ycloud/<organizationId>`.

## El orden que evita sustos

1. **Registrar el número en el CRM** (Clientes → Número de WhatsApp).
2. **Pegar la API key y el secreto** del cliente en *Cuenta propia de YCloud*.
3. **Recién entonces** crear el endpoint en la consola de YCloud del cliente.

> 🔑 En ese orden, y no al revés. Sin credenciales guardadas la puerta responde
> **404**, y un endpoint que acumula fallos YCloud puede desactivarlo. Si el
> número no está registrado, los mensajes entran y se descartan con
> *"número sin cliente"* — se pierden sin dejar fila.

Eventos a marcar en el endpoint, los tres:

```
whatsapp.inbound_message.received   ← lo que escriben las clientas
whatsapp.smb.message.echoes         ← lo que responde el negocio desde el celular
whatsapp.smb.history                ← el historial de la coexistencia
```

## Los dos muros de Meta

**1. "Tu número ya está vinculado a los eventos automáticos"** (código
`#3441061`). Sale al intentar el registro insertado. Meta dice que se arregla
desactivando las etiquetas automáticas en *Herramientas empresariales →
Etiquetas*, pero en las versiones nuevas de la app **ese menú ya no existe**:
las etiquetas se llaman ahora **Listas**, y el interruptor no siempre se deja
apagar. Tampoco está en Business Manager — se revisó *Cuentas de WhatsApp →
Preferencias* y ahí solo hay notificaciones por correo.

> Cuando se agoten esos dos sitios, el camino corto es **"Reportar error a
> YCloud"** con el Session ID de la propia pantalla: lo desbloquean ellos.

**2. El sitio web.** Si el negocio no tiene, hay que marcar *"Mi empresa no
tiene sitio web ni página de perfil"*. Poner una URL que no es suya frena la
verificación.

## Cómo se verifica sin adivinar

Tres comprobaciones, de menos a más lejos:

```bash
# 1. ¿La puerta existe y lee su secreto? 401 = sí (404 = falta el secreto)
curl -o /dev/null -w '%{http_code}' -X POST -d '{}' \
  https://korexia.online/api/webhooks/ycloud/<organizationId>

# 2. ¿YCloud está llamando? (los 200 son entregas suyas)
docker logs --since 20m <traefik> | grep 'ycloud/org'

# 3. ¿Qué ve YCloud? — con la API key del cliente
GET https://api.ycloud.com/v2/whatsapp/phoneNumbers   → status CONNECTED, isOnBizApp
GET https://api.ycloud.com/v2/webhookEndpoints        → url, enabledEvents, status, secret
```

La tercera es la que cierra las discusiones: devuelve **el secreto real del
endpoint**, así que se compara con el guardado y se acaba la duda de si
coinciden.

## Lo que pisa la configuración hecha a mano

El cuestionario de alta (`/configuracion-inicial`) guarda un **borrador** en
`organization.metadata` y **regenera el prompt al avanzar de paso**. Todo lo que
se ajuste a mano en la base mientras el cliente está a medio llenar el
cuestionario **se pierde en el siguiente paso**.

Pasó dos veces el mismo día con el nombre del negocio: se corrigió en el prompt,
en el saludo y en la cuenta, y el cuestionario lo devolvió a *"Lashen Valen
studio"* porque eso era lo que tenía escrito en su paso 1. **Se arregla en el
borrador, no en el resultado.**

> ⚠️ Y ojo con lo que el cuestionario cambia sin que nadie lo mire: en esta alta
> traía un horario (9:30–18:30) distinto del configurado (9:00–20:00). De ahí
> salen los huecos que ofrece el agente — hora y media de diferencia es dinero
> todos los días.

## La receta corta

1. Registrar número → 2. Pegar API key y secreto → 3. Crear endpoint con los 3
   eventos → 4. `curl` a la puerta (debe dar 401) → 5. Mandar un "hola" **desde
   otro número** → 6. Comprobar que entró en la bandeja → 7. Terminar el
   cuestionario → 8. Cargar conocimiento → 9. **Encender el agente**.

El paso 9 es el último a propósito: en cuanto se enciende, contesta a todo el
que escriba.
