# 175 — La variable del encabezado

**15-sep-2026.** Korex daba por hecho que las variables de una plantilla solo
viven en el cuerpo. Las que van en el encabezado nunca se enviaban, y Meta
rechazaba el mensaje entero.

## El incidente

Primera plantilla de Camilabrandcol — cliente **solo de plantillas**, sin
agente ([174](174-LAS-PLANTILLAS-QUE-NUNCA-LLEGABAN.md)). Al enviarla:

```
(#132000) Number of parameters does not match the expected number of params
```

En el chat quedó el mensaje con marca de error. Nunca llegó a la clienta.

## La causa

`ventana_cerrada_23h`, aprobada por Meta, reparte su contenido así:

```
HEADER   "{{1}} Estamos para ayudarte"     ← la variable está AQUÍ
BODY     "✨ ¡Hola! Bienvenido(a) a…"       ← sin variables
BUTTONS  [QUICK_REPLY] "Continuar consulta."
```

Y Korex decidía si hacían falta parámetros mirando **solo el cuerpo**:

```js
const needsVariable = countVariables(contenido.body) === 1;
```

Cuerpo sin variables → "esta plantilla no necesita nada" → la pantalla no
pedía ningún valor → el envío salía sin parámetros → Meta lo rechazaba.

El fallo era consistente en las tres capas:

| Capa | Qué asumía |
|---|---|
| `template-sender.tsx` | `/\{\{1\}\}/.test(selected.body)` — solo el cuerpo |
| `templates.ts` | `countVariables(contenido.body)` — solo el cuerpo |
| `ycloud/client.ts` | el header solo podía ser **una imagen** (`headerImageUrl`) |
| `serializeTemplate` | ni siquiera enviaba el header a la pantalla |

**Meta numera las variables por componente**: el `{{1}}` del header y el del
body son dos parámetros distintos, cada uno en su propio componente del
envío. Korex modelaba un solo parámetro global.

## El arreglo

Una capacidad del CRM, no un parche para un cliente: cualquier negocio con
un encabezado personalizado fallaba igual.

**1. Detección** — `headerTextConVariable(components)` en
`template-validation.ts` (puro, sin DB ni red, como el resto de ese archivo).

**2. Envío** — `headerTextParam` viaja hasta el proveedor:

```js
// YCloud (y Graph con el mismo esquema de Meta)
{ type: "header", parameters: [{ type: "text", text: "Valentina" }] }
```

Excluyente con el header de imagen: una plantilla tiene un solo encabezado.

**3. Validación temprana** — si falta el valor, `TemplateError` **antes** de
llamar al proveedor. No se gasta un envío que Meta va a rechazar.

**4. La pantalla** — `serializeTemplate` ahora expone `headerText`, y el
selector pide *"Valor de {{1}} en el encabezado"* cuando corresponde,
mostrando además el encabezado en la vista previa. El botón queda
deshabilitado hasta que se escriba.

## Lo que NO cambia

- Plantillas con variable solo en el cuerpo: idénticas (prueba de regresión
  explícita — `bodyParams: ["María"], headerTextParam: undefined`).
- Plantillas con encabezado de imagen: intactas, misma rama de siempre.
- Plantillas sin variables: sin cambios.
- El límite de **una** variable por componente sigue igual; esto no amplía el
  acotamiento v1, solo reconoce que el header tiene el suyo.

## Verificación

`tests/unit/header-texto-variable-envio.test.ts` — 8 casos con la plantilla
real de Camilabrandcol: el valor llega a YCloud, Graph arma el componente con
el formato de Meta, falta el valor → falla sin gastar el envío, y la
regresión del cuerpo. Más los cuatro de detección pura (texto con variable,
texto fijo, imagen, sin components).

Gate completo: typecheck, 2182 pruebas, lint y build.

## Cómo revertir

`git revert` del commit. `headerVariable` es opcional en toda la cadena y
`headerText` es un campo nuevo del DTO: revertir devuelve el comportamiento
anterior sin romper tipos — y con él el `#132000` para plantillas con
encabezado variable.
