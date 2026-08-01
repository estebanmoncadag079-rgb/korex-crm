# La aplicación en el celular

> **Dentro:** Los dos puntos de corte · Qué hace cada pantalla en móvil · Los dos bugs que no se ven · Reglas para no volver a romperlo · Lo que quedó fuera

Hecho el **1-ago-2026**. Hasta entonces korex.ia estaba construida **solo para
escritorio**: cero clases responsive en el armazón, la navegación y la bandeja.
En un teléfono el menú lateral se plantaba a 224px fijos ocupando media pantalla
y el resto se salía por el borde.

Lo que se pidió: que **el dueño de un negocio pueda usar su CRM desde el
celular** —leer, contestar, mover una tarjeta y cambiar su configuración— y que
**la agencia pueda dar de alta un cliente** desde el móvil.

## Los dos puntos de corte

| Corte | Qué cambia |
|---|---|
| **`md` (768px)** | El principal. Debajo: menú en cajón, barra superior de 48px, campos y botones más altos. Encima: exactamente el escritorio de siempre. |
| **`lg` (1024px)** | Solo el panel de detalles del contacto en la bandeja. Con tres columnas fijas, entre 768 y 1023px al hilo le quedaban ~90px. |

**El escritorio no cambió.** La barra lateral conserva `md:static md:w-56
md:translate-x-0 md:transition-none`.

## Qué hace cada pantalla en móvil

| Pantalla | Cómo se adapta |
|---|---|
| **Navegación** | Cajón sobre el contenido. Se cierra al navegar, con Escape, tocando fuera o con su X. Cerrado queda `invisible`, así no se cuela en la tabulación. |
| **Bandeja** | Lista y conversación **se turnan**, con flecha de volver. Los globos pasan del 64 % al 85 % de ancho. |
| **Detalles del contacto** | Hoja a pantalla completa, con **estado propio**: cerrarla en el teléfono no apaga la columna guardada del escritorio. |
| **Embudo** | Scroll horizontal propio, columnas de 272px con la siguiente asomando. |
| **Contactos y etapas** | Los modales pasan a hoja inferior con scroll interno. |
| **Configuración** | La columna lateral de 176px se convierte en **pestañas deslizables**. |
| **Admin** | Parejas campo+botón apiladas; correos y contraseñas con `break-all` (se salían de la tarjeta); tabla de consumo desplazable dentro de su caja. |
| **Primitivas** | `button`, `input` y `textarea` ganan 4px de alto y 16px de texto en móvil, volviendo a la densidad de escritorio en `md`. Arregla decenas de sitios sin tocarlos. |

## Los dos bugs que no se ven

**1. En Safari de iOS no se podía contestar un mensaje.** `100vh` mide la
pantalla **como si no hubiera barra de direcciones**, así que en un armazón sin
scroll el cuadro para escribir quedaba debajo de esa barra, sin forma de
alcanzarlo. Se usa `dvh` donde el navegador lo soporta, con `h-screen` de
respaldo.

**2. En el embudo las tarjetas cambiaban de etapa solas.** Con un único
`PointerSensor` por distancia, **cualquier deslizamiento para recorrer la lista
se interpretaba como arrastre** — y eso se guarda en la base. Ahora hay dos
sensores: `MouseSensor` conserva su umbral de 6px exacto y `TouchSensor` exige
mantener pulsado 250 ms.

⚠️ Efecto lateral que hubo que corregir: el enlace de abrir conversación frenaba
solo `pointerdown`, que **ya no protege a estos sensores**. Se le añadieron
`onMouseDown` y `onTouchStart`.

## Reglas para no volver a romperlo

- **Los campos de texto van a 16px en móvil.** No es estética: por debajo de eso
  iOS **hace zoom al enfocar** y descuadra la pantalla entera.
- **Móvil primero, escritorio con `md:`.** Las clases sin prefijo son las del
  teléfono; el escritorio se recupera con el prefijo.
- **Nada de anchos fijos** en contenedores de página.
- **Lo ancho se desplaza dentro de su caja** (`overflow-x-auto`), nunca movienda
  la página entera de lado.
- **Los modales largos, hoja inferior con scroll interno**: un modal centrado de
  ancho fijo deja el botón de guardar fuera de la vista con el teclado abierto.

## Lo que quedó fuera

- **Menú "Mover a…" en las tarjetas del embudo.** Hoy se mueve manteniendo
  pulsado y arrastrando, y existe un camino sin arrastre por los detalles del
  contacto. Un menú en la tarjeta sería más cómodo, pero es **función nueva, no
  presentación**. Pendiente de decidir (punto 27 de
  [08-PENDIENTES.md](08-PENDIENTES.md)).
- **`viewport-fit=cover` / safe areas** de iPhone con notch: no hace falta
  mientras no se pinte de borde a borde.
- **La portada pública**: ya traía su propia versión móvil.

> ⚠️ **Nada de esto se ha abierto en un navegador real.** Se verificó con
> typecheck, lint, las 292 pruebas y el build, y comprobando las clases contra
> la hoja de estilos generada — pero **el gate verde no prueba que se vea bien**.
> Hay que abrirlo en un teléfono.
