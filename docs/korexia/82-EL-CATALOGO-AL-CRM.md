# Paso 3: el catálogo, entero, al CRM

> **Dentro:** La buena noticia primero · El inventario · 🔴 El profesional NO es
> una opción · La estructura propuesta · Los tres escenarios · Riesgos · Lo que
> no se generaliza · La recomendación

**17-ago-2026. Auditoría, sin una línea de código.**

---

## La buena noticia, primero

**El núcleo ya está listo.** Después de los pasos 1, 2 y 1.5 no queda un solo
nombre de grupo en `estado.ts`, `normalizar.ts`, `extraer.ts` ni `pipeline.ts`:
trabajan con `item`, `seleccion`, `datos`, `totalCents`, `paso` y `confirmado`, y
las reglas (`minimo`, `maximo`) las lee del catálogo que reciben.

**Lo que falta no es cambiar el núcleo. Es que un servicio pueda tener grupos
como los tiene un producto.**

```
product  →  product_option_group (minSelect, maxSelect)  →  product_option (precioDelta)
service  →  ✗ NADA
```

Un salón que quiera ofrecer *manicura → con esmalte · semipermanente* **no tiene
dónde ponerlo**: acaba como texto libre dentro del prompt, que es exactamente de
donde la Fase 1 sacó las cartas de los productos.

---

## Inventario

### ¿Qué archivos tienen grupos cableados?

**Ninguno en el núcleo.** Cero apariciones de `salsa`, `recubierto` o `adicion`
en código de `orders/`. Las que quedan en el repositorio:

| Archivo | Qué tiene | Veredicto |
|---|---|---|
| `catalog/sembrar.ts` | El parser del texto de la ficha: reconoce `ADICIONES:`, `RECUBIERTO`, `azúcar` | 🟠 **legítimo**: lee el texto que escribió un negocio concreto. Es un traductor, no una regla |
| `lab/personas.ts` | Guiones de prueba con salsas y toppings | 🟢 son guiones |
| `ai/conducta.ts`, `ai/prompts.ts` | Ejemplos en el texto del prompt | 🟢 prosa |

### ¿Quién asume reglas de mínimo y máximo?

| Archivo | Usos | Qué hace |
|---|---|---|
| `orders/normalizar.ts` | 13 | Valida contra `g.minimo` / `g.maximo` **del catálogo recibido** |
| `catalog/render.ts` | 7 | Pinta el *"elige N"* y el `(opcional)` |
| `catalog/queries.ts` | 4 | Los lee de la tabla |
| `orders/extraer.ts` | 3 | Qué falta por grupo |
| `scripts/` (`migrar-catalogo`, `cargar-opciones`) | 10 | Los deducen del texto al migrar |

**Ninguno los inventa**: todos los leen. Eso es lo que el paso 1 dejó hecho.

### ¿Quién depende de que exista un catálogo de comida?

**Nadie en el núcleo.** Dependen del texto de una ficha concreta: el parser
(`sembrar.ts`) y los dos scripts de migración. Y el **banco de escenarios**,
escrito con los productos de Lis — ya anotado como bloqueante.

### ¿Qué archivos usan listas específicas?

Tras los pasos 1 y 1.5: **ninguno**. La última —los requisitos por defecto— se
cerró el mismo día con `migrar:requisitos`.

---

## 🔴 El hallazgo: el profesional NO es una opción

El escenario del salón propone `Profesional: [Andrea, Valentina]` como un grupo
más. **No debería serlo**, y conviene decir por qué antes de escribir nada:

1. **Ya está modelado, y con más información**: `staff_member` + `staff_service`
   dicen qué profesional hace qué servicio. El prompt de citas ya lo pinta
   (*"atiende: Andrea, Valentina"*).
2. **Una opción no sabe de agendas.** Elegir *"Andrea"* en un grupo no reserva
   nada: no comprueba solape, ni disponibilidad, ni horario. Un grupo de
   opciones no tiene calendario.
3. **Serían dos fuentes de verdad** para el mismo dato — lo que el proyecto
   acaba de arreglar dos veces (el vertical, y el catálogo del prompt).

> **Un grupo de opciones y un recurso reservable se parecen en la conversación y
> no se parecen en nada más.** El grupo modifica el precio; el recurso modifica
> la disponibilidad de otro. Meter al profesional en `seleccion` haría que el
> núcleo pareciera soportar citas **sin soportarlas**: guardaría la elección y
> nadie reservaría la hora.

El profesional va en `recurso`, con la fecha y la hora — **paso 4**.

---

## La estructura propuesta

```ts
Ofrecible {            // lo que el negocio vende: producto O servicio
  id, nombre, categoria, precioCents,
  duracionMin?         // solo si su vertical la usa
  grupos: Grupo[]
}

Grupo {
  id, nombre, minimo, maximo,
  permiteRepeticion,   // ← NUEVO
  opciones: Opcion[]
}

Opcion { id, nombre, precioDeltaCents }
```

