# Bitácora del 15 de agosto

> **Dentro:** La Fase 1, verificada de verdad · Lo que las mediciones
> desmintieron · El día que una prueba causó el fallo que buscaba · Las cuatro
> puertas · La Fase 2 · Lo que se aprendió

Sesión larga. Empezó con *"¿qué hicimos en la Fase 1?"* y acabó con la Fase 2
implementada, apagada, y **cuatro puertas cerradas por las que los datos podían
cambiar sin que nadie se enterara**.

Se cuenta en orden porque cada cosa salió de la anterior.

---

## 1. La Fase 1 estaba "hecha" pero no desplegada

La documentación decía *"en producción"*. El contenedor en ejecución se había
construido **horas antes del commit**, así que la base decía
`catalog_source = 'tabla'` y el código vivo no sabía leerlo.

No se notó porque el prompt seguía llevando la carta escrita a mano: **el fallo
era invisible desde fuera**.

> 🔑 Un contenedor `healthy` no prueba que lleve el cambio. Y una bandera
> encendida en la base, tampoco.

---

## 2. Las mediciones desmintieron tres cosas que dábamos por ciertas

| Se creía | Se midió |
|---|---|
| La extracción de estado falla mucho | **0 % sobre 160 turnos reales** — con contrato tolerante |
| Un enum cerrado es más seguro | **Rechazaba el 82 %**: el modelo devolvió 70 etiquetas distintas |
| Pedir el estado aparte es más barato | **Es más caro y más lento** que pedirlo en la misma llamada |

La tercera se midió tres veces antes de dar con la buena: las dos primeras
corridas daban resultados falsos porque **el contrato era demasiado severo**, no
porque el modelo fallara.

> 🔑 Cuatro veces en una tarde un contrato rígido se disfrazó de fallo del
> modelo: el enum de `paso`, un esquema que el prompt no describía, el tipo
> numérico de `paso`, y un campo exigido donde no aplicaba. **Las cuatro veces
> el número malo era nuestro.**

---

## 3. Un prompt que se sobrescribía solo

De ahí salió el trabajo de fondo: `agent_profile` tenía **nueve rutas de
escritura** y cinco campos con más de un dueño. La ficha la escribían el
cuestionario **y** el script del operador, y el último ganaba en silencio.

La solución no fue "un escritor por campo", sino distinguir **fuente** de
**derivado**: `instructions` no lo decide nadie, se **compila**. El problema no
era que tuviera tres escritores; era que fuera editable.

> **Cada dato tiene un dueño. Lo derivado no se escribe: se recompila.**

Las fichas de La Churra y el salón se convirtieron a secciones con dueño, con el
prompt idéntico por md5 antes y después, y rollback demostrado.

---

## 4. 🔴 El día que una prueba causó el fallo que buscaba

**A las 19:46:41**, la prueba que verificaba *"el cuestionario no pisa nada del
operador"* **revirtió el horario del salón** de 9:30–18:30 a 9:00–20:00.

Verificaba cinco campos —los que ya sabíamos frágiles— y el horario no estaba en
la lista.

La reconstrucción salió de los **respaldos de 6 en 6 horas**, y destapó algo peor
que el propio fallo: la documentación afirmaba **dos veces** que el horario
estaba *"confirmado en la base"* en 9:30–18:30 **mientras la base decía otra
cosa**.

De ahí salieron dos reglas permanentes:

> **Ninguna prueba valida una lista de campos.** Se compara la fila entera, y
> solo pueden cambiar los campos declarados.
>
> **No se confía en la documentación.** La evidencia es la base y los respaldos.

Y una tercera lección, del dueño: *"el hábito más barato del proyecto resultó ser
el más valioso"* — sin esas copias cada 6 horas, esto habría quedado en la
palabra de uno contra la del otro.

---

## 5. Las cuatro puertas

| Puerta | Qué pasaba |
|---|---|
| **`seed/demo`** | Un endpoint que cambiaba el prompt por el de una ferretería **y borraba el conocimiento**. Su guarda solo miraba si había contactos: todo cliente recién dado de alta estaba expuesto |
| **Horario** | Vivía en dos sitios y `aplicarFicha` lo reescribía en cada reenvío |
| **Catálogo** | Re-sembrar borraba todos los productos y los recreaba desde el texto |
| **Conocimiento** | Seis escritores sobre el mismo montón, uno de ellos borrando |

Las cuatro cerradas, con una prueba por cada una.

---

## 6. Trazabilidad, y la Fase 2

Se instrumentaron los **siete procesos** que escriben datos operativos. Cada
escritura declara qué va a tocar; **lo que cambie sin declararse sale como
`[NO DECLARADO]`**, que el dueño convirtió en la alarma principal del proyecto.

Primera prueba tras desplegar: se provocó **la misma operación culpable** del
incidente y registró un solo campo (`updatedAt`), cero `[NO DECLARADO]`, y el
horario aguantó.

Con eso se arrancó la **Fase 2**: modelo del estado, validador, extractor,
pipeline conectado y **apagado**. Detalle en
[69-FASE-2-ESTADO-ESTRUCTURADO.md](69-FASE-2-ESTADO-ESTRUCTURADO.md).

---

## 7. Lo que se aprendió, en una lista

1. **Un contenedor sano no prueba nada.** Hay que mirar dentro.
2. **Los contratos rígidos se disfrazan de fallos del modelo.** Cuatro veces.
3. **Una alarma que suena siempre es una alarma apagada** (el falso positivo de
   `BESTIES` vs `Besties`).
4. **Verificar una lista de campos es verificar lo que ya sabes que se rompe.**
5. **La doc registra lo que alguien creyó; el respaldo registra lo que pasó.**
6. **Nunca degrades un dato correcto para unificarlo con uno peor** (las salsas).
7. **Medir antes de construir ahorró una columna** (`unidades` habría arreglado
   1 caso de 60) y **descartó una migración entera** (`ficha_v2`).
