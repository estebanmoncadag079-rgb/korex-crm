# Arquitectura multiempresa: las decisiones del 17-ago

> **Dentro:** La restricción que manda sobre todo · Las siete reglas · Las tres
> decisiones · La hoja de ruta en cuatro pasos · La ventana que se cierra · Qué
> queda congelado

**Dictadas por el dueño el 17-ago-2026**, después de la auditoría del modelo de
las opciones ([77](77-EL-MODELO-DE-LAS-OPCIONES.md)) y del informe de impacto
([78](78-CAMBIAR-EL-MODELO-IMPACTO.md)). Son **restricciones de diseño**, no
recomendaciones: un cambio que las incumpla no entra.

---

## Quién es quién

**VOCERO es el CRM y la plataforma.** Los negocios son sus clientes, repartidos
en dos verticales — y **ninguno de los dos tiene un solo cliente**:

| | Clientes reales |
|---|---|
| **Pedidos** | La Churra · Lis Pastelería |
| **Citas** | Lashes Valen |

### 🔒 El orden, congelado (17-ago-2026)

| | Cliente | Qué valida | Estado |
|---|---|---|---|
| **1** | **La Churra** | El flujo completo de pedidos, en real | 🟡 encendiéndose |
| **2** | **Lashes Valen** | **La parte más compleja de toda la arquitectura**: recursos, profesionales, disponibilidad y reservas | ⏳ paso 4 |
| **3** | **Lis Pastelería** | **La replicabilidad**: que VOCERO incorpore un negocio nuevo **sin tocar el núcleo** | ⏳ **al final, y a propósito** |

> **Lis no vuelve a la hoja de ruta antes de tiempo.** Su valor no es ser el
> segundo cliente de pedidos: es ser **la prueba de que la arquitectura se
> replica**. Y esa prueba solo significa algo cuando los dos modelos —pedidos y
> citas— ya estén estabilizados. Migrarla antes la convertiría en otro cliente
> más que corregir, en vez de en la comprobación que cierra el proyecto.
>
> Si una funcionalidad va en La Churra y falla en Lis, **no habremos construido
> una plataforma: habremos automatizado La Churra.** Por eso va la última, y por
> eso importa.

Lo que ya se sabe de Lis, para cuando llegue su turno: **su catálogo cabe en el
modelo** —tiene precios y tamaños (`12 oz`, `16 oz`)—, pero **no tiene ficha y
su prompt de 17.058 caracteres está escrito a mano**. Su alta es trabajo de
alta, no de arquitectura, y habrá que decidir una sola cosa: si un tamaño es
**otro producto** o **un grupo de opciones con recargo**.

Eso cambia una cosa de fondo: el paso 4 **no es una mejora futura**. Es lo que
le falta a un cliente que ya existe para correr sobre la misma arquitectura que
acaba de construirse para pedidos.

### Las tres capas

| Núcleo compartido (VOCERO) | Vertical de pedidos | Vertical de citas |
|---|---|---|
| Catálogo · Selección · Datos · Estado · Validación · Confirmación · Registro | Productos · Grupos de opciones · Entrega · Domicilios | Servicios · **Recursos** · **Disponibilidad** · **Reservas** · **Profesionales** |

Lo de la izquierda está hecho. Lo del centro, encendiéndose. **Lo de la derecha,
en negrita, es el paso 4.**

---

## La restricción que manda sobre todo

> **Esta arquitectura NO se está construyendo para La Churra.** La Churra es el
> primer caso de uso y el entorno de validación. El objetivo es una plataforma
> capaz de sostener **varios tipos de negocio con el mismo núcleo
> conversacional**.

Y de ahí sale la pregunta con la que se evalúa cualquier cambio:

> ### ¿Esta solución sigue funcionando cuando el negocio no vende comida?

Si la respuesta es no, la solución se replantea. **No se corrige: se
replantea.**

## Las siete reglas

1. **Prohibida la lógica específica de La Churra en el núcleo.**
2. **Ningún nombre de grupo codificado en la lógica del estado** — ni `salsas`,
   ni `recubierto`, ni `adiciones`.
3. **El estado del pedido no puede depender del catálogo de un solo negocio.**
4. **La definición del catálogo y la selección del cliente son dos modelos
   distintos.**
5. **Las reglas del negocio se configuran desde el CRM.**
6. **Un cliente debe poder definir su metodología sin que nadie toque código.**
7. La pregunta deja de ser *"¿cómo funciona La Churra?"* y pasa a ser **"¿cómo
   describe cualquier negocio lo que vende?"**
8. **Ningún cambio se implementa pensando en un cliente.** Todo cambio responde
   antes a esta pregunta: **«¿puede usarlo cualquier negocio de VOCERO sin
   modificar el núcleo?»** Si la respuesta es no, no entra.
