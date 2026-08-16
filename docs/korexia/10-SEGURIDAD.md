# Seguridad: auditoría del 31-jul-2026 (con una ronda más el 3-ago-2026)

> **Dentro:** Resumen · Contraseña olvidada · Eliminar una cuenta · Corregido (16-ago): el teléfono del cliente iba al log · Lo más grave sigue abierto y no es de código · Corregido: un cliente podía atacar a otro · Corregido: las firmas fallaban ABIERTAS · Corregido (3-ago): un cliente podía silenciar el agente de otro · Corregido (3-ago): el rate-limit del login se evadía · Pendiente, sin urgencia · Lo que está bien hecho

Auditoría completa del código, el historial de git y las dependencias
(gitleaks + osv-scanner), con cada hallazgo verificado a mano contra este
sistema. No se hicieron pruebas activas contra producción.

## Resumen

**El aislamiento entre clientes está bien construido.** No hay ninguna consulta
que se salte el filtro por organización: `scoped()` se aplica con disciplina,
los endpoints derivan la organización **de la sesión** (nunca del cliente), y
la sesión se revalida contra la base en cada petición. Tampoco hay secretos en
el repositorio ni en el historial de git.

Los problemas reales estaban **en la frontera de los webhooks públicos**, y ya
están corregidos.

## ✅ Corregido (16-ago-2026): el teléfono del cliente iba a parar al log

Lo encontró la auditoría del 16-ago, **antes de encender la Fase 2**, que es
justo lo que lo habría activado.

El registro de cambios escribe una línea por campo con su valor anterior y su
valor nuevo. La Fase 2 guarda el pedido con **nombre, teléfono y dirección del
cliente final**, y `paraLog` solo tapaba dos cosas: los campos que parecen un
secreto (`token`, `apiKey`…) y los valores de más de 120 caracteres. Un teléfono
no es ninguna de las dos:

```
[cambio] tabla=conversation_state campo=entrega.telefono
  valor_anterior=null valor_nuevo=3001234567 …
```

Con la bandera apagada no se emitió ni una línea. En el turno siguiente a
encenderla, el log del contenedor —que se lee a ojo y se pega en un chat— habría
empezado a acumular datos de clientes reales.

**Cómo se corrigió**: una categoría nueva en `paraLog`, distinta de los
secretos. Un token se oculta y punto; un teléfono hay que poder **seguirlo sin
leerlo**, porque *"¿cambió?"* y *"¿volvió al de antes?"* son preguntas legítimas
al investigar un pedido. Se sustituye por una huella estable:

```
valor_nuevo=<personal · 10 caracteres · huella 3f2ab1c9>
```

Tres decisiones que importan:

- **La lista de campos personales se compara EXACTA, no por substring.** Con
  `includes` bastaba poner `"nombre"` para tapar también `producto.nombre` —el
  nombre de un churro—, perdiendo trazabilidad de negocio sin ganar privacidad.
- **Hay una red por si alguien añade un campo y no lo lista**: una cadena con
  siete dígitos seguidos se tapa igual. Es el fallo que se repite en este
  proyecto — el que falta siempre es el que nadie declaró.
- **La red solo mira cadenas.** `totalCents` son `1000000`, siete dígitos y un
  número: un total no es una persona.

Con siete pruebas, entre ellas la que comprueba que la línea completa del log no
contiene el número por ningún lado, y las dos que impiden la sobrecorrección
(el nombre del producto y el total siguen legibles).

## ✅ Corregido (16-ago-2026): tres logs volcaban datos de clientes en producción

Lo anterior era un riesgo **futuro** —se activaba al encender la Fase 2—. Esto
ya estaba ocurriendo:

| Dónde | Qué escribía |
|---|---|
| `ycloud-events.ts:87` | `JSON.stringify(event)` entero en *"mensaje sin texto ni adjunto"*: teléfono del cliente, su nombre de perfil de WhatsApp y el cuerpo del mensaje. **Se dispara con los mensajes `unsupported`, que llegan a diario** ([24](24-MENSAJES-UNSUPPORTED.md)) |
| `ycloud-events.ts:69` | El mismo volcado, cuando el evento se descarta por faltarle datos |
| `pipeline.ts` (`persistFailedOutbound`) | La respuesta completa del agente — que es el **resumen del pedido**: nombre, teléfono y dirección |

