# Cómo cotizarle a un cliente

> **Dentro:** Lo primero: se COBRA por conversación, pero se PAGA por mensaje · Usa el cotizador, no esta tabla · Cuánto cuesta de verdad — y por qué NO es "por conversación" · El cuadro de paquetes · Por qué el precio NO sale del costo · Ejemplo completo: el cliente de las 30 personas al día · Y después

Hecho el **1-ago-2026** con costos **medidos**, no estimados. TRM 3.206 COP/USD.

## Lo primero: se COBRA por conversación, pero se PAGA por mensaje

Esas dos cosas no son la misma y confundirlas es lo que hace cotizar mal.

- **Al cliente se le vende por conversación** ("hasta 750 al mes"), porque es
  lo único que él entiende y puede comprobar.
- **A los proveedores se les paga por mensaje.** Cada respuesta del bot cuesta
  IA y cuesta WhatsApp.

Por eso hay que preguntar **las dos cosas**: cuántas personas le escriben, y
cuántos mensajes le toma atender a cada una.

⚠ Y ojo con lo que dice el cliente: si dice *"me llegan 30 clientes nuevos al
día"*, eso NO son 30 conversaciones — faltan los que vuelven. En La Churra y Lis
los recurrentes son **un tercio más**: 30 nuevos/día ≈ **40 conversaciones/día**.

## ⚡ Usa el cotizador, no esta tabla

En **/admin → Cotizador** está la calculadora con todas las variables. Esta
tabla es solo el punto de partida: en cuanto el cliente cierre sus ventas en
más o menos mensajes que los tuyos, las cifras cambian y hay que recalcular.

## Cuánto cuesta de verdad — y por qué NO es "por conversación"

Aquí estaba el error de la primera versión de este documento. Se cobraba "por
conversación", como si todos los negocios fueran iguales. **No lo son.**

Lo que se paga no es la conversación: es **cada respuesta**. Una pastelería que
cierra en 8 mensajes y una inmobiliaria que necesita 20 cuestan **más del doble**
una que otra, aunque tengan exactamente los mismos clientes.

Ya se nota entre los dos clientes actuales: **La Churra manda 6,7 mensajes por
conversación y Lis 8,3** — un 24 % de diferencia entre dos negocios que además
se parecen bastante.

| Concepto | Cuánto | De dónde sale |
|---|---|---|
| **IA (OpenRouter), por respuesta** | **0,0020 USD** | Medido sobre 38 llamadas reales: La Churra 0,00197, Lis 0,00202 |
| **WhatsApp (Meta), por mensaje** | **0,0008 USD** | Desde el 1-oct-2026 |
| **Suma, por mensaje del bot** | **0,0028 USD** | ≈ **9 pesos** |

Que los dos clientes den casi el mismo costo por respuesta **no es casualidad**:
lo que domina es el prompt del sistema, que se manda entero en cada turno y pesa
mucho más que lo que se hablan cliente y agente. Por eso una conversación larga
no sale más cara *por respuesta* — sale más cara porque tiene más respuestas.

**La cuenta rápida**: mensajes del bot × 9 pesos. Una conversación de 8 mensajes
cuesta 72 pesos; una de 20, 180.

> **Antes del 1-oct-2026 se paga menos.** Hoy las respuestas dentro de la ventana
> de 24 h son gratis, así que solo corren los 0,0020 de IA. Todo este documento
> calcula **con el precio de octubre**, para no llevarse una sorpresa.

### El otro costo: el servidor

El VPS son **30 USD al mes** y no depende de cuántos clientes haya — se reparte
entre todos. Ahí está la trampa de tener pocos:

| Clientes en el VPS | El servidor cuesta, por cliente |
|---|---|
| 2 (hoy) | 15,00 USD |
| 5 | 6,00 USD |
| 10 | 3,00 USD |
| 20 | 1,50 USD |

**Con 2 clientes, el servidor cuesta más que la IA y WhatsApp juntos.** Cada
cliente nuevo casi no añade costo pero sí reparte el fijo: por eso el negocio
mejora solo al crecer. Los cuadros de abajo usan el escenario de **5 clientes**,
que es lo realista a corto plazo.

## El cuadro de paquetes

**Calculado con 8 mensajes del bot por conversación** y el servidor repartido
entre 5 clientes. Si el negocio necesita más mensajes, recalcula en el
cotizador — con 16 el costo variable se dobla.

