# 169 — El catálogo que atrapa al cliente

**Fecha:** 8-sep-2026 · **Negocio:** MALIA · **Conversación:** `cv_cxjpas85h1czjkvn9qw6`

## Lo que se vio

```
23:30:51  in   "Sin toppings"
23:32:28  out  "¿me confirmas si deseas elegir algún topping ($2.000 c/u)?"
23:35:37  in   "Sin toppings"
23:35:57  out  "necesito confirmar el topping de cada Pavé..."
23:36:47  in   "1. Sin toppings  2. sin toppings  3. sin toppings"
23:37:53  out  "por favor indícame qué topping ($2.000 c/u)"
```

La clienta lo dijo **tres veces**. El agente preguntó **cuatro**. El carrito
quedó con los tres ítems en `totalCents: null` y el pedido se perdió.

## La causa

**No es que el agente no entendiera. Es que el sistema no podía aceptarlo.**

El grupo `Topping` del "Pavé Cremoso 8 oz" —nueve opciones, todas de $2.000—
estaba marcado como **obligatorio** (`min_select = 1`). Y un grupo obligatorio
**no se puede rechazar**, por diseño, en
[`orders/normalizar.ts`](../../src/server/orders/normalizar.ts):

```ts
// Solo tiene sentido declinar un grupo OPCIONAL: uno obligatorio hay que
// elegirlo sí o sí [...] el grupo sigue pendiente y `faltaDelItem` lo va a
// seguir pidiendo, que es lo correcto.
if (grupo && grupo.minimo < 1) { ... }
```

La regla es correcta. Lo que estaba mal era el dato: **un extra de pago marcado
como obligatorio**. Para la clienta no existía ninguna respuesta que la sacara
del bucle.

Es la misma familia que `domicilio-no-verificado` (doc 168): un contrato
imposible — el sistema exige algo que el otro lado no puede darle.

## Lo que apareció al investigar

Mientras se revisaba, alguien renombró el grupo `Sabor` a `Topping`. El
producto quedó con **dos grupos llamados los dos `Topping`**: uno con los 6
sabores (gratis) y otro con los 9 toppings ($2.000). Como "Milo", "Leche Klim"
y "Arequipe" existen en los dos, la pregunta de desambiguación que armaba
`normalizar.ts` salía así:

> *¿"Milo" como topping o como topping?*

Otro bucle sin salida, esperando al siguiente cliente. El Pavé de 16 oz tiene
la misma trampa latente con `Topping` / `Toppings`: para `coincideGrupo`
(prefijo mutuo) son el mismo grupo.

## Por qué las pruebas no lo cazaron, y no podían

Ese día la suite pasó entera: **209 archivos, 2064 pruebas, cero fallos**,
mientras el negocio perdía pedidos. No había nada que arreglar en el código:
**lo roto era el dato**. Ninguna prueba unitaria puede cazar un catálogo mal
cargado; hace falta mirar el catálogo.

De ahí salen los tres avisos nuevos.

## Lo que se cambió

| Archivo | Cambio |
|---|---|
| `src/lib/catalogo-ambiguedad.ts` (nuevo) | `obligaAPagarUnExtra` (grupo obligatorio cuyas opciones cuestan todas), `gruposAmbiguos` (dos grupos del mismo producto que el agente no distingue, con la misma comparación de prefijo mutuo que usa `coincideGrupo`), `opcionesAmbiguas` (dos opciones con el mismo nombre dentro de un grupo). Sin dependencias, como su hermana `catalogo-repeticion.ts`. |
| `src/components/catalogo/catalogo-productos.tsx` | Los tres avisos, cada uno donde se arregla: el de grupos ambiguos por producto, los otros dos dentro del grupo. |
| `src/server/orders/normalizar.ts` | Dos arreglos de runtime, para que un catálogo mal cargado **no pueda atrapar** al cliente aunque nadie lea los avisos: (1) si dos grupos candidatos tienen el mismo nombre, se pregunta por el **precio**, que sí distingue; si tampoco distingue, se toma el primero (elegir uno u otro da el mismo pedido); (2) si el cliente rechaza un grupo obligatorio, se sigue ignorando —es lo correcto— pero ahora queda un `console.warn` que lo dice, en vez de repetir la pregunta en silencio. |
| `tests/unit/catalogo-ambiguedad.test.ts` (nuevo, 16) · `tests/unit/normalizar-pedido.test.ts` (+3) | El caso real de MALIA en cada uno, y los casos legítimos que NO deben avisar (elegir entre una opción incluida y otra más cara; un mismo nombre en grupos distintos). |

## Lo que hay que arreglar en el CRM (dato, no código)

1. **Pavé Cremoso 8 oz**: renombrar uno de los dos grupos `Topping`. Debe quedar
   como el de 16 oz — `Sabor` [mín 0, máx 1] con los 6 sabores gratis, y
   `Toppings` [mín 0, máx 9] con los 9 de $2.000.
2. **Pavé Cremoso 16 oz**: renombrar `Topping` a `Sabor`, porque `Topping` y
   `Toppings` son indistinguibles para el agente.
3. Comprobar que ningún grupo de extras quede en obligatorio.

## Cómo revertir

`git revert` del commit. No toca el esquema ni los datos de ningún negocio: son
una librería nueva sin dependencias, tres bloques de aviso en una pantalla y
dos ramas en `normalizar.ts`. Revertirlo devuelve el bucle.
