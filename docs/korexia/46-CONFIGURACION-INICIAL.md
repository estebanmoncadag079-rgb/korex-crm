# La configuración inicial: el cliente arma su propio agente

> **Dentro:** Qué cambia · El recorrido · Por dónde entra · Quién genera el
> prompt (no es una IA) · Las tres piezas · Decisiones de diseño · Seguridad ·
> Qué falta

Cierra el punto 3 de [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md),
**"el techo real"**: el alta manual.

## Qué cambia

```
ANTES   Word al cliente → lo devuelve → alguien lo transcribe →
        4 comandos SQL a mano → agente configurado
        (horas, y hay que acordarse de cuatro pasos sueltos)

AHORA   El cliente entra a su cuenta → 8 etapas → listo
        (minutos, sin que nadie transcriba nada)
```

**La transcripción era el cuello de botella de verdad.** No escalaba porque
dependía de una persona, y cada paso manual era un error en potencia. La idea
de que lo llene el propio cliente es del dueño, y es mejor que la primera
versión (un formulario en `/admin` que llenaba la agencia): quien mejor conoce
el menú, el horario y las reglas del negocio es su dueño.

## El recorrido

`/configuracion-inicial` — ocho etapas, una pantalla cada una:

| # | Etapa | Qué recoge |
|---|---|---|
| 1 | Tu negocio | Nombre, qué vende, dónde, y si vende productos o agenda citas |
| 2 | Tu horario | Días y horas |
| 3 | Lo que vendes | Catálogo con precios y opciones *(se salta en el vertical de citas)* |
| 4 | Cómo lo reciben | Domicilios, **quién los paga**, restricciones, recoger |
| 5 | Cómo te pagan | Formas y datos de cuenta |
| 6 | Cómo le habla | Tono, regalos, saludo propio |
| 7 | Lo que más te preguntan | Va al conocimiento (`kb_entry`) |
| 8 | Cuándo llamarte | Qué escalar, qué no prometer, reglas propias |

## Por dónde entra el cliente

En la pestaña **Agente**. Es donde un dueño de negocio busca "cómo configuro mi
bot", y antes se encontraba campos vacíos con nombres técnicos —
*"instrucciones"*, *"reglas de escalado"* — que no significan nada para quien
vende pan.

La tarjeta cambia según el estado:

- **Sin configurar** → *"Empecemos a entrenar tu asistente"*, en grande.
- **Ya configurado** → *"¿Cambió un precio, tu horario o alguna regla?"*, con
  un enlace discreto para ajustar sin volver a empezar.

## Quién genera el prompt: **nadie**. No hay IA

No lo redacta Sonnet, ni Gemini, ni ningún modelo. Es **código**: coloca las
respuestas del cliente en su sitio dentro de un esqueleto fijo
([45-GENERADOR-DE-PROMPTS.md](45-GENERADOR-DE-PROMPTS.md)). Como rellenar un
contrato, no como pedirle a alguien que lo redacte.

| | Código (lo que hay) | Si lo generara una IA |
|---|---|---|
| Costo | $0 | Se paga cada alta |
| Tiempo | Instantáneo | Segundos |
| Repetible | Mismos datos → mismo prompt | Cada vez distinto |
| Inventos | Imposible | Podría añadir precios o promesas que nadie dijo |

**El último punto es el que manda.** Un prompt inventado por una IA se
convierte en la ley que el bot le repite a los clientes durante meses. Es el
tipo de error que costó una tarde entera cazar en Lis.

La IA trabaja después: atendiendo con ese prompt. **El prompt en sí es del
cliente, literal.**

## Las tres piezas

| Archivo | Qué hace |
|---|---|
| `src/app/(app)/configuracion-inicial/page.tsx` | La pantalla |
| `src/components/onboarding/onboarding-wizard.tsx` | Las ocho etapas |
| `src/app/api/onboarding/route.ts` | `GET` borrador · `PUT` guarda avance · `POST` aplica |
| `src/server/ai/generador/aplicar.ts` | Deja el cliente configurado **en una transacción** |

Todo va en una transacción a propósito: si algo falla, no queda un cliente con
el prompt puesto y el horario sin poner — el agente atendería creyendo que
siempre está abierto.

## Decisiones de diseño (y de dónde salen)

Las tres vienen de que **quien responde no es técnico y no tiene 40 minutos
seguidos**:

1. **Una etapa por pantalla.** Un formulario de 30 campos se abandona; ocho
   pasos cortos se terminan.
2. **Se guarda al avanzar**, en `organization.metadata` (que ya existía y es
   JSON, así que no hizo falta tabla nueva). Si cierra la pestaña en la etapa 4
   y lo pierde todo, no vuelve. **Verificado en producción**: se llenó el paso
   1 y el borrador quedó guardado.
3. **Cada pregunta con su ejemplo**, que es lo que ya funcionaba en el Word.
   Sin ejemplo, la respuesta llega en dos palabras y no sirve.

## Seguridad y guardarraíles

- **`withAuth`, no `withPlatformAdmin`.** La organización sale de la **sesión**,
  nunca del cuerpo de la petición: un cliente solo puede tocar la suya, aunque
  manipule lo que envía.
- **El agente queda APAGADO** al terminar. Lo enciende la agencia después de
  probarlo (paso 8 de [05-CLIENTES.md](05-CLIENTES.md)). Un cliente no debe
  poder poner su bot a atender de verdad sin que nadie haya visto una sola
  conversación de prueba.
- **`faltantesDeLaFicha` frena antes de romper**: aceptar transferencia sin
  datos de cuenta deja un agente que cierra pedidos y no sabe cobrarlos;
  domicilios sin decir quién los paga acaban en discusión con el repartidor.
- **El conocimiento se REEMPLAZA al reaplicar**, no se acumula: dos versiones
  del mismo dato harían que el agente respondiera cosas distintas a la misma
  pregunta.

## Qué falta

- **Enlazarlo desde el alta**: cuando se crea la cuenta de un cliente, mandarle
  el enlace directo. Hoy hay que decírselo.
- **El catálogo por archivo**: el cliente escribe sus productos a mano. Sigue
  pendiente el importador con verificación
  ([36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md)).
- **La marca** (logo y color) sigue siendo SQL: no está en la ficha.
- **Horario propio de domingo**: la ficha lo admite, el formulario todavía no
  lo pregunta (se recoge como regla propia en la etapa 8).
- **Migrar La Churra y Lis**, que siguen con su prompt escrito a mano — La
  Churra con el defecto estructural latente.
