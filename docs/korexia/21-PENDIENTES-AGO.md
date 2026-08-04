# Pendientes (continuación, agosto 2026)

> **Dentro:** Desplegado y verificado (3-ago-2026) · Por verificar en producción · Citas: huecos conocidos

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

## Citas: huecos conocidos

- **Inconsistencia menor del modelo**: antes de la hora de apertura del
  negocio, a veces responde "no hay disponibilidad hoy" en vez de dar el
  primer horario del día. No lo pidió corregir el dueño todavía; documentado
  para no perderlo de vista.
- **Fechas en lenguaje natural ambiguo** ("el miércoles", "mañana en la
  tarde") a veces le hacen decir al modelo que no hay disponibilidad cuando
  sí la hay; con una fecha explícita (`2026-08-07 a las 15:00`) siempre
  acierta. Detectado el 3-ago-2026 corriendo `pnpm probar:citas` contra
  producción — el motor de disponibilidad calcula bien (ofrece alternativas
  reales cuando de verdad no hay cupo), es la interpretación de fecha
  relativa del modelo la que varía.
- **Onboarding de un cliente real** de peluquería/estética: hoy solo existe
  una organización de prueba para el vertical de citas.
