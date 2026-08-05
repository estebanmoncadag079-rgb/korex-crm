# ¿Vale la pena traer la actualización de Vocero CRM? (5-ago-2026)

> **Dentro:** La pregunta · Lo primero: allá NO hay motor de citas · Qué sí
> trae la actualización · El bug latente que destapó esta revisión · Qué
> costaría traerlo · Recomendación · Google Calendar

## La pregunta

El dueño planteó tomar el motor de citas del upstream
(`github.com/kevinrivm/vocero-crm`, el proyecto del que nace korex.ia) para
los clientes de agendamiento, conectándolo después a Google Calendar. Esta es
la revisión de si conviene actualizar o quedarse como estamos.

## Lo primero: allá NO hay motor de citas

**El upstream no tiene nada de citas.** Verificado de dos formas sobre
`upstream/main`:

```bash
git ls-tree -r --name-only upstream/main | grep -iE "appoint|cita|calendar|agenda|booking"   # vacío
git grep -il -E "appointment|agendar|reprogramar|disponibilidad|calendar" upstream/main      # vacío
```

El motor de citas es **exclusivo de korex.ia** (portado de `BOT VALENTINA CON
IA` el 1-ago — ver [19-CITAS.md](19-CITAS.md)): `src/server/appointments/`,
las 4 tablas, el loop `consult_availability` y el panel `/appointments`. No
hay nada que heredar ahí, ni tampoco integración con Google Calendar.

## Qué sí trae la actualización

17 commits nuevos. Ordenados por lo que valen **para korex.ia**, no por lo
que valen en general:

| Qué | Vale aquí | Por qué |
|---|---|---|
| **`media_asset`**: copia los adjuntos al disco propio (`MEDIA_DIR`) | 🟢 mucho | Resuelve el pendiente **#23**: los comprobantes de pago caducan a los 30 días en YCloud y hoy no queda copia de la imagen |
| **Envío de adjuntos desde la bandeja** (imagen + pie, documento, ubicación) | 🟢 mucho | Es justo lo que pidió el dueño el 1-ago: mandar **fotos de pedidos y productos**. Hoy solo se puede escribir texto |
| **Previews de entrantes** (foto ampliable, nota de voz reproducible) | 🟢 sí | Hoy hay que abrir el adjunto por `/api/media/[id]` |
| **Identidad estable de contacto** (`wa_identity`) | 🟠 sí, y urge | Ver la sección siguiente — destapó un bug latente propio |
| **`origin` del mensaje** (`ai`/`operator`/`manual`/`template`) | 🟡 poco | korex.ia ya distingue el relevo con `handoff_reason='operador'` |
| Echoes de coexistence | ⚪ no | Ya funciona aquí desde julio |
| `/api/bot/*` para conectar un cerebro externo | ⚪ no | korex.ia **es** el cerebro |
| Fix de `OAuthException` transitorio | ⚪ no | Es del canal Meta directo; aquí se sale por YCloud |
| Reconciliación de prefijo `521→52` | ⚪ no | Es de México; Colombia (57) no tiene ese problema |

## El bug latente que destapó esta revisión

Comparando la identidad de contacto salió un problema **propio**, no del
upstream. En `src/server/inbox/ycloud-webhook.ts`:

```ts
waUserId: m.from ? null : (m.fromUserId ?? null),   // ← tira el BSUID si llega el teléfono
```

…apoyado en un comentario que afirma *"nunca vienen los dos juntos"*.
**Es falso.** Medido sobre los eventos reales de `webhook_event`:

```sql
select count(*) filter (where p ? 'from' and p ? 'fromUserId') as trae_los_dos,
       count(*) filter (where p ? 'fromUserId' and not p ? 'from') as solo_bsuid
from (select payload->'whatsappInboundMessage' as p from webhook_event
      where payload->>'type' = 'whatsapp.inbound_message.received') t;
-- trae_los_dos = 98 | solo_bsuid = 1 | solo_telefono = 0
```

**98 de 99 traen los dos.** Lo que hoy se guarda es solo el teléfono, y el
BSUID se descarta. El día que Meta deje de mandar `from` para alguien que ya
escribía —la dirección declarada de su migración, y el motivo por el que el
upstream hizo `wa_identity`— ese cliente entrará como **contacto y
conversación nuevos**: historial partido, el agente lo saluda como
desconocido y el embudo lo duplica.

El espejo del mismo problema ya está sembrado: **Nathalia** y **Marii.💕**
están guardadas **solo** por BSUID, sin teléfono. Si vuelven con un evento
que traiga `from`, se duplican.

