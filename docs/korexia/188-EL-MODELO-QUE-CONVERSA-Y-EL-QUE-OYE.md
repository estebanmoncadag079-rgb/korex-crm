# 188 · El modelo que conversa y el que oye

**21-sep-2026** · código en `main`? **no** · desplegado? **no**

## El minuto en que casi se rompe

El dueño abrió el panel de variables de producción para cambiar el modelo de
IA a `openai/gpt-5-mini` y bajar el gasto. En la pantalla escribió esto:

```
OPENROUTER_MODEL= openai/gpt-5-mini
OPENROUTER_TRANSCRIPTION_MODEL = google/gemini-3.7-flash
OPENROUTER_FALLBACK_MODEL_2=openai/gpt-5-mini
OPENROUTER_JUDGE_MODEL=google/gemini-3.7-flash
```

y preguntó cuáles dejar. Tres cosas estaban mal, y las tres eran invisibles
desde esa pantalla:

1. **`OPENROUTER_TRANSCRIPTION_MODEL` no existía en el código.** Cero
   apariciones en todo el repositorio. Ponerla no hacía nada.
2. Por tanto `transcribir.ts` seguiría leyendo `OPENROUTER_MODEL`, que ya
   decía `gpt-5-mini`. Y **ese modelo no acepta audio**.
3. El espacio en `= openai/gpt-5-mini` habría roto unas rutas y otras no.

## Lo que se habría roto, con números

`openai/gpt-5-mini`, según el registro del propio proveedor —no una
suposición:

```
entrada: text, image, file        ← sin audio
temperature: no soportada
```

Audios que hoy pasan por transcripción, últimos 30 días:

| Negocio | Del cliente | Del negocio | Total |
|---|---:|---:|---:|
| Camilabrandcol | 97 | 197 | 294 |
| Lashes Valen | 155 | 74 | 229 |
| MALIA | 114 | 82 | 196 |
| Lis Pastelería | 50 | 32 | 82 |
| La Churra | 4 | 0 | 4 |
| **Total** | **420** | **385** | **805** (27 al día) |

**Las dos direcciones cuentan.** `mediaATexto` se llama tanto en la ingesta
del cliente (`ingest.ts:319`) como en el eco de coexistencia del negocio
(`:673`). Las del negocio no son un detalle: si Lis resuelve por nota de voz
"el domicilio son 8.000" y devuelve el turno, el agente retomaría sin saberlo
— está escrito en el propio comentario de esa línea.

Veintisiete audios al día a los que el bot no habría sabido responder. **Sin
error visible en el CRM**: la transcripción devuelve `null`, el mensaje se
guarda sin texto y el agente contesta como si no le hubieran dicho nada.
Exactamente el fallo de julio con la clienta de Lis que preguntó por
domicilios y recibió "qué alegría que nos escribas" — el que motivó que
existiera la transcripción.

### La línea base que no se puede empeorar

Medida sobre lo que ya hay guardado, sin llamar al modelo ni una vez:

```
últimos 7 días, audios con medio descargable: 181
sin texto:                                      4   =  2,2%
```

Ese 2,2% es el listón. Un primer conteo dio 20,5%, pero **86 de los 420 sin
texto eran una importación**: 69 de Camilabrandcol son mensajes del 31-ago al
5-sep escritos todos en doce minutos el 14-sep a las 22:01, sin `media_url`.
No hay nada que descargar ahí, así que nunca hubo transcripción que fallar.
Contar esos como fallos habría dado una alarma falsa del 20%.

## La causa, que no era el modelo

Una sola variable, `OPENROUTER_MODEL`, mandaba sobre **cuatro** trabajos:

| Archivo | Trabajo | ¿Necesita oír? | ¿Necesita ver? |
|---|---|---|---|
| `lib/ai/index.ts` | conversar | no | no |
| `ai/transcribir.ts:64` | transcribir notas de voz | **sí** | no |
| `ai/transcribir.ts:272` | describir comprobantes | no | **sí** |
| `generador/extraer-catalogo.ts` | leer cartas (×2) | no | sí |

No se podía cambiar el que conversa sin cambiar los otros tres de rebote.

## El arreglo: dos papeles

```
OPENROUTER_MODEL                → el que CONVERSA
OPENROUTER_TRANSCRIPTION_MODEL  → el que LEE MEDIOS
```

Y un solo sitio que reparte, `src/lib/ai/modelos.ts`. Nadie más vuelve a leer
la variable en crudo.

