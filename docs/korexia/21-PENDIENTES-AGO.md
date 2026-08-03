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

## Por verificar en producción

- **BSUID con un contacto real**: no se puede probar por el Laboratorio (nunca
  toca WhatsApp real) ni hay forma segura de simular un contacto con nombre
  de usuario activado. La verificación definitiva es la próxima vez que
  escriba un cliente así — revisar que el mensaje entra en la bandeja y que
  se le puede responder desde ahí.

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
