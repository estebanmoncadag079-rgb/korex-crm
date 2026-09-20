# 186 — El auditor ya no entra como superusuario

**20-sep-2026** · Estado: aplicado y verificado en producción. Único cambio:
**se creó un rol nuevo.** Ni un dato, ni una tabla, ni un usuario existente.

Continúa [185](185-LA-HORA-DE-CIERRE-EN-UNA-AGENDA.md).

## El problema

H-2 audita la base antes de desplegar, y para eso necesita una credencial
dentro de GitHub Actions (`DEPLOY_DB_URL`). La primera respuesta obvia era
usar la que ya existe. Y ahí estaba el problema:

```
Roles que pueden conectarse a la base vocero:
  postgres → superusuario · crea roles · crea bases · replicación · ignora RLS

¿Existe un rol de solo lectura?  NO
```

**Solo existe el superusuario.** La app, los scripts de mantenimiento y las
auditorías entran todos por la misma puerta, con permiso total sobre las 91
tablas.

Pegarla en CI habría convertido "puede leer dos tablas" en "puede borrar la
base entera de La Churra, Lis, Lashes y MALIA". Y el Environment
`production` **no tiene ninguna protección**: ni revisores obligatorios ni
restricción de ramas, así que cualquier workflow que lo declare puede leer
sus secretos.

El dueño lo paró antes de pegar nada. Correcto.

## El rol

```sql
CREATE ROLE korex_h2_auditor WITH LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 4 PASSWORD '…';
GRANT CONNECT ON DATABASE vocero TO korex_h2_auditor;
GRANT USAGE ON SCHEMA public TO korex_h2_auditor;
GRANT SELECT (id, name) ON public.organization TO korex_h2_auditor;
GRANT SELECT (…13 columnas…) ON public.agent_profile TO korex_h2_auditor;
```

### Por columna, no por tabla

`agent_profile` tiene **26 columnas** y el auditor lee **13**. Entre las
otras trece está `notify_phones`: los teléfonos del equipo del negocio. Un
`GRANT SELECT` sobre la tabla entera los habría metido en CI sin que el
auditor los necesite para nada. En `organization`, 2 de 6 (fuera queda
`metadata`, que puede contener cualquier cosa).

El coste está asumido y es el correcto: si mañana el auditor lee una columna
nueva, **fallará en el gate** con `permission denied for table`. Ruidoso,
visible y de una línea de arreglo — mejor que enterarse de que CI tenía
acceso de más.

## El inventario de columnas costó dos intentos, y merece contarse

El primer intento concedió 8 columnas de `agent_profile`. Todas las pruebas
de permisos pasaron… y **el auditor real falló**:

```
PostgresError: permission denied for table agent_profile
```

La causa: `auditar-arquitectura.ts` no importa sus dependencias arriba, las
carga a mitad de archivo con `await import(...)`.

```ts
const { validarConfiguracionArquitectonica } = await import("@/server/auth/arquitectura");
```

Un inventario que solo lea el script se deja fuera esa función, que hace **su
propia consulta** con otras 5 columnas (`state_source`, `catalog_source`,
`payment_source`, `appointments_enabled`, `consultas_verificadas_enabled`).

El árbol completo, ya cerrado:

| Módulo | Consultas |
|---|---|
| `scripts/auditar-arquitectura.ts` | `organization`(2) + `agent_profile`(8) |
| `server/auth/arquitectura.ts` | `agent_profile`(5 más) |
| `server/horario.ts` | ninguna — funciones puras |
| `server/horario-auditoria.ts` | ninguna — funciones puras |

La lección no es "se me olvidó una columna". Es que **un `grep` sobre un solo
archivo no es un inventario** cuando el código usa importación dinámica. Lo
que lo cazó fue ejecutar el auditor de verdad con la credencial nueva, no
razonar sobre ella.

## Verificación negativa

Que pueda leer no demuestra nada. Lo que importa es lo que **no** puede,
probado ejecutándolo de verdad contra producción (cada intento dentro de una
transacción que se deshace):

