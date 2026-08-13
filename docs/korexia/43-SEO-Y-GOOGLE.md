# Que a korex.ia la encuentren en Google (12-ago-2026)

> **Dentro:** El bloqueo que nadie vio · El robots dinámico · Sitemap y
> metadatos · Search Console · El perfil de empresa · La cuenta de
> demostración · Qué falta

Punto de partida: **el sitio le prohibía a Google entrar**, y nadie lo sabía.

## El bloqueo que nadie vio

`public/robots.txt` traía dos líneas heredadas de Vocero CRM:

```
User-agent: *
Disallow: /
```

Eso es "Google, no indexes nada". Correcto para un CRM privado, **letal para la
portada**: `korexia.online` no podía aparecer en ninguna búsqueda, por buena que
fuera la web. Verificar la propiedad o mandar el sitemap no habría servido de
nada mientras ese archivo estuviera así.

Y había un segundo problema: **una sola aplicación sirve dos sitios**
(`korexia.online` y `crm.korexia.online`), así que un archivo estático no puede
abrir uno sin abrir el otro.

## El robots dinámico

`src/app/robots.ts` contesta distinto según la cabecera `Host`:

| Dominio | Respuesta |
|---|---|
| `korexia.online` · `www.` | `Allow: /` + rutas del CRM prohibidas + Sitemap |
| `crm.korexia.online` | `Disallow: /` — la aplicación sigue invisible |
| Cualquier otro host | `Disallow: /` — **cierra por defecto** |

Ese tercer caso importa: el día que un cliente use su propio dominio, queda
protegido sin que nadie se acuerde de configurarlo.

⚠️ **`public/robots.txt` se borró, y hay que vigilar que no vuelva.** Los
archivos de `public/` ganan a las rutas de la aplicación: mientras existiera,
`robots.ts` no se ejecutaba. En el despliegue se comprobó que el archivo viejo
**seguía en la carpeta de EasyPanel** (`tar -xzf` extrae encima pero **no borra
lo eliminado**) y hubo que borrarlo a mano. Sin ese paso, el despliegue habría
salido "correcto" y el sitio seguiría bloqueado.

## Sitemap y metadatos

- `src/app/sitemap.ts` — hoy una sola entrada, la portada. Se deja montado para
  cuando haya más contenido.
- Metadatos SEO en `src/app/page.tsx`, **no en el layout raíz**: aquel lo
  comparten la landing y el CRM, y saca el nombre de `getBranding()` (la marca
  white-label del cliente), así que su título no sirve para un sitio público.
- **`canonical` es lo que resuelve el contenido duplicado**: la misma aplicación
  responde en los dos dominios y, sin esa línea, Google ve dos sitios idénticos
  y reparte la autoridad entre ambos.

Ganancia visible desde el primer día: al compartir `korexia.online` por
WhatsApp ahora sale con título y descripción propios, no con el genérico "CRM
de WhatsApp".

## Search Console

Verificado como **propiedad de dominio** (no "prefijo de URL"), con un registro
**TXT** en Hostinger. Se eligió así a propósito:

- Cubre `korexia.online`, `www` y `crm` de una vez.
- **Sobrevive a los despliegues.** El método de archivo HTML depende de que cada
  build lo lleve; en este proyecto ya hubo dos despliegues que no llevaban los
  cambios, así que atar la verificación al despliegue era pedir problemas.

Sitemap enviado y leído el mismo día (estado "Correcto", 1 página descubierta) e
indexación solicitada para la portada.

> 💡 **Truco que ahorra intentos fallidos**: antes de pulsar "Verificar", se
> comprobó con `dig +short korexia.online TXT @8.8.8.8` que el registro estuviera
> publicado **y coincidiera carácter por carácter** con el que pedía Google.

## El perfil de empresa (Google Business Profile)

Creado como **negocio sin local** (área de servicio): la dirección queda oculta
y se declaran las zonas atendidas — Cali y 18 municipios cercanos.

Se descartó poner la dirección de otro negocio del dueño, aunque se planteó para
dar "confianza de punto físico". Dos razones:

