# 187 — MALIA: el pedido mínimo, y el orden que importa

**21-sep-2026** · Estado: **código listo y probado, datos SIN aplicar, bandera
SIN cambiar.** Producción intacta. Continúa [186](186-EL-AUDITOR-YA-NO-ENTRA-COMO-SUPERUSUARIO.md).

## De dónde viene

La auditoría total de MALIA encontró que no es "la atrasada" de la flota: es
la **única** con `delivery_source='tabla'` —353 zonas reales, tarifa decidida
por el backend— y a la vez la última en `state_source='prompt'`.

Y ese `prompt` no era un olvido. `ARCHITECTURE-REGRESSION-AUDIT.md` (16-sep) la
registra como **contención deliberada**: nació en `backend` y la bajaron a mano
con `fase2 --apagar`, junto con Lis. Lis ya volvió; MALIA no, porque el alcance
aprobado no la incluía.

## Las cuatro decisiones del negocio

| Pregunta | Respuesta | Qué implicó |
|---|---|---|
| ¿Mantener el precio mayorista de $8.000? | Sí, **lo cotiza una persona** | Ninguna capacidad nueva. Sale la cifra del prompt |
| ¿Horario de Chipichape? | lun-jue 12:00–20:00 · vie-dom y festivos 12:30–20:30 (planta 11:00–19:00) | Va a `observacionesHorario` |
| ¿Bloquear efectivo en domicilio? | No, basta con explicarlo | Ninguna validación nueva |
| ¿Impedir el domicilio de un solo pavé? | **Sí, que lo impida el backend** | Capacidad nueva |

## La capacidad nueva: pedido mínimo para domicilio

`ficha.entrega.minimoDomicilioCents`. Es un **importe**, no un número de
unidades, y la razón no es comodidad:

> La regla del negocio era *"mínimo dos de 8 oz, o uno de 16"*. Un mínimo por
> unidades **no puede expresarla** —uno de 16 oz es UNA unidad y sí vale— y
> ataría el núcleo al catálogo de un cliente. Traducida, la regla es
> económica: un domicilio no sale a cuenta por menos de X.

| Pedido | Subtotal | ¿Sale? |
|---|---|---|
| 2 × pavé 8 oz | $20.000 | ✅ |
| 1 × pavé 16 oz | $18.000 | ✅ iguala el mínimo |
| 1 × pavé 8 oz | $10.000 | ❌ faltan $8.000 |

Se compara contra el **subtotal**, nunca contra el total con la tarifa. Cobrar
el envío para alcanzar el mínimo del envío es circular, y dejaría pasar justo
los pedidos que la regla frena: $10.000 de producto + $10.000 de tarifa
superan cualquier mínimo razonable. Hay una prueba dedicada a eso.

Y avisa **dos veces**: en el bloque de estado, en cuanto se sabe la modalidad,
y en el cierre. Solo el segundo es autoridad; el primero existe para que el
cliente no elija sabores y toppings para nada.

## 🔴 El hallazgo que cambia el orden del plan

El plan escrito ponía los datos primero y la bandera después. **Es al revés**,
y aplicarlo en ese orden habría roto los pedidos para recoger de MALIA.

`requisitosDe` se llama sin modalidad mientras `state_source='prompt'`
(`pipeline.ts:1137`), y solo se recalcula con ella **dentro** del
`if (estadoEstructurado)` (línea 1213). Medido contra la ficha real:

```
                        HOY (sin direccion)   DESPUÉS (con direccion)
modalidad = null    →   nombre, telefono      direccion, nombre, telefono   ← 🔴
modalidad = domicilio → nombre, telefono      direccion, nombre, telefono
modalidad = recogida  → nombre, telefono      nombre, telefono
```

Con `prompt`, la modalidad es **siempre** `null`. Añadir el requisito hoy
haría que el backend le exigiera la dirección **también a quien pasa a
recoger** — el mismo fallo de 20-ago-2026 que dio origen a
`soloEnModalidades`, reintroducido por la puerta de atrás.

