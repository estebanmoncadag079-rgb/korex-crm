# Documentación de korex.ia

Esta carpeta documenta **korex.ia**: qué es, cómo funciona de verdad en
producción, qué se cambió y qué quedó pendiente.

> ⚠️ **El `README.md` de la raíz es de Vocero CRM (el proyecto del que nace
> korex.ia) y ya NO describe esta instalación.** Dice cosas que hoy son falsas
> aquí: que "una instancia = un negocio" (korex.ia es multi-cliente), que se
> despliega con Coolify (usamos EasyPanel) y que WhatsApp va por Meta directo
> (va por YCloud). Cuando haya contradicción, **manda esta carpeta**.

## Cómo está organizado

| Archivo | Qué contiene |
|---|---|
| [01-QUE-ES-Y-ARQUITECTURA.md](01-QUE-ES-Y-ARQUITECTURA.md) | Qué es korex.ia, en qué se diferencia de Vocero, el stack y cómo se aísla cada cliente |
| [02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md) | El servidor, EasyPanel, Traefik, los dominios y **cómo desplegar un cambio** |
| [03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md) | Cómo entran y salen los mensajes, webhooks, coexistencia y la ventana de 24 h |
| [04-AGENTE-IA.md](04-AGENTE-IA.md) | Cómo decide y responde el agente: prompt, horario, guardarraíles y agrupación de mensajes |
| [05-CLIENTES.md](05-CLIENTES.md) | Cómo se da de alta un cliente y el estado real de La Churra y Lis Pastelería |
| [06-RESPALDOS.md](06-RESPALDOS.md) | Qué se respalda, qué no, y cómo levantar el servicio desde cero |
| [07-BITACORA.md](07-BITACORA.md) | Historial de cambios con fecha: qué se hizo y por qué |
| [08-PENDIENTES.md](08-PENDIENTES.md) | **Qué quedó y qué no**, decisiones tomadas y opciones descartadas |
| [09-COSTOS.md](09-COSTOS.md) | El contador de gastos: cuánto cuesta cada cliente en IA y en WhatsApp |
| [10-SEGURIDAD.md](10-SEGURIDAD.md) | Auditoría: qué se corrigió, qué falta y qué está bien hecho. Y **qué pasa si un cliente olvida su contraseña** |
| [11-APRENDIZAJE.md](11-APRENDIZAJE.md) | Cómo crece el conocimiento del agente leyendo conversaciones reales |
| [12-BITACORA-ANTERIOR.md](12-BITACORA-ANTERIOR.md) | Historial del 30 y la madrugada del 31 de julio |
| [13-AUDIO-E-IMAGENES.md](13-AUDIO-E-IMAGENES.md) | Notas de voz y fotos: cómo se convierten a texto y qué se hace con los comprobantes de pago |
| [14-COTIZAR.md](14-COTIZAR.md) | **Cuánto cobrarle a un cliente**: costo real medido por mensaje, paquetes por tamaño y por qué el precio no sale del costo |
| [15-VENDER.md](15-VENDER.md) | Qué preguntarle al cliente antes de dar un precio, cómo se cobra el marketing y los errores que salen caros |
| [16-AGENTE-RELEVO-Y-MODELOS.md](16-AGENTE-RELEVO-Y-MODELOS.md) | Segunda parte del agente: relevo con personas, aviso de pedido, qué modelo corre y el Laboratorio |
| [17-BITACORA-JULIO.md](17-BITACORA-JULIO.md) | Historial más antiguo, hasta el 29 de julio |
| [18-MOVIL.md](18-MOVIL.md) | Cómo se comporta la aplicación en un celular, los puntos de corte y las reglas para no romperlo |
| [19-CITAS.md](19-CITAS.md) | El vertical de citas (peluquería, estética): opt-in por cliente, motor de disponibilidad, cómo prueba el agente sin gastar WhatsApp |
| [20-BITACORA-31JUL-TARDE-NOCHE.md](20-BITACORA-31JUL-TARDE-NOCHE.md) | Historial del 31 de julio (tarde y noche): seguridad, embudo, audio/imágenes |
| [21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md) | Continuación de 08: qué falta desplegar y verificar de citas y del arreglo de nombres de usuario de WhatsApp (BSUID) |
| [22-AUDITORIA-3AGO.md](22-AUDITORIA-3AGO.md) | Auditoría con 3 agentes (seguridad, refactorización, revisión de código): bugs reales corregidos, deduplicación y qué se decidió no tocar |
| [23-BITACORA-3AGO-NOCHE.md](23-BITACORA-3AGO-NOCHE.md) | Cuatro bugs reales de "el bot no responde" (edición de WhatsApp, handoff mudo, BSUID rechazado como teléfono), la tabla `webhook_event`, un incidente de despliegue con lección aprendida, horario de domingo y el menú inicial de Lis |
| [24-MENSAJES-UNSUPPORTED.md](24-MENSAJES-UNSUPPORTED.md) | Los mensajes que **Meta entrega vacíos**: por qué el bot no responde, el payload real, cada cuánto pasa y cómo reconocerlo en 30 segundos. Además: **los emojis sí se leen**, y qué no ve el agente (reacciones, stickers) |
| [25-UPSTREAM-VOCERO.md](25-UPSTREAM-VOCERO.md) | ¿Conviene traer la actualización de Vocero CRM? Qué sirve, qué no, el bug latente de identidad que destapó y por qué el merge está descartado |
| [26-NEA-AGENT.md](26-NEA-AGENT.md) | Qué se tomó del agente de citas `nea-agent`: que una respuesta no se pierda si falla el envío, agendar solo lo ofrecido, y la regla anti off-topic |
| [27-VENTA-PERDIDA-JORGE.md](27-VENTA-PERDIDA-JORGE.md) | La venta que se perdió porque el cliente se corrigió a sí mismo: un turno sin nada que responder dejaba mudo a Gemini y disparaba un handoff falso |
| [28-BITACORA-4-6AGO.md](28-BITACORA-4-6AGO.md) | **Historial del 4 al 6 de agosto**: cinco casos de "no respondió" (tres con la misma causa de fondo), los dos repos revisados y el despliegue que no llevaba nada |
| [29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md) | Por qué un salón no puede recordar citas sin plantilla, qué cuesta, quién la crea y por qué octubre de 2026 no lo arregla |
| [30-SALON-PRUEBAS.md](30-SALON-PRUEBAS.md) | El catálogo real del primer cliente de citas y la tanda de pruebas antes de su día 1: cinco bugs encontrados y 35 escenarios verificados |
| [31-BITACORA-7AGO.md](31-BITACORA-7AGO.md) | **Historial del 7 de agosto**: el primer cliente de citas, los cinco datos que le faltaban al agente, lo que la dueña no podía hacer y qué se descartó |
| [32-CATALOGO-SALON.md](32-CATALOGO-SALON.md) | **El catálogo oficial del salón**, precio por precio: los 12 retoques que estaban mal cargados, las reglas que van al KB y lo que el catálogo no dice |
| [33-ESCALABILIDAD.md](33-ESCALABILIDAD.md) | **De 3 a 100 clientes**: por qué la máquina no es el problema, los seis bloqueadores reales medidos con evidencia, y en qué orden se atacan |
| [34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md) | La cola en Postgres que sustituyó al debounce en memoria: cómo funciona, qué mirar cuando falla y cómo levantar varias réplicas |
| [35-BITACORA-8-9AGO.md](35-BITACORA-8-9AGO.md) | **Historial del 8 y 9 de agosto**: el catálogo oficial del salón, el diagnóstico de escalabilidad medido, la cola de turnos y las primeras pruebas contra Postgres real |
| [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md) | 🔴 **Todo lo pendiente, ordenado por riesgo e impacto real.** Empieza por aquí si retomas el proyecto |
| [37-EMBUDO-VENTAS-INVISIBLES.md](37-EMBUDO-VENTAS-INVISIBLES.md) | Por qué el tablero decía 16 clientes cuando había 31: el embudo solo se cerraba si actuaba el agente, y en Lis atiende una persona. Y el lado simétrico: **los que se enfrían bajan solos a "Por recuperar" a los 2 días** |
| [38-GUARDARRAILES.md](38-GUARDARRAILES.md) | **Cuando el prompt no basta**: los tres guardarraíles del servidor, por qué existen, cómo se añade uno y cuándo NO conviene |
| [39-BITACORA-9AGO-TARDE.md](39-BITACORA-9AGO-TARDE.md) | **Historial de la tarde del 9 de agosto**: si Lis sigue siendo rentable en octubre (sí, al 94 %), el costo por llamada en el panel, el chat dentro del Pipeline y el embudo de los que se enfrían |
| [40-MARKETING-Y-CONTENIDO.md](40-MARKETING-Y-CONTENIDO.md) | **Cómo se promociona korex.ia**: qué se puede prometer y qué no, el guion base de video, los ganchos que salen de datos reales, cómo producirlo gratis y la regla de no mostrar conversaciones de clientes |
| [41-BITACORA-10-11AGO.md](41-BITACORA-10-11AGO.md) | **Historial del 10 y 11 de agosto**: por qué se sigue con YCloud y no con Meta directo, las dos fechas que hay que anotar (v4 y los 13 días de la coexistencia), y qué pasa si un cliente olvida su contraseña |
| [42-DOMINIO-SUSPENDIDO.md](42-DOMINIO-SUSPENDIDO.md) | 🔴 **23 h sin que ningún bot respondiera, con todo el servidor sano**: Hostinger suspendió el dominio por la verificación de ICANN. Por qué el monitor no se enteró, y **el chequeo externo que se le añadió** (nameservers, DNS, HTTPS, certificado, vencimiento) |
| [43-SEO-Y-GOOGLE.md](43-SEO-Y-GOOGLE.md) | **Que a korex.ia la encuentren en Google**: el `Disallow: /` que le prohibía entrar, el robots dinámico que abre la portada sin exponer el CRM, Search Console, el perfil de empresa y la cuenta de demostración "Studio Bella" |
| [44-BITACORA-12AGO.md](44-BITACORA-12AGO.md) | **Historial del 12 de agosto**: el dominio suspendido, el SEO, y **la cadena que rompía el bot de Lis** (79 % de los pedidos sin datos de pago) — con la lección de que era el prompt y no el modelo |
| [45-GENERADOR-DE-PROMPTS.md](45-GENERADOR-DE-PROMPTS.md) | 🔑 **El cambio que hace escalable el alta**: separa lo único de cada negocio (la ficha, del cuestionario) de las lecciones que valen para todos (la conducta). Un cliente nuevo **nace inmunizado sin copiar el prompt de nadie**, y un fallo nuevo se corrige una vez para toda la flota |
| [46-CONFIGURACION-INICIAL.md](46-CONFIGURACION-INICIAL.md) | 🔑 **El cliente arma su propio agente**: 9 etapas en su cuenta, sin que nadie transcriba nada. Cierra "el techo real" del proyecto. Incluye **por qué el prompt lo genera código y no una IA**, y el lector de cartas por foto |
| [47-FOTOS-DEL-AGENTE.md](47-FOTOS-DEL-AGENTE.md) | **El agente envía la foto del producto que le preguntan** (no álbumes): dónde viven las fotos y por qué en la base, las cuatro degradaciones para que una foto no cueste una conversación, y **los dos fallos que solo aparecieron probando contra el modelo real** |
| [48-AFINAR-PROMPTS.md](48-AFINAR-PROMPTS.md) | 🔧 **Cómo tocar el prompt de un cliente que factura sin romperlo**: los cinco pasos (respaldar, cambiar, probar, comparar, restaurar) y **por qué La Churra NO se migró al generador** — con la comparación que lo demuestra |
| [49-EL-PORTAZO-Y-EL-COLOR.md](49-EL-PORTAZO-Y-EL-COLOR.md) | 🔑 **El hueco también enseña**: sin una regla para lo que no encaja, el agente se inventó un portazo copiando el molde del mensaje de "cerrado" — arreglado en el contrato, para toda la flota de una vez. Y **el `limit 1` que pintaba la aplicación entera con el color de un cliente**, login y portada pública incluidos |
| [50-LA-AGENDA-QUE-PARECIA-LLENA.md](50-LA-AGENDA-QUE-PARECIA-LLENA.md) | 🔑 **NaN no es un error, es una respuesta**: un horario escrito "9 AM" hacía `Number("9 AM")` → NaN, y una agenda sin huecos es idéntica a una llena — el agente rechazó todas las citas sin un solo error en ningún log. Incluye **por qué un negocio de citas no puede cerrar como uno de pedidos** |
| [51-LABORATORIO-PUERTA-A-PRODUCCION.md](51-LABORATORIO-PUERTA-A-PRODUCCION.md) | 🔑 **Un banco de pruebas que miente es peor que ninguno**: guiones de comida corridos contra un salón, y un juez que citaba al cliente como evidencia. Qué se le exige ahora a cada prueba, **la regla de la salud (eso lo contesta una persona)** y el fin del modelo de respaldo |
| [52-CARGAR-EL-CATALOGO-DE-CITAS.md](52-CARGAR-EL-CATALOGO-DE-CITAS.md) | **Un salón no tenía dónde subir sus servicios**: el alta le ocultaba el paso y la única puerta era teclearlos de uno en uno (son 46). Pegar la lista, **el PDF leído en el navegador** (36 MB → 2,9 KB de texto) o la foto, con tabla de revisión, y **por qué la duración de cada servicio no puede quedar vacía** |
| [53-DOS-CITAS-A-LA-MISMA-HORA.md](53-DOS-CITAS-A-LA-MISMA-HORA.md) | 🔑 **Dos clientas podían reservar a la misma especialista a la misma hora**: el hueco entre consultar la disponibilidad y escribir la cita, reproducido 4 de 4 contra Postgres real. La restricción `EXCLUDE` que lo cierra, **el rango semiabierto que no se puede tocar** y las 13 pruebas del motor (crear, encadenar, correr, cancelar, carrera) |

