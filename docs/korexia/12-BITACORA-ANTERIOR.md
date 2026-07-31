# Bitácora anterior (hasta el 29-jul-2026)

Continuación de [07-BITACORA.md](07-BITACORA.md), que guarda lo más reciente.
Las horas van en **UTC** salvo que diga "Colombia" (UTC−5).

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

> 📜 **Lo anterior al 30 de julio** está en
> [12-BITACORA-ANTERIOR.md](12-BITACORA-ANTERIOR.md): la web caída, los cierres
> falsos del agente, el cutover de La Churra y el arranque del multi-cliente.

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
