# Cómo cotizarle a un cliente

Hecho el **1-ago-2026** con costos **medidos**, no estimados. TRM 3.206 COP/USD.

## Lo primero: la unidad es la CONVERSACIÓN

No se cobra por cliente, ni por mensaje, ni por pedido: por **conversación**.
Una conversación es una persona que escribe y a la que el bot atiende hasta que
termina. Es la única unidad que se puede medir y que crece igual que el costo.

⚠ **Cuidado con lo que dice el cliente.** Si dice *"me llegan 30 clientes
nuevos al día"*, eso NO son 30 conversaciones: faltan los que ya le habían
escrito y vuelven. En La Churra y Lis los que repiten son **alrededor de un
tercio más**. Así que 30 nuevos/día ≈ **40 conversaciones/día**.

## Cuánto cuesta de verdad una conversación

Medido sobre 26 conversaciones reales de La Churra y Lis (tabla `usage_event`
para la IA, mensajes salientes contados en la base):

| Concepto | Por conversación | De dónde sale |
|---|---|---|
| **IA (OpenRouter)** | **0,0059 USD** | Medido. `gemini-2.5-flash`, todo el gasto real que factura OpenRouter: respuestas, transcripción de audios y lectura de fotos |
| **WhatsApp (Meta)** | **0,0058 USD** | 7,2 mensajes salientes por conversación (medido) × 0,0008 USD |
| **TOTAL** | **0,0117 USD** | ≈ **38 pesos** |

Es decir: **atender a una persona cuesta 38 pesos.** Menos que un dulce.

> **Antes del 1-oct-2026 la mitad de eso no se paga.** Hoy las respuestas dentro
> de la ventana de 24 h son gratis, así que una conversación cuesta solo los
> 0,0059 de IA. Todo este documento calcula **con el precio de octubre**, para
> no llevarse una sorpresa.

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

| Plan | Conversaciones/día | Tope al mes | IA | WhatsApp | Servidor | **Tu costo** | **Precio** | **Te queda** | Margen |
|---|---|---|---|---|---|---|---|---|---|
| **Arranque** | hasta 10 | 300 | 1,77 | 1,74 | 6,00 | **9,51** | **62 USD**<br>200.000 COP | 52,49 USD | 85 % |
| **Crecimiento** | 10 a 25 | 750 | 4,43 | 4,35 | 6,00 | **14,78** | **109 USD**<br>350.000 COP | 94,22 USD | 86 % |
| **Pro** | 25 a 50 | 1.500 | 8,85 | 8,70 | 6,00 | **23,55** | **187 USD**<br>600.000 COP | 163,45 USD | 87 % |
| **Alto** | 50 a 100 | 3.000 | 17,70 | 17,40 | 6,00 | **41,10** | **296 USD**<br>950.000 COP | 254,90 USD | 86 % |

*(Todo en USD salvo donde diga COP. Los precios en pesos son redondos a
propósito: el cliente paga en pesos y una cifra rara resta confianza.)*

**Pasarse del tope**: bloque de 250 conversaciones extra = **15 USD** (48.000
COP). Cuesta 2,93 USD, así que sigue dando 80 % de margen. Poner el bloque en el
contrato desde el principio evita la conversación incómoda a mitad de mes.

## Por qué el precio NO sale del costo

Esta es la parte que más se malinterpreta, así que va despacio.

El plan Pro cuesta 23,55 USD y se vende en 187. Alguien podría decir *"le estás
cobrando ocho veces lo que te cuesta"*. **Y estaría mirando el número
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

## Qué preguntarle al cliente

Dos bloques. El primero fija **el plan**; el segundo fija **el precio**.

### Bloque 1 — para saber qué plan le toca

1. **¿Cuántas personas distintas te escriben al día por WhatsApp?** (no cuántas
   compran: cuántas escriben)
2. **De esas, ¿cuántas son nuevas y cuántas ya te habían escrito antes?**
3. **¿Cuál es tu día más pesado y cuántos te escriben ese día?** — el plan se
   elige por el pico, no por el promedio, o se pasará de tope todos los meses.
4. **¿Mandas promociones a tu lista de clientes? ¿A cuántos y cuántas veces al
   mes?** ⚠ **La pregunta más importante del cuestionario.** Ver la sección de
   abajo.
5. **¿Tienes temporadas fuertes?** (diciembre, madres, amor y amistad)

