# 158 — El cierre que pedía una prueba imposible

7-sep-2026. Incidente de producción, corregido y desplegado el mismo día.

## 1. Incidente

Una clienta de **MALIA | Pavés . Postres** confirma su pedido y el bot, en vez
de cerrarlo, le responde que la pasa con una persona. El pedido nunca se
registra, el equipo no recibe el aviso automático, y la clienta se queda
preguntando si su pedido existe.

## 2. Síntomas

Conversación testigo `cv_da855xkj2g0745pemj7o` ("Zahenz"), 7-sep:

```
19:29:37  out  "El domicilio a Ciudad Modelo tiene un valor de $8.000 🛵"
19:30:07  in   "3105140797"                      (su teléfono)
19:30:21  out  "¡Perfecto! Aquí tienes el resumen de tu pedido: 1 × Pavé
                Cremoso 16 oz — $18.000 · Sabor: Leche Klim · Topping: M&M's…"
19:30:52  in   "Si"                              ← la clienta CONFIRMA
19:31:15  out  "Dame un momentico 🙏 Te comunico con una persona del equipo…"
19:32:45  in   "Ok"
19:36:28  in   "Si se hizo el pedido?"           ← quedó en el limbo
19:40:15  out  (una PERSONA, a mano) "3156609332 nequi. Esperamos tu comprobante…"
```

Traza del turno del "Si":

```
accion=handoff
guardarrailes=inconsistencia_financiera:disparado
causa_handoff=model_output_recovery_failed
motivo: (domicilio-no-verificado)
```

**Alcance medido** en ~5 horas de logs (desde el reinicio de las 16:29 UTC):

| Métrica | Valor |
|---|---|
| Disparos del guardarraíl financiero | 6 |
| Terminados en derivación a una persona | **4** |
| Conversaciones distintas | 5 |
| Motivo, las 6 veces | `domicilio-no-verificado` |
| Negocio afectado | MALIA (`delivery_source='prompt'`) |

## 3. Causa raíz

El guardarraíl de consistencia financiera (Fase 10N-J, nacido del incidente
de Kachipay) exige esto, en `anuncio-de-cierre.ts`:

```ts
if (deliveryFeeCents !== undefined && deliveryFeeCents !== null) {
  if (!zonaVerificada || deliveryFeeCents !== zonaVerificada.feeCents) {
    return "domicilio-no-verificado";
  }
}
```

`zonaVerificada` es la zona que **`consultar_domicilio` resolvió en ESTE
turno**. Pero esa acción solo se le ofrece al modelo cuando el negocio tiene
`delivery_source='tabla'`:

```
pipeline.ts:1130   tieneZonasDeEntrega: zonasDeEntrega.length > 0
prompts.ts:844     input.tieneZonasDeEntrega ? CONTRATO_DE_CONSULTA_DE_DOMICILIO : null
```

Y los **cuatro** negocios de pedidos reales están en `'prompt'`:

```
La Churra       -> delivery_source=prompt
Lis Pastelería  -> delivery_source=prompt
MALIA           -> delivery_source=prompt
korex.ia        -> delivery_source=prompt
```

Es decir: **se le exigía al modelo respaldar `deliveryFeeCents` con una
acción que nunca se le ofreció.** Un contrato imposible. Reintentaba, volvía
a fallar por la misma razón —que no dependía de él— y el turno acababa en
`derivarAUnaPersona`, *después* de que la clienta ya había confirmado.

El campo `deliveryFeeCents` sí le llega siempre al modelo: `CAMPOS_DE_ACCION`
(`actions.ts`) es un esquema plano con `strict: true` donde todas las
propiedades van en `required`. Así que el modelo, que conocía la tarifa
porque la había dicho en prosa dos turnos antes, la rellenaba — y con eso
disparaba una comprobación que no tenía forma de satisfacer.

El propio comentario del código decía *"forzar a reverificar justo antes de
cerrar **es barato**"*. Medido: costó 4 de 6 cierres.

## 4. El bug antiguo de duplicación (incidente A)

`notify_order` podía ejecutarse dos veces para el mismo pedido cuando llegaba
un mensaje nuevo del cliente: la idempotencia era por hash de los mensajes
disparadores, así que un mensaje distinto producía una clave distinta.
Corregido el 6-sep (`ultimaConfirmacionDe` + verificación de producto nuevo,
commit `ec9497e`, doc del incidente en el propio código).

## 5. El bug nuevo (incidente B) y su relación con el anterior

**No fue un problema de lenguaje.** El modelo entendió el "Si" perfectamente:
emitió `notify_order` — de hecho, si no lo hubiera emitido, este guardarraíl
ni siquiera se habría evaluado, porque solo corre sobre esa acción.

Ambos incidentes son la misma categoría, en sus dos extremos:

| | Incidente A (6-sep) | Incidente B (7-sep) |
|---|---|---|
| Falla | Autoriza de MÁS | Bloquea de MÁS |
| Efecto | Pedido confirmado dos veces | Pedido legítimo sin confirmar |
| Origen | Precondición ausente | Precondición imposible de cumplir |

La lección común: **una precondición de una acción irreversible tiene que ser
producible por quien debe cumplirla.** Si no lo es, no protege: rompe.

## 6. Solución

Un parámetro nuevo y explícito en `inconsistenciaFinancieraDePedido`:

```ts
puedeVerificarDomicilio: boolean   // = zonasDeEntrega.length > 0
```

El chequeo de `domicilio-no-verificado` **solo se aplica cuando el negocio
tiene infraestructura para producir esa prueba**. Todo lo demás queda igual:

