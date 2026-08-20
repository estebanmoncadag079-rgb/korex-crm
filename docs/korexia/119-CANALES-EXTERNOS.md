# Canales externos: dónde más te pueden pedir

> **Dentro:** La raíz real · El agujero que apareció auditando · Por qué un
> campo y no conocimiento · Por qué fuera de `entrega` · La prueba que se
> autoexige · Cómo revertir

**20 de agosto de 2026.** Continuación de
[118](118-NO-NIEGUES-LO-QUE-NO-SABES.md), donde un agente negó una app de
domicilios que su negocio sí tenía. Aquello se tapó con conocimiento y una regla
de conducta. Esto es la raíz.

---

## La raíz no era que faltara el dato

El cuestionario del alta tiene ocho pasos —negocio, horario, lo que vendes, cómo
lo reciben, cómo te pagan, fotos, cómo habla, cuándo llamarte— y **ninguno
pregunta por canales externos**. `preguntasFrecuentes` existe en el tipo de la
ficha pero **ninguna pantalla lo llena**.

El negocio no lo olvidó: **nunca se lo preguntaron**. Con el conocimiento como
única vía, el siguiente cliente lo olvidaría igual, y nos enteraríamos cuando
perdiera una venta.

> Un dato que el cuestionario no pide es un dato que el agente no va a tener.

## Y auditándolo apareció un agujero peor

`generar.ts` — un negocio que no reparte por su cuenta tenía escrito en su prompt:

> **No hay domicilios.** Si alguien lo pide, dilo con naturalidad y ofrécele
> recoger.

Un negocio que **no reparte pero sí está en una app** tendría a su agente
negando el domicilio **con total seguridad**, y esta vez no por ignorancia: **su
propia ficha se lo estaría diciendo**.

La regla de conducta del 118 no lo salva. Ahí le dijimos que los "no"
**declarados** los diga con confianza — y este lo está. Es el mismo fallo,
causado por el modelo de datos en vez de por su ausencia.

Ese agujero es lo que convirtió esto de "estaría bien" en "hay que hacerlo".

---

## El modelo

```ts
export type CanalExterno = {
  nombre: string;    // "Rappi", "nuestra tienda web"
  enlace?: string;   // sin él, el agente solo lo menciona
};

// en la ficha:
canales?: CanalExterno[];
```

### Por qué un campo y no conocimiento

Este proyecto castiga los campos que solo se recitan, así que la pregunta iba en
serio. La respuesta: **no solo se recita**. Cambia una afirmación que el prompt
hoy hace mal. Un dato que solo se lee en voz alta es conocimiento; uno que
**corrige lo que el sistema afirma** es estructura.

### Por qué FUERA de `entrega`

Para una pastelería, una app de domicilios es una forma de recibir el pedido.
Para un salón, agendar por otra plataforma **no es ninguna "entrega"**. Colgarlo
de `entrega` lo habría dejado inservible para la mitad de la flota — y el bloque
del prompt se renderiza sin filtrar por vertical, por lo mismo.

### Qué hace el agente con ellos

```
## También nos pueden pedir por aquí
- **Rappi**: https://…

Si preguntan por alguno, confírmalo y pásale el enlace tal cual. No lo ofrezcas
por tu cuenta si puedes cerrar el pedido aquí mismo.
```

La segunda frase importa: el agente **no** debe empujar a nadie fuera de
WhatsApp, donde puede cerrar la venta él. Solo tiene que dejar de negarlos.

---

## Lo que se tocó

| Archivo | Qué |
|---|---|
| `generador/ficha.ts` | `CanalExterno` y el campo `canales` |
| `generador/leer-ficha.ts` | `canales` a la sección `negocio` — sin dueño se perdería al guardar |
| `generador/generar.ts` | El bloque nuevo, y el "No hay domicilios" que deja de negar |
| `onboarding-wizard.tsx` | La pregunta, en el paso *"Cómo reciben lo que piden"* |
| `api/onboarding/route.ts` | El esquema — sin declararlo, el envío lo tiraría en silencio |

**No se tocó**: el pipeline, las acciones, el estado, los cinco consumidores de
requisitos, ni nada de un negocio concreto.

### Cómo se escribe en el cuestionario

Uno por línea, y el nombre se separa del enlace **por donde empieza el `http`**
— sin pedirle a nadie que aprenda un separador. `Rappi — https://…`,
`Rappi: https://…` y `Rappi https://…` dan lo mismo.

---

## 🔑 La prueba que ahora se autoexige

Al añadir `canales` pasó justo lo que el guardarraíl del
[114](114-LA-FICHA-NUEVA-NACE-POR-SECCIONES.md) existía para evitar: el campo
nació **sin sección asignada**, y así se habría perdido al guardar.

**Y la prueba siguió en verde**, porque su ficha de ejemplo no incluía el campo
nuevo: dependía de que alguien recordara actualizarla.

Se cerró tipando esa ficha como `Required<FichaDelNegocio>`: **si mañana alguien
añade un campo y no lo pone ahí, no compila**. El guardarraíl dejó de depender de
la memoria de nadie.

---

## Migración del dato de Lis

Su enlace de Rappi vivía como conocimiento (del 118). Ahora vive en `canales`, y
**la entrada de conocimiento se borró**: tenerlo en dos sitios es exactamente la
doble fuente que este proyecto lleva semanas quitando.

```
CLIENTE: Había visto que tenían domicilio por rappi pero no me sale
AGENTE:  Sí, también nos puedes encontrar en Rappi 🛵 Aquí te dejo el enlace:
         https://rappi.app.link/…
```

Verificado **después** de borrar el conocimiento: la respuesta sale de la ficha.

## Pruebas

`tests/unit/canales-externos.test.ts` — 7 comprobaciones: sin canales no se nota
que existe · con canales salen con su enlace · un canal sin enlace no se lo
inventa · **si no reparte pero tiene canal, deja de negar el domicilio** · el
domicilio propio no cambia · un negocio de citas también los muestra · y que no
empuja al cliente fuera de WhatsApp.

| | |
|---|---|
| typecheck · lint | limpio |
| Pruebas unitarias | **937**, 0 fallos (7 nuevas) |
| `probar:estado` | 46/46 |
| Conversación real | ✅ arriba |

## Cómo revertir

```bash
git revert <commit>
# y la ficha de Lis, desde agent_profile_bk_canales
```

El campo es opcional: revertir el código deja `canales` sin leer y el resto de
la ficha intacto. Ningún otro negocio tiene canales declarados, así que a nadie
más le cambia nada.
