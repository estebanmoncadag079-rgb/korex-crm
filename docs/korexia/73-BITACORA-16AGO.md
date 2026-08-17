# Bitácora del 16 de agosto

> **Dentro:** El despliegue que faltaba · La auditoría · Las correcciones, una a
> una · El registro formal de los cuatro cambios

**Formato**: desde el 16-ago rige [75-COMO-SE-DOCUMENTA.md](75-COMO-SE-DOCUMENTA.md).
El relato va primero; **el registro formal, con la reversión de cada cambio,
está al final**.

Sesión de cierre técnico: **ni una bandera encendida, ni un dato de producción
tocado**. Todo el trabajo es código, pruebas y documentación.

---

## 1. La Fase 2 no estaba desplegada (y la doc decía que sí)

Al retomar, `69-FASE-2` afirmaba *"el código está en producción desplegado"*. No
lo estaba: la imagen viva se había construido el 15-ago a las 22:34 UTC y los
cuatro últimos commits eran posteriores. Comprobado **dentro del contenedor**:
`state_source` aparecía en **0** archivos de `/app/.next`.

Tras pulsar Desplegar: `state_source` en 4 archivos, `totalCents` en 2, tarea
nueva `Running` y la anterior `Shutdown`.

> 🔑 Tercera vez que pasa lo mismo (1-ago, 5-ago, Fase 1). El código en la
> carpeta de EasyPanel **no es** el código que corre.

---

## 2. Las métricas de la regla 10, y un bug que esperaba a la carga

Commit `e154e0f`. Las seis métricas salen de **una línea por turno**; el bug era
que el pipeline calculaba las salsas cogiendo *"el primer grupo con opciones"*,
un patrón que la Fase 1.5 ya daba por corregido. Con `RECUBIERTO` cargado, ese
`find` habría pedido **una** salsa a un Mega Box, que lleva cinco.

También estaba **el gate en rojo** sin ser culpa de ninguna prueba: dos
*unhandled rejections* en las pruebas de reintento de YCloud hacían que `vitest`
saliera con código 1 aunque las cuatro pasaran.

---

## 3. La auditoría

Cinco frentes —catálogo, endpoints, Fase 2, seguridad, arquitectura— y trece
hallazgos, **ninguno de los cuales necesita migración**. Lo tranquilizador
primero: ni una ruta de escritura sin autenticación, ni un `sql.raw`, webhooks
con firma verificada, y `scoped()` en todas las escrituras revisadas.

Lo demás está en [72-COMO-ENCENDER-LA-FASE-2.md](72-COMO-ENCENDER-LA-FASE-2.md).

---

## 4. 🔴 El teléfono del cliente iba a parar al log

**Corregido antes de que llegara a pasar**, que es lo único bueno del asunto:
con la bandera apagada no se había emitido ni una línea.

El registro de cambios escribía valor anterior y valor nuevo de cada campo, y la
Fase 2 guarda nombre, teléfono y dirección del cliente final. `paraLog` solo
tapaba secretos (`token`, `apiKey`…) y valores de más de 120 caracteres — un
teléfono no es ninguna de las dos cosas.

La corrección distingue **secreto** de **personal**: un token se oculta y punto,
un teléfono hay que poder seguirlo sin leerlo. Se sustituye por una huella
estable, así que *"¿cambió?"* y *"¿volvió al de antes?"* siguen teniendo
respuesta.

Dos detalles que costaron más que el arreglo:

- **Comparación exacta, no `includes`.** Poner `"nombre"` en la lista habría
  tapado también `producto.nombre` — el nombre de un churro—: privacidad cero
  ganada, trazabilidad de negocio perdida.
- **La red por valor solo mira cadenas.** `totalCents` son `1000000`: siete
  dígitos y ninguna persona detrás.

Siete pruebas nuevas, dos de ellas contra la sobrecorrección.

