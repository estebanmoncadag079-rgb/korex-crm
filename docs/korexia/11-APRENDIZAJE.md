# Aprendizaje del agente

> **Dentro:** Qué es y qué NO es · Cómo funciona · Por qué pasa por aprobación · Solo la agencia · Cuánto cuesta · La primera ejecución real (31-jul-2026) · Lo que falta

## Qué es y qué NO es

**El modelo no aprende.** Gemini no cambia con las conversaciones: reentrenar un
modelo cuesta miles de dólares, tarda semanas y habría que repetirlo. Aquí no se
hace, y ningún CRM serio lo hace.

**Lo que crece es el conocimiento del negocio**, que es lo que de verdad importa:
el agente lo lee **entero en cada mensaje**, así que una entrada nueva surte
efecto al instante, sin desplegar ni reiniciar nada.

## Cómo funciona

En **Agente → Aprendizaje**, el botón *"Buscar aprendizajes"*:

1. Lee las conversaciones reales de los **últimos 7 días** (máximo 400 mensajes,
   sin contar las del Laboratorio).
2. Le pasa al modelo esas conversaciones **y el conocimiento que ya tiene**, para
   que no proponga duplicados.
3. Devuelve propuestas de pregunta + respuesta, **con la frase del chat que las
   justifica**.
4. Quien las revisa puede **aprobar, editar o descartar** cada una.
5. Lo aprobado entra en el conocimiento del negocio.

### Dónde busca el conocimiento

Por orden de valor:

1. **Lo que respondió una PERSONA del negocio.** Si alguien contestó a mano,
   casi siempre es porque el agente no supo — y esa respuesta es justo el hueco.
2. Preguntas del cliente que quedaron sin responder o se contestaron con vaguedad.
3. Preguntas que repiten clientes distintos.

Descarta a propósito lo puntual de un día ("hoy no hay fresa") y lo de un cliente
concreto (su dirección, su pedido): solo interesa lo que seguirá siendo cierto
dentro de un mes.

## Por qué pasa por aprobación

**Un agente que aprendiera solo heredaría también los errores del equipo.** Una
respuesta con prisa, un precio mal escrito, algo de un día suelto — y el agente
se lo repetiría a **todos** los clientes de ese negocio durante meses. Un dato
falso en el conocimiento se propaga a cientos de conversaciones antes de que
nadie lo note.

Con aprobación, el sistema hace el trabajo pesado (leer, detectar, redactar) y
la decisión sigue siendo de una persona. Treinta segundos a la semana.

## Solo la agencia

Decisión del dueño (31-jul-2026): el botón es **exclusivo del superadmin**.

Cada análisis consume IA y **la factura la paga la agencia**, así que no puede
quedar en manos de quien no la paga. Es el mismo criterio del cupo del
Laboratorio y de la conexión de WhatsApp.

Opera sobre la **organización activa**: la agencia entra como el cliente (banner
ámbar) y lanza el análisis para ese negocio. El endpoint responde **403** a
cualquier cuenta que no sea superadmin, y al cliente ni siquiera se le muestra
la sección.

## Cuánto cuesta

Medido en producción con las conversaciones reales de La Churra:

```
174 mensajes revisados
13.478 tokens de entrada · 963 de salida  →  $0,00645
```

**Menos de un centavo por análisis.** Leer es barato ($0,30 por millón de
tokens) y escribir es caro ($2,50), y este proceso lee mucho y escribe poco.

Para comparar: una sola respuesta del agente a un cliente cuesta más o menos lo
mismo que analizar una semana entera de conversaciones.

Cada análisis **queda anotado en el contador de costos** (`ref = 'aprendizaje'`),
también cuando no encuentra nada — porque igualmente se pagó.

## La primera ejecución real (31-jul-2026)

Encontró 3 propuestas en La Churra, y una de ellas destapó algo que nadie había
notado:

| Propuesta | Valor |
|---|---|
| ¿Reciben pagos en efectivo? | Confirma una práctica real |
| **¿Se puede recoger en el local?** | **Contradice el prompt del agente** |
| ¿El costo del domicilio es fijo? | Añade el detalle de Uber/Didi |

El prompt de La Churra dice que **sí** se puede recoger y hasta nombra el punto
del C.C. Alfaguara. Pero el equipo le respondió a un cliente real: *"Nuestros
pedidos son solo a domicilio"*.

**El negocio cambió y el agente no se enteró.** Llevaba tiempo ofreciendo algo
que ya no existe, y el aprendizaje lo detectó leyendo lo que responde el equipo.
Es exactamente para lo que sirve — y la razón de que convenga aprobar a mano en
vez de automatizarlo a ciegas.

## Lo que falta

- **Automatizarlo** (una pasada semanal con aviso), cuando el uso manual
  demuestre que las propuestas son buenas.
- **Aprender del pedido, no solo del chat**: hoy analiza texto; los pedidos
  cerrados con `notify_order` podrían dar patrones de qué se pide junto.
