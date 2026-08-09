# Marketing y contenido: cómo se promociona korex.ia

> **Dentro:** Por qué esto vive en el repo · ⚠️ Qué se puede prometer y qué no ·
> El guion base de 45 segundos · Los ganchos que funcionan y por qué · Cómo se
> produce gratis · La regla que no se salta nunca · El agente que escribe esto

Empezado el **9-ago-2026**, a petición del dueño: *"el éxito también viene
acompañado de un buen marketing"*.

Complementa [15-VENDER.md](15-VENDER.md) y [14-COTIZAR.md](14-COTIZAR.md), que
cubren el momento en que ya hay un cliente delante. **Esto es el escalón
anterior: que te conozcan.**

## Por qué esto vive en el repo y no en una carpeta de diseño

Porque el contenido promete cosas del producto, **y el producto cambia**. Cada
vez que se toca lo que el agente sabe hacer, hay que volver aquí. Un guion que
promete algo que el cliente después no encuentra no es marketing: es una
devolución y un cliente quemado.

## ⚠️ Qué se puede prometer y qué no

**La tabla más importante de este archivo.** Actualízala cuando cambie el
producto.

| Promesa | ¿Se puede decir? |
|---|---|
| Contesta al instante, a cualquier hora | ✅ |
| Toma el pedido completo (qué, cuántos, cuándo, dónde) | ✅ |
| Entiende notas de voz | ✅ las convierte a texto |
| Guarda los comprobantes de pago | ✅ **pero NO digas "confirma tu pago"** |
| Pasa la conversación a una persona | ✅ |
| Mismo número, mismo WhatsApp de siempre | ✅ es coexistencia, la usan La Churra y Lis |
| Ves quién compró y a quién se le enfría el interés | ✅ desde el 9-ago |
| Agenda citas | ⚠️ solo si el negocio lo tiene activado — no prometerlo en general |
| Verifica que el pago sea válido | ❌ **eso lo revisa el equipo del negocio** |
| Entiende reacciones y stickers | ❌ hoy no los ve ([24](24-MENSAJES-UNSUPPORTED.md)) |

## El guion base de 45 segundos

Formato vertical (Reels, TikTok, estados). El eje es **el cliente que escribe de
noche**, y no es un invento publicitario: en las conversaciones reales hay
mensajes a las 00:42 y a la 01:13.

1. **(0-4s)** Cuarto oscuro, un celular se ilumina, nadie lo toma. *"Once de la noche. Alguien quiere comprarte."*
2. **(4-9s)** Amanece, la dueña ve el mensaje. *"Tú estabas durmiendo. Y cuando contestas… ya compró en otro lado."*
3. **(9-13s)** El mismo mensaje, ahora con respuesta al instante. *"Con korex.ia, eso no vuelve a pasar."*
4. **(13-22s)** El pedido armándose solo. *"Contesta al momento, a cualquier hora. Y toma el pedido completo."*
5. **(22-30s)** Nota de voz convertida en texto; una foto de transferencia. *"Si te mandan una nota de voz, la entiende. Si te mandan el comprobante, lo guarda. Y si alguien necesita hablar contigo, te pasa la conversación."*
6. **(30-36s)** La dueña tranquila en su local. *"Tú sigues con el mismo WhatsApp de siempre. El mismo número."*
7. **(36-42s)** Un tablero llenándose solo. *"Por primera vez ves quién te compró… y a quién se le está enfriando el interés."*
8. **(42-45s)** Logo. *"Tu negocio atendiendo, aunque tú estés durmiendo."*

**Voz**: cercana, de alguien que conoce el negocio. Nada de locutor.
**Música**: suave y creciente, con corte seco en la escena 3.

**Variante de 20 s** para pauta: *"¿Cuántas ventas perdiste esta semana por no
contestar a tiempo? / Tus clientes escriben de noche, en domingo, mientras
atiendes a otro. / korex.ia contesta por ti, toma el pedido y te lo deja listo. /
Sin cambiar tu número. Sin aprender nada nuevo."*

## Los ganchos que funcionan, y por qué

Los tres salen de **datos reales**, que es exactamente lo que los hace fuertes:

| Gancho | De dónde sale |
|---|---|
| *"Casi la mitad de tus ventas son invisibles"* | El tablero decía 16 clientes cuando había 31 ([37](37-EMBUDO-VENTAS-INVISIBLES.md)) |
| *"Tu WhatsApp tiene 40 conversaciones. ¿Cuántas son ventas?"* | 68 tarjetas abiertas, 49 llevaban más de 2 días sin respuesta |
| *"Contesta en 5 segundos. Aunque sean las 2 de la mañana"* | Mensajes reales de madrugada en producción |

**La regla**: el número exacto convence, el redondo suena a folleto. "23 de 68"
pesa más que "más del 30 %".

## Cómo se produce gratis (verificado 9-ago-2026)

| Pieza | Herramienta | Plan gratis |
|---|---|---|
| Clips generados | **Kling** | 66 créditos diarios, sin marca de agua. Un clip de 5 s gasta 20-30 → 2-3 al día |
| Alternativas | Luma Dream Machine · Pika · Magic Hour | Magic Hour da 400 créditos que no caducan |
| Voz en off | **ElevenLabs** | 10.000 caracteres/mes (el guion entero son ~700). **Voz latina, no peninsular** |
| Montaje | **CapCut** | Gratis, vertical, subtítulos automáticos, y su propio texto a voz |

**El orden que ahorra tiempo**: grabar pantallas → generar la voz (así sabes la
duración real) → pedir los clips con los créditos de cada día → montar al final.

**No generes con IA lo que puedes grabar.** El chat y el tablero salen mejor con
captura de pantalla real: es más creíble, no gasta créditos y enseña el producto
de verdad. Deja la IA para lo que no se puede grabar (la noche, la dueña
despertando).

## 🔴 La regla que no se salta nunca

**Ninguna conversación real de clientes sale en pantalla.** Hoy hay chats reales
de La Churra y Lis con nombres y números de teléfono de personas.

Para grabar, usar el **Laboratorio** o un negocio de prueba con datos
inventados. Un teléfono real en un video promocional es un problema serio con el
cliente y con la ley de datos personales, y no se arregla borrando el video
después.

## El agente que escribe esto

Existe un agente especializado: **`marketing-viral-ugc`**
(`C:\Users\USUARIO\.claude\agents\marketing-viral-ugc.md`). Entrega siempre la
misma estructura — guion principal, variante corta, ganchos alternativos,
guiones UGC con notas de actuación, CTAs escalados, brief para la creadora y la
tabla de promesas.

Lleva dentro una **lista negra de palabras que huelen a IA** (*descubre,
transforma tu negocio, potencia, no esperes más*…) y la instrucción de leer esta
carpeta antes de afirmar nada del producto. Si el contenido que produce empieza a
sonar a folleto, el problema está en esa lista: amplíala.