- `total-no-cuadra` (aritmética pura) sigue protegiendo a **todos** los
  negocios, con y sin tabla;
- `resumen-contradice-tarifa` sigue igual (solo tiene sentido cuando hay una
  zona verificada, o sea solo en `'tabla'`);
- para un negocio con `delivery_source='tabla'`, **la protección de Kachipay
  queda intacta byte a byte**.

Se reutiliza el concepto que la Fase 10V ya había identificado con el nombre
`deliverySourceEstructurado` (trabajo aún sin desplegar), en vez de inventar
uno nuevo.

## 7. Lo que NO se hizo, y por qué

- **No se añadió un detector de "sí"** ni una lista de frases de
  confirmación: la evidencia demuestra que el modelo ya las reconoce. Un
  detector habría añadido complejidad sin causa y habría tapado el fallo real.
- **No se creó un estado nuevo** de "confirmación pendiente": el turno que
  falló ya tenía todo lo necesario (`paso=resumen` → `confirmado=true` en
  `conversation_state`, y el `notify_order` emitido). No faltaba
  representación: sobraba una exigencia.
- **No se tocó** el guardarraíl de pedido-ya-confirmado (6-sep): se verificó
  en los logs que **no intervino** en este incidente (0 disparos).
- **No se desplegó la Fase 10V-X** (domicilio persistente entre turnos, sin
  commitear): se auditó y **no resuelve este caso** — sigue exigiendo una
  `zonaEfectiva` que un negocio en `'prompt'` nunca puede producir.

## 8. Casos que ahora cierran, y los que no

**Cierran** (negocio sin tabla de zonas, con domicilio en prosa): "Si", "Sí",
"si", "Sí, correcto", "Confirmo", "Todo bien", "Listo", "Dale" — cualquier
confirmación que el modelo interprete como tal.

**No cierran**: "Sí, pero cámbiame el topping" (el modelo lo trata como
modificación y no emite `notify_order`); un total que no cuadra (se rehace el
turno); en negocios con tabla, una tarifa sin verificar o distinta de la
verificada (se sigue bloqueando).

## 9. Tests

| Archivo | Qué cubre |
|---|---|
| `tests/unit/cierre-domicilio-sin-tabla.test.ts` (nuevo, 9) | Caso Zahenz; negocio sin tabla no se bloquea; protección intacta con tabla (Kachipay); aritmética protegida en ambos |
| `tests/unit/pipeline-confirmacion-con-domicilio.test.ts` (nuevo, 11) | Pipeline completo: "Si" cierra; 8 confirmaciones naturales; "Sí, pero…" no cierra; total que no cuadra se rehace |
| `tests/unit/inconsistencia-financiera.test.ts` (actualizado) | Sus 8 llamadas declaran ahora `puedeVerificarDomicilio: true` — el escenario que siempre probaron. **Ninguna aserción eliminada ni relajada** |
| `tests/unit/pipeline-pedido-ya-confirmado.test.ts` (sin tocar, verde) | La protección anti-duplicado del 6-sep sigue intacta |

**Suite completa: 189 archivos, 1888 pruebas, 0 fallos.** Typecheck, lint y
build en verde.

## 10. Archivos modificados

```
src/server/ai/anuncio-de-cierre.ts             +38
src/server/ai/pipeline.ts                       +2   (los 2 puntos de llamada)
tests/unit/inconsistencia-financiera.test.ts   +21
tests/unit/cierre-domicilio-sin-tabla.test.ts        (nuevo)
tests/unit/pipeline-confirmacion-con-domicilio.test.ts (nuevo)
```

**Migraciones: ninguna.** No falta ningún dato que persistir: `delivery_source`
ya existe en `agent_profile` y ya se lee en cada turno.

## 11. Riesgos residuales

1. **Un negocio en `'prompt'` puede cerrar con una tarifa de domicilio que el
   modelo recuerde mal.** Es el comportamiento que ese modo siempre tuvo —el
   domicilio vive en prosa por diseño— y el guardarraíl nunca lo protegió de
   verdad: solo derivaba. La protección real para esos negocios es migrarlos a
   `delivery_source='tabla'`, que es una decisión de configuración, no de
   código.
2. **El esquema plano de `CAMPOS_DE_ACCION` le ofrece al modelo campos que su
   negocio no usa** (`deliveryFeeCents` sin tabla de zonas). No es un fallo
   hoy, pero es la superficie por la que entró este incidente. Documentado, no
   implementado.
3. La Fase 10V-X sigue sin desplegar; cuando se despliegue, deberá integrarse
   con este parámetro (su `deliverySourceEstructurado` cubre el mismo concepto).

## 12. Otros hallazgos, no implementados

- **El deploy oficial no se puede usar todavía**: `.github/workflows/deploy.yml`
  existe y está `active`, pero el repositorio **no tiene ningún secret
  configurado**, así que el workflow no puede ejecutarse. Además, la protección
  de rama está bloqueada por el plan de GitHub (requiere Pro). Detalle en el
  doc [157](157-AUDITORIA-DEL-PLAN-SDD.md). Este despliegue tuvo que hacerse
  por el camino manual documentado en
  [02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md).
- **Un turno tardó 20 horas en resolverse** (`cv_6wycxcu3thdcv4xuc6rz`,
  MALIA): el cliente escribió "Hola" el 6-sep 22:54 y el bot respondió el
  7-sep 18:37 con una derivación. Sin diagnosticar.
