# El generador de prompts: que un cliente nuevo nazca inmunizado

> **Dentro:** El problema · Las dos cosas que hoy viven mezcladas · Las tres
> piezas · Cómo se da de alta un cliente · Qué falta · Por qué no migra solo

**El techo de korex.ia nunca fue la máquina; es el alta.** Este documento
explica el cambio que convierte cada incidente en inmunidad para toda la flota,
en vez de un parche por cliente.

## El problema

Hoy el prompt de cada negocio se redacta a mano **copiando el de otro cliente y
adaptándolo** ([05-CLIENTES.md](05-CLIENTES.md)). Los errores y los arreglos se
propagan **por copia**: si el alta se copia del cliente equivocado, o quien la
hace no se acuerda de una lección, el fallo vuelve.

> **Lo planteó el dueño con la pregunta correcta**: *"si entra un cliente nuevo
> y vamos a arreglar error por error como con Lis, korex.ia no será escalable —
> será imposible con 10 clientes, todos enojados por cosas que ya sabíamos que
> iban a fallar."*

**Y el riesgo ya era real, no teórico**: La Churra **todavía tiene** la sección
`## Resumen y cierre` con las dos plantillas pegadas — exactamente lo que rompió
a Lis durante dos semanas (79 % de los pedidos sin datos de pago,
[44-BITACORA-12AGO.md](44-BITACORA-12AGO.md)). No ha fallado, pero está expuesta.

## Las dos cosas que hoy viven mezcladas

Dentro de un prompt hay dos naturalezas distintas, y solo una es única:

| | Ejemplo | ¿Única por cliente? |
|---|---|---|
| **Información** | Menú, precios, horario, quién paga el domicilio, tono | ✅ **Sí** |
| **Estructura y conducta** | Dónde va el resumen, que termina antes de la despedida, no anunciar lo que no hiciste | ❌ **No** |

El error de Lis no vino de copiar información ajena: vino de que **la estructura
se redactó a mano**. Mientras se siga redactando a mano, puede reaparecer en
cualquier cliente nuevo con otra cara.

## Las tres piezas

`src/server/ai/generador/`

| Archivo | Qué contiene |
|---|---|
| `ficha.ts` | El tipo `FichaDelNegocio`: **calco del cuestionario** que ya se le manda al cliente, sección por sección. Nada de estructura |
| `conducta.ts` | Las lecciones universales, escritas **una sola vez** |
| `generar.ts` | Ensambla ficha + conducta → el prompt del negocio |

**Lo que hay en `conducta.ts`** — cada línea es un incidente con fecha:

- **Los dos momentos del cierre** (12-ago, Lis): el resumen termina donde
  termina; la despedida y los datos de pago son otro mensaje.
- **No anunciar lo que no hiciste** (cierre falso 1-ago, cita fantasma 7-ago).
- **No dejar caer un producto ya pedido** (9-ago).
- **No inventar "el más vendido"** ni ningún dato duro.
- **Nunca confirmar un pago**: eso lo revisa una persona.
- **Atender varios mensajes seguidos** sin escalar por eso (5-ago).

> Relación con los guardarraíles ([38-GUARDARRAILES.md](38-GUARDARRAILES.md)):
> el prompt **pide** bien las cosas, el guardarraíl **comprueba el hecho** cuando
> el modelo no obedece. Se empieza siempre por el prompt.

### `faltantesDeLaFicha`: frenar antes de romper

Comprueba lo que no puede faltar **antes** del alta, no después:

- Aceptar transferencia **sin datos de cuenta** = un agente que cierra pedidos y
  no sabe cobrarlos.
- Domicilios **sin decir quién los paga** = discusión con el repartidor.
- Un negocio de pedidos **sin catálogo** no puede vender.

## Cómo se da de alta un cliente

```
Cuestionario (Word)  →  FichaDelNegocio  →  generarPerfil()  →  agent_profile
  lo que llena él      se transcribe        ensambla            instructions
                        tal cual                                escalationRules
                                                                greeting
```

El contenido es **100 % suyo**; no se copia de ningún otro negocio. Lo que ya no
hay que reescribir en cada alta son las lecciones: vienen de fábrica.

Y lo que de verdad cambia el juego: cuando aparezca un fallo nuevo, se corrige
en `conducta.ts` **una vez** y lo heredan los diez clientes a la vez.

## `reglasPropias`: el campo que salió de probar, no de diseñar

Al generar el prompt de Lis con el resto de la ficha salió de **4.913
caracteres frente a los 17.058** que tiene hoy. Parte de la diferencia era
grasa, pero parte no: eran reglas suyas acumuladas en semanas, sin sitio donde
ir.

- "Si el cliente dice que no le abre el enlace del menú, mándaselo escrito"
- "Las sodas y el café solo se venden en el punto; a domicilio solo agua"
- "Si da dos teléfonos, usa el primero y anota el otro"

**Un negocio de verdad siempre tiene un puñado de estas, y son justo las que lo
distinguen.** Sin ese campo, migrar un cliente vivo perdía lo mejor de él.

## Por qué no migra a Lis ni a La Churra

**A propósito.** El generador sirve para clientes nuevos **desde ya**; los dos
que facturan hoy se quedan como están hasta que:

1. Se llene su ficha completa (incluidas todas sus `reglasPropias`).
2. Se genere su prompt y se **compare** con el que tienen.
3. Se verifique contra el **pipeline real** (`pnpm probar:agente`) que ninguna
   conversación pierde nada.

Cambiar de golpe el prompt de dos negocios que están vendiendo, sin comparar,
sería repetir el error que se acaba de arreglar.

## Qué falta

- **Pantalla de alta** que lea la ficha y llame al generador: hoy la ficha se
  escribe en código. Es el paso que baja el alta de horas a minutos y cierra el
  punto 3 de [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md).
- **Importador de catálogo y KB** con verificación previa (mismo pendiente).
- **Migrar La Churra**, que arrastra el defecto estructural latente.
- **Conducta del vertical de citas**: hoy `meta()` distingue pedidos y citas,
  pero las lecciones propias de agendar (no ofrecer huecos que no existen, no
  dar por agendado lo que no se agendó) siguen apoyadas en el guardarraíl y en
  `CONTRATO_DE_ACCIONES_CITAS`, no en `conducta.ts`.
