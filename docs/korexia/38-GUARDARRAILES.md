# Los guardarraíles del agente: cuando el prompt no basta

> **Dentro:** Por qué existen · Los tres · Cómo se añade uno · Cuándo NO usar
> uno · Cómo se prueban

Tres veces se ha intentado corregir una conducta del agente escribiéndola en el
prompt, tres veces no ha bastado, y tres veces ha terminado comprobándose en el
servidor. Este documento reúne el patrón para no volver a descubrirlo cada vez.

## Por qué existen

**El prompt es una petición, no una garantía.** Sirve para la conducta normal;
falla justo en los casos raros, que son los que hacen daño. Las tres veces el
guion fue idéntico:

1. Se escribe la regla en el prompt, con todas las letras.
2. Se comprueba con un caso y parece funcionar.
3. En producción, o en una variante de la frase, el modelo la ignora.
4. Acaba en el servidor, donde el sistema **comprueba el hecho** en vez de
   pedirlo.

Todos viven en `server/ai/anuncio-de-cierre.ts` (el nombre se quedó del
primero) y se aplican en `runAgentTurn`, con la misma forma: detectar → rehacer
el turno con la corrección delante → comprobar de nuevo.

## Los tres

| Guardarraíl | Qué evita | Si insiste |
|---|---|---|
| `anunciaCierre` | Decir que el negocio cerró estando abierto | Lo atiende una persona |
| `anunciaCitaAgendada` | Confirmar una cita que nadie agendó | Lo atiende una persona |
| `productosOlvidados` | Que un producto ya pedido desaparezca | Sale como está, se registra |

**1. El cierre falso** (1-ago-2026). Con el historial real de producción, el
modelo reprodujo el cierre falso **5 de cada 6 veces**, pese a que el prompt
decía ABIERTO tres veces. Un cliente que quiere comprar hoy y lee "cerramos" se
va.

**2. La cita fantasma** (7-ago-2026). A un "sí confirmo" suelto se inventó
servicio, día, hora y especialista — con `reply`, sin agendar nada. La clienta
se habría presentado a un salón que no la espera.

**3. El producto olvidado** (9-ago-2026). "Cremoso de 7 Oz" → el agente pregunta
el topping → "Quiero un cremoso de 16 Oz" → el de 7 oz se esfuma. Se verificó
contra el pipeline real que la regla del prompt **funcionaba con "y también uno
de 16" y fallaba con "quiero un cremoso de 16"**, que es como ocurrió de verdad.

Detecta por **medida** (7 oz, 16 oz, 500 ml…) y no por nombre de producto: es
lo que distingue las variantes que se confunden entre sí y no depende del
catálogo de cada negocio. Calla si el cliente anuncia un cambio ("mejor", "en
vez de", "cámbialo"), porque ahí sustituir es lo correcto.

## Cómo se añade uno

1. **Una función pura** que reciba textos y devuelva el veredicto — nada de
   base de datos ni de red. Así se prueba de verdad, sin modelo.
2. **Una constante de corrección** que le diga al modelo qué hizo mal y qué
   hacer, terminando en "Responde ÚNICAMENTE el objeto JSON".
3. **El bloque en `runAgentTurn`**: si se detecta, se rehace el turno pasando
   la corrección como mensaje de rol **`user`** — nunca `system`. Verificado el
   1-ago: con `system` al final del array, Gemini vía OpenRouter devuelve
   `content: null`.
4. **Registrar el uso** con una etiqueta propia
   (`conv:<id>/producto-olvidado`), que es lo que permite medir después cuántas
   veces salta.

## Cuándo NO usar uno

- **Si el prompt basta.** Cada guardarraíl cuesta una llamada extra al modelo
  cuando salta. Se empieza siempre por el prompt y solo se sube aquí con
  evidencia de que no alcanza.
- **Si el fallo no hace daño real.** Estos tres cuestan una venta, un cliente
  plantado o un pedido incompleto.
- **Si no se puede comprobar con certeza.** Un guardarraíl que se dispara de
  más es peor que el problema: molesta en las conversaciones sanas.

Y ojo con la reacción al fallo persistente: **derivar a una persona no siempre
es la respuesta**. Los dos primeros lo hacen porque su daño es irreversible; el
tercero no, porque equivocarse de tamaño se arregla en el resumen y sacar a un
humano en cada duda es peor remedio que la enfermedad — más aún con un negocio
de volumen.

## Cómo se prueban

**En dos capas**, y las dos hacen falta:

```bash
# 1. La función pura, sin modelo ni red: los casos borde
npx vitest run tests/unit/producto-olvidado.test.ts

# 2. El pipeline REAL contra el modelo, sin gastar WhatsApp
pnpm probar:agente org_lispasteleria0001 'Cremoso de 7 Oz' 'Quiero un cremoso de 16 Oz'
```

La segunda no es opcional: la regla del producto **pasaba las pruebas unitarias
y fallaba en el pipeline real**. Cuando salta, el log lo dice:

```
[agente] se dejó caer 7oz del pedido; rehaciendo el turno
```

> ⚠️ **No reconstruyas el prompt a mano en un script aparte.** `/root/probar-lis.py`
> lo hacía y ni siquiera incluía las `escalation_rules`: llevaba tiempo
> validando un prompt que no era el de producción. Para probar dentro del
> contenedor, la receta de bundle está en
> [30-SALON-PRUEBAS.md](30-SALON-PRUEBAS.md).
