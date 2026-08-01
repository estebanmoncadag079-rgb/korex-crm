# Bitácora anterior (hasta la madrugada del 31-jul-2026)

> **Dentro:** 31-jul-2026 (madrugada) · 30-jul-2026

Continuación de [07-BITACORA.md](07-BITACORA.md), que guarda lo más reciente.
Las horas van en **UTC** salvo que diga "Colombia" (UTC−5).

---

---

## 31-jul-2026 (madrugada)

### El agente de Lis se inventaba cuál era el producto más pedido

Primera corrida del Laboratorio con su agente encendido: **83 puntos**, cuatro
personas en verde y dos en amarillo.

El hallazgo que importaba: ante *"quiero la más pedida"* respondió **"La más
pedida es el Cremoso de 12 oz"**. Ese dato **no existe en su conocimiento** —
se lo inventó, que es justo lo que el prompt prohíbe.

Se añadió una regla al prompt (en caliente, sin desplegar) que **no se limita a
prohibirlo**: si solo se le dice "no lo sabes", pierde la venta ante quien pide
que le recomienden. La regla le dice qué hacer en su lugar: recomendar de
verdad, explicando por qué le puede gustar, sin atribuirlo a las ventas.

Verificado con la misma pregunta: ahora responde *"Te recomiendo el Cremoso de
12 oz: lleva 2 toppings a elección y es un tamaño que rinde bastante"*.
Respaldo del prompt anterior en `agent_profile_backup_20260731`.

> 📌 **Mejor solución pendiente**: preguntarle a la dueña cuál es realmente el
> más vendido y meterlo en el conocimiento. Así el agente podría responderlo
> **con la verdad** en vez de esquivarlo.

**Sobre el juez del Laboratorio, con criterio**: de los seis hallazgos, solo
ese era un error real. Los demás eran de "tono" y discutibles — y en el caso
`errores_modismos`, **el juez marcó como fallos del agente frases que había
dicho el cliente simulado** ("La q ustedes vean parce", "listo mano ahi le
aviso"). Conviene leer sus veredictos con escepticismo y buscar la evidencia
antes de cambiar nada.

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

> 📜 **Lo anterior al 31 de julio** está en
> [12-BITACORA-ANTERIOR.md](12-BITACORA-ANTERIOR.md): la web caída, los
> cierres falsos del agente, el cutover de La Churra y el multi-cliente.

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

Lo anterior al 29 de julio está en
**[17-BITACORA-JULIO.md](17-BITACORA-JULIO.md)**.
