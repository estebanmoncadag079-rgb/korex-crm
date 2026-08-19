# Recursos compartibles: archivo, enlace o ambos

> **Dentro:** De dónde sale · Qué se decidió y por qué NO es del salón · El
> modelo · Lo que el núcleo sabe y lo que no · Los dos defectos que se cerraron
> de paso · Cómo se configura · Pruebas · La deuda que queda · Cómo revertir

**18-ago-2026.** Un recurso del negocio ya no es solo "un archivo que se
manda": puede entregarse como **archivo**, como **enlace** o como **ambos**, y
lo decide el negocio al cargarlo — no el código ni el modelo.

---

## De dónde sale

Una clienta pidió el catálogo, el agente respondió *"te envío nuestro
catálogo"* y **no llegó nada**. La auditoría (pedida por el dueño, sin tocar
código) descartó una por una las causas fáciles:

| Comprobación | Resultado |
|---|---|
| El archivo existe y está en el negocio correcto | ✅ PDF 1,4 MB, cargado 5 h antes |
| Llega al prompt | ✅ `fotos.ts` no filtra por tipo |
| `PUBLIC_MEDIA_BASE_URL` | ✅ https válida |
| Meta puede descargarlo | ✅ **HTTP 200**, `application/pdf`, 1,29 s |
| ¿Se envió algo? | ❌ ningún documento saliente |
| ¿Se intentó? | ❌ **`no se pudo mandar` = 0 en todo el log** |

Ese último `0` es la prueba: el `console.warn` de `pipeline.ts` está en el
camino del fallo de `send_image`. Si el modelo hubiera pedido el envío, existiría.
**No lo pidió: narró la acción en vez de ejecutarla** — el mismo patrón de la
cita fantasma ([19-CITAS.md](19-CITAS.md)) y del cierre falso
([38-GUARDARRAILES.md](38-GUARDARRAILES.md)).

Con el chat limpio y la etiqueta corregida, el envío funcionó a la primera. ⚠️
**Se cambiaron dos variables a la vez** —la etiqueta y el historial—, así que
la prueba no aísla cuál de las dos causaba el fallo. Queda dicho, no maquillado.

Y de ahí salió la petición real: *que el cliente reciba un enlace y no tenga
que descargar el PDF*.

## Qué se decidió, y por qué NO es una función del salón

La pregunta obligatoria de [REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md):
*¿puede usarlo cualquier negocio de VOCERO sin modificar el núcleo?*

Sí. La Churra con su menú, Lis con su carta, un taller con su tarifario, un
consultorio con su guía. **Categoría 3: capacidad global del CRM**,
configurable y opcional — un negocio que no la active no nota que existe.

## El modelo

`media_asset` gana dos columnas:

| Columna | Qué |
|---|---|
| `entrega` | `archivo` (por defecto) · `enlace` · `ambos` |
| `url` | el enlace externo, cuando aplica |

Y `mime_type` / `datos` / `tamano` dejan de ser `NOT NULL`: **un recurso que
solo es un enlace no tiene bytes**.

El `DEFAULT 'archivo'` es lo que hace el cambio invisible: todas las filas que
ya existían se comportan **exactamente igual**, y ningún cliente nota nada.

## Lo que el núcleo sabe, y lo que no

El núcleo distingue **archivo** de **enlace**. Y nada más.

No sabe qué es un catálogo, un menú, un tarifario ni una guía — igual que hoy
no sabe si detrás de una etiqueta hay una foto o un PDF (lo decide
`mimeType`). El modelo tampoco: **sigue pidiendo `send_image` con la misma
etiqueta de siempre** en los tres casos. No hubo que tocar el prompt.

```
El negocio declara CÓMO se entrega  →  el servidor lo cumple
El modelo solo dice QUÉ recurso quiere
```

## Los dos defectos que se cerraron de paso

**1. `send_image` aceptaba acciones que no podía ejecutar.** `etiqueta` y
`label` eran las dos opcionales, así que una acción **sin ninguna** pasaba la
validación, no encontraba nada y degradaba a texto — el cliente leía la promesa
y no recibía el archivo.

Se cierra con un `superRefine` que exige **una de las dos**, no una concreta:
exigir `etiqueta` a secas repetiría el bug del 13-ago, cuando se rechazó
`label` y la conversación acabó en manos de una persona con la foto cargada y
lista para enviar.

**2. Un recurso podía declarar algo que no tenía.** Un `enlace` sin `url`, o un
`archivo` sin `datos`, es la misma promesa incumplible. Se cierra en **tres
capas**: la restricción `media_entrega_coherente` en la base, el `superRefine`
de la API, y `comoSeEntrega()` en el servidor, que mira **lo que el recurso
tiene**, no lo que dice ser.

