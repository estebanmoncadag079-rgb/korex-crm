# 178 · La foto que no era solo del producto

**19-sep-2026** · Feature: imagen de producto en el catálogo (migraciones
`0043_imagen_del_producto` y `0044_imagen_del_producto_on_delete`).

---

## Qué se construyó

Hasta ahora, la foto de un producto y el producto solo se conocían **por
texto**: `media_asset.etiqueta` contra `product.name`, comparados con
tolerancia (`elegirFoto`, `server/ai/fotos.ts`). Funcionaba mientras nadie
renombrara nada.

Ahora hay una relación real: `media_asset.product_id`, con FK compuesta
`(organization_id, product_id) → product(organization_id, id)`. Y en
`/catalogo`, cada producto tiene su recuadro para subir, reemplazar y quitar
su imagen.

La resolución quedó en dos prioridades (`resolverFoto`):

1. **Por `product_id`** — si lo que pide el cliente resuelve a UN producto
   real del catálogo (el mismo buscador que ya usa `consultar_producto`), y
   ese producto tiene imagen, es esa. Aunque la etiqueta diga otra cosa.
2. **Por `etiqueta`** — el comportamiento histórico, para la carta, las fotos
   del local y los productos todavía sin vincular.

Lo que **no** cambió: el agente sigue mandando fotos solo bajo demanda
(`send_image`), nunca por su cuenta. Esta pantalla configura *cuál* es la
imagen; el agente decide *cuándo*.

---

## El defecto que encontró la auditoría independiente

Dos, en realidad, y los dos del mismo tipo: código que parecía correcto
leyéndolo y que en PostgreSQL real hacía otra cosa.

### 1 · `ON DELETE SET NULL` no hacía lo que decía

La 0043 escribió la FK así:

```sql
FOREIGN KEY ("organization_id","product_id")
  REFERENCES "product"("organization_id","id")
  ON DELETE set null
```

En PostgreSQL, `ON DELETE SET NULL` **sin lista de columnas anula TODAS las
columnas de la FK** — incluida `organization_id`, que es `NOT NULL`. Borrar un
producto habría reventado la transacción entera.

Y el camino era alcanzable hoy: `DELETE /api/admin/clients/[id]`
(`src/app/api/admin/clients/[id]/route.ts:167`) borra la organización →
cascada a `product` → conflicto. Falla cerrando (no filtra ni corrompe nada),
pero bloqueaba una operación legítima del panel de agencia.

**Corregido en la 0044** con la sintaxis de PostgreSQL 15+:
`ON DELETE SET NULL ("product_id")`. La documentación oficial de PostgreSQL 16
usa este caso exacto como ejemplo — una FK compuesta multi-tenant donde la
columna del tenant debe seguir poblada.

⚠️ **Drizzle no sabe expresar la lista de columnas.** `schema.ts` dice
`.onDelete("set null")` a secas, y la autoridad sobre la semántica real es la
migración 0044. Está anotado en el comentario de `mediaAsset.productId`. Si
algún día se regenera el esquema con `db:generate`, hay que volver a aplicarlo
a mano.

### 2 · «Eliminar la imagen» destruía un recurso compartido

`media_asset` **no es privado del catálogo**. La misma fila puede ser, a la
vez:

| Quién la usa | Cómo | ¿La protege la base? |
|---|---|---|
| Un producto del catálogo | `media_asset.product_id` | Sí (FK, desde la 0043) |
| Una campaña | `campaign.media_asset_id` | Sí, FK con `SET NULL` — pero la campaña se queda sin imagen en silencio |
| Una plantilla de WhatsApp | `template.components.header.mediaAssetId` | **No. Es JSONB, sin FK. Nadie la protege** |
| El snapshot de una campaña | `campaign.template_snapshot.components.header` | **No. Ídem** |

El botón "Eliminar" de `/catalogo` hacía un `DELETE` físico de la fila. Con una
plantilla aprobada usándola como header, el resultado es que
`resolverAssetDeHeaderImagen` (`server/whatsapp/templates.ts:511`) devuelve
*"El asset de header no existe en esta organización"* en cada envío: la
plantilla deja de funcionar. Y el archivo **no se puede recuperar** — vive en
la base en base64, no hay copia en ningún otro sitio (Constitución II: sin
S3/R2).

**Corregido**: «quitar la imagen del producto» ahora significa *romper el
vínculo*, no necesariamente destruir el archivo.

- **Nadie más la usa** → se borra de verdad. Es el caso normal y no se acumula
  basura.
- **Alguien más la usa** → se desvincula y se conserva. El producto se queda
  sin imagen (que es lo que se pidió) y la campaña o la plantilla siguen
  funcionando. La respuesta dice cuáles son, y la pantalla lo muestra en vez de
  decir "eliminada", que no sería cierto.

---

## Por qué desvincular son TRES cambios y no uno

`desvincularMediaAssetDeProducto` (`server/media/assets.ts`) escribe:

