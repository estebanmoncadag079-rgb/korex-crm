# 200 — La ficha: lo que el bot envía tal cual vs. lo que son instrucciones

26-sep-2026. Continúa la auditoría del doc 199. Decisiones del dueño:

- Se mejora lo que ya existe: pestaña **Agente → "Ajustar mi asistente"**
  (`/configuracion-inicial`, `onboarding-wizard.tsx`). No hay pantalla nueva.
- Cada campo se distingue a la vista: 💬 **se envía tal cual** / 🧠 **instrucción
  para el bot** (el cliente final no la ve).
- **Sin orden fijo del pedido**: el bot tiene una meta (cerrar la venta / agendar
  la cita) y la lista de lo que necesita para cerrar. Regla por defecto: los
  datos de contacto y de entrega se piden JUNTOS, sin mezclarlos con elegir
  productos.
- **Formas de pago estructuradas por modalidad** (domicilio / recoger).
- **Migración**: se acomoda lo que ya escribió cada negocio y el dueño revisa el
  antes/después ANTES de guardar.

## Datos nuevos de la ficha (todos opcionales; sin ellos, el comportamiento de hoy)

| Campo | Sección | Tipo | Reemplaza / resuelve |
|---|---|---|---|
| `pago.porModalidad.{domicilio,recoger}` | negocio | casillas | caso Sofía: el backend responde con un dato, no con una frase |
| `pago.cuentaAntesDeConfirmar` (`si_la_piden` \| `nunca`) | negocio | opción | las 3 órdenes contradictorias sobre la cuenta (199 §1.1) |
| `fueraDeHorario.tomaPedidos` | flujo | sí/no | `FUERA_DE_HORARIO` fijo |
| `respuestaAPublicaciones` (`responder` \| `pasar_al_equipo`) | flujo | opción | regla fija del contrato (199 §1.6) |
| `mensajes.{derivar,fueraDeHorario,pedirBarrio,domicilioPendiente}` | flujo | 💬 literal | textos fijos del código (199 §4) |
| `politicaDeCancelacion` (citas) | negocio | 💬 literal | — |

Derivados de la configuración que ya existe (sin campo): el cierre de un
negocio SIN tabla de zonas dice "Total productos (sin domicilio)"; la frase
"espera el total con el domicilio" solo va donde el domicilio se cotiza aparte.

## Cambios en el prompt

- `meta()`: fuera el orden numerado; entra la meta + "lo que necesitas para
  cerrar" (productos y sus opciones, cómo lo recibe, datos de contacto y entrega,
  regalo si el negocio los hace) + la regla de agrupación por defecto.
- `CADENCIA` se reescribe sobre esa lista, sin puntos numerados.
- Las reglas propias pasan al FINAL del prompt: "mandan" de verdad.
- Primera línea del marco: fuera "español neutro, mensajes breves".

## Qué se hizo (26-sep-2026)

- **Ficha y validación:** los campos nuevos en `ficha.ts`, sus secciones
  (`leer-ficha.ts`) y los esquemas de las DOS rutas que guardan
  (`zod-no-descarta-campos-de-ficha` vigila `pago.porModalidad` y
  `pago.cuentaAntesDeConfirmar`).
- **Prompt:** `meta()` sin guion numerado ("Lo que necesitas para cerrar",
  armado desde la ficha por `loQueNecesitasParaCerrar`); `CADENCIA` como regla
  por defecto; `cierre()` y `fueraDeHorario()` según la ficha; reglas propias al
  final; publicaciones y política de cancelación.
- **Marco:** primera línea sin "español neutro / breves"; tono una sola vez;
  cuenta según `cuentaAntesDeConfirmar`; publicaciones: responder por defecto;
  "aún no abre" respeta `fueraDeHorario`.
