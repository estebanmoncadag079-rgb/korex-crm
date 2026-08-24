# Pendientes al 20 de agosto de 2026

> 🔴 **LÉEME AL RETOMAR. Este sustituye a [93](93-PENDIENTES-17AGO.md)**, que
> describe un sistema que ya no existe: allí la Fase 2 estaba apagada en los
> cuatro clientes, había 12 commits sin subir y nada desplegado. Nada de eso
> sigue siendo cierto.
>
> Para el relato de cómo se llegó aquí: [122](122-BITACORA-18-20AGO.md).

---

## Estado real del sistema, leído de la base hoy

| Negocio | Encendido | Vertical | Catálogo | Estado | Ficha | Prompt |
|---|---|---|---|---|---|---|
| **La Churra** | ✅ | pedidos | `tabla` (Fase 1) | **`backend`** | por secciones | 18.758 |
| **Lis Pastelería** | ✅ | pedidos | `tabla` (Fase 1) | **`backend`** | por secciones | 17.826 |
| **Lashes Valen** | ✅ | citas | `prompt`¹ | **`backend`** | por secciones | 8.086 |

¹ Correcto, no es deuda: en citas el catálogo son `service` (48 cargados) y
`generar.ts` lo excluye del prompt a propósito — una sola fuente de verdad.

**`conversation_state`: 25 filas.** La Fase 2 no está solo encendida: está
llevando el estado de conversaciones reales.

> 🔑 **La Fase 1 y la Fase 2 están completas en toda la flota.** Es el cambio
> más grande respecto al 93, y conviene decirlo sin rodeos porque durante días
> se creyó lo contrario: hasta el 19-ago la Fase 2 **nunca había funcionado para
> nadie** — el modelo no emitía la clave `estado` y nadie se había dado cuenta
> ([110](110-EL-MODELO-NO-EMITIA-EL-ESTADO.md)).

---

## 🟢 El sabor de temporada: dato arreglado, causa raíz sigue abierta

**Diagnosticado** en [123](123-EL-SABOR-QUE-NADIE-LEYO.md). El síntoma del
20-ago —el agente inventó *"mango biche"*— **ya no puede repetirse tal cual**:
`Cremoso de Temporada` tiene descripción `Arrechon` en `product` desde el
24-ago, verificado con la misma función que arma el prompt en producción.

Pero la causa de fondo sigue viva: el campo que el dueño edita en el
cuestionario (`ficha.negocio.catalogo`) **sigue desconectado** de la tabla que
lee el agente. La próxima vez que cambie el sabor de temporada, si lo escribe
ahí en vez de en Catálogo, **vuelve a fallar igual**.

| # | Qué | Estado |
|---|---|---|
| 1 | Poner `Arrechon` en `product.description` | ✅ **hecho, 24-ago** |
| 2 | Catálogo en **solo lectura** en el cuestionario si `catalog_source='tabla'` | ⬜ decisión del dueño — **esto es lo que cierra el caso de verdad** |
| 3 | Recortar `kb_lispasteleria0001`, que duplica el menú con precios | ⬜ decisión del dueño |
| 4 | Escenario: producto sin descripción → no atribuirle características | ⬜ sin hacer |

⚠️ **No reejecutar `pnpm migrar:catalogo` sobre Lis tal como está la ficha**: el
sabor acabaría **dentro del nombre** del producto.

---

## 🔴 Lo primero, y no es del proyecto

**Cambiar la contraseña del superadministrador.** Lleva pendiente desde el
16-ago y sigue siendo lo más urgente de todo lo escrito aquí. Cuatro documentos
de pendientes seguidos lo han encabezado.

**Y desde hoy, uno más: rotar el token de OpenRouter.** El 20-ago quedó visible
en una captura de pantalla dentro de una conversación. Se cambia en
`openrouter.ai` y hay que actualizarlo **en dos sitios**: el `.env` local y el
del VPS. Si no se rota, cualquiera que vea esa captura puede gastar el saldo — y
sin saldo el agente enmudece con un 402, que es la primera causa de la lista del
checklist de «el bot no responde».

---

## Lo que está esperando una acción tuya

