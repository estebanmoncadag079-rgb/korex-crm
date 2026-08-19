# `permite repetir` se configura desde el CRM

> **Dentro:** Objetivo · Archivos · La API · La pantalla · Las pruebas ·
> Typecheck y tests · Cómo revertir · Riesgos y decisiones pendientes · Por qué
> esto acerca la meta · Documentación colateral

**17-ago-2026. Paso 3B, primera pieza.** El nombre sugerido para este documento
era `91-…`, pero el 91, el 92 y el 93 ya existían: va como **94**.

---

## 1 · Objetivo del cambio

Que `product_option_group.permite_repeticion` —si un grupo admite elegir **dos
veces la misma opción**— se pueda cambiar **desde el CRM**, por quien lleva el
negocio, en lugar de con `pnpm repeticion <org> <GRUPO> --si --aplicar` contra
la base de producción.

La regla ya vivía donde tenía que vivir (el catálogo, desde el paso 3A). Lo que
faltaba era la puerta: mientras la única forma de tocarla fuera un script, el
alta de un cliente nuevo seguía necesitando a alguien con acceso al servidor —
justo lo contrario de la meta del proyecto.

Anotado como deuda viva el 17-ago en [93](93-PENDIENTES-17AGO.md):

> 🟠 **El paso 3B**: el CRM no tiene casilla para la repetición […]. `pnpm
> repeticion` es el puente y hay que borrarlo cuando exista.

---

## 2 · Archivos modificados

**Nuevos**

| Archivo | Qué es |
|---|---|
| `src/lib/catalogo-repeticion.ts` | `repeticionObligatoria()`: la aritmética de "¿se puede completar sin repetir?". Pura y sin dependencias — la usan la pantalla, el servidor, el script y las pruebas |
| `src/server/catalog/grupos.ts` | Los grupos vistos y editados **desde el CRM**: `listarGruposDeOpciones`, `hayGruposDeOpciones`, `actualizarPermiteRepeticion` |
| `src/app/api/catalogo/grupos/route.ts` | `GET` — los grupos de la organización de la sesión |
| `src/app/api/catalogo/grupos/[id]/route.ts` | `PATCH` — cambiar `permiteRepeticion` |
| `src/app/(app)/catalogo/page.tsx` | La pantalla |
| `src/components/catalogo/grupos-de-opciones.tsx` | La lista y el interruptor |
| `tests/unit/repeticion-configurable.test.ts` | 6 pruebas sin base de datos |
| `tests/integration/permite-repeticion-crm.test.ts` | 5 pruebas contra Postgres real |

**Tocados**

| Archivo | Qué |
|---|---|
| `src/app/(app)/layout.tsx` | Calcula `optionGroupsEnabled` y se lo pasa al menú |
| `src/components/app-nav.tsx` | Entrada **Catálogo**, visible solo si el negocio tiene grupos |
| `scripts/repeticion.ts` | Deja de ser la vía principal (comentarios), usa la función compartida y cuenta **solo opciones disponibles**, como el CRM |
| `tests/integration/_db.ts` | Expone el módulo nuevo a las pruebas de integración |

**Documentación tocada** (§10 explica cada una)

`specs/001-vocero-core/contracts/api.md` · `CLAUDE.md` · `docs/korexia/00-INDICE.md` ·
`72` · `77` · `79` · `82` · `86` · `91` · `93`

**No se tocó nada** de `src/lib/db/schema.ts`, `drizzle/`, `src/server/orders/`
ni `src/server/ai/`. La columna ya existía y el validador ya leía la regla del
catálogo: este paso solo abre la puerta para escribirla.

---

## 3 · Qué se agregó en la API

```
GET   /api/catalogo/grupos        → { grupos: GrupoConfigurable[] }
PATCH /api/catalogo/grupos/[id]   → { grupo } | 404 | 422
```

`GrupoConfigurable` = `{ id, nombre, productoId, producto, minimo, maximo,
opciones, permiteRepeticion }`.

- **Filtrado por organización, siempre.** El `organizationId` sale de la sesión
  (`withAuth`), nunca del cliente, y toda consulta va con `scoped()`
  (Constitución III). El `UPDATE` lleva el `organization_id` en el `WHERE`: un
  id de otro cliente **no actualiza ninguna fila**.
- **Mismo 404 para "no existe" y para "es de otra organización"**: la respuesta
  no confirma la existencia de nada ajeno.