- **Backend:** `consultar_medio_pago` con `tipo` (lo dice el MODELO) +
  `porModalidad` → respuesta con dato; cierre de negocios sin tabla: "Subtotal de
  productos + domicilio pendiente", sin "Total" falso; mensajes propios al
  derivar, al pedir el barrio y en el domicilio pendiente.
- **Interfaz:** 💬/🧠 en cada campo con burbuja de vista previa para lo literal,
  leyenda en cada paso, campos nuevos por vertical.
- **Migración (`scripts/migrar-ficha-200.ts`):** decisiones explícitas por
  negocio, citando la frase de origen; escribe ficha Y borrador (el borrador
  gana al mostrarse). En seco, resultado:
  - MALIA: pagos domicilio = transferencia; recoger = transferencia + efectivo.
  - Lis: pagos = transferencia; cuenta solo al confirmar (de su "nunca");
    "CÓMO ESCRIBES" pasa al trato; se quita la regla que repetía el enlace de
    Rappi; líneas vacías.
  - La Churra: pagos = transferencia; Rappi pasa a "otros canales".
  - Lashes: solo líneas vacías.

Verificación sin tokens: 274+ archivos de prueba, `tsc`, `lint`, `next build`.

## Pruebas de punta a punta y arreglos (26-sep-2026)

9 pedidos completos (3 por negocio: MALIA, Lis, La Churra) con el modelo real,
la ficha migrada EN MEMORIA (`FICHA_MIGRADA=1`, opción `fichaDePrueba` solo
para `isTest`) y la hora simulada en horario de atención (`AHORA`). Primera
corrida: 7/9 cerraron. Tres errores, con causa en código:

1. **Dos unidades del mismo producto con opciones distintas no se guardaban**
   (MALIA: "uno de milo y otro de maracuyá, sin toppings"). "Sin toppings" dicho
   una vez no decía a cuál línea iba → ambiguo → el lote (atómico, a propósito,
   feature 003) se descartaba entero → pedido con 0 productos → no cerraba.
   Arreglo en `operaciones.ts`: `declinar_grupo` ambiguo vale para todas las
   líneas que aún no tienen ese grupo; `elegir_opcion` ambiguo se resuelve solo
   si da igual (una sola línea la necesita, o las candidatas son idénticas).
   Si las líneas son distintas, se sigue preguntando. El lote sigue atómico.
2. **Un guardarraíl borraba la respuesta a la pregunta del cliente** (MALIA:
   "¿efectivo cuando llegue?"). `resumenMalArmado` tomaba "…dejamos tu pedido en
   firme" como un resumen vacío y lo reemplazaba por el resumen. Arreglo: si el
   resumen con total ya se mostró en el mensaje anterior y el mensaje no anuncia
   uno nuevo, no se toca; la corrección exige responder primero la pregunta.
3. **El regalo no tenía dónde guardarse** (quien recibe pisó el nombre del
   cliente en MALIA; lote inválido en Lis). Arreglo: `REQUISITOS_DE_REGALO`
   (`destinatario`, `telefonoDestinatario`, `mensajeTarjeta`), solo en negocios
   con `ficha.regalos` y solo pendientes si `paraRegalo` (decidido en el único
   punto central, `requisitoSatisfecho`). Se quitó la compuerta que rechazaba
   `marcar_regalo` leyendo palabras clave del cliente (doc 198): rechazó "es para
   mi mamá" y tumbó el lote. La instrucción del barrio pide guardar la dirección
   COMPLETA (se perdía la calle).

Además: el registro de un lote mal formado dice qué operación falló (tipo y
campos, sin valores personales).

## Orden de ejecución

1. Tipos y validación (ficha, secciones, rutas).
2. Generador y marco (prompt).
3. Backend: pagos por modalidad, cierre sin domicilio, mensajes literales.
4. Interfaz: marcas 💬/🧠, campos nuevos, pasos reorganizados.
5. Migración en seco → revisión del dueño → aplicar + regenerar.

Pruebas: sin gastar tokens (unitarias, tipos, build, regenerar en seco).
