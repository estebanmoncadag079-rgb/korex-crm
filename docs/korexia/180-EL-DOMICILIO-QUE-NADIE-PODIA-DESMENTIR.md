# 180 · El domicilio que nadie podía desmentir

**19-sep-2026** · Fases 8 y 9 del plan "Backend como autoridad — La Churra + Lis".

---

## El hueco

Desde el 13-sep hay un guardarraíl que detecta cuando el agente dice una
tarifa de domicilio que el backend no verificó. Funciona, tiene cinco
incidentes reales detrás afinándolo, y hasta hoy **no se activaba nunca para
La Churra ni para Lis**.

El motivo estaba en una sola condición, en `pipeline.ts`:

```js
if (resultadoZona?.status === "found" && ...)
```

`resultadoZona` solo es `found` cuando el negocio tiene tabla de zonas
(`delivery_source='tabla'`). La Churra y Lis están en `'prompt'`: su domicilio
lo cotiza Uber, Yango o DiDi según la dirección, así que no hay tabla. Y
`resolverZonaDeEntrega` devuelve `not_found` cuando no hay zonas cargadas
(`delivery/zonas.ts:116`).

El otro candado —el de `inconsistenciaFinancieraDePedido`— tampoco cubría el
caso: vive detrás de `puedeVerificarDomicilio`, y está apagado **a propósito**
desde el incidente de Zahenz (7-sep), cuando exigir una prueba imposible
derivó el 100% de los pedidos con domicilio de MALIA.

Resultado neto: el agente podía decirle a un cliente de La Churra *"el
domicilio son $5.000"* y no había nada en todo el sistema que lo detectara.

## Lo que se hizo

**No se construyó un guardarraíl nuevo.** Se extendió el que ya existía.

`dijoOtroValorDeDomicilio` ahora acepta `feeCentsVerificado: number | null`.
Con `null` la pregunta que hace es la misma de siempre —*"¿esta cifra
corresponde a algo verificado?"*— solo que la lista de lo verificado no
incluye ninguna tarifa, porque no existe. Quedan como legítimas:

- el subtotal que calculó el backend sobre los ítems,
- el total que el propio cierre declara,
- **y las cifras que ya dijo una persona del negocio en ese chat**.

Ese tercer punto no es un detalle. Sin tabla de zonas, cotizar a mano no es
una anomalía: es el flujo normal. El equipo mira Uber y escribe el valor. Sin
esa excepción se repetiría el incidente del 8 y 9-sep, cuando el candado
bloqueó un total que había dado el propio equipo y el cliente ya había pagado.
El mecanismo ya existía (`totalesDichosPorUnaPersona`, comprobado contra filas
de `message` con `ai_generated=false`); aquí se reutiliza tal cual.

Cuando dispara, el modelo recibe un mensaje distinto
(`CORRECCION_DE_DOMICILIO_SIN_TARIFA`): el de siempre le ordena *"usa
exactamente la tarifa verificada"*, y aquí no hay ninguna que usar —
mandárselo sería repetir el error del 10-sep, cuando se le dio la corrección
del caso equivocado y el cliente acabó derivado.

## El falso positivo que apareció por el camino

La primera versión rompía la frase correcta de La Churra:

> "Los churros son $20.000. El domicilio se cotiza aparte."

Se leía como *"el domicilio cuesta $20.000"*. No hay cifra después de la
palabra, así que el detector miraba hacia atrás, **se comía el punto** y
agarraba el precio de los productos. Es el mismo mecanismo exacto del falso
positivo de $64.000 del 9-sep, con un punto en lugar de un salto de línea.

La corrección es de causa raíz, no un parche: **la ventana hacia atrás tampoco
cruza un fin de oración**, igual que ya no cruza un salto de línea. Dos
oraciones son dos hechos distintos. El `\s` del patrón `[.!?]\s` es lo que
salva los miles — en `$20.000.` el punto va pegado al dígito.

Beneficia también al camino con tabla: es una fuente de falsos positivos menos
para MALIA.

## Por qué esto no repite Zahenz

