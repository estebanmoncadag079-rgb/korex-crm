# 196 — El domicilio siempre va en el total, antes de confirmar

25-sep-2026. Rama `014-domicilio-siempre-incluido`. Solo aplica a negocios con
tabla de zonas (`delivery_source='tabla'`, hoy MALIA). La Churra, Lis y el resto
(cotizan el domicilio aparte) no cambian: se decide por configuración, nunca por
el nombre del negocio.

## El caso

MALIA, Maye Díaz (`cv_dgih82h6duslfe7be5gm`): 2 pavés a domicilio, dirección
"Calle 13 # 9-35, C.C. El Caleño, local 429, Centro de Cali". Nunca preguntó
cuánto costaba el envío. El resumen salió con **"Total: $20.000"**, solo los
productos.

## Por qué pasaba (el mecanismo, no el síntoma)

1. **La tarifa solo se buscaba si el MODELO lo decidía.** Su contrato
   (`prompts.ts`) decía consultar el domicilio "cuando el cliente pregunte cuánto
   cuesta". Si no preguntaba, nadie la buscaba.
2. **El cierre no bloqueaba un domicilio sin tarifa en un negocio con tabla.**
   `inconsistenciaFinancieraDePedido` comprueba la tarifa que el cierre TRAE; este
   no traía ninguna, y salía con "Domicilio: pendiente de cotización" (lo correcto
   para Lis y La Churra, no para MALIA).
3. **El resumen previo —lo que el cliente acepta— no se comprobaba.** El cierre sí;
   el resumen, no.
4. **La dirección de Maye no está en la tabla** (la tabla está por BARRIOS; "Centro
   de Cali" no es uno). Antes de este cambio, además, el buscador aceptaba
   coincidencias falsas (un número de calle o "cali" bastaban para "encontrar" una
   zona): medido sobre 49 direcciones reales de pedidos de MALIA.
5. **Encontrado al probar con el modelo real:** el turno en que el cliente da su
   dirección o su teléfono no suele ser un `reply` sino un `provide_requirement`
   (registra el dato y contesta). Los guardarraíles de texto solo miraban `reply`,
   así que ni la verificación nueva ni el resumen aplazado (T1, doc 192) se
   disparaban justo en esos turnos. Y el detector del resumen aplazado solo
   conocía "preparo/armo el resumen"; el modelo dijo "ahora te **muestro** el
   resumen".

6. **La causa más directa del "Total: $20.000": el propio backend.** El bloque
   `PEDIDO EN CURSO` (`comoTexto`, `extraer.ts`) le decía al modelo
   `TOTAL (lo calculó el sistema, úsalo tal cual): $20.000` —el subtotal de
   productos— aun con el domicilio verificado. El modelo obedecía. Una prueba
   (`estado-entrega-en-el-bloque`) lo fijaba a propósito ("el total sigue siendo
   el de productos").
7. **Con el pedido completo, el turno no avanzaba** sin frase delatora: "¿Quieres
   que te muestre el resumen?" (oferta) o "Guardé tu nombre y celular." (nada
   más). T1 solo reconocía "preparo/armo el resumen".

## Qué hace ahora (regla del dueño)

- **El backend le da al modelo el total COMPLETO**: con tarifa verificada,
  `PRODUCTOS $A + DOMICILIO $Y = TOTAL $Z`; con tarifa pendiente, solo
  `PRODUCTOS` y la advertencia de que eso no es el total; con el barrio pedido,
  "el barrio" es lo primero en `TE FALTA`. Solo cuando hay una entrega de
  domicilio guardada (negocios con tabla); Lis, La Churra y citas ven el bloque
  igual que siempre.

- **Con tabla, el backend busca la tarifa solo**, en cuanto el pedido es a
  domicilio y hay una dirección sin tarifa verificada para ELLA
  (`debeVerificarDomicilio`, `extraer.ts`). Entra por el mismo bucle de
  `consultar_domicilio` de siempre; el modelo recibe el hecho con las cifras ya
  hechas: *productos $A + domicilio $Y = total $Z* (`verificacion.ts`).
- **Si la dirección no está en la tabla** (o coincide con varias zonas): el bot
  pide el barrio —"Por favor, dime el barrio para ayudarte con el total con el
  domicilio"— sin inventar tarifa ni prometer "te confirmo". Con el barrio, el
  backend busca y suma.
- **Mientras falta el barrio, cada mensaje lo pide** (`faltaPedirElBarrio`): si el
  modelo promete un resumen o un total sin barrio, se rehace; si ni así lo pide,
  el backend agrega la pregunta.
- **Se pasa al equipo** (con el motivo escrito) solo si el cliente trae un lugar
  NUEVO que tampoco está en la tabla, o si ya se le pidió el barrio en dos
  mensajes distintos y sigue sin darlo. Contestar otra cosa (su nombre, su
  teléfono) no es negarse: medido con el modelo real, derivar ahí era demasiado
  pronto. Dos búsquedas dentro del mismo mensaje nunca cuentan como dos.
- **Si el cliente ya había nombrado su barrio** (una consulta anterior lo encontró)
  y después da una dirección sin barrio, esa zona se conserva: no se le vuelve a
  preguntar.
- **Si el cliente dijo explícitamente que recoge**, nunca se busca ni se cobra
  domicilio, aunque la modalidad guardada no se haya actualizado.
- **Cierre:** código nuevo `domicilio-pendiente-en-tabla` — no se cierra un pedido
  a domicilio sin tarifa. La corrección busca la zona con la dirección del cliente
  (aunque el modelo no lo haga) y, según el resultado, cierra con la tarifa real,
  pide el barrio o pasa al equipo. Excepción que ya existía: si una PERSONA del
  equipo dijo ese total en el chat, se respeta.
- **Resumen:** guardarraíl nuevo `resumen_sin_domicilio` — si el total que dice el
  resumen no es subtotal + domicilio verificado, **o si no muestra la línea del
  domicilio con su valor**, se rehace con las tres cifras del backend. No deriva.
- **T1 ampliado** (doc 192): con la hoja lista, además de "ahora preparo el
  resumen", se rehace el turno que OFRECE el resumen ("¿quieres que te lo
  muestre?") o que no trae ni resumen ni pregunta (`ofreceResumen`,
  `turnoSinAvance`). No salta si el resumen ya se mostró en el mensaje anterior
  (caso Natalia: ahí toca cerrar, no repetir).
