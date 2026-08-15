# El catálogo de pedidos vive en tablas

> **Dentro:** Qué cambia · Cómo migrar un cliente, paso a paso · El rollback ·
> Las cuatro trampas · Qué pasa con quien no tenga ficha · Lo que NO cubre
> todavía

**15-ago-2026, Fase 1.** El menú de un negocio de pedidos deja de vivir como
texto dentro del prompt y pasa a `product`. Es lo mismo que se hizo con citas el
13-ago ([58-EL-CATALOGO-VIVE-EN-SERVICIOS.md](58-EL-CATALOGO-VIVE-EN-SERVICIOS.md)),
aplicado al otro vertical.

## Qué cambia

| | Antes | Ahora |
|---|---|---|
| Dónde vive el menú | Texto en `agent_profile.instructions` | Filas en `product` |
| Cambiar un precio | Editar la ficha y **regenerar el prompt** | Un `UPDATE` de una fila |
| Copias del mismo dato | Ficha + prompt (y la primera se queda vieja) | Una |
| Cuándo lo ve el agente | Cuando alguien regenera | En cada turno, fresco |

El prompt de La Churra bajó **510 caracteres** al salirle el catálogo. No es
mucho en sí: lo que importa es que **el dato dejó de estar en dos sitios**.

## Cómo migrar un cliente, paso a paso

```bash
# 1. VER lo que se entendió de su ficha. NO escribe nada.
pnpm migrar:catalogo <organizationId>

# 2. Si la lista está bien, escribir las filas. Sigue sin usarlas el agente.
pnpm migrar:catalogo <organizationId> --aplicar

# 3. Decirle al agente que las use.
pnpm migrar:catalogo <organizationId> --encender
```

Los tres pasos están separados **a propósito**: escribir filas y usarlas son
decisiones distintas, y entre una y otra va la única parte que no puede
automatizarse — que una persona mire los precios.

> 🔴 **El paso 1 no es opcional.** En el catálogo del salón se colaron **12
> precios equivocados** que nadie revisó
> ([32-CATALOGO-SALON.md](32-CATALOGO-SALON.md)), y un precio mal en una tabla
> se repite en cada conversación durante meses. En La Churra, el paso 1 cazó que
> **cada presentación lleva distinta cantidad de salsas** — algo que el primer
> lector se estaba comiendo.

## El rollback

```bash
pnpm migrar:catalogo <organizationId> --apagar
```

Vuelve a `catalog_source = 'prompt'`. **Sin desplegar, sin perder nada**: el
texto original nunca se borra de la ficha, y las filas se quedan ahí por si se
quiere volver a intentar.

Además hay una red automática: si la bandera dice `'tabla'` pero el catálogo
está vacío, el pipeline **cae solo** al comportamiento viejo y deja un aviso en
el log. Una migración a medias no puede dejar al agente vendiendo una carta en
blanco.

## Las cuatro trampas (todas encontradas al hacerlo)

### 1. La migración generada quería recrear una columna existente

`drizzle-kit generate` propuso `ADD COLUMN "ficha"`, que **ya existe** desde la
0019 — escrita a mano y nunca reflejada en el snapshot. Aplicarla habría fallado
a media migración con *"column already exists"*.

**Regla**: leer siempre el SQL generado antes de aplicarlo. Si el proyecto tiene
migraciones escritas a mano, el diff miente.

### 2. Las FK compuestas necesitan su índice ANTES

drizzle-kit pone los `CREATE INDEX` al final, después de las `FOREIGN KEY`.
Con FK compuestas eso revienta:

```
there is no unique constraint matching given keys for referenced table
```

Hubo que reordenar el archivo a mano. Está anotado dentro del propio SQL para
quien lo regenere.

### 3. El formato de la ficha no es el que uno espera

El catálogo real de La Churra no era una lista limpia, sino:

```
CHURRITA — $10.000-1 salsa a eleccion entre chocolate negro,arequipe,lechera
BESTIES — $20.000- 2 salsa a eleccion entre chocolate negro,arequipe,lechera
```

De ahí salen tres datos: el producto, **cuántas** elige y de qué lista. Ese
número cambia por presentación (1, 2, 3 y 5), así que **un grupo de opciones
global no vale**: los grupos cuelgan de cada producto.

Ofrecerle cinco salsas a una Churrita es un pedido mal tomado.

### 4. Deduplicar grupos se come la cantidad

El primer render agrupaba las opciones iguales para no repetirlas… y con ello
perdía el *"elige 2"*, *"elige 5"*. Ahora la cantidad va **pegada a cada
producto** y la lista de opciones una sola vez:

```
CHURRITA — $10.000 (elige 1 salsa)
MEGA BOX — $50.000 (elige 5 salsas)

**Opciones que elige el cliente:**
SALSA: chocolate negro · arequipe · lechera · chocolate blanco
```

## Decisiones del modelo de datos

- **Tabla propia, no `service`.** `service.durationMin` es NOT NULL y no
  significa nada para un churro, y arrastra el acoplamiento con la restricción de
  solape de citas y con `staff_service`.