> 🔑 La lección: **una lista de campos sensibles es una lista de los que alguien
> se acordó**. Por eso el arreglo lleva red, igual que la instrumentación lleva
> `[NO DECLARADO]`.

---

## 5. 🔴 Y entonces apareció lo que ya estaba pasando

La revisión del propio arreglo destapó algo peor. El commit anterior protegía
**una sola superficie**: la que pasa por `paraLog`. Fuera de ella hay ~100
`console.*` directos —no hay `pino`, ni `winston`, ni logger—, y **tres estaban
escribiendo datos de clientes en producción desde hace semanas**:

- dos webhooks volcaban `JSON.stringify(event)` entero: teléfono, nombre de
  perfil y texto del mensaje. **Uno se dispara con los mensajes `unsupported`,
  que llegan a diario**;
- y el pipeline volcaba la respuesta completa del agente, que es el resumen del
  pedido con nombre, teléfono y dirección.

Eso dejó de ser deuda técnica para ser un incidente de privacidad, y cambió la
prioridad: **por delante de la Fase 2**, porque no dependía de ella.

Lo difícil no fue taparlos, fue **taparlos sin romper para qué estaban**. Los dos
de YCloud existían para diagnosticar qué campo trae el remitente cuando el parser
falla — así se descubrió lo de `fromUserId` el 2-ago. `eventoParaLog()` conserva
**todas las claves** y resume los valores: la pregunta se responde igual, y el
teléfono no hacía falta para responderla.

> 🔑 **La lista es de lo PERMITIDO, no de lo prohibido.** En un evento entrante,
> todo texto que no sea un identificador conocido se resume — incluida la clave
> que YCloud añada mañana. Una lista de prohibidos solo protege de lo que ya
> conoces.

Y una regla nueva con guardarraíl: `logs-sin-datos-personales.test.ts` recorre
`src/` entero y **rompe el gate** si alguien vuelve a meter un `JSON.stringify`
dentro de un `console.*`. Detalle en
[74-REGLAS-DE-LOGS.md](74-REGLAS-DE-LOGS.md).

> 🔑 La conclusión del dueño, que reordena lo que queda: **la Fase 2 ya no está
> bloqueada por el estado estructurado, sino por la observabilidad y la
> protección de datos.**

---

## 6. Las dos que quedaban, y el guardarraíl que se puso a prueba

El informe anterior dejaba dos fugas fuera del alcance: `from=${m?.from}` y
`tel=${c.phone}`. No serializaban nada — **interpolaban**, y por eso el
guardarraíl no las veía.

El dueño lo señaló como lo que era: *"se corrigieron las fugas complejas y
quedaron dos triviales; eso rompe la consistencia del sistema"*. Tenía razón, y
además una de las dos estaba **diez líneas por encima** de una de las ya
corregidas.

Antes de tocar nada, un barrido de `src/` entero: **21 candidatos**, de los
cuales 19 son legítimos —el teléfono *del negocio*, identificadores técnicos y
mensajes de excepción— y 2 eran las fugas conocidas. Ninguna nueva.

Lo interesante vino después. Al ampliar el guardarraíl para que detecte
interpolaciones, se le añadió **un caso que le da de comer las dos fugas reales
y comprueba que las detecta**. Y falló: **`.from` no estaba en la lista de
patrones**. Sin ese negativo, el guardarraíl habría quedado en verde dando por
protegido justo el campo que traía el teléfono del cliente.

> 🔑 **Un guardarraíl que nunca ha fallado no demuestra nada**: puede estar
> buscando algo que no existe. Toda comprobación automática necesita su prueba
> negativa — y la suya de exceso: `msg.to`, el número *del negocio*, tiene que
> poder seguir registrándose o el aviso *"número sin cliente"* deja de servir.

---

# Registro formal de los cambios · 16-ago-2026

