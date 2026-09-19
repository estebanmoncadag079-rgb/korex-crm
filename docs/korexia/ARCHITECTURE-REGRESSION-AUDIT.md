# Auditoría de blindaje de arquitectura — Korex

> **16-sep-2026.** Documento de cierre de la consolidación documental de la
> arquitectura oficial de Korex. No cambia comportamiento de código ni de
> producción — es exclusivamente documentación y reglas para IAs futuras.

---

## 1. Cuál es la única arquitectura oficial

**Backend como autoridad.** El LLM interpreta la intención del cliente y
propone operaciones de un conjunto cerrado (`Operacion[]`). Korex orquesta
esa propuesta. El backend valida cada operación contra tres compuertas,
resuelve todo dato contra catálogo/agenda/estado reales, calcula lo que haya
que calcular, y persiste el resultado de forma atómica. El LLM comunica al
cliente lo que el backend ya decidió — nunca decide él mismo un precio, un
total, una disponibilidad ni si un cierre puede ejecutarse.

Fuente canónica: **[REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md)**,
sección "Arquitectura oficial de Korex" (Principio 7 y siguientes).
Implementación de referencia: `specs/003-backend-como-autoridad/`.

## 2. Cuál era la arquitectura histórica

Dos capas históricas, ninguna vigente:

1. **Pre-Fase 2 (hasta ago-2026)**: el modelo recibía el catálogo completo
   en el prompt y devolvía una acción con el pedido reconstruido como texto
   libre (`summary`). El backend no tenía ningún dato estructurado del
   pedido.
2. **Fase 2 / "arquitectura nueva" de agosto (18-ago a 15-sep-2026)**:
   `state_source='backend'` ya existía, pero el modelo seguía
   **reescribiendo el pedido/reserva completo** cada turno
   (`esquemaDelEstado`); el backend guardaba ese estado pero no lo usaba
   para decidir el cierre. Es la arquitectura que describe
   `docs/korexia/111-LIS-EN-LA-ARQUITECTURA-NUEVA.md` — el nombre "nueva" es
   relativo a esa fecha, no a hoy.

Feature 003 (15-sep-2026 en adelante) reemplazó la capa 2 por operaciones
validadas con autoridad real del backend. Ninguna de las dos capas
históricas está activa en el código: verificado que `esquemaDelEstado` no
tiene llamadores fuera de comentarios comparativos (`grep` en `src/`).

## 3. Por qué la histórica NO puede utilizarse para nuevos desarrollos

Porque el backend, en las dos capas históricas, **no era la autoridad**: el
modelo podía escribir un precio, inventar que un pedido estaba completo, o
confirmar un cierre sin que nada lo verificara contra datos reales. Es
exactamente la causa raíz que Feature 003 corrigió (ver `spec.md`,
"Contexto") y la misma familia de incidentes que costó ventas reales
(`docs/korexia/144`, `156`, entre otros). Reintroducirla —aunque sea
parcialmente, para "resolver" un problema puntual— reabre esa misma clase
de fallos.

## 4. Precedencia documental

En caso de contradicción entre documentos:

1. `REGLAS-DE-ARQUITECTURA.md` (raíz del repo)
2. `CLAUDE.md`
3. Documentación arquitectónica vigente (`docs/korexia/`, secciones marcadas como vigentes)
4. Specs/Features de implementación (`specs/NNN-nombre/`)
5. Documentación histórica (marcada explícitamente como tal)
6. Documentación antigua no vigente

La documentación histórica explica cómo funcionaba antes. Nunca es
instrucción para implementar nada nuevo. Ante cualquier conflicto, gana el
documento de mayor precedencia — nunca "el más reciente" ni "el más
detallado".

## 5. El Architecture Checkpoint

Antes de modificar algo que toque pedidos, citas, precios, estado o
confirmación, responder (texto completo en `REGLAS-DE-ARQUITECTURA.md`):