| [54-UN-ARREGLO-PARA-TODA-LA-FLOTA.md](54-UN-ARREGLO-PARA-TODA-LA-FLOTA.md) | 🔑 **La regla de la casa: un arreglo tiene que servirle a todos los clientes.** El prompt quedaba materializado y la ficha se perdía, así que una lección nueva solo la heredaba el cliente SIGUIENTE. La ficha se guarda, `pnpm regenerar:flota` rehace la flota entera, y la regla de pedidos fuera de horario que el sistema pedía y nadie había escrito |

| [55-VEINTICUATRO-CLIENTES.md](55-VEINTICUATRO-CLIENTES.md) | 🔑 **24 clientes distintos contra el agente real, con comprobaciones objetivas** (no un juez): efectivo, datos de pago antes de tiempo, alergias, reclamos, el total a mitad, modismos, el proveedor que ofrece sus servicios. Encontró dos fallos reales —y dos falsos positivos del propio banco, que también se arreglaron— |

| [56-BITACORA-13-14AGO.md](56-BITACORA-13-14AGO.md) | **Historial del 13 y 14 de agosto**: los cuatro fallos que estaban vivos y no daban error en ningún log (las duraciones que se tiraban, dos citas a la misma hora, la clienta que confirmaba tres veces, los pedidos vacíos), el catálogo que se pedía dos veces, la flota que ahora hereda, y **lo que NO se hizo y por qué** |