> Los cuatro se hicieron **antes** de que existiera
> [75-COMO-SE-DOCUMENTA.md](75-COMO-SE-DOCUMENTA.md), y ninguno traía la séptima
> obligación: **cómo revertirlo**. Se completa aquí, que es exactamente la deuda
> que esa regla viene a impedir.

**Lo que vale para los cuatro**: ninguno tocó la base de datos, ninguno añadió
migraciones y **ninguno está desplegado**. Revertir es un `git revert` y nada
más — no hay dato que devolver a su sitio ni bandera que reponer.

### 00:19 · Las métricas de la regla 10, y el bug de las salsas

**Objetivo**: cerrar la regla 10 (las seis métricas) antes de que se persista
ningún estado, sin tocar la base.
**Archivos**: `orders/estado.ts` (emisor de la métrica) · `ai/pipeline.ts`
(los dos enganches y `grupoDeSalsas`) · `orders/normalizar.ts`
(`grupoLlamado`/`grupoDeSalsas` exportadas) · `tests/unit/estado-del-pedido.test.ts`
· `ycloud-reintento-envio.test.ts` (el gate en rojo) · doc: `66`, `67`, `69`,
`70`, `72` (nuevo), índice.
**Riesgos**: que la métrica volcara datos del cliente (se limitó a nombres de
campo); que subir `SCHEMA_VERSION` invalidara estados vivos (**se descartó
tocar el modelo** por eso).
**Evidencia**: 682 pruebas en verde, `tsc` y `eslint` limpios.
**Reversión**: `git revert e154e0f`. Vuelve el bug de las salsas —inofensivo
mientras el catálogo tenga un solo grupo— y desaparecen las métricas. La Fase 2
sigue apagada en ambos casos.
**Estado**: terminado.

### 00:28 · El teléfono del cliente ya no llega al log

**Objetivo**: impedir que `entrega.telefono/direccion/nombre` y `notifyPhones`
se escriban en el registro de cambios.
**Archivos**: `server/registro-de-cambios.ts` · `tests/unit/registro-de-cambios.test.ts`
· doc: `10-SEGURIDAD`, `69`, `72`, `73` (nuevo), índice.
**Riesgos**: **sobrecorregir** — tapar `producto.nombre` o `totalCents` habría
costado trazabilidad de negocio sin ganar privacidad. Dos pruebas lo impiden.
**Evidencia**: 689 pruebas en verde (7 nuevas), `tsc` y `eslint` limpios.
**Reversión**: `git revert 612d3b4`. Los datos personales volverían al log en
cuanto se encendiera la Fase 2. **No revertir sin cerrar antes esa bandera.**
**Estado**: terminado.

### 00:48 · Tres logs dejan de escribir datos de clientes en producción

**Objetivo**: cortar tres fugas **activas** —dos webhooks y el pipeline— que no
dependían de la Fase 2.
**Archivos**: `server/registro-de-cambios.ts` (`sanearEvento`, `eventoParaLog`,
`resumirTexto`) · `inbox/ycloud-events.ts` · `ai/pipeline.ts` ·
`tests/unit/logs-sin-datos-personales.test.ts` (nuevo) · doc: `74` (nuevo),
`10-SEGURIDAD`, `72`, `73`, índice.
**Riesgos**: **perder la utilidad de diagnóstico** por la que existían esos
volcados. Se conservan todas las claves del evento; se pierde a propósito poder
copiar del log el texto de una respuesta perdida.
**Evidencia**: 698 pruebas en verde (9 nuevas), `tsc` y `eslint` limpios.
**Reversión**: `git revert baccd31`. Las tres fugas vuelven a estar abiertas
**en producción**, no en la Fase 2. Es el commit menos revertible de los cuatro.
**Estado**: terminado.

### 01:00 · Las dos fugas por interpolación

