# Bitácora del 13 y 14 de agosto

> **Dentro:** Lo que se rompía y nadie veía · El catálogo · Las citas · Los dos
> guardarraíles nuevos · La flota · Lo que NO se hizo y por qué · Estado al
> cerrar

Un día largo. Empezó con *"¿dónde pongo el PDF?"* y acabó con seis
guardarraíles, dos clientes migrados y un banco de 24 escenarios.

## El hilo: cuatro fallos que estaban vivos y nadie veía

Ninguno de los cuatro daba error en ningún log. Todos se descubrieron
**buscando otra cosa**:

| Fallo | Cómo apareció | Dónde estaba |
|---|---|---|
| El alta **tiraba las duraciones** del catálogo leído | Preguntando dónde subir un PDF | Código (el alta rehacía el texto sin los minutos) |
| **Dos clientas podían reservar la misma hora** con la misma especialista | Probando el motor de citas | Base de datos (no había restricción) |
| La clienta confirmaba y **el agente le volvía a pedir confirmar** | Captura de una conversación real de Lis | Un guardarraíl tumbando el cierre legítimo |
| El agente **cerraba pedidos vacíos** | Migrando Lis al generador | Nada comprobaba que hubiera resumen |

## El catálogo: del PDF a quién lo atiende

- El **PDF** se lee en el alta y en Servicios ([52](52-CARGAR-EL-CATALOGO-DE-CITAS.md)).
- Se dejó de pedir el catálogo dos veces: en citas vive **solo en Servicios**,
  con su tabla de revisión, el reparto entre especialistas y el aviso de los que
  no atiende nadie.
- El alta de un salón termina avisando de que le falta ese paso — sin ese aviso
  volvíamos al fallo original, que era silencioso.

## Las citas: la restricción que faltaba

Reproducido 4 de 4: dos peticiones simultáneas creaban dos citas encima
([53](53-DOS-CITAS-A-LA-MISMA-HORA.md)). Lo cierra una restricción `EXCLUDE` en
Postgres, con rango semiabierto para no bloquear la cita que empieza justo
cuando acaba la anterior. 13 pruebas de integración contra Postgres real.

## Los dos guardarraíles nuevos

Quinto: **no se cierra un pedido que el cliente nunca vio**. Sexto: **le piden
el total y no lo da**. Los dos en [38](38-GUARDARRAILES.md), con su caso y su
fecha.

## La flota: un arreglo para todos

La ficha se guarda y `pnpm regenerar:flota` rehace los prompts con la conducta
al día ([54](54-UN-ARREGLO-PARA-TODA-LA-FLOTA.md)). Se vio funcionar el mismo
día: *"la más pedida es una petición de consejo, no un dato"* se escribió una
vez y La Churra y el salón lo heredaron con un comando.

También apareció una regla que **el sistema pedía y nadie había escrito**: el
marco le dice al agente *"aplica la regla de pedidos fuera del horario"* y esa
regla no existía en ninguna parte — solo estaba a mano en La Churra.

## Lo que NO se hizo, y por qué

- **Lis no se migró.** Su ficha está escrita y probada, pero su Laboratorio
  quedó entre 83 y 75 frente a los 92 del prompt que lleva meses funcionando.
  Eso no alcanza para tocarle el prompt al cliente que más factura. Su `ficha`
  quedó en `null` a propósito para que `regenerar:flota` la salte.
- **No se persiguió el último caso del total.** Intermitente, el cliente tiene
  los precios, y cerrarlo costaría un reintento más en cada turno de cada
  cliente.

## Estado al cerrar

| | |
|---|---|
| **La Churra** | Migrada al generador · ficha guardada · hereda lo nuevo |
| **Studio Bella (Lashen Valen)** | Ficha guardada · hereda lo nuevo · **el agente sigue APAGADO** |
| **Lis** | Prompt de siempre · sin ficha (a propósito) · **recibe los guardarraíles igual** |
| Pruebas | 543 en verde · 13 de integración de citas · 24 escenarios |
| Guardarraíles | 6 |

Lo que queda, ordenado por lo que duele, está en
[36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md).
