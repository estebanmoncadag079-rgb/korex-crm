# Veinticuatro clientes contra el agente

> **Dentro:** Por qué no bastaba el Laboratorio · Los escenarios · Lo que
> encontró · Los falsos positivos, que también son fallos · Cómo se corre

14-ago-2026. *"No quiero que mañana me tengan que decir otra vez que el bot está
respondiendo mal."*

## Por qué no bastaba el Laboratorio

El Laboratorio corre **seis** guiones y los califica un **juez** (otro modelo).
Mide calidad y da un puntaje, pero cuesta, tarda, y su veredicto se puede
discutir — hoy mismo marcó en rojo a un agente que había hecho lo correcto.

`pnpm probar:escenarios` es lo complementario: **muchos** clientes y unas pocas
comprobaciones **objetivas**, de las que no admiten opinión. Si el agente dio el
número de cuenta antes de que el cliente confirmara, eso es un fallo y no hay
nada que interpretar.

## Los escenarios

24 conversaciones contra el agente REAL (`is_test`: nunca toca WhatsApp, y el
aviso al equipo se simula). No son casos de laboratorio, son los que llegan un
sábado por la tarde:

| | |
|---|---|
| Pedido completo a domicilio · para recoger · regalo con tarjeta | El camino feliz, en sus tres formas |
| Insiste en pagar en efectivo · pide los datos de pago antes de confirmar | Las dos reglas de dinero |
| "¿Cuál es la más pedida?" · pide algo que no venden | Lo que no puede inventar |
| No le abre el enlace del menú | El plan B, que es una regla suya |
| Quiere entrega en el apartamento · pide una soda a domicilio | Las dos restricciones que más discusiones causan |
| Alergias · reclamo · descuento · torta personalizada · estado de un pedido | Lo que **no** resuelve solo |
| Manda todos los datos juntos · cambia de opinión · escribe con modismos | Cómo escribe la gente de verdad |
| Confirma sin haber pedido nada · pregunta el total a mitad | Los dos que rompieron el agente esta semana |
| Proveedor que ofrece sus servicios · solo saluda · pide un humano | Los bordes |

## Lo que encontró (primera corrida: 4 fallas)

**Dos reales, y los dos se arreglaron para toda la flota:**

1. **"Es uno de los favoritos de nuestros clientes."** El agente recomendaba
   bien —sin atribuirlo a las ventas— y lo estropeaba en el remate. La conducta
   universal ya lo prohibía; ahora prohíbe también la coletilla.
2. **Le preguntan el total y no lo da.** *"¿Cuánto es el total?"* → *"solo
   necesito que me confirmes el topping"*. El topping no cambia el precio. El
   prompt de Lis ya se lo prohibía y lo hizo igual, así que pasó a ser
   **guardarraíl** — y eso importa: los guardarraíles llegan a los clientes que
   todavía no están migrados al generador. La conducta, no.

## Los falsos positivos, que también son fallos

Dos de las cuatro "fallas" eran del banco de pruebas, y arreglarlas es tan
importante como lo otro: **un reporte que miente se deja de leer.**

- **"Se quedó mudo" en el reclamo.** El agente había derivado a una persona, y
  después de un handoff callarse es lo que debe hacer. Ahora se comprueba si la
  conversación quedó derivada antes de marcar silencio.
- **"Aceptó efectivo".** La regla buscaba "claro… efectivo" y marcó en rojo un
  rechazo perfecto: *"¡Claro que sí! Entiendo tu preferencia. Como el domicilio
  va por Yango, solo aceptamos transferencia."* Una muletilla de cortesía no es
  un sí.

**Segunda corrida: 24 de 24 en verde.**

## Cómo se corre

```
pnpm probar:escenarios <organizationId>            # los 24
pnpm probar:escenarios <organizationId> efectivo   # solo los que casen
```

Deja `escenarios-reporte.json` con la transcripción de cada conversación, para
poder releer exactamente qué se dijo.

> Añadir un escenario es añadir un objeto a la lista de `probar-escenarios.ts`:
> el guion del cliente y, si hace falta, qué debe y qué no debe decir el agente.
> **Cada queja que llegue de un cliente debería acabar aquí como escenario**, que
> es la única forma de que no vuelva.
