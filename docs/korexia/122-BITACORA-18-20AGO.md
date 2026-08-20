# El relato del 18 al 20 de agosto de 2026

> **Dentro:** Tres días, 30 commits · El día que se descubrió que la Fase 2 nunca
> había funcionado · Lo que aprendió el proyecto · Los errores propios
>
> Los pendientes que deja están en [121](121-PENDIENTES-20AGO.md). Este
> documento cuenta **cómo se llegó ahí**; cada cambio tiene además su propio
> documento, enlazado donde toca.

Tres días con un arco claro: el **18** cerró el vertical de citas por fuera (lo
que la dueña puede tocar), el **19** lo cerró por dentro (lo que el agente puede
prometer), y el **20** fue el día de la arquitectura — y el día en que se
descubrió que la pieza central llevaba semanas sin funcionar.

---

## 18 de agosto — el salón, por fuera

Nueve commits, casi todos sobre lo mismo: **cosas que la dueña del salón veía
mal o no podía hacer.**

- El calendario **cortaba el nombre del servicio**, y en un salón con 48
  servicios eso es no poder distinguirlos.
- La lista de citas mostraba **todas**, no las del día que estabas mirando.
- Reservar a mano un servicio que no cabía antes del cierre fallaba **sin decir
  por qué**.
- Los servicios pasaron a **categorías en desplegable**, y la matriz de quién
  atiende qué se guarda a propósito ([213dbe0]).
- **Recursos compartibles** ([100](100-RECURSOS-COMPARTIBLES.md)): archivo,
  enlace o los dos — lo decide el negocio, no el código.
- El catálogo siguió saliendo del script y entrando al CRM (paso 3B).

Y en medio, una **regla de negocio que el agente se había inventado solo**: que
una cita debe *terminar* antes del cierre. Nadie lo había escrito. El dueño
dictó lo contrario —**el cierre limita cuándo EMPIEZA una cita, no cuándo
termina**— y hubo que taparlo dos veces, porque el modelo encontró otra excusa
para lo mismo ([123df6b]).

> Ese cambio tiene una cola larga: dejó **obsoleta una prueba escrita el
> 17-ago**, y dos días después esa prueba obsoleta hizo saltar una falsa alarma
> de doble reserva. Ver *Errores propios*.

El mismo día se dictaron las **[REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md)**
en la raíz del repo: el filtro obligatorio para cualquier cambio, de cualquier
IA, en cualquier sesión.

---

## 19 de agosto — el salón, por dentro

Ocho commits, y un patrón que se repite: **el agente prometía cosas que no había
verificado.**

| | Qué prometía sin comprobar |
|---|---|
| [101](101-GUARDARRAIL-RECURSO-PROMETIDO.md) | Decía que enviaba el catálogo y no lo enviaba |
| [103](103-REQUISITOS-IMPLEMENTADO.md) | Cerraba con un requisito declarado sin cumplir |
| [105](105-GUARDARRAIL-ESPECIALISTA-SIN-VERIFICAR.md) | Confirmaba especialista sin verificar disponibilidad |
| [109](109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md) | **Negaba** disponibilidad sin verificarla |

Ese último es el más interesante, porque es la mitad que faltaba: todos los
guardarraíles vigilaban que no *afirmara* de más, y ninguno que no *negara* de
más. Un agente que dice «no hay» sin mirar pierde la venta en silencio, y no
deja rastro en ningún log.

También ese día: **reservas de varias personas** en un mismo turno
([108](108-RESERVAS-DE-VARIAS-PERSONAS.md)), el **pago al confirmar una cita**
como dato declarado por el negocio y no inferido por el modelo
([107](107-PAGO-ANTES-DE-LA-CITA.md)), y un bug real en `buscarServicio`, que no
marcaba ambigüedad en el paso por subcadena
([104](104-ALGORITMO-BUSCAR-SERVICIO-SUBSTRING-AMBIGUO.md)).

Y una auditoría que terminó **sin implementar nada, a propósito**: una cita se
confirma sin pedir el nombre de la clienta
([102](102-REQUISITO-NOMBRE-EN-CITAS.md)). Sigue abierta.

---

## 20 de agosto — el día de la arquitectura

Trece commits. Es el día más denso de los tres y merece contarse por partes.

### 1. La Fase 2 nunca había funcionado

Se iba a pasar Lashes Valen a la Fase 2 dando por hecho que el mecanismo estaba
probado. No lo estaba: **el modelo no devolvía la clave `estado`. Cero de tres
llamadas.** Llevaba así desde que se implementó, y nadie se había enterado
porque el sistema **cae con elegancia** — sin `estado`, sigue funcionando con el
prompt, exactamente igual que antes.

Cinco hipótesis se descartaron con **30 llamadas reales** antes de encontrarlo
([110](110-EL-MODELO-NO-EMITIA-EL-ESTADO.md)). El arreglo:
`response_format: json_schema` con `strict: true`. **El estado se le exige al
proveedor, no se le ruega en el prompt** ([bf2fad7]).

> 🔑 La lección no es sobre JSON. Es que **un mecanismo que degrada en silencio
> no se puede dar por probado porque «no dio errores»**. No dar errores era
> justamente su comportamiento roto.

Con eso arreglado, la Fase 2 se encendió en los tres negocios. `conversation_state`
tiene hoy 25 filas de conversaciones reales.

### 2. Lis entra en la arquitectura nueva

Ficha por secciones, catálogo a tablas y estado en el backend
([111](111-LIS-EN-LA-ARQUITECTURA-NUEVA.md),
[115](115-LIS-POR-SECCIONES-Y-EL-CATALOGO-DUPLICADO.md)). De paso se le quitó
del prompt una **copia del catálogo que estaba dos veces** — una en el texto y
otra que el pipeline inyecta desde las tablas.