- **`price_cents` NULLABLE**, al revés que en `service`. *"No lo escribió"* no es
  *"vale 0"*: si la carta no trae el precio, el agente lo pregunta en vez de
  regalarlo. El render lo dice explícitamente.
- **`price_delta_cents` cubre tamaños y adiciones con el mismo mecanismo**: una
  salsa incluida va a 0, un queso extra a +2.000.
- **FK compuestas `(organization_id, id)`**: el motor impide colgar una opción de
  un producto de otra organización. Ya hubo una fuga entre clientes por un
  `WHERE` sin `organization_id` ([10-SEGURIDAD.md](10-SEGURIDAD.md)); esto no
  depende de que nadie se acuerde de filtrar. Hay una prueba que lo verifica.
- **Sin índice GIN ni nada sobre el interior**: el pipeline solo pide "el
  catálogo de esta organización", tres consultas planas que se ensamblan en
  memoria. Sin N+1.

## Qué pasa con quien no tenga ficha

`pnpm migrar:catalogo` lee de `agent_profile.ficha`. **Lis no la tiene** (su
prompt es manual, a propósito), así que el script se niega y lo dice:

```
⛔ este negocio no tiene ficha guardada (prompt manual):
   su catálogo hay que cargarlo a mano.
```

Para ella habrá que cargar los productos por otra vía cuando le llegue el turno
—que es el último, y solo con la fase ya validada.

## Verificado dentro del contenedor (15-ago, 13:52 UTC)

Hasta este despliegue la Fase 1 estaba en la base y en la carpeta de EasyPanel,
pero **no en el contenedor en ejecución**: el que corría se había construido a
las 04:57 UTC, horas antes del commit. La base decía `catalog_source = 'tabla'`
y el código vivo no sabía leerlo. No se notó porque el prompt seguía llevando la
carta escrita a mano — el fallo era invisible desde fuera.

Lo comprobado tras pulsar Desplegar:

| Qué | Cómo se comprobó |
|---|---|
| El código está **dentro** | `catalog_source` y `product_option_group` aparecen en los chunks de `/app/.next` |
| La 0020 no se reaplicó | El registro sigue en id 22, sin una 23. Drizzle decide por *timestamp* (`folderMillis` vs `created_at`), no por hash — por eso el CRLF que `git archive` mete en Windows es inofensivo, y hay precedente: la 0019 lleva desde su despliegue un hash en disco distinto del registrado |
| El agente recibe la carta | Se llamó a `catalogoDePedidos()` + `renderCatalogoDePedidos()` contra los datos reales: 4 productos, precios correctos y el "elige N" distinto por presentación |
| Nada se rompió | Arranque sin errores, sin el aviso de catálogo vacío, `korexia.online` en 200 |

> 🔑 **La lección, otra vez**: un contenedor `healthy` no prueba que lleve el
> cambio, y una bandera encendida en la base tampoco. Lo único que lo prueba es
> mirar dentro.

## Dónde quedan los precios hoy (y la duplicación que sí existe)

Tras el despliegue se sospechó que la carta quedaba **duplicada** —una vez en el
prompt y otra desde las tablas—, y se planteó regenerar los prompts para
quitarla. **El ensayo lo desmintió**: `generarPerfil` devuelve exactamente el
mismo texto que ya está guardado, así que regenerar no escribiría nada. La
sección `## Lo que vendes` **ya había salido** del prompt al encender la bandera.

Lo que sí queda escrito a mano son los precios **dentro del primer mensaje**,
que vive en las *Reglas propias de este negocio* de la ficha:

```
🥨 Churrita — $10.000 (6 churros · 1 salsa)
🥨 Besties — $20.000 (14 churros · 2 salsas)
```

Es texto libre del negocio, no lo emite el generador, y por eso **ningún
regenerado lo toca**. Hoy un precio vive en dos sitios: la fila de `product` y
ese saludo. Quitarlo de ahí —que el saludo se arme con el catálogo en vez de
repetirlo— es lo que dejaría **todo precio en una sola fila**. Queda anotado
como mejora, en [65-PENDIENTES-15AGO.md](65-PENDIENTES-15AGO.md).

## Lo que NO cubre todavía

- **No hay pantalla.** Se migra por línea de comandos. Un cliente no puede
  cambiar su propio precio todavía; eso es lo siguiente que hace falta para que
  esto sirva de verdad al alta.
- **El banco de escenarios no vale para probarlo.** Está escrito con los
  productos de Lis, así que contra La Churra da 14 falsos negativos (*"el precio
  del Cremoso 12 oz"*, *"Lis NO acepta efectivo"*). Si La Churra va a ser el
  laboratorio de las fases siguientes, **necesita su propio banco**.
- **El total lo sigue sumando el modelo.** Que los precios estén en tabla es lo
  que permitiría que lo calcule el servidor, pero eso es la Fase 2.

## Estado

| Cliente | `catalog_source` | Productos |
|---|---|---|
| **La Churra** | `tabla` | 4 |
| Lis Pastelería | `prompt` | — |
| Lashes Valen | `prompt` (es de citas) | — |
| korex.ia | `prompt` | — |
