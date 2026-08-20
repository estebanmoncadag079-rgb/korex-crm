# El cuestionario guarda lo que pregunta

> **Dentro:** Los cuatro campos que se tiraban · Por qué la prohibición era
> correcta en su día · Los dos motivos que hacían falta · El residuo que casi
> borra 14 reglas · Cómo revertir

**20 de agosto de 2026.** Segundo defecto del
[117](117-EL-CUESTIONARIO-VEIA-VACIO.md), y el más caro de los dos: **el
cuestionario pedía datos que no podía guardar.**

---

## Lo que se tiraba

`aplicarFicha` se llamaba sin declarar secciones, así que por defecto solo
escribía `negocio`. Pero el formulario recoge cuatro campos que no están ahí:

| Campo | Sección | Dónde se pregunta |
|---|---|---|
| `saludoInicial` | `flujo` | *"¿Quieres un saludo propio para quien escribe por primera vez?"* |
| `reglasPropias` | `flujo` | Las reglas del día a día del negocio |
| `escalarSiempre` | `politicas` | Paso 8 — *"Cuándo debe llamarte a ti"* |
| `nuncaPrometer` | `politicas` | Paso 8 |

En el alta funcionaba (no hay ficha guardada, así que se escribe todo). **Al
reeditar, los cuatro se descartaban en silencio**: el cliente los cambiaba y no
pasaba nada. Y el paso 8 —que el propio cuestionario llama *"la etapa más
importante"*— se perdía entero.

## La prohibición era correcta… para el problema de entonces

No fue un descuido. El [68](68-UN-DUENO-POR-DATO.md) lo decidió así con una
tabla explícita: `flujo` y `politicas` son del operador, y **el cuestionario no
las toca**. Prevenía un incidente real: *el 15-ago el prompt de La Churra pasó
de 18.053 a 11.889 caracteres y perdió sus reglas de flujo* al reenviarse el
formulario.

Pero mirado de cerca, aquello no pasó porque el cuestionario tuviera permiso.
Pasó porque **el formulario salía en blanco y mandaba vacíos**. La prohibición
era una venda sobre esa herida.

## Los dos motivos, y hacen falta los dos

**1. El formulario se precarga** ([117](117-EL-CUESTIONARIO-VEIA-VACIO.md), esta
misma mañana): reenviarlo devuelve lo que había, no vacíos. La causa del
incidente desapareció.

**2. Una sección escribible ahora se FUSIONA, no se reemplaza.** Es el cambio de
fondo, y separa dos cosas que antes eran indistinguibles:

```
no lo manda    (undefined)  → no lo tocó         → se conserva
lo manda vacío ("" o [])    → lo borró queriendo → se borra
```

Reemplazar la sección entera obligaba a que quien escribiera conociera **todos**
los campos de esa sección; quien no los conocía los borraba sin enterarse.

Con eso, el cuestionario escribe las tres secciones y **lo que protege ya no es
prohibirle tocarlas: es que omitir no borre**.

> Lo que NO cambia: el script del operador sigue sin poder tocar `negocio`. Esa
> mitad de la regla protege al cliente y sigue en pie.

### Demostrado con la puerta abierta de par en par

`pnpm probar:propiedad` —la prueba del propio proyecto para esto— simulaba el
reenvío con `["negocio"]`, así que pasaba por una razón que ya no es la de
producción. Ahora usa **las mismas opciones que la ruta real** y su pago hostil
omite los campos del operador en vez de mandarlos vacíos, que es lo que hace un
formulario en blanco:

```
4. cuestionario reenviado · se conservó: (nada)
   prompt : 11504 → 11504  ✅ IDÉNTICO
   reglas de flujo del operador: ✅ INTACTAS
```

Intactas **sin conservar ninguna sección**. Eso es la fusión trabajando.

---

## 🔴 El residuo que casi borra 14 reglas

Al terminar, una comprobación contra la base destapó algo que no se buscaba.

El borrador de Lis —el de la mañana, cuando el formulario salía en blanco—
guardaba **una sola regla**: la de Rappi que el dueño escribió sobre una lista
vacía. Y como el borrador se superpone campo a campo, el formulario le habría
mostrado **1 regla en vez de sus 14**… y ahora que el cuestionario sí escribe,
enviarlo se habría llevado las otras 13.

El arreglo de la mañana y el de la tarde, combinados, creaban un peligro que
ninguno tenía por separado.

Se borró ese borrador (respaldo en `organization_bk_borrador_20260820`,
`branding` intacto). Era el único de la flota. Verificado después:

```
campos: 18 · reglasPropias: 14 · escalarSiempre: 5 · falta: nada
canales: [{"nombre":"Rappi","enlace":"https://rappi.app.link/…"}]
```

Y sin duplicar: la regla de Rappi **no** está en `reglasPropias`; el enlace llega
al prompt desde `canales` ([119](119-CANALES-EXTERNOS.md)).

> Un borrador es una edición a medias, y superponerlo es lo correcto. Lo que era
> residuo aquí es que naciera de un formulario vacío — algo que ya no puede
> volver a pasar.

---

## Pruebas

| | |
|---|---|
| typecheck · lint | limpio |
| Pruebas unitarias | **940**, 0 fallos |
| `probar:estado` | 46/46 |
| `probar:propiedad` | ✅ con las opciones reales de la ruta |
| Contra la base | Lis: 18 campos, 14 reglas, nada duplicado |

En `tests/unit/cuestionario-precarga-la-ficha.test.ts`, la prueba que afirmaba
*"un formulario en blanco SÍ borra lo suyo"* **se reescribió**: afirmaba el
peligro que este cambio elimina. Ahora demuestra la garantía nueva —omitir
conserva, vaciar borra— y que editar el saludo o el escalado por fin se guarda.

## Cómo revertir

```bash
git revert <commit>
# el borrador, desde organization_bk_borrador_20260820
```

Ninguna ficha se migró: cambia **quién puede escribir qué** y **cómo se fusiona**,
no los datos.
