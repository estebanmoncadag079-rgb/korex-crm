# Cargar el catálogo de un negocio de citas

> **Dentro:** El hueco · Por qué nadie lo vio · Las tres puertas · El PDF, que
> era el caso real · La duración manda en la agenda · Qué se puede pegar

13-ago-2026. *"¿Por qué en el salón no está la opción de subir el catálogo?"*
La respuesta corta: porque no existía.

## El hueco

Un negocio de **pedidos** podía cargar su carta en el alta —escribiéndola o
subiendo una foto que lee el modelo de visión—. Un negocio de **citas**, no:

- El asistente de configuración **ocultaba la etapa "Lo que vendes"** cuando el
  vertical era `citas`, con este comentario: *"ahí los servicios se cargan con
  sus duraciones desde la pantalla de Servicios"*.
- Y la pantalla de Servicios solo permitía darlos de alta **de uno en uno**:
  nombre, precio, duración y categoría, servicio por servicio.

El salón tiene **46 servicios**. Nadie termina eso. Y nadie se lo decía: el alta
saltaba el paso en silencio y el cliente acababa con un asistente que no sabía
qué ofrecía ni a qué precio.

> Lo irónico: **la pieza difícil ya estaba construida**. `extraer-catalogo.ts`
> —el lector de cartas por foto— ya soportaba `duracionMin` y `categoria`, y su
> comentario dice literalmente *"el salón de lashes tiene más de 34 servicios"*.
> Se escribió pensando en este caso y nunca se conectó a su vertical.

## Por qué nadie lo vio

Porque el catálogo del salón **estaba cargado**: los 46 servicios entraron por
SQL cuando se preparó la demo ([32-CATALOGO-SALON.md](32-CATALOGO-SALON.md)). El
agente daba precios exactos en cada prueba, así que nada parecía roto. El hueco
solo aparece cuando entra un cliente **nuevo** de citas… que es justo lo que
esto tiene que soportar.

## Las tres puertas, una sola revisión

Ahora hay tres caminos, y los tres terminan en la **misma tabla de revisión**:

| Camino | Cómo |
|---|---|
| **Pegar la lista** | La que ya tiene escrita: de su cuaderno, de un WhatsApp. La lee `lib/catalogo-texto.ts`, sin IA y sin coste |
| **PDF** | Se abre en el NAVEGADOR, se saca su texto y ese texto lo interpreta el modelo |
| **Foto de la carta** | La lee el modelo de visión, reutilizando `extraer-catalogo.ts` |

De ahí sale una tabla editable —nombre, categoría, precio, minutos— con los
avisos de cuántos vienen **sin precio** y cuántos **sin duración**, y un
"aplicar esta duración a todos" para no teclear 46 veces lo mismo.

> 🛑 **Nada se guarda hasta que alguien lo revisa.** Es la regla que dejó el
> incidente de los **12 precios equivocados** que nadie detectó durante meses.
> Ni la foto ni la lista pegada escriben una fila por su cuenta.

Está en **la pantalla de Servicios** (arriba y a todo lo ancho, porque es lo
primero que necesita un salón nuevo) y en **el alta**: el asistente ya no oculta
el paso, muestra "Tus servicios" y al aplicar la ficha los crea.

## El PDF, que era el caso real

El catálogo de Lashen Valen es **un PDF de 36 MB y diez páginas**, y el
importador solo aceptaba imágenes. Decirle a un cliente *"tómale una foto a tu
catálogo de diez páginas"* no es una respuesta.

**Se abre en el navegador**, no en el servidor: subir 36 MB para leer diez
páginas de texto sería absurdo, y así el documento del negocio no sale de su
computador. Medido con el archivo real: **del PDF de 36 MB viajan 2,9 KB** de
texto.

> 🔑 **Y su texto NO se puede leer línea a línea.** Un catálogo de verdad viene
> maquetado: el nombre del servicio, su descripción y su precio están en
> renglones distintos.
>
> ```
> EFECTO NATURAL
> Realza tu mirada con un
> acabado suave, ligero y elegante.
> 95.000$
> ```
>
> Pasarlo por el parser de listas daba **108 "servicios"** sacados de las
> descripciones. El texto sale exacto del PDF —sin OCR de por medio—, así que lo
> único que falta es entender la maquetación: eso lo hace el modelo
> (`extraerCatalogoDeTexto`), y sobre texto cuesta mucho menos que sobre imagen.

Probado con el PDF real: **34 servicios**, con sus categorías (Pestañas pelo a
pelo, Volumen tecnológico, Efectos modernos, Retoques, Labios) y sus precios
correctos, contrastados contra los que ya tenía la base.

Si el PDF es un **escaneo** (una foto dentro de un PDF, sin capa de texto), se
rasteriza su primera página y se manda al lector de imágenes de siempre.

**Detalles de implementación** que conviene no repetir:

- `pdfjs-dist` se carga con `import()` dinámico: es grande y casi nadie sube un
  PDF, así que no debe pesar en la primera carga.
- Su worker lo copia `prebuild` desde `node_modules` a `public/` en cada build
  (`scripts/copiar-worker-pdf.mjs`), en vez de versionar 1,2 MB. Un worker
  desparejado de la librería falla en tiempo de ejecución y solo en el navegador
  del cliente — el peor sitio para enterarse.
- `public/**` se excluyó de eslint: el worker minificado disparaba 1.576 avisos
  sobre código que no es nuestro.

## La duración manda en la agenda

`durationMin` es obligatoria y **no tiene valor por defecto silencioso**. De ella
depende que no se crucen dos citas: un servicio de 3 horas cargado como "30
minutos" no da error en ninguna parte — simplemente hace que el salón acepte
tres clientas a la misma hora.

El orden es: la duración escrita en la línea (`180 min`) manda; si no la trae,
la **duración típica** que el cliente indicó en el alta; y si tampoco, no se
guarda y la tabla lo marca en ámbar.

El motor ya respetaba las duraciones distintas —bloquea por solape real contra
`ends_at`—; lo que faltaba era poder **cargarlas**.

## Qué se puede pegar

`leerCatalogoPegado` acepta lo que la gente escribe de verdad:

```
PESTAÑAS
Volumen ruso — $150.000 · 180 min
Lifting de pestañas $80.000 (60 minutos)

CEJAS
Cejas en henna - 30000 - 45min
```

- Los títulos en MAYÚSCULAS o con dos puntos se guardan como **categoría**.
- La duración se busca **antes** que el precio: si no, "45 min" acabaría de
  precio en un servicio que no lo lleva.
- Lo que no entienda queda en `null` para que la persona lo complete — nunca lo
  inventa.
- Ante la duda, una línea es **servicio** y no encabezado: sobra en la tabla y
  se quita de un clic, mientras que un servicio tragado como título desaparece
  sin que nadie lo note. ("Manicure semipermanente" son dos palabras y es un
  servicio.)