Zahenz exigía una PRUEBA en todos los pedidos con domicilio, y derivaba el
100%. Esto solo mira si el texto pone una cifra concreta junto a "domicilio"
que no sea ninguna de las legítimas. **Un pedido que deja el domicilio
pendiente —lo que se espera de estos negocios— no lo toca nunca.** Hay una
prueba dedicada a eso.

## Fase 9 · El validador que no corría

`validarConfiguracionArquitectonica` existía desde el programa de mejora,
estaba bien construida… y **no la llamaba nadie**: solo los tests. Un
validador que no corre nunca no protege de ninguna regresión.

Ahora tiene dónde correr: `pnpm auditar:arquitectura`. Recorre TODAS las
organizaciones —nunca una lista escrita a mano—, compara cada `agent_profile`
contra la arquitectura aprobada para su vertical, y sale con `exit 1` si
alguna tiene un mecanismo CORE ausente. `--estricto` incluye también las
recomendadas.

Ejecutado contra una base con la configuración real de producción replicada,
detecta exactamente lo que debía:

```
🟡 La Churra (pedidos) — recomendado y ausente: paymentSource
     paymentSource: tiene "prompt", se recomienda "ficha"
🔴 Lis (pedidos)       — falta(n) [core]: stateSource
     stateSource: tiene "prompt", se espera "backend"
🔴 MALIA (pedidos)     — falta(n) [core]: stateSource
❌ FAIL
```

No escribe nada: corregir es una decisión humana con su propio comando, igual
que `fase2`/`migrar:catalogo` sin `--aplicar`.

**Y un comando no basta.** El problema que se estaba arreglando era
precisamente que nadie ejecuta lo que hay que acordarse de ejecutar. Así que
el diagnóstico va también donde el superadmin ya mira: el panel `/admin`
muestra una etiqueta "Arquitectura incompleta" en el cliente afectado, con los
mecanismos ausentes en el tooltip.

Para eso se extrajo la parte pura del validador (`diagnosticarConfiguracion`),
de modo que el panel clasifique a todos los clientes con el JOIN que
`listClients` ya hacía — sin una consulta por cliente. La regla sigue en un
solo sitio: la matriz `REGLAS` de `server/auth/arquitectura.ts`.

## Lo que NO se tocó

Las 3 compuertas, la atomicidad, Policy, la normalización del catálogo, los
productos, los precios, el aislamiento multi-tenant, el webhook, YCloud y el
worker siguen exactamente igual. Del `pipeline.ts` solo se tocó el bloque del
guardarraíl de domicilio.

Ningún cambio conoce a La Churra ni a Lis por su nombre: la condición es
`delivery_source`, una capacidad del negocio.

## El agujero que quedaba: la cifra que se avalaba sola

La primera versión aceptaba `action.totalCents` como cifra legítima también
sin tarifa verificable. Ese campo **lo rellena el modelo**: bastaba decir "el
domicilio son $5.000" y declarar `totalCents: 500000` en el mismo turno para
que la invención se validara a sí misma.

Con tarifa verificada no importa —hay una cifra del backend contra la que
contrastar—, pero sin ella sí. Ahora, sin tarifa, solo cuentan cifras que el
modelo **no controla**:

- `estadoGuardado.totalCents`, que calculó el backend sobre el carrito;
- lo que escribió una persona del negocio (filas de `message` con
  `ai_generated=false`).

El riesgo de quedarse corto lo cubre la regla de fin de oración: un total que
vive en otra frase ya no se lee como tarifa de domicilio. Hay una prueba
dedicada (`NO puede validarse a si mismo poniendo la cifra inventada en
totalCents`).

## Fase 7 · El domicilio pendiente ya se sabía representar

Antes de diseñar nada se revisó si existía una estructura reutilizable, como
pedía el plan. **Existe**, en `orders/estado.ts:141-146`:

```
tipo: "domicilio" | "recogida";
feeCents: number | null;   // null = pendiente de verificar
```

Y distingue explícitamente `null` (pendiente) de `0` (una zona que de verdad
es gratis). El CASO C del plan —una persona del negocio cotiza por fuera—
también tiene mecanismo: `totalesDichosPorUnaPersona`, comprobado contra filas
de `message`, no contra lo que diga el modelo.