**Todavía no ha pasado** — verificado, no hay contactos duplicados hoy. Es
riesgo, no incidente.

## Qué costaría traerlo

Un `git merge upstream/main` **está descartado**, con evidencia:

- **102 commits propios contra 17 suyos**, base común del **10-jul-2026**.
  korex.ia ya es otro producto: multi-cliente, YCloud, citas, aprendizaje,
  cotizador, Laboratorio.
- La simulación del merge (`git merge-tree`, no toca nada) da **17 archivos
  en conflicto**, entre ellos los más sensibles: `schema.ts`, `ingest.ts`,
  `send.ts`, `webhook.ts` — y **las migraciones de Drizzle**
  (`_journal.json`, los dos snapshots), que es exactamente lo que provocó el
  ciclo de reinicios de 15 minutos del 3-ago
  ([23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md)).
- El upstream habla **Meta Graph directo**; korex.ia habla **YCloud**.
  `downloadGraphMedia`/`uploadGraphMedia` hay que reescribirlos. La mitad ya
  existe aquí: `/api/media/[id]` ya sabe descargar de YCloud con lista blanca
  de dominios.
- Guardar archivos en disco pide **volumen persistente** en EasyPanel y entra
  en los respaldos, que hoy solo cubren la base de datos
  ([06-RESPALDOS.md](06-RESPALDOS.md)). Pesa de verdad: son binarios.

La vía sensata es **portar a mano lo que sirve**, leyendo su implementación
como referencia. No adoptar el upstream como fuente.

## Recomendación

1. ✅ **Identidad estable de contacto** — **hecho el 5-ago-2026** (ver abajo).
2. **Persistencia de adjuntos + envío de fotos desde la bandeja** — resuelve
   el pendiente #23 y lo que el dueño quería para Lis. Es el trabajo grande
   (volumen, respaldos, subida por YCloud). **Pendiente de decidir.**
3. **Lo demás: no.** Ni el merge, ni el bot-api, ni los fixes de Meta directo.

### Lo que se hizo (5-ago-2026)

Sin copiar el `wa_identity` del upstream: el esquema de korex.ia ya tenía las
dos columnas y sus dos índices únicos, así que solo cambió la lógica.

- `parseYcloudInbound` y `parseYcloudEcho` conservan **las dos** señales
  (antes: `m.from ? null : m.fromUserId`, que tiraba el BSUID).
- `getOrCreateContact` busca por **cualquiera** de las dos (`or`, del contacto
  más antiguo al más nuevo) y **rellena la que falte** sobre el que ya existe,
  sin pisar nunca una señal ya guardada. Es lo que impide el duplicado.
- Si aparecen **dos** contactos para la misma persona (duplicados de antes de
  este arreglo), usa el más antiguo —el del historial— y deja un
  `[contacto] MISMA PERSONA EN DOS CONTACTOS` en el registro. **No fusiona
  solo**: mover mensajes, conversaciones, leads y citas sin que nadie mire es
  peor que el problema.
- Tests: `ingest-wa-username.test.ts` reescrito (8 casos, incluidos los dos
  rellenos y la colisión) y `ycloud-username.test.ts` corregido — **tenía un
  caso que afirmaba "nunca vienen juntos" y verificaba el bug**. Suite
  completa en verde: 370 pruebas, `typecheck`, `lint` y `build`.

**Sin migración**: las columnas `phone`/`wa_user_id` y sus índices únicos ya
existían.

✅ **Desplegado el 5-ago-2026 y verificado con datos reales**: de los contactos
tocados tras el despliegue, **4 quedaron con las DOS señales (teléfono +
BSUID) y ninguno con solo teléfono** — antes se guardaba solo el teléfono en
el 100 % de los casos. El duplicado latente está cerrado.

**Backfill pendiente de decidir**: los eventos ya guardados en `webhook_event`
(desde el 3-ago) permiten completar el BSUID de **17 contactos** de una vez,
sin esperar a que vuelvan a escribir. Es un `UPDATE` sobre producción, así que
no se corrió solo.

## Google Calendar

No existe en el upstream: es trabajo nuevo en cualquier escenario. Encaja
**como capa aparte**, no como reemplazo del motor: la disponibilidad la
seguiría calculando el servidor (`logic.ts`) y Calendar sería un espejo
bidireccional de la tabla `appointment`. Lo que hay que resolver es OAuth por
cliente (cada peluquería conecta su propia cuenta) y qué manda cuando las dos
agendas se contradicen. **Evaluarlo cuando haya un cliente de citas real** —
hoy solo existe la organización de prueba.
