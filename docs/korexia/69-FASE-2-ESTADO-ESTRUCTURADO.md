# Fase 2: el estado del pedido vive en el backend

> **Dentro:** Qué está hecho y qué no · El modelo del estado · El validador · El
> extractor · Cómo se conecta al pipeline · La instrumentación · Las pruebas ·
> Lo que bloquea encender la bandera · Cómo encender y cómo apagar

**Estado al 15-ago-2026: IMPLEMENTADA Y APAGADA.** El código está en producción
desplegado, pero `agent_profile.state_source = 'prompt'` en los cuatro clientes,
así que **no se ejecuta ni una línea de la Fase 2**. El pipeline corre
exactamente como antes.

---

## Qué está hecho y qué no

| Pieza | Estado |
|---|---|
| Tabla `conversation_state` + bandera `state_source` (migración 0022) | ✅ aplicada, vacía |
| Modelo del estado (`orders/estado.ts`) | ✅ |
| Validador (reutiliza `normalizarPedido`) | ✅ |
| Extractor (`orders/extraer.ts`) | ✅ |
| Conexión con el pipeline | ✅ **tras la bandera** |
| Instrumentación del escritor nuevo | ✅ desde el primer commit |
| Pruebas: unitarias + integración contra Postgres real | ✅ |
| **Encendido en un cliente** | 🔴 **bloqueado** (ver abajo) |

---

## El modelo del estado

```jsonc
{
  "schema_version": 1,
  "producto":   { "id": "prod_x", "nombre": "CHURRITA", "cantidad": 1 },
  "salsas":     ["arequipe"],
  "recubierto": "azúcar-canela",
  "adiciones":  ["botella de agua"],
  "entrega":    { "nombre": null, "telefono": null, "direccion": null },
  "totalCents": 1200000,
  "paso":       "eligiendo_opciones",
  "confirmado": false
}
```

**Por qué cada decisión:**

- **`producto.id` además del nombre.** El nombre es lo que dijo el modelo; el id
  es lo que el backend **resolvió** contra `product` de esa organización. El
  nombre se guarda igual, redundante a propósito: si el producto se borra, el
  estado sigue siendo legible al investigar.
- **`totalCents` lo calcula el servidor.** Nunca el número que diga el modelo.
- **`paso` es texto libre, jamás un enum.** El modelo devolvió **más de 70
  etiquetas distintas** en 160 turnos reales; un enum cerrado rechazaba el 82 %.
- **`schema_version` desde el primer día.** El día que cambie la forma habrá
  conversaciones vivas con la vieja. Un estado escrito por una versión más nueva
  **no se usa a medias**: se empieza limpio, que es recuperable.
- **`confirmado` separado de "está completo".** Que no falte nada no significa
  que el cliente haya dicho que sí.

**Reemplazo completo en cada turno**, sin deltas ni merges. Es seguro porque la
cola garantiza un turno por conversación a la vez, y elimina una familia entera
de bugs de fusión.

---

## El validador

No se escribió uno nuevo: **reutiliza `normalizarPedido`** (Fase 1.5), que ya
resuelve productos y opciones contra el catálogo, corrige nombres y recalcula el
total. Encima de eso comprueba lo que aquel no podía saber:

| Impide | Cómo |
|---|---|
| Productos inexistentes | No resuelven contra `product` de **esa** organización |
| Opciones incompatibles | La salsa debe pertenecer al grupo de ese producto |
| Cantidades inválidas | `0`, negativas y decimales |
| **Estados imposibles** | `confirmado` sin producto, sin total o sin datos de entrega |

### La cantidad se valida sobre lo que propuso el modelo

`normalizarPedido` corrige a 1 cualquier cantidad menor —correcto, para no
tumbar una conversación—, y eso hacía **invisible** un `0` o un `-3`. Ahora se
valida el valor **crudo**: una cantidad negativa no es un detalle de formato, es
señal de que la extracción se torció, y hay que enterarse el día que empiece.

---

## El extractor

Recibe la propuesta del modelo y responde tres preguntas comparándola con el
estado guardado:

- **qué información NUEVA aportó** el cliente (campos que pasan de vacío a valor),
- **qué CAMBIA** (cambio de opinión),
- **qué PERMANECE**.

De ahí sale el bloque que se inyecta en el prompt, que **sustituye instrucciones
en vez de añadirlas**: no repite el teléfono, dice *"ya lo dio"*. Si esto crece,
el prompt vuelve a engordar y la Fase 2 habrá servido para nada.

---

## Cómo se conecta al pipeline

Cuatro enganches, **todos dentro de `state_source === 'backend'`**:

