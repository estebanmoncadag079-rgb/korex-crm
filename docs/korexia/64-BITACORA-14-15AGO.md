# Bitácora del 14 y 15 de agosto

> **Dentro:** La cuenta que no existía · Una sola puerta · El flujo de La Churra
> y las tres causas · Fase 0: medir antes de construir · Fase 1 · Lo que se
> descubrió sin buscarlo · Lo que quedó abierto

Sesión larga que empezó con *"a Valentina no le entra al panel"* y acabó con un
plan de arquitectura y su primera fase en producción. Se cuenta en orden porque
cada cosa salió de la anterior.

---

## 1. La cuenta que nunca se creó

**Síntoma**: la dueña del salón no podía entrar con la contraseña que se le
había dado.

**Causa**: su cuenta **no existía**. El correo no estaba en la base. Lo que había
pasado: el botón **"Generar"** solo rellena el campo de contraseña —no crea
nada—, y el botón que sí crea, *"Crear cuenta de acceso"*, **se queda gris sin
decir por qué** si falta el Nombre. Se lee como *"el sistema no me deja más
accesos"*, no como un campo vacío.

**Se arregló** creando su cuenta y, sobre todo, **añadiendo el botón de
eliminar**, que no existía: el endpoint tenía `GET`, `POST` y `PATCH` pero ningún
`DELETE`, así que un alta equivocada no se podía deshacer. Detalle y las cuatro
protecciones en [10-SEGURIDAD.md](10-SEGURIDAD.md).

**De paso**, un bug que rompía justo el caso principal: las cuentas recién
creadas recibían un identificador inventado (`tmp_${email}`) en vez de su
`memberId`, así que borrar —o resetear— una cuenta recién creada daba **404 hasta
recargar**.

---

## 2. Una sola puerta: el cuestionario borraba el conocimiento

Al revisar el salón apareció que **su corrección de salud se había deshecho
sola**. La respuesta que prometía que la extensión de pestañas no irrita los ojos
—lo que la conducta prohíbe— había vuelto, después de haberse corregido y
verificado contra el agente real.

No la repuso nadie: `aplicarFicha` **borraba `kb_entry` entero** y lo reponía
desde la ficha, donde seguía la versión vieja.

Se cerró el camino: el conocimiento solo se siembra, nunca se reemplaza; el
cuestionario dejó de preguntar las preguntas frecuentes; y la pantalla del agente
dejó de ofrecer campos que se regeneran solos. Todo en
[61-UNA-SOLA-PUERTA.md](61-UNA-SOLA-PUERTA.md).

> **La lección, que valió más que el bug**: *una verificación sobre algo que el
> siguiente clic deshace no verifica nada.* Aquella corrección se probó, y la
> prueba pasó. Lo que no se comprobó es cuánto duraba el estado probado.

---

## 3. El flujo de La Churra, y por qué no bastaba con pedirlo

El dueño quiso fijar el orden de los mensajes de un pedido: cinco, ni uno más
(desde el 1-oct-2026 Meta cobra cada saliente). Se escribió en su ficha… y el
agente siguió sin respetarlo.

**No era el modelo, ni una sino tres causas:**

1. **Las adiciones venían pegadas al catálogo**, así que el prompt se las daba
   junto a las presentaciones y luego una regla le pedía que no las enseñara.
   Pedirle que separe lo que se le entrega junto no funciona.
