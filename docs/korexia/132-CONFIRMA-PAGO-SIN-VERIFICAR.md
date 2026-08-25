# El guardarraíl que faltaba: no confirmar un pago que nadie verificó

> **Dentro:** El caso real · La causa raíz · La calibración contra la flota
> real · El criterio final · El fix · Cómo se verificó · Lo que NO cubre ·
> Cómo revertir

**24-ago-2026.** Un cliente reportó una captura real: el agente le dijo a
una clienta de Lis Pastelería "¡Recibimos tu pago con éxito!" cuando ella
solo había preguntado/avisado el MEDIO de pago que iba a usar — sin
comprobante, sin nada.

## El caso real

```
Clienta: Pago por nequi                                    17:39:32
Agente:  ¡Recibimos tu pago con éxito! 🎉 Ya estamos         17:39:44
         preparando tu pedido con mucho amor...             ← falso,
                                                                 ningún
                                                                 pago existió
```

Conversación real (`cv_ch56hsarvsi1zrtt0rks`, Lis Pastelería, hora
Colombia). "Pago por nequi" declara el medio, no confirma un pago hecho —
la clienta ni siquiera había recibido los datos de la cuenta todavía.

**Auditoría del impacto real**: `usage_event` para ese turno no muestra
ninguna acción de cierre asociada — fue un `reply` de puro texto. Revisando
la conversación completa: un humano (Karen, la dueña) tomó el control **15
segundos después**, corrigió la situación, mandó los datos de pago reales a
las 17:45 y a las 17:48 llegó un comprobante **real** de Nequi por $25.000,
antes de que nada saliera para reparto. **En este incidente puntual no hubo
pérdida de dinero** — el riesgo es que la próxima vez nadie esté mirando en
ese momento.

## La causa raíz

El prompt YA lo prohibía con todas las letras (`prompts.ts:426`):

> "NUNCA des un pago por bueno. No digas 'pago confirmado', 'ya me llegó'
> ni 'listo, recibido el dinero'... Di que lo pasas al equipo para
> verificarlo y sigue con el pedido."

Vivía solo en el prompt, sin ningún guardarraíl de código que lo
verificara. Misma lección que la cita fantasma y el cierre falso: una
regla crítica que depende solo del prompt, tarde o temprano el modelo la
incumple.

## La calibración contra la flota real

Antes de escribir el detector: se extrajeron **82 respuestas reales** de
los tres negocios (60 días, filtradas por "pago", "comprobante", "nequi",
"daviplata", "transferencia", "bancolombia", "llave") y se probó el
detector contra ellas.

El patrón correcto de TODA la flota, sin excepción, es hablar de recibir el
**comprobante** y pasarlo a **verificar**:

- *"Hemos recibido el comprobante, lo estamos verificando con el equipo."*
- *"Ya recibimos tu comprobante de pago. Lo pasaré a mi equipo para que lo
  verifiquen."*
- *"Estamos validando tu pago..."*

Ni una sola vez, en 82 mensajes reales, el agente dice "recibimos tu pago"
a secas — la única excepción es este incidente. Primer intento del
detector: 1 falso positivo — "¿Cómo confirmo el pago?" de un FAQ (una
pregunta, no una afirmación). Se agregó la misma exclusión que ya usan
`prometeRecurso`/`niegaDisponibilidadSinVerificar` (descartar oraciones con
"¿" o que terminan en "?"). Segunda corrida: **1 positivo (el incidente
exacto), 0 falsos positivos**.

## El criterio final

`confirmaPagoSinVerificar()` (`anuncio-de-cierre.ts`), por oración:

- descarta preguntas,
- descarta cualquier oración que mencione "comprobante" (ese es el patrón
  correcto, no el fallo),
- caza: "recibimos/recibí tu pago", "pago con éxito/exitoso/confirmado",
  "confirmamos/confirmo tu pago", "ya (nos/te) llegó tu pago".

No depende de si hubo o no un `[COMPROBANTE]` real en el turno: el prompt
pide "pasarlo a verificar" incluso cuando SÍ llegó uno, así que no hay
ninguna forma legítima de decir "pago confirmado" en este proyecto.

## El fix

Nuevo guardarraíl en `pipeline.ts`, mismo patrón que los demás (cierre
falso, cita fantasma, recurso prometido): detecta → reintenta con
`CORRECCION_DE_PAGO_SIN_VERIFICAR` delante → si insiste, deriva a una
persona (`derivarAUnaPersona`).

## Cómo se verificó

```
pnpm vitest run tests/unit   # 975 passed (7 nuevas)
pnpm typecheck                # limpio
pnpm lint                     # limpio
```

`tests/unit/confirma-pago-sin-verificar.test.ts`: el incidente real exacto,
variantes de la misma afirmación, y los patrones correctos que NO debe
tocar (comprobante+verificar, instrucciones de pago con llave/banco, la
pregunta de FAQ).

**Desplegado y verificado dentro del contenedor** el mismo día: literal
`confirmaPagoSinVerificar` presente en el bundle compilado
(`.next/server/chunks`), `BUILD_ID` fresco, migraciones aplicadas sin
error, contactos de los 3 negocios intactos tras el reinicio.

## Lo que NO cubre

- No revierte ni corrige el pedido de la conversación real donde ocurrió
  — ese ya se cerró bien a mano (comprobante real recibido, pedido
  despachado). Este fix es hacia adelante.
- No valida comprobantes reales (eso lo sigue haciendo un humano, a
  propósito — ver el prompt citado arriba: ni con un comprobante real el
  agente debe decir "confirmado").
- Es un detector de LITERALES (frases inconfundibles de éxito/confirmación),
  no de intención: una forma de decir "ya pagué" que no use ninguna de las
  frases catalogadas no se cazaría. Ampliar la lista es el primer lugar
  donde mirar si vuelve a pasar con otra redacción.

## Cómo revertir

```bash
git revert <commit>
```

Sin esquema, sin datos, sin estado. Revertir deja el guardarraíl fuera;
el prompt seguiría pidiendo lo mismo, sin garantía de código detrás.