**Objetivo**: cerrar `from=${m?.from}` y `tel=${c.phone}`, y que el guardarraíl
detecte también interpolaciones.
**Archivos**: `inbox/ycloud-events.ts` · `inbox/ingest.ts` ·
`tests/unit/logs-sin-datos-personales.test.ts` · doc: `74`, `10-SEGURIDAD`, `73`.
**Riesgos**: un guardarraíl que no detecta nada y parece verde — **pasó**: al
darle de comer las fugas reales se vio que `.from` no estaba en la lista.
**Evidencia**: 701 pruebas en verde (3 nuevas), `tsc` y `eslint` limpios.
**Reversión**: `git revert 89e68f6`. Vuelven las dos interpolaciones y el
guardarraíl deja de mirar `${…}`.
**Estado**: terminado.

### 01:12 · `paraLog(tabla, campo, valor)` y la regla de clasificación

**Objetivo**: que el registro sepa **qué significa** cada dato, no solo cómo se
llama. `contact.name` es una persona, `product.name` un churro y
`agent_profile.name` el nombre del asistente: el mismo campo, tres cosas.
**Archivos**: `server/registro-de-cambios.ts` (`Clase`, `CLASIFICACION`,
`clasificar`, firma nueva de `paraLog`) · `orders/estado.ts` (5 llamadas) ·
`tests/unit/registro-de-cambios.test.ts` · doc: `74` (regla 3), `73`, índice.
**Riesgos**: que un campo no clasificado se volcara por defecto —**se decidió lo
contrario**: se protege y sale marcado `<sin clasificar>`, como `[NO DECLARADO]`—
y que la firma nueva rompiera llamadas: las 8 actualizadas, `tsc` lo verifica.
**Evidencia**: 707 pruebas en verde (6 nuevas), `tsc` y `eslint` limpios.
**Reversión**: `git revert <sha>`. Vuelve `paraLog(campo, valor)` y con él la
imposibilidad de distinguir `contact.name` de `product.name`. **No revertir sin
revisar antes qué tablas se hayan instrumentado entretanto.**
**Estado**: terminado.

### 01:20 · La huella, ahora con clave

**Objetivo**: que la huella deje de ser reversible. Era un hash de 32 bits sin
clave, y un teléfono colombiano son diez dígitos: **probar los diez mil millones
de candidatos y quedarse con el que coincide costaba minutos**.
**Archivos**: `server/registro-de-cambios.ts` (`clave()`, `huellaDe` con
HMAC-SHA256) · `tests/unit/registro-de-cambios.test.ts` · doc: `74`, `73`.
**Riesgos**: (a) que leer la clave tumbara el registro — se lee de `process.env`
y **no de `getEnv()`**, que lanza si falta cualquier otra variable; (b) quedarse
sin clave en silencio — cae a SHA-256 y **avisa una vez por arranque**;
(c) rotar `ENCRYPTION_KEY` invalida las huellas anteriores, anotado en el 74.
**Evidencia**: 712 pruebas en verde (5 nuevas), `tsc` y `eslint` limpios.
**Reversión**: `git revert <sha>`. Vuelve el hash débil; **ningún dato queda
expuesto de golpe**, pero las huellas nuevas dejan de ser comparables con las
emitidas mientras estuvo el HMAC.
**Estado**: terminado.

### 01:30 · El inventario de las salsas, y lo que encontró

**Objetivo**: antes de corregir `normalizar.ts:382`, mapear **todos** los puntos
que interpretan el catálogo. La orden del dueño: *"si encuentras otra
implementación distinta, detente y documéntala antes de modificar nada"*.
**Archivos**: solo documentación — `76-EL-MAPA-DE-LAS-SALSAS.md` (nuevo), `72`,
`00-INDICE`, esta bitácora. **Ni una línea de código.**
**Riesgos**: 🔴 **encontrado uno nuevo y peor que el que se iba a arreglar**.
`sumaDeExtras` recorre todos los grupos y suma cualquier opción cuyo nombre
coincida, **sin mirar de qué grupo es**. En La Churra `AREQUIPE` y `LECHERA`
están como salsa incluida **y** como adición de $1.500: pedir una Churrita con
salsa de arequipe cobraría $1.500 fantasma. Se activa con `cargar:opciones` + la
bandera, las dos en la lista de encendido.
**Evidencia**: 16 puntos inventariados; 3 con lógica propia (`:382`,
`sumaDeExtras`, `render.ts`), 4 que recorren todos los grupos **a propósito**.
**Reversión**: `git revert <sha>`; solo se pierde documentación.
**Estado**: terminado — **el arreglo, detenido a la espera de instrucciones**.

