# El modelo de la ficha, blindado

> **Dentro:** Las dos representaciones · El inventario · Las cuatro preguntas de
> aprobación · Lo que el compilador puede y lo que no

**17-ago-2026, paso 3.5.** Escrito después de romper dos fichas de producción y
repararlas.

---

## Las dos representaciones

| | Cómo es | Quién la usa |
|---|---|---|
| **Persistida** | `{ schema_version: 2, negocio, flujo, politicas }` | La base de datos. Es **la ficha** |
| **Aplanada** (`FichaAplanada`) | `{ nombre, vertical, catalogo, cierre… }` — sin secciones | El generador de prompts, el pipeline, los scripts |

La aplanada existe porque al generador no le sirven las secciones: quiere los
campos. Pero **no es la ficha: es una lectura de la ficha**, y guardar una
lectura pierde lo que el lector no necesitaba.

## Qué pasó

`migrar-requisitos` leyó con `leerFicha()` y guardó ese resultado. Las fichas de
La Churra y del salón perdieron `schema_version`, `negocio`, `flujo` y
`politicas` — el modelo que existe para que el cuestionario del cliente no pise
lo que escribió la agencia ([68](68-UN-DUENO-POR-DATO.md)).

Lo destapó una consulta de rutina: `vertical` salió vacío al pedirlo por su
sección.

> 🔑 **Y lo peor no fue el error: la función correcta ya existía.**
> `aplicarFicha` usaba `serializarComoEstaba()` desde el principio. Nada obligaba
> a los demás a usarla.

## El inventario

| Elemento | Resultado |
|---|---|
| **`leerFicha()`** | 17 llamadas: `pipeline`, `sembrar`, y 8 scripts. **Todas leen**; ninguna debería escribir su resultado |
| **`aSecciones()`** | 10 llamadas, todas correctas: convierten *antes* de guardar |
| **Escrituras de `agent_profile.ficha`** | **7**: `aplicar.ts` (con la puerta ✅) y 6 en scripts |
| **Ficha → prompt** | `generarPerfil()`, siempre desde la aplanada. Correcto: es su formato |

De las 7 escrituras, **solo una estaba mal** — la mía. Las otras seis usan
`serializarComoEstaba`, `aSecciones` o guardan el string crudo de un respaldo.

## Las cuatro preguntas de aprobación

**1. ¿Una ficha puede leerse y escribirse sin perder información?** ✅ Sí, por
`serializarComoEstaba()`, y hay una prueba de ida y vuelta que lo verifica campo
a campo — incluidos `schema_version`, `negocio`, `flujo`, `politicas`, `catalogo`
y `cierre`.

**2. ¿Están separadas las dos representaciones?** ✅ Sí. `leerFichaAplanada()`
devuelve el tipo **`FichaAplanada`**, marcado con un símbolo privado del módulo:
nadie puede fabricar una fuera, así que cuando una firma la recibe se sabe de
dónde viene. El nombre viejo, `leerFicha`, queda como alias `@deprecated` —
**inducía al error**: parecía devolver «la ficha».

**3. ¿El compilador detecta un uso incorrecto?** **No del todo, y conviene
decirlo claro.** TypeScript no puede impedir `JSON.stringify(aplanada)`:
`stringify` acepta cualquier cosa. El tipo marcado hace el error *visible* en las
firmas, pero no lo *impide*.

**4. ¿Hay una prueba automática que lo garantice?** ✅ **Ese es el mecanismo que
de verdad lo impide.** `ficha-ida-y-vuelta.test.ts` recorre `src/` y `scripts/`,
busca cada `.set({ ficha: … })` y comprueba **de dónde sale el valor**: si no
pasó por la puerta ni es un string crudo de la base, falla el gate.

### Y el guardarraíl se verifica a sí mismo

Con el código exacto que rompió las fichas:

```ts
const nueva = JSON.stringify({ ...cruda, cierre });   // ← escrituraSegura() = false
const nueva = serializarComoEstaba(p.ficha, cruda);   // ← escrituraSegura() = true
```

Al escribirlo salieron **tres fallos propios**, y merece la pena anotarlos
porque son el motivo de que la prueba negativa exista:

1. La primera versión miraba si el **archivo** mencionaba la puerta en cualquier
   línea: dejaba pasar toda escritura nueva en un archivo que ya la usara.
2. La segunda construía una expresión regular al vuelo y **una barra quedó mal
   escapada**: el detector no detectaba nada y las pruebas pasaban.
3. La tercera marcó dos falsos positivos legítimos —el rollback que guarda el
   string crudo del respaldo, y `JSON.stringify(aSecciones(x))`—.

> **Un guardarraíl que nunca ha fallado no demuestra nada.** Este falló tres
> veces antes de servir.

## La regla

> **Una ficha transformada nunca se persiste.** Para guardar hay una sola
> puerta: `serializarComoEstaba(cruda, ficha)`, que la devuelve a la forma en
> que estaba. Lo que sale de `leerFichaAplanada()` es para leer.