| [57-PENDIENTES-14AGO.md](57-PENDIENTES-14AGO.md) | 🔴 **Lo que queda tras el 14-ago**: el agente del salón sigue apagado, las duraciones y la matriz de especialistas están sin confirmar con la dueña, y la ficha de Lis quedó escrita pero sin activar (mientras tanto recibe los guardarraíles, pero no la conducta nueva) |

| [58-EL-CATALOGO-VIVE-EN-SERVICIOS.md](58-EL-CATALOGO-VIVE-EN-SERVICIOS.md) | **En citas el catálogo se pide UNA vez, en Servicios**: se estaba cargando dos veces y una copia empezaba a quedarse vieja el mismo día. La comparación con la lista del cliente (nuevos, precios distintos, los que ya no están), el reparto entre especialistas desde la misma pantalla, y las dos trampas — un hueco NO es un cambio, y la duración típica solo vale para los nuevos |

| [59-APRENDER-DEL-HISTORIAL.md](59-APRENDER-DEL-HISTORIAL.md) | 🔑 **Los 6 meses de chats que trae la coexistencia**: se estaban ignorando en el webhook. Ahora se guardan (sin despertar al agente ni tocar la ventana de 24 h) y el botón *Aprender del historial* saca conocimiento de lo que el negocio ya le había contestado a sus clientas |

