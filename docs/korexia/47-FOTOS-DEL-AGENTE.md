# El agente envía fotos: la del producto que le preguntan

> **Dentro:** Por qué · Qué pasa cuando alguien pregunta · Dónde viven las
> fotos · Cómo las sube el cliente · Las tres degradaciones · Los dos fallos
> que solo aparecieron probando · Qué falta

**No es que el agente mande fotos: es que sea preciso.** La distinción la puso
el dueño y es lo que ordena todo este diseño.

## Por qué

Dos ejemplos suyos, que lo explican mejor que cualquier justificación:

> *"¿Te imaginas el menú de Lashes Valen con más de 30 productos? Sería súper
> aburrido para un cliente leer todo eso."*
>
> *"Si La Churra en un futuro quiere enviar una foto de cómo se ven sus
> churros, o cómo se ve el Volumen Ruso."*

Hay preguntas que el texto no contesta bien. Pero la respuesta **no** es soltar
un álbum: es mandar **la foto de lo que preguntaron**, y solo esa.

## Qué pasa cuando alguien pregunta

```
Cliente: "¿cómo se ve el volumen ruso?"
   ↓  el agente ve en su prompt las fotos que el negocio cargó
   ↓  emite send_image con la etiqueta "Volumen Ruso"
   ↓  el servidor la busca, arma su URL pública y la envía
Foto + pie de texto, en una sola burbuja
```

Y si preguntan por algo que no tiene foto:

```
Cliente: "¿y tienes foto del laminado de cejas?"
Agente:  "Lo siento, no tengo una foto específica del laminado…"
```

Ese segundo caso es tan importante como el primero: **no promete lo que no
tiene**. Verificado contra el modelo real, no es teoría.

## Dónde viven las fotos: en la base de datos

Tabla `media_asset`. Se eligió así tras comprobar algo que conviene recordar:

> ⚠️ **El contenedor del CRM no tiene ningún volumen montado.** Todo lo que
> escriba en su disco **se borra en cada despliegue**. Postgres sí tiene
> volumen; la aplicación no.

| Dónde | Sobrevive | Respaldado | Coste |
|---|---|---|---|
| Disco del contenedor | ❌ | ❌ | — |
| **Base de datos** | ✅ | ✅ **el backup de 6 h ya lo cubre** | $0 |
| R2 / S3 | ✅ | hay que montarlo | ~$5/mes |

Una foto comprimida pesa ~150 KB; 46 servicios son ~7 MB y la base entera pesa
16 MB. **Con 100 clientes habría que mudarlas fuera**, pero la interfaz
(`/api/media/[id]`) no cambiaría.

### La ruta es pública, y tiene que serlo

Al enviar una imagen por WhatsApp **no se manda el archivo, se manda una URL que
Meta descarga desde sus servidores**. Meta no tiene sesión ni cookies: cualquier
protección por login dejaría al cliente sin ver la foto.

Qué la protege: el id es un `nanoid` aleatorio (no se puede recorrer el catálogo
ajeno probando `/1`, `/2`) y **aquí solo hay lo que el negocio quiere enseñar**.
Los comprobantes de pago y las imágenes de clientes siguen en YCloud y no pasan
por esta tabla. **Nada privado debe entrar aquí nunca.**

### `PUBLIC_MEDIA_BASE_URL`

Variable nueva, `https://crm.korexia.online`. No se corrigió `APP_BASE_URL`
—que en producción apunta a la IP interna— porque **Better Auth la usa como
`baseURL`**, y tocarla se paga con todos los clientes fuera de su cuenta.

Si falta, el agente **no manda fotos y responde con texto**. Nunca rompe nada.

## Cómo las sube el cliente

Etapa 6 de la [configuración inicial](46-CONFIGURACION-INICIAL.md), **opcional**:
quien no quiera fotos la salta y su agente responde con texto.

Decisión del dueño, y la correcta: **nadie conoce mejor sus productos que quien
los vende**. La agencia no recorta ni etiqueta fotos ajenas, y de paso no tiene
que adivinar cómo llama el negocio a cada cosa.

Dos detalles que importan:

- **Se pide el nombre ANTES de dejar elegir el archivo.** Ese nombre es lo que
  el agente busca cuando alguien pregunta; una foto sin nombre útil no se
  encontraría nunca.
- **Se comprime en el navegador** (1280 px, JPEG 82 %). Una foto de móvil pesa
  3-5 MB: se pasaría del límite y, peor, viajaría entera por los datos del
  cliente — que es lo que hace abandonar un paso desde el celular.

Subir otra foto con la misma etiqueta **reemplaza** la anterior: dos fotos para
lo mismo dejarían al agente sin saber cuál mandar.

## Las tres degradaciones

Una foto es un complemento; quedarse mudo, no. Se responde con texto si:

1. **La foto no existe** con esa etiqueta.
2. **No hay URL pública** (falta `PUBLIC_MEDIA_BASE_URL` o no es https).
3. **El envío falla.** A diferencia de `deliverReply`, aquí **no se deriva a una
   persona**: sacar a un humano porque una imagen no salió es peor remedio.

Y una cuarta, en `elegirFoto`: **no adivina**. Tolera cómo escriba el modelo
(sin tildes, en minúsculas, contenido en el nombre) pero si "volumen" encaja con
*Volumen Ruso* y *Volumen Americano* devuelve `null` y contesta con texto.
**Mandar la foto equivocada es peor que no mandar ninguna** — sería enseñarle un
producto de $150.000 a quien preguntaba por otro.

## Los dos fallos que solo aparecieron probando

Ninguno lo habrían visto el typecheck ni las 478 pruebas. Salieron ejecutando el
pipeline real contra el modelo, y **los dos habrían roto conversaciones**.

**1. El modelo escribe `label`, no `etiqueta`.** A *"¿cómo se ve el volumen
ruso?"* eligió bien la acción pero mandó `{"action":"send_image","label":"Volumen
Ruso"}`. El esquema la rechazó, se agotaron los reintentos y la conversación
acabó derivada a una persona — **con la foto cargada y lista**.

Su error es razonable: todo el contrato está en inglés (`action`, `reply`,
`text`, `summary`, `farewell`) y la acción se llama `send_image`. El único campo
en español era justo el que había que adivinar. **Se aceptan los dos.**

**2. Faltaba `send_image` en el contrato de acciones.** Estaba en el esquema y
en la lista de fotos, pero no donde el agente aprende el **formato exacto**, así
que improvisaba: tras arreglar (1), mandó la acción sin etiqueta ninguna.

> 🔑 **La lección**: añadir una acción son tres sitios, no uno — el esquema, el
> contrato del prompt y el ejecutor. Y solo se comprueba ejecutándola.

## Qué falta

- **Probarlo contra un WhatsApp real.** Todo lo verificado hasta ahora es con
  conversaciones `is_test`, que nunca tocan WhatsApp: falta ver una foto llegar
  a un teléfono.
- **Medir el costo.** Desde el 1-oct Meta cobra los mensajes salientes y una
  imagen es un mensaje. Hoy se registran en `usage_event` como `image`.
- **Fotos por catálogo de citas**: hoy la etiqueta se escribe a mano; podría
  ofrecerse la lista de servicios del negocio para elegir.
