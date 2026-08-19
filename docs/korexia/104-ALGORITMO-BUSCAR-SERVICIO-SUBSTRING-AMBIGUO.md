# El paso "substring" de buscarServicio no detectaba ambigüedad

> **Dentro:** El caso · La medición antes de tocar código · La causa exacta ·
> El fix, mínimo · Por qué es del núcleo, no de un cliente · Cómo se verificó
> · Deuda que queda · Cómo revertir

**19-ago-2026.** Una clienta preguntó si Hilary tenía disponible para
*"retoques"*, sin decir cuál. El agente respondió que Hilary no hacía
retoques y ofreció a Valentina — falso: Hilary atiende 8 de los 16 tipos de
retoque de pestañas del catálogo. El sistema simplemente **eligió mal cuál
de los 19 "retoque" quería la clienta**, sin que nadie se enterara.

---

## El caso

En otra conversación real, el mismo día, el patrón fue peor: el agente
**primero confirmó** disponibilidad con Hilary y ofreció tres horarios
reales, y 49 segundos después, al intentar cerrar, **se retractó**
("Ay, disculpa mi error…"). La clienta terminó preguntando si "cambiaron las
cosas allá", y una persona del equipo tuvo que intervenir a mano.

## La medición, antes de tocar código

El catálogo real de Lashes Valen tiene **19 servicios que contienen la
palabra "retoque"** — 16 de pestañas (repartidos 8/8 entre especialistas que
sí y no atienden cada uno) y 3 de uñas. Se midió `buscarServicio()`
—el código real, no una réplica— contra ese catálogo antes de escribir una
sola línea:

```text
Consulta: "retoque"
Candidatos por substring: 19
Resultado: "Retoque Baby Volumen 2D (10-15 días)"  ← el primero alfabético
Ambigüedad detectada: NO
```

Y de control, el mismo algoritmo contra el catálogo de La Churra (sin
nombres que compartan prefijo): ningún caso pasa por substring con más de un
candidato — la condición que dispara el bug no existe ahí.

## La causa exacta

`server/appointments/logic.ts`, función `buscarServicio()`. El paso de
coincidencia por substring usaba `.find()`:

```ts
const sub = services.find(
  (s) => normalizar(s.name).includes(q) || q.includes(normalizar(s.name))
);
if (sub) return sub;
```

`.find()` devuelve el **primero** que cumple la condición, en el orden del
array — que es alfabético (`listServices()`, `orderBy(asc(schema.service.name))`).
Con 19 candidatos, "el primero alfabético" no tiene ninguna relación con lo
que pidió la clienta.

El paso **siguiente** (tokens) ya hace esto bien: compara todos los
candidatos por `ratio`/`overlap` y marca ambiguo si empatan — es lo que le
pasaba a `"retoques"` (plural), que nunca calzaba por substring y sí llegaba
a tokens, y por eso ese caso concreto **ya funcionaba** antes del fix. El
bug solo afectaba a las variantes que sí calzaban por substring.

## El fix, mínimo

```ts
const sub = services.filter(
  (s) => normalizar(s.name).includes(q) || q.includes(normalizar(s.name))
);
if (sub.length === 1) return sub[0]!;
```

Con **un único** candidato, resuelve igual que antes. Con más de uno, **no
se corta el camino**: se deja caer al paso de tokens, que ya sabe comparar
candidatos y ya marca ambiguo si empatan — sin duplicar esa lógica en dos
sitios.

Cuando `buscarServicio` devuelve `null` (ambiguo), el camino que ya existía
se activa solo: `[SISTEMA] No encontré "X" en el catálogo. Servicios reales:
[...]. Pregúntale al cliente cuál de estos quiere.` (`pipeline.ts`). Ese
mensaje no se tocó — ya era correcto, solo nunca se alcanzaba para "retoque".

## Por qué es del núcleo, no de un cliente

Cero menciones de "retoque", "pestañas", Hilary ni Lashes Valen en el
cambio. La condición que dispara el bug —varios servicios que comparten un
prefijo, atendidos por especialistas distintas— es estructural: una
barbería con "Corte clásico"/"Corte degradado", o una clínica con "Limpieza
facial profunda"/"Limpieza facial básica", tienen el mismo riesgo latente.
`buscarServicio()` es el motor compartido por cualquier negocio de citas —
ninguno lo conoce por nombre.

**Descartado a propósito, y con acuerdo explícito del dueño**, todo lo
demás: ninguna regla específica de retoques, sin tocar el catálogo, sin
tocar el prompt, sin tocar la asignación de especialistas. Y la mejora de
UX (que el mensaje de ambigüedad filtre por la especialista pedida) se dejó
fuera — es una mejora posterior, no parte de este arreglo.

## Cómo se verificó

```text
pnpm test        # 864 passed (4 nuevas: 2 del caso real, 2 de control), 73 skipped
pnpm typecheck   # limpio
pnpm lint        # limpio
```

Los 4 casos nuevos, contra un recorte del catálogo real: `"retoque"` y
`"retoques"` ahora dan `null`; un nombre completo y específico sigue
resolviendo limpio; y un catálogo con un único candidato por substring (el
caso que **no** debe volverse ambiguo) sigue resolviendo directo, sin pasar
por tokens.

Verificado también, con el mismo script, que las 35 pruebas ya existentes de
`buscarServicio` y `calcularDisponibilidad` siguen en verde sin tocarlas —
el fix no cambia ningún caso que ya funcionaba.

## Deuda que queda

- **No probado contra WhatsApp real todavía.** La medición fue con el
  código real contra el catálogo real, pero no se repitió la conversación
  real de Hilary tras el fix.
- **La mejora de UX queda pendiente, a propósito**: cuando la ambigüedad
  ocurre con una especialista nombrada, el mensaje de aclaración podría
  filtrar primero los servicios que esa especialista atiende, en vez de
  listar los 19 sin filtrar. Decidido no hacerlo en este cambio.

## Cómo revertir

```bash
git revert <commit>
```

Lógica pura, sin estado, sin esquema, sin datos. Revertir vuelve a resolver
"retoque" por orden alfabético — el comportamiento original, con su bug.