| [60-CONECTAR-UN-CLIENTE-CON-SU-YCLOUD.md](60-CONECTAR-UN-CLIENTE-CON-SU-YCLOUD.md) | 🔑 **La receta de conectar un cliente que trae su propia cuenta de YCloud**: el orden que evita perder mensajes, los dos muros de Meta (los "eventos automáticos" y el sitio web), cómo verificar sin adivinar con tres comandos, y **por qué el cuestionario pisa lo que se ajusta a mano** |

| [61-UNA-SOLA-PUERTA.md](61-UNA-SOLA-PUERTA.md) | 🔑 **Cada dato se escribe en un solo sitio**: el cuestionario borraba el conocimiento de la pantalla y deshizo una corrección de salud ya verificada. Qué se quitó del cuestionario y de la pantalla del agente, por qué la conducta no se edita cliente por cliente, y la lección de fondo — *una verificación sobre algo que el siguiente clic deshace no verifica nada* |

| [62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md](62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md) | 🔴 **Plan propuesto, NO aprobado**: sacar del prompt el estado de la conversación (hoy el prompt le pide al modelo que "relea el historial" porque el pedido no existe como dato). Incluye el roadmap por fases, el diseño de datos… y **las cinco objeciones que siguen abiertas**, empezando por la más incómoda: nadie ha medido cuántos pedidos se pierden de verdad |

