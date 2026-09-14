# 170 — El total no es la tarifa del domicilio

**14-sep-2026.** Un guardarraíl que vigila el dinero derivaba clientes por
responder bien.

## El incidente

MALIA, 13-sep-2026, 16:16 (conv `cv_6jgzf5s7yprsv5rb1vfq`):

```
CLIENTE: Hermosa una pregunta, que vale el pave de Milo grande
         con domicilio a ciudad 2000?
BOT:     Dame un momentico 🙏 Te comunico con una persona del equipo.
CLIENTE: Gracias
```

La clienta nunca supo el precio. Nadie la atendió: los avisos al equipo de
MALIA siguen sin configurar (ver [168](168-AVISOS-QUE-NO-LLEGABAN-A-NADIE.md)).

## Lo que pasó de verdad

El backend hizo **todo bien**. La traza del turno:

```
hechos=domicilio:"Ciudad 2000"=found@backend
guardarrailes=domicilio_contradicho:disparado
handoff=si  causa_handoff=model_output_recovery_failed
```

- Reconoció "pave de Milo grande" → `Pavé Cremoso 16 oz`, sabor Milo, $18.000.
- Resolvió "ciudad 2000" contra `delivery_zone` → tarifa real $8.000.
- El modelo respondió el total correcto: **$26.000**.

Y entonces `dijoOtroValorDeDomicilio` leyó ese texto, encontró "$26.000"
dentro de los 25 caracteres siguientes a la palabra "domicilio", lo comparó
con los $8.000 verificados, y concluyó que el bot se había inventado la
tarifa. Reintento con la corrección, el modelo volvió a redactar el total
igual de cerca, segundo fallo, handoff.

**El guardarraíl hacía la pregunta equivocada.** Preguntaba *"¿esta cifra ES
la tarifa?"* cuando debía preguntar *"¿esta cifra corresponde a ALGO que
verificamos?"*.

Y la redacción del modelo no era un error: preguntar *"¿cuánto vale X **con
domicilio**?"* invita a responder el total junto a esa palabra. Es la forma
natural de contestar esa pregunta.

## La causa de fondo

Es la tercera vez que el mismo patrón cuesta un pedido — ver
[058305a] (el párrafo fijo leído como tarifa) y el caso de los $64.000
documentado en el propio comentario de `figurasDeDomicilioEnCents`.

El patrón: **el backend sabe un dato con certeza, el modelo lo menciona en
prosa, y un guardarraíl relee la prosa para verificarlo.** Cada vez falla
distinto porque cambia la frase, no la causa.

`notify_order` nunca tuvo este problema: exige `subtotalCents`,
`deliveryFeeCents` y `totalCents` como números y los compara
matemáticamente. `reply` era solo `{ action, text }`, así que su único
guardarraíl posible era releer el texto.

## El arreglo

**1. `reply` declara las cifras que menciona** (`actions.ts`), con los mismos
nombres que `notify_order` ya usa. Opcionales: si el modelo los omite, todo
se comporta como antes.

**2. El guardarraíl compara contra el conjunto de cifras legítimas del turno**
(`anuncio-de-cierre.ts`): la tarifa verificada, el subtotal real del backend
y el total declarado. Tercer parámetro opcional, con el mismo default de
antes.

**3. El prompt pide los campos** cuando el turno pasó por
`consultar_domicilio` (`prompts.ts`).

No pierde capacidad de detección: una cifra que no corresponde a **ninguno**
de esos valores sigue siendo una contradicción y sigue bloqueando. Lo que
dejó de hacer es bloquear cifras correctas.

## Alcance

- **Solo negocios con tabla de zonas.** El contrato se inyecta con
  `input.tieneZonasDeEntrega` (`prompts.ts:846`). Citas y negocios sin zonas
  no ven ningún cambio.
- **No necesita `regenerar:flota`.** El contrato se arma en tiempo de
  ejecución, no está compilado en `agent_profile.ficha` — a diferencia de
  `conducta.ts`.

## Verificación

- `tests/unit/inconsistencia-financiera.test.ts` — tres casos nuevos: el
  texto del incidente ya no dispara; una cifra inventada sigue disparando;
  los valores nulos no rompen la comparación.
- Gate completo: typecheck, 2165 pruebas, lint y build en verde.
- En vivo, sandbox (`isTest`) contra MALIA con el mensaje textual del
  incidente: `accion=reply`, `guardarrailes=-`, `handoff=no`. El bot
  respondió *"El Pavé Cremoso (Milo) 16 oz cuesta $18.000. Domicilio a
  Ciudad 2000: $8.000. Total: $26.000."*

  ⚠️ En esa corrida el modelo puso la tarifa —no el total— junto a la
  palabra "domicilio", una redacción que el guardarraíl viejo tampoco
  habría bloqueado. La corrida prueba el flujo de punta a punta; **la
  garantía contra el bug la da la prueba unitaria**, que sí reproduce el
  texto problemático.

## Continuación — el mismo bug, un campo que quedó sin cubrir

**14-sep-2026, misma tarde.** El arreglo de arriba solo tocó `reply` — la
pregunta de precio antes de pedir. El monitoreo en vivo destapó que
`summary` y `farewell` (el cierre del pedido, `notify_order`) llamaban a la
misma función `dijoOtroValorDeDomicilio` **sin el tercer parámetro**, así
que seguían con el bug original.

MALIA, `cv_zsinmell29s4an7m12lu`: pedido de 4 pavés confirmado ($64.000),
zona verificada, y `despedida-contradice-tarifa` disparó porque el
`farewell` decía *"con domicilio a Los Samanes tu pedido queda en $64.000
en total"* — el total, mencionado cerca de "domicilio", tomado otra vez por
una tarifa inventada.

Arreglo: las mismas cifras legítimas (`totalCents`, `subtotalReal`) ahora se
pasan también en las comprobaciones de `summary` y `farewell`
(`anuncio-de-cierre.ts:~1130-1145`). Pruebas nuevas en
`inconsistencia-financiera.test.ts`: el caso exacto del incidente, y que una
cifra que no corresponde a nada verificado (ni tarifa, ni total, ni
subtotal) sigue bloqueando.

## Cómo revertir

`git revert` del commit. El tercer parámetro de `dijoOtroValorDeDomicilio`
tiene default `[]` y los campos de `reply` son opcionales, así que revertir
solo el `pipeline.ts` también deja el sistema en el comportamiento anterior
sin romper tipos.

## Lo que este arreglo NO resuelve

Sigue vivo el patrón en los otros guardarraíles de la misma familia
(`inconsistencia_financiera`, `producto_contradicho`, `pago_contradicho`),
que también comparan valores verificados contra prosa. `totalCents` en
`reply` deja el terreno listo para el primero de ellos, pero no se tocó sin
un incidente que lo justifique.
