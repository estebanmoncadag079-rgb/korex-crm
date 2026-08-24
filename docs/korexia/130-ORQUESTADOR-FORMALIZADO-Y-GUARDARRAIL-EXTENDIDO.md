# Orquestador formalizado y guardarraíl 7 extendido a más literales

> **Dentro:** La tarea C de la ronda del 24-ago (doc 128) · Parte 1: por qué el
> orquestador NO se refactoriza a una lista (y no es pereza, es la regla 12) ·
> Parte 2: el detector de contenido obligatorio, generalizado de "solo enlaces"
> a cualquier literal inconfundible · Qué literales entran y cuáles NO, y por
> qué · Pruebas · Cómo revertir
>
> ✅ **Implementado y probado (968 pruebas unitarias, 0 fallos), 24-ago-2026.**
> ⚠️ **NO desplegado**: este documento cierra el trabajo de código en la rama
> `arquitectura/fase-siguiente-24ago`. El despliegue y su verificación DENTRO
> del contenedor son la tarea 131 (doc reservado en [128](128-COHERENCIA-ARQUITECTURA-PROMPT-MAESTRO.md)),
> con la regla infalible de siempre: un contenedor `healthy` NO prueba que lleve
> el cambio ([02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md)).

## De qué tarea sale esto

La tarea **C** de la ronda del 24-ago ([128](128-COHERENCIA-ARQUITECTURA-PROMPT-MAESTRO.md)):
*"extender el patrón del guardarraíl 7 a más reglas literales verificables
definidas desde el CRM, sin tocar flujo/estado"*. El guardarraíl 7
([125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md)) ya era genérico y
data-driven —leía `kb_entry`/`reglasPropias` del CRM y forzaba el contenido sin
código por cliente— pero **solo cubría enlaces**. C amplía qué literales cubre,
respetando el límite que el propio 125 se puso: nada que no se pueda comprobar
por código de forma determinista.

El scope permitido eran dos archivos: `src/server/ai/pipeline.ts` (Parte 1) y
`src/server/ai/contenido-obligatorio.ts` (Parte 2). Al final **solo se tocó el
segundo** — la Parte 1 se descartó por diseño, no por falta de tiempo.

---

## Parte 1 — el orquestador NO se convierte en una lista de guardarraíles

**Decisión: no se refactoriza.** `runAgentTurn` en `pipeline.ts` aplica hoy la
secuencia de guardarraíles como bloques `if` en orden. La tarea pedía evaluar si
esa secuencia se puede leer mejor como *una lista/estructura nombrada* **sin
cambiar orden ni comportamiento**, y hacerlo solo si es de bajo riesgo. No lo
es, por tres motivos verificados leyendo el código:

1. **Estado mutable encadenado.** Cada guardarraíl lee y reasigna la misma
   variable `action`, y varios además hacen `.push` sobre el array `messages`
   (el bucle de `consult_availability`) o dependen de un contador de ese bucle
   (`consultas === 0`). La entrada de un guardarraíl es la salida del anterior.

2. **Salidas tempranas heterogéneas.** Al menos siete bloques hacen
   `await derivarAUnaPersona(...)` seguido de `return { action: "handoff", … }`,
   abortando el turno entero. Otros (producto olvidado, sin total, resumen mal
   armado) NO derivan: registran y siguen. Una lista uniforme `for (const g of
   guardarraíles)` necesitaría un protocolo de control de flujo (una señal
   "continúa con esta acción" vs "aborta, ya derivé") para reproducir esos dos
   comportamientos.

3. **No son uniformes.** Uno es un `while` de dos vueltas; otro (disponibilidad
   sin verificar) tiene una re-consulta anidada; otro (requisitos) hace una
   consulta asíncrona a la base antes de decidir. No comparten una firma común
   que una lista pudiera nombrar sin inventar una abstracción.