1. **La verificación por vídeo pide ver el letrero del negocio.** Un local con
   otro nombre no pasa, y los intentos fallidos pueden dejar el perfil
   bloqueado — usar una dirección donde no se opera va contra las directrices.
2. **Ubicaba el negocio en Jamundí**, no en Cali. El ranking local depende de la
   distancia al pin: se habría pagado el riesgo para posicionar en el sitio
   equivocado.

| Campo | Valor |
|---|---|
| Categoría principal | Servicio de marketing por Internet |
| Servicios | "Chatbot para WhatsApp", "Automatización de WhatsApp", "Agente de IA para atención al cliente"… |
| Chat | WhatsApp (`wa.me/573046838172`) |

**Dónde van de verdad las palabras clave**: la categoría es una lista cerrada de
Google y **no existe nada de chatbots ni de IA**. Lo que sí acepta texto libre
—y cuenta para el ranking— son los **servicios** y la **descripción**. Ahí es
donde entra "chatbot para WhatsApp", escrito como lo buscaría un cliente y no
como se diría en una reunión.

### Las fotos

Seis tarjetas de 1200×1200 compuestas sobre la marca: pantallazo **completo** de
cada funcionalidad dentro de un marco de ventana, con un titular grande encima.

El porqué: en el carrusel de Google las fotos se ven **en miniatura**, y una
captura de CRM a ese tamaño es una mancha gris ilegible. La miniatura tiene un
solo trabajo, **ganarse el clic**; el detalle se ve al ampliar. Titular grande
para lo primero, pantallazo entero para lo segundo.

## La cuenta de demostración: "Studio Bella"

La organización de pruebas (`org_novxv78s08h12arzatr2`) se pobló con datos
ficticios para las capturas, y **se queda** como cuenta de demostración
permanente para enseñar el producto a prospectos en vivo.

- 89 contactos con nombre y teléfono inventados · 89 tarjetas repartidas por el
  embudo · 87 citas · el catálogo de 46 servicios que ya tenía.
- **No se tocó ni un dato de La Churra ni de Lis.** Los contactos que había eran
  "Cliente de prueba" con teléfonos `test…` y conversaciones `is_test`.

Tres cosas que se vieron mal al capturar y **también afectaban a las
organizaciones reales**, así que valió la pena corregirlas:

1. **Teléfonos con doble `+`**: la interfaz añade uno, y en la base se guardan
   sin él.
2. **Todas las tarjetas gritando "Sin responder hace 9 días"** en ámbar. El
   aviso salta a partir de 24 h desde el último mensaje del cliente; con datos
   viejos, el tablero entero se ve como un cementerio. Pésimo mensaje para
   vender un agente que contesta al instante.
3. **Citas a las 4 de la madrugada**: el servidor corre en UTC y la interfaz
   pinta hora de Colombia (UTC−5). La zona horaria vuelve a costar tiempo, como
   avisa [00-INDICE.md](00-INDICE.md).

## Qué falta

- **Reseñas.** Es lo que más pesa en el ranking local y lo único que no se puede
  hacer solo. Hay tres clientes reales y contentos (La Churra, Lis, Alchili
  Gums). ⚠️ Nunca pagarlas ni incentivarlas: Google lo detecta y suspende.
- **Logo y foto de portada** del perfil, aún sin subir.
- **Descripción** del negocio, si no llegó a pegarse en el alta.
- **Preguntas y respuestas**: se pueden sembrar uno mismo, y así se controla qué
  dudas aparecen en el perfil.
- **Decidir el horario**: quedó "abierto 24 horas". Coherente con lo que se
  vende, pero aplica también al teléfono: si nadie contesta de madrugada, juega
  en contra. Se resuelve conectando ese número a korex.ia.

## Expectativas realistas

El dominio se creó el **26-jul-2026**, tiene **una sola página** y ningún sitio
enlazándolo. Lo de hoy **desbloquea** a Google; no hace rankear.

| Qué | Cuándo |
|---|---|
| Aparecer buscando "korex.ia" (la marca) | días |
| Datos en Search Console | 2-3 días |
| Rankear por "automatización WhatsApp" | meses |

Lo que más rinde a corto plazo no es la web: es el **perfil de empresa con
reseñas**, que aparece en días y no en meses.