**Las imágenes y el catálogo van con el audio**, no con la conversación. Son
percepción, no diálogo: convierten algo que no es texto en texto para el
backend, y ninguna habla con el cliente. Además llevan meses probadas leyendo
comprobantes de pago colombianos, y mover conversación y visión a la vez
haría imposible saber a cuál de las dos culpar si algo empeora.

**Si la variable nueva no está, se usa la de conversación** — el
comportamiento exacto de antes, cero regresión para el resto de la flota —
pero dejando un aviso en el log que nombra la consecuencia:

```
[modelos] sin OPENROUTER_TRANSCRIPTION_MODEL: los medios usarán el modelo
conversacional (openai/gpt-5-mini). Si ese modelo no acepta audio, las notas
de voz dejarán de entenderse sin dar ningún error.
```

## Tres hallazgos de paso

**El espacio que rompe la mitad.** `transcribir.ts` y `extraer-catalogo.ts`
leían la variable en crudo; la cadena de salvavidas sí hacía `.trim()`. Con
`OPENROUTER_MODEL= openai/gpt-5-mini` la conversación habría funcionado y los
medios no. Ahora se limpia una vez, en el repartidor.

**`temperature: 0` no rompe, pero deja de servir.** `extraer-catalogo.ts` lo
envía para que leer una carta sea determinista. `gpt-5-mini` no lo admite.
Comprobado con una llamada real: el gateway **descarta** el parámetro y
responde `200`. No falla — simplemente el catálogo dejaría de leerse igual dos
veces seguidas. Una razón más para que el catálogo vaya con el modelo de
medios.

**El catálogo no medía su gasto.** `extraer-catalogo.ts` no llamaba a
`registrarUsoIa` ni pedía `usage.include`. Ese dinero era invisible en
`usage_event`. Ahora se anota, con `ref` `catalogo:imagen` o `catalogo:texto`.

## Lo que NO cambió

Ni una línea de la autoridad del backend. No se tocó `pipeline.ts`,
`estado.ts`, `catalog/`, ninguna ficha, ningún `*_source`, ningún precio,
ninguna regla. El contrato de acciones del agente es el mismo.

Y un dato del estudio que conviene tener escrito: **el sistema no usa el
*tool calling* de OpenAI en ninguna parte**. Las acciones del agente son
salidas JSON estructuradas validadas con Zod. `gpt-5-mini` declara
`structured_outputs: sí`, así que no hubo nada que adaptar.

## El guardarraíl

`tests/unit/audio-no-usa-el-modelo-que-conversa.test.ts`, 11 comprobaciones.
Dos capas, porque una sola no basta:

- **Comportamiento**: con los dos modelos configurados, se mira el cuerpo que
  de verdad sale hacia el proveedor y se exige que el audio lleve el del
  oyente.
- **Estructura**: ningún archivo de medios puede volver a leer
  `env.OPENROUTER_MODEL`. Hace falta porque el comportamiento solo se rompe
  cuando los dos modelos difieren — y en el portátil de cualquiera valen lo
  mismo, así que la prueba de comportamiento pasaría en verde con el código
  roto.

Más una que fija la arquitectura entera: **`pipeline.ts` no puede llamar a
`transcribirAudio`**. La transcripción ocurre al ingerir, una vez; si alguien
la moviera al turno, el conversacional recibiría audio y sería el mismo
incidente por otra puerta.

**Probado reproduciendo el incidente**: devolviéndole a `transcribir.ts` la
línea de ayer (`const modelo = env.OPENROUTER_MODEL`) quedan **3 en rojo**,
nombrando el fallo exacto:

```
× una nota de voz se manda al modelo de transcripción
    expected 'openai/gpt-5-mini' to be 'google/gemini-3.7-flash'
× una imagen también: describir un comprobante es percepción, no diálogo
    expected 'openai/gpt-5-mini' to be 'google/gemini-3.7-flash'
× src/server/ai/transcribir.ts no lee OPENROUTER_MODEL
```

Restaurado: 11 en verde.

## Cómo se revierte

Una variable. `OPENROUTER_MODEL` vuelve a `google/gemini-3.7-flash`, se quita
`OPENROUTER_TRANSCRIPTION_MODEL`, se reinicia. Sin migración, sin dato tocado,
sin ficha modificada. Con las dos variables apuntando al mismo modelo, el
código nuevo se comporta exactamente como el viejo.