| | Qué | Quién |
|---|---|---|
| 📦 | **Desplegar `1c17796`** — el cuestionario ya guarda el saludo, las reglas y el paso 8. El código está en la carpeta de EasyPanel; falta pulsar Desplegar | Esteban |
| 🔍 | **Verificarlo**: abrir el cuestionario de Lashes Valen y corregirle el saludo (hoy es el genérico *"Soy el asistente de…"*). Si al guardar cambia, el arreglo está vivo. **Este commit no añade ningún texto nuevo al código compilado, así que no se puede comprobar con un `grep`** | Esteban + verificación en base |
| 🧹 | **Sobra un cliente de prueba en producción**: `PRUEBA pedidos 1787021834496`, del 18-ago, de una corrida de `probar:estado` que se cortó a medias. Sale en la tabla de flota como si fuera un negocio real. Sin mensajes ni pedidos | decisión de Esteban |
| ❄️ | **El paso 3 del plan de flota sigue congelado** por decisión tuya: quitar la copia muerta del catálogo de las fichas. No es trivial — ese texto es la fuente que lee `migrar:catalogo` | congelado a propósito |

---

## Lo que le falta a cada negocio

### Lashes Valen — el que peor está de contenido

| | |
|---|---|
| 🔴 | **Una sola entrada de conocimiento.** Un negocio de citas necesita dirección, parqueadero, política de cancelación, retardos, cuidados previos. Es la causa más probable de la próxima queja |
| 🟠 | **El saludo es el genérico de fábrica**: *"¡Hola! 👋 Soy el asistente de Lashes Valen. ¿En qué te puedo ayudar?"*. Comparado con el de La Churra o Lis, no vende nada |
| 🟠 | **Una cita se confirma sin pedir el nombre de la clienta.** Auditado y diseñado el 19-ago, **nada implementado** ([102](102-REQUISITO-NOMBRE-EN-CITAS.md)) |

### Lis Pastelería

| | |
|---|---|
| 🟠 | **El sabor de temporada** — dato arreglado el 24-ago; el campo del cuestionario sigue desconectado de la tabla, ver el bloque de arriba y [123](123-EL-SABOR-QUE-NADIE-LEYO.md) |
| 🟠 | **Tres entradas de conocimiento llevan precios** (`0001` el menú entero, `0013` bebidas, `0012` tortas). Es la única de la flota así, y en cuanto cambie un precio en Catálogo el prompt llevará dos cifras distintas del mismo producto |
| 🟢 | **El enlace del catálogo no llegaba solo** — regla y arreglo medidos en [124](124-EL-ASESOR-ENVIO-EL-ENLACE-QUE-EL-BOT-PROMETIO.md). Bajó de 33% a 12,5% de fallo; el resto es un rasgo del modelo, no un hueco de dato — no se persigue con más reglas |

Por lo demás quedó con 15 productos, 28 entradas de conocimiento y sus 14 reglas
propias.

### La Churra

Sin pendientes de configuración conocidos: 4 presentaciones y la repetición por
grupo cargada. Sus cuatro productos **tampoco tienen descripción**, pero sus
nombres no anuncian ningún atributo variable y sí tienen grupos de opciones — no
es el mismo caso que el Cremoso de Temporada.

---

## Deuda viva

| | Qué | Desde |
|---|---|---|
| 🔴 | **`tsconfig` excluye `scripts/`.** Ya no es teórico: **dos scripts que escriben en producción llevaban cinco días sin compilar** (rotos el 15-ago, descubiertos el 20). El `typecheck` del gate pasaba en verde con ellos rotos | 17-ago, **agravado el 20** |
| 🟠 | **No existe `generado_de`** (hash de la ficha). Es lo único del [68](68-UN-DUENO-POR-DATO.md) sin hacer: hoy no hay forma barata de saber si el prompt de un cliente corresponde a su ficha, salvo recompilar y comparar | 15-ago |
| 🟠 | **Tres ramas de vertical son solo vocabulario** (dicen "pedido" o "cita" y nada más). Decidido **esperar a un tercer vertical** antes de generalizar: con dos casos no se sabe qué se está generalizando | 20-ago |
| 🟠 | **`isTest` no impide crear una cita real.** Una prueba puede ocupar un hueco de agenda de verdad | 19-ago |
| 🟠 | **El paso 3B, a medias**: la repetición ya está en el CRM; faltan mínimos, máximos, opciones y los grupos de `service` | 17-ago |
| 🟠 | **No existe la entidad Pedido** — decidido dejarlo así, pero sin ella no hay historial ni «cuánto vendió este mes» | 17-ago |
| 🟠 | `leerAporte()` sigue sin usarse: conectarla o borrarla | 15-ago |
| 🟠 | `medir-extraccion.ts` sigue en el contrato viejo | 16-ago |
| 🟢 | El `"0"` de reinicio sigue efectivamente fijo en el código | 15-ago |

