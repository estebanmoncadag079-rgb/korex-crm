# 194 — "¿Hacen domicilio?" contesta corto, no la ficha entera (Bug 4)

25-sep-2026. Rama `011-consulta-entrega-corta` (tras el merge de PR #18).

## Síntoma

Esteban: el bot no entiende mal la intención (eso ya funciona), pero cuando el
cliente pregunta algo puntual sobre el domicilio, contesta con una "chorrera":
las restricciones de conjuntos, quién paga, apps de reparto — todo junto,
cuando el cliente solo preguntó si hacen domicilio.

## Causa (capa: prompt/orquestación, no el modelo ni la ficha)

`generador/generar.ts` (`comoRecibe`) arma un bloque `"## Cómo lo recibe"` con
el detalle del domicilio + restricciones + quién paga, todo pegado — correcto
para el RESUMEN del pedido, donde toda esa política debe aparecer. Ese bloque
va siempre en el conocimiento disponible del modelo.

El backend **ya** detecta con certeza que la pregunta es puntual
(`leerIntencion` → `consulta_entrega`, `intencion.ts`) y le dice al modelo
"contesta esto antes de seguir" (`bloqueDelPlan`) — pero nunca le decía
**cuánto** contestar. El prompt además insiste en que el conocimiento del
negocio es "tu única fuente de verdad" (`prompts.ts:862`), así que el modelo,
por seguridad, copiaba el bloque completo.

## Arreglo

Un mapa `ACOTADO` en `orders/intencion.ts`, acotado **solo** a
`consulta_entrega` (donde se reportó el problema real — no se generaliza a
horario/precio sin evidencia): cuando el backend detecta esa consulta, el
`[SISTEMA] PLAN DEL TURNO` que ya se inyecta trae además: *"contesta en una
frase corta si hacen domicilio o no… NO listes restricciones ni política de
pago — eso va en el resumen"*.

- No toca la ficha (dato del negocio): el detalle completo sigue disponible
  para cuando SÍ hace falta (el resumen del pedido, o si el cliente pregunta
  directamente por una restricción).
- No toca backend-autoridad: sigue siendo una instrucción `[SISTEMA]` sobre
  CÓMO redactar, nunca sobre qué cifra o hecho afirmar.
- **Corre en vivo desde `pipeline.ts`, no pasa por el generador** — a
  diferencia de `conducta.ts`, **no necesita `regenerar:flota --aplicar`**.

## Verificación

- Unit test (`tests/unit/intencion.test.ts`): la instrucción aparece SOLO para
  `consulta_entrega`, nunca para horario/precio.
- Escenario de regresión MALIA contra el modelo real: "hacen domicilio?" ya
  no menciona conjuntos/centros comerciales ni la política de pago — ✅.
- Gate completo (`tsc`/`lint`/tests/`build`).

## Cómo revertir

Revertir el merge de la rama. Sin datos de producción tocados; el único cambio
es el texto de instrucción que recibe el modelo en ese caso puntual.
