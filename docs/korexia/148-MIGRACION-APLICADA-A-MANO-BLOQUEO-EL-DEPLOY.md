# 148 — Una migración aplicada a mano dejó un deploy en bucle

26/27-ago-2026.

## Qué pasó

Para probar `consultasVerificadasEnabled` con datos reales de Lis sin
esperar a un deploy (doc 143), se aplicó la migración
`0030_consultas_verificadas_por_organizacion.sql` **a mano**, directo
contra la base de producción (`ALTER TABLE agent_profile ADD COLUMN
consultas_verificadas_enabled boolean DEFAULT false NOT NULL;`) — el mismo
atajo que ya se usaba en esta sesión para probar contra datos reales sin
tocar el servidor.

Horas después, al desplegar el código de esa misma migración (ya
incluida en el repo), el contenedor nuevo entró en un ciclo de arranque
fallido:

```
[migrate] falló tras varios intentos: PostgresError:
column "consultas_verificadas_enabled" of relation "agent_profile" already exists
```

`migrate.mjs` usa `drizzle-orm/postgres-js/migrator`, que decide qué
migraciones faltan comparando contra una tabla de control
(`drizzle.__drizzle_migrations`) — como la columna se había creado por
fuera de ese mecanismo, la tabla de control no sabía que ya existía, e
intentó crearla de nuevo en cada arranque.

Docker Swarm, tras tres fallos seguidos, puso la actualización en pausa
(`UpdateStatus: paused`) y dejó el contenedor **viejo** (sin ninguna de
las mejoras del día) sirviendo tráfico real — sin caída de servicio, pero
con el deploy atascado indefinidamente hasta que alguien interviniera.

## Cómo se resolvió

`drizzle-orm` calcula el identificador de cada migración como
`sha256(contenido completo del archivo .sql)`. Se calculó ese hash **tal
como está empaquetado en la imagen real** (no el archivo local, para
descartar diferencias de fin de línea entre Windows y Linux):

```
docker run --rm easypanel/korex-crm/crm sh -c \
  'sha256sum drizzle/0030_consultas_verificadas_por_organizacion.sql'
```

y se insertó manualmente la fila que le faltaba a la tabla de control,
con ese hash y el mismo timestamp que ya tenía el archivo en
`drizzle/meta/_journal.json`:

```sql
insert into drizzle.__drizzle_migrations (hash, created_at)
values ('5448277c...', 1787793600000);
```

Con eso, `migrate.mjs` reconoció la migración como ya aplicada y dejó de
chocar. Como el rollout había quedado *pausado* (no simplemente
reintentando), hizo falta reanudarlo a mano:

```
docker service update --force --update-order start-first korex-crm_crm
```

Esta vez completó limpio (`UpdateStatus: completed`) y retiró el
contenedor viejo. El despliegue siguiente de esa misma tarde (tres rondas
más, sin ninguna migración nueva) no tuvo ningún problema — confirma que
la causa era exactamente esa, y solo esa.

## La lección

**Cualquier cambio de esquema aplicado a mano en producción tiene que
registrarse también en la tabla de control de migraciones**, con el hash
real del archivo — no solo ejecutar el `ALTER TABLE`. Si el código de esa
migración se despliega después sin ese registro, el arranque del
contenedor la vuelve a intentar y choca, y el síntoma no es un error
visible al momento de aplicar el `ALTER TABLE` (eso funciona bien) sino
un deploy que falla **horas más tarde**, sin relación aparente con lo que
se hizo.

Aplicar una migración a mano para probar algo rápido sigue siendo válido
— pero el paso de registrarla en `drizzle.__drizzle_migrations` no es
opcional, es parte de aplicarla.
