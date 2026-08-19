# El agente pedía pago por adelantado sin que el negocio lo exigiera

> **Dentro:** El caso real · La auditoría · Lo que la evidencia descartó ·
> El origen · El fix · La pantalla en "Ajustar mi agente" · Cómo se
> verificó · Lashes Valen no necesita tocarse · Cómo revertir

**19-ago-2026.** El dueño reportó, con una captura real de Lashes Valen: el
agente pedía NEQUI + comprobante "para dejar la cita en firme" al confirmar
una cita, aunque el salón **no cobra por adelantado**.

## El caso real

```
19-ago 22:34:06  agente  ✅ Quedaste agendada: Retoque Volumen 4D Tecnológico
                          el 19/08/2026 a las 6:30 PM con Hilary.
                          Recuerda que el pago es con NEQUI al 3185940645 a
                          nombre de Valentina Vargas. Por favor, envíanos el
                          comprobante para dejar tu cita en firme.
19-ago 22:34:26  clienta Cuando debo de pagar?
19-ago 22:34:34  agente  Una vez que te confirmemos el horario, te pedimos
                          que realices el pago por NEQUI y nos envíes el
                          comprobante para dejar tu cita en firme...
```

La cita era en 56 minutos, no días después — el agente lo ofrecía
**proactivamente**, sin que nadie lo pidiera.

## La auditoría, con protocolo formal

Se pidió reconstruir el flujo completo antes de proponer nada, y verificar
también la hipótesis textual del reporte ("la clienta asiste días después y
manda el comprobante, el bot vuelve a confirmar una cita ya ocurrida"): se
cruzaron los 11 comprobantes reales de Lashes Valen contra sus citas, y
**esa hipótesis no tenía un caso idéntico en los datos** — el patrón real y
demostrado era otro: el agente ofrece el pago proactivamente al confirmar,
sin que el negocio lo exija.

## El origen

`ficha.negocio.pago` (`server/ai/generador/ficha.ts`) solo declara **cómo**
se paga (`formas`, `datosDeCuenta`, `compruebaUnaPersona`) — nunca **cuándo**.
La instrucción universal `CIERRE_CITAS` (`conducta.ts`, aplica a **todo**
negocio de citas) decía:

> *"Si el negocio cobra algo por adelantado, es el momento de decirlo; si no,
> la conversación termina ahí."*

Sin un dato que resuelva esa condición, el modelo usaba como proxy la mera
**presencia** de `pago` en su conocimiento — que casi cualquier negocio
tiene, cobre antes o no. Regla de negocio faltante en el núcleo, no un bug
de Lashes Valen: cualquier salón de citas con NEQUI/transferencia declarada
está expuesto a lo mismo.

## El fix

**Un dato nuevo, no un guardarraíl.** El mismo patrón que ya usan
`cierre.requisitos` ([103](103-REQUISITOS-IMPLEMENTADO.md)) y
`entrega.haceDomicilios`: declarar la regla del negocio, no adivinarla.

- `ficha.ts`: `cierre.pagoAntesDeLaCita?: boolean`. Vive en `flujo`, no en
  `negocio.pago` — la misma razón que los requisitos: `negocio` la reescribe
  el cuestionario cada vez que se reenvía, y pisaría el interruptor.
  `pagoAntesDeLaCitaDe(ficha)` es la única lectura: no declarado = `false`.
- `conducta.ts`: `CIERRE_CITAS` ya no decide la condición — remite a la
  sección del prompt que sí la resuelve con el dato real.
- `prompts.ts`: `pagoDeCitasParaElPrompt(pago, antes)`, nueva, **siempre
  presente** en el prompt de citas (nunca `null`): si `antes` es falso,
  prohíbe categóricamente mencionar pago o comprobante al confirmar; si es
  verdadero, exige mencionarlo con los datos reales de la cuenta.
- `pipeline.ts`: calcula el dato desde la ficha (igual que ya hace con
  `requisitos`) y lo pasa al prompt.

## La pantalla en "Ajustar mi agente"

Un solo interruptor, `PagoCitasSection` (`components/agent/pago-citas-section.tsx`),
sobre `GET`/`PATCH /api/agent/pago-citas`. Solo se muestra si el negocio es
de citas (`aplica: false` en pedidos y cuando no hay ficha). Se guarda al
cambiarlo, sin botón aparte — un interruptor no necesita confirmación
adicional.

⚠️ Al escribir la ruta se encontró que **`/api/agent/requisitos` sobrescribía
`cierre` entero** al guardar (`{ cierre: { requisitos } }`), lo que habría
borrado `pagoAntesDeLaCita` la próxima vez que alguien tocara los
requisitos. Se corrigió ahí también: las dos rutas hacen `{ ...cierre,
campoPropio }` — dos pantallas escribiendo en la misma sección deben
conservar lo que la otra guardó.

## Cómo se verificó

```
pnpm test        # 883 passed (9 nuevas), 73 skipped — antes: 874 passed
pnpm typecheck   # limpio
pnpm lint        # limpio
pnpm build       # compila, incluida /api/agent/pago-citas
```

Las 9 pruebas nuevas: 4 puras de `pagoAntesDeLaCitaDe` (no declarado, con
requisitos pero sin el campo, `false` explícito, `true` explícito), 3 puras
de `pagoDeCitasParaElPrompt` (las dos instrucciones categóricas, y que no
revienta con `pago` ausente), y 2 de integración sobre `runAgentTurn` que
inspeccionan el `system prompt` real que recibiría el modelo con una ficha
como la de Lashes Valen — confirman que el dato llega hasta ahí, no solo
que las funciones puras lo calculan bien.

**No verificado en un navegador con sesión real** (esta instalación no
tiene una base de datos de desarrollo separada de producción): la
verificación de la pantalla es el build de producción compilando sin
errores más las pruebas de integración del prompt. Antes de dar la
pantalla por buena en el uso real, conviene abrirla una vez en "Ajustar mi
agente" con una cuenta de citas.

## Lashes Valen no necesita tocarse

No declara `cierre.pagoAntesDeLaCita`, así que el nuevo default (`false`)
ya corrige su caso sin escribir nada en su ficha de producción. Si la dueña
entra a "Ajustar mi agente" verá el interruptor apagado, reflejando lo que
ya pasa.

## Cómo revertir

```bash
git revert <commit>
```

Sin esquema, sin datos, sin estado. Revertir deja `CIERRE_CITAS` con la
condición ambigua otra vez, como antes de hoy.
