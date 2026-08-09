# Pendientes (continuación, agosto 2026)

> **Dentro:** Desplegado y verificado (3-ago-2026) · Por verificar en
> producción · **Para el día 1 del salón de belleza** · Decisiones pendientes
> de la sesión del 4-6 de agosto · Citas: huecos conocidos

Sigue a [08-PENDIENTES.md](08-PENDIENTES.md) — se abrió aparte solo porque
aquel ya estaba en el límite de 200 líneas.

> ➡️ **Continúa en [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md)
> (9-ago-2026)**, que además **ordena todo lo pendiente por riesgo e impacto
> real**. Si solo vas a leer un archivo de pendientes, lee ese.

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

## 🔴 Para el día 1 del salón de belleza (primer cliente de citas)

Por orden. Lo del código ya está hecho y desplegado (ver
[31-BITACORA-7AGO.md](31-BITACORA-7AGO.md)); esto es lo que depende de datos y
de terceros.

**1. Cambiar la contraseña del superadmin.** Sigue pendiente desde el 31-jul y
ahora entra un tercer negocio con datos de sus clientas. Es el punto 1 de
[08-PENDIENTES.md](08-PENDIENTES.md).

**2. Crear su organización y copiarle el catálogo.** El SQL está en
`scripts/salon-catalogo.sql` (46 servicios, 5 especialistas, asignación por
categoría); solo hay que cambiar el `organizationId`. Hoy vive en la
organización de pruebas `org_novxv78s08h12arzatr2`, con citas de prueba dentro
que conviene borrar.

> ✅ **8-ago: llegó el catálogo OFICIAL** (PDF de la dueña) y el script se
> rehízo contra él —
> [32-CATALOGO-SALON.md](32-CATALOGO-SALON.md). **Los 12 retoques que estaban
> cargados tenían el precio equivocado**: el agente habría cotizado un retoque
> de Volumen 3D en 20.000 cuando vale 80.000. Ahora son 17 (cada retoque tiene
> dos precios, 10-15 días y 20 días) y hay categoría propia de Cejas y Lifting.
> **Falta aplicarlo a la base de datos de la organización de pruebas.**

**3. Confirmar su HORARIO real y las DURACIONES.** Se usó 09:00–19:00 de lunes
a sábado, que era el de la demo. Si abren distinto, todo lo demás sale mal:
disponibilidad, calendario y lo que el agente le dice a la clienta. **El
catálogo oficial no trae ni una sola duración** — las del script son
estimaciones, y con ellas el agente vende huecos que quizá no existen. Se
pregunta junto con el horario.

**4. Cargarle el conocimiento (KB).** ⚠️ **No es opcional.** Con el `kb_entry`
vacío, el agente **inventó una dirección** durante las pruebas ("Calle 123
#45-67"). Hace falta: dirección, cómo llegar, parqueadero, formas de pago,
política de cancelación y de retrasos, y qué pasa si la clienta llega tarde.
Más las **tres reglas del catálogo oficial**, que no son servicios y el agente
tampoco puede adivinar: el retoque solo aplica si conserva el **60 % de las
extensiones**, pasados **30 días es montura nueva** (otro precio), e
**Hidralips es mínimo 3 sesiones** ([32-CATALOGO-SALON.md](32-CATALOGO-SALON.md)).

**5. Conectar su número** con su propia cuenta de YCloud, y **estar pendientes
de su teléfono** durante el signup para que apruebe compartir el historial:
sale una vez y no se puede volver a pedir ([05-CLIENTES.md](05-CLIENTES.md)).

**6. Crear la plantilla de recordatorios** en su consola de YCloud, con el
texto de [29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md).
Sin ella, recordar una cita agendada con días de antelación **no funciona**, y
los avisos de la cascada tampoco.

**7. Abrir `/appointments` en un teléfono de verdad.** El calendario se diseñó
y se revisó, pero nadie lo ha visto en un móvil: comprobar que la rejilla se
desplace de lado sin arrastrar la página y que los bloques de 15 min se lean.

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