---

## Lo que NO hay que volver a hacer

Esta lista solo crece con cosas que **ya pasaron**. Las cuatro primeras vienen
del [93](93-PENDIENTES-17AGO.md) y siguen vigentes; las cinco últimas son del
18 al 20 de agosto.

- **No guardar lo que devuelve `leerFichaAplanada`.** La puerta es
  `serializarComoEstaba` ([84](84-EL-MODELO-DE-LA-FICHA.md)).
- **No deducir reglas de negocio del vocabulario.**
- **No dar por buena una prueba sin su caso negativo.**
- **No confiar en la documentación por encima de la base.**
- 🆕 **No dar por desplegado un cambio sin verificarlo DENTRO del contenedor** —
  y al hacerlo, **buscar textos literales sin tildes**. Los nombres de función
  los renombra el minificador y los acentos se corrompen en el canal SSH: las
  dos cosas juntas produjeron un diagnóstico falso de *"no está desplegado"*
  cuando sí lo estaba.
- 🆕 **No arreglar un síntoma en el prompt de un cliente.** Cuando Lis negó tener
  Rappi, el arreglo fácil era una regla en su ficha. El arreglo correcto fue
  `canales` en el modelo de ficha, que sirve a toda la flota
  ([119](119-CANALES-EXTERNOS.md)).
- 🆕 **No escribir un esquema JSON permisivo para forzar una clave.** El primer
  intento devolvía `estado` pero perdía `text`: el cliente se habría quedado sin
  respuesta. Lo cazó una prueba antes de desplegar, de milagro.
- 🆕 **No prohibir escribir como sustituto de arreglar la causa.** La prohibición
  al cuestionario protegía de un formulario en blanco; el problema era el
  formulario en blanco ([120](120-EL-CUESTIONARIO-GUARDA-LO-QUE-PREGUNTA.md)).
- 🆕 **No dejar editable un campo que ya no manda.** El dueño escribió el sabor de
  temporada en el catálogo del cuestionario —el sitio con ese nombre— y para un
  cliente de Fase 1 ese texto está muerto. Un dato en cuatro copias solo es
  seguro si **una sola** es visible y editable
  ([123](123-EL-SABOR-QUE-NADIE-LEYO.md)).
- 🆕 **No empezar por el guardarraíl cuando falta un dato.** La tentación era
  «el agente inventa, comprobemos lo que afirma». El agente inventó porque en la
  tabla había un hueco con letrero.
- 🆕 **No suponer que dos arreglos correctos no se pelean.** Precargar el
  formulario y darle permiso de escritura eran ambos correctos y, juntos, iban a
  borrarle 13 reglas a Lis. Lo destapó mirar la base, no las pruebas.

---

## Comandos útiles

```bash
# El túnel a la base (sin él, ningún script funciona)
ssh -i ~/.ssh/churrabot_key -f -N -L 15433:172.16.1.1:5433 root@2.25.159.117
```

> ⚠️ Ese túnel apunta a **producción**. Nunca usarlo como `TEST_DATABASE_URL`.

```bash
pnpm probar:estado            # 46 comprobaciones, dos clientes efímeros
pnpm probar:propiedad         # reenviar el cuestionario no pisa lo ajeno
pnpm probar:escenarios        # 24 clientes simulados, comprobaciones objetivas
pnpm fase2 <org> --encender   # o --apagar. Rollback SIN desplegar
pnpm migrar:catalogo <org>    # catálogo del prompt a tablas (Fase 1)
pnpm convertir:ficha <org>    # ficha plana → por secciones
pnpm regenerar:flota          # sin --aplicar NO escribe. Con él cambia a TODOS
```

Y el gate, antes de cualquier commit:

```bash
pnpm test && pnpm typecheck && pnpm lint
```

> ⚠️ El gate **no cubre `scripts/`** (ver deuda viva). Un script puede estar roto
> con todo en verde.
