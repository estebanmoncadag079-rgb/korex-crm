# No niegues lo que no sabes

> **Dentro:** La venta perdida · Por qué NO es un guardarraíl · Por qué la regla
> va corta · El dato de Rappi · Lo que apareció al regenerar la flota · Cómo
> revertir

**20 de agosto de 2026.** Una clienta preguntó por Rappi y el agente contestó:

> *"En Lis Pastelería no manejamos domicilios por Rappi, pero sí te lo podemos
> enviar por Yango."*

**Nadie le había dicho eso nunca. Y el negocio sí tiene Rappi.** Venta perdida
por inventar un NO.

---

## Dos problemas, no uno

**1. El dato no existía.** Lis tenía 28 entradas de conocimiento y ninguna
mencionaba Rappi.

**2. El agente no dijo "no sé", dijo "no tenemos".** Trató la ausencia en su
conocimiento como prueba de que la cosa no existe. Eso no es un problema de Lis:
mañana es un método de pago, un producto o un horario especial, en cualquier
negocio.

## La asimetría que el proyecto ya había encontrado — en el otro vertical

`conducta.ts` tenía la mitad positiva desde siempre:

> *Nunca inventes datos duros… si no están en tu conocimiento, no te los
> imagines.*

Y le faltaba la simétrica. **Es exactamente lo mismo que pasó con las citas**: el
guardarraíl 9 cubría *"afirmar disponibilidad sin verificar"* y hubo que
completarlo con *"negarla sin verificar"*
([109](109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md)). La lección estaba aprendida;
solo se había aplicado a un sitio.

## Por qué aquí NO cabe un guardarraíl

En citas sí cabía, y por un motivo concreto: **el servidor puede comprobar una
agenda**. Sabe si esa hora estaba libre, así que puede cazar al modelo negándola.

Aquí no puede. El servidor no tiene forma de saber si un negocio tiene Rappi, un
convenio o un horario especial que nadie declaró. **La ausencia de un dato no
prueba nada**, y un guardarraíl que intentara adivinarlo confundiría un "no"
legítimo —«no aceptamos efectivo», que sí está declarado— con uno inventado.

Tampoco lo resuelven los datos: no se puede declarar exhaustivamente todo lo que
un negocio **no** tiene.

Por eso vive en la conducta. Es una regla de honestidad epistémica, no de
verificación: **"no sé" no es "no existe"**.

## La regla, y por qué va corta

```
- Nunca digas que algo NO existe solo porque no está en tu conocimiento. Que
  tú no lo sepas y que el negocio no lo tenga son cosas distintas. Si tu
  conocimiento DECLARA que algo no se hace, dilo con seguridad; si el tema
  sencillamente no aparece, di que lo confirmas con el equipo o pasa la
  conversación — nunca lo conviertas en un "no".
```

**350 caracteres.** La primera versión ocupaba **718**, con la anécdota dentro. El
prompt lo lee el modelo en cada turno de cada negocio, así que el relato se movió
al comentario del código, donde lo lee quien mantiene esto — regla 14 de la
Fase 2: *«¿este cambio reduce la dependencia del prompt de 18.000 caracteres?»*.

La distinción del medio no es adorno: sin ella, el agente se volvería tibio con
los "no" que **sí** están declarados y que debe decir con seguridad.

### Verificado

```
CLIENTE: ¿tienen convenio con alguna empresa para eventos corporativos?
→ acción: handoff        (antes habría inventado un "no")
```

---

## El dato: Rappi, como configuración

Una entrada de **conocimiento** (`kb_entry`, `origen: cliente`) — no una regla en
el código, no un campo nuevo, no una excepción:

```
P: ¿Hacen domicilios por Rappi? ¿Están en Rappi?
R: Sí. Además de nuestro domicilio propio por Yango, puedes pedir por Rappi
   aquí: https://rappi.app.link/... — si el cliente pregunta por Rappi o por
   apps de domicilio, envíale ese enlace.
```

Es el mecanismo que ya existía, disponible para cualquier negocio, y **el dueño
puede editarlo él mismo** desde "Ajustar mi agente" (por eso `origen: cliente` y
no `operador`: con `operador` le quedaría bloqueado).

**Efecto inmediato, sin desplegar**: el conocimiento se lee en cada turno, no va
horneado en el prompt.

```
CLIENTE: Había visto que tenían domicilio por rappi pero no me sale
AGENTE:  Sí, también estamos en Rappi 🛵 Te dejo el enlace directo para que
         puedas hacer tu pedido: https://rappi.app.link/...
```

---

## 🔑 Lo que apareció al regenerar la flota

Para que los tres heredaran la regla hubo que regenerar sus prompts, y ahí se vio
que **los tres arrastraban lecciones sin aplicar**. No era ruido: eran arreglos
escritos días antes que nunca habían llegado a los clientes.

| Negocio | Además de la regla | Qué le faltaba |
|---|---|---|
| Lis Pastelería | — | nada (se regeneró el 20-ago) |
| **La Churra** | +927 car. | Las reglas de **varias cosas a la vez** ([89](89-EL-CONTRATO-DE-LOS-ITEMS.md), [90](90-LA-CONDUCTA-EN-PLURAL.md)): *"apúntalas TODAS"*, *"cada cosa lleva sus propias opciones"* |
| **Lashes Valen** | +535 car. | El arreglo del **pago al confirmar una cita** ([107](107-PAGO-ANTES-DE-LA-CITA.md)) — seguía con el texto que causó aquel incidente |

> ⚠️ **Escribir la lección en `conducta.ts` no la entrega.** Vive en el prompt de
> cada negocio, y ahí solo llega al regenerar. Lashes Valen llevaba desde el
> 19-ago con un bug ya corregido en el código y no en su agente.
>
> Merece un hábito: **después de tocar `conducta.ts`, regenerar la flota** — o
> saber a ciencia cierta a quién se le debe una lección.

---

## Pruebas

| | |
|---|---|
| typecheck · lint | limpio |
| Pruebas unitarias | 930, 0 fallos |
| Conversación real: Rappi | ✅ manda el enlace |
| Conversación real: tema desconocido | ✅ handoff, no inventa un "no" |
| Regeneración | Los 3, con respaldo en `agent_profile_bk_regen_20260820` |

## Cómo revertir

```bash
git revert <commit>                       # la regla
# y los prompts, desde agent_profile_bk_regen_20260820
```

El dato de Rappi se borra desde la propia pantalla del cliente, o con un `DELETE`
de esa fila de `kb_entry`. Los tres pasos son independientes.

---

## Lo que queda propuesto y sin hacer

Que el cuestionario del alta **pregunte** por las apps de domicilio, guardándolo
como pregunta frecuente —que ya siembra el conocimiento—: sin campo nuevo en la
ficha, sin pantalla nueva, sin tocar el prompt.

Hoy Lis lo olvidó porque nadie se lo preguntó. Es lo que evitaría que el próximo
negocio lo olvide igual. **Pendiente de decisión del dueño**, junto con el
segundo defecto del cuestionario ([117](117-EL-CUESTIONARIO-VEIA-VACIO.md)).
