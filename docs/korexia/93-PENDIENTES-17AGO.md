# Pendientes al 17 de agosto de 2026

> 🔴 **LÉEME AL RETOMAR.** Sustituye a [70](70-PENDIENTES-16AGO.md) en todo lo
> que se solape. Para el relato de la jornada, [92](92-BITACORA-17AGO.md).

**Estado del sistema ahora mismo:** cuatro clientes, las cuatro banderas
`state_source` en `'prompt'`, `conversation_state` **vacía**, **12 commits sin
subir** y **nada desplegado**. Los agentes siguen exactamente como estaban: el
prompt no se ha regenerado.

---

## Lo primero, y no es del proyecto

🔴 **Cambiar la contraseña del superadministrador.** Sigue pendiente desde el
16-ago y sigue siendo lo más urgente de todo lo escrito aquí.

---

## Para encender La Churra

> ✅ **18-ago: los puntos 1, 2 y 3 ya están aplicados en producción**, más un
> cuarto que no estaba anotado aquí (la repetición también en ADICIONES).
> Detalle completo, con lo que no coincidió con este documento al verificarlo
> contra la base real, en
> [95-BITACORA-PASO1-ENCENDIDO-CHURRA.md](95-BITACORA-PASO1-ENCENDIDO-CHURRA.md).

En orden. El plan original, con los datos reales, sigue en
[91](91-CATALOGO-DE-LA-CHURRA.md) — aunque el punto 2 se ejecutó distinto de
como estaba escrito ahí (ver el 95: la ficha ya había cambiado de formato).

| # | Qué | ¿Escribe? | Estado |
|---|---|---|---|
| 1 | `pnpm repeticion <org> SALSA --si --aplicar` — cuatro grupos admiten repetir | **producción** | ✅ 18-ago |
| 2 | Corregir `CHOCOLATE` → `CHOCOLATE NEGRO` en la ficha y añadir `RECUBIERTO (elige 1)` + `ADICIONES` a `variantes` | **producción** | ✅ 18-ago (`corregir-ficha-churra.ts`) |
| 3 | `pnpm cargar:opciones <org> --aplicar` — carga `RECUBIERTO` y `ADICIONES` | **producción** | ✅ 18-ago (40 filas) |
| 3.5 | *(no anotado antes)* `pnpm repeticion <org> ADICIONES --si --aplicar` — reglasPropias ya decía que sí se repiten | **producción** | ✅ 18-ago |
| 4 | `pnpm regenerar:flota` — ⚠️ **aquí es cuando los clientes notan el trabajo del 17/18-ago** | **producción** | ⬜ decisión de Esteban |
| 5 | La medición de la regla 13, **una sola vez**, contra la línea base del 15-ago | lectura + modelo | ⬜ saltada a propósito el 18-ago: exige regenerar el prompt |
| 6 | Banco de escenarios de pedidos con el catálogo real de La Churra, con un caso de dos productos (regla 10) | local | ✅ 18-ago (53 comprobaciones, `probar-estado.ts`) |
| 7 | Encender la bandera en un cliente efímero y recorrer un pedido entero | efímero | ✅ 18-ago, dentro del mismo banco |
| 8 | La revisión a ojo del dueño | — | ⬜ solo la puede cerrar Esteban |
| 9 | Los 8 criterios de [69](69-FASE-2-ESTADO-ESTRUCTURADO.md) | — | 🟠 6 de 8 verificables ya revisados; latencia y rollback contra el cliente real quedan pendientes de los puntos 4 y 5 |

> **El paso 1 ya no obliga a usar el script.** Desde el 17-ago la repetición se
> cambia en el CRM (Catálogo → Grupos de opciones). El script sigue siendo lo más
> corto para los **cuatro** grupos SALSA de una vez
> ([94](94-BITACORA-PERMITE-REPETICION-CRM.md)).

> **El paso 4 no necesita despliegue.** El prompt se genera en local y se guarda
> en la base; producción lee lo guardado. Y trae **dos cambios a la vez**: los
> nombres corregidos y la conducta en plural ([90](90-LA-CONDUCTA-EN-PLURAL.md)).

---

## Después, el vertical de citas

**Paso 4 de [88](88-AUDITORIA-SELECCION-MULTIPLE.md)**, y es el más caro del
proyecto:

- **4a** — generalizar la disponibilidad a `recursoIds`, **sin tocar tablas**
- **4b** — `recurso` + `reserva_recurso`, con la restricción de solape movida en
  **una sola transacción**. La primera migración con datos vivos: 4 citas, 5
  profesionales, 46 servicios
- **4c** — horario por recurso

⚠️ **Antes de 4b, un respaldo del salón hecho a mano y probado restaurándolo.** No
el de las 6 horas.

Y hay una **promesa ya escrita en el prompt que el backend todavía no cumple**:
la conducta dice que varios servicios son una sola visita, pero `appointment`
tiene un solo `service_id`. Hasta el paso 4, el agente puede prometer algo que no
se puede agendar de una vez.

---

## Deuda viva

| | Qué | Desde |
|---|---|---|
| 🟠 | **`tsconfig` excluye `scripts/`** — los programas que escriben en producción no se comprueban. Uno llevaba dos días sin compilar | 17-ago |
| 🟠 | **El paso 3B, a medias**: la casilla de la repetición **ya está en el CRM** (Catálogo → Grupos de opciones, [94](94-BITACORA-PERMITE-REPETICION-CRM.md)); falta el resto del catálogo —mínimos, máximos, opciones— y los grupos de `service`. `pnpm repeticion` se conserva **solo para el cambio en lote** | 17-ago |
| 🟠 | **No existe la entidad Pedido** — decidido dejarlo así, pero queda anotado: sin ella no hay historial ni «cuánto vendió este mes» | 17-ago |
| 🟠 | `leerAporte()` sigue sin usarse: conectarla o borrarla | 15-ago |
| 🟠 | `medir-extraccion.ts` sigue en el contrato viejo — se rehará con la medición de la regla 13 | 16-ago |
| 🟢 | El `"0"` de reinicio sigue efectivamente fijo en el código | 15-ago |

---

## Lo que NO hay que volver a hacer

- **No guardar lo que devuelve `leerFichaAplanada`.** La puerta es
  `serializarComoEstaba` ([84](84-EL-MODELO-DE-LA-FICHA.md)).
- **No deducir reglas de negocio del vocabulario.** Se quitó de tres sitios el
  17-ago; si vuelve, las pruebas del taller y la papelería se ponen rojas.
- **No dar por buena una prueba sin su caso negativo.** Dos guardarraíles
  estuvieron verdes sin detectar nada.
- **No confiar en la documentación por encima de la base.** Un documento describía
  el contrato de la disponibilidad al revés y una prueba pasó por la razón
  equivocada.

---

## Comandos útiles

```bash
# El túnel a la base (sin él, ningún script funciona)
ssh -i ~/.ssh/churrabot_key -f -N -L 15433:172.16.1.1:5433 root@2.25.159.117

pnpm probar:estado          # 45 comprobaciones, dos clientes efímeros
pnpm repeticion <org>       # ver los grupos y su regla de repetición
                            # (CAMBIARLA ya se hace en el CRM: Catálogo →
                            #  Grupos de opciones. El script queda para el lote)
pnpm cargar:opciones <org>  # simula la carga de grupos que faltan
pnpm regenerar:flota        # ⚠️ cambia el prompt de TODOS los clientes
```

Y el gate, antes de cualquier commit:

```bash
pnpm test && pnpm typecheck && pnpm lint
```
