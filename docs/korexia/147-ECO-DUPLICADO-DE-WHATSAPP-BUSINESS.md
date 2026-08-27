# 147 — Un saludo duplicado que no lo mandó el bot (Lashes Valen)

26-ago-2026.

## El reporte

Esteban vio, en el inbox de Lashes Valen, una conversación con Luisa donde
el mismo saludo salía **dos veces seguidas**, y preguntó por qué — y, en la
misma captura, por qué otra conversación había derivado a una persona.
Eran dos preguntas sobre dos incidentes distintos, investigados con datos
reales (mensajes, `wa_message_id`, logs), sin tocar código: este documento
es el diagnóstico, no una corrección — no había nada que corregir del lado
de Vocero.

## El saludo duplicado: no lo generó la IA

Los tres mensajes salientes de esa conversación, con sus timestamps y
metadatos reales:

```
21:50:29.748  IN   "Buenas tardes / Una consulta ustedes hacen uñas con esmalte normal?"
21:50:33.602  OUT  "💗 ¡Hola hermosa 🌸! Bienvenida a Lashes Valen Studio. Para agilizar
                     tu atención, cuéntanos en un solo mensaje: [...]"
                     wa_message_id=...A50A56CA72D470854227948D3D4615BD  ai_generated=false
21:50:33.940  OUT  (el mismo texto, byte por byte — doble espacio incluido)
                     wa_message_id=...A5212EFBF98FBA1C73336B70D411C0DB  ai_generated=false
21:50:38.399  OUT  "¡Hola, hermosa! [...] Sí, claro, manejamos el servicio de uñas
                     Tradicionales por $20.000 [...]"
                     ai_generated=true
```

Los dos primeros mensajes tienen `ai_generated=false` y cada uno su propio
`wa_message_id` **real y distinto** — dos envíos de verdad, no un problema
de la pantalla. Ese texto no está en ninguna configuración de Vocero:
ni en `ficha.flujo.saludoInicial`, ni en `agent_profile.greeting`, ni en
ningún archivo del código. Es un evento `whatsapp.smb.message.echoes` —el
tipo que YCloud manda cuando alguien envía un mensaje **directo desde la
app de WhatsApp Business** del negocio, el modo "coexistencia" (app +
API oficial a la vez) que usa Lashes Valen. Es, casi con certeza, el
"Mensaje de bienvenida" que se configura dentro de la propia app de
WhatsApp Business — algo ajeno a Vocero y fuera de su control, que se
disparó dos veces (por qué exactamente, no es diagnosticable desde aquí:
un doble toque, una reconexión de sesión, o el propio mecanismo de la app).

El tercer mensaje (el que responde el precio real) sí es de la IA. El
`[ms_modelo]` real de esa conversación fue **7,2 segundos** — el turno ya
estaba en curso, generando esa respuesta, desde antes de que llegaran los
dos ecos (a los 3,85 s y 4,19 s de iniciado el turno). `runAgentTurn` solo
revisa el estado de la conversación **al principio** del turno, así que un
eco que llega a mitad de camino no lo interrumpe — el turno termina y
entrega su respuesta con normalidad. No hay ningún riesgo de que el bot
"pise" lo que escribió el equipo: solo puede pasar si el eco llega
mientras el modelo ya estaba respondiendo la pregunta anterior, y el
mensaje del bot y el del equipo dicen cosas compatibles la enorme mayoría
de las veces (aquí ninguno contradijo al otro).

**Recomendación** (no es un cambio de Vocero): revisar en la app de
WhatsApp Business de Lashes Valen si tiene un "Mensaje de bienvenida"
activo y, si es así, desactivarlo — ese es el origen real, no el bot.

## El handoff en la otra conversación: causa correcta

"Retiro de acrílicas" sí escaló (`handoff_reason='modelo'`), pero por un
motivo legítimo, sin relación con lo anterior. La clienta pidió dos citas
—una para ella (pestañas + uñas), otra para su amiga (retiro de pestañas +
uñas)— con especialistas **distintas** por servicio (pestañas: Valentina o
Hilary; uñas: Geimar). El bot ya le había explicado que, al ser
especialistas distintas, los servicios se agendan uno seguido del otro. La
clienta insistió: *"pero me puedes hacer anteriormente me hacias cejas y
uñas a la misma vez"* — una pregunta sobre la capacidad REAL del salón (¿se
puede atender dos servicios en paralelo con dos especialistas?) que el bot
no puede resolver con certeza (depende de espacio físico y disponibilidad
real, no de una regla que ya tenga). Derivar a una persona ahí es la
decisión correcta: no había ningún dato que el bot pudiera verificar para
responder solo.

## Lo que no se investigó (fuera de alcance de este reporte)

Por qué la app de WhatsApp Business mandó el mensaje dos veces: es un
comportamiento de la app del negocio, no algo que Vocero pueda observar ni
corregir desde su lado.
