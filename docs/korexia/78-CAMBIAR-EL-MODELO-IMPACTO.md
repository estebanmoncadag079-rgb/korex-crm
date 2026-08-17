# Cambiar el modelo de las opciones: impacto exacto

> **Dentro:** Las siete preguntas, respondidas · El inventario, archivo por
> archivo · Lo que el LLM no puede darnos · Los riesgos reales · 🔴 Un hallazgo
> nuevo: el `"0"` sigue clavado · Qué elimina de verdad

**16-ago-2026. Informe de impacto, sin una línea de código.** El objetivo
evaluado: sustituir las tres listas de nombres por una estructura explícita.

```ts
// hoy
salsas: string[]  ·  recubierto: string | null  ·  adiciones: string[]

// evaluado
seleccion: [{ grupoId, opcionId, nombre }]
```

---

## 1. ¿Qué archivos habría que modificar?

**Nueve de producción y tres de pruebas.** Medido por accesos reales al
contrato, no por menciones de la palabra "salsa":

| Archivo | Accesos | Qué cambia |
|---|---|---|
| `orders/normalizar.ts` | 17 | El corazón: `EstadoPropuesto`, la validación de cada grupo, `sumaDeExtras`, `faltaParaCerrar` |
| `orders/estado.ts` | 15 | `EstadoDelPedido`, `validarPropuesta`, `estadoVacio`, `aplanar` (el log por campo) |
| `orders/extraer.ts` | 9 | `CAMPOS`, `loQueFalta`, `comoTexto`, `leerAporte` |
| `ai/pipeline.ts` | 1 + prompt | **El prompt de extracción (:1702)**, que nombra los tres campos como texto |
| `registro-de-cambios.ts` | 3 | La clasificación de `conversation_state`: hoy tiene `salsas`, `recubierto` y `adiciones` como claves fijas |
| `scripts/medir-extraccion.ts` | 10 | Construye y compara `EstadoPropuesto` |
| `scripts/probar-estado.ts` | 7 | La prueba de extremo a extremo |
| `tests/unit/normalizar-pedido.test.ts` | 49 | — |
| `tests/unit/estado-del-pedido.test.ts` | 12 | — |

**Y los que NO cambian**, aunque nombren salsas: `catalog/sembrar.ts` (parser de
texto), `catalog/render.ts` y `queries.ts` (el catálogo ya está bien modelado),
`orders/intencion.ts`, `lab/personas.ts`, `ai/conducta.ts`,
`scripts/fichas-de-clientes.ts` y `tests/unit/leer-catalogo-variantes.test.ts`.

> 🔑 **El catálogo no se toca.** El modelo bueno ya existe: lo que falta es que
> la selección se parezca a él.

## 2. ¿Qué contratos internos cambiarían?

| Contrato | Hoy | Después |
|---|---|---|
| `EstadoPropuesto` | 3 listas + 3 campos de entrega | `seleccion[]` + entrega |
| `EstadoDelPedido` | ídem, `schema_version: 1` | ídem, **`schema_version: 2`** |
| `PropuestaDelModelo` | lo que manda el LLM | **igual** (ver §3) |
| `Validacion` | `{ok, estado, rechazos, correcciones, dudas}` | igual, con `estado` nuevo |
| `loQueFalta(estado, salsasQueLleva)` | recibe **un número** | recibiría **los grupos del producto** |
| `comoTexto(estado, salsasQueLleva)` | ídem | ídem |
| `aplanar()` → claves del log | `salsas`, `recubierto`, `adiciones` | claves por grupo, **y la clasificación de la regla 3 con ellas** |

**El que más duele es el último**: la clasificación por tabla que se estrenó
anoche lista los campos **uno a uno**. Con grupos arbitrarios, la clave del log
pasa a ser dinámica (`seleccion.SALSAS`), y hay que decidir cómo se clasifica lo
que no está en la lista. **Ya está resuelto**: lo no clasificado se protege y
sale marcado `<sin clasificar>` — pero conviene saber que ese marcador aparecerá
en cuanto un cliente tenga un grupo nuevo, y que eso es trabajo, no ruido.

## 3. Lo que el LLM no puede darnos (y cambia el diseño)

**El modelo no conoce los ids.** No puede devolver `opt_9f8a`: no los ha visto
nunca y no debe verlos. Así que el contrato con el LLM **no puede ser el modelo
interno**, y eso es coherente con la regla 3 —contratos tolerantes— y con la
medición del 15-ago.

La forma que sí funciona:

```
LLM  →  { grupo: "SALSAS", opcion: "arequipe" }   (nombres, tolerante)
        ↓  normalizarPedido resuelve contra el catálogo
BD   →  { grupoId: "g_1", opcionId: "opt_2", nombre: "arequipe" }
```

Es exactamente lo que ya se hace con el producto —el modelo dice `"churrita"` y
el backend guarda `prod_x`—, aplicado un nivel más abajo.

**Pero el prompt sí cambia**: hoy la pertenencia al grupo la aporta *el campo
donde el modelo pone cada cosa* (`salsas:` contra `adiciones:`). Si se sustituye
por una lista, el modelo tiene que **nombrar el grupo**, y eso es justo lo que
permite que un negocio con `TAMAÑO` o `LECHE` quepa sin tocar código.

> 🔴 **Consecuencia medible**: la medición del 15-ago —*0 % de fallos de
> extracción sobre 160 turnos*— se hizo **con el contrato de tres campos fijos**.
> Cambiar la forma **la invalida**. La regla 13 obliga a repetirla antes de dar
> por bueno el contrato nuevo, y esa medición cuesta llamadas reales al modelo.

