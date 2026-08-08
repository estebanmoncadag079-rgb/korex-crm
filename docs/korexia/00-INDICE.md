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
| [10-SEGURIDAD.md](10-SEGURIDAD.md) | Auditoría: qué se corrigió, qué falta y qué está bien hecho |
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
| [24-MENSAJES-UNSUPPORTED.md](24-MENSAJES-UNSUPPORTED.md) | Los mensajes que **Meta entrega vacíos**: por qué el bot no responde, el payload real, cada cuánto pasa y cómo reconocerlo en 30 segundos |
| [25-UPSTREAM-VOCERO.md](25-UPSTREAM-VOCERO.md) | ¿Conviene traer la actualización de Vocero CRM? Qué sirve, qué no, el bug latente de identidad que destapó y por qué el merge está descartado |
| [26-NEA-AGENT.md](26-NEA-AGENT.md) | Qué se tomó del agente de citas `nea-agent`: que una respuesta no se pierda si falla el envío, agendar solo lo ofrecido, y la regla anti off-topic |
| [27-VENTA-PERDIDA-JORGE.md](27-VENTA-PERDIDA-JORGE.md) | La venta que se perdió porque el cliente se corrigió a sí mismo: un turno sin nada que responder dejaba mudo a Gemini y disparaba un handoff falso |
| [28-BITACORA-4-6AGO.md](28-BITACORA-4-6AGO.md) | **Historial del 4 al 6 de agosto**: cinco casos de "no respondió" (tres con la misma causa de fondo), los dos repos revisados y el despliegue que no llevaba nada |
| [29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md) | Por qué un salón no puede recordar citas sin plantilla, qué cuesta, quién la crea y por qué octubre de 2026 no lo arregla |
| [30-SALON-PRUEBAS.md](30-SALON-PRUEBAS.md) | El catálogo real del primer cliente de citas y la tanda de pruebas antes de su día 1: cinco bugs encontrados y 35 escenarios verificados |
| [31-BITACORA-7AGO.md](31-BITACORA-7AGO.md) | **Historial del 7 de agosto**: el primer cliente de citas, los cinco datos que le faltaban al agente, lo que la dueña no podía hacer y qué se descartó |

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

**Estado a 8-ago-2026 (madrugada)**: dos clientes en producción (La Churra y
Lis Pastelería) más la agencia y la organización de pruebas de citas — y un
**tercero a punto de entrar: un salón de belleza**, primer cliente real del
vertical de citas. Su catálogo (41 servicios, 5 especialistas) está cargado en
la organización de pruebas y ejercitado con 35 escenarios contra el modelo
real; lo que falta para su día 1 está en
[21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md), y el hilo del día en
[31-BITACORA-7AGO.md](31-BITACORA-7AGO.md). **Todo el código está desplegado y
verificado dentro del contenedor**, y la carpeta de EasyPanel quedó
sincronizada: ningún Desplegar futuro revierte nada.

**Empieza por [08-PENDIENTES.md](08-PENDIENTES.md)** (y su continuación
[21-PENDIENTES-AGO.md](21-PENDIENTES-AGO.md)) si retomas el proyecto: ahí
está lo urgente ordenado por riesgo real. WhatsApp por la API oficial de
Meta a través de YCloud. Todo corre en un VPS con EasyPanel.

> 🔦 **Si el reporte es "el bot no responde"**, no investigues desde cero:
> hay **13 causas ya confirmadas con evidencia real**. Las cuatro más
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
