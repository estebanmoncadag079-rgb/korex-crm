# 004 — Separar quién conversa de quién lee los medios

**Estado:** implementado, sin desplegar
**Rama:** `004-separacion-conversacion-transcripcion`
**Fecha:** 21-sep-2026

## El problema, en una frase

Una sola variable —`OPENROUTER_MODEL`— decide **cuatro** cosas distintas, así
que no se puede cambiar el modelo que conversa sin cambiar también el que oye
las notas de voz, el que mira las fotos y el que lee las cartas.

## Por qué aparece ahora

El dueño quiere mover la conversación a GPT-5 mini para bajar el gasto de IA
(medido: US$83,96/mes, 11.233 llamadas, 97,5M tokens de entrada). Pero
`openai/gpt-5-mini` **no acepta audio** — comprobado contra el registro del
proveedor, no supuesto:

```
openai/gpt-5-mini        entrada: text, image, file          temperature: NO
google/gemini-3.7-flash  entrada: text, image, video, file, audio  temperature: SÍ
```

Con el código de hoy, cambiar `OPENROUTER_MODEL` a GPT-5 mini deja sin
entender **805 audios al mes** (27 al día) que hoy pasan por transcripción:
Camilabrandcol 294, Lashes Valen 229, MALIA 196, Lis 82, La Churra 4. Son 420
que mandan los clientes y 385 que manda el negocio desde su celular —
`mediaATexto` corre en las dos direcciones. Sin error visible en el CRM: el
bot simplemente no responde a lo que le dijeron.

---

## 1 · Inventario: quién lee `OPENROUTER_MODEL` hoy

| Archivo | Línea | Para qué | ¿Necesita audio? | ¿Necesita visión? |
|---|---|---|---|---|
| `src/lib/ai/index.ts` | 78-82 | **conversación** (`chatJson`) | no | no |
| `src/server/ai/transcribir.ts` | 64 | **transcribir notas de voz** | **sí** | no |
| `src/server/ai/transcribir.ts` | 272 | **describir imágenes** (comprobantes de pago) | no | **sí** |
| `src/server/ai/generador/extraer-catalogo.ts` | 76 | leer una carta **en foto** | no | **sí** |
| `src/server/ai/generador/extraer-catalogo.ts` | 176 | leer una carta **en texto** de PDF | no | no |

Cuatro responsabilidades, una sola perilla.

## 2 · Los flujos, tal como están

**Texto**
```
WhatsApp → YCloud → ingest.ts → agent_job → pipeline.runAgentTurn
        → chatJson(AgentAction, messages, {jsonSchema}) → acción → BACKEND → respuesta
```

**Audio**
```
WhatsApp → YCloud → ingest.ts:543 → transcribirAudio() → el texto se guarda
        EN EL PROPIO MENSAJE  →  (a partir de aquí es indistinguible de un texto)
```

La transcripción ocurre **una sola vez, al recibir**, nunca durante el turno.
Esa decisión —de julio, cuando el agente ignoraba las notas de voz— es la que
hace que esta separación sea limpia: el punto de corte ya existe, solo estaba
atado a la misma variable.

## 3 · Hallazgos del estudio

**a) No hay *tool calling*.** El sistema no usa la API de `tools` /
`function_call` de OpenAI en ninguna parte. Las acciones del agente son
**salidas estructuradas JSON** (`response_format` + validación Zod).
GPT-5 mini declara `structured_outputs: SÍ`, así que **no hay ningún adaptador
de herramientas que escribir**. La petición hablaba de conservar el tool
calling; lo que hay que conservar es el contrato de acciones, y ese es
independiente del modelo.

**b) La "única frontera con el proveedor" son tres.** El comentario de
`src/lib/ai/index.ts` dice que es la única frontera (Constitución II), pero
`transcribir.ts` y `extraer-catalogo.ts` hacen `fetch` directo al proveedor.
Tres fronteras, cada una con su propio manejo de errores.

**c) `temperature: 0` no rompe, pero deja de servir.** `extraer-catalogo.ts`
lo envía; GPT-5 mini no lo admite. Comprobado con una llamada real: el gateway
**descarta** el parámetro y responde `200`. No es un fallo — es la pérdida
silenciosa del determinismo con el que se leen las cartas.

**d) `extraer-catalogo.ts` no registra su consumo.** No llama a
`registrarUsoIa`. Ese gasto es invisible en `usage_event` hoy.

**e) Los valores no se limpian.** `transcribir.ts` y `extraer-catalogo.ts` leen
`env.OPENROUTER_MODEL` en crudo. Un espacio de más al pegar la variable en el
panel (`OPENROUTER_MODEL= openai/gpt-5-mini`) rompería esas rutas mientras la
conversación seguiría funcionando, porque la cadena de salvavidas sí hace
`.trim()`. El peor tipo de fallo: el que funciona a medias.