**Ninguno estaba puesto por descuido**, y eso es lo que hizo que duraran: los dos
de YCloud servían para diagnosticar qué campo trae el remitente cuando el parser
falla (así se encontró lo de `fromUserId` el 2-ago), y el del pipeline estaba
para poder reenviar a mano una respuesta perdida.

**Cómo se corrigió sin perder esa utilidad**: `eventoParaLog()` conserva **todas
las claves** del evento y resume los valores de texto. La pregunta *"¿qué campo
trae el remitente?"* se responde viendo las claves; el teléfono no hacía falta
para responderla.

En el pipeline sí hay una pérdida consciente: el texto ya no se puede copiar del
log para reenviarlo. Hacen falta **dos fallos seguidos de base de datos** para
llegar a ese punto, y a cambio el resumen del pedido deja de escribirse.

Con la regla permanente y el guardarraíl que la verifica sola:
**[74-REGLAS-DE-LOGS.md](74-REGLAS-DE-LOGS.md)**.

## 🔴 Lo más grave sigue abierto y no es de código

**La contraseña del superadmin quedó expuesta en un chat y no se ha cambiado.**

No es "una cuenta más": desde el login público, quien la tenga puede **entrar
como cualquier cliente** y leer y escribir todas sus conversaciones, **borrar
un cliente entero** y **gestionar las credenciales de WhatsApp** de cada
negocio.

Dos agravantes confirmados en el código:

- **No hay segundo factor.** La autenticación es solo correo + contraseña.
- **El límite de intentos no protege aquí.** Frena la fuerza bruta, no a quien
  ya tiene la contraseña correcta.

**Qué hacer**: cambiarla, revisar la tabla `session` por sesiones que no se
reconozcan, y añadir verificación en dos pasos al superadmin.

## ✅ Corregido: un cliente podía atacar a otro

`GET /api/settings/webhook` exigía sesión, pero **de cualquier usuario**, y
devolvía en claro el `META_WEBHOOK_VERIFY_TOKEN` — que es **único para toda la
instalación** y protege `POST /api/webhooks/wa/<token>`.

La cadena completa, verificada:

1. El empleado de un negocio lee el token.
2. `META_APP_SECRET` no está configurada, así que la firma de Meta aceptaba
   cualquier cosa.
3. Publica un evento falso con el `phone_number_id` de **otro** negocio (su
   número de WhatsApp, que es público).
4. El mensaje entra en la bandeja ajena. Como la conversación nace nueva, la
   ventana de 24 h está abierta y **el agente responde**: el WhatsApp de la
   víctima acaba escribiéndole a un número elegido por el atacante, gastando su
   cupo y su reputación.

**Arreglado**: el endpoint pasó a `withPlatformAdmin`. No le quita nada a nadie
— su única pantalla ya era exclusiva de la agencia.

## ✅ Corregido: las firmas fallaban ABIERTAS

Sin secreto configurado, las dos verificaciones de firma devolvían `true`: la
capa quedaba desactivada. Cómodo para probar, pero **estos webhooks son las
únicas puertas del sistema sin sesión**: sin firma, basta conocer la URL para
inyectar mensajes en la bandeja de un negocio.

**Arreglado**: en producción se falla **cerrado**. Fuera de producción se
conserva el comportamiento, que es donde sirve.

Antes de tocarlo se verificó que no rompía nada: el webhook de Meta **no recibe
tráfico** (0 peticiones en 24 h) y los dos clientes entran por YCloud, cuyo
secreto sí está configurado.

