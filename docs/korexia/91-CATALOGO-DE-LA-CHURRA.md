# El catálogo de La Churra: lo que falta para encender

> **Dentro:** Lo medido hoy · Las tres cosas que faltan · El chocolate ·
> `pnpm repeticion` · Por qué el recubierto necesita un número · El orden ·
> Qué pasa al regenerar · Reversión

**17-ago-2026. Medido en producción; nada aplicado todavía.**

Este es el paso 5 del camino de [88](88-AUDITORIA-SELECCION-MULTIPLE.md), y el
último que separa a La Churra del encendido. **No es arquitectura: son datos de
un cliente**, y por eso va aparte y se aplica mirando cada cambio.

---

## Lo que hay hoy, medido

`organizationId: org_lo5gdlt6k43z9fg1ling`

### En las tablas

```
CHURRITA     · SALSA   min=1 max=1  opciones=4  repite=no
BESTIES      · SALSA   min=2 max=2  opciones=4  repite=no
FAMILY BOX   · SALSA   min=3 max=3  opciones=4  repite=no
MEGA BOX     · SALSA   min=5 max=5  opciones=4  repite=SÍ  ⛔ sin repetir no se puede cerrar
```

Opciones cargadas: `chocolate negro · arequipe · lechera · chocolate blanco`.
**`RECUBIERTO` y `ADICIONES` no existen en tablas.**

### En la ficha

```
SALSAS (…): 🍯 AREQUIPE · 🍫 CHOCOLATE · 🐄 LECHERA · 🤍 CHOCOLATE BLANCO. …
RECUBIERTO: ✨ Azúcar-canela · ✨ Azúcar sola · ✨ Ambas · ✨ Sin azúcar.
ADICIONES (opcionales, se cobran aparte): 🍫 Salsa de CHOCOLATE $2.000 ·
  🐄 LECHERA $1.500 · 🍯 AREQUIPE $1.500 · 🤍 CHOCOLATE BLANCO $2.000 ·
  💧 Botella de agua $2.000.
```

Y en `reglasPropias`, el guion del negocio repite la lista de salsas **dos veces
más**: en el ejemplo de formato y en el bloque de la pregunta.

---

## 🔴 1. El chocolate: dos nombres para la misma salsa

| | AREQUIPE | | LECHERA | CH. BLANCO |
|---|---|---|---|---|
| **Tabla** | arequipe | **chocolate negro** | lechera | chocolate blanco |
| **Ficha** | AREQUIPE | **CHOCOLATE** | LECHERA | CHOCOLATE BLANCO |

**Confirmado por el dueño el 17-ago: existen las dos, negro y blanco.** Así que
el nombre correcto es `chocolate negro` —el que ya tiene la tabla— y lo que hay
que corregir es el texto.

Y no es cosmético. `normalizar.ts` resuelve las opciones por **igualdad exacta**:

```ts
g.opciones.filter((o) => llave(o.nombre) === llave(cruda))
```

`"chocolate"` **no encuentra** `"chocolate negro"`. Con la Fase 2 encendida y el
texto sin corregir, cada vez que el modelo propusiera «chocolate» —que es lo que
su propio prompt le enseña— la propuesta se rechazaría con *«"chocolate" no está
entre las opciones»*. **Esto solo bloquea el encendido.**

### Los cuatro sitios

| Dónde | Qué dice | Qué debe decir |
|---|---|---|
| `ficha.variantes`, SALSAS | `🍫 CHOCOLATE` | `🍫 CHOCOLATE NEGRO` |
| `ficha.variantes`, ADICIONES | `🍫 Salsa de CHOCOLATE $2.000` | `🍫 Salsa de CHOCOLATE NEGRO $2.000` |
| `reglasPropias`, ejemplo de formato | `🍫 CHOCOLATE` | `🍫 CHOCOLATE NEGRO` |
| `reglasPropias`, bloque de la pregunta | `🍫 CHOCOLATE` | `🍫 CHOCOLATE NEGRO` |

> **Efecto secundario, y bueno**: el agente pasará a ofrecer las cuatro salsas
> con su nombre completo, así que nadie tiene que adivinar cuál es «chocolate»
> habiendo blanco en la carta. Y si un cliente escribe *«chocolate»* a secas, el
> backend **pregunta cuál** en vez de elegir por él.

---

## 🟠 2. La repetición: tres de cuatro no la admiten

La migración `0023` puso `permite_repeticion = true` **solo donde la aritmética
lo exigía** (`max_select > COUNT(opciones)`), que es el Mega Box. Eso resolvió
el pedido imposible pero **no la decisión del negocio**, tomada el 16-ago:

> Las salsas **no son únicas**: Churrita 1 · Besties 2 · Family Box 3 · Mega Box 5,
> y en todas se puede repetir la misma.

Y está escrita en el propio prompt del negocio:

> *«Salsas: puede repetir la misma, pero nunca más de las que incluye su
> presentación.»*

**La aritmética y la regla de negocio no son lo mismo, y las traté como si lo
fueran.** Una migración puede deducir la primera; la segunda la dice el dueño.

### Dónde se cambia

