# Reglas obligatorias de la Fase 2

> **Dentro:** Las catorce reglas · La instrucción para la IA · Por qué son reglas
> y no consejos

**Dictadas por el dueño el 15-ago-2026.** No son recomendaciones ni buenas
prácticas: son **restricciones de diseño**. Un cambio que incumpla una de ellas
no entra, aunque funcione y aunque mejore algo.

Existen porque la conversación que dio origen a este plan se desvió **cuatro
veces en una noche** —de *"el bot no respeta el orden"* a *"cambiemos de
modelo"*, a *"rediseñemos la arquitectura"*, a medir mensajes cuando el objetivo
era la escalabilidad—, y cada desvío era razonable por separado. Escritas, el
desvío se ve venir.

---

## 1. No perder nunca el objetivo original

El objetivo **no es**: reducir mensajes · cambiar el modelo · hacer el flujo más
corto · reescribir la conversación.

> El conocimiento estructurado debe vivir en el backend. El prompt debe ocuparse
> únicamente del comportamiento conversacional.

Toda decisión debe justificarse con ese criterio.

## 2. El LLM nunca es dueño del estado

> El modelo propone cambios. El backend valida. La fuente de verdad es el
> servidor.

El modelo nunca puede: calcular el total · persistir un pedido · crear productos
· resolver identificadores · escribir directamente en la base de datos.

## 3. Prohibido utilizar contratos rígidos

Contrato tolerante: **0 % de errores**. Contrato estricto: **81,9 %**
([62](62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md), medición 4).

> Ningún campo generado por el modelo puede provocar un rechazo duro.

El backend debe **normalizar, interpretar y corregir**. Nunca rechazar una
conversación porque una etiqueta no coincide exactamente.

## 4. Prohibido utilizar `enum` cerrados para el estado conversacional

No hacer esto con una lista cerrada:

```json
{ "paso": "inicio" }
```

El modelo ya demostró que genera estados nuevos de forma natural —más de 70
etiquetas distintas en 160 turnos—. El backend debe permitir **estados
abiertos**.

## 5. Añadir validación semántica

La validación sintáctica no basta. El caso real:

```text
"Quiero 6 churros"  →  { "cantidad": 6 }
```

cuando debía ser `{ "producto": "Churrita", "cantidad": 1 }`. El JSON era
válido, el producto existía, y el error **pasó todas las validaciones**.

## 6. El backend debe poder reconstruir el pedido completo

> Ningún estado se guarda hasta que el backend pueda reconstruir el pedido
> completo utilizando únicamente los datos estructurados.

Si el servidor no puede reconstruirlo, el estado no se persiste.

## 7. Mantener el reemplazo completo del estado

`conversation_state` → JSONB → **reemplazo completo**. No implementar parches,
deltas ni fusiones parciales. Es seguro porque la cola garantiza un solo turno
por conversación a la vez ([34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md)).

## 8. Mantener la bandera por cliente

Cada cambio debe poder activarse por cliente, y el rollback debe seguir siendo
un `UPDATE` de la bandera. **Nunca exigir un despliegue para volver atrás.**

## 9. Mantener el orden de despliegue

Salón de belleza → La Churra → **Lis, siempre la última**.

## 10. Añadir métricas antes de persistir estados

Estados inválidos · estados corregidos · pedidos abandonados · turnos por pedido
· coste por conversación · tiempo de extracción.

Sin métricas, la Fase 2 volverá a depender de intuiciones.

## 11. Mantener la revisión humana durante el piloto

`LLM → extracción → estado generado → registro → revisión humana`. **No eliminar
el registro de auditoría** mientras la arquitectura esté en pruebas.

## 12. No tocar el flujo conversacional

Saludar → mostrar opciones → pedir datos → resumir → cobrar. Ya existe.

> La Fase 2 solo cambia **dónde vive el estado**. No cambia **cómo conversa** el
> agente.

## 13. La siguiente medición es obligatoria

Antes de continuar, medir dos estrategias:

| | Qué es |
|---|---|
| **A** | Respuesta del agente → llamada independiente para extraer el estado |
| **B** | Una sola llamada → respuesta + estado estructurado |

Comparar **coste, latencia y precisión**. No decidir antes de medir.

> ✅ **Ejecutada el 15-ago sobre 20 turnos reales de La Churra**: gana **B**
> ($0,002320 contra $0,002508 por turno, 2.172 ms contra 3.690 ms, 0 JSON
> inválidos las dos, 0 acciones rotas). Y el motivo de peso no es el coste: en
> los turnos donde discrepan, **B acierta y A no**, porque A extrae con un
> prompt que no conoce las reglas del negocio — no sabe que en La Churra el
> `"0"` reinicia el pedido. Detalle en
> [62](62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md).

## 14. La pregunta que debe responder cada cambio

Antes de aprobar cualquier commit:

> ¿Este cambio reduce la dependencia del prompt de 18.000 caracteres?

Si la respuesta es **no**, el cambio no pertenece a este proyecto.

---

## La instrucción para la IA

> No propongas rediseños.
> No optimices prematuramente.
> No cambies la arquitectura existente.
> Implementa únicamente la mínima cantidad de código necesaria para completar la
> siguiente fase.
