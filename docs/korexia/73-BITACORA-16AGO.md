# Bitácora del 16 de agosto

> **Dentro:** El despliegue que faltaba · La auditoría · Las correcciones, una a
> una

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