## Cómo se configura

```bash
pnpm subir:media <org> <ruta>          "<etiqueta>" <kind>   # archivo
pnpm subir:media <org> <https://...>   "<etiqueta>" <kind>   # enlace
pnpm subir:media <org> <ruta> "<etiqueta>" <kind> --enlace=<https://...>  # ambos
```

Y lo mismo por `POST /api/media` con `entrega` y `url`.

## Pruebas

| | |
|---|---|
| `tests/unit/recursos-compartibles.test.ts` | 10 casos: las tres formas de entrega, **con sus casos negativos** (un `enlace` sin url no entrega nada) y el contrato de `send_image` |
| `tests/unit/pipeline-send-image.test.ts` | 6 casos, 3 nuevos: enlace, ambos, y un enlace roto que cae a texto. `comoSeEntrega` se deja **real** (`importActual`) — mockearla dejaría el test verde sin probar nada |

**Gate**: `pnpm test` ✅ **817 passed, 73 skipped** · `pnpm typecheck` ✅ ·
`pnpm lint` ✅. El script se comprobó aparte con un `tsconfig` temporal, porque
`tsconfig` sigue excluyendo `scripts/` (deuda del 17-ago).

**La migración `0026` NO se ejecutó contra ninguna base.** Escrita a mano y
revisada statement por statement contra `schema.ts` y contra la única fila real
que hoy existe, que cumple el CHECK.

## 🔴 La deuda que queda, dicha y no escondida

1. **Un enlace externo puede morir en silencio.** Si quien lo publicó lo mueve,
   lo borra o le quita el permiso público, deja de funcionar y **el CRM no se
   entera**. Es la misma familia de fallo silencioso que este proyecto lleva
   persiguiendo desde el dominio suspendido ([42](42-DOMINIO-SUSPENDIDO.md)) — y
   esta vez se añade **a propósito**, a cambio de que el negocio pueda actualizar
   el recurso sin resubirlo. Un recurso guardado como archivo no tiene ese riesgo.

   > **Decisión del dueño (18-ago-2026)**: la vigilancia es **manual** — *"si el
   > link cambia yo te aviso para que lo cambiemos"*. Queda anotado porque es lo
   > único que hoy separa a un enlace roto de una venta perdida: **no hay ninguna
   > comprobación automática**, ni alerta, ni reintento. Si algún día hay muchos
   > recursos por enlace, esto pide un chequeo periódico como el que se le añadió
   > al monitor tras el dominio suspendido.
2. **No hay pantalla en el CRM.** La capacidad existe y la API la soporta, pero
   hoy se configura por script o por API: el negocio todavía no puede activarla
   solo. Mientras no exista, esto incumple a medias el principio de que la
   configuración pertenece al CRM.
3. **`elegirFoto` no quita artículos ni palabras vacías**: `"el catálogo"` no
   encuentra nada, con cualquier etiqueta. Su gemelo `buscarServicio`
   (`appointments/logic.ts`) sí tiene `STOP_WORDS`. Dos buscadores difusos del
   mismo sistema con capacidades distintas, y el de recursos es el pobre.
4. ✅ **18-ago, más tarde el mismo día: el guardarraíl se construyó.** La prueba
   en chat limpio que faltaba se hizo, y midió lo contrario de lo que parecía:
   el patrón NO estaba limitado a la conversación de pruebas — apareció en
   3 conversaciones de 2 negocios, una con una cita real agendada. Detalle
   completo en [101-GUARDARRAIL-RECURSO-PROMETIDO.md](101-GUARDARRAIL-RECURSO-PROMETIDO.md).

## Cómo revertir

```bash
git revert <commit>        # código y pruebas
```

Y en la base, si la migración llegó a ejecutarse:

```sql
ALTER TABLE "media_asset" DROP CONSTRAINT "media_entrega_coherente";
ALTER TABLE "media_asset" DROP COLUMN "url";
ALTER TABLE "media_asset" DROP COLUMN "entrega";
ALTER TABLE "media_asset" ALTER COLUMN "mime_type" SET NOT NULL;
ALTER TABLE "media_asset" ALTER COLUMN "datos"     SET NOT NULL;
ALTER TABLE "media_asset" ALTER COLUMN "tamano"    SET NOT NULL;
```

⚠️ Los tres `SET NOT NULL` fallan si para entonces existe algún recurso
solo-enlace: hay que borrarlo o darle archivo antes.

**Nada de esto cambia el comportamiento de un cliente que no lo use**: sin
`entrega` declarada, todo recurso sigue siendo un archivo.
