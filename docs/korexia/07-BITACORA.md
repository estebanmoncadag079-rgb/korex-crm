# Bitácora: qué se cambió y por qué

> **Dentro:** 31-jul-2026 (noche) — el agente escucha y ve · 31-jul-2026 (tarde) — seguridad, embudo y aprendizaje

Historial de los cambios que llegaron a producción. Lo más reciente arriba.
Las horas van en **UTC** salvo que diga "Colombia" (UTC−5).

---

## 1-ago-2026 — cotizador, y la aplicación en el celular

### El costo lo mandan los mensajes, no las conversaciones

La tabla de precios cobraba "por conversación" como si todos los negocios
cerraran igual. No lo hacen: **La Churra manda 6,7 mensajes por conversación y
Lis 8,3**, y un negocio que necesitara 20 costaría más del doble.

Hay **cotizador en `/admin`** con esa variable como campo. El modelo sale de
medir, no de estimar: **0,0020 USD por respuesta** del agente, con las 38
llamadas registradas dando 0,00197 en La Churra y 0,00202 en Lis. Coinciden
porque lo que domina es el prompt del sistema, que se manda entero en cada turno.

Efecto incómodo: el margen real de los planes baja del 87 al **79 %**. La cifra
anterior salía del costo medio de hoy, donde el bot solo responde unas 3 veces
por conversación y el resto lo atiende una persona. Ver
[14-COTIZAR.md](14-COTIZAR.md) y [15-VENDER.md](15-VENDER.md).

### Fotos: se transcriben, no se resumen

Un pedido escrito a mano acababa como "[IMAGEN] Hoja con un pedido escrito a
mano". Ahora son tres casos —comprobante, texto e imagen— y el texto se copia
entero. Los productos se describen por lo que los distingue (capas, envase,
toppings) para que el agente los empareje con su catálogo.
[13-AUDIO-E-IMAGENES.md](13-AUDIO-E-IMAGENES.md).

### La aplicación se puede usar desde un celular

Estaba construida **solo para escritorio**. En un teléfono el menú ocupaba media
pantalla y el resto se salía por el borde. 27 archivos, solo presentación —ni un
fichero de `src/server`, `src/lib` o `src/app/api`—, y dos bugs de verdad por el
camino: en Safari de iOS **no se podía contestar un mensaje**, y en el embudo las
tarjetas **cambiaban de etapa al deslizar** la lista. [18-MOVIL.md](18-MOVIL.md).

### Tres despliegues que no llegaron a producción

Se construyó con la etiqueta `korex-crm:latest` en vez de
`easypanel/korex-crm/crm:latest`. Cada build terminó bien, cada reinicio dijo
`converged` y la web respondía 200 — mientras se construía **una imagen que no
usa nadie**. Además la carpeta de la que construye EasyPanel se quedó sin
sincronizar, así que el siguiente Desplegar habría revertido tres
funcionalidades. Corregido y documentado en
[02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md).

---

## 31-jul-2026 (noche) — el agente escucha y ve

### Notas de voz

Mucha gente pide hablando, y esas notas eran **invisibles** para el agente: el
historial que recibe filtra por texto. Con una clienta de Lis se vio el efecto:
explicó por audio que quería una porción de torta de cumpleaños con domicilio y
el agente le contestó *"qué alegría que nos escribas"*.

Ahora se transcriben **al entrar**, una sola vez, y el texto se guarda dentro
del propio mensaje. Verificado en producción con un audio real.

### Imágenes y comprobantes de pago

Mismo mecanismo para las fotos. El caso que llega todos los días es el
comprobante: el cliente manda la captura y el agente veía un mensaje vacío.

La regla que gobierna esto: **el sistema lee, pero no dictamina**. Extrae banco,
monto, fecha y hora, a nombre de quién, cuenta destino y referencia —los cuatro
datos que delatan un comprobante de otra cuenta, de otro pedido o repetido— y
tiene **prohibido** decir que un pago está confirmado. Copia la línea del
comprobante en el resumen que va al equipo, y una persona compara antes de
despachar.

A diferencia del audio, el pie de foto no cancela la descripción: se conserva
delante. El comprobante casi siempre viene con un "listo" encima.

