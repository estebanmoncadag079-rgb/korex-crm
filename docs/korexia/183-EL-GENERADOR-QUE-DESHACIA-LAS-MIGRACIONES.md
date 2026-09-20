# 183 — El generador que deshacía las migraciones

**20-sep-2026** · Estado: implementado, **sin desplegar y sin regeneración
aplicada**. Pendiente de revisión del dueño.

## Lo que pasó

El 19-sep-2026 `pnpm migrar:pago` limpió el prompt de La Churra y encendió
`payment_source='ficha'`, para que el pipeline inyectara las formas de pago y
los datos de cuenta frescos en cada turno en vez de llevarlos congelados en el
texto. El prompt bajó de **14.023 a 13.837 caracteres**.

Al preparar el rediseño de horarios —que necesita `pnpm regenerar:flota` para
llegar a los clientes— se midió qué haría esa regeneración hoy. Devolvía La
Churra a **14.023**: los 186 caracteres exactos que la migración había quitado.

Migración y generador se deshacían mutuamente, y el bucle podía repetirse
indefinidamente sin que nada avisara.

## La causa, que no era la que parecía

El síntoma decía "al generador le falta un `if` para pagos". No era eso.

`generarPerfil` recibe unas opciones (`catalogoEnTabla`, `menuGuiado`,
`vertical`) que **cada llamante derivaba a mano de las columnas de
`agent_profile`** — y cada uno derivaba un subconjunto distinto:

| Quién llama | Qué traducía | Qué ignoraba |
|---|---|---|
| `aplicarFicha` | catalog, menu, vertical | payment, delivery |
| `regenerar:flota` | catalog, menu | payment, delivery, **vertical** |
| `convertir:ficha` (×3) | catalog | payment, delivery, menu, vertical |
| `migrar:modalidad` | catalog | ídem |
| `simular:ficha` | catalog | ídem |
| vista previa de `/admin` | vertical | **todo lo demás, catálogo incluido** |

Con ese diseño, **una fuente de autoridad nueva nace ignorada en todos los
sitios que nadie se acordó de tocar**, y el fallo solo aparece meses después,
en producción. `payment_source` existe desde el 24-ago y ningún llamante lo
miró nunca. `delivery_source`, desde el 4-sep, tampoco.

Efecto colateral del mismo defecto, encontrado por el camino: la vista previa
de `/admin` enseñaba un prompt **con el catálogo dentro** a clientes con
`catalog_source='tabla'`, que después no se guardaba así. El único sitio donde
se revisa un prompt antes de aplicarlo mentía.

## El contrato, ahora explícito

> **Un dato con fuente estructurada de autoridad no se vuelve a escribir
> dentro de `instructions`. La conducta que el modelo necesita para actuar,
> sí.**
>
> Y esa decisión la toma el GENERADOR mirando las columnas `*_source`, nunca
> un script de limpieza que corre por fuera y que la siguiente regeneración
> deshace.

La traducción de columnas a opciones vive ahora en **un solo sitio**,
`src/server/ai/generador/fuentes.ts` (`opcionesDeGeneracion`). Añadir una
fuente mañana es tocar ese archivo, y los seis llamantes la respetan de
inmediato.

### Qué suprime cada fuente

| Columna | Valor | El generador NO escribe | Qué se conserva |
|---|---|---|---|
| `catalog_source` | `tabla` | `## Lo que vendes` (catálogo y variantes) | — *(ya era así desde la Fase 1)* |
| `payment_source` | `ficha` | `Formas de pago:` y `Datos para el pago` | la frase del comprobante: es conducta, y no la inyecta nadie más |
| `delivery_source` | `tabla` | la orden de citar **literal y siempre** `quienPagaElDomicilio` dentro del resumen | la política misma (como contexto), tiempos, restricciones y recogida |
| `state_source` | `backend` | *(nada)* | `CIERRE` es conducta pura: no duplica ningún dato del estado |
| `menu_mode` | `guiado` | *(nada: añade, no duplica)* | — |

**Falla hacia lo seguro:** cualquier valor que no sea exactamente el esperado
deja el bloque escribiéndose, que es el comportamiento de siempre. Un
`payment_source` corrupto no puede dejar a un agente sin saber cobrar.

### Por qué el domicilio se trata distinto al pago

No es una excepción: es que la autoridad estructurada es distinta.

`delivery_zone` guarda **zona y tarifa**, nada más. La ficha no tiene ningún
campo que copie eso, así que no había un bloque que suprimir. Lo que sí había
era un choque real en MALIA (`delivery_source='tabla'`, 350 zonas, agente
encendido): su prompt ordena meter en **cada** resumen, en negrita y literal,
*"el domicilio… debe pagarlo junto con todo el pedido antes de despachar"*,
mientras el backend adjunta a ese mismo cierre su desglose verificado
—Subtotal / Domicilio / Total— y el contrato del modelo le prohíbe escribir
cifras por su cuenta (`bloqueDeCifrasVerificadas`,
`CONTRATO_DE_CONSULTA_DE_DOMICILIO`).

