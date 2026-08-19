# El guardarraíl del recurso prometido

> **Dentro:** El caso · Por qué se midió antes de construir · La medición ·
> El diseño · Dos bugs propios encontrados al escribir las pruebas · Cómo se
> verificó · Deuda que queda · Cómo revertir

**18-ago-2026.** Cuarto guardarraíl del servidor, mismo patrón que el cierre
falso, la cita fantasma y el producto olvidado: el agente promete algo con
`reply` y no ejecuta la acción que lo cumpliría.

---

## El caso

Con el enlace del catálogo ya configurado y funcionando (ver
[100-RECURSOS-COMPARTIBLES.md](100-RECURSOS-COMPARTIBLES.md)), el dueño probó
pidiendo el catálogo en la conversación de siempre y **no llegó nada — ni PDF
ni enlace**. La causa, confirmada con el mensaje real guardado:

```
in  | quiero ver el estilo americano
out | text | "¡Claro que sí, hermosa! Para que te hagas una idea de cómo luce
              el Volumen Americano, te comparto nuestro catálogo de
              pestañas..."
```

`type: text`, sin ningún `send_image` emitido. El modelo escribió la promesa
con `reply` y nunca pidió la acción que de verdad manda algo.

## Por qué se midió antes de construir

Ese mismo día ya se había medido y **descartado** un guardarraíl parecido para
el horario (regla 4 de
[REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md): *¿se puede
resolver sin tocar código?*). Ahí la medición dio: **una sola conversación
afectada, la del propio dueño** — no se justificaba.

La primera reacción fue tratar este caso igual y no construir nada todavía —
quedó anotado así en el doc 100. Pero antes de cerrarlo, tocaba la misma
pregunta: ¿esto es igual de aislado, o no?

## La medición

Un primer filtro (`LIKE '%te comparto%'`, muy amplio) dio un resultado
engañoso: parecía tocar tres negocios, incluida La Churra. Al revisar el texto
real, era un **falso positivo propio**: *"te comparto nuestras delicias:
[menú en texto]"* — un listado de precios, sin ningún recurso de por medio.
Se corrigió el filtro para exigir la palabra del recurso (catálogo, foto,
imagen, PDF, documento), no solo el verbo de compartir.

Con el filtro correcto:

| Conversación | Negocio | Promesas | Ejecutó la acción | Solo prometió |
|---|---|---|---|---|
| La de pruebas de siempre | Lashes Valen | 5 | 1 | 4 |
| **Alejandra** — cita real agendada el 14-ago | Lashes Valen | 1 | 0 | **1** |
| **"Hc."** | Lis Pastelería | 1 | 0 | **1** |

El dato que decidió: el fallo de **Alejandra ocurrió mientras se investigaba
el caso**, en una conversación con una cita real agendada — no la de pruebas.
El patrón no estaba limitado a un chat contaminado: apareció en **2 negocios
distintos**, con **9 de 10 promesas totales sin ejecutar la acción**.

Es la medición contraria a la del horario, y por eso la decisión es la
contraria: aquí sí se justifica.

## El diseño

Mismo patrón que `anunciaCierre`/`anunciaCitaAgendada`
([38-GUARDARRAILES.md](38-GUARDARRAILES.md)): una función pura que detecta la
promesa en el TEXTO, y el pipeline la compara contra la ACCIÓN elegida.

```
prometeRecurso(texto) → true si el texto promete un catálogo/foto/imagen/
                         PDF/documento

En pipeline.ts: si prometeRecurso(texto) Y action !== "send_image"
                → una oportunidad de rehacer el turno con la corrección
                → si insiste, lo atiende una persona
```

Genérico a propósito: no menciona salones, pestañas ni catálogos de nadie. Le
sirve igual a un negocio de citas que promete una foto de un servicio, o a uno
de pedidos que promete la carta en PDF.

### Por qué "menú" y "carta" quedan fuera del filtro

Son las palabras que causaron el falso positivo de La Churra. Un negocio de
pedidos dice *"te muestro nuestro menú: [precios en texto]"* constantemente
sin que exista ningún archivo detrás, y esa es una respuesta **correcta**. El
filtro solo reconoce palabras que casi siempre implican un archivo real:
catálogo, foto(s), imagen(es), PDF, documento.

### Por qué deriva a una persona si insiste

Igual que el cierre falso, distinto de "producto olvidado". Un tamaño mal
sustituido se corrige en el resumen; una promesa de catálogo incumplida deja
al cliente esperando algo que nunca llega — el mismo tipo de daño que el
cierre falso, no el de un detalle recuperable.

## Dos bugs propios, encontrados al escribir las pruebas — no al revisar

Ninguno se vio al leer el código; los dos aparecieron al correr los tests.

**1. `\b` después de una vocal acentuada.** `"Aquí está la foto"` no cazaba.
JS no reconoce un límite de palabra después de "á" — el mismo motivo por el
que `ANUNCIOS_DE_CITA` ya evita el `\b` tras "reservé"/"agendé". Se quitó el
`\b` después de `est[áa]`.

**2. Una pregunta con el `?` lejos del recurso.** *"¿Te envío el catálogo, o
prefieres que te cuente los precios?"* seguía cazando: el primer diseño solo
descartaba el `?` si estaba pegado a la palabra del recurso, no en cualquier
parte de la misma frase. Se rediseñó para evaluar **oración por oración**,
descartando cualquiera que contenga `¿` o termine en `?`.

## Cómo se verificó

```bash
pnpm test        # 840 passed, 73 skipped (16 nuevas: 7 positivas, 8 negativas, 1 de nulos)
pnpm typecheck    # limpio
pnpm lint         # limpio
```

Las 16 pruebas incluyen los **3 mensajes reales** que fallaron en producción
(verificados literalmente contra el texto guardado en la base) y el falso
positivo propio del filtro inicial, para que no vuelva a colarse.

## Deuda que queda

- **No hay test de integración del reintento completo** (el turno rehecho de
  principio a fin, con `chatJson` mockeado) — igual que el cierre falso y la
  cita fantasma tampoco lo tienen. Solo se prueba la función de detección.
- **El caso "`send_image` con etiqueta que no resuelve"** queda fuera a
  propósito: es distinto (el modelo sí intentó la acción, con un nombre que no
  coincide con ninguna del catálogo) y mucho más raro que el patrón medido
  hoy — el 100 % de los fallos reales fue `reply` sin ningún intento de
  `send_image`. Si aparece evidencia de ese caso, se audita aparte.

## Cómo revertir

```bash
git revert <commit>
```

No toca esquema, no toca datos, no cambia el prompt. Quitar el bloque del
pipeline y las dos exportaciones de `anuncio-de-cierre.ts` deja el
comportamiento exactamente como estaba.
