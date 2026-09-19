# 180 · El domicilio que nadie podía desmentir

**19-sep-2026** · Fases 8 y 9 del plan "Backend como autoridad — La Churra + Lis".

---

## El hueco

Desde el 13-sep hay un guardarraíl que detecta cuando el agente dice una
tarifa de domicilio que el backend no verificó. Funciona, tiene cinco
incidentes reales detrás afinándolo, y hasta hoy **no se activaba nunca para
La Churra ni para Lis**.

El motivo estaba en una sola condición, en `pipeline.ts`:

```js
if (resultadoZona?.status === "found" && ...)
```

`resultadoZona` solo es `found` cuando el negocio tiene tabla de zonas
(`delivery_source='tabla'`). La Churra y Lis están en `'prompt'`: su domicilio
lo cotiza Uber, Yango o DiDi según la dirección, así que no hay tabla. Y
`resolverZonaDeEntrega` devuelve `not_found` cuando no hay zonas cargadas
(`delivery/zonas.ts:116`).

El otro candado —el de `inconsistenciaFinancieraDePedido`— tampoco cubría el
caso: vive detrás de `puedeVerificarDomicilio`, y está apagado **a propósito**
desde el incidente de Zahenz (7-sep), cuando exigir una prueba imposible
derivó el 100% de los pedidos con domicilio de MALIA.

Resultado neto: el agente podía decirle a un cliente de La Churra *"el
domicilio son $5.000"* y no había nada en todo el sistema que lo detectara.

## Lo que se hizo

**No se construyó un guardarraíl nuevo.** Se extendió el que ya existía.

`dijoOtroValorDeDomicilio` ahora acepta `feeCentsVerificado: number | null`.
Con `null` la pregunta que hace es la misma de siempre —*"¿esta cifra
corresponde a algo verificado?"*— solo que la lista de lo verificado no
incluye ninguna tarifa, porque no existe. Quedan como legítimas:

- el subtotal que calculó el backend sobre los ítems,
- el total que el propio cierre declara,
- **y las cifras que ya dijo una persona del negocio en ese chat**.

Ese tercer punto no es un detalle. Sin tabla de zonas, cotizar a mano no es
una anomalía: es el flujo normal. El equipo mira Uber y escribe el valor. Sin
esa excepción se repetiría el incidente del 8 y 9-sep, cuando el candado
bloqueó un total que había dado el propio equipo y el cliente ya había pagado.
El mecanismo ya existía (`totalesDichosPorUnaPersona`, comprobado contra filas
de `message` con `ai_generated=false`); aquí se reutiliza tal cual.

Cuando dispara, el modelo recibe un mensaje distinto
(`CORRECCION_DE_DOMICILIO_SIN_TARIFA`): el de siempre le ordena *"usa
exactamente la tarifa verificada"*, y aquí no hay ninguna que usar —
mandárselo sería repetir el error del 10-sep, cuando se le dio la corrección
del caso equivocado y el cliente acabó derivado.

## El falso positivo que apareció por el camino

La primera versión rompía la frase correcta de La Churra:

> "Los churros son $20.000. El domicilio se cotiza aparte."

Se leía como *"el domicilio cuesta $20.000"*. No hay cifra después de la
palabra, así que el detector miraba hacia atrás, **se comía el punto** y
agarraba el precio de los productos. Es el mismo mecanismo exacto del falso
positivo de $64.000 del 9-sep, con un punto en lugar de un salto de línea.

La corrección es de causa raíz, no un parche: **la ventana hacia atrás tampoco
cruza un fin de oración**, igual que ya no cruza un salto de línea. Dos
oraciones son dos hechos distintos. El `\s` del patrón `[.!?]\s` es lo que
salva los miles — en `$20.000.` el punto va pegado al dígito.

Beneficia también al camino con tabla: es una fuente de falsos positivos menos
para MALIA.

## Por qué esto no repite Zahenz

Zahenz exigía una PRUEBA en todos los pedidos con domicilio, y derivaba el
100%. Esto solo mira si el texto pone una cifra concreta junto a "domicilio"
que no sea ninguna de las legítimas. **Un pedido que deja el domicilio
pendiente —lo que se espera de estos negocios— no lo toca nunca.** Hay una
prueba dedicada a eso.

## Fase 9 · El validador que no corría

`validarConfiguracionArquitectonica` existía desde el programa de mejora,
estaba bien construida… y **no la llamaba nadie**: solo los tests. Un
validador que no corre nunca no protege de ninguna regresión.

Ahora tiene dónde correr: `pnpm auditar:arquitectura`. Recorre TODAS las
organizaciones —nunca una lista escrita a mano—, compara cada `agent_profile`
contra la arquitectura aprobada para su vertical, y sale con `exit 1` si
alguna tiene un mecanismo CORE ausente. `--estricto` incluye también las
recomendadas.

Ejecutado contra una base con la configuración real de producción replicada,
detecta exactamente lo que debía:

```
🟡 La Churra (pedidos) — recomendado y ausente: paymentSource
     paymentSource: tiene "prompt", se recomienda "ficha"
🔴 Lis (pedidos)       — falta(n) [core]: stateSource
     stateSource: tiene "prompt", se espera "backend"
🔴 MALIA (pedidos)     — falta(n) [core]: stateSource
❌ FAIL
```

No escribe nada: corregir es una decisión humana con su propio comando, igual
que `fase2`/`migrar:catalogo` sin `--aplicar`.

## Lo que NO se tocó

Las 3 compuertas, la atomicidad, Policy, la normalización del catálogo, los
productos, los precios, el aislamiento multi-tenant, el webhook, YCloud y el
worker siguen exactamente igual. Del `pipeline.ts` solo se tocó el bloque del
guardarraíl de domicilio.

Ningún cambio conoce a La Churra ni a Lis por su nombre: la condición es
`delivery_source`, una capacidad del negocio.

## Pendiente de autorización (cambios de configuración en producción)

Las Fases 2, 5 y 6 **no necesitan código** — sus mecanismos ya existen:

| Fase | Qué falta | Mecanismo que ya existe |
|---|---|---|
| 2 | Lis: `state_source` `prompt` → `backend` | `pnpm fase2 <org> --encender` (rollback: `--apagar`) |
| 5 | La Churra: `payment_source` `prompt` → `ficha` | `pnpm migrar:pago` |
| 6 | La Churra y Lis: el requisito `direccion` solo tiene `id` — sin `obligatorio`, así que hoy **se puede cerrar un pedido a domicilio sin dirección** | `soloEnModalidades: ["domicilio"]` + `obligatorio: true` en la ficha |

Los tres son escrituras en producción y esperan autorización explícita.
