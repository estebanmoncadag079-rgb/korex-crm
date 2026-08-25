# 140 — Un requisito fuera de catálogo bloqueaba todo el guardado

25-ago-2026.

## El síntoma

Con el mensaje de error del cuestionario ya corregido para mostrar el detalle
real (mismo día, commit aparte sin doc propio: el frontend leía `d?.message`
en vez de `d?.error?.message`), Esteban vio el motivo exacto al intentar
terminar el cuestionario de Lis:

```
borrador.cierre.requisitos.2.id: Invalid enum value.
Expected 'nombre' | 'telefono' | 'email' | 'documento', received 'direccion'
```

Y preguntó, con razón: Lis no pide documento ni correo — esas casillas ni
están marcadas — ¿por qué falla por "dirección", que ni siquiera aparece en
la pantalla?

## La causa

El paso "Datos que deben solicitarse antes de confirmar" solo gestiona
**cuatro** ids — los que se guardan en el contacto (`nombre`, `telefono`,
`email`, `documento`). Pero el tipo real de un requisito
(`server/ai/generador/ficha.ts`) admite un quinto: `direccion`, para pedidos
con domicilio — vivo y en uso por `requisitosSugeridos()`, la función que
usó `migrar:requisitos` para proponer requisitos a negocios de pedidos antes
de que existiera esta pantalla.

El schema de validación del endpoint (`src/app/api/onboarding/route.ts`)
exigía que `cierre.requisitos[].id` fuera **uno de los cuatro** ids del
catálogo de esta pantalla — un `z.enum` más estricto que el propio tipo
`Requisito.id` (que es `string`, sin restricción). Cualquier ficha que
llevara "dirección" en algún momento —o cualquier borrador con ese id
residual en el navegador— quedaba **bloqueada para guardar cualquier cosa**
en el cuestionario, incluso sin tocar ese campo, porque el rechazo ocurre
al validar el body completo, antes de que el servidor mire qué cambió de
verdad.

## Lo que se verificó contra la base real

Se consultó la ficha aplicada y el borrador guardado de Lis (solo lectura,
por el túnel a producción): **ninguno de los dos tiene "dirección" declarada
hoy** — los dos están en `null`. El id que causaba el error venía del estado
que el navegador de Esteban tenía cargado (una carga anterior, sin refrescar
la página), no de un dato real que hubiera que rescatar en este caso
puntual.

Eso no cambia el diagnóstico: la causa de fondo —el schema demasiado
estricto, y la reconstrucción del servidor que descartaba silenciosamente
cualquier id fuera del catálogo— es real y volvería a golpear a cualquier
negocio de pedidos con domicilio que sí tenga "dirección" declarada de
verdad (por `migrar:requisitos`).

## La solución

Dos cambios en `src/app/api/onboarding/route.ts` y
`src/server/ai/generador/ficha.ts`:

1. **El schema ya no exige un enum del catálogo de esta pantalla.**
   `requisitoSchema.id` pasa de `z.enum([...])` a `z.string()` — igual de
   permisivo que el propio tipo `Requisito.id`. Un id fuera de este catálogo
   ya no bloquea el guardado.

2. **Nueva función `fusionarRequisitosDelCatalogo`** (`ficha.ts`): construye
   el array final combinando lo marcado en el catálogo de esta pantalla con
   lo que la **ficha ya aplicada** (`fichaPrevia`, la fuente de verdad real
   del servidor — nunca el body que manda el cliente) tuviera declarado
   fuera de ese catálogo. Un requisito real (como "dirección" de un negocio
   migrado) se preserva; un id stale que solo vive en un navegador viejo, al
   no estar en la ficha real del servidor, simplemente se ignora sin fallar
   y sin inventar nada.

## Verificado

- `tsc --noEmit` y `eslint`: limpios.
- Prueba unitaria nueva,
  [requisitos-fuera-de-catalogo.test.ts](../../tests/unit/requisitos-fuera-de-catalogo.test.ts)
  (4 casos: preserva lo declarado fuera de catálogo, aplica lo marcado,
  no inventa nada de la nada, desmarcar del catálogo no toca lo de fuera).
- Suite completa: **987 pruebas, 0 fallos**, sin regresiones.
- Confirmado contra la base de datos real de Lis (solo lectura) que el
  requisito "dirección" del error no existe hoy en su ficha ni en su
  borrador — el fallo era 100% del servidor rechazando algo que ni siquiera
  hacía falta rechazar.

**Recomendación para Esteban**: recargar la página del cuestionario (F5)
antes de volver a intentar guardar — aunque con este fix ya desplegado el
guardado debería funcionar de todas formas, sin importar lo que el navegador
tuviera cargado de antes.
