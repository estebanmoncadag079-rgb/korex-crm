# Pendientes (continuación, 9-ago-2026): qué importa de verdad

> **Dentro:** El orden y por qué · 1. Contraseña del superadmin · 2. El día 1
> del salón · 3. Automatizar el alta de clientes · 4. Vigilar los turnos
> fallidos · 5. Subir a dos réplicas · 6. Reintentos de YCloud · 7. Fase 4 ·
> 8. Fase 5 · 8b. El producto que desaparece (cerrado) · 9. Higiene

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

> ✅ **Hecho el 9-ago: editar un servicio desde la pantalla.** Antes, subir un
> precio obligaba a archivar y recrear el servicio, o a que la agencia entrara
> a la base de datos — y eso no es el alta, es el **mantenimiento**, que pasa
> muchas más veces. El `PATCH` del servidor ya existía desde que nació el
> vertical de citas; solo faltaba el botón. **Vale la pena buscar más casos
> así**: capacidades ya construidas que nadie puede usar porque no tienen
> pantalla. Son las mejoras más baratas que quedan.

## 4. ✅ Vigilar los turnos fallidos — HECHO (9-ago-2026)

`monitor-bots-alerta.sh` ya avisa por Telegram de dos cosas que el chequeo de
salud de Docker no puede ver, porque en ambas la web responde con normalidad:
un cliente que se quedó **sin respuesta**, y la **cola que no se vacía** (el
bot mudo con el contenedor sano). Detalle en
[34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md).

Probado insertando un fallo de mentira: la alerta llegó y la fila se borró.

## 5. 🟠 Subir a dos réplicas

El trabajo del 8-ago lo **habilita pero no lo activa**: sigue corriendo una
sola instancia. Levantar la segunda en EasyPanel da despliegues sin corte y
tolerancia a que un proceso muera.

Se dejó aparte a propósito, para no mezclarlo con el despliegue que lo hizo
posible. Antes conviene ver unos días de tráfico real con la cola.

## 6. ✅ Reintentos de YCloud — VERIFICADO (9-ago-2026)

**Sí reintenta**: 7 veces (10 s → 30 s → 5 min → 30 min → 1 h → 2 h → 2 h) ante
cualquier respuesta que no sea 2xx. Tabla completa y consecuencias en
[03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md).

Lo que importa para lo que viene: **un despliegue no pierde mensajes**, y una
parada de mantenimiento tiene **~6 horas de colchón, no infinito**. Pasado eso,
el evento se descarta para siempre. Los reintentos tampoco duplican nada.

⚠️ Un límite que hay que respetar y que antes se incumplía: **hay que responder
en menos de 6 segundos**. Se cumple desde el 8-ago, cuando el turno del agente
dejó de correr dentro del propio request.

## 7. 🟠 Fase 4: aislamiento y control por cliente

De [33-ESCALABILIDAD.md](33-ESCALABILIDAD.md), para cuando haya bastantes
clientes:

- **RLS (Row-Level Security)**: hoy que los datos de un negocio no se filtren a
  otro depende de que **cada consulta** lleve su `organizationId` a mano. Con
  100 clientes, un `where` olvidado es un incidente de privacidad.
- ✅ **Reparto de la cola entre clientes — HECHO (9-ago-2026)**: ningún negocio
  puede tener más de `CONCURRENCIA_POR_ORG` (2) turnos corriendo a la vez, de
  los 4 del worker. Se hizo al saber que entra un cliente que vende ~10× lo de
  Lis: sin tope, su hora pico dejaba a los demás negocios esperando detrás. Es
  un límite de simultaneidad, no de cuánto se le atiende: lo que no entra ahora
  entra un segundo después. Probado contra Postgres real.
- **Rate-limit de abuso por organización**: lo anterior reparte el trabajo, pero
  no frena a un cliente con tráfico anómalo (un bucle de otro bot, por ejemplo).
  Sigue pendiente.
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

## 8b. ✅ El producto que desaparece del pedido — CERRADO (9-ago-2026)

> **Resuelto con un guardarraíl en el servidor**, al saber que el lunes entra un
> cliente que vende ~10× lo de Lis: con ese volumen, un producto que se cae en
> silencio deja de ser una anécdota y pasa a ser dinero diario.
>
> Verificado con el pipeline real: el log dice `se dejó caer 7oz del pedido;
> rehaciendo el turno` y la respuesta corregida lleva **los dos** cremosos,
> pidiendo los toppings de cada uno. El control también pasa: con "no, mejor
> uno de 16 oz" **sustituye** en vez de duplicar.
>
> Detalle abajo, que explica por qué el prompt no bastó.

**Historia (por qué acabó en el servidor):**

Caso: el cliente pide un Cremoso de 7 oz, el agente le pregunta los toppings, y
al decir "Quiero un cremoso de 16 Oz" el de 7 oz **desaparece del pedido** sin
que nadie lo note. Es dinero que se cae en silencio.