1. ¿Cuál es el problema? 2. ¿Causa raíz? 3. ¿Qué capa es responsable?
4. ¿El cambio modifica la arquitectura oficial? 5. ¿Conserva Backend como
autoridad? 6. ¿El LLM sigue siendo solo intérprete/comunicador? 7. ¿El
backend sigue siendo la autoridad? 8. ¿Es una excepción para un cliente?
9. ¿Es un parche de prompt para un problema de otra capa? 10. ¿Se está
usando documentación histórica como referencia de implementación? 11. ¿Podría
reintroducir `state_source=prompt` como arquitectura? 12. ¿Qué prueba
demuestra que no hubo regresión?

Si alguna respuesta indica regresión: detenerse, no implementar, reportar la
contradicción en vez de resolverla por cuenta propia.

## 6. Cómo se evita el "prompt patching"

Regla explícita (sección 13 de "Arquitectura oficial de Korex"): un bug se
corrige en la capa que lo causó — modelo, prompt/comunicación,
orquestación, resolver, catálogo/estado, backend/compuertas o guardarraíl —
nunca con un cambio de prompt que compense un error de otra capa. Antes de
tocar un prompt: reproducir el problema, encontrar la causa raíz, identificar
la capa responsable, y confirmar que el problema es genuinamente de
interpretación o comunicación del LLM.

## 7. Cómo se evita regresar a `state_source=prompt` como arquitectura

- **En código**: verificado que existe un único punto de inserción de
  `agent_profile` (`provisionOrganization`, `src/server/auth/provisioning.ts`)
  y que siempre aplica `arquitecturaAprobadaPara('backend')`
  (`src/server/auth/arquitectura.ts`). No hay ninguna ruta web que exponga
  `state_source`. El único mecanismo de escritura posterior es
  `scripts/fase2.ts`, manual y auditado (`conRegistro`).
- **En documentación**: la "Regla de no regresión arquitectónica" (sección
  dedicada en `REGLAS-DE-ARQUITECTURA.md`) prohíbe explícitamente que una IA
  decida unilateralmente volver a `state_source=prompt` como diseño. Puede
  seguir existiendo como **contención operativa puntual y documentada**
  (el caso real de Lis/MALIA durante el rollout de Feature 003) — eso nunca
  es una segunda arquitectura oficial.

## 8. Cómo deben entrar los nuevos clientes

Directamente en `state_source=backend`, sin paso manual — ya garantizado por
código (`arquitecturaAprobadaPara` + `provisionOrganization`), documentado
ahora también en `REGLAS-DE-ARQUITECTURA.md` sección 10 ("Nuevos clientes").

## 9. Cómo deben tratarse los clientes pausados o sin configurar

