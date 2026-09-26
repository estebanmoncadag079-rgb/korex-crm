# 198 — El LLM entiende al cliente; el backend solo da datos estructurados

25-sep-2026. Rama `015-el-llm-entiende-al-cliente`. Decisión del dueño:

> El backend no tiene que entender al cliente. El único que puede entender al
> cliente es el LLM. El backend solamente tiene datos estructurados. La fuente
> de verdad del trato es la ficha del negocio.

## Diagnóstico (anclado a código y a producción)

### A. El backend adivinaba la intención del cliente con palabras clave

Antes de la primera llamada al modelo, `pipeline.ts` corría cuatro detectores
sobre el texto del cliente y le inyectaba al modelo su conclusión como HECHO:

| Detector | Qué inyectaba | Daño medido |
|---|---|---|
| `detectarConsultaDeListadoDeProducto` | el catálogo "real y actual" | bajo, pero es el backend decidiendo qué preguntó |
| `leerIntencion` → `PLAN DEL TURNO` | "el cliente preguntó X, respóndelo" | el backend clasifica al cliente |
| `detectarConsultaFactualDeProducto` | "No encontré «X». No digas que sí lo tienen" | Lis 25-sep 13:42: "hoy tienes de qué sabores" → buscó el producto «de que sabores» → derivó a una persona |
| `detectarConsultaFactualDeMedioPago` + `resolverMetodoDePago` | "«X» SÍ está entre las formas de pago. Confírmalo con seguridad, no lo pongas en duda" | MALIA/Sofía 25-sep 17:35: aprobó efectivo contra entrega (la ficha dice "efectivo solo recogiendo en planta") → venta perdida |

Además:
- `resolverMetodoDePago` juzga una FRASE libre (`ficha.pago.formas`) buscando la
  palabra sin un "no" delante. No entiende condiciones ("solo recogiendo") ni
  "no **se** recibe". Medido: aprueba efectivo y contraentrega en MALIA (domicilio)
  y en **Lis** ("No se recibe efectivo").
- El guardarraíl `pago_contradicho` hace cumplir ese veredicto equivocado: si el
  modelo dice correctamente "no", lo obliga a rehacer y, si insiste, **deriva**.

### B. El tono de la ficha pierde frente a la conducta genérica

La ficha de Lis dice: "Dulce, alegre y cercano, nunca frío ni cortante… Varía
saludos y agradecimientos". Llega al prompt, pero como UNA línea, después de
`ESTILO` —cuya primera orden en negrita es **"Habla lo menos posible."**— y antes
de ~17.000 caracteres de conducta que repiten "hablando poco" y titulan el primer
paso "Qué quiere y cuántos". gpt-5-mini es literal: copia "¿Qué quieres y
cuántos?" y obedece la brevedad antes que el trato. Caso Tatiana (Lis, 25-sep):
preguntó "¿de pronto alcanzo a pedir?" y no se le contestó.

Auditoría de la ficha → prompt: todos los campos llegan
(`observacionesHorario` se inyecta en tiempo de ejecución desde `prompts.ts`;
`cierre` son los requisitos; `duracionTipicaMin` solo sirve al alta). No hay
campos escritos por el cliente que el bot ignore; el problema es de PRIORIDAD.

## Plan de ejecución

### Parte A — el backend deja de interpretar al cliente (código, todos los negocios)

1. Retirar de `pipeline.ts` los cuatro bloques previos al modelo (listado,
   plan del turno, producto, pago). Borrar `catalog/deteccion.ts` y
   `pagos/deteccion.ts` y sus pruebas (código muerto que invita a reintroducirlo).
   `orders/intencion.ts` se queda (contiene la regla de pedido abandonado, T4).
2. El modelo pide los datos: `consultar_producto` y `consultar_medio_pago` ya
   existen. El backend responde desde el catálogo estructurado (sin cambio).
3. Pagos: como `formas` es texto libre, el backend **no da veredicto**. A
   `consultar_medio_pago` le responde con la política LITERAL del negocio y la
   modalidad del pedido si el estado la tiene (dato estructurado), y el modelo la
   aplica. Se retira `resolverMetodoDePago` y el guardarraíl `pago_contradicho`.
   El arreglo definitivo (formas de pago estructuradas por modalidad en el CRM)
   queda como siguiente fase.
4. Se conserva `matchesHandoffIntent` ("quiero hablar con un asesor"): es el
   requisito FR-022 del producto, falla hacia el lado seguro y no afirma nada al
   cliente. Cambiarlo es decisión del dueño.

### Parte B — el trato de la ficha manda (conducta genérica; cada negocio con el suyo)

