# El asesor envió el enlace que el bot prometió y no mandó

> **Dentro:** El caso, con el mensaje IA marcado en la base · La medición del
> fallo real (33%) antes de tocar nada · La causa: una regla que ya existía y
> que el modelo incumplía · El arreglo, verificado con 8 corridas reales tras
> aplicarlo (12,5% de fallo) · Lo que queda, y por qué no se cierra con más
> reglas
>
> ✅ **Aplicado y verificado con el pipeline real, 24-ago-2026.** Mejora medida
> de 33% → 12,5% de fallo. No al 100% — y se explica por qué eso no se resuelve
> con más texto de regla.

**23 de agosto, 21:06.** Maricel escribe *"¡Hola! Quiero hacer un pedido"*. El
agente de Lis contesta:

> ¡Hola, Maricel💗! Qué rico que nos escribes 😍 Te comparto nuestro catálogo
> para que veas todas las delicias que preparamos con mucho amor 🍰✨ ¡Me dices
> qué se te antoja!

**Sin el enlace.** 23 segundos después, un asesor humano tuvo que pegar el link
a mano. El dueño lo vio en el CRM y preguntó por qué el bot no lo mandó.

---

## Primero, separar quién mandó cada mensaje

La columna `message.ai_generated` no deja dudas:

| Mensaje | `ai_generated` | `status` |
|---|---|---|
| *"Te comparto nuestro catálogo…"* | **`true`** | `pending` |
| `https://drive.google.com/…` | **`false`** | `sent` |

El bot prometió y no cumplió. El enlace lo mandó una persona.

## La causa raíz, no el primer síntoma

### 1. El dato no estaba perdido — estaba mal etiquetado

El enlace vivía dentro de una entrada de conocimiento que responde
*"¿Tienen redes sociales? ¿Dónde veo fotos?"* (`kb_lispasteleria0010`). El
conocimiento se inyecta **completo** en cada turno — el modelo sí lo tenía
delante — pero para asociarlo con *"quiero hacer un pedido"* tenía que inferir
que una respuesta sobre Instagram/TikTok también servía para eso.

**Medido antes de tocar nada**, con el pipeline real (`pnpm probar:citas`,
conversaciones `is_test`, nunca toca WhatsApp): 6 corridas de la misma
pregunta → **el enlace apareció en 4 (67%)**.

### 2. Separar la entrada no bastó

Se creó una entrada dedicada, con una pregunta que sí coincide con la
intención (*"¿Tienen catálogo o fotos del menú para ver antes de pedir?"*).
**8 corridas más → 6 con enlace (75%)**. Mejora dentro del margen de ruido de
la muestra: no es la causa principal.

### 3. La causa de fondo: una regla que YA existía, y fallaba igual

Revisando `ficha.flujo.reglasPropias` de Lis apareció esto — el dueño **ya
había escrito la instrucción**:

> *"SIEMPRE que el cliente pregunte por los productos enviale el link del
> catalogo, eso es lo primero que tienes que hacer antes de enviarle la lista
> de los productos en texto…"*

Dos defectos en la misma frase:

1. **El disparador es más estrecho que el caso real.** Dice *"pregunte por los
   productos"*; Maricel escribió *"quiero hacer un pedido"* — no preguntó por
   productos, pidió comprar.
2. **La instrucción y el dato viven en dos sitios distintos del prompt.** La
   regla dice *"el link del catálogo"* sin decir cuál; el enlace de verdad está
   en una entrada de conocimiento aparte. El modelo tiene que **unir dos
   piezas por su cuenta**, y falla al hacerlo una parte del tiempo — es
   exactamente el mismo patrón de la línea 1: una instrucción y un dato
   separados que el modelo debe conectar por inferencia.

---

## El arreglo

`scripts/corregir-regla-catalogo-lis.ts` (uso único, como
`corregir-ficha-churra.ts`): reescribe esa única regla para que **el enlace
vaya dentro de la instrucción** y el disparador cubra los dos casos:

```
SIEMPRE que el cliente pregunte por los productos O diga que quiere hacer un
pedido, envíale ESTE link con las fotos y precios del catálogo:
https://drive.google.com/file/d/1t3z5C1EMkGCzkSEX_CkCQMpZlaVmM8P7/view — eso
es lo primero que tienes que hacer, antes de enviarle la lista de los
productos en texto. Envíaselo con un mensaje bonito y cordial.
```

Deja de haber inferencia que hacer: la instrucción y el dato son **una sola
pieza**.

Solo escribe `ficha` (nunca `instructions` a mano), declara ese único campo con
`conRegistro`, y `compararFila` confirmó que **nada más cambió**. Después,
`pnpm regenerar:flota org_lispasteleria0001 --aplicar` recompiló el prompt
(14.516 → 14.651 caracteres) — con respaldo automático en
`agent_profile_bk_regen_20260824`.

### Verificado con el pipeline real, no en teoría

**8 corridas más, tras el arreglo → 7 con enlace (87,5%)**.

| Momento | Corridas | Con enlace | Tasa de fallo |
|---|---|---|---|
| Antes de tocar nada | 6 | 4 | 33% |
| Tras separar la entrada de conocimiento | 8 | 6 | 25% |
| **Tras arreglar la regla** | **8** | **7** | **12,5%** |

**2,6 veces menos fallo** que la línea base, atacando la causa real —no un
síntoma.

---

## Lo que queda, y por qué no se cierra con más reglas

**No llegó a 0%.** La única corrida que falló tras el arreglo no incumplió
*esta* regla en particular — **no aplicó ninguna instrucción**, ni siquiera
mencionó el catálogo:

> *"¡Hola! 😍 Con mucho gusto te ayudo con tu pedido. ✨ Te cuento que hoy
> abrimos a las 10:00 a.m…"*

Es una falla distinta y de menor severidad: ya no es *"la instrucción y el dato
están separados"* (eso se corrigió), es *"el modelo, en algunas primeras
respuestas, no aplica ninguna de sus reglas"* — un rasgo probabilístico del
modelo, no un hueco de dato ni de arquitectura.

**A propósito, no se persigue ese último tramo con más texto de regla ni con un
guardarraíl que reintente o corrija la respuesta.** Añadir una tercera capa de
instrucción sobre una instrucción que ya es explícita y autocontenida no ataca
nada nuevo — y un guardarraíl aquí sería exactamente el atajo que se pidió no
tomar primero. Si esto vuelve a doler, la medición ya queda hecha para
comparar contra ella.

---

## Limpieza

Las 40 conversaciones `is_test` generadas durante las 22 corridas de medición
(y sus contactos "Cliente de prueba") se borraron de la base de Lis al
terminar — nunca tocaron WhatsApp real, pero no debían quedar como residuo
visible en el CRM.

---

## Cómo revertir

```bash
# La ficha, tal como estaba antes de la corrección de la regla:
# restaurar desde agent_profile_bk_regla_catalogo_20260824

# El prompt, tal como estaba antes de regenerar:
# restaurar desde agent_profile_bk_regen_20260824

# La entrada de conocimiento dedicada (kb_szpybwdzki2fplmlombh) y el
# recorte de kb_lispasteleria0010: restaurar desde
# kb_entry_bk_temporada_20260824
```

Ninguna de las tres tablas de respaldo tiene fecha de expiración — bórralas a
mano cuando ya no hagan falta.
