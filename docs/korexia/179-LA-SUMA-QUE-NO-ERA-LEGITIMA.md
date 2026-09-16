# 179 — La suma que no era legítima

**16-sep-2026.** Recurrencia exacta del incidente de Ciudad 2000
([170](170-EL-TOTAL-NO-ES-LA-TARIFA.md)), que ya advertía: *"Sigue vivo el
patrón en los otros guardarraíles de la misma familia."* Esta es esa
recurrencia, en producción.

## El incidente

Isabella (MALIA, conv `cv_up9ul11vy8r22an9vnt1`) pidió un Pavé Cremoso 8 oz
con topping Nuggets de Milo ($12.000 en ítems) y dio su dirección. El backend
verificó la zona "San Nicolás" correctamente: $8.000. El modelo respondió con
el total combinado — $20.000 — y el bot terminó derivando:

```
Dame un momentico 🙏 Te comunico con una persona del equipo para ayudarte mejor.
```

Isabella siguió escribiendo más datos de dirección después de la derivación,
sin saber que ya la habían pasado a un humano. Nadie del equipo se enteró
(MALIA sigue sin `notify_phones` configurados —
[168](168-AVISOS-QUE-NO-LLEGABAN-A-NADIE.md), reconfirmado aquí, no es parte
de este arreglo).

## La causa, confirmada con el log real del turno

```
[traza] ... hechos=domicilio:"San Nicolás, Cra 4# 7-61 edificio banco de occidente"=found@backend
accion=handoff categorias=fact_verified|handoff
guardarrailes=domicilio_contradicho:disparado
recuperacion=no handoff=si causa_handoff=model_output_recovery_failed
```

`dijoOtroValorDeDomicilio` (el arreglo de doc 170) compara cualquier cifra
que aparezca cerca de la palabra "domicilio" contra una lista de valores
legítimos. Esa lista, en `pipeline.ts`, solo tenía dos elementos:

```js
const cifrasLegitimasDelTurno =
  action.action === "reply"
    ? [action.totalCents, estadoGuardado?.totalCents]
    : [estadoGuardado?.totalCents];
```

`action.totalCents` es el total que el MODELO declara en su propio campo
estructurado — y en una respuesta a mitad de conversación (todavía no es un
cierre), el modelo no siempre lo llena. `estadoGuardado?.totalCents` es el
subtotal de los ítems ($12.000), sin domicilio.

**Nunca estaba la SUMA de los dos** — $12.000 + $8.000 = $20.000 — que es
exactamente la cifra más natural de decir al confirmar ambos juntos. El
modelo la dijo bien, el guardarraíl no la reconoció, pidió corregir algo que
ya estaba correcto, y al no haber nada que corregir, derivó.

No se pudo confirmar el texto EXACTO que el modelo intentó enviar: no queda
registrado en ningún log, solo el resultado del guardarraíl. La reconstrucción
de arriba es una inferencia fuerte a partir del código y las cifras reales
(ítems $12.000, domicilio $8.000, sin ninguna otra combinación posible que
explique un `domicilio_contradicho` con la zona ya verificada), no una lectura
directa del texto rechazado — se deja dicho explícitamente, como exige la
regla de oro del proyecto.

## El arreglo

`pipeline.ts` ahora calcula la suma cuando ambos valores se conocen, y la
agrega a la lista de cifras legítimas — en el primer intento y en el
reintento:

```js
const sumaItemsConDomicilio =
  typeof estadoGuardado?.totalCents === "number" && resultadoZona?.status === "found"
    ? estadoGuardado.totalCents + resultadoZona.zona.feeCents
    : undefined;
const cifrasLegitimasDelTurno =
  action.action === "reply"
    ? [action.totalCents, estadoGuardado?.totalCents, sumaItemsConDomicilio]
    : [estadoGuardado?.totalCents, sumaItemsConDomicilio];
```

`dijoOtroValorDeDomicilio` en sí **no cambió** — ya soportaba una lista
arbitraria de valores legítimos desde el arreglo de doc 170. El hueco estaba
en qué lista se le pasaba, no en la función.

## Lo que NO cambia

- El guardarraíl sigue atrapando una cifra que no corresponde a nada
  verificado (probado explícitamente: ver "Verificación").
- Ningún otro guardarraíl de la misma familia (financiero, producto) se tocó
  en este arreglo — doc 170 ya advertía que podían compartir el patrón, pero
  extenderlo a los demás sin un caso real que lo exija sería adelantarse a la
  evidencia, mismo criterio que ya usa el proyecto para no generalizar de más.

## Verificación

`tests/unit/inconsistencia-financiera.test.ts` — dos casos nuevos con los
números reales del incidente:

- `dijoOtroValorDeDomicilio(texto, 800000)` sin la suma → `true` (reproduce el
  falso positivo tal como ocurrió).
- Con `[undefined, 1200000, 2000000]` (la suma incluida) → `false` (arreglado).
- Una cifra genuinamente inventada ($15.000, que no es ni la tarifa, ni el
  subtotal, ni su suma) sigue devolviendo `true` — el guardarraíl no se
  volvió permisivo, solo dejó de rechazar lo correcto.

Gate completo: `tsc --noEmit`, `eslint`, suite de Vitest — ver el resultado en
el commit de este cambio.

## Cómo revertir

`git revert` del commit. `sumaItemsConDomicilio` es una variable local nueva
sin efecto en ningún otro contrato; revertir devuelve el comportamiento
anterior (con el falso positivo) sin romper tipos.