- **`contestaYSigue` / `conTextoCorregido`** (`pipeline.ts`): los guardarraíles de
  texto de mitad del pedido ven también `provide_requirement` y `update_lead`, y al
  corregir el texto conservan lo que esa acción registraba.
- **`EntregaVerificada`** gana dos campos opcionales: `direccion` (para qué
  dirección se verificó; si cambia, se re-verifica) y `barrioPedido`. Sin migración:
  son opcionales y las entregas viejas se leen igual.

## Verificación

- 3.000+ pruebas unitarias en verde, incluidas las nuevas
  (`domicilio-siempre-incluido`, `verificacion-de-domicilio`, `contesta-y-sigue`,
  variantes de `resumen-aplazado`). `tsc`, `lint`, `next build`.
- **Modelo real (escenarios, `is_test`, MALIA):**
  - *"el domicilio va en el total sin que lo pregunten"* ✅ — resumen: "2 × Pavé
    Cremoso 8 oz… Tarifa domicilio: $10.000 · TOTAL: $30.000".
  - *"dirección sin barrio: pide el barrio y luego suma"* ✅ — "Edificio Colombia…
    Centro, Cali" → "Por favor, dime el barrio para ayudarte con el total del
    domicilio" → "barrio floralia" → "Subtotal $20.000 · Domicilio $10.000 · Total
    $30.000".
- **Camino real, solo lectura, el estado de Maye en la base:** `debeVerificar=true`,
  su dirección da `pedir-barrio`, y su cierre sin tarifa da
  `domicilio-pendiente-en-tabla` (bloqueado).
- **Pendiente tras el deploy:** ver en producción un pedido real a domicilio de
  MALIA con el domicilio en el resumen.

## Configuración que sigue pendiente (no es código)

- La tabla de MALIA no tiene una zona para el Centro de Cali / C.C. El Caleño. Con
  este cambio el bot pide el barrio; si el negocio sí entrega ahí, conviene agregar
  esa zona en el CRM.

## Cómo revertir

Revertir el merge. Sin migraciones ni datos tocados (los campos nuevos de
`EntregaVerificada` son opcionales y se ignoran).
