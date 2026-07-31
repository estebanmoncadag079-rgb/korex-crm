# Bitácora: qué se cambió y por qué

Historial de los cambios que llegaron a producción. Lo más reciente arriba.
Las horas van en **UTC** salvo que diga "Colombia" (UTC−5).

---

## 31-jul-2026

### Se jubiló el bot viejo de Lis Pastelería

Al conectar su número a la API oficial (coexistencia), **Meta cerró la sesión
de su bot no oficial** a las 00:57 UTC — código 401, `loggedOut`. No fue un
fallo: la coexistencia invalida las sesiones de WhatsApp Web, y ese bot colgaba
de ahí.

Se decidió **no revivirlo**: Meta volvería a cerrarlo y su medidor de riesgo de
bloqueo ya estaba en 69/100. El servicio se borró del servidor, junto con su
imagen (1,06 GB, que era lo que de verdad ocupaba espacio).

**No se respaldó su base de datos**: los pedidos y conversaciones viven en el
WhatsApp del celular de la dueña, que es la fuente real.

**Efecto colateral previsto a tiempo**: el monitor de alertas lo vigilaba y
habría mandado una falsa alarma cada hora. Se sacó de la lista antes de borrar
nada. La lista de bots vive ahora en la variable `BOTS`, para que añadir o
quitar uno sea tocar un sitio y no tres.

### Las claves del cliente parecían borrarse (`56321f0`)

Los dos secretos de YCloud colgaban de un desplegable, pero el único botón de
guardar estaba fuera, junto al número. Al pulsarlo los campos se vaciaban —son
contraseñas, no se pueden repintar— y **nada decía qué había entrado**. En el
alta de Lis se reescribieron varias veces creyendo que no guardaban, cuando sí.

Ahora las claves tienen **su propio botón y su propio acuse**, que dice cuál se
guardó y avisa de que el campo se vacía a propósito. El botón de arriba pasó a
llamarse "Guardar número" y ya no envía las claves.

### Respaldos: de una copia diaria a un sistema probado

- El servidor pasa a hacer copia **cada 6 horas** (antes una al día).
- El PC del dueño las **descarga solo** a OneDrive con una tarea programada.
- **Se probó una restauración real** en una base limpia: se recuperó todo.
- Se escribió el instructivo `COMO-LEVANTAR-EL-SERVICIO.txt`.

Se detectó y documentó que **el `.env` no está en las copias**: sin
`ENCRYPTION_KEY` las credenciales de WhatsApp son ilegibles. El dueño las
guardó en su gestor de contraseñas.

### Se conectó el número de Lis Pastelería

Signup de coexistencia desde la consola de YCloud, con el portafolio de Meta de
la clienta. Quedó en **una cuenta de YCloud propia del cliente**, no en la de
la agencia — que resultó ser el camino recomendado de cara a octubre.

**Fallo que costó una vuelta**: el webhook se creó **sin marcar los eventos**.
La URL respondía 401 (parecía correcta) pero YCloud no enviaba nada. Se
diagnosticó viendo que las únicas peticiones al webhook salían del propio
servidor.

**Verificado de punta a punta** a las 02:55 UTC: un mensaje real entró por
YCloud, respondió 200 y apareció en la bandeja de **Lis** (no en la de La
Churra), confirmando que el reparto por número funciona.

---

## 30-jul-2026

### 19 falsas alarmas de "CRM caído" en un día

El monitor buscaba el contenedor `korex-crm-app-1`, que era el de `docker
compose` y había quedado apagado al migrar a EasyPanel el día anterior. Como no
lo encontraba, avisaba cada hora **mientras el CRM llevaba 20 horas
funcionando**.

Se apuntó al servicio real (`korex-crm_crm`), comparando **por prefijo**, ya
que el contenedor lleva un sufijo que cambia en cada despliegue.

**Lección**: al migrar o renombrar un servicio, revisar qué lo vigila. El
monitor no avisa de que se quedó ciego — avisa al revés.

### Se montó todo el contenido de Lis Pastelería

Organización, marca rosa, embudo, cuenta de la dueña, **12 entradas de
conocimiento** y un prompt de 12.061 caracteres, todo sacado de la
configuración de su bot anterior.

El horario (10:00–20:00, **lunes a sábado**) se validó con el código real:
seis casos, incluidos los bordes y el domingo cerrado.

### La pantalla de WhatsApp hablaba de algo que no tenemos (`47bd438`)

Ofrecía dos caminos y uno era "Modo agencia (Tech Provider)": un programa de
Meta que la agencia evaluó y **decidió no comprar**. Se quitó, y se aclaró que
los números de YCloud se conectan en otra pantalla.

Con el mismo cambio, los tres campos **dejaron de autocompletarse**: el gestor
del navegador metía el correo del operador como "Phone Number ID" y su
contraseña como token. Un guardado distraído dejaba a un cliente con
credenciales corruptas.

---

## 29-jul-2026

### La web dejó de abrir: `korexia.online` daba 404

La aplicación se migró a un servicio de EasyPanel y **solo se registró el
dominio `crm.korexia.online`**. El dominio raíz y `www` quedaron sin ruta.
Como `crm` seguía funcionando, parecía que "solo la web" estaba caída.

Se restauró en minutos con un archivo de configuración añadido a Traefik, y
después el dueño registró los dominios en EasyPanel, que es donde corresponde.

**Dato que evita un 502**: al añadir un dominio en EasyPanel hay que poner el
puerto **80**, no 3000.

### El agente anunciaba cierres falsos (`70a8356`)

Con el negocio abierto desde las 12:30, a las 14:04 le dijo a un cliente "ya
cerramos, tu pedido queda para mañana". El horario estaba bien y el prompt
decía ABIERTO tres veces.

**La causa era que se copiaba a sí mismo**: ese mensaje había salido una vez,
quedó en el historial y el modelo prefería ser coherente con él antes que con
el dato del sistema. Se añadió un guardarraíl que detecta el cierre falso y
obliga a reescribir la respuesta.

### Se acabaron los créditos de OpenRouter

El agente dejó de responder con error 402. **El CRM seguía perfecto**, pero
ningún cliente recibía respuesta automática y nada avisaba. Ese día las
respuestas las escribió una persona a mano.

**Los dos modelos (principal y respaldo) van por OpenRouter**, así que sin
saldo caen los dos.

---

## 26–28-jul-2026 (resumen)

- **korex.ia pasó a ser multi-cliente**: panel `/admin`, aislamiento verificado
  y reparto de mensajes entrantes por número.
- **La Churra migró a korex.ia**: se apagó su bot anterior y el agente empezó a
  atender de verdad.
- **Aviso de pedidos al equipo** (`notify_order`) y **relevo humano/agente**,
  incluido desde el celular.
- **El horario pasó a calcularlo el servidor**, tras dos fallos opuestos del
  modelo (decir que abría a medianoche y decir que cerraba a media tarde).
- **El prompt de La Churra se recortó un 70 %** sacando a la base de
  conocimiento los datos que se repetían.
- **Se cambió el modelo a Gemini 2.5 Flash**: −92 % de costo por pedido.
- **Se cerraron los puertos** que exponían la aplicación sin HTTPS.
- **Backups diarios verificados** restaurando, y pantalla para cambiar la
  contraseña (no existía).
