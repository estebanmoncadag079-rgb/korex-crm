# Documentación de korex.ia

Esta carpeta documenta **korex.ia**: qué es, cómo funciona de verdad en
producción, qué se cambió y qué quedó pendiente.

> ⚠️ **El `README.md` de la raíz es de Vocero CRM (el proyecto del que nace
> korex.ia) y ya NO describe esta instalación.** Dice cosas que hoy son falsas
> aquí: que "una instancia = un negocio" (korex.ia es multi-cliente), que se
> despliega con Coolify (usamos EasyPanel) y que WhatsApp va por Meta directo
> (va por YCloud). Cuando haya contradicción, **manda esta carpeta**.
>
> 🔴 **[REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md)** (raíz del
> repo, dictado por el dueño el 18-ago-2026): el filtro obligatorio para
> **cualquier** cambio, de cualquier IA, en cualquier sesión. El núcleo solo
> conoce catálogo/selección/datos/estado/validación/confirmación/registro —
> nunca una salsa, una pestaña ni un profesional como opción. Toda regla de
> negocio va en el CRM, nunca en código. **Toda solicitud se clasifica antes de
> implementarse** en una de cuatro categorías (config. de un cliente ·
> capacidad de un vertical · capacidad global del CRM · cambio arquitectónico).
> Léelo antes de tocar nada.

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

| [98-BITACORA-CATALOGO-EN-PDF.md](98-BITACORA-CATALOGO-EN-PDF.md) | **El agente ya puede enviar catálogos en PDF, no solo fotos**: `send_image` decide imagen o documento por el `mimeType` real, sin que el modelo sepa la diferencia. `ycloudSendDocument`/`sendDocument` nuevos, `pnpm subir:media` como puente hasta que exista una pantalla de fotos post-onboarding. El catálogo de Lashes Valen (36 MB) se comprimió a 1,5 MB antes de subirlo — la base entera pesa ~16 MB |

| [109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md](109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md) | 🔑 **El guardarraíl noveno, completado**: cubría "afirmar sin verificar" (Hilary/Volumen Ruso) pero no su mitad simétrica — el agente **negando** disponibilidad real ("ya no tenemos citas en la mañana", "ese horario ya no está disponible" para una hora que sí lo estaba). Medido contra 7 mensajes reales de la flota antes de escribir el criterio: 4 alucinados, 3 legítimos — y uno de los legítimos (negar una hora puntual apoyándose en la oferta del turno anterior) casi produce un falso positivo con el primer diseño. Se fusiona con el guardarraíl 9 existente, mismo bloque de reintento, sin crear uno nuevo |

| [108-RESERVAS-DE-VARIAS-PERSONAS.md](108-RESERVAS-DE-VARIAS-PERSONAS.md) | 🔑 **`book_appointment` solo podía agendar a UNA persona por turno**: una clienta pidió cita para ella y para su mamá, el agente confirmó las dos y solo se creó una — auditado con evidencia, descartando primero (correctamente) la sospecha de que el bot ignoraba citas puestas a mano. `reservas[]` reemplaza la fecha/hora/especialista única; cada reserva se procesa INDEPENDIENTE — si una falla, la otra igual queda agendada, decisión explícita del dueño para toda la flota. Mismo día, segundo hallazgo sin implementar: el agente también **niega** disponibilidad sin haber consultado (mitad simétrica del guardarraíl 9), pendiente de medir |

| [107-PAGO-ANTES-DE-LA-CITA.md](107-PAGO-ANTES-DE-LA-CITA.md) | 🔑 **El agente pedía NEQUI + comprobante al confirmar una cita en Lashes Valen, que NO cobra por adelantado** — proactivamente, sin que nadie lo pidiera. Auditoría con protocolo formal: la hipótesis textual del reporte ("confirma una cita ya ocurrida") no tenía un caso real en los datos; lo que sí había, cruzando los 11 comprobantes reales contra sus citas, era esto. Causa: `ficha.pago` solo declara CÓMO se paga, nunca CUÁNDO, y la instrucción universal dejaba esa condición a que el modelo la infiriera. Fix: un dato nuevo (`cierre.pagoAntesDeLaCita`, mismo patrón que los requisitos) con su propia pantalla en "Ajustar mi agente" — nada de guardarraíl |