- **Solo `permiteRepeticion`.** El cuerpo es `z.object({…}).strict()`: un
  `minSelect`, un `maxSelect` o un precio de más responden **422**, no se
  ignoran en silencio.
- **Queda registrado.** `actualizarPermiteRepeticion` escribe a través de
  `conRegistro` (`proceso=crm:repeticion`, `actor=user:<id>`), que compara la
  **fila completa** antes y después: si esta operación tocara de paso cualquier
  otro campo, saldría marcado `[NO DECLARADO]` en el log. `product_option_group`
  ya estaba clasificado en `registro-de-cambios.ts` (regla 11), así que no hizo
  falta tocar nada allí.
- **Lectura para configurar ≠ lectura para el agente.** `queries.ts` sigue
  intacto: lee lo que el cliente puede pedir hoy. El listado del CRM muestra
  también los productos **no disponibles** (un "hoy no hay fresa" no debe
  esconder su configuración) y esconde los **archivados**. Cuenta las opciones
  **disponibles**, que es lo que ve el validador — contar una apagada diría
  "hay 4" mientras el agente ve 3.

---

## 4 · Qué se agregó en la UI

Pantalla nueva **Catálogo → Grupos de opciones** (`/catalogo`), agrupada por
producto. De cada grupo se ve:

```
CAJA GRANDE
  SALSA        mínimo 5 · máximo 5 · 4 opciones disponibles     [ Permite repetir ● ]
               ⚠ Sin repetir no se puede completar · pide hasta 5 y hay 4.
```

- **Producto, grupo, mínimo, máximo, cuántas opciones y el estado actual**, tal
  como pedía el alcance.
- **Un interruptor** (`role="switch"`, con `aria-checked` y etiqueta accesible)
  para alternar *permite repetir* sí/no. Se pinta **lo que devolvió el
  servidor**, no lo que se pidió.
- **El caso imposible se ve antes de que un cliente lo sufra**: cuando
  `maxSelect > opciones disponibles` el grupo se marca en ámbar, y arriba hay un
  resumen con cuántos grupos están en esa situación. Es el bug del Mega Box del
  16-ago convertido en aviso.
- **Textos genéricos**: "grupo de opciones", "permite repetir", "opciones
  disponibles". Ni una palabra de comida, ni de un cliente concreto.
- **El menú la ofrece a quien tiene grupos cargados**, no por vertical: una
  churrería, un salón y un taller entran por la misma puerta. Quien no tenga
  ninguno no ve una pantalla vacía en el menú (y si llega por URL, la pantalla se
  lo explica).

---

## 5 · Qué pruebas se agregaron o ajustaron

**Nuevas, sin base de datos** — `tests/unit/repeticion-configurable.test.ts` (6):

1. `repeticionObligatoria` con `max 5 / 4 opciones` → sí (el Mega Box).
2. Con opciones de sobra (`1/4`, `4/4`) → no.
3. Grupo **sin opciones** → no es un problema de repetición (el validador se
   salta los grupos vacíos; avisar ahí mandaría a arreglar lo que no es).
4. El aviso de la pantalla señala justo al grupo del caso.
5. **Apagado**: el pedido de 5 sobre 4 opciones se queda sin cerrar, con dudas y
   sin total.
6. **Encendido**: el mismo pedido se cierra, sin dudas, y cuesta lo mismo.

**Nuevas, contra Postgres real** — `tests/integration/permite-repeticion-crm.test.ts` (5):

1. El listado trae producto, grupo, mínimo, máximo y cuántas opciones hay.
2. **El cambio persiste y no toca nada más**: se compara la **fila completa**
   antes y después (regla de [68](68-UN-DUENO-POR-DATO.md)), no una lista de
   campos.
3. **`catalogoDePedidos` refleja el valor nuevo** en los dos sentidos, sin
   regenerar prompts ni nada.
4. 🔴 Una organización **no puede cambiar** el grupo de otra: devuelve `null` y
   la fila ajena queda intacta (verificado también con fila completa).
5. Una organización **tampoco lee** los grupos de la otra.