Se retira **la orden de citarla en el resumen**, no la política: cuándo y a
quién se paga el domicilio no está en ninguna tabla, así que el prompt sigue
siendo su única fuente y borrarla dejaría al agente sin saberlo. La conducta
se queda; el dinero lo escribe el backend.

## Medición, cliente por cliente (dry-run, 20-sep-2026)

`pnpm regenerar:flota` sin `--aplicar`, contra producción:

| Cliente | fuentes | guardado | generador ANTERIOR | generador NUEVO |
|---|---|---|---|---|
| **La Churra** | catalog=tabla payment=ficha delivery=prompt | 13.837 | **14.023** 🔴 revivía el bloque | **13.837** ✅ |
| **Lis** | catalog=tabla payment=ficha delivery=prompt | 16.970 | 16.970 | 16.612 (−358) |
| **MALIA** | catalog=tabla payment=**ficha** delivery=**tabla** | 16.235 | 16.235 | 15.762 (−473) |
| **Lashes Valen** | todo en `prompt`, vertical citas | 9.883 | 9.883 | **9.883** ✅ sin cambios |
| Camilabrandcol, korex.ia | sin ficha | 0 | — | no se tocan |

Cada delta está explicado y no hay ninguno sin explicar:

- **La Churra** −186 respecto al generador anterior = el bloque de pago que
  `migrar:pago` había quitado. Vuelve a coincidir con lo guardado: el bucle
  está cerrado.
- **Lis** −358 = su bloque de pago (llave, cuenta, CC, titular). **Nunca se
  migró**: lo tiene duplicado en el prompt hoy mismo, aunque su columna ya
  dice `ficha`.
- **MALIA** −473 = su bloque de pago (−287) más la línea forzada del
  domicilio (−186). Igual que Lis: duplicado vivo, no riesgo futuro.
- **Lashes Valen** 0 = `payment_source='prompt'`. Su compatibilidad no depende
  de nada nuevo: sin la bandera, el generador se comporta como siempre.

> ⚠️ **Hallazgo aparte, no previsto:** Lis y MALIA tienen `payment_source`
> ya en `'ficha'` **con los datos de cuenta todavía escritos en su prompt**.
> No es un riesgo de regeneración: es una duplicación que existe hoy, y MALIA
> tiene el agente encendido. Solo La Churra pasó por `migrar:pago`. Está
> pendiente de decisión (ver *Qué queda*).

## Qué se tocó

| Archivo | Qué |
|---|---|
| `src/server/ai/generador/fuentes.ts` | **nuevo** — la única traducción de columnas a opciones |
| `src/server/ai/generador/generar.ts` | `comoPagan` y `comoRecibe` respetan `pagosEnFicha` / `domicilioEnTabla` |
| `src/server/ai/generador/aplicar.ts` | lee las cuatro columnas; expone `fuentesDelCliente` |
| `src/app/api/admin/clients/[id]/ficha/route.ts` | la vista previa usa las mismas fuentes que el guardado |
| `scripts/regenerar-flota.ts` | selecciona payment/delivery/appointments y usa la traducción única |
| `scripts/convertir-ficha.ts`, `migrar-modalidad.ts`, `simular-ficha-v2.ts` | ídem |
| `tests/unit/generador-respeta-fuentes.test.ts` | **nuevo** — 22 pruebas, incluida la regresión del bucle |

`scripts/migrar-pago.ts` y `src/server/ai/generador/quitar-bloque-pago.ts`
**se conservan**: siguen haciendo falta para limpiar los prompts ya escritos
(Lis y MALIA los necesitan). Lo que dejan de ser es el mecanismo que impide
que el generador reponga el bloque — eso ahora lo hace el generador solo.

## Cómo revertir

Este cambio no toca la base de datos ni migraciones. Revertir es revertir el
commit: el generador vuelve a escribir los bloques y `regenerar:flota` vuelve
a comportarse como antes. Ningún dato se pierde en ninguna dirección, porque
la ficha nunca se modifica — solo se decide qué parte de ella se copia al
prompt.

Si hiciera falta el rollback por cliente y no global, sigue estando donde
siempre: `UPDATE agent_profile SET payment_source='prompt'` (o
`delivery_source='prompt'`) de una fila, sin desplegar.

## Qué queda

1. **Ejecutar la regeneración** (`--aplicar`) — pendiente de autorización. Con
   respaldo automático (`agent_profile_bk_regen_AAAAMMDD`).
2. **Lis y MALIA con el pago duplicado hoy.** La regeneración lo resolvería de
   paso, pero es una decisión de negocio: MALIA tiene el agente encendido.
3. **El rediseño de horarios**, pausado a propósito hasta cerrar esto. Ahora
   puede construirse encima de un generador que ya respeta las fuentes, en vez
   de repetir el mismo error con `hours_*` (ver
   [182](182-FASE-10-VERSIONADO-DE-STATE-SOURCE.md) y la auditoría de horarios).
4. **`scripts/convertir-ficha.ts` tiene un error de tipos preexistente**
   (línea 87, `organizationId` es `string | undefined`). No lo introdujo este
   cambio y no se tocó; sale a la luz porque `tsconfig.json` excluye
   `scripts/` del gate.