### Cómo comprobar que sigue bien

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  'https://crm.korexia.online/api/webhooks/ycloud' -d '{}'
# 401 = correcto (rechaza lo no firmado)   ·   200 = expuesto
```

## ✅ Corregido (3-ago-2026): un cliente podía silenciar/reactivar el agente de otro

`clearHandoff`/`markHumanTookOver` (`inbox/handoff-policy.ts`) filtraban el
`UPDATE` solo por `conversation.id`, sin exigir `organization_id` — la única
excepción a la disciplina de `scoped()` que sostiene el resto del código
(`updateConversation` sí lo hacía bien, al lado).

**Cadena verificada**: alguien de la organización A manda un mensaje a
`POST /api/conversations/{id_de_B}/messages` con el ID de una conversación de
B (hace falta conocerlo — nanoid de 20 caracteres, no es adivinable ni se
expone entre clientes por ningún endpoint). Con texto normal, deja mudo al
agente de B (`markHumanTookOver` escribe antes de que `sendText` rechace por
organización); con el atajo `#bot`, reactiva un agente que un operador de B
tenía apagado a propósito. Ningún dato cruza — `sendText` sí valida la
organización antes de enviar — pero la escritura del handoff ya había
ocurrido.

**Arreglado**: `scoped()` en ambas funciones. Se aprovechó para endurecer con
el mismo criterio: `applyHandoff` (mismo archivo, `ai/pipeline.ts`),
`moveLeadToStage`, `appendLeadNote`, `contactPhoneOf()` (pendiente #4 de
abajo) y `onLeadActivity` (`inbox/lead-activity.ts`, encontrado en la misma
pasada). Ninguno era explotable en la práctica hoy —los IDs son únicos
globalmente entre organizaciones—, pero todos rompían la disciplina que el
resto del código sostiene.

## ✅ Corregido (3-ago-2026): el rate-limit del login se evadía falsificando la IP

`lib/auth/index.ts` tomaba el **primer** valor de `X-Forwarded-For`, que
controla quien hace la petición — el proxy (Traefik) solo AÑADE la IP real al
final, nunca la garantiza al principio. Rotando ese header en cada intento,
cada petición caía en una clave distinta del limitador y el tope de 10/10 min
nunca se disparaba: fuerza bruta ilimitada contra `/sign-in/email`, justo
cuando **no hay 2FA** y la contraseña del superadmin sigue expuesta (ver
arriba).

**Arreglado**: se prioriza `X-Real-Ip` (lo pone el proxy) y, si falta, el
**último** salto de XFF. Extraído a `clientIpFrom()` en `lib/rate-limit.ts`
para poder probarlo sin levantar better-auth — antes esta lógica vivía
enterrada en el hook y no tenía ninguna prueba.

## 🟡 Pendiente, sin urgencia

**1. ~~Subir a `next@15.5.21`~~** — ✅ **hecho el 3-ago-2026**, a `15.5.22`
(la versión instalada tenía 8 advisories corregidos ahí, incluido un SSRF
CVSS 8.3 en Server Actions — `GHSA-89xv-2m56-2m9x`). Verificado con
`pnpm build` completo tras el salto.

**2. ~~Lista blanca de dominios en `/api/media/[id]`~~** — ✅ **corregido el
31-jul-2026**. Solo https y los hosts de YCloud/Meta, comparando el host
completo: `api.ycloud.com.atacante.net` termina con un dominio legítimo y
burlaría un filtro ingenuo. Cubierto por pruebas, incluidas las direcciones
internas y los esquemas `file://` y `javascript:`.

**3. `drizzle-orm` 0.45.2+.** El CVE conocido solo se dispara si entra input
del usuario en la construcción de **identificadores** SQL. Se revisó todo el
SQL crudo del proyecto: siempre interpola columnas de Drizzle o constantes, y
la búsqueda usa valores parametrizados. **No hay ruta explotable aquí.**
Actualizar por higiene, probando (salta varias versiones menores). Reconfirmado
el 3-ago-2026 con `osv-scanner`.

**4. ~~`contactPhoneOf()` no usa `scoped()`~~** — ✅ **corregido el 3-ago-2026**,
junto con el resto de escrituras/lecturas sin tenant explícito de la misma
pasada (ver arriba).

**5. Cabeceras de seguridad** (CSP, HSTS, X-Frame-Options) no están en
`next.config.ts`. Probablemente las añade Traefik; conviene verificarlo.

