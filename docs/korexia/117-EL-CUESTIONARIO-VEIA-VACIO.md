# El cuestionario veía vacío lo que el agente sí tenía

> **Dentro:** Lo que vio el dueño · Las dos fuentes que no se hablaban · El
> riesgo silencioso · El arreglo · El segundo defecto que quedó al descubierto ·
> Cómo revertir

**20 de agosto de 2026.** El dueño abrió *"Cuéntanos sobre tu negocio"* para Lis
y lo vio **todo en blanco** — tono, regalos, saludo. Su pregunta fue la correcta:

> *«¿Cómo va a responder el bot, si el CRM es la fuente de verdad?»*

---

## Lo primero: el bot sí lo tenía

La ficha aplicada de Lis estaba completa (tono, regalos, saludo, reglas, todo) y
su agente la estaba usando en cada conversación. **Lo vacío era la pantalla, no
la configuración.**

## Dos sitios distintos que nadie había cruzado

| | Dónde vive | Quién lo usa |
|---|---|---|
| **Ficha aplicada** | `agent_profile.ficha` | El agente, en cada turno |
| **Borrador del cuestionario** | `organization.metadata.fichaBorrador` | Solo la pantalla, para no perder el avance |

`leerBorrador` devolvía `{}` cuando no había borrador. Y los tres negocios de
agosto se configuraron **por script**, no por el cuestionario: ninguno tenía
borrador, así que los tres veían el formulario en blanco.

## El riesgo que había debajo, y no era cosmético

Al enviar, el cuestionario **reemplaza la sección `negocio` entera**
(`fusionarFicha`, ver `aplicarFicha`). Partiendo de un formulario vacío, todo lo
que no se volviera a escribir se perdía **en silencio**:

| | |
|---|---|
| ✅ A salvo | El saludo, las reglas propias, el escalado y lo que nunca prometer — son de otra sección y se conservan |
| ✅ A salvo | El tono, porque es obligatorio y el envío se rechaza sin él |
| 🔴 En riesgo | **Los regalos, las variantes** (los toppings por tamaño), **la ubicación** y los detalles de entrega |

---

## El arreglo

Cuando no hay borrador, `leerBorrador` devuelve **la ficha aplicada**. Y cuando
lo hay, **se fusionan**: la ficha como base, el borrador encima, campo por
campo.

Fusionar y no elegir uno de los dos importa, y las dos formas de equivocarse
ocurrieron el mismo día:

- **Devolver solo el borrador** → sin borrador se ve vacío… y con un borrador de
  UN campo se tapa una ficha completa. Le pasó a Lis, y por eso la primera
  versión de este arreglo seguía enseñándole el formulario en blanco.
- **Devolver solo lo aplicado** → se pierde lo que la persona está escribiendo
  ahora mismo.

Resultado para los tres negocios, medido contra la base:

| Negocio | Campos que ve el cuestionario | Falta por responder |
|---|---|---|
| Lis Pastelería | **17** | nada |
| La Churra | 16 | nada |
| Lashes Valen | 15 | nada |

---

## Lo que el borrador de Lis tenía dentro

Esto explica de dónde salió todo. Su borrador guardaba **una sola cosa**:

```json
{"reglasPropias": ["Tenes domicilios por rappi, este es el link
                    para hacer tu pedido: https://rappi.app.link/..."]}
```

El dueño ya había intentado enseñarle a su agente lo de Rappi, escribiéndolo en
el cuestionario. **Nunca se aplicó**: el formulario, al estar en blanco, no podía
enviarse — le faltaban todos los campos obligatorios que deberían haber estado
precargados. Se quedó en un borrador sin efecto, y el agente siguió sin saberlo.

---

## 🔴 El segundo defecto, que queda al descubierto y NO se arregla aquí

El cuestionario **pide datos que no puede guardar**.

`aplicarFicha` se llama sin declarar secciones, así que por defecto solo puede
escribir `negocio`. Pero el formulario recoge también **`saludoInicial`** y
**`reglasPropias`**, que son de `flujo`.

| Momento | Qué pasa |
|---|---|
| Alta, primera vez | No hay ficha guardada, así que se escribe todo. Funciona |
| **Al reeditar** | `flujo` se conserva de lo guardado → **lo que el cliente escriba en esos campos se descarta en silencio** |

Es decir: la regla de Rappi del borrador **tampoco habría funcionado** al enviar
el cuestionario, ni siquiera con la precarga arreglada.

No se toca en este commit porque es una decisión de producto, no un fallo
mecánico: o el cuestionario deja de mostrar esos campos al reeditar, o pasa a
poder escribir `flujo`. Las dos tienen consecuencias que merecen decidirse, no
improvisarse.

---

## Pruebas

`tests/unit/cuestionario-precarga-la-ficha.test.ts` — 8 comprobaciones:

- Sin borrador, se ve la ficha aplicada
- **Un borrador de un campo no tapa la ficha entera** (el caso real que se
  escapó a la primera implementación)
- Lo que se está editando gana sobre lo aplicado
- Un negocio nuevo sigue empezando en blanco
- Y las cuatro del envío: qué se conserva, qué se pierde con un formulario vacío
  —el precio de no precargar, escrito por si alguien quiere quitarlo— y que con
  el formulario precargado no se pierde nada

| | |
|---|---|
| typecheck · lint | limpio |
| Pruebas unitarias | **930**, 0 fallos (8 nuevas) |
| `probar:estado` | 46/46 |
| Verificación contra la base | Los tres negocios, arriba |

---

## Cómo revertir

`git revert`. No hay datos migrados: esto solo cambia **qué se lee** para pintar
el formulario. Ninguna ficha se tocó.
