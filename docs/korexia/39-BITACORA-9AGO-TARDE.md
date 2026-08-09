# Bitácora: tarde del 9 de agosto de 2026

> **Dentro:** ¿Sigue siendo rentable Lis en octubre? · El costo por llamada, al
> panel · Por qué Lis subió un 43 % · El chat dentro del Pipeline · Los que se
> enfrían ya no se pierden · ¿El bot lee emojis? · Lo que quedó pendiente

Continuación de [35-BITACORA-8-9AGO.md](35-BITACORA-8-9AGO.md). Sesión disparada
por una pregunta de negocio del dueño, no por un bug.

---

## 1. ¿Sigue siendo rentable cobrarle 200.000 a Lis desde octubre?

**Sí, y no está ni cerca del límite.** Meta le suma **~2.300 COP al mes**: el
**1,2 %** de la mensualidad.

Proyección de agosto para Lis (8,5 días reales × 3,65):

| | Mes completo |
|---|---|
| Costo IA | 3,10 USD |
| WhatsApp desde octubre (~900 mensajes) | 0,72 USD |
| **Costo variable** | **3,82 USD ≈ 12.300 COP** |
| **Margen bruto** | **94 %** |

**Punto de equilibrio: 566 conversaciones/día.** Hace 35 — necesitaría 16 veces
su volumen. Aunque triplique en el pico de septiembre, el costo sería el 5,5 %
de la mensualidad.

**Lo que sí pesa no es Meta, es el fijo.** Un salto al plan Growth de YCloud son
39 USD/mes = **54 veces** el impacto de Meta sobre Lis. Ver
[ycloud-facturacion-pagos] en las memorias y [14-COTIZAR.md](14-COTIZAR.md).

⚠️ Dos avisos: la tarifa de 0,0008 es **estimada** (Meta publica las definitivas
antes del 1-sep) y **el panel seguirá diciendo 0 USD en octubre** si no se cierra
el pendiente de traer el precio real de YCloud ([09-COSTOS.md](09-COSTOS.md)).

## 2. El costo por llamada, al panel

El panel mostraba el gasto del mes, que sube tanto si hay más tráfico —bueno—
como si cada llamada se encareció —malo—, sin distinguirlos. Se añadió la
columna **Costo por llamada**, con cinco decimales y promedio ponderado en el
total. Detalle y decisiones en [09-COSTOS.md](09-COSTOS.md).

Ahí mismo se aclaró por escrito lo que confundía al dueño: **"Respuestas IA" son
llamadas al modelo, no mensajes enviados** (por eso siempre son más), y
**"Mensajes" son solo los SALIENTES**.

## 3. Por qué Lis había subido un 43 % por llamada

Investigado sobre `usage_event`. **Dos llamadas de 296** —el 0,7 % del tráfico—
se llevaron el **22 % del gasto**:

| Cuándo | Origen | Tokens de entrada | Costo |
|---|---|---|---|
| 3-ago 15:51 | rescate del agente, conversación de 44 mensajes en un día | 48.111 | 0,0967 |
| 4-ago 01:13 | módulo de **aprendizaje** | 54.792 | 0,0880 |

Las dos son caídas al modelo de respaldo (Sonnet 4.5). **Una caída cuesta como
~45 llamadas normales de Gemini.** Sin ellas Lis estaría en 0,00225, a un pelo de
La Churra (0,00197); el resto es que su prompt es más grande (7.505 tokens de
entrada frente a 6.675).

Dos cosas que conviene recordar: el aprendizaje normalmente corre con Gemini y
cuesta ~0,006 —esa noche cayó a Sonnet y costó 15× más—, y **es un proceso de la
agencia, no atención a clientas, pero se carga a la cuenta del cliente**.

## 4. El chat dentro del Pipeline (solo lectura)

Reporte del dueño: *"le damos al botón y nos arroja a la lista de conectados, y
si queremos revisar otro cliente tenemos que volver"*. El botón de la tarjeta era
un enlace que **sacaba del tablero** hacia la Bandeja.

