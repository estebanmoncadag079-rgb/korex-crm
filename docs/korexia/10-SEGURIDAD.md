# Seguridad: auditoría del 31-jul-2026

> **Dentro:** Resumen · Lo más grave sigue abierto y no es de código · Corregido: un cliente podía atacar a otro · Corregido: las firmas fallaban ABIERTAS · Pendiente, sin urgencia · Lo que está bien hecho

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

## 🟡 Pendiente, sin urgencia

**1. Subir a `next@15.5.21`.** La versión instalada tiene 8 advisories, todos
corregidos en ese parche. El más relevante para App Router necesita cuerpos con
codificación rara y respuestas cacheadas, y las rutas de API aquí son
`force-dynamic`. Riesgo real bajo, arreglo trivial.

**2. ~~Lista blanca de dominios en `/api/media/[id]`~~** — ✅ **corregido el
31-jul-2026**. Solo https y los hosts de YCloud/Meta, comparando el host
completo: `api.ycloud.com.atacante.net` termina con un dominio legítimo y
burlaría un filtro ingenuo. Cubierto por pruebas, incluidas las direcciones
internas y los esquemas `file://` y `javascript:`.

**3. `drizzle-orm` 0.45.2+.** El CVE conocido solo se dispara si entra input
del usuario en la construcción de **identificadores** SQL. Se revisó todo el
SQL crudo del proyecto: siempre interpola columnas de Drizzle o constantes, y
la búsqueda usa valores parametrizados. **No hay ruta explotable aquí.**
Actualizar por higiene, probando (salta varias versiones menores).

**4. `contactPhoneOf()` no usa `scoped()`.** No es explotable —el id viene de
una conversación ya filtrada— pero rompe la disciplina del resto del código.

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