Esa abstracción —un tipo `Guardarrail { detectar, corregir, alEscalar }` con su
motor de aplicación— **es exactamente el "motor de reglas genérico" que el doc
128 declara fuera de scope a propósito**, y su construcción arriesga justo lo
que la regla 12 de [66](66-REGLAS-FASE-2.md) protege: el orden y la semántica de
las salidas tempranas. El coste de un error aquí es alto (un guardarraíl que
deja de saltar, o que deriva de más) y el beneficio es solo cosmético.

Por eso `pipeline.ts` **no se modificó en absoluto**. Es la aplicación literal
de la instrucción final de la regla 66 (*"implementa únicamente la mínima
cantidad de código necesaria… no rediseñes"*) y del criterio de la propia
tarea: *"es más importante no romper nada que dejarlo bonito"*. El orquestador
ya está formalizado y documentado como tal en [128](128-COHERENCIA-ARQUITECTURA-PROMPT-MAESTRO.md);
no necesita reescribirse para serlo.

---

## Parte 2 — el detector, de "solo enlaces" a cualquier literal inconfundible

### Qué cambió

Hasta hoy `contenido-obligatorio.ts` tenía un único patrón, `URL_RE`, y todo el
mecanismo hablaba de "enlaces". Ahora hay una **lista nombrada de detectores**,
donde el enlace es solo el primer tipo:

```ts
const DETECTORES_DE_LITERAL: readonly RegExp[] = [
  /https?:\/\/[^\s)\]}"'<>]+/g,          // enlace
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,  // correo
  /\+\d[\d\s().-]{6,}\d/g,               // teléfono con prefijo internacional
];
```

`extraerContenidoObligatorio` ya no busca solo URLs: recorre todos los
detectores (`literalesEn`) sobre el mismo texto del CRM. **El resto del
mecanismo no cambió**: el disparador sigue saliendo de la `question` del
`kb_entry` o de la cláusula condicional de la `reglaPropia`, la detección sigue
siendo por raíces de 4 letras, y la garantía en tres pasos (modelo → reintento →
el servidor lo añade) es la misma. Un correo o un teléfono se verifican por
`includes` exactamente igual que una URL.

### La regla para entrar: forma inconfundible, no juicio

Un literal solo entra si **su FORMA es inconfundible** por sí sola, para que
extraerlo del texto del CRM no lo confunda con un precio, una cantidad o una
fecha. Es el mismo riesgo del **falso positivo de Rappi**
([125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md)): sacar del texto lo
que no es lo que parece.

| Tipo | Entra | Por qué |
|---|---|---|
| Enlace (`http(s)://…`) | ✅ | El esquema lo hace único |
| Correo (`x@dominio.tld`) | ✅ | La `@` con dominio y punto no aparece en un precio; un `@usuario` de redes (sin dominio) no coincide |
| Teléfono con prefijo (`+57 300…`) | ✅ | El `+` inicial y los 8+ dígitos lo separan de una cifra suelta |
| Teléfono local pelado (`3001234567`) | ⛔ | Indistinguible de un total o una referencia en prosa libre |
| Dirección exacta | ⛔ | No tiene una forma reconocible por regex sin juicio |
| Llave/código de pago numérico | ⛔ | Mismo problema del teléfono pelado: son dígitos sueltos |

Los tres que quedan fuera **no es que no se puedan verificar por `includes`** —
sí se puede, si ya tienes el literal—. El problema es **extraerlo del texto**:
en prosa libre, un número suelto es igual a "$45.000" o "3 unidades", y forzar
la cifra equivocada dentro de cualquier respuesta es peor que no forzar nada.
Esos esperan al **editor donde el dueño DECLARA el literal explícitamente**
(hoja de ruta #2 del doc [128](128-COHERENCIA-ARQUITECTURA-PROMPT-MAESTRO.md)),
no a que el código lo adivine. Es la misma frontera honesta que ya trazó el 125:
lo que no se puede comprobar sin ambigüedad, no se fuerza.

> Esto es "hacer MENOS y documentarlo" a propósito: se añadió el subconjunto
> seguro de los literales que pedía la tarea (correo, y el teléfono cuando viene
> en formato internacional), y se dejaron fuera con razón escrita los que no lo
> son.

### Cambios de redacción, para que el mecanismo sea honesto

Como ahora el literal puede no ser un enlace, dos textos dejaron de decir
"enlace": la corrección al modelo (`correccionDeContenidoFaltante`) ahora dice
*"el dato exacto que debía llevar"*, y los comentarios/doc del módulo hablan de
"literal (enlace, correo, teléfono…)". Ninguno cambia la lógica.

### Qué NO se tocó

- **`pipeline.ts`**: cero cambios (Parte 1). El guardarraíl 7 consume las mismas
  cuatro funciones exportadas con las mismas firmas.
- **El flujo conversacional ni el estado** (`conversation_state`): este
  guardarraíl solo comprueba un literal en el servidor; no le da el estado al
  modelo ni cambia `saludar → opciones → datos → resumen → cobrar`. Regla 2, 4 y
  12 de [66](66-REGLAS-FASE-2.md), intactas.
- **El disparador**: sigue saliendo de campos que ya existen, sin pantalla ni
  columna nueva.
- **La heurística de raíces** y el corte de la cláusula de Rappi: idénticos.

### Limitación conocida (no un descuido)

Una URL con `userinfo` (`https://user@host.com/…`, prácticamente inexistente en
los KB reales de la flota) haría que el detector de correo saque además
`user@host.com`. No es un bug de correctitud —el enlace completo se sigue
forzando— solo una redundancia cosmética si el servidor tuviera que añadir el
literal a mano. Se documenta en vez de codificar un dedup por substring, para no
meter lógica con sus propios bordes por un caso que no ocurre.

---

## Pruebas

Se ampliaron las de `tests/unit/contenido-obligatorio.test.ts` con 6 casos que
fijan la frontera seguro/inseguro: correo desde conocimiento y desde una regla
con disparador (sí se extraen), teléfono internacional con sus espacios tal cual
(sí), y tres negativos que **deben** quedar fuera —teléfono local pelado, precio
con signo (`+50000`), y `@usuario` de redes— para que nadie los "arregle" sin
querer más adelante.

| | Resultado |
|---|---|
| `tests/unit/contenido-obligatorio.test.ts` | **25 pruebas, 0 fallos** (19 previas + 6 nuevas) |
| Suite unitaria completa (`vitest run tests/unit`) | **968 pruebas, 0 fallos** (104 archivos) |
| Guardarraíles del pipeline (`pipeline-*.test.ts`) | pasan sin base de datos (mocks) |
| `eslint` sobre los dos archivos tocados | limpio |
| `tsc --noEmit` sobre mis archivos | limpio |

> ⚠️ **Nota sobre `tsc --noEmit` global.** Falla con UN error, y **no es de este
> cambio**: `tests/unit/ycloud-cuenta-cliente.test.ts` tiene un desajuste de
> tipos en `metaWabaId`, del trabajo en curso de la tarea B (commit `28c7da8`,
> el `wabaId` real). Está en código ya commiteado en HEAD, en archivos fuera de
> mi scope, y no lo toqué. Vitest lo corre igual (esbuild no typechquea) y pasa
> en runtime. Queda anotado para quien cierre la tarea B / 129.

No se corrió el pipeline real contra el modelo (`pnpm probar:citas`) para medir
antes/después de los nuevos literales: hoy ningún cliente de la flota tiene un
correo ni un teléfono internacional configurado como contenido obligatorio, así
que no hay caso vivo que medir. La garantía por código es idéntica a la del
enlace —ya medida a 0% de fallo en el 125—; lo único nuevo es de qué texto se
extrae el literal, y eso lo cubren las pruebas unitarias deterministas. Cuando
un cliente configure uno, la medición en vivo se hace igual que en el 125.

---

## Cómo revertir

`git revert` del commit de esta tarea. Toca **solo** `contenido-obligatorio.ts`
y su prueba: no toca `pipeline.ts`, ni datos, ni el estado conversacional. Con
el revert, el guardarraíl 7 vuelve a cubrir únicamente enlaces, exactamente como
quedó en el commit `759262f` del 125 — sin efecto sobre ninguna ficha, regla ni
entrada de conocimiento de la base.
