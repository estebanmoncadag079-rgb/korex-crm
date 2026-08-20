# La ficha nueva nace por secciones

> **Dentro:** El hallazgo · Por qué crecía con la plataforma · El cambio · Lo que
> NO cambia · La prueba que evita una pérdida silenciosa · Cómo revertir

**20 de agosto de 2026.** Primer paso aprobado de la auditoría de arquitectura.
Un cambio de una condición, en el único sitio que crea fichas.

---

## El hallazgo

`aplicarFicha` (`generador/aplicar.ts`) es **el único camino que escribe una
ficha**: por él pasan el cuestionario del alta y la pantalla de `/admin`.
Serializaba con `serializarComoEstaba()`, que —como su nombre dice— conserva el
formato en que la encontró.

Para una ficha **nueva** no hay nada que conservar, y caía al formato **plano**,
el anterior al 15-ago. Resultado: **todo negocio que entraba a la plataforma
nacía en el formato viejo**, y solo pasaba al nuevo si alguien recordaba correr
`pnpm convertir:ficha` a mano.

Medido el 20-ago sobre la flota:

| Negocio | Formato de su ficha |
|---|---|
| La Churra | por secciones |
| Lashes Valen | por secciones |
| **Lis Pastelería** | **plano** — se le creó la ficha el 19-ago, ya con este defecto |

---

## Por qué importaba, y por qué no era urgente

**No tenía ningún efecto en producción.** Se comprobó expresamente: la protección
de "un dueño por dato" **no depende del formato guardado** — `fusionarFicha`
deduce las secciones de los nombres de los campos, no del JSON. Solo tres
scripts miran el formato, y únicamente para conservarlo al escribir.

Lo que lo hacía digno de arreglar es otra cosa: **era el único hallazgo de la
auditoría cuya gravedad crece con el número de clientes.** Los demás cuestan lo
mismo con tres negocios que con mil; este cuesta más cada vez que se vende una
cuenta. Con tres se convierte a mano; con mil, ponerse al día deja de ser un
valor por defecto y se convierte en una migración masiva.

Por eso se resolvió en la capa **Algoritmo** y no con un guardarraíl que avisara
de fichas planas: avisar de algo que podemos simplemente dejar de producir es
tapar, no arreglar.

---

## El cambio

Una condición al principio de `serializarComoEstaba`:

```ts
// Nada guardado = ficha nueva: nace en el formato de hoy.
if (!guardadaCruda?.trim()) return JSON.stringify(aSecciones(ficha));
```

**No es una conversión silenciosa: no hay nada que convertir.**

## Lo que NO cambia, a propósito

| Caso | Qué pasa |
|---|---|
| Ficha **plana** que ya existe | Sigue plana. Rellenar un formulario no le convierte los datos a nadie |
| Ficha **por secciones** que ya existe | Sigue por secciones |
| Ficha **ilegible** (JSON roto) | Se respeta el comportamiento de siempre: si no se entiende, tampoco se sabe qué formato tenía |
| Fichas de la flota actual | **Ninguna se tocó.** `probar:estado` lo verifica: *"todas las filas de `agent_profile`, idénticas"* |

Convertir una ficha que ya existe sigue siendo un acto explícito:
`pnpm convertir:ficha`.

---

## La prueba que evita una pérdida silenciosa

`tests/unit/ficha-nueva-nace-por-secciones.test.ts` — 7 comprobaciones. La más
importante no es la del formato:

> **«ningún campo de la ficha se queda sin sección — si no, se perdería al
> guardar»**

`aSecciones` reparte los campos **a mano** y descarta lo que no esté en la lista.
Mientras la ficha nueva se guardaba plana eso no se notaba; desde este cambio, un
campo sin sección **desaparecería al guardarlo**. Ya pasó una vez, con
`escalarSiempre` y `nuncaPrometer`.

Verificado antes de tocar nada: los 18 campos del tipo tienen dueño (13 en
`negocio`, 3 en `flujo`, 2 en `politicas`). La prueba usa una ficha **completa**
a propósito — con una a medias, un campo nuevo pasaría desapercibido justo en la
prueba que existe para cazarlo.

Si esa prueba falla algún día, la respuesta **no** es quitarla: es asignar el
campo nuevo a su sección en `SECCIONES`.

---

## Cómo se probó

| Prueba | Resultado |
|---|---|
| `pnpm typecheck` · `pnpm lint` | limpio |
| `pnpm vitest run` | **907 pruebas**, 0 fallos (7 nuevas) |
| `pnpm probar:estado` (los dos verticales, clientes efímeros) | **46/46**, incluida *"la flota no cambió"* |
| Round-trip | Guardar una ficha nueva y releerla devuelve exactamente lo mismo |

---

## Cómo revertir

```bash
git revert <commit>
```

**Ninguna ficha existente cambió**, así que revertir no deja nada a medias: solo
vuelve a hacer que las fichas nuevas nazcan planas. Una ficha que ya se haya
creado por secciones se sigue leyendo igual — el lector entiende los dos
formatos desde el 15-ago.

⚠️ **Requiere despliegue para tener efecto.** Hasta que el contenedor lleve este
cambio, los clientes nuevos que se den de alta en producción siguen naciendo
planos.

---

## Lo que queda de la auditoría

Los otros tres pasos aprobados en el plan, por orden:

| | Paso | Estado |
|---|---|---|
| 2 | Convertir la ficha de Lis con `convertir:ficha` | ⬜ |
| 3 | Quitar la copia muerta del catálogo de las fichas ya migradas (1.934 car. en el salón) | ⬜ |
| 4 | Que la condición de un requisito mire el pedido, no solo la ficha (la dirección en pedidos para recoger) | ⬜ |
