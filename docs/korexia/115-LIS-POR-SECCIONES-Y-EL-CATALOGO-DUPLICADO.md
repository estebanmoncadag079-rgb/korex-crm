# Lis por secciones — y el catálogo que estaba dos veces en su prompt

> **Dentro:** Lo que el guardarraíl del script destapó · El error del 19-ago ·
> La deriva de los otros dos, sin tocar · El filtro que faltaba · Cómo revertir

**20 de agosto de 2026.** Paso 2 de la auditoría: convertir la ficha de Lis al
formato por secciones. Parecía un comando. Resultó destapar **un error mío del
19-ago que estaba vivo en producción**.

---

## El guardarraíl hizo su trabajo

`pnpm convertir:ficha` **abortó**:

```
1. PROMPT COMPLETO (no la longitud)
   18880 caracteres · 🔴 DIFERENTE

⛔ ABORTADA. Motivos:
   - el prompt recompilado NO es idéntico (18880 → 17276 caracteres)
     línea 70: guardado "## Lo que vendes" vs recompilado "## Cómo lo recibe"
```

No era un obstáculo del script: era el script haciendo exactamente aquello para
lo que se escribió — comparar el prompt **completo**, no su longitud, y abortar
ante cualquier diferencia.

## Lo que había debajo

El 19-ago, al migrar a Lis, se hicieron dos cosas en este orden:

1. Se aplicó su ficha → el prompt se generó **con el catálogo dentro**, que era
   lo correcto en ese momento: `catalog_source` todavía era `'prompt'`.
2. Se encendió `catalog_source='tabla'` → **y no se regeneró el prompt**.

Resultado: durante un día, el prompt de Lis llevaba el menú **dos veces**.

| De dónde salía | Qué decía |
|---|---|
| `## Lo que vendes`, incrustado en `instructions` | El menú tal como estaba en su ficha |
| `CATÁLOGO DEL NEGOCIO`, inyectado por el pipeline | El menú fresco de las tablas — y **se declara a sí mismo «la fuente de verdad»** |

Es exactamente la doble fuente que la Fase 1 existe para eliminar, en el cliente
que más factura. Todavía no había hecho daño porque los dos textos decían lo
mismo; el día que alguien cambiara un precio desde el CRM, el de la tabla se
habría actualizado y el del prompt no.

> 🔑 **Encender una bandera no basta: hay que recompilar lo que dependía de
> ella.** `migrar:catalogo --encender` cambia de dónde lee el pipeline, pero el
> prompt guardado sigue siendo el de antes hasta que alguien lo regenere.

### Solo le pasó a Lis

Comprobado en la base contra los tres:

| Negocio | `catalog_source` | ¿Catálogo dentro del prompt? |
|---|---|---|
| La Churra | tabla | ✅ No |
| Lashes Valen | citas | ✅ No |
| **Lis Pastelería** | tabla | 🔴 **Sí** |

---

## La deriva de los otros dos, que NO se tocó

Al regenerar apareció algo que no se buscaba: **los tres prompts habían
derivado**, cada uno por su motivo.

| Negocio | Guardado → recompilado | Por qué |
|---|---|---|
| **Lis** | 18.880 → 17.276 (−1.604) | El catálogo duplicado |
| La Churra | 17.523 → 18.450 (**+927**) | Lecciones de `conducta.ts` que aún no ha heredado |
| Lashes Valen | 7.557 → 7.742 (**+185**) | Ídem |

Es el comportamiento diseñado: `conducta.ts` mejora y los prompts guardados se
quedan atrás hasta que alguien los regenera. Pero **aplicarlo habría empujado
conducta nueva a dos negocios vivos de golpe**, mucho más de lo aprobado.

**Queda pendiente y es una decisión del dueño**, no una tarea de limpieza: son
mejoras reales que esos dos clientes todavía no tienen, y activarlas es un cambio
de comportamiento que merece medirse.

---

## El filtro que faltaba

`regenerar:flota` era todo o nada. Ahora acepta un cliente:

```bash
pnpm regenerar:flota <organizationId>            # solo ese, y no escribe
pnpm regenerar:flota <organizationId> --aplicar
```

Es el mismo argumento que ya aceptan `migrar:catalogo`, `migrar:requisitos`,
`convertir:ficha` y `fase2`. En una plataforma con muchos negocios, **«a todos»
tiene que ser una elección, no el único modo** — si no, arreglar a uno obliga a
mover a todos.

---

## Lo que se hizo, en orden

| | Acción | Resultado |
|---|---|---|
| 1 | `regenerar:flota <lis> --aplicar` | Prompt 18.880 → 17.276. Catálogo duplicado fuera. Respaldo en `agent_profile_bk_regen_20260820` |
| 2 | `convertir:ficha <lis>` | Las tres comprobaciones ✅ |
| 3 | `convertir:ficha <lis> --aplicar` | Ficha por secciones. Respaldo en `agent_profile_bk_conversion` |

Estado final de la flota — **los tres alineados**:

| Negocio | Ficha por secciones | Catálogo duplicado |
|---|---|---|
| La Churra | ✅ | ✅ no |
| Lashes Valen | ✅ | ✅ no |
| Lis Pastelería | ✅ | ✅ no |

---

## Cómo se probó

Lo que importaba no era que los scripts terminaran sin error, sino que **Lis
siguiera sabiendo su menú** con 1.604 caracteres menos de prompt:

```
CLIENTE: cuanto vale el cremoso de 16 oz y que toppings lleva
AGENTE:  el cremoso de 16 oz vale $22.000 y lleva 3 toppings a tu elección
CLIENTE: dame uno con mora y limon y maracuya
         → total_cents=2200000 · resultado=guardado · rechazos=0
```

Precio correcto, número de toppings correcto, los tres aceptados y el total
calculado por el servidor. **El menú viaja ahora solo desde las tablas.**

| Prueba | Resultado |
|---|---|
| `typecheck` · `lint` | limpio |
| `vitest run` | 907 pruebas, 0 fallos |
| `probar:estado` (dos verticales) | 46/46 |
| Conversación real por el pipeline | ✅ arriba |

---

## Cómo revertir

```bash
pnpm convertir:ficha org_lispasteleria0001 --revertir   # la ficha vuelve a plana
```

Y el prompt, desde `agent_profile_bk_regen_20260820`. Los dos pasos son
independientes: se puede deshacer la conversión sin devolver el catálogo
duplicado, que es lo que se querría en la práctica.