## 4 · Decisiones de diseño

### 4.1 Dos papeles, no dos proveedores

```
OPENROUTER_MODEL                → el modelo que CONVERSA
OPENROUTER_TRANSCRIPTION_MODEL  → el modelo que LEE MEDIOS
```

"Leer medios" cubre audio, imágenes y extracción de catálogo: las tres
convierten algo que no es texto conversacional en texto para el backend.
Ninguna habla con el cliente.

**Por qué las imágenes y el catálogo también** (no estaban en el diagrama
pedido): son percepción, no conversación; llevan meses probadas en Gemini con
comprobantes de pago colombianos; la calidad de GPT-5 mini leyendo esos
comprobantes no está medida; y mover conversación y visión a la vez haría
imposible atribuir un fallo a una de las dos. La petición dice "no romper
imágenes, documentos": dejarlas donde están es cumplirla.

### 4.2 Un solo lugar decide qué modelo va en cada papel

Módulo nuevo `src/lib/ai/modelos.ts`, con una función por papel. Nadie más
vuelve a leer `env.OPENROUTER_MODEL` directamente. Ahí se hace el `.trim()`,
una vez, para todos.

### 4.3 Si la variable de transcripción no está, se usa la de conversación

Preserva exactamente el comportamiento de hoy para quien no la configure: cero
regresión en el resto de la flota. Pero **deja un aviso explícito en el log**,
porque es justo la trampa que casi se activa en producción el 21-sep. No es un
salvavidas silencioso: es el valor por defecto de siempre, dicho en voz alta.

### 4.4 Ambigüedad resuelta: OpenRouter sigue siendo la pasarela

La petición dice "implementar ChatGPT como proveedor conversacional". Hoy todo
sale por OpenRouter, que **es** la API de OpenAI: mismo endpoint
`/v1/chat/completions`, mismo formato. `openai/gpt-5-mini` ya es alcanzable —
de hecho ya se midió con 493 llamadas reales.

Ir directo a `api.openai.com` costaría: una credencial nueva, una dependencia
de runtime nueva (Constitución II la prohíbe en v1), perder el `usage.cost`
exacto que devuelve OpenRouter —habría que estimarlo por tarifa, y el
comentario de `AiUsage` explica por qué eso se rechazó— y perder la cadena de
salvavidas entre proveedores distintos.

**Resolución:** OpenRouter se queda, los papeles se separan. El diseño no
cierra la puerta: apuntar `OPENROUTER_BASE_URL` a OpenAI directo seguiría
funcionando sin tocar código. **Se reporta como decisión, no se bloquea.**

## 5 · Lo que NO cambia

- La autoridad del backend. Ni una línea de `pipeline.ts`, `estado.ts`,
  `catalog/` ni de los `*_source`.
- El contrato de acciones (`AgentAction`) y su esquema.
- El prompt, la ficha, la conducta, el catálogo, los precios, las reglas.
- El flujo de ingesta: descarga, MIME, tamaño máximo, idempotencia, reintentos.
- La cadena de salvavidas de la conversación y su `console.warn`.
- El sandbox del Laboratorio.

## 6 · Criterios de aceptación

| # | Criterio | Cómo se comprueba |
|---|---|---|
| 1 | El audio nunca usa el modelo conversacional cuando hay uno de transcripción | prueba unitaria + guardarraíl de código |
| 2 | `transcribir.ts` no vuelve a leer `OPENROUTER_MODEL` | guardarraíl que lee el archivo |
| 3 | Sin la variable nueva, el comportamiento es idéntico al de hoy | prueba unitaria |
| 4 | Los espacios sobrantes no rompen ninguna ruta | prueba unitaria |
| 5 | El catálogo registra su consumo | prueba unitaria |
| 6 | Cada llamada queda atribuida a su papel en `usage_event` | prueba unitaria |
| 7 | El modelo real de cada turno sigue viajando a la traza | prueba existente, sin tocar |
| 8 | Gate completo en verde, sin regresiones | `typecheck` + `lint` + `build` + 2.597 pruebas |
| 9 | Rollback = una variable, sin código ni datos | documentado y ensayado |

## 7 · Rollback

Quitar `OPENROUTER_TRANSCRIPTION_MODEL` y devolver `OPENROUTER_MODEL` a
`google/gemini-3.7-flash`. Reiniciar. No hay migración, no hay dato tocado, no
hay ficha modificada. El código nuevo con las dos variables apuntando al mismo
modelo se comporta exactamente como el de hoy.
