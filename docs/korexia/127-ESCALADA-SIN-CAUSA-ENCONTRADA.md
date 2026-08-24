# Una escalada sin causa encontrada: tres hipótesis descartadas, ninguna confirmada

> **Dentro:** El caso · Las tres hipótesis, cada una descartada con evidencia
> · La prueba limpia que no reprodujo · Por qué se deja anotado y no
> arreglado · Qué mediría si vuelve a pasar
>
> ⬜ **Investigado a fondo. Sin causa confirmada, sin arreglo aplicado.** Se
> documenta precisamente porque no se encontró nada — para no repetir la
> misma investigación si vuelve a pasar, y para que quede claro que no se
> abandonó a la primera.

## El caso

Una captura del 24-ago mostraba al agente de Lis diciéndole a una clienta
("Leidy Moreno", guardada en el sistema como "White 777") que la conectaba
con una persona del equipo — como respuesta a un simple *"Buenas tardes"*,
sin que la clienta pidiera nada más.

Se investigó junto con el bug real de esa misma tanda (el contacto duplicado
que perdía mensajes, [126](126-CONTACTO-DUPLICADO-MENSAJES-PERDIDOS.md)),
porque ambos llegaron como "el bot no responde bien". **No son el mismo
problema.**

## Tres hipótesis, cada una descartada con evidencia

### 1. ¿Es el mismo bug del contacto duplicado?

**No.** White 777 tiene un solo registro de contacto, con teléfono y BSUID
desde el principio. Nada que fusionar.

### 2. ¿Quedó atascado el relevo humano de una conversación anterior?

**No.** El sistema ya tiene una regla para esto —
[`handoff-policy.ts`](../../src/server/inbox/handoff-policy.ts),
`HANDOFF_RESUME_HOURS = 2`—: si nadie contesta en 2 horas, el agente retoma
solo. Entre el último mensaje humano (20-ago, 21:55) y el *"Buenas tardes"*
(24-ago, 19:29) pasaron **4 días**. El relevo ya se había liberado solo mucho
antes de que llegara el saludo — el modelo corrió con total libertad, sin
ninguna restricción del sistema empujándolo a nada.

### 3. ¿Alguna regla de escalado configurada lo pedía?

**No.** Las reglas de escalado de Lis son explícitas:

> Reclamo o queja por un pedido · Devolución del dinero · Estado de un
> pedido ya hecho · Tortas personalizadas o grandes · Promociones o
> descuentos · Que el cliente pida hablar con alguien · Algo que no sabe
> resolver.

*"Buenas tardes"* no encaja en ninguna. El modelo escaló **por su cuenta**,
sin que nada del CRM se lo pidiera — y hasta copió casi textual la frase de
ejemplo de esas reglas (*"te comunico con alguien del equipo"*), aplicada a
un caso que las reglas no cubren.

## La prueba limpia: no reprodujo

Con el pipeline real (`is_test`, nunca toca WhatsApp), *"Buenas tardes"* como
**único** mensaje, sin ningún historial previo:

**5 de 5 corridas respondieron normal. Cero escalaron.**

Esto descarta que el saludo por sí solo dispare nada. Lo que sea que pasó,
depende de **ese historial en concreto** — probablemente el tramo final de la
conversación anterior (la clienta bromeando con una grosería cariñosa, el
equipo respondiendo, silencio de 4 días) —, no del mensaje que la clienta
escribió ese día.

## Por qué se deja anotado y no arreglado

- **Pasó una sola vez.** No hay una tasa de fallo que medir todavía —el
  catálogo se pudo arreglar porque se midió un 33% de fallo reproducible en
  6 corridas; aquí no hay nada reproducible que atacar.
- **No hay literal que forzar.** El arreglo del catálogo funcionó porque "el
  enlace debe aparecer" es verificable por código sin ambigüedad. "¿Debía
  escalar o no?" es un juicio semántico — no hay una cadena de texto que
  comprobar, y construir un detector para eso sería tan poco fiable como el
  problema que intenta resolver.
- **El costo real fue bajo.** Un humano respondió en 2 minutos. La clienta no
  se quedó esperando.

## Si vuelve a pasar

No repetir esta investigación desde cero. En vez de eso:
1. Guardar el `conversation_id` exacto.
2. Reconstruir el historial completo de esa conversación (como se hizo aquí)
   y buscar qué tienen en común los casos, si ya son más de uno.
3. Si aparece un patrón —una palabra, una estructura, un tipo de cierre
   previo— **ahí sí** hay algo que medir con el pipeline real, igual que se
   hizo con el catálogo antes de tocar código.

## Cómo revertir

Nada que revertir: ningún dato ni código se tocó. Esta es una investigación,
no un cambio.