```
product_id = NULL
kind       = 'otro'
etiqueta   = '<etiqueta> (sin producto · <id>)'
```

Poner solo `product_id = NULL` habría dejado dos agujeros:

1. **La imagen volvía por la puerta de atrás.** La tercera pasada de
   `elegirFoto` es "una contiene a la otra", así que preguntar por «Amor y
   Amistad» seguiría alcanzando la foto recién quitada. Por eso además se
   demota a `kind: 'otro'` **y** `resolverFoto` limita el respaldo por texto a
   recursos `kind: 'producto'` cuando lo que se pregunta SÍ es un producto real
   del catálogo. Preguntar por la carta o por el local sigue funcionando igual
   que siempre, sin filtrar.
2. **El negocio no podía volver a subirle imagen a ese producto.**
   `media_org_etiqueta_uq` es UNIQUE sobre `(organization_id, etiqueta)`: con
   el nombre del producto ocupado por el recurso conservado, la siguiente
   subida o reventaba por el índice único, o lo reclamaba por etiqueta y
   **pisaba la imagen que la campaña estaba usando**. El sufijo lleva el id del
   recurso porque es lo único único por definición — uno con la fecha
   colisionaría al desvincular dos veces el mismo día.

---

## Y dos más del mismo tipo: reclamar por etiqueta

`guardarMediaAsset`, al recibir `productId`, podía "reclamar" una fila que ya
tuviera esa etiqueta (para adoptar fotos subidas por el camino viejo, sin
duplicar la fila). Pero no miraba **qué** estaba reclamando. Dos formas de
perder un archivo, las dos silenciosas:

1. **Se apropiaba de un recurso de otra naturaleza.** Si el negocio tenía un
   producto llamado igual que su carta, subirle imagen al producto convertía la
   carta en esa imagen — mismo id, `kind` pisado, el PDF reemplazado por un JPG.
2. **Le robaba la imagen a otro producto.** `product` **no** tiene índice único
   sobre `(organization_id, name)`: dos productos pueden llamarse igual.
   Subirle imagen al segundo reapuntaba el `product_id` de la fila del primero,
   que se quedaba sin ninguna.

Este segundo lo encontré auditando mi propia corrección del primero — es el
mismo error de fondo (la `etiqueta` es texto escrito a mano, no identidad) mirado
desde otro ángulo.

Ahora la reclamación solo vale sobre un recurso **huérfano** (`product_id IS
NULL`) y de tipo **`producto`**. En cualquier otro caso la operación se corta
con `etiqueta_ocupada` (409) y un mensaje que dice qué estorba y cómo
desatascarlo. Sin `productId` (el camino histórico de `POST /api/media`) no hay
ninguna restricción nueva.

---

## Cómo revertir

1. **La base**: `ALTER TABLE media_asset DROP CONSTRAINT media_asset_product_fk;`
   y, si se quiere volver al estado pre-feature, `DROP COLUMN product_id`. Los
   archivos siguen ahí: `product_id` es aditivo, nada de lo que existía se
   movió.
2. **El código**: revertir el commit. Sin `product_id`, `resolverFoto` cae
   entera a la Prioridad 2 y el comportamiento vuelve a ser el histórico
   (resolución solo por etiqueta).
3. **Los datos**: ninguna migración de datos automática. El script
   `scripts/diagnostico-imagenes-producto.ts` es de SOLO LECTURA — lista qué
   recursos `kind='producto'` sin vincular tienen un candidato claro en el
   catálogo, y no vincula nada. Vincular es una decisión humana.

---

## Las pruebas: cuáles son reales y cuáles no

Distinción que importa, porque una unitaria con mocks **no puede** ver lo que
aquí se corrigió:

| | Cuántas | Estado |
|---|---|---|
| **Unitarias** (`tests/unit/`, con mocks de Drizzle) | 34 sobre esta feature | ✅ verde |
| **Integración PostgreSQL** (`tests/integration/imagen-de-producto.test.ts`) | 17 | ✅ **verde contra PostgreSQL 16.14 real** |

Las 17 de integración son las que demuestran lo que las unitarias **no
pueden**: un mock de Drizzle no ejecuta ninguna acción referencial, así que
habría dado verde con la restricción rota exactamente igual que con la
corregida. Cubren:

- borrar el producto → `organization_id` INTACTO, `product_id` a NULL, el
  archivo vivo;
- borrar la organización entera → no falla (el camino real de `/admin`);
- la FK compuesta rechaza en la base un recurso apuntando al producto de otra
  organización;
- recurso compartido con una campaña → se conserva; con una plantilla → se
  conserva; exclusivo → se borra;
- dos productos homónimos no se apropian del mismo recurso;
- el 409 no deja nada escrito a medias (se compara la fila entera antes y
  después, y el conteo de filas);
- la imagen desvinculada no vuelve por el respaldo de texto.

