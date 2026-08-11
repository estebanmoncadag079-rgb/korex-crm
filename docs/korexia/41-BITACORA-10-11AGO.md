# Bitácora: 10 y 11 de agosto de 2026

> **Dentro:** ¿Para qué sirve YCloud si cada cliente entra con su Facebook? ·
> Dos fechas que hay que anotar · Qué pasa si un cliente olvida su contraseña ·
> El fallo que apareció a los tres minutos · Lo que queda

Continuación de [39-BITACORA-9AGO-TARDE.md](39-BITACORA-9AGO-TARDE.md). Dos
preguntas del dueño, y de la segunda salió código.

---

## 1. ¿Para qué sirve YCloud si cada cliente entra con su Facebook?

Pregunta del dueño: *"¿no es menos trabajo conectar korex al WhatsApp de cada
cliente configurado desde Facebook?"*

**Sí se puede ir directo.** La coexistencia y los *echoes*
(`smb_message_echoes`) son de **Meta**, no de YCloud — YCloud solo los reenvía —
y el código ya soporta las dos vías: `send.ts` distingue por el prefijo
`ycloud:` en `phoneNumberId`.

**Pero no ahorraría dinero.** YCloud pasa la tarifa de Meta sin margen, así que
el mensaje cuesta lo mismo por las dos vías, y con las cuentas propias por
cliente su plan sale en **0 USD/mes** para la agencia.

Lo que YCloud da no es la conexión: es **ser el proveedor técnico ante Meta**.

| Con YCloud | Directo con Meta |
|---|---|
| Formulario guiado (*Embedded Signup*) | Montar y mantener **la app propia** de la agencia |
| Ellos migran cuando Meta cambia | **La agencia** migra cuando Meta cambia |
| Una wallet de la agencia | **Cada cliente** mete tarjeta en su Business Manager |
| Tokens y webhooks resueltos | Token permanente + webhook por cliente |

**Decisión: no cambiar.** Con 3 clientes, montar infraestructura de proveedor de
Meta es resolver un problema que no se tiene. El cálculo cambia si se llega a
20-30 clientes, si YCloud empieza a cobrar margen, o —y este es el que hay que
vigilar— **si abrir cuenta en YCloud se convierte en el motivo por el que se cae
un cliente durante el alta**.

## 2. Dos fechas que hay que anotar (verificado 10-ago-2026)

**15 de octubre de 2026: se deprecia el *Embedded Signup* v2.** Hay que estar en
v4 antes. Siguiendo con YCloud **es problema suyo** — conviene preguntarle a
Victor si ya están en v4. Yendo directo, sería problema de la agencia, y cae dos
semanas después de que Meta empiece a cobrar los mensajes.

🔴 **La app de WhatsApp Business del cliente debe abrirse al menos una vez cada
13 días o la coexistencia se cae.** Aplica **igual por las dos vías** y **no
estaba en el checklist de "el bot no responde"**. Hoy no afecta a nadie —Karen
(Lis) abre su WhatsApp a diario—, pero un cliente que solo use el CRM y no toque
la app del teléfono se quedaría sin coexistencia sin enterarse. Si algún día un
número deja de recibir sin causa aparente, mirar esto.

## 3. Qué pasa si un cliente olvida su contraseña

**No había respuesta**: el login es correo y contraseña, no hay pantalla de
"olvidé mi contraseña" y **no hay ningún servidor de correo** en la instalación.
Un cliente bloqueado dependía de que alguien entrara al servidor a reemplazarle
el hash a mano — y ni con un `UPDATE` simple, porque Better Auth usa su propio
cifrado.

Ahora hay un botón **"Nueva contraseña"** por cuenta en `/admin`, y **el ojo para
ver lo que se teclea** en todos los campos de contraseña de la aplicación. Las
tres reglas de seguridad y las cuatro pruebas contra Postgres real están en
[10-SEGURIDAD.md](10-SEGURIDAD.md).

## 4. El fallo que apareció a los tres minutos

Estrenado el botón, se le cambió la contraseña a una clienta **real** de La
Churra y **no se vio ninguna**: se enseñaba en el recuadro del principio de la
página, a media pantalla de distancia de la lista de cuentas. Como no se guarda
en ningún sitio, se perdió y la clienta quedó bloqueada hasta repetir la
operación.

Corregido el mismo día — sale pegada a la cuenta, con botón de copiar. **La
lección se generaliza: el resultado de una acción se enseña donde ocurrió la
acción, y más si es irrecuperable.** De paso se quitó un `onBlur` que cancelaba
la confirmación y hacía que un doble clic rápido no enviara nada.

## 5. Lo que queda

- **Recuperación de contraseña por correo**, para que el cliente se desbloquee
  solo sin llamar a la agencia. Razonable a partir de ~10 clientes.
- Preguntarle a YCloud si ya están en **Embedded Signup v4**.
- Todo lo demás sigue en
  [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md), donde el único con
  fecha límite es **traer el precio real de cada mensaje antes del 1-oct**.