| Plan | Conversaciones/día | Tope al mes | IA | WhatsApp | Servidor | **Tu costo** | **Precio** | **Te queda** | Margen |
|---|---|---|---|---|---|---|---|---|---|
| **Arranque** | hasta 10 | 300 | 4,80 | 1,92 | 6,00 | **12,72** | **62 USD**<br>200.000 COP | 49,28 USD | 79 % |
| **Crecimiento** | 10 a 25 | 750 | 12,00 | 4,80 | 6,00 | **22,80** | **109 USD**<br>350.000 COP | 86,20 USD | 79 % |
| **Pro** | 25 a 50 | 1.500 | 24,00 | 9,60 | 6,00 | **39,60** | **187 USD**<br>600.000 COP | 147,40 USD | 79 % |
| **Alto** | 50 a 100 | 3.000 | 48,00 | 19,20 | 6,00 | **73,20** | **296 USD**<br>950.000 COP | 222,80 USD | 75 % |

*(Todo en USD salvo donde diga COP. Los precios en pesos son redondos a
propósito: el cliente paga en pesos y una cifra rara resta confianza.)*

**Pasarse del tope**: bloque de 250 conversaciones extra = **20 USD** (64.000
COP). Cuesta 5,60 USD, así que deja 72 % de margen. Poner el bloque en el
contrato desde el principio evita la conversación incómoda a mitad de mes.

> **El margen real ronda el 75-80 %, no el 90 %.** La primera versión de esta
> tabla daba 87 % porque calculaba con el costo medio *por conversación* de hoy
> —donde el bot solo responde unas 3 veces y el resto lo atiende una persona—.
> Cuando el bot lleva la conversación entero, que es lo que se vende, el costo
> es más alto. 79 % sigue siendo un negocio excelente; creerse el 90 % era la
> forma de acabar cobrando poco.

## Por qué el precio NO sale del costo

Esta es la parte que más se malinterpreta, así que va despacio.

El plan Pro cuesta unos 40 USD y se vende en 187. Alguien podría decir *"le
estás cobrando casi cinco veces lo que te cuesta"*. **Y estaría mirando el número
equivocado.**

Lo que el cliente compra no es electricidad ni tokens. Compra **que alguien
conteste su WhatsApp a las 11 de la noche**. Compara contra lo que hoy le
cuesta eso:

| Cómo atiende su WhatsApp | Lo que le cuesta al mes |
|---|---|
| Una persona a jornada completa | **≈ 905 USD** (salario mínimo 2026 de 1.750.905 COP + auxilio + prestaciones ≈ 2.900.000 COP) |
| Media jornada | ≈ 452 USD |
| **korex.ia, plan Pro** | **187 USD** |

**El plan Pro cuesta la quinta parte de una persona, y no duerme, no se
enferma, no renuncia y contesta los domingos.** Ese es el argumento de venta, no
el costo de los tokens.

La regla sana: **cobra entre el 15 % y el 25 % de lo que le ahorras o le
recuperas.** Si el bot le salva 3 pedidos al mes de 50.000 COP que se habrían
perdido por no contestar a tiempo, ya se pagó solo.

## Ejemplo completo: el cliente de las 30 personas al día

> *"Me escriben 30 clientes nuevos al día."*

**Paso 1 — traducir a conversaciones.** 30 nuevos × 30 días = 900 nuevas. Más
los que repiten (un tercio más) = **1.170 conversaciones al mes ≈ 39 al día**.

**Paso 2 — elegir el plan.** 39/día cae en **Pro** (25 a 50, tope 1.500). Tiene
holgura para los picos.

**Paso 3 — el costo.** (con 8 mensajes del bot por conversación)

| | USD | COP |
|---|---|---|
| IA — 9.360 respuestas | 18,72 | 60.000 |
| WhatsApp — 9.360 mensajes | 7,49 | 24.000 |
| Servidor (1 de 5 clientes) | 6,00 | 19.200 |
| **Costo total** | **32,21** | **103.300** |

**Paso 4 — el precio.** Plan Pro: **187 USD (600.000 COP)**.

**Paso 5 — lo que queda.** 187 − 32,21 = **154,79 USD al mes (496.000 COP)** por
ese solo cliente. Margen 83 %.

**Paso 6 — cómo se lo explicas.** *"Hoy alguien te dedica medio día a contestar
WhatsApp: eso son unos 1.450.000 al mes. Esto son 600.000, contesta las 24
horas, no se enferma y no se le pasa ningún mensaje."*

## Y después

- **[15-VENDER.md](15-VENDER.md)** — qué preguntarle al cliente, cómo se cobra
  el marketing y los errores que salen caros.
- **/admin → Cotizador** — la calculadora, con los promedios reales de tus
  clientes ya cargados.