**Ajustadas: ninguna, a propósito.** Que `normalizarPedido` respete la regla ya
estaba probado por los dos lados en `tests/unit/tercer-vertical.test.ts`
(*"la repetición la declara cada grupo"*, 4 pruebas) y en el bloque *"las salsas
se pueden repetir"* de `normalizar-pedido.test.ts` (8). Duplicarlo habría sido
ruido; lo que faltaba —y es lo que se añadió— era atar **el valor que se guarda
desde el CRM** con el comportamiento del validador.

---

## 6 · Resultado de typecheck y tests

| Comando | Resultado |
|---|---|
| `corepack pnpm typecheck` | ✅ limpio |
| `corepack pnpm test` | ✅ **782 pruebas en verde**, 66 saltadas (9 archivos de integración), 85 archivos |
| `corepack pnpm lint` | ✅ limpio (no se pedía, se corrió igual) |
| `corepack pnpm build` | ✅ compila, con `/catalogo`, `/api/catalogo/grupos` y `/api/catalogo/grupos/[id]` en el listado de rutas |

### ⚠️ Las 5 pruebas de integración NO se ejecutaron aquí, y hay que decir por qué

Se saltan solas sin `TEST_DATABASE_URL`, y **en esta máquina no hay ninguna base
desechable**: no hay Docker instalado, y el único Postgres alcanzable es
`localhost:15433`, que es un **túnel SSH a producción**
(`ssh -L 15433:172.16.1.1:5433 root@2.25.159.117`).

Esas pruebas crean y borran organizaciones y vacían `rate_limit_hit`.
**Ejecutarlas contra ese puerto habría sido ejecutarlas contra el servidor
vivo**, así que no se hizo. Para correrlas hace falta una base desechable
(receta en [34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md)) y:

```bash
TEST_DATABASE_URL=postgres://…base-desechable… corepack pnpm test
```

Queda como **pendiente de verificación**: lo que demuestran esas 5 —aislamiento
entre organizaciones y persistencia— está escrito y revisado, pero **no
ejecutado**.

---

## 7 · Cómo revertir

Sin migraciones de por medio, revertir es borrar código:

1. `git revert <commit>` — o borrar los 8 archivos nuevos y deshacer los 4
   tocados.
2. **La base no se toca**: la columna `permite_repeticion` ya existía desde la
   migración `0023` y sigue igual. Los valores que alguien haya cambiado desde
   el CRM **se quedan como estén** (eso es un dato del negocio, no del código).
3. `scripts/repeticion.ts` sigue funcionando exactamente igual que antes: no se
   ha borrado, solo se ha degradado a respaldo en sus comentarios.

---

## 8 · Riesgos y decisiones pendientes

| | Qué | Detalle |
|---|---|---|
| 🟠 | **Las 5 pruebas de integración no se han ejecutado** | Ver arriba. Es lo primero que hay que hacer en una máquina con base desechable |
| 🟠 | **Una consulta más por página** | El menú necesita saber si el negocio tiene grupos, y eso se resuelve en el layout (`SELECT … LIMIT 1`, con índice por organización). Si algún día molesta, el sitio natural es cachearlo con el resto del contexto de sesión |
| 🟠 | **`scripts/repeticion.ts` sigue vivo** | Por decisión del alcance. Hace algo que el CRM todavía no: cambiar **en lote** todos los grupos que se llaman igual (las cuatro SALSAS de La Churra, en un comando). Borrarlo exige o cubrir el lote en la pantalla, o aceptar cuatro clics |
| 🟠 | **Quién puede cambiarlo** | Hoy, cualquier usuario autenticado de la organización (`withAuth`), igual que en Servicios y Personal. Si el proyecto quiere distinguir *propietario* de *miembro*, es una decisión de producto que afecta a todas las pantallas de configuración, no solo a esta |
| 🟢 | **El agente lo lee al vuelo** | El catálogo se renderiza fresco en cada turno: el cambio se nota en la siguiente conversación **sin regenerar el prompt ni desplegar** |
| 🟢 | **No se creó vocabulario nuevo en el núcleo** | La pantalla no sabe qué es una salsa ni un esmaltado |

**Fuera de alcance a propósito** (no se hizo, y se dice): crear y borrar grupos,
editar mínimos y máximos, cargar opciones desde el CRM, y grupos de opciones
para `service` — que es el paso 3B grande y **sí lleva migración con datos
vivos** ([82](82-EL-CATALOGO-AL-CRM.md)).

---

## 9 · Por qué esto acerca la meta

> *"Alta de nuevos negocios por configuración desde el CRM, sin tocar núcleo ni
> scripts."*