> 🔑 La corazonada del dueño se cumplió al pie de la letra: *"cuando una regla de
> negocio está repartida entre pipeline, validadores, normalizadores y scripts,
> casi siempre aparecen más implementaciones ocultas"*. El bug del `find()`
> apareció en un sitio que la documentación daba por corregido; el inventario
> encontró el siguiente **un piso más abajo, y este cobra dinero de más**.

### 01:35 · Tarea 2A — el precio: cada opción se cobra por su grupo

**Objetivo**: que `sumaDeExtras` deje de cobrar una salsa incluida como si fuera
una adición. Rama propia porque **afecta al dinero**.
**Archivos**: `orders/normalizar.ts` (`grupoDeAdiciones` nuevo, `sumaDeExtras`
reescrita) · `tests/unit/normalizar-pedido.test.ts` · doc: `76`, `72`, `73`.
**Riesgos**: (a) romper el cobro de las adiciones legítimas — seis pruebas lo
cubren; (b) que existiera **otra** implementación del cálculo: se verificó que
no, `sumaDeExtras` es el único sumador de opciones y `normalizar.ts:372` el
único que calcula el total; (c) el recubierto sigue sin sumarse, **a propósito**.
**Evidencia**: 719 pruebas en verde (7 nuevas), `tsc` y `eslint` limpios.
**Reversión**: `git revert <sha>`. Vuelve el doble cobro — **inofensivo mientras
`ADICIONES` no esté cargado**, y peligroso el día que lo esté.
**Estado**: terminado · 🔴 **un hallazgo nuevo, sin corregir a propósito**.

> 🔑 El hallazgo salió **de escribir la prueba**, no de leer el código: el Mega
> Box lleva cinco salsas y solo hay cuatro sabores, y como el normalizador
> deduplica, **nunca llega a cinco**. Sin total, sin confirmación posible. Es
> validación y no precio, así que se queda para la 2B con una prueba que fija el
> comportamiento actual.

### 01:42 · Tarea 2B — las salsas no son únicas

**Objetivo**: aplicar la decisión de negocio del dueño —*"el cliente puede
repetir un sabor hasta el límite de su presentación"*— y desbloquear el Mega Box.
**Archivos**: `orders/normalizar.ts` (dos `includes` fuera, tope nuevo,
`sumaDeExtras` por lo pedido) · `tests/unit/normalizar-pedido.test.ts` · doc:
`76`, `73`.
**Riesgos**: (a) que quitar el `includes` abriera la puerta a pedir siete salsas
en una Churrita — se añadió el tope, que **pregunta en vez de recortar**;
(b) que las adiciones repetidas se cobraran mal: al recorrer el catálogo en vez
de lo pedido, **dos botellas de agua costaban una**. Corregido en el mismo
cambio porque es la misma decisión de negocio.
**Evidencia**: 728 pruebas en verde (11 nuevas), `tsc` y `eslint` limpios.
**Reversión**: `git revert <sha>`. Vuelven las salsas únicas y con ellas el Mega
Box que no se puede cerrar. **Ojo**: también vuelve el cobro de una sola agua.
**Estado**: terminado.

> 🔑 Auditoría de duplicados completa: **dos** deduplicaciones de salsas en todo
> el proyecto, y ninguna más. Los otros ocho `Set`/`includes` deduplican grupos
> del catálogo, teléfonos del equipo, ids o campos de un log — todos correctos.
> La diferencia está en **qué se deduplica**: el catálogo es un conjunto, la
> elección del cliente es una lista.

