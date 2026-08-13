# Afinar el prompt de un cliente vivo

> **Dentro:** Por qué existe · La receta · La regla que no se salta · Por qué
> La Churra no se migró · Qué falta para poder migrarla

Un prompt no se termina el día del alta: se afina con lo que pasa en las
conversaciones reales. Este documento es la receta para hacerlo **sin romper un
negocio que está facturando**.

## Los accesos

El asistente puede leer y editar los prompts directamente:

```
SSH al VPS            root@2.25.159.117  (clave churrabot_key)
Base de datos         docker exec korex-crm-postgres-1 psql -U postgres -d vocero
Probar sin enviar     docker exec <contenedor-crm> node /app/pa.mjs <orgId> "msg"…
```

> 💡 **No hace falta la contraseña del CRM para esto.** El prompt vive en la
> base y se toca por SSH; la cuenta web solo sirve para ver las pantallas. Se
> puede cambiar la contraseña sin perder esta capacidad.

## La receta (los cinco pasos, en orden)

### 1. Respaldar SIEMPRE, antes de tocar nada

```sql
create table agent_profile_bk_<cliente>_<fecha> as
select * from agent_profile where organization_id='<orgId>';
```

Cuesta un segundo y es lo único que permite volver atrás. Ya hay 14 tablas así
en la base; **eso es una virtud, no un descuido**.

### 2. Cambiar el prompt

Por SQL, o generándolo desde una ficha
([45-GENERADOR-DE-PROMPTS.md](45-GENERADOR-DE-PROMPTS.md)). Es cambio de
**datos**: tiene efecto inmediato, sin desplegar nada.

### 3. Probar contra el pipeline real

```bash
node /app/pa.mjs <orgId> "hola" "quiero una besties" "arequipe y chocolate" …
```

Usa una conversación `is_test`: **nunca toca WhatsApp**. Hay que recorrer el
flujo COMPLETO hasta el cierre, no solo el saludo — los fallos caros viven al
final (el resumen que no sale, el `notify_order` que no se emite).

### 4. Comparar, no confiar

Si se toca un cliente que ya funciona, hay que probar **el mismo pedido** con el
prompt viejo y con el nuevo, y compararlos. "Parece mejor" no vale.

### 5. Restaurar si no mejoró

```sql
update agent_profile a set instructions=b.instructions, greeting=b.greeting,
  tone=b.tone, escalation_rules=b.escalation_rules
from agent_profile_bk_<cliente>_<fecha> b
where a.organization_id=b.organization_id;
```

## La regla que no se salta

> **Un cambio en el prompt de un cliente vivo no se da por bueno hasta haberlo
> ejecutado contra el modelo.**

No es celo excesivo: el 13-ago, tres fallos distintos (el campo `label` de las
fotos, el contrato de acciones incompleto y el resumen que se saltaba)
**pasaron el typecheck y las 482 pruebas** y solo aparecieron ejecutando el
pipeline. El código no puede ver lo que el modelo va a hacer con un texto.

## Por qué La Churra NO se migró al generador (13-ago-2026)

Se intentó, con la receta de arriba. La ficha capturó **toda** su información
—saludo de marca, preguntas en MAYÚSCULAS, salsas con emojis, cuenta bancaria,
las 14 reglas propias— y el prompt generado quedó en 9.923 caracteres frente a
los 11.168 del suyo.

Pero al probar **el mismo pedido en los dos**:

| | Prompt actual (a mano) | Generado |
|---|---|---|
| Detecta que ya dio la dirección | ✅ | ❌ vuelve a preguntar |
| **Muestra el resumen** | ✅ completo, con viñetas y total | ❌ **se lo salta** |
| Emite `notify_order` | ✅ | ✅ |
| Saludo y formato de marca | ✅ | ✅ |

**El generado falla justo en lo más caro**, y con las reglas de cierre ya
escritas en `conducta.ts` — las mismas que media hora antes, en un prompt más
corto, sí se habían cumplido.

**La causa: dilución.** Con 14 reglas propias, el prompt llegó a 9.923
caracteres y las reglas de cierre quedaron sepultadas entre tanto detalle.

**Decisión: La Churra se queda como está.** Cambiar algo que funciona por algo
que se salta el resumen es repetir el error que costó dos semanas en Lis.

## Qué falta para poder migrarla

1. **Que las reglas de cierre no se diluyan.** Lo último de un prompt pesa más:
   moverlas al final, o repetirlas allí como ya hace `estadoDelNegocio` (que se
   escribe dos veces a propósito, ver `prompts.ts`).
2. **Avisar cuando el prompt crece demasiado.** Por encima de cierto tamaño, o
   de cierto número de `reglasPropias`, la probabilidad de que se ignore una
   regla sube.
3. **Repetir la comparación** con el mismo pedido antes de aplicar nada.

Mientras tanto, el generador **sí sirve para clientes nuevos**: ahí no hay nada
mejor con lo que compararlo, las lecciones vienen puestas desde el día uno, y el
prompt nace corto — que es justo cuando las reglas se cumplen.
