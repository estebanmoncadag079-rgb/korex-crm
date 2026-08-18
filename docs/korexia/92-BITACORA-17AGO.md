# Bitácora del 17 de agosto de 2026

> **Dentro:** El día en una frase · Las diez fases · Lo que se tocó en
> producción · Los errores propios · Lo que aprendió el proyecto · Los números

**12 commits, ninguno subido. 776 pruebas en verde. Cero despliegues.**

---

## El día en una frase

Íbamos a encender la Fase 2 para La Churra. Una prueba real por WhatsApp destapó
que **el pedido no cabía en el modelo** —ni en pedidos ni en citas, por caminos
distintos—, así que se paró el encendido, se auditó, el dueño decidió el alcance
y se reconstruyó el contrato.

---

## Las diez fases

### 1 · La ficha, blindada · `aecac9e` `f86013e`

Se aplicaron los requisitos de cierre a las fichas de producción. **Y en el
proceso rompí dos**: `migrar-requisitos` leyó la ficha con `leerFicha()` —que la
**aplana**— y guardó ese resultado, borrando el modelo por secciones de La Churra
y Lashes Valen. Se detectó porque una consulta de rutina devolvió `vertical`
vacío, y se reparó con `--reparar-forma`, comparando ida y vuelta antes de
escribir una sola fila.

Lo incómodo no fue el error: **`serializarComoEstaba` ya existía** y nada
obligaba a usarla. Ahora `leerFichaAplanada` devuelve un tipo marcado y un
guardarraíl revisa cada `.set({ ficha: … })` del repositorio. Ver
[84](84-EL-MODELO-DE-LA-FICHA.md).

### 2 · La prueba de extremo a extremo · `0e4edb7` `dfc4a19`

Con los 12 criterios de salida escritos **antes** de ejecutarla, por condición
del dueño. El script existía pero probaba lo de anteayer: no cerraba un pedido,
no tenía más de un grupo de opciones y **no tocaba el vertical de citas**. Se
reescribió con dos clientes efímeros, uno por vertical.

**41 comprobaciones en verde** contra la base real. Ver [85](85-PROBAR-ESTADO.md).

### 3 · La auditoría del caso real · `eeea542`

Prueba real por WhatsApp: *«Churrita arequipe / Besties chocolate y chocolate»*.
El agente escribió *«Anotado tu Churrita con arequipe»* y **tres líneas después
preguntó qué salsa quería para la Churrita**.

Lo primero que apareció cambió la lectura de todo: **la Fase 2 estaba apagada**
(`state_source = 'prompt'`), así que `normalizarPedido` no había intervenido. Lo
observado era el modelo siguiendo un guion escrito para un solo producto. Ver
[86](86-DOS-PRODUCTOS-EN-UN-PEDIDO.md).

### 4 · El pedido multiproducto, contado · `a0d6423`

Inventario con números y no estimaciones: **21 accesos** que asumían un solo
producto, **39 usos** de `seleccion`, **0** apariciones de `item` en todo el
repositorio. Y nace la **regla 10**. Ver [87](87-PEDIDOS-MULTIPRODUCTO.md).

### 5 · La auditoría universal · `c67353c`

La pregunta dejó de ser *«¿cómo arreglo pedidos?»* para ser **«¿sirve a cualquier
negocio de VOCERO?»**. Tres hallazgos de fondo, y **corrigió a la fase anterior**:
su propuesta habría funcionado para La Churra y habría dejado citas exactamente
donde estaba. Ver [88](88-AUDITORIA-SELECCION-MULTIPLE.md).

### 6 · El sembrador, sin vocabulario de comida · `7b78a56`

`catalog/sembrar.ts` decidía el mínimo y el máximo de los grupos de **cualquier
negocio** buscando `recubiert|azucar|cobertura` y `adicion|extra`. Ahora solo
cuenta lo que el negocio escriba, y **lo que no se sabe se marca** para que lo
mire una persona.

### 7 · Cuatro decisiones, congeladas · `b275e88`

Los dos verticales a la vez · el pedido no se persiste · las citas entran en la
Fase 2 · tope de 40 elementos.

### 8 · El contrato nuevo · `44baa50` `493c560`

