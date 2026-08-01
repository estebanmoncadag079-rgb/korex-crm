# Audio e imágenes: cuando el cliente no escribe

Puesto en producción el **31-jul-2026**. Verificado con mensajes reales.

Mucha gente no escribe: manda una nota de voz, o una foto del comprobante.
Hasta ahora esos mensajes llegaban **vacíos** al agente, porque el historial que
recibe filtra por texto. El resultado se vio con una clienta de Lis: explicó
hablando que quería una porción de torta de cumpleaños con domicilio, y el
agente le contestó *"qué alegría que nos escribas"*.

## La decisión que lo sostiene todo: convertir al ENTRAR

El audio se transcribe y la imagen se describe **una sola vez, al recibir el
mensaje**, y el texto se guarda dentro del propio mensaje.

A partir de ahí nada más se entera de que no era texto:

- el agente lo lee como si se lo hubieran escrito,
- quien atiende a mano lo ve en la bandeja sin abrir el adjunto ni ponerse
  auriculares,
- entra en el aprendizaje,
- y queda en los respaldos.

La alternativa —mandar el audio en cada turno del agente— sería **pagar el
mismo audio una y otra vez** por la misma frase, y no dejaría rastro para nadie
más.

## Nunca rompe la entrada de mensajes

Todo el módulo (`src/server/ai/transcribir.ts`) está construido sobre una
regla: **nunca lanza**. Si algo falla devuelve `null` con su motivo y el mensaje
se guarda igual, sin conversión.

Perder la transcripción es molesto. Perder el mensaje sería mucho peor: el
cliente escribió y nadie se enteraría.

Las guardas, en orden:

| Guarda | Qué evita |
|---|---|
| Lista blanca de orígenes | Que una URL cualquiera nos haga descargar lo que sea. Compara el host **completo**: `api.ycloud.com.atacante.net` termina con un dominio legítimo. |
| Tope de 10 MB | Que un archivo enorme ahogue un servidor de un solo núcleo. Se comprueba lo declarado **y** lo real: la cabecera puede mentir. |
| Timeout de 60 s | Que una descarga colgada bloquee la entrada. |
| Sin IA configurada | Se salta la conversión, sin error. |

El gasto se anota **aunque salga vacío**: se pagó igual. Aparece en el contador
de costos con la referencia `transcripcion` o `imagen` ([09-COSTOS.md](09-COSTOS.md)).

## Audio y foto se tratan distinto, a propósito

**El audio solo se transcribe si el mensaje no trae ya texto.** Una nota de voz
no lleva pie, pero si algún día lo llevara sería lo que escribió la persona, y
eso manda sobre cualquier transcripción.

**La imagen SIEMPRE se describe, y el pie se conserva delante.** El comprobante
casi siempre viene con un *"listo"* encima: quedarse con el pie sería quedarse
justo sin lo que hay que mirar.

## Comprobantes: leer sí, dictaminar no

El caso que más llega con diferencia es el comprobante de pago, y ahí el
reparto de responsabilidad es lo importante.

**El sistema LEE.** Del comprobante saca, en una línea:

```
[COMPROBANTE] banco/app · monto · fecha y hora · a nombre de: destinatario · cuenta destino · ref: referencia
```

Son los cuatro datos que delatan un comprobante que no vale:

- **A quién se pagó** — si la cuenta no es la del negocio, no hay más que hablar.
- **Fecha y hora** — un comprobante de hace tres días para un pedido de ahora.
- **Monto** — si no cuadra con lo pedido.
- **Referencia** — la misma en dos pedidos es el mismo pago mandado dos veces.

Un dato que no se lee se marca **`(no se lee)`** en vez de dejarse en blanco:
que falte es en sí una señal, y sería peor que el modelo lo rellenara a ojo.

**Comprobado el 31-jul-2026** contra el modelo de producción, con dos capturas
de prueba y la instrucción tomada del código desplegado:

```
[COMPROBANTE] Nequi · $22.000,00 · 31 de julio de 2026 6:12 p.m. · a nombre de:
KAREN LISETH RAMIREZ · cuenta 51400008565 · ref: M9384710255
```

Y con la referencia emborronada a propósito, más una captura que no traía ni
hora ni cuenta:

```
[COMPROBANTE] Bancolombia · $45.000 · 28/07/2026 (no se lee) · a nombre de:
LUIS ALBERTO GOMEZ · cuenta destino: (no se lee) · ref: (no se lee)
```

No se inventó ninguno de los tres datos que no estaban, que era justo el riesgo.

**El sistema NO dictamina.** El agente tiene prohibido en el contrato de
acciones decir "pago confirmado", "ya me llegó" o "listo, recibido el dinero".
Ve una imagen, no la cuenta del negocio, y un comprobante puede estar retocado.
Eso mueve dinero y lo decide una persona.

Lo que sí hace: **copiar la línea completa del comprobante dentro del resumen
que va al equipo** por WhatsApp. Quien despacha compara el monto, la hora y la
cuenta destino antes de mandar el pedido, y si algo no cuadra ese dato es lo
único que lo delata.

Si no es un comprobante, la descripción empieza por `[IMAGEN]` y dice en una
línea qué se ve. El agente sabe que ambas marcas son lo que el sistema **leyó**
en una foto, no algo que el cliente escribió.

## Efecto lateral que conviene tener presente

Los comprobantes **caducan a los 30 días en YCloud** y no hay copia de la
imagen ([08-PENDIENTES.md](08-PENDIENTES.md), punto 23). Desde ahora, al menos
**los datos leídos quedan en texto en la base de datos** y entran en los
respaldos, aunque la foto ya no se pueda abrir. No sustituye a guardar la
imagen, pero deja rastro de lo que decía.

## Qué cuesta

Con `gemini-2.5-flash`, **entre 0,0006 y 0,0008 USD por imagen** — medido en las
dos pruebas de arriba. Del orden de un turno de conversación normal, unos 2 o 3
pesos colombianos.

El volumen manda: las fotos y las notas de voz son una fracción pequeña de los
mensajes, así que el impacto en la factura mensual es marginal frente a las
respuestas de texto. Un negocio que reciba 100 comprobantes al mes paga por
leerlos unos **0,08 USD**.

Se ve por cliente y por referencia en el panel de costos, sin estimaciones:
son los importes que informa el propio proveedor.