Ahora la conversación se abre **en un panel a la derecha, sin salir del
Pipeline**. Casi todo estaba hecho y suelto: se reutilizan `MessageThread` y la
API de mensajes tal cual.

**Solo lectura a propósito**: responder arrastra el compositor, el relevo del
agente y la ventana de 24 h — la lógica delicada de la Bandeja, donde ya está
probada. El pie del panel enlaza allí.

Tres decisiones: se refresca cada 6 s pero **se detiene con la pestaña en segundo
plano** (un solo núcleo); al cambiar de tarjeta **se remonta**, para no heredar
el scroll ni mostrar un instante los mensajes del cliente anterior bajo el nombre
del nuevo; y en móvil se abre a pantalla completa.

## 5. Los que se enfrían ya no se pierden

El dueño: *"los clientes que se enfrían son importantes y deben ir allí"*.

La columna de perdidos marcaba 0 porque **no había ningún camino automático**:
solo llegaba quien ANUNCIABA que se iba. A los **2 días** sin respuesta la
tarjeta baja sola, y quien vuelve a escribir sube sola. Renombrada a **"Por
recuperar"**.

Todo el razonamiento, los datos que descartaron los umbrales de 7 y 15 días, y
las 9 pruebas contra Postgres real:
[37-EMBUDO-VENTAS-INVISIBLES.md](37-EMBUDO-VENTAS-INVISIBLES.md).

**Verificado en producción** tras desplegar: `[worker] 49 tarjeta(s) movida(s)
por enfriamiento`. El tablero quedó así, con los totales cuadrando y **sin sacar
a ningún cliente ganado**:

| | Nuevo | En conversación | Cliente | Por recuperar |
|---|---|---|---|---|
| La Churra | 1 | 7 (antes 29) | 6 | **23** |
| Lis | 1 | 10 (antes 35) | 33 | **26** |

## 6. ¿El bot lee emojis?

Sí. **Verificado con datos reales**, no por lectura del código: 116 mensajes
entrantes con emoji, 5 de ellos **solo un emoji**. De esos 5, el agente respondió
4; el que no (`☺️`, 3-ago) estaba en **relevo humano desde 10 segundos antes** —
habría callado con cualquier texto.

Los límites reales están en [24-MENSAJES-UNSUPPORTED.md](24-MENSAJES-UNSUPPORTED.md):
reacciones y stickers.

## 7. Lo que quedó pendiente

- **Borrar la etapa "Interesado"** — la hace el dueño desde *Gestionar etapas*
  (tiene 0 tarjetas). Se le explicó; no se tocó por él.
- **Ocultar una etapa del tablero sin borrarla.** El dueño quería ver solo tres
  columnas, pero las anclas `won`/`lost` no se pueden eliminar —y hacen bien: un
  lead cerrado tiene que poder ir a algún sitio—. Haría falta un interruptor de
  "mostrar en el tablero" por etapa, que es **cambio de esquema**. No autorizado,
  no se hizo.
- **El avatar parte los emojis del nombre**: "Kathe 😜" muestra `K◆` en el
  Pipeline. Cosmético, no afecta a las conversaciones. Ofrecido, no pedido.
- **Que el agente entienda reacciones y stickers** — hoy no los ve.
- Sigue pendiente de antes: **traer el precio real de cada mensaje de YCloud**
  antes de octubre.

## El patrón de la sesión

Tres de los cinco cambios salieron de **medir antes de decidir**, y en dos casos
los datos contradijeron la propuesta inicial del asistente:

- Se iba a recomendar **15 días** para enfriar: con ese umbral no se habría
  movido **ninguna** tarjeta. El dueño propuso 2 por conocimiento del negocio
  —*"son antojos y una necesidad inmediata"*— y los datos le dieron la razón.
- Las pruebas contra Postgres real **encontraron un fallo antes de desplegar**:
  el driver revienta al enlazar un `Date` dentro de un `sql` crudo.
