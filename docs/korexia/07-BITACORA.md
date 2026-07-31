# Bitácora: qué se cambió y por qué

Historial de los cambios que llegaron a producción. Lo más reciente arriba.
Las horas van en **UTC** salvo que diga "Colombia" (UTC−5).

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

En `/admin`: respuestas de IA con su **costo exacto** (lo informa OpenRouter, no
se estima), mensajes enviados y total. Se suman también los intentos fallidos,
que son los que encarecen un turno sin que se note. Los mensajes de WhatsApp se
cuentan aunque hoy valgan 0, para poder proyectar la factura de octubre.

### Aprendizaje del agente

Botón que lee las conversaciones de la semana y propone lo que al agente le
falta saber, sobre todo lo que tuvo que responder una persona. Con aprobación, y
solo para la agencia. Primera ejecución real: 174 mensajes, 3 propuestas, **$0,0065**
— y una destapó que el prompt de La Churra ofrece recoger en un punto que el
negocio ya no usa. Ver [11-APRENDIZAJE.md](11-APRENDIZAJE.md).

### Limpieza y marca

Se borró la landing vieja (con respaldo del repo), los assets pasaron a `marca/`
y se creó `clientes/`. Y el **favicon**: la pestaña mostraba el globo genérico;
ahora lleva la tuerca de korex.ia sobre una teja oscura, porque el trazo
original a 16 px queda en 0,74 px y se empasta.

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
