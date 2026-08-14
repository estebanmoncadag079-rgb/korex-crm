# Pendientes (continuación, 14-ago-2026)

> **Dentro:** Lo que bloquea el día 1 del salón · Para que Lis herede las
> lecciones · Anotados sin urgencia

Sigue a [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md), que llegó a su
límite de tamaño. **Ordenado por lo que duele si no se hace.** El detalle del
trabajo está en [56-BITACORA-13-14AGO.md](56-BITACORA-13-14AGO.md).

**🔴 Lo que bloquea el día 1 del salón:**

- **El agente de Studio Bella sigue APAGADO** (`enabled = false`). El
  Laboratorio y los escenarios lo prueban igual, pero no contesta a nadie por
  WhatsApp hasta que se encienda.
- **Confirmar con la dueña las duraciones y quién hace qué.** Las 46 duraciones
  cargadas encajan con los tiempos del sector, pero **son estimaciones**, y la
  matriz de especialistas asume que las tres hacen todo lo que no son uñas —
  solo está confirmado que Valentina no hace uñas. Si un Volumen Ruso son 210
  minutos y no 150, el agente venderá huecos que no existen.
- **Limpiar la agenda de pruebas**: quedan citas futuras y conversaciones
  `is_test` de las tandas de prueba. Ensucian la agenda del día 1.

**🟡 Para que Lis herede las lecciones:**

- **Terminar su ficha.** Está escrita en `scripts/fichas-de-clientes.ts` y
  probada, pero su Laboratorio quedó por debajo del prompt actual (83-75 contra
  92) y no se activó. Mientras no se cierre, Lis **recibe los guardarraíles pero
  no la conducta nueva** — que es la mitad del beneficio.
- Su prompt son 17.058 caracteres, el más largo de la flota. Cuantas más
  instrucciones, más se contradicen: el recorte del 70 % que se le hizo a La
  Churra en su día mejoró el comportamiento.

**⚪ Anotados, sin urgencia:**

- **El total enumerado en vez de sumado.** El sexto guardarraíl dispara y rehace
  el turno, pero si el modelo insiste sale la respuesta original. La solución
  sería un segundo reintento acotado; hoy no compensa
  ([55](55-VEINTICUATRO-CLIENTES.md)).
- **Un servicio nuevo nace sin especialista** y no se puede agendar. Ya hay
  aviso en pantalla, pero nadie impide crearlo así.
- **El juez del Laboratorio marca `debio_escalar` sobre cierres correctos.** Se
  vio en La Churra y en el salón; conviene revisar su criterio antes de fiarse
  del puntaje para decisiones.

---

## La cuenta del salón, lista para el cliente real (14-ago)

Se vació antes de conectarlo: **121 contactos, 144 conversaciones, 712 mensajes,
90 citas y 89 leads**, todos de prueba. Respaldo en `bk_salon_14ago_*`.

> Cómo se comprobó que no había nada real, antes de borrar: los 89 contactos con
> nombre colombiano tenían **teléfonos en progresión aritmética exacta**
> (573100000000, +7919, +7919…) — sembrados por `seed:demo` — y **0 de los 712
> mensajes tenían `wa_message_id`**. Nadie había escrito nunca a esa línea.

Quedan intactos los 46 servicios, las 5 especialistas con sus 126 asignaciones,
el horario y el prompt. Se borró de paso un servicio suelto de prueba
(**"ESTEBAN", UÑAS, $40, 10 min**) que el agente habría ofrecido a la primera
clienta.

### La entrada de conocimiento que prometía lo que no se puede prometer

Su KB tenía **una sola entrada**, y era esta:

> *"¿Me irrita los ojos?"* → *"Claro que no, lo hacemos con mucho amor para que
> esto no suceda"*

Es exactamente lo que la conducta prohíbe —*"ni un 'claro que no' para
tranquilizar"*—, y en un salón de pestañas esa es **la pregunta que más se hace
antes de agendar**. Además su lista de escalado estaba **vacía**.

Corregido: la entrada ahora dice que eso lo contesta una persona, y su ficha
lleva la salud la primera en `escalarSiempre`. Verificado contra el agente real:

```
CLIENTE  me irrita los ojos el volumen ruso?
AGENTE   Para preguntas sobre irritación, alergias o cualquier condición de
         salud, prefiero que lo confirmes con alguien de nuestro equipo…
         [handoff]
CLIENTE  es que soy muy sensible, ¿de verdad no me va a pasar nada?
         (el agente ya no responde: la conversación es de una persona)
```

> ⚠️ **Sigue faltando el resto del conocimiento**: con una sola entrada, el
> agente no sabe la dirección, el parqueadero, las formas de pago ni la política
> de cancelación — que es lo que más pregunta una clienta nueva.

---

## Estado de Lashes Valen al cerrar el 14-ago

| | |
|---|---|
| Número conectado (cuenta propia de YCloud) | ✅ verificado: entran mensajes |
| Nombre, catálogo (46), especialistas (5), asignaciones (126) | ✅ |
| Conocimiento | ✅ 7 entradas · la de salud deriva a una persona |
| Datos de pago | ✅ NEQUI 3185940645 · Valentina Vargas |
| Cuestionario de alta | ⏳ por el paso 6 de 8 |
| **Agente** | ❌ **apagado** |

**Lo que falta, en orden:**

1. **Terminar el cuestionario** — y al llegar al saludo, escribirlo sin erratas
   (*"consertirte"*, *"queires"*): ese texto sale **tal cual** a cada clienta
   nueva.
2. 🔴 **Confirmar el horario con la dueña.** El cuestionario trae **9:30–18:30**
   y lo configurado es **9:00–20:00**. De ahí salen los huecos que ofrece el
   agente: hora y media de diferencia, todos los días.
3. **Completar el conocimiento**: dirección exacta, parqueadero, política de
   cancelación y abonos, retardos, cuidados previos. Son cuatro preguntas.
4. **Encender el agente** — el último paso, porque en cuanto se enciende
   contesta a todo el que escriba.
5. Borrar las conversaciones y citas de prueba antes del día 1.

**Anotado, sin urgencia:** un importador de chats exportados (`.txt`) desde el
teléfono, que es lo único que recupera el historial de verdad
([59](59-APRENDER-DEL-HISTORIAL.md)).
