# 199 — Auditoría: qué del prompt compartido debería configurarse en el CRM

26-sep-2026. Solo lectura, sin cambios. Pregunta del dueño: *¿no es mejor
configurar el negocio desde el CRM, si los negocios son tan distintos?*

## Cómo se arma hoy lo que lee el bot

| Capa | Dónde vive | ¿Lo ve el cliente en el CRM? | Tamaño (Lis) |
|---|---|---|---|
| Lo del negocio (tono, catálogo, entrega, pagos, reglas propias, FAQ…) | ficha → `generar.ts` | Sí | ~35 % |
| Reglas comunes de conducta | `conducta.ts` (CIERRE, NUNCA, CADENCIA, meta, FUERA_DE_HORARIO…) | No | ~65 % (~12.600 car.) |
| Marco de cada mensaje | `prompts.ts` (primera línea, contrato de acciones, recordatorio de horario, pagos) | No | se suma aparte |
| Textos fijos al cliente | `pipeline.ts`, `anuncio-de-cierre.ts` | No | frases sueltas |

## Hallazgos

### 1. Conflictos DEMOSTRADOS entre reglas comunes y lo que escribió el negocio

| # | Regla común | Lo que dice el negocio | Efecto |
|---|---|---|---|
| 1.1 | `CIERRE`: "Si te preguntan cómo pagar, contesta… la cuenta" | Lis, *nunca*: "Dar los datos de la cuenta antes de la confirmación"; y `pagoDePedidosParaElPrompt`: "solo DESPUÉS de que confirme" | **Tres órdenes contradictorias** sobre cuándo dar la cuenta, en el mismo prompt |
| 1.2 | `CIERRE`: "que espere a tener el total con el domicilio antes de transferir" | MALIA cobra el domicilio en el total (tabla de zonas) | A MALIA le sobra: puede confundir a quien ya tiene su total completo |
| 1.3 | Bloque del backend al cerrar: "Subtotal $X / **Total: $X**" | Lis, regla propia: "especificar TOTAL SIN DOMICILIO" | El cierre de Lis dice "Total" como si no hubiera domicilio (visto en cierres reales del 21-sep) |
| 1.4 | `ESTILO` + primera línea del marco: "español neutro, mensajes breves" | Lis escribió su propio "## CÓMO ESCRIBES" en reglas propias; su tono: "nunca frío ni cortante" | El negocio tuvo que pelear contra la regla común (mitigado en doc 198, no resuelto) |
| 1.5 | `meta()` orden fijo: nombre+celular (4), entrega+dirección (5) | El dueño pide los datos juntos; La Churra quiere las presentaciones en el primer mensaje | El orden no es universal |
| 1.6 | Contrato: respuesta a una PUBLICACIÓN que pregunta algo → **handoff** | Lis 25-sep: "hoy tienes de qué sabores" (respuesta a historia) → derivó | Decisión de negocio fija en código |

### 2. Prioridad mal resuelta

Las reglas propias dicen "**mandan sobre todo lo anterior**", pero van ANTES de
`CIERRE`, `FUERA_DE_HORARIO`, `NUNCA` y `NO_ENCAJA`. En un empate con esos bloques
—por ejemplo, 1.1— la regla del negocio no tiene la prioridad que promete.

### 3. Duplicados (dos fuentes del mismo tema)

| Tema | Aparece en |
|---|---|
| Tono | `agent_profile.tone` (marco) **y** dentro de `instructions` |
| Salud → persona | `NUNCA`, `CONTRATO_DE_ACCIONES`, y copiado en la ficha de Lashes |
| No despachar a nadie | `NO_ENCAJA` y `CONTRATO_DE_ACCIONES` (texto casi igual) |
| Nunca dar un pago por bueno | `NUNCA`, `CONTRATO_DE_ACCIONES`, `comoPagan` |
| Atender varias cosas seguidas | `NUNCA` y `CONTRATO_DE_ACCIONES` |
| Cómo escalar | `escalationRules` y copiado en la ficha de Lashes |
| "Una cosa cada vez" | `CONTRATO_DE_ACCIONES` (notify_order) vs "un punto por mensaje" de `CADENCIA` |

### 4. Textos fijos que ve el cliente, iguales para todos

- "Dame un momentico 🙏 Te comunico con una persona del equipo…" (al derivar)
- "Domicilio: pendiente de cotización — te confirmamos el valor aparte"
- "Por favor, dime el barrio para ayudarte con el total con el domicilio 🙏"
- Saludo por defecto: "¡Hola! 👋 Soy el asistente de …"
- Formato "Subtotal / Domicilio / Total" del cierre

Ninguno respeta el tono de la ficha.

## Clasificación

**A. Núcleo universal — se queda en código** (seguridad, iguales para todos):
no inventar datos duros; no anunciar lo que no se hizo; no negar lo que no se
sabe; no dar un pago por bueno; salud → persona; no hacer encargos ajenos;
tratar [COMPROBANTE]/[TEXTO]/[IMAGEN]; no volver a preguntar lo ya dado; la
mecánica de acciones (notify_order, provide_requirement, consultas, fotos); el
dato de abierto/cerrado.

**B. Depende del vertical — ya se resuelve por configuración:** cierre de
pedidos vs. citas; pago antes de la cita; domicilio con tabla vs. cotizado.

**C. Depende del negocio — debería ser configuración del CRM (con un valor por
defecto):**

| Campo propuesto en la ficha | Reemplaza | Resuelve |
|---|---|---|
| Cómo escribe (largo, variante regional, emojis) — o dentro del tono | `ESTILO`, primera línea del marco | 1.4 |
| Pasos del pedido (qué y en qué orden; qué va junto) | orden fijo de `meta()` | 1.5 |
| Cómo se muestra el resumen y el total (p. ej. "TOTAL SIN DOMICILIO") | formato fijo de `CIERRE` y del bloque del backend | 1.3 |
| ¿Datos de la cuenta antes de confirmar? sí / solo si los piden / no | tres reglas contradictorias | 1.1 |
| ¿Tomas pedidos con el negocio cerrado? + qué decir | `FUERA_DE_HORARIO` y recordatorios | política hoy fija |
| Qué hacer con respuestas a publicaciones | regla del contrato | 1.6 |
| Frases del bot (derivar, pedir barrio, domicilio pendiente, saludo) | textos fijos | sección 4 |
| Formas de pago por modalidad (domicilio / recoger) | frase libre `pago.formas` | caso Sofía (doc 198) |

La nota de 1.2 no necesita campo: se deriva de la configuración que ya existe
(`delivery_source`).

## Recomendación, por orden

1. **Corregir ya los conflictos demostrados** (1.1, 1.2, 1.3) y la prioridad (2):
   que las reglas del negocio vayan al final y manden de verdad. Cambio chico, en
   el generador.
2. **Quitar duplicados** (3): cada tema en un solo sitio. Reduce el prompt y los
   choques.
3. **Nuevos campos de la ficha** (C), siempre con un valor por defecto, para que
   ningún negocio quede peor si no los llena.
4. **Textos fijos al cliente** (4) → campos con defecto, redactados en el tono
   del negocio.

No es rehacer la plataforma (se evaluó y descartó en agosto): es mover a la
ficha lo que hoy está fijo en código sin ser universal.