Detalle completo en [13-AUDIO-E-IMAGENES.md](13-AUDIO-E-IMAGENES.md).

---

## 31-jul-2026 (tarde) — seguridad, embudo y aprendizaje

### Auditoría de seguridad: un cliente podía atacar a otro

`GET /api/settings/webhook` pedía sesión **de cualquier usuario** y devolvía en
claro un token **único para toda la instalación**. Cadena verificada en
producción: el empleado de un negocio lo lee; `META_APP_SECRET` no está puesta,
así que la firma de Meta aceptaba cualquier cosa; con eso inyecta un evento
falso con el número de OTRO negocio (que es público) y **el WhatsApp de la
víctima acaba escribiéndole a quien el atacante quiera**.

Corregido: el endpoint pasa a exigir superadmin, y **las dos verificaciones de
firma dejan de fallar abiertas en producción**. Antes de tocarlo se comprobó que
el webhook de Meta no recibe tráfico y que los dos clientes van por YCloud.

Comprobado después: cliente leyendo el token → **403** (antes 200); webhooks sin
firma → **401**. Detalle completo en [10-SEGURIDAD.md](10-SEGURIDAD.md).

### El embudo mentía en dos sitios

**Los leads no salían de "Nuevo" si el negocio escribía primero.** En ese orden
los mensajes salen antes de que exista la tarjeta, así que no había nada que
mover; cuando el cliente por fin contestaba, el lead nacía en "Nuevo" y ahí se
quedaba. Pasó con el contacto 573005619176: dos mensajes a las 16:40:13 y el
lead creado 30 segundos después.

Ahora el lead **nace donde corresponde**: si el contacto ya tiene mensajes
salientes, entra directo en la segunda etapa. Se recolocaron los 4 leads mal
ubicados (con respaldo previo en `lead_backup_20260731`).

**Las ventas atendidas a mano no llegan a "Cliente"** — Melany compró y su
tarjeta seguía en "En conversación", porque el salto solo ocurre cuando el
agente cierra con `notify_order`. Se movió a mano; la solución de fondo queda
pendiente (punto 10 de [08-PENDIENTES.md](08-PENDIENTES.md)).

### "#bot" devolvía el turno pero el agente seguía mudo

El silencio tiene **dos llaves**: el relevo (`handoffAt`) y el interruptor por
conversación (`aiEnabled`). El atajo solo levantaba la primera, así que si
alguien había usado el botón "Humano" —que baja la segunda— el sistema decía que
la IA estaba al mando y el agente seguía callado. Un cliente de Lis se quedó sin
respuesta tras pedir "un cremoso de temporada y un cremoso polvoroso".

Ahora se levantan las dos juntas. **Y se añadieron frases naturales**, porque
"#bot" escrito desde el celular lo ve el cliente y queda rarísimo: *"te dejo con
el agente para terminar tu pedido"*, *"te paso con el encargado"*. 17 pruebas
fijan el equilibrio, incluidas las siete que NO pueden activarlo.

Verificado en vivo: tras retomar, el agente respondió *"Ya anoto tu Cremoso de
Temporada y tu Polvoroso"* — con el contexto de lo que había hablado la persona.

### Contador de costos por cliente

Se cobraban mensualidades fijas sin saber qué costaba cada cliente. Ahora se
anota cada gasto con el importe exacto que informa el proveedor, incluidos los
intentos fallidos. Ver [09-COSTOS.md](09-COSTOS.md).

### Aprendizaje del agente

Lo que respondía una persona a mano se perdía: el agente volvía a no saberlo al
día siguiente. Ahora se puede leer la semana y proponer lo que le falta, con
aprobación. Primera ejecución: 3 propuestas por **$0,0065**, y una destapó que
el prompt de La Churra ofrece un punto de recogida que el negocio ya no usa.
Ver [11-APRENDIZAJE.md](11-APRENDIZAJE.md).

### Limpieza y marca

Se borró la landing vieja (con respaldo del repo), los assets pasaron a `marca/`
y se creó `clientes/`. Y el **favicon**: la pestaña mostraba el globo genérico;
ahora lleva la tuerca de korex.ia sobre una teja oscura, porque el trazo
original a 16 px queda en 0,74 px y se empasta.