Antes de este cambio, montar un negocio cuyo grupo pidiera más opciones de las
que tiene —cualquier combo, cualquier caja, cualquier "elige 5 de 4"— **exigía
una persona con acceso SSH a producción** ejecutando `pnpm repeticion`. El
límite para escalar de 3 a 100 clientes nunca fue la máquina: es exactamente
esta clase de paso manual.

Lo que cambia:

1. **Una decisión de negocio deja de necesitar a un técnico.** La misma regla,
   la misma columna, el mismo registro de cambios — pero la toma quien lleva el
   negocio, desde su cuenta y filtrada por su organización.
2. **El núcleo no creció.** `normalizar.ts` no se tocó: ya leía la regla del
   catálogo. Este paso no añade comportamiento, añade **una puerta para
   configurarlo**.
3. **Nada es específico de un cliente.** Ni un nombre de grupo, ni un vertical,
   ni una lista. La pantalla se ofrece por lo que el negocio **tiene cargado**,
   no por lo que es.
4. **El error más caro del catálogo se ve antes de venderlo.** El grupo que no se
   puede completar sin repetir —el bug del Mega Box, que costó que el pedido más
   caro no se pudiera cerrar— ahora aparece marcado en pantalla en cuanto se
   carga el catálogo, en vez de descubrirse en una conversación real.
5. **Es el primer trozo del paso 3B**, y el que no tiene migración. Deja el
   camino hecho —módulo, API, pantalla y menú— para lo que venga después: los
   mínimos y máximos, las opciones, y los grupos de `service`.

---

## 10 · Documentación colateral

La regla de [75](75-COMO-SE-DOCUMENTA.md) dice que si el código y la
documentación difieren, **el que miente es el documento**. Estos decían que esta
casilla no existía:

| Documento | Qué decía | Qué dice ahora |
|---|---|---|
| `specs/001-vocero-core/contracts/api.md` | No listaba las rutas | `GET /api/catalogo/grupos` y `PATCH /api/catalogo/grupos/:id`, con el `.strict()` y el 404 por organización |
| `CLAUDE.md` | El mapa del código no tenía dónde vive el catálogo | Fila nueva: `server/catalog/` (lectura del agente en `queries.ts`, configuración en `grupos.ts`), `api/catalogo/`, `(app)/catalogo/` |
| [82](82-EL-CATALOGO-AL-CRM.md) | *"La pantalla de catálogo (que no existe)"* | Ya existe su primera pieza, y es **una sola para todos los verticales**; el reparto no lo decide el vertical sino qué tiene cargado el negocio |
| [79](79-ARQUITECTURA-MULTIEMPRESA.md) | La hoja de ruta saltaba de 3a a 3b | Paso **3a′** (la casilla en el CRM) ✅, y el 3b aclara que la pantalla ya existe: falta el modelo de `service` |
| [91](91-CATALOGO-DE-LA-CHURRA.md) | *"Existe porque el CRM todavía no tiene esa casilla […] el script sobra y se borra"* | Dónde se cambia (el CRM) y por qué el script sigue: **el cambio en lote** |
| [72](72-COMO-ENCENDER-LA-FASE-2.md) · [86](86-DOS-PRODUCTOS-EN-UN-PEDIDO.md) | La tarea 4.2 y el cambio 2 solo tenían el camino del `UPDATE`/script | Los dos caminos, con el del CRM primero |
| [93](93-PENDIENTES-17AGO.md) | Deuda *"el CRM no tiene casilla"*; comandos útiles | Deuda **a medias** (falta el resto del catálogo y `service`); `pnpm repeticion` marcado como "ver" y el cambio, por el CRM |
| [77](77-EL-MODELO-DE-LAS-OPCIONES.md) | *"Qué haría falta (no implementado)"* — describía la `seleccion` con `grupoId`/`opcionId` como pendiente | Anotado que **ya se hizo** el 17-ago ([89](89-EL-CONTRATO-DE-LOS-ITEMS.md)). No es de este cambio, pero era una mentira viva del mismo tema |
| [00-INDICE.md](00-INDICE.md) | — | Entrada de este documento |

**Lo que NO se tocó y podría parecer que sí**: `specs/001-vocero-core/data-model.md`
no describe `product_option_group` (es del núcleo original, anterior a las tablas
del catálogo), así que no había nada que corregir allí.