1. **Antes de llamar al modelo**: se lee el estado y se inyecta el bloque.
2. **El `"0"` reinicia ANTES del modelo**, igual que el handoff. Decisión
   determinista del servidor: si dependiera del LLM, un turno confuso podría
   arrastrar un pedido que el cliente ya canceló.
3. **La propuesta viaja en la MISMA llamada** que la respuesta. Lo decidió la
   medición: $0,002320 contra $0,002508 por turno, 2.172 ms contra 3.690, y
   **acierta donde la llamada aparte falla** porque conoce las reglas del negocio.
   El esquema es `passthrough` con `estado` **opcional**: cuando el agente deriva
   a una persona no hay pedido que extraer, y exigirlo rechazaba 4 de cada 36
   respuestas justo en las conversaciones más delicadas.
4. **Se valida y persiste FUERA del camino del cliente**: una propuesta inválida
   se registra y se descarta, pero la respuesta ya salió. Un estado que no valida
   no puede convertirse en un turno perdido.

Y dos garantías: el contrato `AgentAction` **no se relaja** —si la acción no
cumple, es salida inválida como siempre—, y **sin catálogo en tablas se cae al
comportamiento de siempre** en vez de inventarse un pedido.

---

## La instrumentación

Un log **por CAMPO** del estado, no uno por escritura:

```
[cambio] tabla=conversation_state registro=cv_x campo=producto.cantidad
  valor_anterior=1 valor_nuevo=6 proceso=runAgentTurn actor=pipeline
  timestamp=2026-08-15T22:52:09.249Z
```

*"El estado cambió"* no dice nada al investigar. *"`producto.cantidad` pasó de 1
a 6"* es la diferencia entre encontrar un cobro de más en un minuto o en una
auditoría forense.

---

## Las pruebas

**21 unitarias** + `pnpm probar:estado` de extremo a extremo contra Postgres
real, sobre un cliente que **se crea y se borra** en la misma corrida (nada de
clientes de prueba permanentes: meten ruido en `/admin` y acaban siendo otro
objeto olvidado):

```
✅ persistencia · productId resuelto · total del servidor
✅ recuperación
✅ corrupción: producto inexistente · salsa incompatible · cantidad 0 · confirmado sin datos
✅ el estado guardado sigue intacto tras los intentos
✅ rollback: el estado se borra · la bandera sigue en 'prompt'
✅ esquema futuro: no se usa a medias
✅ concurrencia: gana uno ENTERO, sin mezclarse
✅ la flota: todas las filas de agent_profile, idénticas
```

La de concurrencia comprueba algo que la cola ya impide: **el día que la cola
falle, el reemplazo completo tiene que dejar un estado coherente, no una mezcla.**

---

## 🔴 Lo que bloquea encender la bandera

| Bloqueo | Detalle |
|---|---|
| **`recubierto` y `adiciones` no están en `product`** | El validador no puede comprobarlos. Simulación lista: 40 INSERT, 0 DELETE (`pnpm cargar:opciones`) |
| **«Ambas» sin resolver** | Ver [70-PENDIENTES-16AGO.md](70-PENDIENTES-16AGO.md) |
| **No hay laboratorio barato** | El salón es de CITAS: el estado de pedido no le aplica. El único cliente de pedidos con catálogo en tablas es **La Churra, que factura** |

Sobre el último: el salón fue el laboratorio de la conversión de fichas **porque
estaba apagado**. Para la Fase 2 no sirve, y eso cambia el orden acordado.

---

## Cómo encender y cómo apagar

```sql
-- encender en un cliente
UPDATE agent_profile SET state_source = 'backend' WHERE organization_id = '…';

-- apagar: vuelve al comportamiento de siempre en el turno siguiente
UPDATE agent_profile SET state_source = 'prompt'  WHERE organization_id = '…';
```

**Sin desplegar.** Y si quedaran estados sucios, borrar las filas de
`conversation_state` de esa organización es opcional: con la bandera apagada no
las lee nadie.

## Criterios para encender en el primer cliente

1. Cero `[NO DECLARADO]` tras el banco de escenarios.
2. Cero estados persistidos que no pasen el validador.
3. El total del servidor coincide con el del resumen en el 100 % de los pedidos.
4. Rollback demostrado sobre ese cliente.
5. Latencia p90 por debajo de 4 s (2 s de margen sobre el corte de YCloud).
6. **Recubierto y adiciones cargados** en el cliente donde se encienda.
7. Comparación de fila completa en verde.
8. **Un pedido completo revisado a ojo por el dueño**, no por el asistente.