| [63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md](63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md) | **La Fase 1, hecha**: el menú de pedidos sale del prompt a `product`. La receta de tres pasos para migrar un cliente (ver → escribir → encender), el rollback de un comando, y las **cuatro trampas** que aparecieron al hacerlo — incluida la del formato real de la ficha, que se comía cuántas salsas lleva cada presentación |

| [64-BITACORA-14-15AGO.md](64-BITACORA-14-15AGO.md) | **El relato del 14 y 15 de agosto**: la cuenta que nunca se creó, el cuestionario que borraba el conocimiento, las **tres causas** por las que el bot no respetaba el orden (ninguna era el modelo), la Fase 0 que midió y descartó, y lo que se descubrió sin buscarlo |

| [65-PENDIENTES-15AGO.md](65-PENDIENTES-15AGO.md) | 🔴 **LO QUE HAY QUE LEER AL RETOMAR**: lo urgente por orden, qué bloquea al salón, la deuda que volverá a morder y el estado del roadmap |

| [66-REGLAS-FASE-2.md](66-REGLAS-FASE-2.md) | ⛔ **LAS CATORCE REGLAS OBLIGATORIAS de la Fase 2**, dictadas por el dueño. No son consejos: un cambio que incumpla una no entra, aunque funcione. **Leer antes de escribir una sola línea de la Fase 2** |

| [68-UN-DUENO-POR-DATO.md](68-UN-DUENO-POR-DATO.md) | 🔴 **El prompt con dos escritores**: las 9 rutas que escriben `agent_profile`, las 5 colisiones, y por qué repartir campos no basta (lo derivado no se escribe: se recompila). Diagramas del flujo actual y propuesto, y plan de migración con rollback |