Lo mismo por el otro lado: la migración quita de `reglasPropias` el mínimo y
la petición de dirección porque pasan a ser estructura. Si los datos entran
antes que el código, MALIA pierde las dos protecciones en el intervalo.

**Orden correcto:**

```
1. Desplegar el código          (inerte: ninguna ficha tiene el campo todavía)
2. Laboratorio: MALIA real con state_source=backend
3. Datos + bandera, JUNTOS      (migrar:malia --aplicar  →  fase2 --encender)
4. Verificar en vivo
```

## Dos correcciones a la propia auditoría

**El producto `"1"` no era un bloqueador.** Lo reporté como "disponible sin
precio", pero está **archivado** desde el 18-sep (`archived_at`), y
`catalogoDePedidos` filtra por `archivedAt` además de `available`. Nunca llega
al agente. El catálogo vivo de MALIA son 3 productos, no 5. Miré una columna y
no la otra.

**El precio sin valor es deliberado** (`catalog/productos.ts:58`): un negocio
que aún no lo sabe puede guardarlo y completarlo después. Así que el criterio
de aceptación *"no permitir productos disponibles sin precio"* contradice un
diseño existente, y prohibirlo sería la corrección equivocada. Lo correcto es
hacerlo **visible**: el auditor ahora los lista como observación, con el
motivo —con `state_source='backend'` el backend no puede sumar y el pedido
acaba en una persona—. Hoy da 🟢 ninguno.

## Lo que se probó, y cómo

| | |
|---|---|
| `faltaParaElMinimoDeDomicilio` | 9 pruebas: inclusivo, modalidad, sin configurar, subtotal nulo |
| La Policy del cierre | 8 pruebas, incluidas las de que los guardarraíles previos siguen ganando |
| **`backend` + `tabla`** | 11 pruebas — la combinación que no tenía ninguna |
| Zod no descarta campos | guardarraíl nuevo, **probado cortándolo**: 1 en rojo |
| El cableado del pipeline | guardarraíl, **probado cortándolo**: 1 en rojo |

Total: 2.543 unitarias en verde, typecheck, lint y build.

### El guardarraíl de Zod, y la asimetría que destapó

Se escribió por el susto de `porDia` (20-sep): implementado entero y a punto
de salir decorativo porque ninguna ruta lo declaraba. Al escribirlo saltó
`cierre`, que tampoco está declarado en la ruta de admin — y resultó **no ser
un fallo**:

`fusionarFicha` hace `{...guardada[s], ...entrante[s]}` por sección
(`leer-ficha.ts:186`). Es superficial, a nivel de clave:

| Caso | Qué pasa |
|---|---|
| La ruta NO declara la clave (`cierre`) | llega `undefined`, se omite → **se conserva** |
| La ruta SÍ declara la clave (`entrega`, `horario`) | el objeto entrante **reemplaza** al guardado |

Por eso `porDia` se perdía y `cierre.requisitos` no. **Lo peligroso no es
olvidar un campo: es olvidarlo DENTRO de un objeto que la ruta sí declara.**
La prueba comprueba eso y nada más, y declara la asimetría para que nadie
"arregle" `cierre` y vacíe los requisitos de todos.

## Lo que NO se hizo

Producción sin tocar: ni ficha, ni bandera, ni catálogo, ni zonas, ni
`payment_source`, ni ningún otro negocio. Sin push, sin merge, sin deploy.

Sin capacidad de precios por volumen y sin validación de pago por modalidad:
el negocio dijo que no hacen falta. Construirlas "por si acaso" habría sido
código sin dueño.

## El Laboratorio · 31 de 31