| [106-ESPECIALISTA-VERIFICADA-TRAS-CONSULTAR.md](106-ESPECIALISTA-VERIFICADA-TRAS-CONSULTAR.md) | 🔑 **El mismo guardarraíl del 105, horas después, derivando a una clienta real que solo pedía su cita de siempre.** Auditoría con protocolo formal (sin aceptar hipótesis): la tabla `usage_event`, consultada por la etiqueta exacta de cada llamada al modelo, probó que el incidente real NO pasó por la rama que parecía sospechosa — pero esa rama sí tenía un bug real y demostrable por código, distinto del que causó el incidente. Se corrigió solo el bug demostrado (que el re-chequeo tras una consulta real resuelta no vuelva a aplicar el mismo criterio textual, igual que ya hacían "cita fantasma" y "recurso prometido"); el caso que sí causó el incidente quedó fuera, como decisión de producto pendiente |

| [105-GUARDARRAIL-ESPECIALISTA-SIN-VERIFICAR.md](105-GUARDARRAIL-ESPECIALISTA-SIN-VERIFICAR.md) | 🔑 **El noveno guardarraíl, y el primero que no adivina ni por regex de frases**: "¡Perfecto! Un retoque de Volumen Ruso con Hilary..." — ella no atiende ese servicio, y el modelo nunca llamó a `consult_availability`. Medido primero contra 20 mensajes reales: un regex de "confirmación + nombre" habría bloqueado una pregunta legítima (*"¿qué servicio con Valentina?"*). Se usa en su lugar un HECHO que el pipeline ya rastrea — cuántas veces se consultó disponibilidad en ese turno — combinado con una detección de texto que solo distingue afirmar de preguntar |

| [104-ALGORITMO-BUSCAR-SERVICIO-SUBSTRING-AMBIGUO.md](104-ALGORITMO-BUSCAR-SERVICIO-SUBSTRING-AMBIGUO.md) | 🔑 **`buscarServicio()` elegía el primer servicio por orden alfabético cuando había varios candidatos por substring** — "retoque" es substring de 19 servicios reales de un salón, y el sistema le decía a una clienta que su especialista de siempre "no hace retoques" cuando sí hacía 8 de los 16. Medido con el código real **antes** de tocar nada (incluida la tabla exacta pedida por el dueño), fix de una línea que reutiliza la desambiguación que el paso de tokens ya tenía, y control contra el catálogo de La Churra para confirmar cero cambios donde no hay ambigüedad. Cero menciones de Lashes Valen en el cambio |

| [103-REQUISITOS-IMPLEMENTADO.md](103-REQUISITOS-IMPLEMENTADO.md) | ✅ **Implementado el mismo día del 102**: el octavo guardarraíl (el primero que no detecta nada en el texto — comprueba datos), la acción `provide_requirement` en el contrato compartido, y la pantalla "Ajustar mi agente → datos antes de confirmar" que es solo interfaz de `cierre.requisitos`. Con **dos hallazgos no previstos en el diseño**: `contact.name` se rellena con el teléfono cuando no hay nombre real (habría dado el requisito por cumplido siempre), y qué pasa cuando se declara un requisito que el sistema todavía no sabe capturar |

| [102-REQUISITO-NOMBRE-EN-CITAS.md](102-REQUISITO-NOMBRE-EN-CITAS.md) | ✅ **Implementado — ver [103](103-REQUISITOS-IMPLEMENTADO.md).** La auditoría original: por qué una cita se confirma sin pedir el nombre (Fase 2 apagada → `requisitosDe()` nunca se evalúa), las tres alternativas contra 7 criterios, la decisión (guardarraíl genérico) y el bucle que frenó el primer diseño (`contact.name` no se actualizaba con lo que el cliente dice en el chat) |