5. En el prompt, el tono del negocio pasa a ser el PRIMER bloque de conducta,
   con la regla explícita: "este trato manda sobre cualquier otra instrucción de
   estilo".
6. `ESTILO`: "Habla lo menos posible" → "Breve, nunca seco": mensajes cortos,
   pero con el trato del negocio (saludo, calidez, gracias). Y: **primero
   responde lo que el cliente dijo o preguntó; luego avanza**.
7. `meta()`: fuera "hablando poco"; los puntos del orden son QUÉ averiguar, no
   frases para copiar.
8. Cada negocio sigue con SU tono: el texto genérico no fija ninguno.

### Aislamiento entre negocios

- Parte A cambia código compartido, pero solo quita inferencias; los datos
  estructurados de cada negocio siguen siendo los suyos.
- Parte B cambia la conducta genérica; lo propio de cada negocio (tono, reglas,
  pagos) sale solo de su ficha. Antes de empezar, `regenerar:flota` en seco dio
  "sin cambios" para los 4 negocios con ficha: la diferencia al regenerar será
  exactamente este cambio. Se regenera **negocio por negocio**, con respaldo.
- Camilabrandcol y korex.ia no tienen ficha: la Parte B no los toca.

### Verificación (hecha, sin gastar tokens — decisión del dueño)

- TDD de cada pieza; gate completo verde: `tsc`, `lint`, 272 archivos de
  prueba, `next build`.
- Nueva `pipeline-el-backend-no-interpreta.test.ts`: con los 8 mensajes reales
  (Lis "de qué sabores", Sofía "efectivo cuando llegue", precios, listado,
  domicilio…) la primera llamada al modelo no lleva ningún hecho ni plan del
  backend; cuando el modelo pide producto/pago, el backend responde desde datos
  / política literal, sin veredicto ni corrección posterior.
- `generador-de-prompt.test.ts`: el trato de la ficha va primero y manda; cada
  negocio lleva el suyo; sin "habla lo menos posible".
- `regenerar:flota` en seco: los 4 negocios pasan de "sin cambios" a +~800
  caracteres; la diferencia de Lis, línea por línea, es EXACTAMENTE este cambio.
- Escenarios agregados al banco (`PROMPT_LOCAL=1` los corre con el prompt en
  memoria) pero **no se corren**: el dueño decidió verificar con el modelo real
  directamente en producción.

### Orden de despliegue

1. Deploy del código (el dueño). La Parte A actúa sola desde ese momento.
2. Regenerar la conducta **negocio por negocio**, con visto bueno:
   `regenerar:flota <organizationId> --aplicar` (crea respaldo antes).
3. Verificar en conversaciones reales: trato de cada negocio, respuestas a
   preguntas, pagos en MALIA y Lis.

## Lo que queda del backend leyendo texto del cliente (siguiente fase, sin tocar aún)

Inventario completo, para decidir uno por uno. Ninguno inyecta ya un "hecho"
antes del modelo; son chequeos posteriores o requisitos del producto:

| Dónde | Qué hace | Riesgo |
|---|---|---|
| `handoff.ts` `matchesHandoffIntent` | "hablar con un asesor/persona" → pasa al equipo antes del modelo | Bajo: requisito FR-022, falla hacia una persona |
| `operaciones.ts` (~871) regalo | no deja marcar `paraRegalo` si el cliente escribió una negación | Medio: el backend corrige la lectura del modelo |
| `fijar_dato` nombre (compuerta 4) | exige que el nombre aparezca en lo que escribió el cliente | Bajo: comprueba un DATO literal, no una intención |
| `noDioElTotal` (`PIDE_EL_TOTAL`) | si el cliente pidió el total y la respuesta no lo trae, rehace | Medio: palabras clave sobre el cliente; solo pide rehacer |
| `confirmoPeroNoSeCerro` (`esConfirmacionCorta`) | "sí/listo" tras un resumen y no se cerró → rehace | Medio: ídem |
| `productosOlvidados` | productos que el cliente nombró y la respuesta omitió → rehace | Medio: ídem |
| `matchesReinicio` ("0") | el cliente escribe "0" para reiniciar | Ninguno: es un COMANDO explícito del negocio, no una intención |

La dirección de la siguiente fase: que esas lecturas las haga el modelo (una
intención estructurada en su respuesta, p. ej. `confirma: true`), y el backend
solo actúe sobre ese campo.

## Pendiente de configuración

- Formas de pago estructuradas por modalidad en el CRM (domicilio / recogida).
  Hasta entonces, el modelo aplica la política literal.

## Cómo revertir

Código: revertir el merge. Prompts: restaurar de la tabla de respaldo
`agent_profile_bk_regen_<fecha>` que crea `regenerar:flota --aplicar`.
