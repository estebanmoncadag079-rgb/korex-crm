# El nombre de la clienta no se pide antes de agendar

> **Dentro:** El hallazgo · Cómo se obtiene el nombre hoy · Por qué el validador
> de requisitos no corre · Las tres alternativas auditadas · La decisión · El
> diseño, a medio camino · Lo que falta para cerrarlo · Estado

**18/19-ago-2026.** Auditoría de por qué una cita en Lashes Valen se confirma
sin que nadie le pida el nombre a la clienta.

> ✅ **19-ago: implementado.** Este documento es la auditoría y el diseño tal
> como quedaron interrumpidos ese día — se conserva íntegro por el rastro que
> deja. Para lo que de verdad se construyó, con los ajustes que aparecieron al
> escribir el código, ver
> [103-REQUISITOS-IMPLEMENTADO.md](103-REQUISITOS-IMPLEMENTADO.md).

---

## El hallazgo

Una cita se agendó sin que el agente preguntara el nombre. No es un bug
puntual: es el comportamiento esperado del sistema tal como está configurado
hoy. El equipo lo necesita para identificar a la clienta cuando llega al
salón, y hoy no hay ninguna garantía de tenerlo.

## Cómo se obtiene el nombre hoy — el único origen

**`src/server/inbox/ingest.ts:710-718`**:

```ts
// El nombre del perfil solo se rellena si el contacto no tenía...
if (input.profileName && !contact.name) {
  await db.update(schema.contact).set({ name: input.profileName })...
}
```

`profileName` es `customerProfile.name` del payload de WhatsApp — el nombre de
perfil que el cliente configuró en su teléfono. Es el **único** punto de
entrada del nombre en todo el sistema, y es pasivo: si el cliente usa un
nombre de usuario de WhatsApp en vez de nombre de perfil visible (el caso
BSUID, ver [24-MENSAJES-UNSUPPORTED.md](24-MENSAJES-UNSUPPORTED.md)),
`contact.name` queda `null` para siempre. Nunca se pregunta.