No se creó ninguna estructura nueva.

## Fase 4 · No hay catálogo duplicado que eliminar

Verificado contra producción, no supuesto:

- Ni La Churra ni Lis mencionan precios en `agent_profile.instructions`
  (comprobado con una expresión regular de precios sobre el texto real).
- El `flujo.menu` de Lis (210 caracteres) es la configuración del **menú
  interactivo de WhatsApp** ("Ver menú y precios", "Hacer un pedido"…), es
  decir UX, no datos de productos.

No se borró nada porque no había nada duplicado. Los 14.016 y 17.020
caracteres de `instructions` son comportamiento (tono, reglas, escalado), que
el plan prohíbe tocar.

## MALIA · Fuera de alcance, y por qué

El auditor la marca 🔴 por `state_source='prompt'`. **No se migró.** No es una
regresión: `ARCHITECTURE-REGRESSION-AUDIT.md` (16-sep) la documenta junto a
Lis como **contención temporal** del rollout — ambas nacen en `backend` y se
bajaron a mano con `fase2 --apagar`. El plan aprobado tiene alcance explícito
sobre La Churra y Lis; ampliarlo a MALIA sería una decisión de negocio que
nadie ha tomado.

Queda una consecuencia que conviene mirar: cuando Lis se migre, MALIA seguirá
dando `FAIL` en `auditar:arquitectura` por una decisión deliberada. Un
validador que grita por algo que alguien decidió a propósito acaba
ignorándose. Hoy **no hay forma de distinguirlo en los datos**: el registro de
cambios (`conRegistro`) escribe a `console.log`, no a una tabla, así que no
queda rastro consultable de que alguien bajó la bandera a propósito.

Mitigación disponible sin tocar el esquema: el comando acepta la lista de
contenciones por parámetro, nunca escrita en el código. La solución completa
—registrar el motivo y la fecha de una contención— es una decisión
arquitectónica que se reporta, no se improvisa.

## Fase 10 · Versionado de `state_source` — DETENIDO Y REPORTADO

El problema es real: `state_source='backend'` no tiene versión semántica. Si
se despliega un commit anterior donde esa bandera significaba otra cosa (por
ejemplo, sin las tres compuertas), la columna sigue diciendo `backend` y el
comportamiento cambia **en silencio**.

No se implementó, y es deliberado. Cualquier solución real exige:

1. **Persistir una versión** de arquitectura por organización (columna o tabla
   nueva) — cambio de esquema, justo lo que el plan pide no hacer en grande.
2. **Decidir qué pasa cuando no coincide**: ¿se apaga el mecanismo?, ¿se
   bloquea el turno?, ¿solo se avisa? Eso no es una elección técnica: define
   qué le ocurre a un cliente real en mitad de un rollback.

El punto 2 es una decisión de arquitectura y de negocio que el plan no define,
así que aplica su REGLA DE DETENCIÓN.

Lo que sí existe hoy y cubre parte del riesgo: `/api/health` reporta el commit
desplegado, y `migrate.mjs` verifica que el esquema tenga cada columna que el
código espera. Ninguno de los dos liga `state_source` a una versión de
arquitectura.

## Pendiente de autorización (cambios de configuración en producción)

Las Fases 2, 5 y 6 **no necesitan código** — sus mecanismos ya existen:

| Fase | Qué falta | Mecanismo que ya existe |
|---|---|---|
| 2 | Lis: `state_source` `prompt` → `backend` | `pnpm fase2 <org> --encender` (rollback: `--apagar`) |
| 5 | La Churra: `payment_source` `prompt` → `ficha` | `pnpm migrar:pago` |
| 6 | La Churra y Lis: el requisito `direccion` solo tiene `id` — sin `obligatorio`, así que hoy **se puede cerrar un pedido a domicilio sin dirección** | `soloEnModalidades: ["domicilio"]` + `obligatorio: true` en la ficha |

Los tres son escrituras en producción y esperan autorización explícita.
