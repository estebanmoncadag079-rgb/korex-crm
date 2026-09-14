# 172 — El domicilio que nadie consultó

**14-sep-2026.** Al modelo se le pedía copiar un número que no existía, y por
no poder hacerlo, el cliente perdía la atención.

## Lo que se midió

Tres horas de monitoreo en vivo de MALIA, con el agente atendiendo normal:

```
128 turnos · 8 derivaciones (6%)

  4  inconsistencia financiera (domicilio-no-verificado)   ← esto
  2  inconsistencia financiera (despedida-contradice-tarifa)
  1  inconsistencia financiera (domicilio-omitido)
  2  business_rule (correctas: salud, confirmar pagos)
```

**La mitad de las derivaciones eran el mismo caso**: el modelo cerrando un
pedido con una tarifa de domicilio que nunca consultó.

El testigo más claro es anterior — el pedido de $48.000 de Brenda (12-sep,
`cv_edofkja6l5z866p7zwm3`): la zona "Versalles" **existía** en la tabla de
MALIA, activa, a **$8.000**, que es exactamente lo que el bot cobró. El
número era correcto. Nadie lo había verificado.

## La causa

Dos situaciones muy distintas caían en el mismo código de fallo:

```js
if (!zonaEfectiva || deliveryFeeCents !== zonaEfectiva.feeCents) {
  …
  return "domicilio-no-verificado";
}
```

- **`!zonaEfectiva`** — no se verificó **nada, nunca**.
- **`!== feeCents`** — sí se verificó, y el modelo puso otra cifra.

Y con el mismo código llegaba la misma corrección:

> *"deliveryFeeCents NO es la tarifa que confirmó consultar_domicilio. **Usa
> exactamente esa cifra verificada**."*

Para el segundo caso es una instrucción clara. Para el primero es imposible:
**no hay ninguna cifra verificada que copiar**. El modelo reintentaba, volvía
a fallar, y el turno terminaba en handoff.

Peor: si el modelo hacía lo correcto —emitir `consultar_domicilio` para
verificar— el pipeline también lo castigaba, porque el chequeo del reintento
daba por fallida cualquier respuesta que no fuera `notify_order`:

```js
const reintentoFallo =
  reintento.ok && reintento.data.action === "notify_order"
    ? inconsistenciaFinancieraDePedido({…})
    : "total-no-cuadra";   // ← una consulta legítima, tratada como fallo
```

No había salida: ni copiando (imposible) ni consultando (castigado).

## El arreglo

**1. Un código propio para el caso sin verificación**:
`domicilio-nunca-verificado`, separado de `domicilio-no-verificado`. El
bloqueo es el mismo; lo que cambia es qué se le pide al modelo.

**2. Una corrección que sí se puede cumplir**: *"este pedido cobra un
domicilio que no se ha verificado. ANTES de cerrar, emite
consultar_domicilio con la dirección que te dio el cliente"*.

**3. Que el pipeline acepte esa respuesta**: si el reintento trae
`consultar_domicilio`, se resuelve la zona contra la tabla, se persiste la
entrega verificada y se le pide cerrar otra vez, ya con la tarifa real. Si
insiste en cerrar sin verificar, el candado sigue cerrado y deriva.

## Lo que NO cambia

- El candado sigue igual de firme: una tarifa sin respaldo sigue sin poder
  registrarse (prueba explícita: *"si tras pedirle que verifique sigue sin
  hacerlo, el candado NO se abre"*).
- La excepción del total dicho por una persona del negocio sigue vigente
  ([ver el comentario de `totalesDichosPorUnaPersona`]).
- Negocios sin tabla de zonas (`delivery_source='prompt'`): sin cambios, el
  candado ni se activa.

## Verificación

- `tests/unit/pipeline-domicilio.test.ts` — el flujo completo de rescate
  (cierra sin verificar → se le pide → consulta → cierra con la tarifa real)
  y el camino infeliz (insiste → deriva).
- Cuatro pruebas existentes actualizadas: esperaban
  `domicilio-no-verificado` en casos sin ninguna zona verificada. **No cambió
  lo que detectan** —siguen bloqueando— sino el código y, con él, la
  corrección.
- Gate completo: typecheck, 2170 pruebas, lint y build.

## Cómo revertir

`git revert` del commit. Las tres piezas son independientes: revertir solo el
bloque de rescate de `pipeline.ts` devuelve el comportamiento anterior
dejando la distinción de códigos, que por sí sola no cambia ningún bloqueo.
