# 171 — El bucle de la recogida

**14-sep-2026.** El único camino del pipeline que abandonaba al cliente sin
intentar rescatarlo primero.

## El incidente

MALIA, 14-sep-2026, 11:06 (conv `cv_stkja8zpfio6e4131dqn`):

```
11:06  CLIENTE: Hola / Buenos días
11:06  BOT:     ¡Holaa! Bienvenid@ a Malia…
11:06  CLIENTE: Para pedirte uno y paso a recogerlo
11:11  BOT:     Dame un momentico 🙏 Te comunico con una persona del equipo.
11:12  CLIENTE: Bueno
```

Cuatro minutos y medio de espera para leer que la atendería una persona. Y
los avisos al equipo de MALIA siguen sin configurar
([168](168-AVISOS-QUE-NO-LLEGABAN-A-NADIE.md)), así que no la atendió nadie.

## Lo que pasó

La traza:

```
hechos=domicilio:"recogida"=recogida@backend · domicilio:"recogida"=recogida@backend
accion=handoff  guardarrailes=-  causa_handoff=model_output_recovery_failed
```

El modelo registró la recogida. El backend le respondió *"[SISTEMA]
Registrado: este pedido es de recogida en el local, sin domicilio"*. **Y la
volvió a registrar.** Al tercer intento agotó `MAX_CONSULTAS_DOMICILIO = 2` y
el pipeline derivó.

Ningún guardarraíl actuó (`guardarrailes=-`): no fue una contradicción, fue
un bucle.

## La causa de fondo

No es el bucle en sí — el modelo a veces repite, eso pasa. Es **cómo
reaccionaba el sistema**:

| Situación | Qué hacía |
|---|---|
| Un guardarraíl detecta un problema | Reintenta con corrección → si falla, deriva |
| El modelo repite una consulta | **Derivaba de una** |

Era el único camino del pipeline que se rendía sin intentar. Y en este caso
**no faltaba nada**: la recogida estaba registrada, el pedido podía seguir.

Había además un segundo defecto que alimentaba el primero: al repetir la
consulta, el backend le devolvía **el mismo texto** que el modelo ya había
ignorado una vez. Repetir un eco no saca a nadie de un bucle.

## El arreglo

**1. Una consulta repetida recibe una corrección, no un eco.** Se lleva
cuenta de lo ya consultado en el turno (`recogida`, o la zona normalizada).
La segunda vez, en vez del mismo `[SISTEMA]`, va
`CORRECCION_DE_DOMICILIO_YA_CONSULTADO`: *"eso ya lo consultaste, el
servidor ya lo registró, contesta al cliente ahora"*. Información nueva.

**2. Agotar el presupuesto ya no significa abandonar.** Antes de derivar, un
rescate con `CORRECCION_DE_DOMICILIO_AGOTADO` — el mismo patrón que usan
todos los demás guardarraíles. Si con eso contesta, el turno sigue normal. Si
insiste, ahí sí deriva, pero habiendo intentado.

Queda trazado como `domicilio_en_bucle` (`corrigio` / `disparado`), que antes
no existía: este camino derivaba sin dejar rastro de guardarraíl.

## Verificación

- `tests/unit/pipeline-domicilio.test.ts` — dos casos nuevos: el modelo
  repite hasta agotar el turno y **contesta** tras la corrección; y el camino
  infeliz, donde insiste siempre y sí termina en una persona.
- Gate completo: typecheck, 2168 pruebas, lint y build en verde.

## Alcance

Solo toca el bucle de `consultar_domicilio`, que únicamente corre en negocios
con `delivery_source='tabla'`. Citas y negocios sin zonas no ven ningún
cambio. `MAX_CONSULTAS_DOMICILIO` sigue siendo 2: el arreglo no da más
consultas, da una salida digna cuando se acaban.

## Cómo revertir

`git revert` del commit. Las dos partes son independientes: revertir solo el
bloque del rescate (el `if` tras el bucle) deja el comportamiento anterior
sin tocar la detección de repetidas.
