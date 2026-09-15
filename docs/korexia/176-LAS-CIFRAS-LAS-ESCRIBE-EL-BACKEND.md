# 176 — Las cifras las escribe el backend

**15-sep-2026.** Fin de una familia de incidentes que costó una semana y
cuatro parches.

## Lo que venía pasando

Cuatro guardarraíles distintos derivaron **pedidos correctos**, todos por la
misma causa:

| Fecha | Guardarraíl | Qué pasó |
|---|---|---|
| 13-sep | `domicilio_contradicho` | Tomó el TOTAL ($26.000) por la tarifa ($8.000) |
| 14-sep | `despedida-contradice-tarifa` | Lo mismo en el `farewell`, pedido de $64.000 |
| 15-sep | `resumen-contradice-total-real` | Pedido de $42.000 con TODO correcto |

Cada arreglo tapaba un camino y el siguiente incidente entraba por otro.
Tres parches en tres días, y el cuarto incidente llegó igual.

## La causa raíz

No era el detector. Era que **la misma cifra viajaba dos veces**:

```
El backend calcula:  subtotal $30.000 + domicilio $12.000 = $42.000
El modelo escribe:   "...y con el domicilio el total sería $42.000"
El guardarraíl:      relee esa frase con una expresión regular,
                     busca "total", toma la cifra a 25 caracteres,
                     y comprueba si coincide
```

Dos versiones del mismo número, una verificada y otra en prosa, con un
detector de texto entre medias. Cambia la redacción y falla distinto — por
eso cada arreglo destapaba el siguiente.

### El testigo final

MALIA, `cv_dco8y5w7c2sh99dpji2a`. Todo correcto:

```
3 × Pavé Cremoso 8 oz          $30.000   ← subtotal real del catálogo
Domicilio a Brisas de Mayo     $12.000   ← verificado y persistido
Total                          $42.000   ← la suma exacta
```

El bot lo escribió bien, la clienta dijo *"Si correcto"*, y el pedido se
derivó igual.

## El arreglo

**El backend escribe las cifras. El modelo ya no las escribe.**

```
[lo que escribe el modelo: saludo, ítems, dirección, pago, despedida]

Subtotal: $30.000      ← lo escribe el backend
Domicilio: $12.000     ← lo escribe el backend
Total: $42.000         ← lo escribe el backend
```

Tres piezas:

1. **`bloqueDeCifrasVerificadas`** (`anuncio-de-cierre.ts`) — función pura que
   genera el bloque desde el subtotal real (sumado contra el catálogo) y la
   entrega verificada (contra `delivery_zone`).

2. **El pipeline lo adjunta** al `summary` (equipo) y al `farewell` (cliente),
   después de las validaciones numéricas.

3. **Los cuatro chequeos de texto se apagan** cuando el bloque existe: ya no
   hay dos versiones que puedan contradecirse, así que solo podrían producir
   falsos positivos.

4. **El prompt** le pide al modelo no escribir el desglose — el servidor lo
   añade.

## Lo que NO se afloja

Los chequeos **numéricos** corren siempre, con bloque o sin él:

- `total-no-cuadra` — la aritmética del cierre
- `subtotal-no-coincide-con-el-carrito` — contra el catálogo real
- `domicilio-nunca-verificado` / `domicilio-no-verificado` / `domicilio-omitido`

Esos comparan número contra número y **nunca han fallado**. Hay pruebas
explícitas de que siguen bloqueando.

Y cuando el backend NO tiene certeza completa —sin subtotal calculado, o un
domicilio sin verificar— `bloqueDeCifrasVerificadas` devuelve `null`, no se
adjunta nada, y **los chequeos de texto siguen corriendo exactamente como
antes**. Es justo el caso donde el texto del modelo es la única cifra que el
cliente va a ver.

## Por qué esto sí es definitivo

Los tres arreglos anteriores mejoraban la *detección*. Este elimina la
*posibilidad*: no puede haber contradicción entre dos textos cuando solo hay
uno, y lo escribe quien calculó el número.

## Verificación

`tests/unit/cifras-las-escribe-el-backend.test.ts` — 10 casos:

- El bloque exacto del caso de MALIA
- Recogida (sin domicilio en el total) y modalidad sin resolver
- Sin subtotal o sin tarifa verificada → no escribe nada
- **El cierre que derivó hoy, ahora pasa**
- Sin bloque, los chequeos de texto siguen atrapando un total falso
- La aritmética, el subtotal y el domicilio sin verificar siguen bloqueando

Gate completo: typecheck, **2192 pruebas**, lint y build.

## Cómo revertir

`git revert` del commit. `cifrasLasEscribeElBackend` es opcional y por defecto
`false`, así que revertir devuelve los cuatro chequeos de texto a su
comportamiento anterior sin tocar tipos — y con ellos, los falsos positivos.
