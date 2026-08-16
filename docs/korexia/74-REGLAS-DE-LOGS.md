# Reglas de los logs

> **Dentro:** Las dos reglas · Por qué existen · Qué usar en cada caso · Lo que
> el guardarraíl comprueba solo · Lo que todavía no cubre

**Dictadas el 16-ago-2026**, después de encontrar que dos webhooks volcaban el
evento entero —teléfono, nombre de perfil y texto del mensaje del cliente— en el
log del contenedor, y un tercer punto volcaba la respuesta completa del agente,
que lleva el resumen del pedido.

---

## Regla 1 — Nada completo, nada del usuario

> **Ningún `console.log`, `console.info`, `console.warn` ni `console.error` puede
> registrar directamente estructuras completas, eventos completos, objetos
> completos o texto libre procedente del usuario.**

Lo que sale al log se elige campo a campo, o pasa por una función que lo sanea.

## Regla 2 — Un solo sitio que sanea

> **Toda salida de log con datos que no sean identificadores debe pasar por
> `@/server/registro-de-cambios`.**

No se añaden módulos nuevos de registro. Ya hay `registrarCambios`, `paraLog` y
`registrarMetricaDeEstado`; **el riesgo real no es que falte un mecanismo, es que
haya cinco** y que cada uno proteja cosas distintas. Todo lo nuevo entra ahí.

---

## Qué usar en cada caso

| Lo que quieres registrar | Qué usar | Qué sale |
|---|---|---|
| Un evento entrante (webhook) | `eventoParaLog(event)` | Todas las **claves**, los valores de texto resumidos |
| Un texto libre (mensaje, respuesta del agente) | `resumirTexto(texto)` | `<45 caracteres · huella a59491e8>` |
| Un valor de un campo concreto | `paraLog(campo, valor)` | El valor, salvo que sea secreto o personal |
| Un cambio en una tabla | `registrarCambios(...)` / `conRegistro(...)` | Una línea por campo, ya saneada |
| Ids, tipos, estados, contadores, tiempos | Directamente | Tal cual: no identifican a nadie |

**Los identificadores no se tocan.** Un `conversationId`, un `wamid` o un
`organizationId` son lo que permite reconstruir qué pasó, y esconderlos no
protege a nadie: convierte el log en ruido.

---

## Por qué `eventoParaLog` conserva las claves

Los dos volcados que esta regla sustituye **no estaban puestos por descuido**:
existían para diagnosticar *"¿qué campo trae el remitente cuando el parser
falla?"*. Gracias a uno de ellos se descubrió el 2-ago-2026 que algunos clientes
mandan `fromUserId` en vez de `from`.

Esa pregunta se responde **viendo qué claves vienen, no sus valores**:

```jsonc
{
  "id": "evt_01J9",
  "type": "whatsapp.inbound_message.received",
  "whatsappInboundMessage": {
    "id": "wamid.HBgMNTczMTU4",
    "wabaId": "<oculto>",
    "from": "<13 caracteres · huella e7cd1a69>",
    "fromUserId": "<18 caracteres · huella e0827afc>",
    "customerProfile": { "name": "<12 caracteres · huella a39046ed>" },
    "text": { "body": "<45 caracteres · huella a59491e8>" }
  }
}
```

Se sigue viendo que `fromUserId` vino, que es distinto de `from`, y que el
mensaje traía texto. No se ve el teléfono, ni el nombre, ni lo que escribió.

**La lista es de lo PERMITIDO, no de lo prohibido**: en un evento de webhook,
todo string que no sea un identificador conocido se resume — incluida la clave
que YCloud añada mañana y que nadie haya previsto. Es la única forma de que un
campo nuevo no se vuelque solo.

---

## El guardarraíl que lo comprueba solo

`tests/unit/logs-sin-datos-personales.test.ts` **recorre todo `src/`**, extrae el
argumento completo de cada `console.*` contando paréntesis, y falla por dos vías:

1. **Serialización**: el argumento contiene `JSON.stringify` o `util.inspect`.
2. **Interpolación**: alguna `${…}` toca un dato de una persona —`.phone`,
   `.from`, `.text`, `.body`, `waUserId`, `fromUserId`, `profileName`,
   `customerProfile`, `.direccion`, `.address`, `.caption`— **sin pasar por**
   `resumirTexto()`, `paraLog()` o `eventoParaLog()`.

**Y se verifica a sí mismo.** Hay un tercer caso que le da de comer las dos fugas
reales del 16-ago y sus versiones corregidas: si el detector dejara de detectar,
falla. No es adorno — al escribirlo se descubrió que `.from` **no estaba en la
lista**, y sin ese negativo el guardarraíl habría dado por protegido justo el
campo que traía el teléfono del cliente.

> Un guardarraíl que nunca ha fallado no demuestra nada: puede estar buscando
> algo que no existe.

Un cuarto caso protege del exceso contrario: `msg.to` y `businessPhone` —el
número **del negocio**— tienen que poder seguir registrándose, porque sin ellos
el aviso *"mensaje para un número sin cliente"* no sirve para nada.

> Si esa prueba se pone roja, **el arreglo no es añadir una excepción**: es pasar
> el objeto por `eventoParaLog()` o `resumirTexto()`.

Una regla escrita se olvida en tres semanas. Esta no se puede olvidar: rompe el
gate.

---

## Lo que todavía NO cubre

Con honestidad, porque la diferencia importa:

1. **Hay ~100 `console.*` directos** repartidos por `src/`. La regla 2 dice que
   todo debe pasar por el módulo de registro; hoy eso se cumple para lo
   peligroso —estructuras completas y datos personales—, no para la última línea
   escrita. La migración es una tarea aparte, y **no urge**: lo que hacía daño
   ya no puede pasar sin romper el gate.
2. **El guardarraíl mira `console.*`, no cualquier salida.** Un `process.stdout.
   write` o una librería futura se le escapan. Hoy no existe ninguno de los dos.
3. **La lista de patrones es de lo conocido.** Cubre los campos que existen hoy;
   un dato personal con un nombre nuevo (`nit`, `cedula`, `correo`) no dispara
   nada hasta que se añada. Es la misma limitación que `PERSONALES`, y la misma
   respuesta: cuando aparezca un campo nuevo, entra en las dos listas.
4. **La huella es seudonimización, no anonimización.** Son 32 bits sin sal: quien
   tenga el log puede probar los diez mil millones de teléfonos posibles y
   encontrar el que coincide. Para un log interno es aceptable; conviene saberlo.
   Endurecerla con HMAC (`ENCRYPTION_KEY` ya existe) cuesta una línea y está
   anotado para cuando la Fase 2 se estabilice.
