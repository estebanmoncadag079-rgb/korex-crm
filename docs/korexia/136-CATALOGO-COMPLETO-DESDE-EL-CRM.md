# Catálogo completo desde el CRM — sin texto libre duplicado

> **Dentro:** Por qué se pidió · Lo que ya existía y lo que faltaba ·
> Qué se construyó · El mismo patrón que ya usaba CITAS, llevado a PEDIDOS ·
> Verificación · Estado de la flota

**25-ago-2026.** El dueño, revisando el CRM como Lis Pastelería, encontró la
pantalla "Grupos de opciones" (Catálogo) y preguntó para qué servía. Al
explicarle que el paso "Lo que vendes" del cuestionario de alta pedía lo
mismo en texto libre, la respuesta fue directa: *"eso es lo que no quiero,
información regada — para qué tenemos recuadros con información que el bot
no va a leer."*

## Lo que ya existía y lo que faltaba

El catálogo YA vivía en tablas (`product`, `product_option_group`,
`product_option`) para los negocios de pedidos, leído fresco en cada turno.
Pero la pantalla de Catálogo solo dejaba cambiar **una cosa**: si un grupo
admite repetir la misma opción
([94](94-BITACORA-PERMITE-REPETICION-CRM.md)). No había forma de crear un
producto, ni un grupo, ni una opción desde el CRM — todo eso solo se podía
cargar mediante el texto libre del cuestionario de alta + una migración
aparte (`migrar:catalogo`).

Ese texto libre seguía siendo editable después de que un negocio ya migró a
tablas, sin ningún efecto real — la misma trampa que ya tuvo el catálogo de
Lis duplicado dentro de su propio prompt
([115](115-LIS-POR-SECCIONES-Y-EL-CATALOGO-DUPLICADO.md)), aquí aplicada a
la pantalla de alta en vez de al prompt.

## Qué se construyó

**Backend** (`src/server/catalog/`): CRUD completo, scoped() por
organización (Constitución III), con `conRegistro` para auditoría.

- `productos.ts`: crear, editar (nombre/categoría/precio/disponible) y
  archivar. El precio es opcional a propósito — si el negocio no lo sabe,
  el agente lo pregunta en vez de regalarlo.
- `grupos.ts`: se agregó crear grupo, editar completo (nombre/mínimo/
  máximo/repetición — antes solo repetición) y eliminar.
- `opciones.ts` (nuevo): crear, editar y eliminar las opciones dentro de un
  grupo (los toppings, los tamaños).

Clasificadas en `registro-de-cambios.ts` (regla 11 — ninguna tabla se
instrumenta sin decir qué significan sus campos): `product` y
`product_option`, igual que `product_option_group`, como datos de negocio
(qué vende el negocio, nunca quién le compra).

**Frontend**: `catalogo-productos.tsx` reemplaza a `grupos-de-opciones.tsx`
— productos con sus grupos y opciones anidados, todo editable en un solo
lugar.

## El mismo patrón que ya usaba CITAS, llevado a PEDIDOS

El wizard de onboarding ya tenía resuelto este problema para el vertical de
citas: el paso "Lo que vendes" se ocultaba (`etapaSobra`) y al terminar el
alta se avisaba que el catálogo se carga en **Servicios**. Ese mecanismo
solo cubría citas; pedidos seguía mostrando el texto libre.

Ahora el paso se **elimina del array por completo** (no solo se oculta) en
los dos verticales, y el aviso final se bifurca: citas sigue apuntando a
Servicios, pedidos apunta a **Catálogo**. `LectorDeCarta` (el componente de
subir PDF/foto de este wizard) quedó sin ningún uso tras quitar el paso y
se eliminó — Servicios ya tiene su propio componente equivalente
(`importar-catalogo.tsx`), que usa el mismo endpoint del backend
(`/api/onboarding/catalogo`, que sí se conserva).

`faltantesDeLaFicha` ya no exige "el catálogo con precios" para poder
terminar el alta de un negocio de pedidos: ese dato se carga después, en
Catálogo, y exigirlo en el cuestionario bloqueaba un alta que puede
completarse perfectamente sin él.

**No se tocó nada del vertical de citas**: su pantalla de Servicios, su
componente de importación y su flujo de alta siguen exactamente igual.

## Verificación

| | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| `eslint` sobre los archivos tocados | limpio |
| `vitest run tests/unit tests/integration` | **982 pruebas, 0 fallos** (80 se saltan sin `TEST_DATABASE_URL`, igual que antes de este cambio) |

Pruebas de integración nuevas (`catalogo-completo-crm.test.ts`, mismo patrón
que 94): crear/editar/archivar un producto, crear un grupo con sus opciones
y verlo reflejado en lo que lee el agente sin regenerar nada, editar un
grupo completo, eliminar un grupo en cascada, y dos negativas — una
organización no puede editar ni crear nada sobre el producto de otra (la FK
compuesta lo rechaza a nivel de base de datos), ni leer su catálogo.

## Estado de la flota

Los tres negocios reales ya tenían su catálogo en tablas antes de este
cambio — no hizo falta migrar nada:

| Negocio | Productos/servicios en tabla |
|---|---|
| Lis Pastelería | 15 productos |
| La Churra | 4 productos |
| Lashes Valen | 49 servicios (vertical citas, sin tocar) |

## Cómo revertir

`git revert` de los commits `d063f91`/`357e743`. Ningún dato de producción
se tocó: el revert solo restaura el texto libre del paso 3 y la pantalla
vieja de Catálogo — el catálogo real de los tres negocios sigue intacto en
sus tablas.