9. **Ninguna decisión arquitectónica se justifica con un cliente concreto.**
   Toda modificación se valida contra **al menos un cliente de pedidos y uno de
   citas** — y si el segundo todavía no puede probarse en vivo, contra su
   equivalente en pruebas. Es la regla que habría evitado que las salsas de un
   negocio acabaran dentro del núcleo.
10. ⛔ **Ningún flujo del CRM puede asumir que un pedido contiene un único
    producto.** Aplica al núcleo, al prompt, a la ficha, al cuestionario, a las
    pruebas y a los escenarios. Un flujo que solo sepa sostener un producto **no
    está terminado**, aunque funcione para el negocio que lo pidió.

    Nació el 17-ago de una conversación real ([87](87-PEDIDOS-MULTIPRODUCTO.md)),
    y conviene recordar de dónde: **no la pidió un cliente**. La pidió alguien
    que hizo lo más normal del mundo — pedir dos cosas de una vez.

## Las tres decisiones

### 1. La Fase 2 es un componente COMÚN, no del vertical de pedidos

Hoy el pipeline la excluye de citas por diseño
(`!profile.appointmentsEnabled && …`). Deja de ser aceptable: el estado
estructurado tiene que servir a restaurantes, salones y a los verticales que
vengan.

### 2. El estado se unifica en una SELECCIÓN

```
seleccion: [ { grupoId, opcionId, cantidad } ]
```

Tres de los cinco errores de la noche del 16 **dejan de ser expresables** en
cuanto cada elemento sabe a qué grupo pertenece
([78](78-CAMBIAR-EL-MODELO-IMPACTO.md), §7).

### 3. El dueño del flujo es el CRM, no el backend

Hoy están en código: el orden de las preguntas, los requisitos para cerrar y los
campos obligatorios. Eso es configuración de cada negocio, y su sitio es Pocero.

---

## La hoja de ruta

| Paso | Qué | Estado |
|---|---|---|
| **1** | **La selección genérica.** Solo eso. Sin tocar citas | ✅ **hecho el 17-ago** |
| **1.5** | **`entrega` fuera del núcleo**: los requisitos los declara cada negocio | ✅ **hecho el 17-ago** ([81](81-REQUISITOS-DECLARATIVOS.md)) |
| **2** | **Un solo dueño para el vertical** | ✅ **hecho el 17-ago** |
| **3a** | `permiteRepeticion` + tipo de dominio común (`Ofrecible`). **Sin migración** | ✅ **hecho el 17-ago** ([82](82-EL-CATALOGO-AL-CRM.md)) |
| **3.5** | **Blindar el modelo de la ficha**: una transformada nunca se persiste | ✅ **hecho el 17-ago** ([84](84-EL-MODELO-DE-LA-FICHA.md)) |
| **3.6** | 🛑 **SELECCIÓN MÚLTIPLE, EN LOS DOS VERTICALES.** No es «pedidos con varios productos»: es que ni pedidos ni citas saben sostener varios elementos, **en dos motores que no comparten código**. **Bloquea el encendido** | 🔄 **auditado, sin decidir** ([88](88-AUDITORIA-SELECCION-MULTIPLE.md) manda sobre [87](87-PEDIDOS-MULTIPRODUCTO.md)) |
| **3b** | **Grupos de opciones para `service`.** Primera migración con datos vivos | ⬜ |
| **4a** | Disponibilidad genérica (`recursoIds`), **sin tocar tablas** | 🔄 auditado ([83](83-RECURSOS-Y-RESERVAS.md)) |
| **4b** | `recurso` + `reserva_recurso` y el solape movido. **La migración más cara del proyecto** | ⬜ |
| **4c** | Horario por recurso | ⬜ |
| **5** | Solo entonces, **encender** | ⬜ |

## Las tres preguntas obligatorias

Antes de dar por bueno cualquier desarrollo:

1. **¿Funciona para un restaurante?**
2. **¿Funciona para un salón de belleza?**
3. **¿La configuración pertenece al CRM o está codificada en el backend?**

Si una respuesta es negativa, **el cambio no se implementa**. No es una lista de
comprobación amable: es la que habría impedido que la Fase 2 naciera con los
grupos de un solo negocio dentro.

---

## Paso 1, hecho: el contrato nuevo (17-ago)

```ts
// antes — los grupos de UN negocio, dentro del núcleo
salsas: string[] · recubierto: string | null · adiciones: string[]

// ahora — lo que eligió el cliente, sea el negocio que sea
seleccion: [{ grupoId, grupoNombre, opcionId, nombre, precioDeltaCents }]
```

**Lista con repetición, sin `cantidad`** (decisión del dueño). Dos de arequipe
son dos elementos: `seleccion.length` cuenta, `> maxSelect` valida, recorrer y
sumar cobra, y el orden se conserva solo. Con `cantidad` reaparecían cuatro
preguntas —¿el máximo cuenta opciones o unidades?, ¿quién suma?, ¿quién
valida?— que son justo las que producían los errores. `cantidad` se puede
añadir después si un negocio la necesita; el camino contrario es mucho más caro.