### Cómo se validaron (19-sep-2026)

Contra un **contenedor PostgreSQL 16.14 desechable, aparte del de producción**,
levantado en el VPS con `docker run --name vocero-test-pg -p 127.0.0.1:5440:5432
postgres:16-alpine` (misma imagen que producción, motor y volumen distintos,
solo loopback), alcanzado por túnel SSH `-L 5440:127.0.0.1:5440`. Las 45
migraciones se aplicaron ahí con `drizzle-kit migrate`, y el contenedor se
eliminó al terminar.

**Nunca se conectó a la base de producción.** La versión de producción (16.14)
se obtuvo de `docker exec korex-crm-postgres-1 postgres --version`, que lee el
binario sin abrir ninguna conexión.

Lo que quedó registrado del catálogo del sistema de la base de pruebas, ya
migrada:

```
FOREIGN KEY (organization_id, product_id) REFERENCES product(organization_id, id)
  ON DELETE SET NULL (product_id)
SET NULL solo sobre : product_id
organization_id nullable : NO
```

## Versión de PostgreSQL: verificada

**Producción corre PostgreSQL 16.14** (contenedor `korex-crm-postgres-1`,
imagen `postgres:16-alpine`, en el VPS `2.25.159.117`, escuchando solo en
`172.16.1.1:5433` dentro de la red de Docker). Comprobado el 19-sep-2026 por
`docker exec ... postgres --version`, sin conectar a la base.

16.14 ≥ 15, así que `ON DELETE SET NULL (product_id)` **está soportado** y la
0044 es válida contra ese servidor. Era la condición que bloqueaba la feature.

Dato de infraestructura que conviene recordar: **no hay ningún otro PostgreSQL
en el VPS** — ni binarios en el host, ni servicio systemd, ni contenedores
parados. No existe entorno de staging.

## Lo que sigue sin verificar

- **La 0043 y la 0044 no se han aplicado a la base de PRODUCCIÓN.** Se
  aplicaron y se probaron contra el contenedor desechable. En producción entran
  solas al arrancar el contenedor nuevo (`migrate.mjs`), en el despliegue.
- **`verificarEsquemaListo` (`scripts/migrate.mjs`) compara COLUMNAS, no
  restricciones.** Si por lo que sea la 0044 se saltara, el arranque no lo
  detectaría: `product_id` ya existe desde la 0043. La protección contra
  migraciones saltadas por timestamp invertido (doc 166) sí aplica — el `when`
  de la 0044 es mayor que el de la 0043.

## Hallazgos preexistentes, fuera de esta corrección

**1 · `DELETE /api/media` no comprueba referencias.** El botón "Eliminar" de la
pantalla de **Recursos** (no la del catálogo) sigue haciendo un borrado físico
sin mirar quién usa el archivo. Ahí la intención del negocio sí es "destruir
este recurso", así que no es el mismo defecto — pero una plantilla que lo usara
como header quedaría igual de rota. Existía antes de esta feature y no se tocó.

**2 · Los adjuntos que envían los clientes no se ven en la bandeja.**
Encontrado al enumerar todas las referencias a un `media_asset`.
`src/components/inbox/message-thread.tsx` (102, 109, 122) pide
`/api/media/${m.id}` pasando el id de un **mensaje**, pero esa ruta consulta
solo `media_asset` — y el ingest de mensajes nunca inserta ahí (los únicos
insertores son `guardarMediaAsset` y `scripts/subir-media.ts`). `message.media_id`
es el id del **proveedor**, no de esta tabla. Resultado: 404 siempre, y los
comprobantes de pago que manda un cliente no se ven. Tiene impacto real —
La Churra y Lis reciben comprobantes por WhatsApp.

Ojo al arreglarlo: `/api/media/[id]` es **pública sin sesión** a propósito
(Meta descarga las fotos salientes desde sus servidores), así que los adjuntos
de clientes no pueden servirse por ahí. Necesitan una ruta autenticada y
`scoped()`.

## Enumeración completa de referencias a un `media_asset`

Para que la próxima persona no tenga que volver a buscarlas:

| Referencia | Tipo | ¿Protegida? | ¿Contemplada al borrar? |
|---|---|---|---|
| `media_asset.product_id` | FK compuesta | Sí (0043 + 0044) | Es el sujeto de la operación |
| `campaign.media_asset_id` | FK real (`0031`, SET NULL) | Sí | ✅ |
| `template.components.header.mediaAssetId` | JSONB, sin FK | **No** | ✅ |
| `campaign.template_snapshot.components.header.mediaAssetId` | JSONB, sin FK | **No** | ✅ |
| `fotos.ts` / `/api/media/[id]` / `urlPublicaDeFoto` | resolución en el momento | n/a | No hace falta: si no existe, degrada |

Falso positivo descartado: `message.media_id` y `message.media_url` son del
proveedor de WhatsApp, no de esta tabla (`schema.ts:410-416`).