### 01:50 · Auditoría del modelo de las opciones

**Objetivo**: dejar de corregir síntomas y responder a una sola pregunta —
*¿existe una separación explícita entre la definición del catálogo y la
selección del cliente?* **Sin código, sin cambios.**
**Archivos**: `77-EL-MODELO-DE-LAS-OPCIONES.md` (nuevo), `72`, `00-INDICE`,
esta bitácora.
**Riesgos**: ninguno técnico. El riesgo es **de decisión**: si se toca el modelo,
hay que hacerlo antes de encender, porque después habrá conversaciones vivas
encima de cada cambio de forma.
**Evidencia**: **la respuesta es no.** El catálogo tiene ids, grupos y reglas; la
selección son tres listas de nombres. Cinco de los últimos hallazgos se explican
solos con eso. Y tres hallazgos nuevos: renombrar una opción rompe los pedidos en
curso · **el estado tiene los grupos de La Churra cableados** · el recubierto es
`string|null` y no podría representar un `max_select: 2`.
**Reversión**: `git revert <sha>`; solo documentación.
**Estado**: terminado — **decisión pendiente del dueño**.

> 🔑 La frase que resume la noche entera: **el catálogo es una definición; el
> pedido es una selección.** Hoy los dos se representan como listas de nombres, y
> por eso se confunden. Los cinco errores no fueron cinco descuidos: eran el
> mismo dato mal modelado, encontrado cinco veces.

### 17-ago, 00:10 · Informe de impacto del cambio de modelo

**Objetivo**: responder con números, antes de tocar nada, qué costaría sustituir
las tres listas de nombres por `seleccion: [{grupoId, opcionId, nombre}]`. El
dueño eligió la opción 1 —cambiar el modelo antes de encender— y pidió el
impacto exacto primero. **Sin código.**
**Archivos**: `78-CAMBIAR-EL-MODELO-IMPACTO.md` (nuevo), `72`, `00-INDICE`,
esta bitácora.
**Riesgos identificados**: el mayor no es el código, son **dos**: (a) el prompt
de extracción cambia justo donde el modelo medía **0 % de fallos**, y eso
**invalida la medición del 15-ago** — la regla 13 obliga a repetirla; (b) el
`SCHEMA_VERSION` sube a 2, que hoy es gratis y deja de serlo en cuanto haya un
pedido vivo.
**Evidencia**: 9 archivos de producción y 3 de pruebas · 61 aserciones a
reescribir · `conversation_state` **verificada vacía en producción** (0 filas, 0
orgs) · 3 de los 5 errores dejarían de ser expresables, 2 seguirían dependiendo
de la disciplina.
**Reversión**: `git revert <sha>`; solo documentación.
**Estado**: terminado — **esperando la decisión de ejecutar**.

> 🔴 **Hallazgo nuevo (el tercero de esta familia)**: `67-FASE-1.5` afirma que el
> `"0"` del reinicio *"ya no está clavado: entra por parámetro"*. Entra por
> parámetro… **y el único sitio que llama a `matchesReinicio` no se lo pasa**.
> El efecto real es idéntico al de antes: con la Fase 2 encendida, un `0` borra
> el pedido en **cualquier** negocio — incluido el de listas numeradas que la
> propia doc pone como ejemplo de por qué se arregló.

### 01:0x · La regla de documentación

**Objetivo**: dejar escrita la regla del dueño y saldar la deuda de reversión de
los cuatro cambios anteriores.
**Archivos**: `75-COMO-SE-DOCUMENTA.md` (nuevo) · esta bitácora · índice.
**Riesgos**: ninguno técnico — no toca código.
**Evidencia**: sin código, el gate no cambia (701 en verde).
**Reversión**: `git revert` del commit. Se perdería la regla escrita, no ningún
comportamiento.
**Estado**: terminado.
