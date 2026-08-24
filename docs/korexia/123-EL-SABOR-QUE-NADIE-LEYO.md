# El sabor que nadie leyó: el catálogo tenía cuatro copias

> **Dentro:** El diagnóstico por capas · Las cuatro copias del mismo dato · Por
> qué el campo que el dueño edita está muerto · La trampa que espera al que
> arregle esto · El arreglo #1 aplicado · Qué sigue sin hacerse
>
> ✅ **24-ago-2026: el arreglo #1 (el dato) está aplicado y verificado en vivo.**
> El resto —solo lectura del catálogo cuando la fuente es la tabla, recortar la
> entrada de conocimiento duplicada, el escenario de prueba— **sigue sin
> hacerse**, pendiente de decisión del dueño. Ver el bloque *Arreglo #1* al
> final.

**20 de agosto de 2026, 11:33.** Un cliente pregunta a Lis Pastelería *"¿cuáles
son los cremosos que tienes?"*. El agente contesta con la lista correcta y una
línea inventada:

> • Cremoso de Temporada (**¡hoy es de mango biche!**) — $19.000

**Mango biche no existe.** Cero coincidencias en productos, cero en conocimiento,
cero en la ficha, cero en el prompt. `MANGO` solo existe como *topping*. Y el
"hoy" es todavía peor que el sabor: es una afirmación temporal que ningún dato
sostiene.

El dueño reportó tres cosas y las tres eran ciertas, pero **la causa no era
ninguna de las que parecían**.

---

## El diagnóstico, por las capas

Aplicado en el orden que dicta el dueño: dato → interpretación → motor → acción
→ pipeline → y solo al final, guardarraíl.

### 1. ¿Está mal el dato? — Sí, y ahí está la causa

En la tabla que el agente **realmente lee**:

```
Cremoso de Temporada  |  description = NULL  |  $19.000
```

Un producto cuyo nombre **anuncia un atributo variable** —"de Temporada"— y no
trae ningún valor. El agente vio un hueco con letrero y lo rellenó.

### 2. ¿Está mal cómo lo interpretamos? — Sí, y esto es de arquitectura

**El sabor sí estaba escrito.** Aquí:

```
ficha.negocio.catalogo → "• Cremoso de Temporada (Arrechon) — $19.000"
```

Ese es el campo que el dueño **ve y edita en el cuestionario**. Y para Lis está
**muerto**: Lis está en Fase 1 (`catalog_source = 'tabla'`), y `generarPerfil`
excluye ese texto del prompt — correctamente, para no duplicar el catálogo. Pero
nada lo copia a `product`, y nada le dice al dueño que lo que escribe ahí ya no
manda.

**Editó la fuente de verdad de antes de ayer.**

### 3, 4, 5. ¿Motor, acción, pipeline? — No

El pipeline inyectó correctamente lo que la tabla tenía. La acción fue la
correcta. El motor hizo lo que hace un modelo ante un hueco: rellenarlo.

### 6. ¿Guardarraíl? — No hay que llegar ahí

Y conviene decirlo, porque era la tentación: *"el agente inventa, pongámosle una
comprobación que verifique lo que afirma de cada producto"*. Habría sido caro,
frágil, y habría tapado un dato que falta con una alarma.

---

## Las cuatro copias del mismo dato

Es el hallazgo que hay que retener. Estado **el 20-ago tras la investigación**:

| Dónde vive | ¿Tiene el sabor? | ¿Lo ve el agente? |
|---|---|---|
| `ficha.negocio.catalogo` — **lo que el dueño edita** | ✅ Arrechon | ❌ **muerto en Fase 1** |
| `product.description` — **lo que el agente lee** | ❌ `NULL` | ✅ **esto es lo que ve** |
| `kb_entry` del menú | ❌ sin sabor | ✅ sí |
| `instructions` (el prompt guardado) | ❌ | — (el catálogo se inyecta por turno) |

La única columna que importa es la tercera, y la única fila que el agente lee es
la segunda. El dueño escribía en la primera.

---

## La cronología, reconstruida desde los respaldos

Importa porque descarta la hipótesis más incómoda: que la migración a Fase 1
—hecha esa misma madrugada— hubiera **perdido** el dato.

| Cuándo | Qué |
|---|---|
| 20-ago **03:49:31** | La migración a Fase 1 crea `Cremoso de Temporada` **sin descripción** |
| 20-ago **11:33** | El agente responde «mango biche» |
| 20-ago **~11:50** | El dueño mira el cuestionario y ve `(Arrechon)` — está en su **borrador** |
| 20-ago **~16:00** | Respaldos `bk_canales` y `bk_regen_20260820`: la ficha **aún no** tiene `arrechon` |
| 20-ago **16:32:52** | La ficha aplicada pasa a tener `(Arrechon)` |

**La migración no perdió nada.** `leerCatalogoDeTexto` es determinista y, ante
`• Cremoso de Temporada (Arrechon) — $19.000`, habría producido nombre y
descripción. No lo hizo porque **en ese momento la ficha no tenía el sabor**:
`bk_canales` lo confirma con el texto literal.

> **Y hay un segundo tropiezo encadenado, que resultó irrelevante**: el dueño lo
> escribió en el **borrador** del cuestionario y no llegó a aplicarlo, así que ni
> siquiera estaba en la ficha cuando el agente respondió. Da igual: **aunque lo
> hubiera aplicado, el agente tampoco lo habría visto.** Arreglar solo esto
> habría dejado el fallo intacto.

---

## La tercera pregunta del dueño: ¿consulta el conocimiento?

*"¿El bot no está consultando la base de conocimiento real?"*

