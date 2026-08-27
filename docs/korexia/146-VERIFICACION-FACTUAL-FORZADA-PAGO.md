# 146 — Verificación factual forzada de medios de pago

27-ago-2026.

## El hallazgo que lo motiva

La propia traza diagnóstica (doc 145) reveló, sin buscarlo, el mismo
problema estructural que motivó el 143: "¿Puedo pagar por Nequi?" contra
Lis dio la respuesta correcta, pero `categorias=normal hechos=-` — el
modelo respondió leyendo `ficha.pago.formas` en prosa, sin pasar por
`consultar_medio_pago`. Acertó por suerte, no por verificación.

## La solución: mismo molde que productos (143), ahora en pago

`detectarConsultaFactualDeMedioPago` (nuevo, `src/server/pagos/deteccion.ts`)
reconoce preguntas factuales concretas ("¿aceptan X?", "¿puedo pagar por
X?", "¿reciben X?", "¿se puede pagar por X?") y descarta las abiertas
("cómo puedo pagar", "qué medios de pago manejan", "cómo funciona el
pago", "cuándo se paga") sin forzar nada. Cuando detecta un método y el
negocio tiene `consultasVerificadasEnabled` + `payment_source='ficha'`, el
servidor llama a `resolverMetodoDePago` (ya existente, sin tocar) ANTES de
la primera llamada al modelo, exactamente en el mismo punto donde ya vive
el precheck de producto — mismo mensaje `[SISTEMA]`, mismo guardarraíl de
contradicción (`niegaMetodoDePagoPermitido`, sin cambios), misma traza.

```
"¿Puedo pagar por Nequi?"
  ↓
detectarConsultaFactualDeMedioPago → "nequi"
  ↓
resolverMetodoDePago(ficha.pago.formas, "nequi") → recognized, allowed=true
  ↓
[traza] deteccion_factual_pago="nequi" hechos=medio_pago:"nequi"=recognized:allowed@backend
  ↓
LLM redacta con el hecho ya en la mano — sin necesitar consultar_medio_pago
```

`resultadoPago` (antes declarado solo dentro del bucle de
`consultar_medio_pago`) se movió al mismo nivel que `resultadoProducto`:
así el guardarraíl de contradicción cubre tanto el precheck como el bucle
explícito, sin duplicar código.

## Archivos modificados

- `src/server/pagos/deteccion.ts` (nuevo) — el detector.
- `src/server/ai/traza.ts` — campo `deteccionFactualPago` (aparte de
  `deteccionFactual`, porque un turno puede disparar los dos precheck a la
  vez — caso real: "¿tienen torta de chocolate y aceptan Nequi?").
- `src/server/ai/pipeline.ts` — el precheck de pago, junto al de producto;
  `resultadoPago` movido para que el guardarraíl lo cubra también aquí.

## Organizaciones afectadas (confirmado con consulta real)

```
Lis Pastelería:  payment_source=ficha, consultasVerificadasEnabled=true  → comportamiento NUEVO activo
La Churra:       payment_source=prompt, flag=false                       → sin cambios
Lashes Valen:    payment_source=prompt, flag=false                       → sin cambios
korex.ia:        payment_source=prompt, flag=false                       → sin cambios
PRUEBA pedidos:  payment_source=prompt, flag=false                       → sin cambios
```

Ninguna organización adicional se activó. La Churra sigue con
`catalog_source='tabla'` pero `payment_source='prompt'`, así que aunque
tuviera el flag encendido (no lo tiene), el precheck de pago no tendría
`pagoDePedidos` contra qué verificar.

## Pruebas

**Automatizadas**: 21 nuevas — `tests/unit/deteccion-consulta-factual-pago.test.ts`
(15: los 4 patrones factuales, las 5 señales abiertas, texto vacío) y
`tests/unit/pipeline-forzar-consulta-factual-pago.test.ts` (6: Nequi
permitido, efectivo no permitido, criptomonedas `unknown`, pregunta
abierta sin forzar, flag apagado en otra organización, `payment_source`
en `'prompt'` aunque el flag esté encendido). `tsc --noEmit` y `eslint`
limpios. Suite completa: **1110 pruebas, 0 fallos**, sin regresiones.

**Controlada, contra la base real de Lis**:

| Mensaje | Traza |
|---|---|
| "¿Puedo pagar por Nequi?" | `medio_pago:"nequi"=recognized:allowed@backend` — `fact_verified` |
| "¿Aceptan transferencia?" | `medio_pago:"transferencia"=recognized:allowed@backend` |
| "¿Reciben efectivo?" | `medio_pago:"efectivo"=recognized:allowed@backend` (Lis sí acepta efectivo) |
| "¿Puedo pagar por llave?" | `medio_pago:"llave"=recognized:allowed@backend` |
| "¿Cómo puedo pagar?" | `deteccion_factual_pago=no hechos=- categorias=normal` — no forzó nada, como debía |
| "¿Aceptan criptomonedas?" | `medio_pago:"criptomonedas"=unknown@backend` — no inventó, remitió al equipo |

## Lo que NO cambió (preservado a propósito)

- `resolverMetodoDePago`, `consultar_medio_pago`, `niegaMetodoDePagoPermitido`:
  cero líneas tocadas — solo se reutilizan.
- La trazabilidad del doc 145, la verificación de productos del 143, la
  recuperación de salidas parciales del 144, `consult_availability`, el
  vertical de citas, `send_menu`, `conducta.ts`, el prompt maestro: sin
  cambios.
- Ninguna organización nueva recibió el flag — Lis ya lo tenía encendido
  desde el 143, y este cambio solo amplía lo que ese flag hace para ella.
