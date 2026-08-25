# El turno mudo: provide_requirement / update_lead sin reply

> **Dentro:** El caso real · La investigación · La causa raíz (dos capas) ·
> El fix · Cómo se verificó · Lo que NO se tocó, y por qué · Cómo revertir

**24-ago-2026, 17:07 hora Colombia.** Un cliente reportó una captura real:
una clienta de Lis Pastelería dio nombre, teléfono y dirección para su
domicilio, y el agente no respondió NADA — ni error visible, ni el mensaje
siguiente, silencio total.

## El caso real

```
Agente:  ¿Cuál es la dirección completa de tu domicilio?     17:07:07
Clienta: Hilary Candelo                                      17:07:28
         3184052920
         Domicilio
         Cra67a 33b 63
         Casa esquinera abajo hay un farmacenter
Agente:  ( … nada … )
                                                    ← la dueña, viendo el
                                                       chat sin responder,
Karen:   Serían 22.000                                17:12:02
         [datos de pago]                               17:12:10
```

## La investigación

Siguiendo el protocolo ya establecido para "el bot no responde" (mirar
`handoff_at`/`handoff_reason` antes que nada más — ver
[23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md) y los casos 1-13
documentados ahí y en bitácoras posteriores): primero se buscó la
conversación real (`cv_6eqdf9fnpgtj762l5yns`) y se miró
`handoff_at`/`handoff_reason` — `operador`, pero recién a las 22:44, mucho
después del hueco de silencio; no explica los primeros minutos.

`usage_event` mostró que SÍ hubo una llamada al modelo a las 17:07:37 (9
segundos después del mensaje de la clienta), con costo normal — no fue un
fallo del proveedor. El log del contenedor que corría en ese momento reveló
la causa exacta:

```
[cambio] ... campo=datos.direccion valor_anterior=null valor_nuevo=<...>
[requisitos] no se pudo capturar "direccion": el requisito "direccion"
             todavía no tiene dónde guardarse
```

Sin ninguna línea de envío después de esta — ni `deliverReply`, ni error,
ni handoff.

El estado conversacional SÍ se actualizó (el modelo extrajo nombre,
teléfono y dirección correctamente), pero después de eso: nada. Ni
`deliverReply`, ni fila de mensaje, ni handoff.

## La causa raíz (dos capas)

**Capa 1 — la que de verdad calló al cliente.** `provide_requirement` trae
`reply` OPCIONAL en el esquema (`reply: z.string().optional()`, pensado
para "seguir la conversación en el mismo turno" — agradecer el dato,
retomar lo que faltaba). El ejecutor en `pipeline.ts` solo manda algo `if
(action.reply)`. El modelo, en este turno, emitió `provide_requirement`
**sin** `reply`. Resultado: nada se envía, nada se guarda como fila de
mensaje, ningún guardarraíl de texto tiene nada que revisar
(`textosAlCliente(action)` ya devuelve `[]` cuando no hay `reply`, así que
los 11 guardarraíles existentes —todos detectores de TEXTO— no tenían
ninguna oportunidad de intervenir).

**Capa 2 — por qué el requisito "direccion" falló al capturarse (no es la
causa del silencio, es paralela).** `capturar()` en `contacts.ts` solo
sabe escribir en columnas declaradas en `CAMPO_DE_REQUISITO`, y hoy ese
mapa solo tiene `nombre → contact.name`. "direccion" no tiene destino
—`contact` ni siquiera tiene una columna de dirección— así que `capturar()`
rechaza explícitamente, **a propósito**: es la misma protección que ya
documentó [103-REQUISITOS-IMPLEMENTADO.md](103-REQUISITOS-IMPLEMENTADO.md)
("qué pasa cuando se declara un requisito que el sistema todavía no sabe
capturar"). Esto es deuda visible y conocida, NO un bug nuevo — y aunque se
hubiera resuelto, el cliente **igual** se habría quedado sin respuesta,
porque el silencio depende únicamente de la Capa 1.

## El fix

Nuevo chequeo en `pipeline.ts`, junto al de "requisito faltante" (mismo
estilo: no detecta texto, detecta su AUSENCIA, así que vive en el pipeline
y no en `anuncio-de-cierre.ts` como los detectores de regex):

```ts
const ACCIONES_QUE_SIGUEN_LA_CONVERSACION = ["provide_requirement", "update_lead"];
if (
  ACCIONES_QUE_SIGUEN_LA_CONVERSACION.includes(action.action) &&
  textosAlCliente(action).length === 0
) {
  // reintenta con CORRECCION_DE_TURNO_MUDO; si insiste, deriva a una persona
}
```

Mismo patrón detectar→reintentar→handoff que los otros 11 guardarraíles.
Sin regex, sin riesgo de falso positivo: la condición es 100%
determinística (revisa los campos de la propia acción, no adivina sobre
prosa).

`update_lead` entra en el mismo chequeo porque comparte exactamente la
misma forma (`reply` opcional, mismo comentario en el esquema: "para seguir
la conversación en el mismo turno") — aunque el incidente real fue con
`provide_requirement`, la vulnerabilidad es idéntica y ya estaba ahí.

## Cómo se verificó

```
pnpm vitest run tests/unit   # 978 passed (3 nuevas)
pnpm typecheck                # limpio
pnpm lint                     # limpio
```

`tests/unit/turno-mudo.test.ts`: el caso real exacto (`provide_requirement`
con `requisitoId: "direccion"` sin `reply` → `textosAlCliente` da `[]`),
`update_lead` sin `reply` (mismo patrón), y el caso con `reply` presente
(no debe activarse).

**Desplegado y verificado dentro del contenedor** el mismo día: literales
del fix (sin tildes, por el tropiezo ya conocido de este proyecto con el
grep dentro del contenedor) presentes en el bundle compilado, `BUILD_ID`
fresco, migraciones aplicadas sin error, contactos de los 3 negocios
intactos.

## Lo que NO se tocó, y por qué

- **`CAMPO_DE_REQUISITO` sigue sin "direccion".** Agregarlo requiere una
  migración de esquema (columna nueva en `contact`) y es una decisión de
  producto —qué requisitos declarar, dónde vive cada dato—, no algo que
  resolver de paso en un fix de "el bot no responde". Queda como estaba,
  documentado como deuda desde el 103.
- **No se investigó por qué el modelo omitió `reply` esta vez en
  particular.** El fix es la RED (como el guardarraíl del resumen mal
  armado, doc 87): si el prompt cumple, no salta nunca y no cuesta nada;
  si el modelo vuelve a omitirlo, ahora hay una garantía de código detrás.
- **`handoff` sigue con `farewell` opcional, sin chequeo.** Ahí SÍ puede
  ser correcto quedarse en silencio (el turno espera a una persona) — no
  es el mismo patrón que "seguir la conversación", así que no se incluyó
  en `ACCIONES_QUE_SIGUEN_LA_CONVERSACION` sin evidencia de que también
  falle.

## Cómo revertir

```bash
git revert <commit>
```

Sin esquema, sin datos, sin estado. Revertir deja `provide_requirement`/
`update_lead` sin esta garantía — el prompt seguiría pidiendo `reply`, sin
verificación de código detrás, como antes de hoy.
