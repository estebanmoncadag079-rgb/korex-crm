# Requisitos declarados: implementado

> **Dentro:** Qué cambió, archivo por archivo · El octavo guardarraíl · La
> pantalla · Dos hallazgos al implementar, no previstos en el diseño · Cómo
> se verificó · Deuda que queda · Cómo revertir

**19-ago-2026.** Cierra [102-REQUISITO-NOMBRE-EN-CITAS.md](102-REQUISITO-NOMBRE-EN-CITAS.md):
una cita (o un pedido) ya no se puede cerrar sin los datos que el negocio
declaró como obligatorios — hoy, el nombre.

---

## Qué cambió, archivo por archivo

| Archivo | Qué |
|---|---|
| `server/contacts.ts` | `faltantes()` (lectura) y `capturar()` (la única escritura) — el componente que faltaba en la auditoría del 102 |
| `server/ai/actions.ts` | Acción `provide_requirement`, en el contrato **compartido** — no en citas ni en pedidos |
| `server/ai/anuncio-de-cierre.ts` | `correccionDeRequisitoFaltante()` — el mensaje del octavo guardarraíl |
| `server/ai/pipeline.ts` | El guardarraíl (frena `book_appointment`/`notify_order`), el ejecutor de `provide_requirement`, y `requisitos` calculado siempre (antes solo con la Fase 2 encendida) |
| `server/ai/prompts.ts` | `requisitosParaElPrompt()` — condicional, como `fotosDisponibles`: los negocios sin requisitos declarados no ganan ni una línea |
| `server/ai/generador/ficha.ts` | `REQUISITOS_DISPONIBLES` — el catálogo cerrado de 4 opciones que ofrece la pantalla |
| `app/api/agent/requisitos/route.ts` | GET/PATCH — la única puerta para `ficha.cierre.requisitos` |
| `components/agent/requisitos-section.tsx` + `agent-client.tsx` | La pantalla: checkboxes, nada más |

## El octavo guardarraíl

Mismo patrón que los siete anteriores — detectar, rehacer el turno con la
corrección delante, derivar a una persona si insiste — pero es el primero
que **no detecta nada en el texto**: la comprobación es de datos
(`faltantes()`), así que vive repartido entre `pipeline.ts` (la llamada) y
`anuncio-de-cierre.ts` (el mensaje), en vez de ser una función pura completa
en un solo sitio.

Corre en **los dos verticales con el mismo código** — `book_appointment` y
`notify_order` comparten el hueco, tal como predijo el 102: ninguno exige
nada declarado cuando `stateSource='prompt'`, que es toda la flota real.

```
requisitos (siempre calculado, ya no solo con la Fase 2)
  → faltan = faltantes({org, contactId, requisitos})
  → si faltan.length > 0:
      rehacer el turno con correccionDeRequisitoFaltante(faltan)
      si el reintento sigue siendo la acción de cierre → deriva a una persona
      si no (reply preguntando, o provide_requirement capturando) → se acepta
```

### La decisión de diseño que evita el reintento encadenado

El diseño auditado en el 102 dejaba abierto: *"¿el cliente que da el nombre
Y quiere agendar en el mismo mensaje necesita un reintento de servidor
encadenado?"* Se resolvió más simple: `provide_requirement` lleva un
`reply` opcional. El modelo, al capturar el dato, sigue la conversación en
el mismo turno ("¡Gracias, Valentina! ¿Confirmamos la cita a las 3?"), y el
cliente cierra en su siguiente mensaje real — sin encadenar una segunda
llamada al modelo dentro del mismo turno de servidor.

## La pantalla — solo la interfaz, confirmado en el código