**Sí la consulta, entera, en cada turno.** `pipeline.ts` carga todas las entradas
de la organización y `renderKb` las inyecta **completas, sin truncar**, bajo el
rótulo *"tu única fuente de verdad"*.

No fue el mecanismo: fue que **la entrada del menú tampoco tenía el sabor**.
Ninguna de las dos fuentes vivas lo tenía.

### Pero la pregunta destapó algo que sí importa

En el mismo prompt van **dos bloques, y los dos se declaran la fuente de verdad**:

```
prompts.ts:723  CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad; …)
prompts.ts:730  CATÁLOGO DEL NEGOCIO (… es la fuente de verdad, no inventes …)
```

Hoy no chocaron por suerte. Pero `kb_lispasteleria0001` **duplica el menú entero
con precios** (892 caracteres): en cuanto cambie un precio en Catálogo, el prompt
llevará **dos precios distintos del mismo producto**, cada uno rotulado como
definitivo.

Comprobado en la flota: **solo Lis tiene entradas de conocimiento con precios**
(`0001` el menú, `0013` bebidas, `0012` tortas). La Churra y Lashes Valen, ninguna.

---

## ⚠️ La trampa que espera al que arregle esto

`leerCatalogoDeTexto` parte la línea por el guion largo y toma como **nombre**
todo lo anterior. Así que, con la ficha **como está hoy**, volver a ejecutar
`pnpm migrar:catalogo` produciría un producto llamado:

```
Cremoso de Temporada (Arrechon)      ← el sabor, dentro del NOMBRE
```

Que es exactamente lo que no se quiere: la semana que viene habría que
**renombrar el producto** para cambiar el sabor, en vez de editar un campo. El
sabor pertenece a la descripción, no al nombre.

---

## Qué se propuso — y en qué quedó cada cosa

| # | Capa | Propuesta | Estado |
|---|---|---|---|
| 1 | Dato | Poner `Arrechon` en `product.description` | ✅ **hecho y verificado el 24-ago** — ver abajo |
| 2 | Arquitectura | Para clientes con `catalog_source='tabla'`, el cuestionario muestra el catálogo en **solo lectura** con un aviso «esto se edita en Catálogo» | ⬜ **sin decidir** |
| 3 | Dato | Recortar `kb_lispasteleria0001` a lo que el catálogo NO puede responder (qué es un cremoso), quitándole precios y lista de productos | ⬜ **sin decidir** |
| 4 | Pruebas | Un escenario en `probar:escenarios`: producto sin descripción → el agente **no le atribuye características** | ⬜ **sin hacer** |

## ✅ Arreglo #1, aplicado el 24-ago-2026

Un `UPDATE` de una fila, con respaldo previo y verificación en vivo — sin tocar
código:

```sql
-- Respaldo completo de los 15 productos de Lis, antes de tocar nada:
CREATE TABLE product_bk_temporada_20260824 AS
  SELECT * FROM product WHERE organization_id = 'org_lispasteleria0001';

UPDATE product
   SET description = 'Arrechon', updated_at = now()
 WHERE organization_id = 'org_lispasteleria0001'
   AND name = 'Cremoso de Temporada'
   AND description IS NULL;   -- guarda: si ya tenía algo, no se pisa
```

**Comprobado que no cambió nada más**: la fila completa (nombre, precio,
disponibilidad, categoría) contra el respaldo solo difiere en `description`.

**Verificado con la función real del pipeline**, no con una consulta suelta —
`catalogoDePedidos()` + `renderCatalogoDePedidos()`, las mismas que arma el
prompt en cada turno:

```
LINEA REAL QUE VERA EL AGENTE:
Cremoso de Temporada — $19.000 (Arrechon)
```

Es exactamente el texto que había en `ficha.negocio.catalogo` (el campo muerto),
ahora en el sitio que sí manda. El script de verificación era desechable y se
borró tras confirmar.

⚠️ **Esto no cierra el caso.** Arregla el sabor de HOY; no evita que vuelva a
faltar la semana que viene, porque el campo editable del dueño sigue
desconectado de la tabla. Es exactamente lo que cubre la propuesta #2, todavía
sin decidir.

> 🔑 Sobre la propuesta 2 y el **Paso 3 congelado**: el motivo del congelamiento
> era que el texto del catálogo en la ficha es la fuente que lee
> `migrar:catalogo`. Pero **ocultar no es borrar**: el texto puede seguir en la
> ficha y a la vez dejar de ofrecerse como editable a un cliente que ya está en
> Fase 1. Eso no es el Paso 3 completo — es dejar de mostrar como editable algo
> que no manda.

> ⚠️ Y la propuesta contraria —que el cuestionario **sincronice** su texto a
> `product`— se descartó a propósito: reintroduce **dos escritores** sobre el
> catálogo, que es exactamente lo que le vació las reglas de flujo a La Churra el
> 15-ago ([68](68-UN-DUENO-POR-DATO.md)).

---

## Cómo revertir

El diagnóstico no tocó nada (respaldos consultados:
`agent_profile_bk_canales`, `agent_profile_bk_regen_20260820`,
`organization_bk_borrador_20260820` — siguen intactos).

El arreglo #1 sí escribió un dato, y su reversa es directa:

```sql
UPDATE product SET description = NULL, updated_at = now()
 WHERE organization_id = 'org_lispasteleria0001' AND name = 'Cremoso de Temporada';
-- o, para restaurar la fila EXACTA de antes:
-- SELECT * FROM product_bk_temporada_20260824 WHERE name = 'Cremoso de Temporada';
```

`product_bk_temporada_20260824` guarda los 15 productos de Lis tal como estaban
antes del `UPDATE`, sin fecha de expiración — bórrala manualmente cuando ya no
haga falta.
