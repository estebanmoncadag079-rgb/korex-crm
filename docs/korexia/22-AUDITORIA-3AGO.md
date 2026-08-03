# Auditoría del 3-ago-2026: seguridad, refactorización y revisión de código

> **Dentro:** Cómo se hizo · Bugs reales corregidos · Deduplicación · Lo que se decidió NO tocar · Verificación

Tres agentes en paralelo (`auditor-seguridad`, `refactorizador`, `revisor-codigo`)
revisaron todo el proyecto, en modo **solo reporte** primero; después se
aplicó todo lo que valía la pena. El detalle de seguridad vive en
[10-SEGURIDAD.md](10-SEGURIDAD.md); esto documenta lo demás y sirve de índice
de la pasada completa.

## Cómo se hizo

Cada agente recibió contexto del proyecto y, el de seguridad y el de
refactorización, instrucción explícita de **no tocar código** en la primera
pasada — solo informar. Con los tres informes sobre la mesa, se aplicó todo
en una sola sesión, verificando `typecheck` + `lint` + la suite completa de
pruebas después de cada cambio, no solo al final.

## Bugs reales corregidos (no solo estilo)

- **`sendTemplate` no funcionaba para La Churra ni Lis.** Enviar una plantilla
  aprobada desde la bandeja (lo único que atraviesa la ventana de 24 h
  cerrada) siempre usaba Meta directo, aunque ambos clientes están conectados
  por YCloud — fallaba con credenciales que no eran las suyas. El código para
  YCloud (`ycloudSendTemplate`) ya existía; solo faltaba usarlo aquí, igual
  que ya hace `sendText`. `src/server/whatsapp/templates.ts`.
- **Una variable de plantilla con `$` corrompía el texto guardado en el CRM.**
  `renderBody` usaba `body.replace(REGEX, variable)`: un valor como
  `"$1,000 de descuento"` hacía que `.replace` interpretara `$1` como el grupo
  capturado por la propia regex. El mensaje real a WhatsApp salía bien (usa el
  valor crudo); solo la copia local quedaba mal escrita. Arreglado pasando una
  función al `replace`, no un string.
- **El camino de Meta directo podía reventar con una excepción sin capturar**
  si algún día un mensaje llegara sin `from` (el mismo caso de nombres de
  usuario de WhatsApp que ya se resolvió para YCloud el 2/3-ago). Hoy ese
  camino no tiene tráfico real, pero el tipo mentía (`from: string`
  obligatorio) y no había ningún guardia. Ahora se descarta con aviso en el
  registro, igual que hace YCloud.

## Deduplicación

Sin cambiar comportamiento (cubierto por la suite de pruebas en cada paso):

- **Traducción de errores de Meta**, copiada 3 veces (`send.ts`,
  `templates.ts` ×2) y ya divergente entre sí — `syncTemplates` no distinguía
  `meta_error` de `meta_unavailable`. Centralizada en
  `server/whatsapp/meta-errors.ts` (`translateMetaError`).
- **Mapeo de `SendError` a código HTTP**, disperso en 3 rutas con resultados
  contradictorios para el mismo error (403 fijo en una, 422 fijo en otra,
  el mapa completo en la tercera). Ahora `sendErrorStatus()` en `send.ts`,
  espejo de `templateErrorStatus()`.
- **Resolución del destinatario** (teléfono o `wa_user_id`), repetida en
  `send.ts` y `templates.ts`. Ahora `resolveRecipient()` en `lib/meta/client.ts`.
- **Buscar la cita activa por nombre parafraseado**, duplicado entre
  reprogramar y cancelar. Ahora `encontrarCitaActiva()` en
  `appointments/logic.ts` (pura, con sus propias pruebas).
- **Avisar al equipo + confirmar al cliente**, el mismo patrón en agendar,
  reprogramar y cancelar. Ahora `avisarYConfirmar()` en `ai/pipeline.ts`.
- **El try/catch de `onLeadReplied`**, copiado en `send.ts` e `ingest.ts`.
  Ahora `avanzarLeadSilencioso()` en `inbox/lead-activity.ts`.
- Un tipo desincronizado (`BoardLead.contact.phone: string` cuando la API ya
  devuelve `string | null`) — sin bug visible hoy, pero dejaba de proteger
  un futuro render.

## Lo que se decidió NO tocar

- **`countVariables` sin des-exportar**: el refactorizador lo marcó como "de
  uso solo interno", pero en realidad `tests/unit/templates.test.ts` la
  importa directamente. Des-exportarla habría roto una prueba existente sin
  ganar nada real.
- **Partir `runAgentTurn` (~440 líneas) en handlers**: es el cambio de mayor
  valor a mediano plazo (el refactorizador lo señaló como el más importante
  después del bug de plantillas), pero también el de más riesgo — es el
  código que atiende a los clientes reales ahora mismo. Se deja para una
  sesión aparte, con tiempo para hacerlo en pasos pequeños contra el
  Laboratorio, en vez de mezclarlo con una tanda de arreglos ya grande.
- **Fusionar el contacto cuando alguien activa/desactiva su nombre de usuario
  de WhatsApp** (se le crean dos contactos separados hoy): limitación de
  diseño conocida, no un bug — documentada en
  [21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md).

## Verificación

`typecheck`, `lint` y la suite completa (**347 pruebas, 44 archivos** —
sube de 332 con pruebas nuevas: `rate-limit.test.ts` para `clientIpFrom`,
`send-template-provider.test.ts` para el enrutamiento YCloud/Graph de
plantillas, `templates.test.ts` para el bug de `$`, y sobre todo
`pipeline-appointments-dispatch.test.ts` — antes agendar/reprogramar/cancelar
solo tenía cobertura de la lógica pura, no de la orquestación completa que
tocó el dedup) y un `pnpm build` de producción, todos en verde. No fue
posible correr `pnpm probar:citas` contra el sandbox real porque este
entorno de trabajo no tiene base de datos local — la verificación equivalente
quedó en la nueva prueba de orquestación, y `probar:citas` sigue siendo la
verificación de referencia una vez desplegado.
