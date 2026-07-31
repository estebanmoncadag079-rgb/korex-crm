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
| [04-AGENTE-IA.md](04-AGENTE-IA.md) | Cómo decide y responde el agente: prompt, horario, acciones, relevo humano |
| [05-CLIENTES.md](05-CLIENTES.md) | Cómo se da de alta un cliente y el estado real de La Churra y Lis Pastelería |
| [06-RESPALDOS.md](06-RESPALDOS.md) | Qué se respalda, qué no, y cómo levantar el servicio desde cero |
| [07-BITACORA.md](07-BITACORA.md) | Historial de cambios con fecha: qué se hizo y por qué |
| [08-PENDIENTES.md](08-PENDIENTES.md) | **Qué quedó y qué no**, decisiones tomadas y opciones descartadas |

## Convenciones de esta documentación

- **Lo verificado se marca como verificado**, con la fecha y cómo se comprobó.
  Si algo viene de notas y no se ha vuelto a comprobar, se dice.
- **Las horas van en UTC salvo que diga "Colombia"**. El servidor corre en UTC;
  Colombia es UTC−5. Es la confusión que más veces ha hecho perder tiempo aquí.
- Los comandos que aparecen son los que se ejecutaron de verdad, no ejemplos.

## Lo mínimo que hay que saber

**korex.ia es una sola instalación que atiende a varios negocios.** Un
contenedor, una base de datos, y dentro cada cliente vive aislado en su propia
"organización". Los arreglos del código llegan a todos los clientes a la vez;
lo que es propio de cada uno son solo sus datos: su prompt, su conocimiento,
su horario, su marca, su número y sus teléfonos de aviso.

**Estado a 31-jul-2026**: dos clientes en producción (La Churra y Lis
Pastelería) más la organización de la agencia. WhatsApp por la API oficial de
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
