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

**Estado a 1-ago-2026**: dos clientes en producción (La Churra y Lis
Pastelería, ambos con agente encendido) más la organización de la agencia.
**Empieza por [08-PENDIENTES.md](08-PENDIENTES.md)** si retomas el proyecto: ahí
está lo urgente ordenado por riesgo real. WhatsApp por la API oficial de
Meta a través de YCloud. Todo corre en un VPS con EasyPanel.

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