Y las fichas nuevas ya **nacen por secciones**, en vez de nacer en el formato
viejo y convertirse después ([114](114-LA-FICHA-NUEVA-NACE-POR-SECCIONES.md)).

### 3. El incidente de Rappi, y por qué no se arregló en Lis

Un cliente preguntó por Rappi y el agente de Lis contestó que **no manejan
domicilios por Rappi**. Lis sí tiene Rappi.

El arreglo fácil era una regla en la ficha de Lis. El dueño pidió
explícitamente lo contrario: *una solución para todo el ecosistema, no única
para Lis*. Salieron **dos** cambios, y son de naturaleza distinta:

- **[118](118-NO-NIEGUES-LO-QUE-NO-SABES.md)** — la mitad que le faltaba a *"no
  inventes"*. Un agente al que solo se le prohíbe afirmar de más, niega de más.
- **[119](119-CANALES-EXTERNOS.md)** — `canales` en el modelo de ficha, con su
  pregunta en el cuestionario. **Dónde más te pueden pedir** es un dato que
  cualquier negocio de comida tiene, así que es del modelo, no de un cliente.

### 4. La modalidad del pedido

Los requisitos de un pedido dependen de **cómo se entrega**: pedir la dirección
a quien va a recoger en el local es tan malo como no pedírsela a quien quiere
domicilio. `modalidadDeEntrega` entró al estado, y los requisitos se recalculan
cuando se conoce ([116](116-LA-MODALIDAD-DEL-PEDIDO.md)).

Con una decisión deliberada: **no se subió `SCHEMA_VERSION`**. `leerEstado`
descarta los estados *más nuevos* que el código, así que subirlo habría hecho
que un contenedor aún sin desplegar tirase los pedidos en curso.

### 5. El cuestionario, dos defectos el mismo día

El dueño abrió el cuestionario de Lis y lo vio **todo vacío**, mientras su
agente contestaba con esa misma configuración. *"Si el CRM es la fuente de
verdad, ¿cómo va a responder el bot?"*

Eran dos fallos distintos, con el mismo origen:

1. **[117](117-EL-CUESTIONARIO-VEIA-VACIO.md)** — no precargaba. Un negocio
   configurado por script veía el formulario en blanco.
2. **[120](120-EL-CUESTIONARIO-GUARDA-LO-QUE-PREGUNTA.md)** — pedía cuatro
   campos que **no podía guardar**: el saludo, las reglas propias y el paso 8
   entero, que el propio formulario llama *la etapa más importante*.

El segundo obligó a revisar una regla del [68](68-UN-DUENO-POR-DATO.md) que
parecía intocable. La conclusión: prohibir escribir era una **mitigación** del
formulario en blanco, y una vez arreglada la causa, lo que protege el trabajo
ajeno es que **omitir no borre** — que protege a todos los escritores, no solo a
uno.

---

## Los errores propios

Se anotan porque el proyecto tiene la regla de no confiar en la documentación, y
eso incluye no maquillar la propia.

| Qué | Cómo se cazó |
|---|---|
| **Una falsa alarma de doble reserva.** Se reportó como bug que la disponibilidad ofreciera un turno a las 18:30. Era correcto desde el cambio del 18-ago: **la prueba estaba obsoleta, no el código** | Releer el cambio del 18-ago antes de tocar nada |
| **Un esquema JSON permisivo** devolvía `estado` pero perdía `text`: el cliente se habría quedado **sin respuesta** | Una prueba, antes de desplegar |
| **Catálogo duplicado en el prompt de Lis**, por activar la bandera `tabla` sin regenerar | El guard de `convertir:ficha` |
| **`migrar-modalidad.ts` comparaba contra el prompt guardado**, mezclando el cambio nuevo con desfase viejo de `conducta.ts` | Comparar ficha-vieja-recompilada contra ficha-nueva-recompilada |
| **`fusionarBorrador` devolvía el borrador si no estaba vacío**, y el de Lis tenía un solo campo: le tapaba la ficha entera | Mirar los datos reales, no las pruebas |
| **Una prueba de propiedad pasaba con la puerta cerrada** (`["negocio"]`), no con la que usa producción | Hacerla fiel a la ruta real |
| **Un guard de secciones pasaba porque su fixture no tenía el campo nuevo** | Tipar el fixture como `Required<…>` para que TypeScript obligue |
| **Greps malos en el contenedor** (`|` sin `-E`, y texto con tildes por SSH) dieron 0 y casi producen un *"no está desplegado"* falso | Repetirlo con literales ASCII |
| **Dos scripts de flota llevaban cinco días rotos** (desde el 15-ago) y el `typecheck` pasaba en verde | Ejecutarlos. `tsconfig` excluye `scripts/` |

Y uno que no es un error de código: **una captura de pantalla con el token de
OpenRouter completo** entró en la conversación. Está en los pendientes como
rotación urgente.

---

## Lo que aprendió el proyecto

1. **Lo que degrada en silencio hay que probarlo a propósito.** La Fase 2 no dio
   un solo error en semanas de no funcionar.
2. **Escribir una lección en `conducta.ts` no la entrega.** Hay que regenerar la
   flota; hasta entonces solo la hereda el cliente siguiente.
3. **Un síntoma en un cliente casi nunca se arregla en ese cliente.** Rappi
   parecía un dato de Lis y era un hueco del modelo de ficha.
4. **Prohibir no es arreglar.** Una prohibición que tapa una causa sobrevive a la
   causa y estorba.
5. **Dos arreglos correctos pueden hacerse daño juntos.** Precargar el formulario
   y darle permiso de escritura iban a borrarle 13 reglas a un cliente real.
