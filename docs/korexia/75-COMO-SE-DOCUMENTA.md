# Cómo se documenta en este proyecto

> **Dentro:** La regla · Las siete obligaciones · El orden · Cuándo un cambio
> está terminado · La plantilla de bitácora · Dónde va cada cosa · De dónde sale
> esta regla

**Dictada por el dueño el 16-ago-2026.** No es una recomendación de estilo: es
un criterio de aceptación. Un cambio que no la cumpla **no está terminado**,
aunque funcione y aunque las pruebas estén en verde.

---

## La regla

> **Queda prohibido acumular cambios sin documentarlos. Toda modificación deberá
> documentarse inmediatamente después de realizarse y antes de comenzar
> cualquier otra tarea.**

La documentación deja de ser una tarea posterior y pasa a formar parte del
cambio. Código, pruebas y documentación viajan en el **mismo commit**.

## Las siete obligaciones

De cada cambio se registra, como mínimo:

1. **Qué** se cambió.
2. **Por qué** se cambió.
3. **Qué archivos** se modificaron.
4. **Qué riesgo** se intentó corregir.
5. **Qué pruebas** se ejecutaron.
6. **Qué resultado** dieron.
7. **Cómo revertirlo.**

> 🔑 **La séptima es la que faltaba.** Los cuatro commits del 16-ago traían las
> seis primeras y ninguno decía cómo deshacerse. Se documentaron a posteriori en
> [73-BITACORA-16AGO.md](73-BITACORA-16AGO.md), que es justo lo que esta regla
> viene a impedir.

## El orden, que no es negociable

```
analizar → implementar → probar → documentar → confirmar → siguiente tarea
```

Y el que queda **prohibido**:

```
implementar → acumular varios cambios → documentar al final
```

La diferencia no es de forma. Documentar al final se hace desde la memoria de lo
que uno **cree** que hizo; documentar en el momento se hace desde lo que
**pasó**. Este proyecto ya tiene la factura de esa diferencia: el 15-ago la
documentación afirmaba dos veces que el horario del salón estaba *"confirmado en
la base"* mientras la base decía otra cosa, y reconstruirlo costó una auditoría
forense sobre los respaldos.

## Cuándo un cambio está terminado

Las cuatro a la vez, o no está:

| | |
|---|---|
| ✅ | El código compila (`tsc --noEmit`) |
| ✅ | Las pruebas en verde (`vitest run`) |
| ✅ | La documentación actualizada |
| ✅ | La estrategia de reversión, escrita |

## La plantilla de la bitácora

```markdown
### <hora> · <título en una línea>

**Objetivo**: qué se buscaba, en una frase.
**Archivos**: los que cambiaron, con su papel.
**Riesgos**: qué podía salir mal, y qué se hizo para que no saliera.
**Evidencia**: los números — pruebas ejecutadas y su resultado.
**Reversión**: el comando exacto, y qué vuelve al estado anterior.
**Estado**: terminado · parcial · revertido.
```

## Dónde va cada cosa

| Qué | Dónde |
|---|---|
| El relato del día, cambio a cambio | La bitácora del día (`73-…`, `71-…`) |
| Cómo funciona algo, para el que llegue nuevo | El documento técnico del tema |
| Qué falta y en qué orden | El documento de seguimiento de la fase (`72-…`) |
| Una regla que no se puede saltar nadie | Su propio documento (`66-`, `74-`, este) |
| El puntero a todo lo anterior | [00-INDICE.md](00-INDICE.md) |

Un cambio suele tocar **dos o tres** de esas filas. Ninguna es opcional por
prisa.

---

## Principio rector

> **La documentación es una fuente de verdad, no un resumen histórico. Si el
> código y la documentación difieren, el trabajo está incompleto** — y el que
> miente es el documento, porque el código es lo que corre.

Corolario de este proyecto, aprendido dos veces en dos días: *"lo dice la
documentación"* no es evidencia de nada. Lo son la base de datos, los respaldos
y lo que hay **dentro del contenedor**. Ver
[68-UN-DUENO-POR-DATO.md](68-UN-DUENO-POR-DATO.md).

## De dónde sale esta regla

De tres hechos del 15 y el 16 de agosto, todos con la misma forma:

1. `69-FASE-2` afirmaba que la Fase 2 estaba **desplegada**. No lo estaba: la
   imagen viva era anterior a cuatro commits.
2. `67-FASE-1.5` daba por corregido el patrón del *"primer grupo con opciones"*
   mientras el pipeline seguía usándolo — un bug que se habría activado el día
   de la carga de opciones.
3. `69-FASE-2` describe `leerAporte()` como parte del flujo. **No lo llama
   nadie.** Sigue pendiente de decidir.

Ninguno de los tres fue un error de código: los tres fueron un documento que
dejó de ser verdad y nadie actualizó. Esta regla existe para que el siguiente no
pueda ocurrir.