## 4. ¿Qué pruebas dejarían de ser válidas?

**61 aserciones en 3 archivos**, ninguna por estar mal: por describir la forma
vieja.

- `normalizar-pedido.test.ts` (49): **todas** las que construyen `salsas: [...]`
  o leen `r.estado.salsas`. Incluye las 11 de anoche sobre repetición y las 7
  del precio. **Su intención se conserva entera**; cambia cómo se escriben.
- `estado-del-pedido.test.ts` (12): ídem, más las de `comoTexto`/`loQueFalta`.
- `leer-catalogo-variantes.test.ts` (1): es del parser. **Se queda igual.**

Lo que **no** cambia y conviene subrayar: las pruebas de `registro-de-cambios`,
de logs, del guardarraíl y de clasificación siguen valiendo, salvo las tres
claves de `conversation_state`.

## 5. ¿`conversation_state` sigue vacía?

**Sí. Verificado en producción el 17-ago:**

```
filas | orgs        state_source: prompt · prompt · prompt · prompt
    0 |    0        (los cuatro clientes)
```

**No hace falta migración de datos.** Subir `SCHEMA_VERSION` a 2 es gratis hoy y
deja de serlo el día que haya conversaciones vivas: el propio código ya trata un
esquema desconocido como *"se empieza limpio"*, que con pedidos en curso
significaría **perder el pedido de alguien**.

> Este es el argumento más fuerte a favor de hacerlo ahora, y el único que
> caduca.

## 6. ¿Hay más componentes cableados a La Churra?

Sí, **cinco**, y solo dos los arregla este cambio:

| Cableado | ¿Lo resuelve el modelo nuevo? |
|---|---|
| `EstadoDelPedido` con `salsas`/`recubierto`/`adiciones` | ✅ sí |
| El prompt de extracción (`pipeline.ts:1702`) | ✅ sí |
| `loQueFalta`: el orden *presentación → salsas → recubierto → entrega* | ❌ no: sigue siendo el flujo de La Churra escrito en código |
| Los nombres de grupo en `grupoDeSalsas` / `grupoDeAdiciones` / `grupoRecubierto` (`"salsa"`, `"adicion"`, `"azucar"`…) | ❌ no del todo: con `grupoId` dejan de hacer falta para **validar**, pero siguen usándose para **entender** qué es cada grupo |
| 🔴 **El `"0"` del reinicio** | ❌ no, y ver abajo |

### 🔴 Hallazgo nuevo: el `"0"` sigue clavado

`67-FASE-1.5.md` afirma:

> *"El `"0"` ya no está clavado en el código. Es la convención de La Churra y
> está en SU prompt; un negocio con listas numeradas tendría un `"0"` legítimo y
> un reinicio clavado le borraría el pedido a mitad. **Ahora entra por
> parámetro**."*

Entra por parámetro, sí:

```ts
function matchesReinicio(texto: string, palabras: string[] = ["0"]): boolean
```

**Pero el único sitio que la llama no se lo pasa** (`pipeline.ts:560`), así que
el valor por defecto gana siempre. **El efecto real es idéntico al de antes**: con
la Fase 2 encendida, un cliente que escriba `0` en cualquier negocio pierde su
pedido — incluido el negocio con listas numeradas que la doc pone como ejemplo
de por qué esto se arregló.

Es la **tercera** vez en dos días que un documento da por corregido algo que el
código sigue haciendo. No se toca ahora: es de la tarea 2C, no de esta.

## 7. ¿Elimina los cinco errores o solo los hace improbables?

Sin adornos, uno por uno:

| Error | ¿Eliminado? |
|---|---|
| El grupo adivinado con `find` | ✅ **Por construcción.** Cada elemento lleva su `grupoId`: no hay nada que adivinar |
| Cobro doble por nombre repetido entre grupos | ✅ **Por construcción.** El precio sale de `opcionId`, que es único |
| Recorrer el catálogo en vez de lo pedido | ✅ **Por construcción.** Solo una de las dos es una lista de elecciones |
| Deduplicación | 🟡 **Improbable, no imposible.** Nada impide un `Set` por `opcionId`; pero el tipo ya no invita a ello, y hay pruebas |
| Validador con criterio propio (`faltaParaCerrar`) | 🟡 **Improbable, no imposible.** Desaparece la parte difícil —identificar el grupo—, pero las reglas (`maximo`) siguen viviendo en el catálogo y cada función tiene que ir a buscarlas |

**Tres de cinco dejan de ser expresables. Dos siguen dependiendo de la
disciplina** — y para esos dos el remedio no es el modelo, es lo que ya se hizo
anoche: un solo punto de verdad y pruebas que lo verifiquen.

---

## Resumen para decidir

| | |
|---|---|
| **A favor de hacerlo ahora** | La tabla está vacía: **es el momento más barato, y es el único argumento que caduca**. Cierra 3 de 5 errores por construcción y desbloquea al segundo cliente de pedidos |
| **En contra** | Toca el contrato central de la Fase 2 · **invalida la medición del 15-ago** y obliga a repetirla (regla 13) · 61 aserciones reescritas · el prompt de extracción cambia justo donde el modelo ya demostraba 0 % de fallos |
| **Lo que NO arregla** | El orden del flujo cableado, los nombres de grupo en español y el `"0"` del reinicio. Son tres cosas distintas, y ninguna es este cambio |
