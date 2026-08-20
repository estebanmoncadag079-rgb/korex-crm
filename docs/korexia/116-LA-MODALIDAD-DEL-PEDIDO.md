# La modalidad del pedido — la mitad que le faltaba a los requisitos

> **Dentro:** El síntoma y la causa · Las dos preguntas que estaban confundidas
> · El contrato nuevo · Por qué NO sube `SCHEMA_VERSION` · Las siete pruebas ·
> Cómo revertir

**20 de agosto de 2026.** Paso 4 de la auditoría de arquitectura. Un cliente que
decía *"paso a recogerlo al local"* tenía que dar una dirección para poder cerrar
su pedido.

---

## Lo que estaba pasando, con la evidencia

Leído de `conversation_state` tras un pedido real por el pipeline:

```json
{"nombre": "Ana Perez", "telefono": "3001234567", "direccion": "Recoge en el local"}
```

**El modelo metió la modalidad dentro del campo dirección.** No inventó una
dirección falsa ni bloqueó el pedido: puesto a rellenar un campo obligatorio sin
valor válido, escribió lo más cierto que tenía a mano.

## La causa: dos preguntas distintas, una sola respuesta

El requisito de dirección se declaraba así, en la ficha de **los dos** negocios
de pedidos:

```json
{ "id": "direccion", "soloSi": "entrega.haceDomicilios", "obligatorio": true }
```

Esa condición es **cierta**: el negocio sí reparte. Pero responde a la pregunta
equivocada.

| Pregunta | Quién la responde | ¿Existía? |
|---|---|---|
| ¿Este negocio **podría** necesitar una dirección? | la ficha (`entrega.haceDomicilios`) | ✅ sí |
| ¿La necesita **este pedido**? | el estado del pedido | 🔴 **no existía** |

`EstadoDelPedido` no tenía ningún campo para la modalidad: solo `items`, `datos`,
`reserva`, `totalCents`, `paso` y `confirmado`. La elección del cliente vivía
únicamente en el texto de la conversación. **La condición no ignoraba un dato:
no había dato que ignorar.**

> 🔑 CoreX sabía representar **lo que el negocio ofrece** y no **lo que el
> cliente eligió**. Esa es la frase que resume el paso 4.

---

## El contrato nuevo

### El dato: `EstadoDelPedido.modalidadDeEntrega`

Opcional, texto ya resuelto contra lo que la ficha ofrece. `null` = todavía no se
sabe.

### Quién es fuente de verdad de qué

| | Responde | Dónde vive |
|---|---|---|
| **Ficha** | Qué modalidades OFRECE el negocio | `entrega.haceDomicilios`, `entrega.recogerEnLocal` |
| **Estado** | Cuál ELIGIÓ el cliente para este pedido | `conversation_state.modalidadDeEntrega` |

Nunca se copia una a la otra.

### El requisito: `soloEnModalidades`

```json
{ "id": "direccion",
  "soloSi": "entrega.haceDomicilios",      // ¿podría hacer falta alguna vez?
  "soloEnModalidades": ["domicilio"] }     // ¿hace falta en ESTE pedido?
```

Las dos condiciones, cada una mirando su fuente.

### El único sitio que conoce nombres de modalidad

`modalidadesDeEntrega(ficha)` los deriva de los campos que la ficha ya tiene. Una
tercera modalidad mañana es un campo en la ficha y **una línea ahí** — no un
cambio repartido por el código.

### La regla conservadora, y por qué

Si **no se sabe** la modalidad, el requisito **se sigue pidiendo**.

No es tibieza: si al no saberla se dejara de pedir la dirección, bastaría con que
el modelo propusiera una modalidad que el negocio no ofrece —normalizada a
`null`— para cerrar un pedido a domicilio sin dirección. **"No se sabe" no es "no
hace falta".** Solo se relaja con una modalidad real, ya resuelta contra la
ficha.

### El modelo propone, el backend decide

`normalizarModalidad` resuelve la propuesta contra las modalidades ofrecidas y
devuelve una de ellas o `null`. **Nunca inventa.** La tolerancia es mecánica —sin
tildes, sin plural, aceptando que la frase contenga el id— y no un diccionario de
sinónimos: eso sería vocabulario de negocio volviendo al núcleo.

---

## Un solo productor, cinco consumidores intactos

El hallazgo que hizo posible este arreglo: `requisitosDe()` es el **único**
productor de requisitos, y cinco sitios los consumen (`prompts.ts`,
`contacts.ts`, `estado.ts`, `extraer.ts`, `normalizar.ts`).

**No se tocó ninguno de los cinco.** Reciben el mismo concepto de siempre —"lo
que falta para cerrar"—; solo cambia el contenido de la lista. Ninguno sabe que
la modalidad existe.