| Intento | Resultado |
|---|---|
| `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` | DENEGADA — `permission denied for table` |
| `ALTER TABLE` / `DROP TABLE` | DENEGADA — `must be owner of table` |
| `CREATE TABLE` | DENEGADA — `permission denied for schema public` |
| `CREATE ROLE` | DENEGADA — `permission denied to create role` |
| `CREATE DATABASE` | DENEGADA — `permission denied to create database` |
| `SELECT notify_phones` | DENEGADA — la columna no concedida |
| `SELECT metadata` | DENEGADA — ídem |
| `SELECT * FROM contact` | DENEGADA — tabla ajena |

Y después: ni base, ni rol, ni tabla `zz_prueba` quedaron en el servidor.

> **Un matiz del método.** `CREATE DATABASE` dentro de una transacción da
> `cannot run inside a transaction block` — un error de sintaxis, no de
> permisos. Habría sido un falso verde. Se ejecuta fuera de transacción para
> que Postgres llegue a comprobar el permiso de verdad.

## La contraseña no pasa por ningún sitio donde quede

- 44 caracteres aleatorios de `crypto.randomBytes`, alfabeto `base64url`
  (`A-Za-z0-9_-`): ningún carácter que rompa el parseo de una URL.
- Verificado antes de crear el rol: `log_statement=none`,
  `log_min_duration_statement=-1`. Y durante la transacción se fuerza además
  `SET LOCAL log_min_error_statement='panic'`, porque si el `CREATE ROLE`
  hubiera fallado, el valor por defecto (`error`) habría escrito la sentencia
  entera —contraseña incluida— en el log del contenedor.
- Viaja por el túnel SSH, cifrada.
- Se entrega en **un archivo fuera del repositorio**, para pegar en GitHub y
  borrar. Nunca al chat, ni al terminal, ni a un commit.

## Rollback (probado, no supuesto)

El rollback previsto era `DROP ROLE korex_h2_auditor;`. **No funciona:**

```
role "korex_h2_auditor" cannot be dropped because some objects depend on it
```

Los `GRANT` son esas dependencias. La secuencia correcta, ensayada dentro de
una transacción que se deshizo:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM korex_h2_auditor;
REVOKE ALL ON SCHEMA public            FROM korex_h2_auditor;
REVOKE ALL ON DATABASE vocero          FROM korex_h2_auditor;
DROP ROLE korex_h2_auditor;
```

Seguro de ejecutar: el rol **no es propietario de ningún objeto** y no
pertenece a ningún otro rol, así que borrarlo no pierde un solo dato.

## Estado

```
auditor H-2 con la credencial nueva: PASS · exit 0 · 0 bloqueadores
producción: /api/health → 85b3567 (sin cambios)
DATABASE_URL de la app: intacta (sigue con postgres)
```

## Lo que queda, y no se tocó

1. **`DEPLOY_DB_URL`**: pendiente de pegar en GitHub. Es el único bloqueador
   del despliegue.
2. **`postgres` sigue siendo el usuario de la aplicación.** Cambiar eso es
   otra tarea, más grande: la app escribe.
3. **`pg_hba.conf` línea 119: `host all all 127.0.0.1 trust`.** Quien pueda
   entrar al contenedor de Postgres se conecta como superusuario sin
   contraseña. Es el valor por defecto de la imagen oficial y solo alcanza
   desde dentro del contenedor, pero es una capa de más que conviene quitar.
4. **PUBLIC puede conectarse a la base `postgres`** (la de mantenimiento, sin
   datos de negocio). El rol nuevo hereda eso. Quitarlo es
   `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC` — no se hizo porque toca
   configuración fuera del alcance autorizado.
5. **El Environment `production` no tiene protecciones.** Añadir revisores
   obligatorios y restringir a la rama `main` reduciría bastante lo que un
   secreto en CI expone.
6. **`authorized_keys` del usuario `deploy`**: sin restricciones. Tarea
   aparte ya identificada.