| [69-FASE-2-ESTADO-ESTRUCTURADO.md](69-FASE-2-ESTADO-ESTRUCTURADO.md) | **La Fase 2: implementada y APAGADA**. El modelo del estado, el validador, el extractor, cómo se conecta al pipeline y qué bloquea encender la bandera. Incluye cómo encender y cómo apagar |

| [71-BITACORA-15AGO.md](71-BITACORA-15AGO.md) | **El relato del 15 de agosto**: la Fase 1 que no estaba desplegada, las tres cosas que las mediciones desmintieron, el día que una prueba causó el fallo que buscaba, las cuatro puertas y el arranque de la Fase 2 |

| [70-PENDIENTES-16AGO.md](70-PENDIENTES-16AGO.md) | 🔴 **LO QUE HAY QUE LEER AL RETOMAR**: las tres decisiones que bloquean la Fase 2, la deuda viva y los comandos útiles |

| [72-COMO-ENCENDER-LA-FASE-2.md](72-COMO-ENCENDER-LA-FASE-2.md) | 🔴 **La lista de la Fase 2**: 18 tareas numeradas y clasificadas (bloqueante · recomendada · opcional), cuáles escriben en producción, el camino mínimo en orden, y el bug latente que se activaba justo al cargar las opciones |

| [67-FASE-1.5.md](67-FASE-1.5.md) | 🔵 **Validar antes de persistir**: la Fase 2 **no puede escribir en la base** hasta que la validación semántica y las métricas den evidencia. Las dos tareas obligatorias, las prohibiciones y la pregunta que decide si se sigue o se para |

Cada archivo empieza con una línea **Dentro:** que lista sus apartados — para
localizar algo sin abrirlos todos.

## Convenciones de esta documentación

- **Ningún archivo pasa de 200 líneas.** Al llegar, se parte en uno nuevo y se
  enlaza desde el que lo origina.
- **Lo verificado se marca como verificado**, con la fecha y cómo se comprobó.
  Si algo viene de notas y no se ha vuelto a comprobar, se dice.
- **Las horas van en UTC salvo que diga "Colombia"**. El servidor corre en UTC;
  Colombia es UTC−5. Es la confusión que más veces ha hecho perder tiempo aquí.
- Los comandos que aparecen son los que se ejecutaron de verdad, no ejemplos.

## Cómo se organiza el trabajo (una sola carpeta, no una por cliente)

Todo se trabaja desde **`C:\bots\KOREX.IA`**. Separar el proyecto por cliente
sería un error: **el código es uno solo**, y tener una copia por negocio
obligaría a repetir cada arreglo tantas veces como clientes haya — hasta que
uno se quedara sin él.

```
C:\bots\KOREX.IA\
├── vocero\        EL CÓDIGO (repo korex-crm). Uno solo, para todos.
│   └── docs\korexia\   esta documentación
└── clientes\      material que entrega cada negocio (menús, logos, notas)
    ├── la-churra\
    └── lis-pasteleria\
```

| Qué se toca | Dónde vive | A quién afecta |
|---|---|---|
| Código, pantallas, reglas del agente | `vocero/` | **TODOS** los clientes a la vez |
| Prompt, conocimiento, horario, número, marca | base de datos | **solo ese** cliente |
| Menús, logos, fotos, notas | `clientes/<negocio>/` | material de referencia |

**La regla que evita sustos**: tocar código mejora —o rompe— a todos el mismo
día, por eso cada cambio pasa por typecheck, lint y las pruebas antes de
desplegarse. Tocar los datos de un cliente no puede afectar a otro, y además
tiene efecto inmediato: el prompt se lee en cada mensaje, sin desplegar nada.

## Lo mínimo que hay que saber

**korex.ia es una sola instalación que atiende a varios negocios.** Un
contenedor, una base de datos, y dentro cada cliente vive aislado en su propia
"organización". Los arreglos del código llegan a todos los clientes a la vez;
lo que es propio de cada uno son solo sus datos: su prompt, su conocimiento,
su horario, su marca, su número y sus teléfonos de aviso.