| [101-GUARDARRAIL-RECURSO-PROMETIDO.md](101-GUARDARRAIL-RECURSO-PROMETIDO.md) | 🔑 **El cuarto guardarraíl, y la vez que la medición dio lo contrario que con el horario ese mismo día**: "prometió un catálogo/foto y no ejecutó `send_image`" apareció en 3 conversaciones de 2 negocios —una con una cita real agendada, no de pruebas— con 9 de 10 promesas sin cumplir. Incluye **dos bugs propios encontrados al escribir las pruebas** (el `\b` que no funciona tras una vocal acentuada, y una pregunta con el `?` lejos del recurso que seguía cazando) |

| [100-RECURSOS-COMPARTIBLES.md](100-RECURSOS-COMPARTIBLES.md) | 🔑 **Un recurso del negocio se entrega como archivo, como enlace o como ambos**, y lo declara el negocio — no el código ni el modelo. Nace de un catálogo prometido que nunca llegó, con la auditoría que descartó todas las causas fáciles (el `no se pudo mandar` = 0 que probó que el modelo jamás pidió el envío). El núcleo solo distingue archivo de enlace: no sabe qué es un menú, un catálogo ni un tarifario. Incluye los **dos defectos cerrados de paso** (una acción sin etiqueta ya no valida; un recurso no puede declarar lo que no tiene) y **la deuda dicha en voz alta**: un enlace externo puede morir en silencio |

| [99-PROBAR-EN-UNA-CONVERSACION-LIMPIA.md](99-PROBAR-EN-UNA-CONVERSACION-LIMPIA.md) | ⛔ **Un arreglo de prompt NO se verifica en la conversación donde se vio el fallo**: el modelo se copia de su propio historial y el arreglo parece no funcionar aunque esté perfecto (5 de cada 6 turnos, medido desde el 29-jul). Las dos pruebas lado a lado —misma hora, mismo servicio, mismo código: falla con historial, funciona desde un número limpio—, y **lo que esto NO cura**: las conversaciones que ya tienen la frase falsa escrita seguirán repitiéndola hasta que el guardarraíl las limpie |

| [97-BITACORA-RESERVA-MULTIPLE.md](97-BITACORA-RESERVA-MULTIPLE.md) | **Selección múltiple en citas, implementado**: "manos y pies" en una sola visita. `ReservaDeCita` en la raíz del estado (no por ítem), `appointment_service` nueva, `resolverEspecialistaMultiple`/`crearCitaMultiple` sobre la intersección de recursos, `book_appointment` con `servicios[]` propio —desacoplado de la Fase 2, que hoy ningún cliente tiene encendida—. La migración `0025` escrita y revisada a mano, **sin ejecutar contra ninguna base** |

| [96-BITACORA-RECURSOS-Y-RESERVAS.md](96-BITACORA-RECURSOS-Y-RESERVAS.md) | **El paso 4, implementado**: `staff_member`→`resource` (tipo libre), `appointment_resource` nueva (con el EXCLUDE de solape movido y su primer trigger), 12 funciones de `queries.ts` reescritas sin tocar `pipeline.ts` ni las rutas API. La migración `0024` escrita y revisada a mano, **sin ejecutar contra ninguna base** |

| [95-BITACORA-PASO1-ENCENDIDO-CHURRA.md](95-BITACORA-PASO1-ENCENDIDO-CHURRA.md) | **Paso 1 del encendido de La Churra, aplicado en producción**: repetición en SALSA y ADICIONES, la ficha corregida (chocolate negro/blanco), RECUBIERTO/ADICIONES cargados (40 filas), el banco de escenarios con su catálogo real y el caso que falló el 17-ago, y los 8 criterios del doc 69 revisados uno por uno |

| [94-BITACORA-PERMITE-REPETICION-CRM.md](94-BITACORA-PERMITE-REPETICION-CRM.md) | **El paso 3B, primera pieza**: `permite repetir` sale del script y entra al CRM. La API filtrada por organización, la pantalla que avisa del grupo imposible de completar, y por qué las 5 pruebas de integración quedaron escritas pero SIN ejecutar |

| [93-PENDIENTES-17AGO.md](93-PENDIENTES-17AGO.md) | 🔴 **LO QUE HAY QUE LEER AL RETOMAR.** Sustituye a la 70: los cuatro pasos medidos que separan a La Churra del encendido, el vertical de citas, la deuda viva y lo que no hay que volver a hacer |

