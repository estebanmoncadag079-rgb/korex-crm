# Historial del 12 de agosto de 2026

> **Dentro:** El día en una línea · 1. El dominio suspendido · 2. SEO y Google ·
> 3. El bot de Lis: la cadena que lo rompía · Lo que queda

**Un día con dos incidentes de fondo, y los dos llevaban tiempo activos sin que
nadie los viera.** El primero tumbó el servicio 23 horas; el segundo llevaba
dos semanas costando pedidos y le había hecho perder la confianza a una clienta.

## El día en una línea

Ninguno de los dos problemas estaba donde parecía: el primero **fuera del
servidor** (el dominio), el segundo **en el prompt y no en el modelo**.

---

## 1. El dominio suspendido — 23 h sin servicio

Hostinger suspendió `korexia.online` por la verificación de ICANN. Detalle
completo en [42-DOMINIO-SUSPENDIDO.md](42-DOMINIO-SUSPENDIDO.md).

Lo que importa recordar:

- **El monitor no avisó, y hacía bien**: todo lo que vigilaba estaba sano
  (contenedor `healthy`, base en pie, cola vacía, cero errores). El fallo estaba
  **entre internet y el servidor**, el único tramo que nadie miraba.
- Se le añadió un **chequeo externo**: nameservers, DNS, HTTPS, certificado y
  vencimiento del dominio.
- Al instalarlo se descubrió que **los nodos de Google DNS se contradicen entre
  sí** durante una propagación. Sin protección, el monitor habría gritado y se
  habría desdicho cada 15 minutos. Se exige que **dos resolvedores coincidan**
  (Google y Cloudflare); si discrepan, no alerta.
- Los mensajes de esas 23 h **se perdieron** (YCloud reintenta ~6 h), pero **no
  para el negocio**: con coexistencia llegaron igual al WhatsApp del celular.

## 2. SEO y Google

Detalle en [43-SEO-Y-GOOGLE.md](43-SEO-Y-GOOGLE.md). El titular: **el sitio
tenía `Disallow: /` y le prohibía a Google entrar**. Se sustituyó por un robots
dinámico que abre la portada y mantiene el CRM invisible, más sitemap,
metadatos y `canonical`. Propiedad verificada en Search Console (DNS) y perfil
de empresa creado.

## 3. El bot de Lis: la cadena que lo rompía

El dueño reportó dos fallos sueltos. Al medirlos aparecieron **19**.

### Lo que se reportó

1. *"El bot no envió la parte de que el domicilio se paga al llegar"* — **falso
   positivo**. Se comprobó contra la base: el bot **sí la mandaba, completa**.
   La captura del reporte estaba cortada. Pero el reporte tenía razón de fondo:
   esa línea iba en `_cursiva_`, que WhatsApp pinta más tenue, justo en el dato
   que no puede pasar desapercibido. **No faltaba, no se veía.**
2. *"Confirmó el pedido pero nunca envió la descripción"* — **fallo real**. El
   agente escribió "Aquí tienes el resumen de tu pedido" y no escribió ninguno:
   sin productos, sin total. La clienta confirmó a ciegas.
3. *"No envió los medios de pago"* — **fallo real, y el más caro**.

### Lo que apareció al medir

| Sobre 24 resúmenes reales de Lis | Casos | % |
|---|---|---|
| Pide confirmar **y se despide** en el mismo mensaje | 19 | **79 %** |
| Anuncia un resumen y no escribe ninguno | 3 | 12 % |
| La Churra (otro prompt) | 0 de 12 | 0 % |

### La cadena

```
Las dos plantillas del prompt, pegadas en la misma sección
        ↓
El agente se despide ANTES de que el cliente confirme
        ↓
Al "confirmo" NO manda los datos de pago
        ↓
La dueña los escribe a mano desde el celular
        ↓
Escribir desde el celular activa el relevo humano
        ↓
El relevo SILENCIA al agente 2 horas
        ↓
La dueña acaba atendiendo todo → "este bot no sirve"
```

Medido en 14 días: el equipo de Lis escribió el **65,6 %** de las respuestas (La
Churra, 47,6 %) y hubo relevo humano en **53 de 77** conversaciones. Lo técnico
estaba sano: **cero turnos fallidos** en la cola. No era infraestructura, era
conducta.

### La causa raíz: el prompt, no el modelo

La sección `## Resumen y cierre` metía **las dos plantillas** —la de antes de
confirmar y la de después— una detrás de otra, separadas por un párrafo. El
modelo las leía como un bloque y las concatenaba, quedándose con los extremos y
**saltándose el cuerpo, que es justo donde están los datos de pago**.

Se partieron en `MOMENTO 1` y `MOMENTO 2` con un corte explícito
(`🛑 AQUÍ TERMINA EL MENSAJE`). Es cambio de datos: **efecto inmediato, sin
desplegar**. Verificado contra el pipeline real dos veces (antes y después del
despliegue): el resumen acaba donde debe y los datos de pago salen tras la
confirmación.

De paso, la regla del domicilio pasó de cursiva a **negrita**, con el hecho
clave al principio.

### El cuarto guardarraíl

`resumenMalArmado`, en [38-GUARDARRAILES.md](38-GUARDARRAILES.md). Es la **red**,
no el arreglo: si el prompt cumple, no salta nunca. Se añadió igualmente porque
el fallo llevaba dos semanas costando pedidos y la clienta ya había perdido la
confianza.

> 🔑 **La lección, que no tenían los otros tres guardarraíles**: antes de dar
> por perdido el prompt, hay que **leer cómo está escrito**. Aquí la regla
> estaba bien redactada pero **mal colocada**. Se arregló el prompt y el fallo
> desapareció.

### Y una que no era del bot

Se planteó cambiar de modelo (a un "GPT 5.3 chat" recomendado en un video).
Se verificó en OpenRouter: **ese modelo no existe**; lo único con 5.3 es
`gpt-5.3-codex`, de código, a **5,8× el precio** del `gemini-2.5-flash` actual.

Cambiar de modelo no habría arreglado nada —**el prompt roto lo hereda
cualquier modelo**— y habría multiplicado el costo por seis. Se decidió no
tocarlo. Regla que queda: **el modelo es lo último que se toca, no lo primero.**

## Lo que queda

- 🔴 **Cambiar la contraseña del superadmin.** Sigue siendo el pendiente más
  viejo ([36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md), punto 1) y hoy
  además se compartió por chat.
- **Medir en 2-3 días** si el fallo del resumen bajó a cero:
  ```sql
  SELECT date(created_at) dia, ref, count(*) FROM usage_event
  WHERE ref LIKE '%/resumen-%' AND created_at > now() - interval '7 days'
  GROUP BY 1,2 ORDER BY 1;
  ```
  Sin filas = el prompt basta y el guardarraíl no ha tenido que actuar.
- **Reseñas del perfil de empresa**, logo y foto de portada.
- **Versionar `monitor-bots-alerta.sh`**: sigue viviendo solo en `/root` y los
  respaldos no cubren esa carpeta. Ofrecido y **aplazado por el dueño**.
