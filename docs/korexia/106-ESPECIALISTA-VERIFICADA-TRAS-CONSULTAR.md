# El noveno guardarraíl derivaba a persona hasta a la respuesta ya verificada

> **Dentro:** El incidente real · La auditoría con protocolo formal · Lo que
> la hipótesis inicial no probó · El bug confirmado con evidencia dura · El
> fix · Cómo se verificó · Deuda que queda · Cómo revertir

**19-ago-2026, mismo día que el [105](105-GUARDARRAIL-ESPECIALISTA-SIN-VERIFICAR.md).**
Horas después de desplegarlo, el guardarraíl noveno derivó a una persona a una
clienta real de Lashes Valen que solo estaba pidiendo su cita de siempre.

## El incidente real

```
20:57:17  clienta  Tienes cita de retoque de volumen ruso con Hillary
20:57:26  agente   Dame un momentico 🙏 Te comunico con una persona del
                    equipo para ayudarte mejor.
```

Logs del servidor, la misma ventana:

```
[citas] confirmó una especialista sin consultar disponibilidad; rehaciendo el turno
[citas] sigue confirmando una especialista sin verificar; lo toma una persona
```

## La auditoría con protocolo formal

El dueño pidió, con todas las letras, no aceptar hipótesis: reconstruir el
flujo completo con archivos y líneas, clasificar el origen, y solo entonces
hablar de un cambio. La primera lectura del código (`pipeline.ts:818-821`)
encontró un defecto real y demostrable por lectura estática: el re-chequeo
tras el reintento aplica el MISMO detector textual (`afirmaConEspecialistaSinVerificar`)
que la detección inicial, sin distinguir si, en el camino, el propio
guardarraíl ya resolvió `consult_availability` de verdad
(`pipeline.ts:796-817`). Cualquier respuesta útil tras verificar ("Hilary SÍ
puede el jueves a las 3pm") vuelve a nombrar a la especialista en una
afirmación — y ese patrón, sin la excepción, se volvía a marcar como "sin
verificar".

## Lo que la hipótesis inicial no probó

Antes de tocar código, se pidió la prueba de que **esa** rama fue la que
ocurrió en el incidente real — no solo que existiera en el código. La tabla
`usage_event` registra cada llamada al modelo con una etiqueta (`ref`)
distinta según el punto exacto de `pipeline.ts` que la origina. Consultada
para esta conversación:

```sql
select kind, detail, ref, created_at from usage_event
where ref like 'conv:cv_8d9ylc2bv3ucmv5ozx0o%' order by created_at;
```

```
 ref = conv:cv_.../                              20:57:24.505154
 ref = conv:cv_.../especialista-sin-verificar     20:57:25.197679
 ref = conv:cv_.../                               20:58:48.646855
```

**No existe** la tercera fila (`.../especialista-sin-verificar/disponibilidad`)
que `pipeline.ts:812-816` solo escribe cuando el reintento sí resuelve
`consult_availability`. Prueba dura, no inferida: en el incidente real el
modelo **nunca llegó** a esa rama — insistió con `reply` tras la corrección,
sin llamar a la acción que se le pedía. La rama del bug demostrado por código
no causó este incidente; es un defecto real pero, hasta ese momento, latente.

## El bug confirmado con evidencia dura

Medido contra los otros ocho guardarraíles de `pipeline.ts` (línea por
línea, ninguno mockeado): ninguno tiene este patrón, porque ninguno más
resuelve una consulta de datos real *dentro* de su propio bloque de
reintento. Dos de ellos — "cita fantasma" (`901-905`) y "recurso prometido"
(`942-946`) — ya usan, en este mismo archivo, el diseño correcto para este
caso: aceptan el reintento si la acción real se ejecutó, sin volver a exigir
que el texto además cambie. El guardarraíl noveno era el único que no lo
seguía.

## El fix

`pipeline.ts:780-833`: se agrega `seVerificoDeVerdad`, `true` únicamente
cuando el reintento resolvió `consult_availability` de verdad. El re-chequeo
ya no aplica `afirmaConEspecialistaSinVerificar` cuando eso ocurrió:

```ts
let seVerificoDeVerdad = false;
if (reintento.ok && reintento.data.action === "consult_availability") {
  seVerificoDeVerdad = true;
  // ...resuelve la consulta real, pide la respuesta final...
}
const siguePrometiendoSinVerificar =
  !seVerificoDeVerdad &&
  reintento.ok &&
  reintento.data.action === "reply" &&
  afirmaConEspecialistaSinVerificar(reintento.data.text, nombresReales);
```

Nada cambia para el camino que sí causó el incidente: si el modelo insiste
sin llamar a `consult_availability`, sigue derivando a una persona, igual que
antes. Eso quedó fuera de este cambio a propósito — el dueño lo revisó por
separado como una decisión de producto (cuántas oportunidades dar antes de
escalar), no como un bug, y decidió no tocarlo por ahora.

## Cómo se verificó

```
pnpm test        # 874 passed (2 nuevas), 73 skipped — antes: 872 passed
pnpm typecheck   # limpio
pnpm lint        # limpio
```

Las 2 pruebas nuevas (`tests/unit/pipeline-especialista-verificada.test.ts`)
son de integración sobre `runAgentTurn`, con `chatJson` mockeado en
secuencia (misma acción → reintento → consulta real → respuesta final):

- Reintento que sí consulta: la respuesta final se acepta, no deriva.
- Reintento que NO consulta (el caso real del 19-ago): sigue derivando, sin
  cambios — regresión del comportamiento que **no** se tocó.

Las 8 pruebas puras de `especialista-sin-verificar.test.ts` (105) siguen
pasando igual: no se tocó `afirmaConEspecialistaSinVerificar`, solo dónde se
le llama.

## Deuda que queda

- El caso que sí causó el incidente —el modelo insiste sin consultar tras la
  corrección— sigue derivando a una persona en un solo intento. Es una
  decisión de producto pendiente, no un bug: ¿vale la pena una segunda
  oportunidad antes de escalar, a cambio de más tokens/latencia por turno?
- Sigue sin haber log que capture el texto exacto de la respuesta del
  reintento (logs parcos, [74](74-REGLAS-DE-LOGS.md)): confirmar la rama
  exacta de un futuro incidente similar requiere, como aquí, consultar
  `usage_event` por su `ref`.

## Cómo revertir

```bash
git revert <commit>
```

Sin esquema, sin datos, sin estado. Revertir deja el re-chequeo aplicando el
mismo criterio en los dos puntos, como antes de hoy — vuelve a estar expuesto
al bug demostrado (no al que causó el incidente real, que queda igual se
revierta o no).
