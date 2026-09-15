# 173 — La bandeja lenta

**14-sep-2026.** La bandeja recorría la tabla de mensajes entera, una vez por
cada conversación de la lista.

## El síntoma

Tras conectar la coexistencia de Camilabrandcol, pasar de una venta a otra en
el CRM se volvió lento. El servidor no tenía nada que ver: carga 0.11, CPU del
contenedor al 0.17%, 2.2 GB de RAM libres.

Lo que cambió fue el tamaño. La sincronización del historial de 6 meses
([172](172-EL-DOMICILIO-QUE-NADIE-CONSULTO.md) es de ese mismo día, pero el
historial entró con los eventos `whatsapp.smb.*`) trajo de golpe:

```
Camilabrandcol   28.479 mensajes · 2.014 conversaciones
Lashes Valen      9.720 mensajes ·   494 conversaciones
Lis Pastelería    7.999 mensajes ·   349 conversaciones
MALIA             5.705 mensajes ·   272 conversaciones
La Churra         1.052 mensajes ·    88 conversaciones
```

Un solo cliente con más mensajes que todos los demás juntos.

## La causa

`listConversations` (`src/server/inbox/queries.ts`) resuelve la vista previa de
cada chat con una subconsulta correlacionada:

```sql
select coalesce(m.text, m.type) from message m
where m.conversation_id = c.id          -- ← sin organization_id
order by m.created_at desc limit 1
```

El único índice útil es `message_org_conv_idx (organization_id,
conversation_id, created_at)` — y **empieza por `organization_id`**. Sin esa
columna en el `where`, Postgres no puede entrar por el índice y cae a un Seq
Scan de `message` completa. Una vez por conversación:

```
->  Seq Scan on message m  (actual time=5.513..8.845 rows=20 loops=200)
      Filter: (conversation_id = c.id)
      Rows Removed by Filter: 52940      ← descarta 52.940 de 52.955, 2.014 veces
```

No es un problema nuevo: ya costaba 3-4 segundos en negocios de ~250
conversaciones. Camilabrandcol solo lo hizo imposible de ignorar.

## El arreglo

Añadir `m.organization_id = ${organizationId}` a esa subconsulta. Una línea.

```
->  Index Scan Backward using message_org_conv_idx on message m
      Index Cond: ((organization_id = …) AND (conversation_id = c.id))
      (actual time=0.006..0.006 rows=1 loops=200)
```

Medido con la función real contra producción:

| Negocio | Antes | Después | |
|---|---|---|---|
| Camilabrandcol | 10.811 ms | **1.401 ms** | 7,7× |
| Lis Pastelería | 4.052 ms | **251 ms** | 16× |
| MALIA | 3.171 ms | **319 ms** | 10× |

**No cambia ni una vista previa**: las tres bandejas devuelven exactamente las
mismas filas, todas con su preview (2015/2015, 254/254, 253/253). El filtro no
puede excluir nada porque `message.organization_id` siempre coincide con el de
su conversación — verificado en producción, **0 discrepancias** sobre 52.955
mensajes, y garantizado por el Principio III.

## Por qué el comentario en el código es largo

Porque el filtro *parece* redundante —la consulta exterior ya filtra por
organización— y quien lo vea sin contexto va a querer quitarlo. El comentario
explica que es lo único que hace usable el índice, con los números medidos.

## Lo que NO se tocó

La bandeja sigue trayendo **todas** las conversaciones de una vez, sin
paginación: son los ~1.4 s que quedan en Camilabrandcol. Arreglarlo exige
paginar también la pantalla, así que se deja medido y aparte.

La otra subconsulta (`stageSql`, la etapa del embudo) se revisó y **no tiene el
problema**: usa `lead_contact_uq (contact_id)` con Index Scan a 0.002 ms por
fila.

## Verificación

- Función real ejecutada contra producción antes y después (tabla de arriba).
- Gate completo: typecheck, 2172 pruebas, lint y build.

## Cómo revertir

`git revert` del commit. Es una condición en un `where`: quitarla devuelve el
comportamiento anterior sin tocar tipos ni resultados — solo la lentitud.
