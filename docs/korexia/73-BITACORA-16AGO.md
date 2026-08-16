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

### 01:0x · La regla de documentación

**Objetivo**: dejar escrita la regla del dueño y saldar la deuda de reversión de
los cuatro cambios anteriores.
**Archivos**: `75-COMO-SE-DOCUMENTA.md` (nuevo) · esta bitácora · índice.
**Riesgos**: ninguno técnico — no toca código.
**Evidencia**: sin código, el gate no cambia (701 en verde).
**Reversión**: `git revert` del commit. Se perdería la regla escrita, no ningún
comportamiento.
**Estado**: terminado.
