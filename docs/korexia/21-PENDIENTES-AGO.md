# Pendientes (continuación, agosto 2026)

> **Dentro:** Desplegado y verificado (3-ago-2026) · Por verificar en
> producción · Decisiones pendientes de la sesión del 4-6 de agosto · Citas:
> huecos conocidos

Sigue a [08-PENDIENTES.md](08-PENDIENTES.md) — se abrió aparte solo porque
aquel ya estaba en el límite de 200 líneas.

---

## ✅ Desplegado y verificado (3-ago-2026)

Las tres tandas de commits que quedaron pendientes en distintos momentos de
esta semana **ya están confirmadas en producción**, con evidencia real (grep
dentro del contenedor que corre + consultas directas a la base de datos, no
solo "converged" ni un 200):

1. **Nombres de usuario de WhatsApp (BSUID)** — contacto sin teléfono +
   respuesta por `wa_user_id`. Columna `wa_user_id` confirmada en la tabla
   `contact` real. Detalle en [07-BITACORA.md](07-BITACORA.md) y
   [03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md).
2. **Vertical de citas**: "confirmó sin agendar", Laboratorio restringido y
   recordatorio manual. Re-verificado con `pnpm probar:citas` corrido
   **directamente en el contenedor real** contra
   `org_novxv78s08h12arzatr2`: ciclo agendar → reprogramar → cancelar
   completo, sin duplicar ni confirmar en falso. Detalle en
   [19-CITAS.md](19-CITAS.md).
3. **Auditoría de seguridad/refactor/código** del 3-ago —
   [22-AUDITORIA-3AGO.md](22-AUDITORIA-3AGO.md).

## ✅ BSUID con un contacto real — verificado, y encontró un bug más (3-ago noche)

La verificación pendiente llegó sola: Nathalia (clienta nueva de Lis con
nombre de usuario de WhatsApp activado) escribió, y **ni el agente ni una
respuesta manual desde la bandeja lograron contestarle** — YCloud rechazaba
el envío con `Invalid E.164 phone number`. La entrada SÍ funcionaba (mensaje
guardado bien), el problema estaba en el ENVÍO: el código mandaba el BSUID
por el campo `to` (solo para teléfonos), cuando YCloud exige el campo
`recipient` para un BSUID. Corregido y verificado — detalle completo en
[23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md).

## Revisión de arquitectura (3-ago noche): qué se implementó y qué no

El dueño pidió evaluar 12 recomendaciones externas en 4 fases (tabla de
eventos crudos, cola con `pg-boss`, debounce persistente, Row-Level Security,
rate-limit por organización, contabilidad de costo por organización, más
varias de menor alcance). Se implementó la Fase 0 completa (tabla
`webhook_event`, quitar `after()`) por ser de alto valor y bajo costo. El
resto se **decidió NO implementar por ahora**, con justificación explícita:
el VPS es de un solo núcleo operado por una persona, y los 4 bugs reales
encontrados esa misma sesión fueron todos de lógica, ninguno de fiabilidad de
infraestructura — meter una cola o RLS ahora sería resolver un problema que
no se ha visto que exista. Revisitar si el negocio crece lo suficiente en
número de clientes o de tráfico. Detalle de la evaluación completa (con el
razonamiento punto por punto) en
[23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md).

Nota aparte para cuando se retome **09-COSTOS.md**: la recomendación de
"contabilidad de costo por organización" coincide con un pendiente que ya
existía antes (panel de costo por cliente) — no es una idea nueva, solo
confirma que sigue siendo válida.

## Decisiones pendientes de la sesión del 4-6 de agosto

Todas salieron de [28-BITACORA-4-6AGO.md](28-BITACORA-4-6AGO.md). Ninguna es
urgente; ninguna bloquea nada.

**A. Backfill de identidad (21 contactos).** El arreglo del 5-ago guarda las
dos señales, pero solo de aquí en adelante: hoy hay **9 contactos con las dos,
79 con solo teléfono y 6 con solo BSUID**. Los eventos ya guardados en
`webhook_event` permiten completar **21** de una vez con un `UPDATE`, en vez
de esperar a que cada cliente vuelva a escribir. Es escritura sobre
producción, por eso no se corrió sola. Los demás se van completando solos.

**B. Adjuntos y fotos** (del upstream, ver
[26-NEA-AGENT.md](26-NEA-AGENT.md) y [25-UPSTREAM-VOCERO.md](25-UPSTREAM-VOCERO.md)).
Guardar los adjuntos en disco propio cierra el **pendiente #23** (los
comprobantes caducan a los 30 días en YCloud) y habilita **mandar fotos de
productos desde la bandeja**, que es lo que pidió el dueño el 1-ago. Es el
trabajo grande: pide volumen persistente en EasyPanel, entra en los respaldos
y hay que reescribir la subida y descarga contra YCloud.

**C. Seguimiento único** (de `nea-agent`). Un empujón a las N horas si el
cliente se queda callado, uno solo por conversación, respetando la ventana de
24 h y la IA en pausa. korex.ia no tiene nada parecido. El dueño lo dejó fuera
de esta tanda; queda decidir a qué clientes se les activaría.

**D. Detector determinista de hostilidad** (de `nea-agent`). El planteamiento
es correcto —contar entre turnos es lo que un LLM hace mal— pero su léxico es
100 % mexicano: para Colombia hay que rehacerlo. **Sin caso real que lo pida
todavía.**

**E. Límite residual de la carrera.** Con la marca de procesados
(`last_turn_inbound_at`) el mensaje que se cuela ya no se pierde. Si algún día
aparece un caso donde el modelo responda de forma redundante al mensaje
reordenado, la vuelta de tuerca sería avisarle en el propio contexto de que
esa parte ya la contestó.

## Citas: huecos conocidos

- **Inconsistencia menor del modelo**: antes de la hora de apertura del
  negocio, a veces responde "no hay disponibilidad hoy" en vez de dar el
  primer horario del día. No lo pidió corregir el dueño todavía; documentado
  para no perderlo de vista.
- ✅ **"Fechas en lenguaje natural ambiguo": NO era el modelo, era un bug.**
  Estaba anotado aquí como una inconsistencia suya. El **7-ago-2026**,
  probando el vertical antes de su primer cliente real, salió la causa:
  `normalizarFecha` solo aceptaba `DD/MM/AAAA`, y **el modelo manda ISO a
  menudo** (`2026-08-10`). La fecha se usaba sin normalizar y `esFechaValida`
  la leía como día "2026" → el agente le dijo a la clienta **"el lunes 10 de
  agosto ya pasó"** un viernes 7. Corregido: se aceptan los dos formatos.
  Dos pruebas del repo **codificaban el bug** (esperaban que el ISO se
  rechazara y que la fecha llegara sin normalizar); se corrigieron también.
- **Onboarding de un cliente real** de peluquería/estética: hoy solo existe
  una organización de prueba para el vertical de citas.