**Fuera de alcance no es fuera de arquitectura** (sección 11 de "Arquitectura
oficial de Korex"). Un cliente deshabilitado, pausado o sin ficha/catálogo
completo sigue naciendo y permaneciendo en `state_source=backend`. Activarlo
o completarlo no debe ni necesita tocar esa bandera.

## 10. Cómo debe actuar una IA ante una contradicción documental

Detenerse y reportar la contradicción explícitamente, citando ambas fuentes
y sus niveles de precedencia (sección 4) — nunca elegir una arquitectura por
cuenta propia, nunca asumir cuál es la vigente sin verificar contra
`REGLAS-DE-ARQUITECTURA.md`. Es la misma regla que ya gobierna el resto de
este proyecto ("si encuentras una contradicción arquitectónica real,
detente y repórtala").

---

## Estado de clientes (verificado, no supuesto — 16-sep-2026)

| Cliente | `state_source` | `enabled` | Arquitectura | Nota |
|---|---|---|---|---|
| La Churra | `backend` | `true` | Oficial, activa | Único negocio corriendo Feature 003 en producción real |
| Lis Pastelería | `prompt` | `true` | Contención temporal | Nace en `backend`; bajado manualmente (`fase2 --apagar`) como contención del rollout — no es su arquitectura de diseño |
| MALIA | `prompt` | `true` | Contención temporal | Ídem |
| Lashes Valen | `backend` | `false` | Oficial, pausada | Ya en `backend` desde su creación (ago-2026); pausada por decisión de negocio, no de arquitectura |
| Camilabrandcol | `backend` | `false` | Oficial, sin configurar | Ya en `backend` desde su creación; fuera del rollout solo por falta de ficha/catálogo |

## Resultados de la búsqueda global (antes de esta fase)

Búsqueda `grep -i` en todo el repositorio (`.md`) contra los términos de
riesgo (`state_source=prompt`, "LLM mantiene el estado", "prompt como fuente
de verdad", "modelo calcula precio/total/disponibilidad", "una sola action",
"esquemaDelEstado", "arquitectura nueva de Lis", etc.):

| Hallazgo | Clasificación |
|---|---|
| `docs/korexia/01`, `04` — diagrama sin `operaciones[]` | E → corregido en esta fase (sección "Desde Feature 003" agregada) |
| `docs/korexia/01:36` — modelo `gemini-2.5-flash` | C → corregido (verificado: `gemini-3.7-flash`) |
| `specs/.../spec.md`, `plan.md` — rollout simultáneo | A (contra la historia real) → corregido (banners "PLAN ORIGINAL/HISTÓRICO") |
| `docs/korexia/111` — "arquitectura nueva" de agosto | E → corregido (banner HISTÓRICO agregado) |
| `docs/korexia/00-INDICE.md` — sin entrada de arquitectura vigente | E → corregido (secciones "ARQUITECTURA VIGENTE"/"HISTÓRICO" agregadas) |
| `docs/korexia/86-DOS-PRODUCTOS-EN-UN-PEDIDO.md` — `state_source=prompt` de La Churra en 17-ago | B, ya correctamente enmarcado como bitácora fechada — sin acción |
| `docs/korexia/110`, `156`, `spec.md:36`, `141` — menciones de "el modelo decide/calcula/mantiene" | D, comparativas o de un eje distinto (UX, diagnóstico de un bug ya corregido) — sin acción |
| Comentarios `esquemaDelEstado` en `pipeline.ts`/`orders/operaciones.ts` | D, correctamente marcados como código reemplazado — sin acción |
| Prompts reales, `conducta.ts`, `prompts.ts` | A, sin ninguna instrucción viva que contradiga Backend como autoridad |

No se encontró ningún documento adicional, durante la aplicación de esta
fase, que requiriera reclasificación o corrección más allá de los ya
identificados en la Fase 1.

## Riesgos residuales

- **`docs/korexia/121-PENDIENTES-20AGO.md` sigue siendo el "empieza por
  aquí" para pendientes operativos** — es correcto para esa pregunta (qué
  falta operativamente), pero un lector apresurado podría confundirlo con
  el punto de entrada arquitectónico. Mitigado con la sección "ARQUITECTURA
  VIGENTE" en `00-INDICE.md`, que ahora se lee antes que la tabla
  cronológica — pero no es una garantía estructural, es una convención de
  lectura.
- **La cifra "24 guardarraíles"** en `spec.md`/`plan.md`/`tasks.md` sigue
  sin conciliarse con los 19 confirmados por nombre propio en código
  (`agregarGuardarrail`). No se corrigió en esta fase (es una imprecisión
  menor, no una ambigüedad arquitectónica) — queda anotado para quien
  documente T030.
- **La bitácora completa de `docs/korexia/` (177 archivos)** no se leyó
  palabra por palabra; se auditó mediante búsqueda dirigida por los
  términos de riesgo explícitos. Es posible que exista una mención aislada
  no capturada por esa búsqueda — el Architecture Checkpoint (sección 5) es
  la salvaguarda estructural para ese caso, no la exhaustividad de esta
  auditoría puntual.
