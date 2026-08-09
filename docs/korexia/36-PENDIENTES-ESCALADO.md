# Pendientes (continuación, 9-ago-2026): qué importa de verdad

> **Dentro:** El orden y por qué · 1. Contraseña del superadmin · 2. El día 1
> del salón · 3. Automatizar el alta de clientes · 4. Vigilar los turnos
> fallidos · 5. Subir a dos réplicas · 6. Reintentos de YCloud · 7. Fase 4 ·
> 8. Fase 5 · 9. Higiene

Sigue a [21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md), que llegó al límite de
200 líneas. **Ordenado por riesgo e impacto real, no por dificultad ni por
orden de aparición.**

## El orden y por qué

Lo que decide el orden es una pregunta: *¿qué pasa si esto no se hace?*

Los tres primeros tienen consecuencia inmediata y concreta (una brecha, un
cliente que no arranca, un techo de crecimiento). Del cuarto en adelante son
mejoras que hoy no duelen. **La fase 5 —la infraestructura, lo que más suena a
"escalar"— es la última a propósito**: mudar la base no acerca a los 100
clientes; automatizar el alta, sí.

---

## 1. 🔴 Cambiar la contraseña del superadmin

**Pendiente desde el 31-jul.** Es el punto 1 de
[08-PENDIENTES.md](08-PENDIENTES.md) y sigue sin hacerse mientras entra un
tercer negocio con datos personales de sus clientas.

Con esa cuenta se entra a los datos de **todos** los clientes. Es el pendiente
más viejo, el más barato de cerrar y el único con consecuencia legal si sale
mal. No depende de nadie más.

## 2. 🔴 El día 1 del salón de belleza

Detalle completo en [21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md). Lo que sigue
abierto tras cargar el catálogo oficial:

- **Las duraciones de los servicios.** El catálogo oficial **no trae ni una**;
  las cargadas son estimaciones. De ellas depende qué huecos vende el agente:
  si un Volumen Ruso son 150 min y en realidad son 210, promete citas que no
  caben. Se pregunta junto con el horario real.
- **Los precios de las 12 uñas**, que no vienen en el PDF de lashes y nadie ha
  confirmado. Geimar y Laura solo atienden esa categoría.
- **El KB**, incluidas las tres reglas del catálogo (60 % de extensiones para
  retoque, 30 días es montura nueva, Hidralips mínimo 3 sesiones). Con el KB
  vacío el agente **inventó una dirección**.
- Conectar su número, la plantilla de recordatorios, y abrir `/appointments`
  en un móvil de verdad.

## 3. 🔴 Automatizar el alta de clientes (fase 3) — el techo real

De los 9 pasos del alta ([05-CLIENTES.md](05-CLIENTES.md)), el **horario** y la
**marca** solo se ponen por SQL, el **KB** se carga a mano y el **prompt** se
copia de otro cliente y se adapta. Son horas por cliente.

**Con 25 clientes esto es un trabajo a tiempo completo**, y cada alta manual es
una oportunidad de repetir lo del 7-ago: un catálogo cargado a mano con 12
precios equivocados que nadie detectó hasta que llegó el documento oficial.

Lo que hay que construir, por orden de dolor:

1. Pantalla de **horario** y de **marca** (hoy solo base de datos).
2. **Importador de catálogo/KB** con verificación — que enseñe lo que va a
   cargar y obligue a confirmarlo antes de escribir.
3. **Plantilla de prompt por vertical** (pedidos / citas) en vez de copiar y
   adaptar el de otro cliente.

## 4. 🟠 Vigilar los turnos fallidos (señal nueva)

Desde el 8-ago existe una señal que antes no había:

```sql
SELECT conversation_id, attempts, last_error, updated_at
  FROM agent_job WHERE status = 'fallido' ORDER BY updated_at DESC;
```