**`permiteRepeticion` es un hallazgo, no un adorno.** Hoy la repetición es
**universal**: se abrió el 16-ago porque un Mega Box lleva cinco salsas de
cuatro sabores. Pero *"esmaltado: tradicional + tradicional"* no significa nada,
y *"Andrea + Andrea"* menos. **Una regla de un negocio quedó como regla del
núcleo**; el CRM debe poder decir que no.

### Y en las tablas

El camino que **no** recomiendo: fundir `product` y `service` en una tabla. Se
evaluó en agosto y se descartó con razones que siguen siendo ciertas —
`durationMin` es `NOT NULL` y no significa nada para un churro, y arrastra el
acoplamiento con el solape y con `staff_service` ([63](63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md)).

El camino mínimo que no hay que rehacer en seis meses:

- **`service` gana sus grupos** con la misma forma que `product`.
- **El tipo de dominio se unifica**: `ProductoDelCatalogo` → `Ofrecible`, y
  `catalogoDe(organizationId)` devuelve lo que corresponda **según el vertical,
  que ya tiene fuente única**.
- **El núcleo no se entera**: ya trabaja con esa forma.

---

## Los tres escenarios, sobre el modelo propuesto

| | Restaurante | Salón | Taller |
|---|---|---|---|
| **Ofrecible** | Hamburguesa · $18.000 | Manicura · $45.000 · 60 min | Cambio de frenos · $120.000 |
| **Grupo 1** | Tamaño (1–1, sin repetición) | Esmaltado (1–1, sin repetición) | Tipo de pastilla (1–1) |
| **Grupo 2** | Salsas (1–2, **con** repetición) | — | Urgencia (0–1) |
| **Grupo 3** | Adiciones (0–5, con repetición: dos quesos) | — | — |
| **Recurso** | — | **Profesional + fecha + hora** ← paso 4 | — |
| **Datos** | nombre, teléfono, dirección | nombre | placa, orden de seguro |

Las tres filas de arriba son **el mismo modelo**. Las dos de abajo ya están
resueltas: `datos` desde el paso 1.5, `recurso` en el paso 4.

---

## Riesgos

| | Riesgo | Por qué |
|---|---|---|
| 🔴 | **Migración con datos vivos** | Sería **la primera de esta serie que no es gratis**: `product` tiene 4 filas de La Churra y `service` las del salón. Las tres anteriores se aprovecharon de que `conversation_state` estaba vacía; esta no puede |
| 🔴 | **El profesional como opción** | Si entra en `seleccion`, el sistema parecerá soportar citas sin reservarlas. Ver arriba |
| 🟠 | **`permiteRepeticion` cambia el comportamiento actual** | Hoy todo se repite. Poner el valor por defecto en `false` rompería el Mega Box; en `true`, deja pasar *"Andrea + Andrea"*. **Hay que decidirlo, no dejarlo caer** |
| 🟠 | **Dos renderizadores** | `renderCatalogo` (citas: duración y quién atiende) y `renderCatalogoDePedidos` (grupos y *"elige N"*). Fundirlos es tentador; el de citas necesita cosas que el otro no tiene |
| 🟠 | **El parser de texto es de pedidos** | `sembrar.ts` lee cartas de comida. Un salón cargaría sus grupos a mano o por pantalla — que no existe |
| 🟢 | **El núcleo** | No cambia: ya recibe la forma genérica |

---

## Lo que NO debe generalizarse

- **`durationMin`**: solo tiene sentido donde hay agenda. Empujarla al modelo
  común la convierte en un `0` que nadie mira.
- **`staff_service` y el solape**: es la lógica de reserva, y es del vertical.
- **El parser del texto de la ficha**: traduce lo que escribió un negocio
  concreto. Su trabajo es entender a un humano, no ser genérico.
- **Los dos cierres de la conducta**: ya separados el 13-ago y funcionando.
- **La pantalla de catálogo** (que no existe): cuando exista, será una por
  vertical o una con dos modos — pero eso se decide viéndola, no antes.

---

## Recomendación arquitectónica

**Partir el paso 3 en dos, y hacer solo el primero ahora:**

| | Qué | Coste |
|---|---|---|
| **3a** | `permiteRepeticion` en el grupo + unificar el tipo de dominio a `Ofrecible` + `catalogoDe()` por vertical | **Una migración aditiva** (ver corrección abajo) |
| **3b** | Grupos de opciones para `service` | **Migración de esquema.** La primera que toca datos vivos |

El motivo de partirlo no es la prudencia: es que **3a se puede revertir con un
`git revert` y 3b no**. Y 3b, además, se beneficia de que 3a esté hecho antes —
cuando llegue, el tipo de dominio y el render ya serán comunes.

> **Y una advertencia sobre el orden general**: 3b es la primera migración de
> esta serie con datos encima. La ventana de *"esto sale gratis"* que se ha
> aprovechado tres veces **se cierra aquí**.


---

