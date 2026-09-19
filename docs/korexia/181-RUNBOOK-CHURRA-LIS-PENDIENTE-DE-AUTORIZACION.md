# 181 · Runbook: las tres escrituras que faltan en producción

**19-sep-2026** · Fases 2, 5 y 6 del plan "Backend como autoridad — La Churra + Lis".

> 🔴 **Nada de esto se ha ejecutado.** Las tres son escrituras en producción y
> esperan autorización explícita. Este documento existe para que ejecutarlas
> sea leer y copiar, no improvisar.

Ninguna necesita código nuevo: los tres mecanismos ya existían en el repo. Eso
era parte de lo que había que verificar, y se verificó.

| | Organización | id real |
|---|---|---|
| | La Churra | `org_lo5gdlt6k43z9fg1ling` |
| | Lis Pastelería | `org_lispasteleria0001` |

---

## Fase 2 · Lis entra al motor

**Qué cambia:** `agent_profile.state_source` de `'prompt'` a `'backend'` para
Lis. Es la migración principal del plan.

**Por qué basta con eso:** todo el motor de Feature 003 está detrás de un solo
interruptor — `const estadoEstructurado = profile.stateSource === "backend"`
(`pipeline.ts:1112`). Con la bandera en `backend`, Lis pasa por
`Operacion[]`, normalización, las tres compuertas, atomicidad, Policy y
`conversation_state`, exactamente por el mismo camino genérico que La Churra.
No hay código de Lis en ninguna parte.

Sus precondiciones ya se cumplen, verificadas contra producción:
`catalog_source='tabla'`, 15 productos vivos en tablas, y ficha con
requisitos.

```bash
# 1. Mirar sin escribir (el script lo soporta)
pnpm fase2 org_lispasteleria0001

# 2. Aplicar
pnpm fase2 org_lispasteleria0001 --encender
```

**Rollback:** `pnpm fase2 org_lispasteleria0001 --apagar`. Es un UPDATE, no un
despliegue, y tiene efecto en el turno siguiente (regla 8 de la Fase 2).

**Qué vigilar después:** los primeros pedidos reales de Lis. El motor ya lleva
meses en La Churra, pero Lis es otro negocio con otro catálogo.

---

## Fase 5 · Los medios de pago de La Churra, estructurados

**Qué cambia:** `payment_source` de `'prompt'` a `'ficha'`, moviendo las formas
de pago del texto del prompt a la ficha.

**Por qué importa:** con `payment_source='prompt'` los medios de pago viven
como prosa dentro de `instructions`, así que el modelo los **reproduce de
memoria** en vez de leer un dato estructurado. Lis ya está en `'ficha'`; La
Churra no.

```bash
pnpm migrar:pago org_lo5gdlt6k43z9fg1ling
```

⚠️ Antes de ejecutar, confirmar con el negocio que los medios reales siguen
siendo Nequi, Bancolombia, Llave y efectivo. El script mueve lo que encuentra
en `instructions`: si ahí hay algo desactualizado, se estructuraría un dato
viejo.

**Rollback:** el propio script vuelve a `payment_source='prompt'`
(`migrar-pago.ts:88`).

---

## Fase 6 · La dirección, obligatoria cuando hay domicilio

**El defecto, verificado en producción.** El requisito `direccion` de La Churra
y de Lis está a medias — tiene `id` y nada más:

```json
{ "id": "direccion" }
```

Sin `obligatorio: true`, el backend **no lo exige**. Hoy se puede cerrar un
pedido a domicilio sin dirección en los dos negocios.

**Qué debe quedar** (en `agent_profile.ficha` → `flujo.cierre.requisitos`, la
entrada de `direccion`, en ambas organizaciones):

```json
{
  "id": "direccion",
  "tipo": "direccion",
  "etiqueta": "la dirección de entrega",
  "obligatorio": true,
  "soloEnModalidades": ["domicilio"]
}
```

**Por qué `soloEnModalidades` y no solo `obligatorio`.** Sin esa condición se
le pediría la dirección también a quien pasa a recoger. Ya ocurrió el
20-ago-2026: el modelo, obligado a rellenar un campo sin valor válido, escribió
`"Recoge en el local"` dentro del campo dirección. El mecanismo existe desde
entonces (`ficha.ts`, `soloEnModalidades`) y `"domicilio"` es el id canónico
(`MODALIDAD_DOMICILIO`).

**Cómo aplicarlo:** editando la ficha desde el CRM
(`PUT /api/admin/clients/[id]/ficha`). No hace falta script nuevo.

**Rollback:** volver a dejar la entrada como estaba. Es un campo de un JSON.

---

## Después de las tres

```bash
pnpm auditar:arquitectura
```

Esperado: La Churra y Lis dejan de aparecer como desalineadas. MALIA seguirá
saliendo 🔴 — es una contención deliberada y está **fuera del alcance** de este
plan (ver doc 180).