**Se guardan también `nombre` y `precioDeltaCents`**, como ya se hacía con el
producto: si el negocio renombra la opción o le cambia el precio, el pedido
guardado sigue siendo legible. ⚠️ El precio guardado **no se usa para
calcular** —el total se recalcula siempre desde el catálogo—: es testimonio de
lo que se cobró aquel día.

### Lo que desapareció del núcleo

`grupoDeSalsas` · `grupoDeAdiciones` · `grupoLlamado` · `sumaDeExtras` · el
bloque del recubierto · `faltaParaCerrar` con su lista escrita a mano · las
claves `salsas`/`recubierto`/`adiciones` de la clasificación de logs · y los
tres campos del prompt de extracción.

Ahora **todo sale del catálogo**: las reglas de cada grupo (`minimo`, `maximo`),
sus nombres y sus precios. Una manicura con *ESMALTE* funciona sin tocar una
línea — hay una prueba que lo comprueba con un catálogo de salón.

### El prompt, y por qué el contrato con el modelo NO cambia de naturaleza

El LLM sigue hablando **por nombres**, nunca por ids: dice
`{"grupo": "SALSAS", "opcion": "arequipe"}` y el backend resuelve. Lo único que
se le pide de más es **que nombre el grupo**, porque el mismo nombre puede
estar en dos con precios distintos — que es exactamente el cobro doble del
16-ago, ahora imposible: sin grupo y con ambigüedad, **se pregunta**.

---

## Paso 2, hecho: una sola fuente para el vertical (17-ago)

Había dos, y podían contradecirse:

| Fuente | Qué gobernaba | Quién la escribe |
|---|---|---|
| `agent_profile.appointments_enabled` | **Los permisos**: 8 rutas devuelven 403 si está en `false`. Y el pipeline | `provisioning` al dar de alta · `/admin` después |
| `ficha.vertical` | **El prompt**: el cierre, el catálogo, el horario | El cuestionario del cliente · `/admin` |

Existía un aviso para cuando discrepaban, **y ese aviso era la señal del
problema**: un negocio con la ficha de citas y la columna en `false` tendría un
agente prometiendo *"te agendo"* mientras la API rechaza la reserva con un 403.
El cliente se queda esperando una cita que nadie creó.

### Manda la COLUMNA, y la razón de peso es de seguridad

`api/onboarding` va con `withAuth`, **no con admin**: lo llama el propio
cliente. Si mandara la ficha, cualquier cliente **se activaría un vertical que
no contrató** editando su cuestionario. Un permiso no puede depender de un JSON
que edita quien lo usa.

A eso se suma que el vertical **es lo que se contrata** —lo escribe quien lo
vende— y que en este proyecto **lo derivado se recompila**
([68](68-UN-DUENO-POR-DATO.md)).

`ficha.vertical` no desaparece: **pasa a ser una copia derivada**, como
`producto.nombre` en el estado. Se normaliza al escribir, así que ya no puede
contradecir a la columna.

### Cómo quedó

- `@/server/vertical` — un módulo de 3 funciones. **El único sitio que traduce**
  `appointments_enabled` a un vertical, para que el día del tercero se toque uno.
- `generarPerfil(ficha, { vertical })` — el vertical entra por `opciones`, igual
  que `catalogoEnTabla`, cuyo comentario ya decía *"lo decide la columna, no la
  ficha"*. **El precedente estaba escrito desde el 15-ago.**
- `aplicarFicha` **corrige** la ficha en vez de avisar, y lo registra.
- La **vista previa** de `/admin` usa el vertical contratado: el sitio donde se
  revisa un prompt es justo donde no puede mentir.

> ⚠️ **Sigue siendo un booleano.** Un tercer vertical no cabe en
> `appointments_enabled` y pedirá una columna de texto — una migración. El
> módulo existe para que ese día sea un solo cambio.

## 🔴 Lo que queda CONGELADO

**Ni una corrección más específica de La Churra.** En concreto, y a propósito:

- `faltaParaCerrar()` (tarea 2C) — **no se toca**: se rehace entero en el paso 1.
- El `"0"` del reinicio — se resuelve como configuración en el paso 3, no como
  parche.
- La carga de `RECUBIERTO` y `ADICIONES` en La Churra — **no se ejecuta**: el
  modelo que la valida está a punto de cambiar.
- El encendido de la bandera, en cualquier cliente.

## La ventana que se cierra

`conversation_state` está **vacía** — verificado en producción el 17-ago: 0
filas, 0 organizaciones, los cuatro clientes en `'prompt'`.

Eso permite cambiar **el contrato central del sistema sin una sola migración de
datos y sin romper ninguna conversación viva**. El propio código trata un
`schema_version` desconocido como *"se empieza limpio"*: con pedidos en curso,
eso significaría perder el pedido de alguien.

> **Es el único argumento de esta lista que caduca.** Dentro de un mes, con la
> Fase 2 encendida, este cambio deja de ser gratis y pasa a ser una migración
> con conversaciones reales encima.