Postgres 16.14 desechable (el mismo minor que producción), en RAM, con la
configuración **real** de MALIA copiada en solo lectura: su ficha ya migrada,
sus 3 productos vivos, sus 7 grupos con 51 opciones y sus **350 zonas
activas**. `state_source=backend` + `delivery_source=tabla` encendidos.

No hay LLM: el modelo es una constante. Lo que se prueba no es si el modelo
acierta, sino si el backend decide bien **pase lo que pase** con lo que
proponga — que es lo que significa "backend como autoridad".

| Bloque | Resultado |
|---|---|
| Cifras del catálogo (1×8oz, 2×8oz, 1×16oz, con topping, ×20, inexistente) | 7/7 |
| Tarifa desde la tabla (2 zonas reales con tarifas distintas + 3 sin cobertura) | 5/5 |
| Dirección: obligatoria en domicilio, NO en recogida | 3/3 |
| **Pedido mínimo de $18.000** | 5/5 |
| Persistencia real en Postgres + bloque de estado | 6/6 |
| Cierre de punta a punta | 4/4 |
| Limpieza sin huérfanos | 1/1 |

Lo que más importa de esa lista:

```
1 pavé 8 oz a domicilio ($10.000)         → RECHAZADO, faltan $8.000
1 pavé 16 oz ($18.000), iguala el mínimo  → ACEPTADO
1 pavé 8 oz PARA RECOGER ($10.000)        → ACEPTADO, el mínimo no aplica
$10.000 producto + $10.000 tarifa         → RECHAZADO: la tarifa no cuenta
20 pavés → $200.000 del catálogo, NO los $160.000 del mayorista en prosa
sin dirección en domicilio → no cierra · sin dirección para recoger → sí cierra
```

**Rollback probado en los dos sentidos** (`fase2 --apagar` y `--encender`), y
**regeneración estable**: 15.762 → 15.235 caracteres en la primera pasada, y
"sin cambios" en la segunda. Ocho sondas sobre el prompt regenerado
confirman que salió lo que tenía que salir (el mayorista, el mínimo en prosa,
la lista de ciudades, el horario) y se quedó lo que tenía que quedarse (la
conducta de Chipichape, el formato de opciones, pedir el barrio).

El auditor contra el laboratorio: **MALIA 🟢 alineada, cero hallazgos**.

### Un hallazgo del propio Laboratorio

`Arequipe`, `Milo` y `Leche Klim` existen **en los dos grupos** del mismo
producto: son sabor Y topping. Cuando el cliente dice solo "arequipe", el
backend **no adivina** — lo declara como duda y hace que el agente pregunte
*"¿arequipe como sabor o como topping?"*. Es la conducta correcta, y en el
catálogo de MALIA va a pasar a menudo. Queda fijada como escenario.

## Qué queda

1. **`migrar:malia --aplicar` + `fase2 --encender`**, juntos y en ese orden,
   después del deploy.
3. **Lis cambió su horario el 21-sep a las 20:18**: el domingo ya no está
   cerrado, abre 14:00–19:00. Lo hizo ella desde la pantalla y `porDia` y las
   columnas están sincronizadas — se anota porque cualquier documento anterior
   que diga "Lis cierra los domingos" ya está viejo.
4. **Tres documentos desactualizados sobre `state_source`**: la tabla de T027
   (`specs/003…/tasks.md:334`) dice que MALIA está en `backend`, y los
   comentarios de `pipeline.ts` (1100, 2648, 3069) dicen que "los 4 negocios
   reales" están en `prompt`. Hoy solo queda MALIA.

## Rollback

- Código: no toca a nadie sin `minimoDomicilioCents` en su ficha, y ninguna
  ficha lo tiene. Revertir es desplegar el SHA anterior.
- Datos: `migrar:malia` deja `agent_profile_bk_malia_<fecha>` antes de
  escribir; restaurar la columna `ficha` desde ahí.
- Bandera: `pnpm fase2 org_kf1suh8q9dtbmcq3f3ba --apagar --aplicar`.