2. **La regla nombraba la frase prohibida** (*"nunca preguntes «¿qué se te
   antoja?»"*) y el agente contestó exactamente eso. **Nombrar lo prohibido es
   dárselo.** Ahora las reglas describen solo lo que sí hay que hacer.
3. **Las reglas del negocio perdían contra el orden universal**, que se lee 70
   líneas más arriba. Se añadió la cabecera *"estas reglas mandan sobre todo lo
   anterior"* en `generar.ts` — que **no impone ningún flujo**: solo resuelve el
   empate a favor de quien conoce su negocio.

También se descubrió que el `saludoInicial` decía *"¿estás antojad@?"* y esperaba
respuesta, gastando dos mensajes para hacer lo de uno. Ahora el saludo **ya trae
las cuatro presentaciones**.

---

## 4. Fase 0: medir antes de construir

De ahí salió la idea de rearquitecturar —sacar el estado del prompt al backend—,
y la condición de medir primero. Se midió sobre **167 conversaciones reales**, y
los números **no respaldaron el refactor urgente**:

- **El caso típico ya funciona**: La Churra, mediana de **3** mensajes por pedido
  (el objetivo eran 5).
- **La sesión de 26 mensajes que disparó la alarma era del propio dueño
  probando**, no un cliente.
- **A/B de modelo**: `gemini-2.5-flash` 0 fallas, `gpt-4.1-mini` 2. La sospecha
  de que GPT iba mejor **no se confirmó** → cambio de modelo descartado.
- **El coste, al revés de lo que se suponía**: `gpt-4.1-mini` sale **22 % más
  barato** por llamada pese a tener mayor tarifa de entrada, porque es más
  conciso. 🔑 **El precio de tarifa no predice el coste real.**

Dos correcciones del dueño sobre esa medición, y las dos de fondo: **midió el
síntoma equivocado** (mensajes, cuando el objetivo es la escalabilidad del alta),
y **el p90 alto de Lis no es un fallo, es su negocio** — tortas por encargo
necesitan más idas y venidas.

Todo en [62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md](62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md).

---

## 5. Fase 1: el catálogo a tablas

Hecha y en producción para La Churra. Receta, trampas y rollback en
[63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md](63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md).

---

## 6. Lo que se descubrió sin buscarlo

Cosas que aparecieron al verificar, y que nadie había reportado:

| Hallazgo | Dónde quedó |
|---|---|
| **Nunca hubo 7 entradas de conocimiento** en el salón. Lo decía una tabla de estado y era falso: los respaldos muestran 0 hasta el 13-ago y 1 desde entonces | [57-PENDIENTES-14AGO.md](57-PENDIENTES-14AGO.md), corregido |
| **El horario del salón ya estaba bien** (9:30–18:30). El pendiente llevaba días cerrado sin que nadie lo supiera | ídem |
| **`notifyPhones` tenía el mismo borrado silencioso** que el conocimiento: reenviar el cuestionario dejaba al negocio sin avisos | [61](61-UNA-SOLA-PUERTA.md) |
| **El banco de 24 escenarios solo sirve para Lis**: contra La Churra da 14 falsos negativos (*"Lis NO acepta efectivo"*) | [63](63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md) |
| **`regenerar:flota` no hacía respaldo** en modo lectura… pero sí en `--aplicar`. Se afirmó lo contrario antes de comprobarlo | aquí |

---

## 7. 🔴 Lo que quedó ABIERTO

### El prompt tiene dos escritores, y el último gana

**El 15-ago a las 12:59 UTC el prompt de La Churra se sobrescribió solo** y
perdió todas las reglas de flujo de la noche anterior: pasó de 18.053 a 11.889
caracteres, sin la regla de los cinco mensajes ni el saludo con la carta.

Por eso *"el flujo no funcionó"* al probarlo: **las reglas ya no estaban.**

Es el mismo patrón que [61-UNA-SOLA-PUERTA.md](61-UNA-SOLA-PUERTA.md) cerró para
el conocimiento, pero en el prompt: `scripts/fichas-de-clientes.ts` y el
cuestionario del cliente **escriben los dos** `agent_profile.ficha`, y el último
gana sin avisar. Se restauraron las reglas a mano, pero **el camino sigue
abierto** y volverá a pasar.

### Lo demás

- **La contraseña del superadmin** sigue sin cambiar desde el 31-jul. Es el
  pendiente más barato y el de peor consecuencia.
- **El salón sigue apagado**, por decisión: faltan cosas de su configuración.
- **No hay pantalla para el catálogo**: se migra por línea de comandos.
- **La Churra necesita su propio banco de escenarios** si va a ser el laboratorio
  de las fases siguientes.
