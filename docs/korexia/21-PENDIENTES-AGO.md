# Pendientes (continuación, agosto 2026)

> **Dentro:** Por desplegar · Por verificar en producción · Citas: huecos conocidos

Sigue a [08-PENDIENTES.md](08-PENDIENTES.md) — se abrió aparte solo porque
aquel ya estaba en el límite de 200 líneas.

---

## Por desplegar

Código listo, con `typecheck`/`lint`/pruebas en verde, pero **sin confirmar
que ya llegó a producción** (recordar: el dueño despliega desde EasyPanel,
nunca el asistente):

1. **Nombres de usuario de WhatsApp (BSUID)** — contacto sin teléfono +
   respuesta por `wa_user_id`. Detalle en la entrada más reciente de
   [07-BITACORA.md](07-BITACORA.md) y en
   [03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md). Incluye una
   migración de base de datos (`0011_nervous_doctor_octopus.sql`), aditiva y
   segura (columna nueva + `NOT NULL` que se quita).
2. **Vertical de citas**: el arreglo de "confirmó sin agendar", el
   Laboratorio (restricción a superadmin + reconocimiento de citas) y el
   recordatorio manual — quedaron sincronizados en la carpeta de EasyPanel al
   cierre del 1-ago pero sin confirmar despliegue. Antes de seguir con nada
   de citas, desplegar y correr `pnpm probar:citas` completo (agendar,
   reprogramar, cancelar) para confirmar que el bug de la fecha equivocada no
   reaparece.

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
- **Onboarding de un cliente real** de peluquería/estética: hoy solo existe
  una organización de prueba para el vertical de citas.
