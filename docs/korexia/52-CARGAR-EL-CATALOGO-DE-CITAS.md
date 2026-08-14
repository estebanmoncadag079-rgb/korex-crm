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

### El alta se quedó atrás medio día

La primera versión conectó el PDF **solo a la pantalla de Servicios**. En el
alta, el lector seguía con `accept="image/*"`: al cliente que llegaba con su
catálogo en PDF el selector de archivos ni se lo dejaba elegir, y la ayuda le
decía *"sube la foto de tu lista"*. Se vio en cuanto alguien intentó dar de alta
a Lashen Valen — que es exactamente el caso para el que se construyó todo esto.

Peor que eso, y silencioso: al pulsar **"Usar esta lista"** el alta rehacía el
texto como `nombre — $precio` y **tiraba los minutos y las categorías** que el
modelo acababa de leer. Los servicios entraban todos con la duración típica; un
volumen ruso de 180 minutos quedaba de 60 sin que nada lo avisara.

Ahora el alta usa el `texto` que ya arma el servidor (`catalogoATexto`), que
conserva ambas cosas: los minutos en la línea y la categoría como título en
MAYÚSCULAS — que es justo lo que `leerCatalogoPegado` vuelve a leer al aplicar
la ficha. El viaje completo (PDF → ficha → servicios creados) está cubierto por
una prueba de ida y vuelta, porque el fallo no estaba en ninguna de las dos
piezas sino en la costura entre ellas.

Y en la etapa de citas la lista de revisión marca **cuántos vienen sin
duración**, con el mismo criterio que en Servicios: en un negocio de citas la
duración no es un adorno.

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

## Decisión: en citas, el catálogo vive SOLO en Servicios

13-ago, al final del día. *"En el salón quitamos el apartado del catálogo del
alta y lo dejamos solo en Servicios: lo estamos subiendo dos veces."*

Es la decisión correcta, y el código ya apuntaba a ella: `generar.ts:53`
**excluye a propósito** el catálogo del prompt en el vertical de citas, porque
sus servicios viven en la tabla `service` con su duración y con quién atiende
cada uno. Pedirlos también en el alta creaba una segunda copia que empezaba a
quedarse vieja el mismo día.

Qué cambia:

- El alta de un negocio de **citas** ya no muestra la etapa "Tus servicios"
  (los de **pedidos** siguen con "Lo que vendes", donde el catálogo SÍ va en el
  prompt).
- `aplicarFicha` ya no crea servicios. Se fue con ella el `serviciosCreados`
  del resultado.
- Al terminar el alta, un negocio de citas ve un aviso en ámbar: **falta cargar
  tus servicios, y se hace en la pantalla de Servicios**. Sin ese aviso
  volveríamos al fallo original —terminar la configuración creyendo que ya está
  todo—, que era silencioso y por eso duró tanto.

Lo de abajo (la comparación, el reparto entre especialistas, el aviso de los
que no atiende nadie) sigue igual: es justo lo que hace que Servicios se baste
solo.

## Las dos mitades que no se hablaban

13-ago, más tarde. *"¿De qué sirve que la clienta elimine un servicio o lo
agregue y no aparezca en estas casillas?"*

La lista de servicios se escribe en un sitio —el alta, el generador de
prompts— y se usa en otro: la pantalla de Servicios, donde se marca **quién
atiende cada cosa**. No se hablaban:

- Añadir un servicio a la lista **no creaba nada** si el negocio ya tenía
  catálogo (la protección contra duplicar los 46 lo bloqueaba todo, no solo lo
  repetido). No aparecía en las casillas de las especialistas, y lo que nadie
  atiende **no se puede agendar**.
- Quitarlo de la lista no lo retiraba: se seguía ofreciendo.

La lista parecía la fuente de verdad y no lo era. Ahora:

| Dónde | Qué hace |
|---|---|
| **Aplicar la ficha** (alta/generador) | Crea **lo que falta**, compara por nombre normalizado. No duplica, no pisa precios afinados a mano, y **nunca archiva** |
| **Servicios → Cargar catálogo** | Compara y muestra el diff: nuevos, cambios de precio/duración, y los que ya no están |

En el diff, cada servicio nuevo trae **las casillas de las especialistas ahí
mismo** —marcar quién lo atiende sin ir persona por persona— y avisa en ámbar
si queda sin nadie, porque entonces existirá en el catálogo pero no se podrá
agendar.

> 🛑 **Añadir es automático; quitar y cambiar precios, no.** Retirar un servicio
> afecta a citas ya agendadas, y un precio distinto es dinero: se marcan a mano
> y se archivan (nunca se borran, para que el historial siga teniendo sentido).

Dos trampas que costaron sangre y quedaron cubiertas con pruebas:

- **Un hueco no es un cambio.** Si la línea no trae precio o no trae minutos, se
  conserva lo guardado. Interpretar "no lo escribió" como "vale 0" pondría el
  catálogo entero a cero, y el agente lo repetiría a cada clienta.
- **La duración típica es solo para los nuevos.** Rellenarla antes de comparar
  convertía "esta línea no dice cuánto dura" en "ahora dura 60 minutos": un
  Volumen Ruso de 150 pasaba a 60 sin que nadie lo pidiera.
- La pantalla manda **las filas ya revisadas**, no un texto reconstruido. La
  primera versión metía la categoría en el nombre (`Volumen Ruso [Pestañas]`),
  que no casa con nada guardado: habría duplicado el catálogo entero.

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
