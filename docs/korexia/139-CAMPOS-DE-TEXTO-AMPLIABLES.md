# 139 — Los campos de texto se pueden ampliar arrastrando

25-ago-2026.

## El pedido

Esteban vio un campo del cuestionario de alta (la descripción larga de "qué
vendes") con la rayita diagonal en la esquina inferior derecha — el asa nativa
del navegador para arrastrar y agrandar un cuadro de texto — y pidió que
**todos** los cuadros de texto del CRM tuvieran esa misma posibilidad,
dejando que el usuario decida si lo amplía o no.

Ese campo ya era un `<Textarea>`, que hereda `resize: vertical` del reset de
Tailwind sin que nadie lo pidiera. El resto de campos de una sola línea
(`<Input>`) no pueden tenerlo: un `<input>` HTML no soporta la propiedad
`resize` en ningún navegador — solo `<textarea>` la soporta.

## La solución

Nuevo componente compartido,
[expandable-input.tsx](../../src/components/ui/expandable-input.tsx): un
`<textarea rows={1}>` con el mismo aspecto exacto de `Input` (mismo alto,
borde, padding, tipografía), pero con `resize-y` habilitado.

Detalle importante: dentro de un formulario, presionar Enter en un `<input>`
dispara el envío; en un `<textarea>` normal solo inserta un salto de línea.
`ExpandableInput` replica el comportamiento de un input — Enter dispara
`form.requestSubmit()` si hay un formulario, Shift+Enter inserta salto de
línea — el mismo patrón que ya usaba el compositor de chat
(`components/inbox/composer.tsx`).

Se reemplazó `<Input>` por `<ExpandableInput>` en los **24 campos de texto
libre** de las pantallas donde el dueño del negocio configura su cuenta:
nombre y ubicación del negocio, qué vende, las cuatro preguntas de entrega,
formas de pago, regalos, la lista de reglas propias/nunca prometer/escalar
siempre del cuestionario, los teléfonos de aviso y las preguntas del
knowledge base (agente), nombre de producto/grupo (catálogo), nombre de
servicio (citas), nombre de contacto, nombre de persona del equipo, nombre de
etapa del pipeline y la pregunta sugerida del Laboratorio.

**Lo que se dejó como `Input` a propósito** (14 campos): todo lo que es
corto por naturaleza y no gana nada con ampliarse — horas, precios,
duraciones y otros campos numéricos, identificadores técnicos (WABA ID, Phone
Number ID, nombre de plantilla de Meta), correo, contraseña temporal, campos
con `maxLength` bajo, el buscador/filtro de contactos, categorías cortas — y
los dos campos con su propio atajo de Enter para una acción rápida (agregar
una opción en el catálogo, agregar una etapa nueva), donde convertirlos
habría roto ese atajo.

## Verificado

- `tsc --noEmit`: limpio.
- `eslint` sobre los 11 archivos tocados: limpio.
- Suite completa (`vitest run tests/unit tests/integration`): **983 pruebas,
  0 fallos**, sin regresiones (es un cambio de UI puro, sin lógica de
  negocio ni pipeline de por medio).

**Lo que NO se verificó**: no se probó visualmente en un navegador — este
entorno no tiene esa capacidad. No se comprobó cómo se ve el resize dentro de
celdas de tabla angostas (importar-catálogo, nombre de producto) ni en la
fila compacta de etapas del pipeline; visualmente debería comportarse bien
(el resize solo cambia el alto, nunca el ancho), pero conviene que alguien lo
mire en el navegador antes de darlo por cerrado del todo.