**Estado a 9-ago-2026**: dos clientes en producción (La Churra y Lis
Pastelería) más la agencia y la organización de pruebas de citas — y un
**tercero a punto de entrar: un salón de belleza**, primer cliente real del
vertical de citas. El **8-ago llegó su catálogo oficial** y reemplazó al que se
había cargado a mano: 46 servicios, 5 especialistas, transcrito precio por
precio en [32-CATALOGO-SALON.md](32-CATALOGO-SALON.md).

El **8-9 de agosto se empezó a preparar el salto a 50-100 clientes**: se midió
que la máquina no era el límite (la app usa 93 MB y 0 % de CPU) y se sacó de la
memoria del proceso lo que ataba la instalación a **una sola instancia** — el
turno del agente ahora vive en una cola en Postgres
([34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md)). **Todo el código está desplegado
y verificado dentro del contenedor**, y la carpeta de EasyPanel quedó
sincronizada: ningún Desplegar futuro revierte nada.

La **tarde del 9** se trabajó el dinero y el embudo
([39-BITACORA-9AGO-TARDE.md](39-BITACORA-9AGO-TARDE.md)): quedó medido que
**cobrar 200.000 COP sigue dejando 94 % de margen** aunque Meta empiece a cobrar
los mensajes en octubre —el costo que pesa es el fijo, no Meta—, el panel de
consumo muestra ahora el **costo por llamada**, la conversación se abre **dentro
del Pipeline** y las tarjetas que llevan **2 días sin respuesta bajan solas a
"Por recuperar"** (49 se movieron al desplegar).

El **12 de agosto** ([44-BITACORA-12AGO.md](44-BITACORA-12AGO.md)) hubo dos
incidentes de fondo, y **ninguno estaba donde parecía**: el dominio suspendido
por Hostinger dejó **23 h sin servicio** con todo el servidor sano (el fallo
estaba *fuera* del servidor), y el bot de Lis llevaba dos semanas cerrando el
**79 % de los pedidos sin mandar los datos de pago** — por dos plantillas
pegadas en su prompt, no por el modelo. De ahí salieron el **chequeo externo
del monitor**, el **cuarto guardarraíl** y la apertura del sitio a Google
([43-SEO-Y-GOOGLE.md](43-SEO-Y-GOOGLE.md)), que hasta ese día le prohibía
entrar con un `Disallow: /`.

**Empieza por [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md)** si
retomas el proyecto: reúne **todo lo pendiente ordenado por riesgo e impacto
real**, y enlaza hacia atrás a [08-PENDIENTES.md](08-PENDIENTES.md) y
[21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md), que conservan el detalle.
WhatsApp por la API oficial de Meta a través de YCloud. Todo corre en un VPS
con EasyPanel.

> 🔦 **Si el reporte es "el bot no responde"**, no investigues desde cero:
> hay **14 causas ya confirmadas con evidencia real**, más una que todavía no ha
> pasado pero está documentada: **la app de WhatsApp Business del cliente debe
> abrirse una vez cada 13 días** o la coexistencia se cae
> ([41-BITACORA-10-11AGO.md](41-BITACORA-10-11AGO.md)). Las cuatro más
> recientes están en [27-VENTA-PERDIDA-JORGE.md](27-VENTA-PERDIDA-JORGE.md) y
> [24-MENSAJES-UNSUPPORTED.md](24-MENSAJES-UNSUPPORTED.md), y el resumen de
> todas, en la memoria del asistente. La que más veces ha vuelto, por caminos
> distintos: **si el último mensaje que ve el modelo no es del cliente,
> Gemini devuelve vacío** y el turno acaba en un handoff falso.

## Dónde está cada cosa

```
korexia.online            → la portada pública
crm.korexia.online        → la aplicación (bandeja, embudo, agente) y los webhooks
crm.korexia.online/admin  → panel de la agencia: alta y gestión de clientes
```

En el servidor:

```
/opt/korex-crm/                              base de datos, .env y backups
/etc/easypanel/projects/korex-crm/crm/code   el código que se construye
/etc/easypanel/traefik/config/main.yaml      los dominios (lo escribe EasyPanel)
```