# Inventario del paso 3A (17-ago)

## ⚠️ Corrección de la recomendación anterior

Este documento decía que **3a no llevaba migración**. **Es falso**, y conviene
decirlo antes que nada: `permiteRepeticion` es configuración del negocio, así
que **se persiste**, y eso es una columna nueva en `product_option_group`.

Es aditiva y con valor por defecto —de las baratas—, pero es una migración. La
frase *"3a se revierte con un `git revert` y 3b no"* sigue siendo cierta solo a
medias: revertir el código deja la columna, que es inofensiva.

## 🔴 El hallazgo que cambia el plan: `false` reintroduce el bug del Mega Box

Verificado hoy en producción:

| Producto | `max_select` | Sabores distintos |
|---|---|---|
| CHURRITA | 1 | 4 |
| BESTIES | 2 | 4 |
| FAMILY BOX | 3 | 4 |
| **MEGA BOX** | **5** | **4** |

**Un Mega Box exige cinco salsas y el catálogo tiene cuatro.** Con
`permiteRepeticion = false` por defecto, ese pedido **no se puede completar
jamás** — que es exactamente el bug corregido el 16-ago, reintroducido por un
valor por defecto.

La decisión de negocio (`false`) **es la correcta**: repetir es la excepción. Lo
que no se puede hacer es aplicarla y marcharse.

### La salida, sin adivinar preferencias de nadie

Que **la propia migración ponga `true` donde la repetición es matemáticamente
obligatoria**: `max_select > (número de opciones del grupo)`. No es una
preferencia, es aritmética — un grupo que pide más de las que tiene **solo** se
puede completar repitiendo.

Los demás grupos quedan en `false`, y quien quiera repetición la declara.

## Las siete respuestas

**1. ¿Qué archivos cambiarían?**

| Archivo | Qué |
|---|---|
| `lib/db/schema.ts` + una migración | La columna `permite_repeticion` |
| `catalog/queries.ts` | El tipo `Ofrecible`, `permiteRepeticion` en el grupo, y `catalogoDe(org)` que elige por vertical |
| `orders/normalizar.ts` | **Validar la repetición** al construir la selección |
| `catalog/render.ts` | Renombrar el tipo; el render no cambia |
| `orders/estado.ts`, `orders/extraer.ts`, `ai/pipeline.ts` | Solo el nombre del tipo |
| `catalog/sembrar.ts`, `scripts/migrar-catalogo.ts`, `cargar-opciones.ts` | El tipo, y decidir qué `permiteRepeticion` escriben al migrar |

**2. ¿Qué contratos cambian?** `ProductoDelCatalogo` → **`Ofrecible`** ·
`GrupoDeOpciones` gana `permiteRepeticion` · `catalogoDePedidos()` →
**`catalogoDe()`**.

**3. ¿Qué migraciones?** **Una, aditiva**:
`ALTER TABLE product_option_group ADD COLUMN permite_repeticion boolean NOT NULL
DEFAULT false`, más el `UPDATE` aritmético de arriba.

**4. ¿Qué pruebas quedan obsoletas?** **Ninguna se borra.** El bloque *"las
salsas se pueden repetir"* (8 pruebas) tendrá que declarar
`permiteRepeticion: true` en su catálogo de prueba — que es precisamente lo que
demuestra que la regla dejó de ser universal. Las otras cuatro coincidencias de
la palabra *"repetir"* en `tests/` son de otros temas.

**5. ¿Qué sigue acoplado a un catálogo de comida?** El parser `sembrar.ts`, los
dos scripts de migración y el banco de escenarios. Ninguno es núcleo.

**6. ¿Hay dependencia oculta entre `product` y `service`?** **No.** Un solo
archivo toca las dos tablas —`seed/demo.ts`, el sembrador de la demo— y no las
relaciona. Cada vertical vive en su lado, lo que hace **3b más barato de lo que
parecía**.

**7. ¿Dónde se asume repetición hoy?** En cinco puntos, todos consecuencia del
16-ago: tres `seleccion.push` en `normalizar.ts` que no comprueban nada, y dos
recuentos con `filter(...).length` en `normalizar.ts` y `extraer.ts`. **El
recuento seguirá siendo correcto** con repetición prohibida; lo que falta es
**negarse a añadir** la segunda.

## Riesgos

| | |
|---|---|
| 🔴 | **El Mega Box** (arriba). Sin el `UPDATE` aritmético, el cliente que factura pierde su producto más caro |
| 🟠 | **La migración toca `product_option_group`**, tabla con datos vivos. Es aditiva, pero es la primera de la serie que no cae en tabla vacía |
| 🟠 | **El rename es mecánico pero amplio**: `ProductoDelCatalogo` aparece en ~10 archivos. Sin riesgo funcional; sí de ruido en el diff |
| 🟢 | **El núcleo** no cambia de forma: solo el nombre del tipo que ya recibía |
| 🟢 | **`service` no se toca** en 3a |
