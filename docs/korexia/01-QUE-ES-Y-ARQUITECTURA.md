# Qué es korex.ia y cómo está construido

> **Dentro:** Qué es · De dónde viene (y qué cambió) · El stack · Cómo se aísla cada cliente · Las pantallas · El recorrido de un mensaje · Dónde vive cada cosa en el código · Un detalle que sorprende: el prompt no está en el código

## Qué es

**korex.ia es dos cosas a la vez:**

1. Una **agencia digital** (automatización con IA, webs, apps).
2. Un **producto**: un CRM de WhatsApp con agente de IA que la agencia le
   vende a varios negocios, todos atendidos desde una sola instalación.

Cada cliente entra con su usuario, ve **solo** sus conversaciones y su embudo,
y su agente responde con el tono y el conocimiento de su negocio.

## De dónde viene (y qué cambió)

korex.ia es un *fork* de **Vocero CRM** (MIT, de kevinrivm). Se conservó casi
toda la aplicación, pero se cambiaron tres cosas de fondo:

| | Vocero CRM (original) | korex.ia (esta instalación) |
|---|---|---|
| Clientes | Una instancia por negocio | **Una instancia, varios negocios** |
| WhatsApp | Meta Cloud API directa | **YCloud** (que habla con Meta) |
| Despliegue | Coolify / docker compose | **EasyPanel** sobre Docker Swarm |

El repositorio privado es `estebanmoncadag079-rgb/korex-crm`, con el original
como remoto `upstream`.

## El stack

- **Next.js 15** + **React 19** (App Router, componentes de servidor)
- **PostgreSQL 16** con **Drizzle ORM**
- **Better Auth** para cuentas, sesiones y organizaciones
- **Docker** (imagen multi-etapa, salida *standalone*)
- IA vía **OpenRouter** (verificado en el contenedor real el 16-sep-2026: `google/gemini-3.7-flash` — ver `specs/003-backend-como-autoridad/handoff-cambio-modelo.md`)
- WhatsApp vía **YCloud** → Meta Cloud API

Gestor de paquetes: `corepack pnpm`. Comandos útiles:

```bash
corepack pnpm typecheck     # tipos
corepack pnpm lint          # estilo
corepack pnpm vitest run    # pruebas (230 al 31-jul-2026)
```

## Cómo se aísla cada cliente

Esto es lo más importante de entender, porque es lo que evita que un negocio
vea los datos de otro.

**Cada cliente = una organización.** Toda tabla del dominio lleva
`organization_id` obligatorio, y las consultas pasan por un helper (`scoped()`)
que filtra siempre por la organización de la sesión.

**La organización se revalida en cada petición.** No se confía en lo que diga
la sesión: `requireSession` comprueba que el usuario siga siendo miembro. Por
eso, aunque a alguien se le forzara otra organización en la base de datos, el
sistema lo devuelve a la suya.

**Verificado en vivo** (26-jul-2026 y repetido el 31-jul con Lis): la cuenta de
un cliente recibe **403** al pedir el panel de agencia (`/api/admin/clients`) y
no puede entrar en otra organización.

### Los dos tipos de cuenta

- **`platform_role = 'superadmin'`** → la agencia. Ve el panel `/admin`: lista
  de clientes, alta, cuentas, conectar números y "entrar como" el cliente.
- **Cuenta normal** → el dueño del negocio. Solo su organización.

Cuando la agencia "entra como" un cliente aparece un **banner ámbar** avisando
de que lo que se responda sale a nombre de ese negocio.

## Las pantallas

| Ruta | Para qué sirve |
|---|---|
| `/` | Portada pública (oscura, sin login) |
| `/login` | Entrada. No hay registro público: `/register` redirige aquí |
| `/inbox` | **Bandeja**: conversaciones en tiempo real |
| `/pipeline` | **Embudo** kanban configurable |
| `/contacts` | **Contactos** y sus fichas |
| `/agent` | **Agente**: tono, saludo y conocimiento del negocio |
| `/lab` | **Laboratorio**: clientes simulados que ponen a prueba al agente |
| `/admin` | **Clientes** (solo agencia) |
| `/settings/*` | Marca, plantillas, equipo, mi cuenta, WhatsApp (solo agencia) |