### Bloque 2 — para saber cuánto cobrarle

6. **¿Cuánto vale un pedido promedio tuyo?**
7. **¿Cuántos pedidos cierras al día?**
8. **¿Quién contesta hoy el WhatsApp y cuántas horas le dedica?** — aquí sale el
   número con el que vas a comparar tu precio.
9. **¿Cuántos mensajes crees que se te quedan sin contestar?** (de noche, cuando
   hay fila, los domingos)
10. **En hora pico, ¿cuánto tardas en responder?**

Las preguntas 8, 9 y 10 son las que justifican el precio. Si contesta *"a veces
respondo al otro día"*, ahí está la venta: **cada mensaje sin contestar es un
pedido que se fue a otro lado.**

## ⚠ El marketing va SIEMPRE aparte

Es el único punto donde se puede perder dinero, y hay que decirlo en la primera
reunión.

| Tipo de mensaje | Costo por mensaje |
|---|---|
| Conversación normal (responder a quien escribe) | 0,0008 USD |
| **Promoción / plantilla de marketing** | **0,0125 USD** — **15 veces más** |

Una campaña a 1.000 contactos cuesta **12,50 USD**. Una a 5.000 cuesta **62,50
USD**, que es el plan Arranque entero. **Si el marketing entra en la
mensualidad, un cliente que mande dos campañas te deja sin margen.**

**Cómo cobrarlo**: aparte, por campaña. Costo × 2,5. Una campaña de 1.000
contactos → **30 USD** (96.000 COP). Se cotiza antes de enviarla y se aprueba.

## Ejemplo completo: el cliente de las 30 personas al día

> *"Me escriben 30 clientes nuevos al día."*

**Paso 1 — traducir a conversaciones.** 30 nuevos × 30 días = 900 nuevas. Más
los que repiten (un tercio más) = **1.170 conversaciones al mes ≈ 39 al día**.

**Paso 2 — elegir el plan.** 39/día cae en **Pro** (25 a 50, tope 1.500). Tiene
holgura para los picos.

**Paso 3 — el costo.**

| | USD | COP |
|---|---|---|
| IA (OpenRouter) | 6,90 | 22.100 |
| WhatsApp (8.424 mensajes) | 6,74 | 21.600 |
| Servidor (1 de 5 clientes) | 6,00 | 19.200 |
| **Costo total** | **19,64** | **63.000** |

**Paso 4 — el precio.** Plan Pro: **187 USD (600.000 COP)**.

**Paso 5 — lo que queda.** 187 − 19,64 = **167,36 USD al mes (536.000 COP)** por
ese solo cliente. Margen 89 %.

**Paso 6 — cómo se lo explicas.** *"Hoy alguien te dedica medio día a contestar
WhatsApp: eso son unos 1.450.000 al mes. Esto son 600.000, contesta las 24
horas, no se enferma y no se le pasa ningún mensaje."*

## Errores que hay que evitar

1. **Cobrar por costo.** El costo es 19 USD; si cobras 40 "porque es barato",
   regalaste el trabajo y encima el cliente valorará menos el servicio.
2. **Prometer "mensajes ilimitados".** El tope protege de un cliente que
   dispara el volumen. Sin tope, el riesgo es tuyo y es infinito.
3. **Meter el marketing en el plan.** El error caro. Va aparte, siempre.
4. **Elegir el plan por el promedio.** Se elige por el día más pesado.
5. **Olvidar que el servidor es fijo.** Con 2 clientes pesa 15 USD cada uno;
   con 10, un dólar y medio. Vender el tercer cliente mejora el margen de los
   dos que ya están.

## Lo que hay que revisar antes del 1-oct-2026

- **La tarifa de Meta.** Los 0,0008 USD son del rate card de abril-2026. Meta
  publica las definitivas antes del 1-sep-2026: **volver a mirarlas entonces**.
- **Los 7,2 mensajes por conversación.** Es una medición sobre 26
  conversaciones. Con más historia el número se afina, y cada mensaje de más
  sube el costo un 14 %.
- **El costo real de WhatsApp por cliente**, cuando se procesen los estados de
  YCloud (punto 13 de [08-PENDIENTES.md](08-PENDIENTES.md)). Hoy se cuentan los
  mensajes pero se anotan a 0, que es correcto **solo hasta octubre**.