---

## Por qué NO sube `SCHEMA_VERSION`

Se comprobó el mecanismo real (`leerEstado`) antes de decidir: un estado se
descarta **solo si su versión es MAYOR** que la del lector.

| | Consecuencia |
|---|---|
| **Subirla a 6** | Durante el despliegue, un contenedor aún en la 5 leería un estado 6 y **tiraría el pedido en curso de una clienta** |
| **No subirla** | Un lector viejo ignora una clave que no conoce. Sin pérdida |

Para un campo **opcional y añadido**, subirla cuesta un riesgo real a cambio de
nada. Los precedentes v2–v4 fueron **sustituciones** (rompían la forma); el v5
fue aditivo y sí subió, pero entonces la tabla estaba vacía — y el propio
docblock avisa de que *"esa ventana se cierra"* con el primer cliente encendido.
Ya está cerrada.

**Ningún estado existente se migró.** No hacía falta.

---

## Las pruebas

`tests/unit/modalidad-de-entrega.test.ts` — 15 comprobaciones que cubren la
semántica, no solo el caso que la descubrió:

| Caso | Qué demuestra |
|---|---|
| **A** Domicilio | La dirección es obligatoria |
| **B** Recogida | Deja de serlo — y `"Recoge en el local"` no acaba en `direccion` |
| **C** Cambio de modalidad | Los requisitos siguen el cambio, en los dos sentidos |
| **D** Modalidad no ofrecida | No se acepta, no se persiste, **y no quita requisitos** |
| **E** Estados antiguos | Una propuesta sin modalidad sigue siendo válida |
| **F** Solo domicilio | Sigue exigiendo dirección |
| **G** Sin domicilio | No empieza a exigirla por este cambio |

Y una que marca el límite a propósito: *"una frase que no contiene el id no se
resuelve, y eso es lo seguro"* — el fallo cae del lado conservador.

### Prueba real por el pipeline

**Recogida** — el caso que originó todo:

```
CLIENTE: paso a recogerlo al local
→ modalidadDeEntrega = "recogida"
→ datos = {"nombre": "Ana Perez", "telefono": "3001234567"}     ← sin dirección
→ confirmado=true · rechazos=0
```

**Domicilio** — el que no podía romperse:

```
CLIENTE: a domicilio por favor
AGENTE:  ¿me confirmas la dirección de domicilio, por favor?
CLIENTE: si confirmo
AGENTE:  ¿Me puedes dar la dirección completa, por favor?       ← se niega a cerrar
→ modalidadDeEntrega = "domicilio" · direccion = null · confirmado=false
```

### Regresión

| | |
|---|---|
| typecheck · lint | limpio |
| Pruebas unitarias | **922**, 0 fallos (15 nuevas) |
| `probar:estado`, dos verticales | **46/46** |
| Prompts de los negocios | **sin cambios** — verificado recompilando antes y después |

---

## Los dos guardarraíles que se dispararon durante el trabajo

Vale la pena dejarlos escritos, porque los dos cazaron errores **míos**:

1. La primera versión de la migración comparaba el prompt recompilado contra el
   **guardado**, y abortó las tres fichas. El motivo no era el cambio: recompilaba
   sin `catalogoEnTabla`, así que metía el catálogo en el prompt de quien ya lo
   tiene en tablas.
2. Corregido eso, seguía abortando en La Churra — por la **deriva anterior** de
   `conducta.ts`, ajena a esto. La comparación correcta es entre la ficha vieja y
   la nueva, **las dos recompiladas**: así se aísla lo que hace esta migración de
   cualquier desfase previo. Ahora esa deriva se informa, no bloquea.

---

## Cómo revertir

```bash
# La condición en las fichas (respaldo por cliente):
#   restaurar `ficha` desde agent_profile_bk_modalidad
git revert <commit>   # el código
```

El campo del estado es opcional: con el código revertido, un estado que ya lo
tenga se sigue leyendo igual y la clave sobrante se ignora. **Los dos pasos son
independientes** y ninguno deja nada a medias.

---

## Riesgos residuales

| | |
|---|---|
| 🟠 | **La modalidad depende de que el modelo la proponga.** El esquema estructurado le impone los valores exactos, pero si un turno no la trae, la modalidad queda sin saber → se pide la dirección igual. Falla hacia el lado seguro |
| 🟠 | **La ficha sigue sin poder expresar una tercera modalidad.** Tiene dos campos sueltos, no una lista. Ampliarlo es alcance mayor y arrastra el cuestionario del alta y pantallas del CRM |
| 🟢 | Un negocio nuevo con domicilio y recogida usa este mecanismo **sin una línea de código propia**: `requisitosSugeridos` ya declara las dos condiciones |