**En el CRM: Catálogo → Grupos de opciones**, con el interruptor *permite
repetir* de cada grupo ([94](94-BITACORA-PERMITE-REPETICION-CRM.md)). Esa
pantalla existe desde la tarde del 17-ago; antes, esto solo se podía tocar con el
script de abajo.

### `pnpm repeticion`, la herramienta

Se conserva **para el cambio en lote**: aplica a **todos** los productos que
tengan un grupo con ese nombre —los cuatro `SALSA` de La Churra en un comando—,
que es lo único que el CRM todavía no hace. Escribe por el mismo sitio y deja el
mismo registro de cambios; lo único distinto es el `actor`.

```bash
pnpm repeticion <org>                        # solo mira
pnpm repeticion <org> SALSA --si             # simula
pnpm repeticion <org> SALSA --si --aplicar   # escribe
```

Es genérico —sirve para cualquier negocio y cualquier grupo— y marca el caso que
es **aritmética y no preferencia**: un grupo que pide más opciones de las que
tiene no se puede cerrar sin repetir.

Simulación, ya ejecutada:

```
CHURRITA     · SALSA  no → SÍ
BESTIES      · SALSA  no → SÍ
FAMILY BOX   · SALSA  no → SÍ
MEGA BOX     · SALSA  ya estaba así
```

> En la Churrita el cambio **no tiene efecto práctico** —lleva una sola salsa,
> nunca habrá una segunda que repetir— pero se pone igual: el catálogo debe decir
> lo que el negocio decidió, no lo que hoy resulta observable.

---

## 🟠 3. Recubierto y adiciones: solo existen en el texto

Están en la ficha y **no en las tablas**, así que el validador no los conoce: un
pedido puede confirmarse sin recubierto porque para el backend ese grupo no
existe.

Se cargan con `pnpm cargar:opciones`, que es **aditivo** —solo `INSERT`, jamás
borra ni actualiza— por la regla del dueño: *nunca degrades un dato correcto
para unificarlo con uno peor*. Las salsas en tablas son **mejores** que en el
texto (1/2/3/5 por presentación, mientras el texto solo sabría decir «elige 4»).

### Y aquí hace falta añadir un número

Hasta el 17-ago el lector **adivinaba** que un grupo llamado «recubierto» era de
elección única, usando una lista de palabras de comida. Eso se quitó
([88](88-AUDITORIA-SELECCION-MULTIPLE.md), paso 0), así que ahora:

```
RECUBIERTO: ✨ Azúcar-canela · …        → max 4, y marcado "🟠 REVISAR"
RECUBIERTO (elige 1): ✨ Azúcar-canela  → max 1, sin marca
```

**Es el sistema funcionando como debe**: el texto no decía cuántos se eligen, y
ahora el negocio lo declara en vez de que el código lo suponga. Hay que añadir
`(elige 1)` a esa línea de la ficha.

Las adiciones no necesitan nada: ya dicen «opcionales», y de ahí sale `min = 0`.

---

## El orden, que importa

| | Qué | Por qué en este sitio |
|---|---|---|
| **1** | Los cuatro `SALSA` a **permite repetir** — en el CRM (cuatro interruptores) o `pnpm repeticion <org> SALSA --si --aplicar` (uno) | Independiente. No toca la ficha ni el prompt |
| **2** | Corregir el chocolate y añadir `(elige 1)` en la ficha | **Antes** de sembrar: si no, las adiciones se cargarían como `Salsa de CHOCOLATE` y el recubierto con máximo 4 |
| **3** | `pnpm cargar:opciones <org> --aplicar` | Lee la ficha ya corregida |
| **4** | `pnpm regenerar:flota` | El prompt guardado se actualiza |

---

## ⚠️ Qué pasa exactamente al regenerar

El prompt vive en `agent_profile.instructions` y **producción lee lo guardado**,
así que regenerar cambia lo que dicen los agentes **sin necesidad de desplegar
nada**.

Y trae **dos cosas a la vez**:

1. Los nombres corregidos de las salsas.
2. **La conducta en plural** ([90](90-LA-CONDUCTA-EN-PLURAL.md)) — que el agente
   apunte varias cosas de una vez y no repregunte lo ya dicho.

> Es decir: **el momento de regenerar es el momento en que La Churra nota el
> trabajo del 17-ago**. Conviene hacerlo mirando, no de pasada.
>
> Si se prefiere separarlo, los puntos 1 y 3 no tocan el prompt: se pueden
> aplicar antes y regenerar otro día.

---

## Reversión

| Cambio | Cómo se vuelve atrás |
|---|---|
| La repetición | El mismo interruptor del CRM, o `pnpm repeticion <org> SALSA --no --aplicar` |
| La ficha | El registro de cambios guarda el valor anterior; se reescribe |
| Las opciones cargadas | `DELETE` de los grupos nuevos — son `INSERT` aditivos, nada se pisó |
| El prompt | `pnpm regenerar:flota` tras revertir la ficha |

**Ninguno toca el esquema.** Y las cuatro banderas siguen en `'prompt'`, así que
nada de esto enciende la Fase 2 por su cuenta.
