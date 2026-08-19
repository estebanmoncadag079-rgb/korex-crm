# El catálogo vive en Servicios

> **Dentro:** La decisión · Las dos mitades que no se hablaban · Qué hace cada
> puerta · Las trampas que costaron una ronda

Sale de [52-CARGAR-EL-CATALOGO-DE-CITAS.md](52-CARGAR-EL-CATALOGO-DE-CITAS.md),
que llegó a su límite de tamaño. Aquí está **dónde vive el catálogo de un
negocio de citas y cómo se mantiene al día**.

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

---

## Categorías: un desplegable, no texto libre (18-ago-2026)

**El campo "Categoría" era un cuadro de texto vacío**, y el texto libre en un
catálogo degenera siempre igual: `Pestañas`, `pestañas` y `PESTAÑAS` conviviendo
como tres categorías distintas. Ahora es un **desplegable** con las que el
negocio ya usa, más `+ Nueva categoría…` para crear una — reutilizar es lo
fácil, crear es lo deliberado.

Y encima de la lista de servicios hay un panel de **Categorías** que permite
**renombrar** y **eliminar**, con el número de servicios de cada una.

> **No hay botón de "crear" ahí, y no es un olvido.** Una categoría **no es una
> entidad**: no tiene tabla. Es el valor que comparten varios servicios, y
> nace cuando el primero la usa. Una categoría vacía no se podría mostrar ni
> agruparía nada. Guardarlas aparte obligaría a sincronizar dos fuentes y a
> decidir qué hacer con las que ya no usa nadie — el problema del dueño por
> dato que este proyecto ya pagó ([68](68-UN-DUENO-POR-DATO.md)). Lo derivado
> se recompila: la lista sale de los servicios, siempre.

**Eliminar una categoría deja sus servicios sin categoría. Nunca borra un
servicio** — y se avisa con el número exacto antes de hacerlo, porque un
catálogo de 46 no se revisa a ojo después. Renombrar y eliminar son la misma
operación (`PATCH /api/services/categorias`, con `hasta: null` para eliminar) y
va **en lote**: hacerlo servicio por servicio desde el navegador serían decenas
de peticiones que pueden fallar a medias y dejar media categoría renombrada.

Una prueba encontró un fallo al escribirlas: la lista se quedaba con la
**última** forma en que aparecía escrita una categoría, no con la primera. Con
las filas en otro orden, el desplegable cambiaba solo.

## Los servicios de una persona se guardan, ya no al tocar

**Cada casilla de la matriz guardaba sola, al instante.** Con 46 servicios
juntos, un clic de más —o un roce en el móvil— asignaba un servicio a alguien
que no lo hace, sin aviso y sin forma de deshacerlo. Y **el agente agenda con
esa matriz**: una casilla marcada por error manda una clienta con la
especialista equivocada.

Ahora hay **Editar servicios → Guardar / Cancelar**. Mientras se edita aparece
*"Sin guardar"*, y `Guardar` está apagado si no hay ningún cambio. Al volver a
entrar se parte siempre de lo guardado, no de lo que se canceló.

De paso, **en reposo se muestran solo los servicios que sí atiende**: la lista
completa con casi todo desmarcado ocupaba media pantalla por persona y no había
forma de leer de un vistazo qué hace cada quien.

**Cómo revertir**: `git revert` del commit. No toca esquema, ni datos, ni el
agente — es la pantalla. Los datos que escribe son los mismos de antes
(`service.category` y `staff_service`).