**Una fila ahí significa que un cliente se quedó sin respuesta** tras 5
intentos. Conviene mirarlo al revisar el día. Lo natural sería que entrara en
`monitor-bots-alerta.sh` (cron cada 15 min) y avisara por Telegram, como el
resto de la vigilancia — **no está hecho**.

## 5. 🟠 Subir a dos réplicas

El trabajo del 8-ago lo **habilita pero no lo activa**: sigue corriendo una
sola instancia. Levantar la segunda en EasyPanel da despliegues sin corte y
tolerancia a que un proceso muera.

Se dejó aparte a propósito, para no mezclarlo con el despliegue que lo hizo
posible. Antes conviene ver unos días de tráfico real con la cola.

## 6. 🟠 Confirmar la política de reintentos de YCloud ante un 5xx

**Dato que falta y del que dependen dos cosas.** El webhook responde 503 si no
puede guardar el evento crudo, y con la app caída Traefik también devuelve 5xx.
Si YCloud reintenta, ningún mensaje se pierde durante un despliegue o una
migración; si no reintenta, hay una ventana real de pérdida.

Se dio por supuesto que reintenta, pero **no se ha verificado en su
documentación**. Es media hora de trabajo y cambia el plan de la migración
futura.

## 7. 🟠 Fase 4: aislamiento y control por cliente

De [33-ESCALABILIDAD.md](33-ESCALABILIDAD.md), para cuando haya bastantes
clientes:

- **RLS (Row-Level Security)**: hoy que los datos de un negocio no se filtren a
  otro depende de que **cada consulta** lleve su `organizationId` a mano. Con
  100 clientes, un `where` olvidado es un incidente de privacidad.
- **Rate-limit por organización**: un cliente con tráfico anómalo consume el
  turno de todos.
- **Panel de costo y uso por cliente**: `usage_event` tiene más de 1.000 filas
  que nadie explota. Sin esto no se puede facturar por consumo ni detectar
  abusos. Coincide con un pendiente que ya existía en
  [09-COSTOS.md](09-COSTOS.md).

## 8. ⚪ Fase 5: infraestructura (la que cuesta dinero)

- **PITR / WAL continuo**: hoy el respaldo es cada 6 h, o sea que un desastre
  cuesta **hasta 6 horas de conversaciones**.
- **Base gestionada o réplica**: un solo servidor, un solo disco, sin failover.
- **Ensayo de migración**: copiar la base a un destino nuevo, restaurarla,
  comparar conteos tabla por tabla y cronometrar, **sin tocar producción**.
  Se hace el día que se decida contratar el destino, no antes.

Tres cosas que muerden el día de la migración, anotadas para no redescubrirlas:

1. **La `ENCRYPTION_KEY` viaja aparte del dump.** Las credenciales de WhatsApp
   de cada cliente están cifradas: sin esa clave, los datos llegan intactos y
   son ilegibles, y ningún cliente puede enviar ni recibir.
2. **La zona horaria**: el servidor corre en UTC y ya ha costado tiempo antes.
3. **Los adjuntos no están en la base** — viven en YCloud y caducan a los 30
   días (pendiente #23). Migrar la base no los salva.

A favor: los IDs son texto (`nanoid`), así que **no hay secuencias que
resincronizar**, y la base pesa 16 MB con una sola extensión (`plpgsql`).

## 9. ⚪ Higiene

- **12 tablas `*_backup_*`** creadas a mano en producción (respaldos manuales
  de `agent_profile` y `kb_entry` de julio y agosto). No las usa nada.
- **`ycloud-reintento-envio.test.ts` deja una promesa rechazada sin manejar**:
  vitest reporta 2 errores aunque las 419 pruebas pasen. Preexistente, ajeno al
  trabajo del 8-ago. Ensucia la señal del gate.
- **`webhook_event` crece sin política de retención**: es la tabla más grande
  (2,5 MB con 831 filas). Con 100 clientes hay que decidir cuánto se guarda.
