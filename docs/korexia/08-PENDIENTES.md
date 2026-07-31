# Qué quedó y qué no

Estado a **31-jul-2026**. Aquí está lo que falta, lo que se decidió no hacer y
por qué, para no volver a discutirlo desde cero.

## 🔴 Bloqueante ahora mismo

**Los créditos de OpenRouter están en cero.** El agente no puede responder,
aunque todo lo demás funcione. Es lo único que impide terminar la puesta en
marcha de Lis Pastelería.

Con 10 USD sobra de largo: a 25 pesos colombianos por pedido, son miles de
conversaciones.

## Lo que falta para terminar con Lis Pastelería

1. Recargar los créditos
2. Probar un pedido completo, hasta el aviso a la dueña
3. Encender su agente (`enabled = true`)

Todo lo demás está hecho y verificado: número conectado, webhook entregando,
contenido, prompt, horario y cuenta de acceso.

## Lo que hace el dueño

- **Cambiar la contraseña de superadmin.** Sigue siendo la que quedó expuesta
  en una conversación. Se cambia en Ajustes → Mi cuenta.
- **Rotar las claves expuestas**: `YCLOUD_API_KEY` y `OPENROUTER_API_TOKEN` se
  escribieron en un chat en su día. Al rotarlas hay que actualizarlas también
  en el gestor de contraseñas.
- **Explicarle a cada cliente el relevo humano**: que cada mensaje que manden
  desde el celular silencia al agente 2 horas en esa conversación, y que
  `#bot` se lo devuelve.
- **Avisar del cambio a Lis**: pierde el aviso al grupo de WhatsApp y los
  estados automáticos de pedido.

## Técnicos, por orden de valor

**1. Los mensajes salientes se quedan en "pendiente".** No se procesa el evento
de YCloud que informa del estado (entregado, leído, fallido). Consecuencia
real: si un aviso de pedido lo rechaza WhatsApp por la ventana de 24 horas, el
sistema no se entera. Hay que suscribir el evento y actualizar el estado.

**2. Alerta de saldo bajo.** El monitor vigila que los servicios estén vivos,
pero no los saldos. Justo lo que falló el 29-jul: todo verde y el agente mudo
por falta de créditos. Conviene avisar cuando OpenRouter baje de un mínimo.

**3. Los números del equipo aparecen en la bandeja.** Cuando escriben al
negocio para mantener abierta su ventana de 24 horas, entran como un contacto
más y el agente puede contestarles el menú. Decidir si se filtran.

**4. Los guiones del Laboratorio son genéricos.** Nacieron para una ferretería;
sirven a medias para churrería y pastelería. Escribir guiones propios haría las
pruebas mucho más útiles.

**5. Panel de costo por cliente.** Cuántas conversaciones y cuántos pesos lleva
cada uno al mes. Sin esto se cobra a ciegas.

**6. Pantallas que faltan**: el horario y la marca de un cliente solo se pueden
configurar por base de datos.

**7. La copia externa depende del PC del dueño.** Funciona porque lo enciende a
diario, pero si la agencia crece conviene que el servidor suba las copias solo.

## Negocio

- **Cobro de mensualidad y contrato**: sin empezar. Qué incluye el servicio,
  cuánto y cómo se factura.
- **Antes del 1-oct-2026**: Meta empieza a cobrar **todos** los mensajes
  salientes. Hoy las respuestas dentro de la ventana de 24 h son gratis, por
  eso el saldo de YCloud lleva meses intacto. A partir de esa fecha hay que
  tener resuelto **quién paga los mensajes de cada cliente**.

## Decisiones tomadas (no reabrir sin motivo nuevo)

**No usar plantillas de WhatsApp.** Se cobran por envío. Los avisos internos van
en texto libre y el equipo mantiene su ventana abierta escribiendo al negocio.

**No ser Tech Provider de Meta.** Cuesta 900 USD, no incluye mensajes y solo
sirve para el modo *white label*. Con la cuenta normal de YCloud basta.

**No abrir cuentas de YCloud extra para saltarse el límite de números.** Lo
prohíbe su contrato y podrían cerrar todas las cuentas a la vez, dejando a
todos los clientes sin WhatsApp. La alternativa legítima —y la que se está
usando con Lis— es que **cada cliente tenga su propia cuenta**.

**No migrar a Supabase.** Añade latencia en cada consulta y unos 25 USD al mes,
y con el respaldo diario ya cubierto no aporta nada hoy.

**No revivir los bots no oficiales.** Baileys funcionaba pero se caía cada 50
minutos por diseño, quemaba el único núcleo del servidor con avalanchas de
errores y arriesgaba el bloqueo del número. La API oficial no tiene nada de eso.

**No respaldar la base del bot viejo de Lis.** Sus pedidos y conversaciones
están en el WhatsApp de la dueña, que es la fuente real.

## Riesgos conocidos que siguen abiertos

**Un solo servidor, sin réplica.** Si el VPS cae, cae todo. Se amortigua porque
YCloud reintenta los webhooks (los mensajes no se pierden) y porque hay copias
fuera, pero el servicio estaría caído hasta levantarlo a mano.

**Un solo núcleo.** Cualquier proceso que se descontrole afecta a todo. Ya pasó
con el bot viejo de Lis.

**Los comprobantes de pago caducan a los 30 días** en YCloud y no hay copia.

**El saldo de YCloud es compartido** entre todos los clientes que usen la cuenta
de la agencia. A partir de octubre, un cliente con mucho tráfico puede dejar sin
mensajes a los demás. Que cada uno tenga su cuenta lo resuelve.