| [92-BITACORA-17AGO.md](92-BITACORA-17AGO.md) | **El relato del 17 de agosto**: las diez fases, los errores propios —dos fichas rotas, una prueba que pasó por la razón equivocada— y lo que aprendió el proyecto. Con la ventana que se cierra: es la última vez que cambiar el estado sale gratis |

| [91-CATALOGO-DE-LA-CHURRA.md](91-CATALOGO-DE-LA-CHURRA.md) | **Lo que falta para encender**, medido en producción y sin aplicar: el chocolate con dos nombres que bloquea el encendido, los tres grupos de salsas que no admiten repetir y el recubierto que solo existe en el texto |

| [90-LA-CONDUCTA-EN-PLURAL.md](90-LA-CONDUCTA-EN-PLURAL.md) | **La otra mitad del paso 2**: de nada sirve que el estado aguante tres cosas si el agente las pregunta de una en una. La conducta común pluralizada en los DOS verticales —en citas, varios servicios son una visita con el tiempo sumado— y el vocabulario de comida que quedaba en el prompt que comparten todos |

| [89-EL-CONTRATO-DE-LOS-ITEMS.md](89-EL-CONTRATO-DE-LOS-ITEMS.md) | **El contrato v4, implementado**: un pedido lleva `items[]`, cada uno con su cantidad y sus opciones; `datos` se queda en la raíz porque son del cliente. Con el tope de 40 que no recorta en silencio, la tolerancia deliberada con el formato viejo, y por qué las 34 pruebas de antes pasaron sin cambiar una sola expectativa |

| [88-AUDITORIA-SELECCION-MULTIPLE.md](88-AUDITORIA-SELECCION-MULTIPLE.md) | 🔴 **LA AUDITORÍA UNIVERSAL, Y LA QUE MANDA SOBRE LA 87.** ¿Sostiene la arquitectura varios elementos en cualquier vertical? No — y el defecto está **duplicado en dos motores que no comparten código**. Tres hallazgos de fondo: **no existe la entidad Pedido** (33 tablas, ninguna), la Fase 2 sigue excluyendo citas, y quedan palabras de comida decidiendo en `sembrar.ts`. Con los tres escenarios y la recomendación validada contra los dos verticales |

| [87-PEDIDOS-MULTIPRODUCTO.md](87-PEDIDOS-MULTIPRODUCTO.md) | 🛑 **EL PASO 3.6, QUE BLOQUEA EL ENCENDIDO.** El carrito que nunca existió: el modelo actual en código, el inventario contado (10 archivos, 21 accesos, 39 usos), el estado propuesto con `items[]` y las cuatro respuestas. **La migración es gratis hoy —0 filas— y deja de serlo con el primer cliente encendido.** Aquí nace la regla 10 |

| [86-DOS-PRODUCTOS-EN-UN-PEDIDO.md](86-DOS-PRODUCTOS-EN-UN-PEDIDO.md) | 🔴 **LO QUE BLOQUEA EL ENCENDIDO DE LA CHURRA.** Una prueba real pidió dos productos y el agente preguntó lo que ya le habían dicho. Tres hallazgos: el estado solo sabe sostener UN producto, los nombres de la tabla y los del prompt no coinciden, y BESTIES no admite repetir en la base aunque el prompt del negocio diga que sí |

| [85-PROBAR-ESTADO.md](85-PROBAR-ESTADO.md) | **Los 12 criterios de salida** de la prueba de extremo a extremo, escritos ANTES de ejecutarla: siete de pedidos, cinco de citas, dos clientes efímeros. Y 🔴 el hallazgo de que `tsconfig` excluye `scripts/`, así que los programas que escriben en producción no se comprueban |

| [84-EL-MODELO-DE-LA-FICHA.md](84-EL-MODELO-DE-LA-FICHA.md) | 🔴 **Las dos representaciones de la ficha**, y por qué guardar la aplanada rompió dos fichas de producción. El inventario de las 7 escrituras, la regla —*una ficha transformada nunca se persiste*— y el guardarraíl que falló tres veces antes de servir |