Se añadió una regla al prompt del sistema (no sustituir; sumar si el cliente es
claro, preguntar si es ambiguo). Verificado contra el **pipeline real** dentro
del contenedor:

| Lo que dice el cliente | Resultado |
|---|---|
| "y **también** uno de 16" | ✅ "sería un Cremoso de 7 oz y un Cremoso de 16 oz" |
| "**Quiero** un cremoso de 16 Oz" | ❌ sigue sustituyendo — el caso reportado |

**La regla del prompt no basta para el caso ambiguo.** Es el mismo patrón que
ya obligó a poner dos guardarraíles en el servidor (`anunciaCierre` y
`anunciaCitaAgendada`): hay conductas que el prompt no consigue.

**Cómo quedó**: `productosOlvidados` compara las medidas (7 oz, 16 oz, 500 ml…)
que el agente tenía sobre la mesa con las de su respuesta nueva. Si dejó caer
alguna, se rehace el turno con la corrección delante — igual que el cierre
falso y la cita fantasma. Se detecta por MEDIDA y no por nombre de producto:
es lo que distingue las variantes que se confunden y no depende del catálogo de
cada negocio.

Dos decisiones deliberadas:

- **Si el cliente dice que cambia** ("mejor", "en vez de", "cámbialo"), el
  guardarraíl calla: ahí sustituir es lo correcto.
- **Si insiste tras la corrección, NO se deriva a una persona** (a diferencia
  de los otros dos guardarraíles). Equivocarse de tamaño se recupera en el
  resumen, y con un negocio de volumen sacar a un humano en cada duda es peor
  remedio que la enfermedad. Se registra en el log y se sigue.

**Límite conocido**: solo ve productos que se distinguen por una medida. Dos
productos con nombre distinto y sin medida ("un polvoroso y un cremoso") no los
compara. Si aparece ese caso, el siguiente paso es extraer los nombres del
catálogo del KB.

> 🔧 **Herramienta nueva: `pnpm probar:agente <organizationId> "msg1" "msg2"`.**
> Copia de `probar:citas` sin la exigencia del vertical de citas, así que
> **sirve para los clientes de pedidos**. Usa el pipeline REAL con una
> conversación `is_test` que jamás toca WhatsApp. Salió de aquí: reconstruir el
> prompt a mano en un script aparte (`/root/probar-lis.py`) **no vale** —aquel
> ni siquiera incluía las `escalation_rules`, así que probaba un prompt que no
> es el de producción. Para el contenedor, la receta de bundle está en
> [30-SALON-PRUEBAS.md](30-SALON-PRUEBAS.md) (autocontenido, sin
> `--packages=external`: la imagen no trae `drizzle-orm`).

## 9. ⚪ Higiene

- **12 tablas `*_backup_*`** creadas a mano en producción (respaldos manuales
  de `agent_profile` y `kb_entry` de julio y agosto). No las usa nada.
- **`ycloud-reintento-envio.test.ts` deja una promesa rechazada sin manejar**:
  vitest reporta 2 errores aunque las 419 pruebas pasen. Preexistente, ajeno al
  trabajo del 8-ago. Ensucia la señal del gate.
- **`webhook_event` crece sin política de retención**: es la tabla más grande
  (2,5 MB con 831 filas). Con 100 clientes hay que decidir cuánto se guarda.
- **`monitor-bots-alerta.sh` solo existe en `/root` del VPS.** No está en el
  repositorio (lleva el token de Telegram dentro, y aquí no van secretos) y los
  respaldos automáticos cubren `/opt/korex-crm`, no `/root`. Si se pierde el
  servidor, se pierde la vigilancia entera y hay que reescribirla. Lo razonable
  es versionar el script con el token sacado a una variable de entorno.

## 10. ⚪ De la tarde del 9-ago (detalle en [39](39-BITACORA-9AGO-TARDE.md))

- **Traer el precio real de cada mensaje de YCloud** — hoy se anotan a 0. Es
  correcto hasta el 1-oct, pero **después el panel mentirá** mientras la wallet
  se vacía. Es el pendiente con fecha límite.
- **Ocultar una etapa del tablero sin borrarla.** Las anclas `won`/`lost` no se
  pueden eliminar, y hacen bien. El dueño quería ver solo tres columnas: haría
  falta un interruptor por etapa, que es cambio de esquema. No autorizado.
- **El agente no ve reacciones ni stickers** ([24](24-MENSAJES-UNSUPPORTED.md)).
- **El avatar parte los emojis del nombre** ("Kathe 😜" → `K◆`). Cosmético.
- **Vigilar las caídas al modelo de respaldo**: dos llamadas a Sonnet costaron el
  22 % del mes de Lis. Si se vuelven frecuentes, el costo se nota ahí primero.