## Lo que está bien hecho

- **Cifrado correcto**: AES-256-GCM con IV aleatorio por operación, etiqueta de
  autenticación verificada y longitud de clave validada. Los tokens nunca
  vuelven al navegador (solo los últimos 4 caracteres) y no se registran en
  ningún log.
- **Comparaciones en tiempo constante** en ambas verificaciones de firma.
- **Panel de agencia bien cerrado**: todos sus endpoints exigen superadmin, y
  entrar como cliente no crea membresías ni sobrevive a que se revoque el rol.
- **Sin secretos en git**, ni en el árbol de trabajo ni en el historial.
- **Inyección de prompt contenida por diseño**: el agente solo recibe el
  contexto de su propia organización, sus acciones están validadas contra un
  esquema cerrado, las etapas se resuelven contra las de esa organización y los
  avisos de pedido van **solo** a los teléfonos que configuró el negocio —nunca
  a uno que elija el modelo o el cliente. Lo peor que consigue un desconocido
  por WhatsApp es que el agente le cuente el conocimiento **de ese mismo
  negocio**.

---

## Contraseña olvidada: qué pasa y cómo se resuelve (10-ago-2026)

**No hay recuperación por correo, y es una decisión, no un olvido**: el login es
correo y contraseña, no existe pantalla de "olvidé mi contraseña" y **no hay
ningún servidor de correo configurado** en toda la instalación (ni SMTP, ni
Resend, ni nada). La contraseña temporal se entrega a mano al dar de alta la
cuenta.

Hasta hoy eso dejaba un agujero operativo: un cliente bloqueado dependía de que
alguien **entrara al servidor a reemplazarle el hash a mano** — y no con un
`UPDATE` simple, porque Better Auth guarda la contraseña con su propio cifrado.
Un sábado por la noche, eso es un negocio sin atender.

### La salida: "Nueva contraseña" en `/admin`

En `/admin` → cliente → **Cuentas**, cada cuenta tiene un botón que le genera una
contraseña nueva. Sale **pegada a esa cuenta**, con botón de copiar, y se muestra
**una sola vez**: no queda escrita en ningún sitio. Confirma en dos clics.

> 🔴 **Fallo real el 11-ago-2026, a los tres minutos de estrenarlo.** La
> contraseña se enseñaba en el recuadro de credenciales del **principio de la
> página** —el mismo que se usa al crear un cliente—, y desde la lista de cuentas
> eso queda a media página de distancia. Se le cambió la contraseña a una clienta
> real de La Churra y **no se vio ninguna**: apareció fuera de la pantalla, no se
> guarda en ninguna parte, y quedó bloqueada hasta repetir la operación.
>
> La lección se generaliza: **el resultado de una acción se enseña donde ocurrió
> la acción**, y más si es irrecuperable. Se quitó además el `onBlur` que
> cancelaba la confirmación, porque hacía que un doble clic rápido no enviara
> nada.

Los campos de contraseña de toda la aplicación llevan **el ojo para verlas**
(login, cambio de contraseña, alta de cuentas, claves de API y secretos de
webhook). No es cosmético: aquí las contraseñas se dictan por teléfono, y
escribir a ciegas hace que una letra mal puesta parezca "no me deja entrar".

Tres decisiones de seguridad, todas con prueba:

| Regla | Por qué |
|---|---|
| Solo cuentas **de ese cliente** | El identificador viaja desde el navegador; se busca junto con su `organization_id`, así que uno ajeno no encuentra nada en vez de cambiarle la contraseña a otro negocio |
| **Nunca** una cuenta de la agencia | El botón desbloquea clientes. Si alguien robara una sesión de administrador, que no pueda además apoderarse de las cuentas internas |
| Se **cierran sus sesiones** abiertas | Si el motivo real no fue un olvido sino que alguien se metió, cambiar la clave sin echarlo lo dejaría dentro |

Probado contra Postgres real en `tests/integration/reset-password.test.ts`: lo
que se verifica no es el hash sino **que se entra con la contraseña nueva y ya no
con la vieja**.

