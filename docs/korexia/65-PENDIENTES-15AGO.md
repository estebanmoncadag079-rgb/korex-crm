# Pendientes al 15 de agosto

> **Dentro:** Lo urgente · Lo que bloquea al salón · La deuda que volverá a
> morder · El roadmap · Lo cerrado en esta sesión

**Este es el documento que hay que leer al retomar.** Sustituye a
[57-PENDIENTES-14AGO.md](57-PENDIENTES-14AGO.md) (que se conserva por su relato
del salón) y a [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md) en lo que
se solape.

---

## 🔴 Lo urgente, por orden

### 1. La contraseña del superadmin

Abierta **desde el 31-jul**. Quien la tenga entra como cualquier cliente, lee y
escribe todas sus conversaciones, borra un cliente entero y gestiona las
credenciales de WhatsApp de cada negocio. No hay segundo factor.

Es **el pendiente más barato de cerrar y el de peor consecuencia**. Lleva dos
semanas siendo el primero de la lista.

### 2. El prompt se puede sobrescribir solo (deuda nueva, ya mordió)

**El 15-ago a las 12:59 UTC el prompt de La Churra perdió todas sus reglas de
flujo** sin que nadie lo tocara: de 18.053 a 11.889 caracteres. Se restauraron a
mano, pero **el camino sigue abierto**.

La causa: `scripts/fichas-de-clientes.ts` y el cuestionario del cliente escriben
**los dos** `agent_profile.ficha`, y el último gana en silencio. Es el mismo
patrón que [61-UNA-SOLA-PUERTA.md](61-UNA-SOLA-PUERTA.md) cerró para el
conocimiento.

Mientras no se cierre, **cualquier ajuste de prompt puede desaparecer** y el
síntoma será *"el bot dejó de hacer caso"* — que es exactamente lo que costó
media sesión diagnosticar.

---

## Lo que bloquea al salón (Lashes Valen)

Su agente **sigue apagado a propósito**. Lo que falta antes de encenderlo:

1. **Completar su conocimiento**: tiene **una sola entrada**. Le faltan dirección,
   parqueadero, política de cancelación y retardos — lo que más pregunta una
   clienta nueva. Se carga en la pantalla de Conocimiento, que ya no se pisa.
2. **Terminar el cuestionario sin erratas en el saludo** (*"consertirte"*,
   *"queires"*): ese texto sale tal cual a cada clienta.
3. Borrar las conversaciones y citas de prueba antes del día 1.

✅ Ya resuelto: horario (9:30–18:30, confirmado en la base), catálogo (46
servicios, 5 especialistas, 126 asignaciones), datos de pago, acceso de la dueña
y la entrada de salud que deriva a una persona.

---

## La deuda que volverá a morder

| Deuda | Por qué importa |
|---|---|
| **El banco de escenarios solo sirve para Lis** | Da 14 falsos negativos contra La Churra (*"Lis NO acepta efectivo"*). Si La Churra es el laboratorio de las fases siguientes, **necesita su propio banco** |
| **No hay pantalla para el catálogo** | La Fase 1 se opera por línea de comandos. Un cliente no puede cambiar su propio precio, que es medio sentido de haberlo sacado del prompt |
| **Los precios del saludo siguen escritos a mano** | El primer mensaje de La Churra enumera las cuatro presentaciones con sus precios, como texto libre en su ficha. Ningún regenerado lo toca, así que un precio vive en dos sitios: la fila de `product` y ese saludo. **La mejora**: que el saludo se arme con el catálogo en vez de repetirlo, para que todo precio viva en una sola fila. Ver [63](63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md) |
| **Las cuentas nacen todas como Propietario** | La interfaz manda `role: "owner"` fijo aunque el servidor acepte `member` |
| **Sin RLS** | El aislamiento depende de `scoped()` en cada consulta. Las tablas nuevas ya están preparadas, pero la política no existe |
| **Lis fuera del generador** | Su prompt es manual: no hereda ninguna lección de `conducta.ts` |

---

## El roadmap

Objetivo, y conviene releerlo antes de cada fase: **que el conocimiento
estructurado viva en el backend y el prompt lleve solo comportamiento**, para
sostener muchos clientes sin un prompt gigante por cada uno. **No es reducir
mensajes.**

| Fase | Estado |
|---|---|
| 0 — Medir | ✅ Hecha. Descartó el cambio de modelo y bajó la urgencia del refactor |
| 1 — Catálogo a tablas | ✅ **En producción en La Churra**, verificado dentro del contenedor el 15-ago a las 13:52 UTC. Falta pantalla |
| 2 — Estado estructurado | 🟡 **Condición de entrada cumplida** (15-ago): la extracción falla **0 % sobre 160 turnos reales**, con la regla de que ningún campo del modelo lleve valores cerrados. Quedan la #3 y la #4, y falta el neto del coste |
| 3 — Motor de capacidades | ⏸️ Diferida: con 2 verticales no paga |

**La Churra es el laboratorio** de cada fase, en condiciones reales. **Lis la
última**, y solo con la fase ya validada y rollback inmediato.

Detalle, objeciones y diseño de datos en
[62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md](62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md).

---

## Lo que se cerró el 14-15 de agosto

- ✅ Acceso de la dueña del salón (su cuenta **nunca se había creado**)
- ✅ **Eliminar cuentas** desde `/admin`, que no existía
- ✅ El cuestionario **ya no borra** el conocimiento, ni los teléfonos de aviso
- ✅ La pantalla del agente dejó de ofrecer campos que se regeneran solos
- ✅ El aviso de negocio cerrado **se afirma, no se pregunta** (toda la flota)
- ✅ Flujo de 5 mensajes de La Churra, con sus tres causas reales encontradas
- ✅ Fase 0 medida y Fase 1 en producción

Relato completo en [64-BITACORA-14-15AGO.md](64-BITACORA-14-15AGO.md).