## El recorrido de un mensaje

Este es el camino completo, de punta a punta:

```
Cliente escribe por WhatsApp
        ↓
Meta (Cloud API)
        ↓
YCloud  ── recibe el evento y lo reenvía firmado
        ↓
POST /api/webhooks/ycloud[/<organizationId>]
        ↓
Se valida la firma (HMAC-SHA256). Si no cuadra → 401
        ↓
Se busca de quién es el número de destino → organización
        ↓  (número sin dueño → se descarta con aviso)
Se guarda el mensaje en la bandeja de ESA organización
        ↓
¿El agente está encendido y nadie ha tomado la conversación?
        ↓ sí
Se agrupan los mensajes seguidos del cliente (3 segundos)
        ↓
Se arma el prompt: instrucciones + conocimiento + ficha + historial
        ↓
OpenRouter → el modelo devuelve UNA acción en JSON
        ↓
Se ejecuta: responder, mover el lead, avisar del pedido o pasar a un humano
        ↓
YCloud → Meta → llega al cliente
```

Cada paso está detallado en [03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md)
y [04-AGENTE-IA.md](04-AGENTE-IA.md).

## Desde Feature 003 (16-sep-2026): la autoridad sobre pedidos y citas

El diagrama de arriba sigue siendo correcto, pero incompleto para los
negocios con `state_source=backend` (hoy: La Churra). El paso "OpenRouter →
el modelo devuelve UNA acción en JSON" esconde, para esos negocios, una capa
completa que decide quién manda sobre el estado del pedido o la cita:

```
... (igual que arriba, hasta "se arma el prompt") ...
        ↓
OpenRouter → el modelo devuelve UNA acción JSON + (si aplica) una lista
             de Operacion[] — nunca el pedido/reserva completos
        ↓
El backend valida cada operación contra 3 compuertas, resuelve todo nombre
contra catálogo/agenda reales, calcula precios y totales, y persiste el
estado de forma atómica (todo el lote o nada)
        ↓
Se ejecuta la acción: responder con lo que el backend ya decidió,
mover el lead, avisar del pedido o pasar a un humano
        ↓
YCloud → Meta → llega al cliente
```

El modelo **nunca** decide un precio, un total, una disponibilidad ni si un
pedido puede cerrarse — eso es autoridad exclusiva del backend. Ver
**[REGLAS-DE-ARQUITECTURA.md](../../REGLAS-DE-ARQUITECTURA.md)**, sección
"Arquitectura oficial de Korex", y
`specs/003-backend-como-autoridad/data-model.md` para el detalle técnico
completo. Esta es la **arquitectura oficial vigente** — no una alternativa a
lo descrito arriba, sino lo que ya corre en producción para los negocios
migrados.

## Dónde vive cada cosa en el código

```
src/app/(app)/          pantallas de la aplicación (bandeja, embudo, admin…)
src/app/api/            endpoints: webhooks, admin, ajustes, media
src/server/inbox/       entrada y salida de mensajes, enrutamiento, relevo humano
src/server/ai/          el agente: prompt, decisión y ejecución de acciones
src/server/whatsapp/    credenciales de cada cliente (cifradas)
src/server/admin/       alta y gestión de clientes
src/lib/db/schema.ts    todas las tablas
tests/unit/             las pruebas
```

## Un detalle que sorprende: el prompt no está en el código

El prompt de cada agente vive en la **base de datos**
(`agent_profile.instructions`), no en el repositorio. Se lee en cada mensaje,
así que **editarlo tiene efecto inmediato**: no hay que desplegar ni reiniciar
nada. Es deliberado: el tono de un negocio se ajusta a diario y no debería
requerir un despliegue.
