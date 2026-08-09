# Catálogo oficial del salón (LASHES VALEN STUDIO)

> **Dentro:** Qué es este documento · Pestañas · Efectos modernos · Cejas y
> lifting · Retoques · Labios · Uñas (sin fuente) · Reglas del catálogo que van
> al KB · Lo que el catálogo NO dice

## Qué es este documento

Transcripción fiel del PDF **"Catálogo lashes valen.pdf"** (10 páginas), que la
dueña entregó el **8-ago-2026** como catálogo oficial. Es la **fuente de verdad
de precios y nombres** del primer cliente del vertical de citas. Cargado en
`scripts/salon-catalogo.sql`.

El PDF original está en `Downloads\Catálogo lashes valen.pdf` (36 MB, no entra
al repo). Cada precio de aquí se verificó **mirando la página renderizada**, no
la extracción de texto: el texto sale por columnas y desordena los precios.

⚠️ **Reemplaza al catálogo cargado el 7-ago.** Aquel tenía **los 12 retoques
con el precio equivocado** — ver [Retoques](#retoques).

## Pestañas (montura nueva) — págs. 2 a 4

| Servicio | Precio | Qué es (texto del catálogo) |
|---|---|---|
| Efecto Natural | 95.000 | Acabado suave, ligero y elegante; look fresco y natural |
| Efecto Pestañina | 95.000 | Pestañas definidas y naturales, sin exceso de volumen |
| Baby Volumen (2D) | 110.000 | Más lleno y definido que el clásico, sigue natural |
| Volumen 3D | 120.000 | Mirada más densa y expresiva, ligera y equilibrada |
| Volumen Ruso | 135.000 | Efecto lleno e intenso, impactante y sofisticado |
| Volumen Americano | 150.000 | Mirada intensa, máximo volumen, efecto glamuroso |

**Volumen Tecnológico** (fibras tecnológicas ultraligeras, pág. 4):

| Servicio | Precio | Qué es |
|---|---|---|
| Volumen 3D Tecnológico | 120.000 | Volumen suave y natural sin sobrecargar la pestaña |
| Volumen 4D Tecnológico | 135.000 | Más lleno y definido, cómodo y ligero |
| Volumen 5D Tecnológico | 150.000 | Más denso y glamuroso, textura liviana y sedosa |

## Efectos modernos — pág. 5

| Servicio | Precio | Qué es |
|---|---|---|
| Foxy Eye | 140.000 | Alarga la mirada hacia los extremos, efecto "ojo de zorro" |
| Wispy | 150.000 | Diferentes longitudes, efecto despeinado y natural |
| Kim K | 150.000 | Picos irregulares, efecto glam y atrevido |

## Cejas y lifting — pág. 6

La página no trae título de categoría en el PDF; se agrupó así porque son los
tres servicios que no llevan extensión.

| Servicio | Precio | Qué es |
|---|---|---|
| Lifting de pestañas | 80.000 | Curva, brillo y definición **sin extensiones** |
| Laminado de cejas | 80.000 | Domina y moldea la ceja, acabado pulido |
| Cejas en Henna | 30.000 | Define y perfila con color duradero |

## Retoques — págs. 7 a 9

**Cada retoque tiene dos precios según cuándo vuelva la clienta.** Esto es lo
que estaba mal cargado: el catálogo del 7-ago tenía un solo precio por servicio
y ninguno coincidía.

| Retoque | 10-15 días | 20 días | Estaba cargado |
|---|---|---|---|
| Natural o Pestañina | 60.000 | 75.000 | 20.000 / 30.000 ❌ |
| Baby Volumen (2D) | 75.000 | 90.000 | 30.000 / 60.000 ❌ |
| Volumen 3D | 80.000 | 95.000 | 20.000 / 40.000 ❌ |
| Volumen Ruso | 90.000 | 110.000 | 100.000 / no existía ❌ |
| Volumen Americano | 100.000 | 120.000 | 100.000 / 120.000 ✅ |
| Volumen 3D Tecnológico | 70.000 | 80.000 | **no existía** ❌ |
| Volumen 4D Tecnológico | 75.000 | 90.000 | 70.000, sin franja ❌ |
| Volumen 5D Tecnológico | 90.000 | 110.000 | 80.000, sin franja ❌ |
| **Retiro de extensiones** | 20.000 | — | 20.000 ✅ |

## Labios — pág. 10

| Servicio | Precio | Qué es |
|---|---|---|
| Hidralips | 60.000 | Hidrata y da brillo natural. **Mínimo 3 sesiones** |
| Henna Lips | 20.000 | Color intenso y natural, acabado uniforme |

El "mínimo 3 sesiones" está en el PDF; el precio cargado es **por sesión**.

## Uñas — no vienen en este catálogo

El PDF es el del área de lashes. Las **12 uñas** cargadas (Semipermanente, Press
on, Acrílico…) siguen viniendo de la lista que se pasó a mano el 7-ago y **nadie
las ha confirmado contra una fuente oficial**. Geimar y Laura solo atienden esa
categoría, así que un precio malo ahí es media agenda cotizando mal.

## Reglas del catálogo que van al KB

No son servicios, son condiciones — el agente no las puede inventar:

- **Los retoques aplican solo si conserva el 60 % de las extensiones.**
- **Pasados 30 días es montura nueva**, no retoque (cambia el precio: un
  retoque de Volumen Ruso son 90.000, la montura nueva 135.000).
- **Hidralips: mínimo 3 sesiones.**

Van en `kb_entry` junto con lo que ya faltaba (dirección, parqueadero, formas de
pago, política de cancelación) — punto 4 de
[21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md).

## Lo que el catálogo NO dice

- **Las duraciones.** Ninguna. Las del script son estimaciones, y de ellas
  depende toda la disponibilidad: si un Volumen Ruso son 150 min y en realidad
  son 210, el agente vende un hueco que no existe. **Es la pregunta más urgente
  para la dueña, junto con el horario.**
- **Si Hilary, Valentina y Carolina hacen todo lo de pestañas por igual** —
  hoy se asume que sí (asignación por categoría, nadie cruza a Uñas).
- **Combos o descuentos** (pestañas + cejas, paquete de 3 Hidralips).