| [83-RECURSOS-Y-RESERVAS.md](83-RECURSOS-Y-RESERVAS.md) | 🔴 **Paso 4, auditado**: hoy una reserva solo puede tener UN recurso y el horario es del negocio, no de quien lo atiende. Con la clínica, el taller y la academia como prueba de que hacen falta dos a la vez — y la restricción de solape, que es la joya del diseño, atada a `staff_id` |

| [82-EL-CATALOGO-AL-CRM.md](82-EL-CATALOGO-AL-CRM.md) | 🔴 **Paso 3, auditado**: el núcleo ya está listo — lo que falta es que un servicio pueda tener grupos como un producto. Con el hallazgo de por qué **el profesional NO es una opción** y por qué aquí se cierra la ventana de las migraciones gratis |

| [81-REQUISITOS-DECLARATIVOS.md](81-REQUISITOS-DECLARATIVOS.md) | 🔴 **Cómo sacar «entrega» del núcleo**: los 26 puntos cableados, la estructura de requisitos que los sustituye, qué es del núcleo y qué del vertical, y por qué `fecha`/`hora` NO son datos sino un recurso |

| [80-EL-CONCEPTO-DE-ENTREGA.md](80-EL-CONCEPTO-DE-ENTREGA.md) | 🔴 **El último acoplamiento del núcleo**: sigue dando por hecho que todo negocio entrega algo a domicilio. Y el hallazgo que lo cambia todo — **la ficha ya declara `haceDomicilios` y el validador no lo mira**, así que un negocio de solo recogida no podría cerrar un pedido |

| [79-ARQUITECTURA-MULTIEMPRESA.md](79-ARQUITECTURA-MULTIEMPRESA.md) | 🔴 **LA REGLA QUE MANDA SOBRE LAS DEMÁS**: esto no se construye para La Churra. Las siete reglas de arquitectura, las tres decisiones del 17-ago, la hoja de ruta en cuatro pasos y **la Fase 2 congelada** hasta terminarlos |

| [78-CAMBIAR-EL-MODELO-IMPACTO.md](78-CAMBIAR-EL-MODELO-IMPACTO.md) | 🔴 **Qué costaría cambiar el modelo**: 9 archivos, 61 aserciones, el prompt de extracción y la medición del 15-ago invalidada. Con la respuesta a las siete preguntas y el hallazgo de que **el `"0"` del reinicio sigue clavado** |

| [77-EL-MODELO-DE-LAS-OPCIONES.md](77-EL-MODELO-DE-LAS-OPCIONES.md) | 🔴 **La causa raíz de cinco errores seguidos**: el catálogo es una definición con ids y reglas; la selección del cliente es una lista de nombres sueltos. Y tres hallazgos nuevos, entre ellos que **el estado tiene los grupos de La Churra cableados** |

| [76-EL-MAPA-DE-LAS-SALSAS.md](76-EL-MAPA-DE-LAS-SALSAS.md) | 🔴 **Los 16 puntos que interpretan el catálogo**, y el hallazgo que salió del inventario: `sumaDeExtras` **cobra la salsa incluida como si fuera adición** porque mira las opciones sin mirar su grupo |

| [75-COMO-SE-DOCUMENTA.md](75-COMO-SE-DOCUMENTA.md) | 🔴 **La regla que gobierna a las demás**: todo cambio se documenta en el mismo instante y en el mismo commit. Las siete obligaciones —incluida *cómo revertirlo*—, el orden obligatorio, cuándo un cambio está terminado y la plantilla de bitácora |

| [74-REGLAS-DE-LOGS.md](74-REGLAS-DE-LOGS.md) | 🔴 **Reglas permanentes de los logs**: nada de estructuras completas ni texto del usuario, un solo módulo que sanea, y **ninguna tabla se instrumenta sin clasificar sus campos** (técnico · negocio · personal · secreto). Qué usar en cada caso, el guardarraíl que lo comprueba solo, y lo que todavía no cubre |

| [73-BITACORA-16AGO.md](73-BITACORA-16AGO.md) | **El relato del 16 de agosto**: el despliegue que faltaba, las métricas de la regla 10, la auditoría de cinco frentes y las correcciones — entre ellas el teléfono del cliente que iba a parar al log |

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