`fichaDelContacto()` (`prompts.ts:516-530`) es lo único que toca el nombre en
el prompt por turno: si `contact.name` existe lo pasa como dato ya conocido
("no la preguntes"); si no existe, la línea desaparece con `.filter(Boolean)`
y **el modelo no recibe ninguna instrucción de pedirlo**. El texto de esa
función además está redactado para pedidos ("completar el resumen del
pedido"), no para citas.

La tabla `appointment` (`schema.ts:647-673`) no tiene columna de nombre — solo
`contactId`. El nombre, si existe, vive únicamente en `contact.name`.

## Por qué el validador de requisitos no corre

Existe un mecanismo genérico y ya construido para esto: `Requisito`
(`ficha.ts:33-54` — `id`, `tipo`, `etiqueta`, `obligatorio`, `soloSi`) y
`requisitosDe(ficha)` (`ficha.ts:287-291`), que lee `agent_profile.ficha` sin
saber de ningún vertical. Pero solo se evalúa dentro de
`chatJsonConEstado` (`pipeline.ts:1856`), y esa función **solo se llama si
`profile.stateSource === "backend"`** (`pipeline.ts:588, 660-662`) — la Fase 2.

Verificado en la base de producción: los 4 clientes reales están en
`state_source = 'prompt'`. La Fase 2 está apagada para toda la flota. Cuando
está apagada, `book_appointment` se ejecuta con solo cuatro comprobaciones
(servicio en catálogo, especialista resuelta, horario entre los ofrecidos,
disponibilidad real) — **ninguna toca el nombre**, y `avisarYConfirmar`
(`pipeline.ts:1751-1771`) tampoco lo usa en ningún texto.

**Además**, verificado hoy mismo: ningún negocio de la flota tiene
`cierre.requisitos` declarado en su ficha —ni siquiera Lashes Valen—, así que
aunque el validador corriera, no tendría nada que exigir todavía.

```sql
Lashes Valen   | requisitos declarados: NO | 0
Lis Pastelería | requisitos declarados: NO | 0
La Churra      | requisitos declarados: NO | 0
```

`requisitosSugeridos()` (`ficha.ts:301-318`, usada solo por
`migrar:requisitos`, nunca por el pipeline) ya coincide con el criterio del
dueño sin que se lo pidiera: `nombre` es el único requisito universal (todo
vertical, sin condición); `telefono` y `direccion` solo se sugieren para
`pedidos`, y `direccion` va condicionada a `soloSi: "entrega.haceDomicilios"`.

## Las tres alternativas auditadas

Pedidas por el dueño, evaluadas contra 7 criterios (impacto arquitectónico,
compatibilidad multinivel/multiempresa, riesgo, migraciones, compatibilidad
con pedidos, con citas, reversibilidad):

1. **Validar antes de `book_appointment`** — viable si reutiliza
   `Requisito`/`requisitosDe()`, pero deja **dos validadores separados** del
   mismo concepto (uno para pedidos vía Fase 2, otro nuevo solo para citas).
2. **Capa exclusiva para citas** — repite el patrón que el proyecto ya
   rechazó por escrito el 17-ago (`ficha.ts:267-286`): una lista de requisitos
   *por vertical* dentro del código. Viola la regla 9 de
   [79-ARQUITECTURA-MULTIEMPRESA.md](79-ARQUITECTURA-MULTIEMPRESA.md).
   **Descartada.**
3. **Guardarraíl independiente del estado estructurado** — reutiliza al 100 %
   `Requisito`/`requisitosDe()`/`aplica()`, mismo patrón que los 7
   guardarraíles ya construidos ([38-GUARDARRAILES.md](38-GUARDARRAILES.md)).
   Protege `book_appointment` **y** `notify_order` a la vez, sin trabajo
   extra, porque ambos comparten el mismo hueco por el mismo motivo (Fase 2
   apagada).

## La decisión

**Alternativa 3.** El dueño acotó el alcance: *"el teléfono no me
preocuparía —WhatsApp ya lo da—, la dirección tampoco —solo hace falta con
domicilio—, el nombre sí, porque el equipo lo necesita para identificar a la
clienta al llegar. Corregiría únicamente ese punto."* El mecanismo sigue
siendo genérico sobre cualquier requisito declarado — no se hardcodea
"nombre" en ningún sitio —, pero el alcance práctico de hoy es ese.

## El diseño, a medio camino — el problema real que lo frenó

Antes de escribir una línea apareció un problema que cambia el diseño
mínimo: **si el guardarraíl solo mira `contact.name`, se cae en un bucle.**

`contact.name` solo se escribe desde `profileName` de WhatsApp
(`ingest.ts:714`). Cuando la clienta responde su nombre **dentro del chat**,
ese texto no se guarda en ningún lado estructurado. Secuencia:

```
1. Clienta pide agendar. El modelo emite book_appointment.
2. Guardarraíl: contact.name vacío, requisito "nombre" obligatorio → frena,
   pide al modelo que pregunte el nombre primero.
3. Clienta responde: "Valentina".
4. El modelo reintenta book_appointment... pero no hay NINGÚN campo
   estructurado donde poner "Valentina". contact.name SIGUE vacío.
5. El guardarraíl frena OTRA VEZ. Bucle.
```

**La vía que se estaba explorando** (sin llegar a escribirla): un campo
opcional simple en el esquema de `book_appointment` —algo como
`datos?: Record<string, string>`— que el modelo llene con lo que el cliente
acaba de decir, **sin** activar `conversation_state` ni `chatJsonConEstado`:
viaja solo dentro de la acción de ese turno, no se persiste como "estado".
El ejecutor de `book_appointment`, al crear la cita, escribiría ese valor en
`contact.name` si estaba vacío — mismo dueño del dato de siempre
(`contact.name`), solo que ahora también se llena desde lo que el cliente
dice, no solo desde el perfil de WhatsApp.

**Verificado y sin resolver todavía**: `generar.ts` (el prompt permanente,
guardado en `agent_profile.instructions`) **no menciona
`requisitosDe`/`cierre.requisitos` en ningún lado** — la búsqueda dio cero
coincidencias. Hoy nada en el prompt estático le avisa al modelo de qué debe
reunir fuera del mecanismo de Fase 2. Habría que decidir si esa instrucción
va en el prompt permanente (una vez, al generarlo) o en el contrato de
acciones por turno (`CONTRATO_DE_ACCIONES_CITAS`, `prompts.ts`) — no se
alcanzó a auditar cuál de los dos sitios es el correcto.

## Lo que falta para cerrarlo, la próxima vez

1. Decidir dónde vive la instrucción nueva para el modelo: prompt permanente
   (`generar.ts`) o contrato de acciones por turno (`prompts.ts`) — ninguno
   de los dos se auditó a fondo todavía.
2. Diseñar el campo `datos` opcional en `book_appointment` (`actions.ts`) y
   confirmar que no colisiona con nada de la Fase 2 (que sigue apagada, pero
   comparte el nombre del concepto).
3. Escribir el guardarraíl (`anuncio-de-cierre.ts` + conexión en
   `pipeline.ts`), con dos condiciones que no pueden faltar:
   - Si `requisitosDe(ficha)` es `undefined` (negocio sin declarar), **no
     bloquear nada** — mismo criterio que ya usa el validador de pedidos para
     "no declarado", pero aplicado sin romper a los clientes que aún no
     migraron su ficha.
   - Si insiste tras el reintento, decidir si deriva a una persona (como
     cierre falso/cita fantasma) o si deja pasar la cita sin el dato — el
     dueño no llegó a decidir esto.
4. Declarar el requisito en la ficha de Lashes Valen (`pnpm migrar:requisitos`
   o edición manual) — sin este paso de **datos**, el guardarraíl no tiene
   nada que exigir, sin importar cuánto código se escriba.
5. Pruebas: el caso positivo (nombre ya en `contact.name`, no se pregunta),
   el negativo (falta, se pregunta, se reintenta), y el de "negocio sin
   requisitos declarados" (no debe bloquear).

## Estado

✅ **Implementado el 19-ago** — ver [103](103-REQUISITOS-IMPLEMENTADO.md). Esta
sección queda como estaba el día de la auditoría, para el rastro: aquí se
decidió la alternativa 3 y se frenó el diseño a propósito, antes de escribir
código, para revisarlo con calma primero.