`items[]`, cada uno con su cantidad y **sus propias** opciones. `datos` se queda
en la raíz. Ver [89](89-EL-CONTRATO-DE-LOS-ITEMS.md).

> Las **34 pruebas** anteriores pasaron **sin cambiar una sola expectativa**.
> Solo cambió cómo se construye la entrada — la señal de que el refactor no
> alteró el comportamiento sin querer.

### 9 · La conducta, en plural · `d31c034`

La otra mitad, y la que de verdad arregla lo que se vio: **de nada sirve que el
estado aguante tres cosas si el agente las pregunta de una en una**. En citas, su
propia vuelta: varios servicios son *una* visita, con el tiempo sumado. Ver
[90](90-LA-CONDUCTA-EN-PLURAL.md).

### 10 · Los bloqueantes de La Churra · *en curso*

Medido en producción, **nada aplicado**. `pnpm repeticion` (nuevo, genérico) y la
clasificación de `product_option_group`, que faltaba. El plan completo, con los
datos reales, en [91](91-CATALOGO-DE-LA-CHURRA.md).

Y al final del día, `probar:estado` volvió a ejecutarse **con el contrato v4**:
**45 comprobaciones, todas en verde**, incluido el caso real de dos productos
guardado y recuperado de la base.

---

## Lo que se tocó en producción

| Qué | Estado |
|---|---|
| Requisitos de cierre en las cuatro fichas | ✅ aplicado y verificado |
| Reparación del modelo por secciones de dos fichas | ✅ aplicado y verificado |
| Dos organizaciones efímeras | creadas y borradas, **sin restos** |
| Código del núcleo, contrato y conducta | **sin desplegar** |
| Banderas `state_source` | las cuatro siguen en `'prompt'` |
| El prompt de los agentes | **sin regenerar**: nadie ha notado nada todavía |

---

## Los errores propios, que son los que enseñan

**Rompí dos fichas de producción** usando la función que aplana en vez de la que
persiste. La correcta ya existía.

**Una prueba de disponibilidad pasó por la razón equivocada**: leí el mapa al
revés siguiendo lo que decía un documento, obtuve `undefined` y el caso contrario
salió verde por casualidad. El código estaba bien; la auditoría del paso 4 estaba
mal escrita.

**Metí nombres de un cliente en el núcleo** mientras escribía el contrato nuevo
—un ejemplo con «Churrita» y «Besties» en el prompt que comparten todos— y lo
quité en el mismo commit.

**Un bundle temporal se coló en un commit** por escribir mal el patrón del
`.gitignore`. Se sacó en el siguiente y ahora el patrón está bien.

---

## Lo que aprendió el proyecto

**Regla 10 (nueva):** ningún flujo del CRM puede asumir que un pedido contiene un
único producto. No la pidió un cliente — la pidió alguien que hizo lo más normal
del mundo, pedir dos cosas de una vez.

**La aritmética no es la regla de negocio.** Una migración puede deducir que un
grupo de 5 opciones con 4 sabores necesita repetir. No puede deducir que el
negocio quiere repetir también en los otros tres.

**Una prueba con catálogo inventado demuestra que el código sabe hacer algo, no
que este cliente pueda.** Existía `"dos de arequipe en una Besties"`, pasaba, y
en producción ese grupo no admite repetir.

**Un guardarraíl sin prueba negativa es verde para siempre.** Pasó dos veces hoy:
el detector de la ficha y el de vocabulario de comida.

---

## Los números

| | |
|---|---|
| Commits | **12**, ninguno subido |
| Archivos tocados | **33** (+3.812 / −489) |
| Documentos nuevos | **7** ([84](84-EL-MODELO-DE-LA-FICHA.md) a [90](90-LA-CONDUCTA-EN-PLURAL.md)), más [91](91-CATALOGO-DE-LA-CHURRA.md) y este |
| Archivos de código | **14** |
| Pruebas | **755 → 776**, siempre en verde |
| Despliegues | **0** |

---

## La ventana que se cierra

Es la **tercera vez** que este proyecto cambia la forma del estado sin coste,
aprovechando que `conversation_state` estaba vacía (v2, v3 y hoy la v4).

**Es la última vez que se puede contar con eso.** En cuanto se encienda el primer
cliente, un cambio así deja de costar un `git revert` y pasa a costar pedidos de
gente real.