> ⚠️ Esas pruebas **vacían `rate_limit_hit` antes de cada login**. El límite es
> de 10 intentos por IP cada 10 minutos (FR-062) y las pruebas hacen muchos más
> desde la misma máquina: sin eso se bloquean entre ellas y el fallo parece del
> código cuando es de la prueba.

---

## Alta equivocada: eliminar una cuenta (15-ago-2026)

Faltaba la otra mitad del alta: **no había forma de deshacerla**. El endpoint de
cuentas tenía `GET`, `POST` y `PATCH`, pero ningún `DELETE`, ni en `/admin` ni en
la pantalla de Equipo del cliente.

Lo que costó: el 14-ago se conectó a **Lashes Valen** con una cuenta de pruebas
(`ESTEBAN1`) como **propietaria**, y la cuenta real de la dueña nunca llegó a
crearse. Al intentar arreglarlo, dos trampas seguidas:

1. **El botón "Generar" no crea nada** — solo rellena el campo de contraseña. Se
   le dictó a la clienta una contraseña que no existía en la base.
2. **"Crear cuenta de acceso" se queda gris sin decir por qué** si falta el
   Nombre. Se lee como "el sistema no me deja más accesos", no como un campo
   vacío.

Y con la cuenta de pruebas ya dentro, la única salida era entrar al servidor a
borrarla a mano.

### La salida: "Eliminar" en `/admin` → cliente → Cuentas

Confirma en dos clics, como el reseteo. Cuatro reglas, todas con prueba:

| Regla | Por qué |
|---|---|
| Solo cuentas **de ese cliente** | El identificador viaja desde el navegador; se busca junto con su `organization_id` |
| **Nunca** una cuenta de la agencia | Igual que en el reseteo: que una sesión robada no alcance a las cuentas internas |
| **Nunca la última** cuenta del cliente | Un clic de más dejaría al negocio sin ninguna puerta de entrada y sin forma de recuperarla —no hay "olvidé mi contraseña"—. Las cuentas de la agencia no cuentan como supervivientes: el cliente conserva acceso **propio**. En la práctica obliga al orden correcto: primero se crea la buena, después se borra la mala |
| **El correo queda libre** | Si solo se quitara la membresía, el correo seguiría ocupado y volver a darlo de alta fallaría con *"ya existe una cuenta con ese correo"* — justo lo que se quiere hacer tras un alta equivocada. Se borra el usuario y el `ON DELETE CASCADE` se lleva credenciales, membresías y sesiones. Si la persona trabaja para **otro** cliente, se le retira solo este acceso |

Probado contra Postgres real en `tests/integration/eliminar-cuenta.test.ts`.

> ⚠️ **No confundir con el otro `DELETE`.** El de `clients/[id]/route.ts` borra
> **el cliente entero**, con sus contactos, su catálogo y su conexión de
> WhatsApp. En la misma pantalla, a pocos centímetros del nuevo.

### Bug de paso: la cuenta recién creada no se podía tocar

El alta devolvía la fila con un identificador inventado (`tmp_${email}`) en vez
de su `memberId` real, así que **resetear o borrar una cuenta recién creada daba
404** hasta recargar la página — justo el caso de uso principal del botón nuevo.
Ahora el `POST` devuelve `accountId` y la interfaz usa ese.

### Sigue pendiente

**Todas las cuentas nacen como Propietario.** El formulario manda `role: "owner"`
fijo (`admin-clients.tsx`), aunque el servidor ya acepta `member` — falta solo el
desplegable. Incoherencia añadida: si es el **cliente** quien crea la cuenta
desde su pantalla de Equipo, esa sí nace como `member`.

### Lo que sigue faltando

**Recuperación autónoma por correo.** Con este botón el cliente depende de poder
avisar a la agencia; con recuperación por correo se desbloquearía solo. Exige
montar envío de correo (Resend tiene plan gratis) y que el correo de cada cliente
sea real y lo revise — hoy no está garantizado. Razonable a partir de ~10
clientes.