`app/api/agent/requisitos/route.ts` es la única puerta: `PATCH` reenvía la
ficha completa (leída primero) con solo `cierre.requisitos` cambiado, y
llama a `aplicarFicha(..., { puedeEscribir: ["flujo"] })`. `cierre` vive en
la sección `flujo` (`leer-ficha.ts:42`), que el cuestionario del cliente
**nunca** escribe (`puedeEscribir: ["negocio"]` por defecto en
`POST /api/onboarding`) — verificado en el 102 antes de construir nada, así
que no hay riesgo de la trampa del 15-ago.

El catálogo de opciones (`REQUISITOS_DISPONIBLES`, 4 entradas fijas) lo fija
el servidor; el componente solo marca/desmarca ids. Cero lógica en la
pantalla, tal como se pidió.

## Dos hallazgos al implementar, no previstos en el diseño de ayer

**1. `contact.name` es `NOT NULL`, y se rellena con el teléfono o el BSUID
cuando no hay nombre real** (`ingest.ts:156`,
`name: name?.trim() || phone || waUserId!`). "Existe `contact.name`" habría
sido siempre verdadero — el mismo problema, disfrazado. `faltantes()`
distingue con `tieneNombreReal()`: satisfecho solo si el nombre es distinto
del teléfono y del BSUID. Es el hallazgo que más cambió el diseño original.

**2. El alcance de `capturar()` es honesto sobre lo que no sabe hacer.**
`REQUISITOS_DISPONIBLES` ofrece 4 opciones (nombre, teléfono, email,
documento) porque un negocio puede querer *declararlas* — pero `contact`
solo tiene columnas para nombre y teléfono. Si alguien marca "email" o
"documento", el requisito queda declarado en la ficha (la ficha sigue siendo
la única fuente de verdad), pero `capturar()` lo rechaza explícitamente
(`ok:false`) y `satisfecho()` no lo exige (no bloquea por algo que no sabe
comprobar). Es deuda visible, no un bug oculto.

## Cómo se verificó

```
pnpm test        # 860 passed (20 nuevas), 73 skipped
pnpm typecheck   # limpio
pnpm lint        # limpio
```

Las 20 pruebas incluyen el caso que motivó todo esto (`tieneNombreReal` con
el nombre igual al teléfono), los dos casos negativos de `capturar()` (un
id no declarado, un id sin destino conocido) y el esquema completo de
`provide_requirement`.

**No se probó contra el modelo real ni contra WhatsApp** — eso requiere
declarar el requisito en la ficha de un cliente real, y eso es el primer
paso pendiente, más abajo.

## 🔴 Deuda que queda

1. **Nada de esto se activa solo.** Sin declarar el requisito en la ficha de
   un negocio (desde la pantalla nueva, una vez desplegada), `requisitosDe()`
   sigue devolviendo `undefined` y el guardarraíl no tiene nada que exigir.
2. **`email`/`documento` se pueden declarar pero no se pueden capturar.**
   Ampliar `CAMPO_DE_REQUISITO` (en `server/contacts.ts`) es la vía —
   necesitaría antes columnas nuevas en `contact`, fuera del alcance de hoy.
3. **Sin probar en vivo.** Falta: declarar "nombre" en Lashes Valen tras
   desplegar, y repetir la prueba de chat limpio que ya se usó hoy para el
   catálogo — un número sin historial pidiendo una cita sin dar su nombre.
4. **El reintento no está probado end-to-end.** Las pruebas cubren la
   detección y la persistencia por separado; el turno completo (frenar →
   reintentar → `provide_requirement` → reintentar de nuevo con éxito) no
   tiene test de integración, igual que los siete guardarraíles anteriores.

## Cómo revertir

```bash
git revert <commit>
```

No toca esquema (ninguna migración), no cambia el prompt de un negocio sin
requisitos declarados, y no rompe la Fase 2 (que sigue apagada e intacta).
Revertir deja `requisitos` calculándose de nuevo solo con `stateSource='backend'`,
y desaparecen la acción, el guardarraíl, el endpoint y la pantalla —
ningún cliente nota el cambio porque ninguno tiene el requisito declarado
todavía.
