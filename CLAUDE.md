# korex.ia (sobre Vocero CRM) — Guía para Claude

> ## 🔒 ARCHITECTURE GUARD — LEER ANTES DE MODIFICAR CÓDIGO
>
> Korex tiene **una única arquitectura oficial vigente: BACKEND COMO
> AUTORIDAD** (Principio 7 y "Arquitectura oficial de Korex" en
> [REGLAS-DE-ARQUITECTURA.md](REGLAS-DE-ARQUITECTURA.md) — fuente canónica,
> gana ante cualquier otro documento en caso de contradicción).
>
> La documentación de `docs/korexia/` anterior a septiembre-2026 puede
> describir diseños previos (el modelo recibía el estado completo o
> "manejaba" el flujo de pedidos). **Esos diseños son exclusivamente
> históricos, nunca una arquitectura alternativa disponible para elegir.**
>
> - **NO** implementar ni restaurar arquitectura histórica.
> - **NO** restaurar `state_source=prompt` como arquitectura (solo existe
>   como contención operativa puntual y documentada, nunca como diseño).
> - **NO** devolverle al LLM la autoridad sobre el estado.
> - **NO** hacer que el LLM calcule precios, totales o disponibilidad.
> - **NO** reconstruir el pedido/reserva completo desde el modelo como
>   fuente de verdad.
> - **NO** introducir excepciones arquitectónicas pensadas para un solo
>   cliente.
>
> Antes de tocar el flujo de pedidos, citas, precios, estado o
> confirmación, ejecutar el **Architecture Checkpoint** de
> [REGLAS-DE-ARQUITECTURA.md](REGLAS-DE-ARQUITECTURA.md) y obtener
> autorización explícita si alguna respuesta indica regresión.

> ## 📚 `docs/korexia/` documenta el estado operativo de esta instalación
>
> Este archivo describe el **repositorio**. Cómo funciona esta instalación **de
> verdad en producción** está en [docs/korexia/](docs/korexia/), 120+ documentos.
>
> - **Al retomar**, lee [`docs/korexia/00-INDICE.md`](docs/korexia/00-INDICE.md)
>   — empieza por su sección "ARQUITECTURA VIGENTE", no por la tabla
>   cronológica. Para pendientes operativos día a día, el último
>   [121](docs/korexia/121-PENDIENTES-20AGO.md) es del 20-ago-2026 — verifica
>   si ya existe un "pendientes" más reciente antes de darlo por vigente.
> - **Al cambiar algo**, actualízalo en el **mismo commit**: código + pruebas +
>   documento + cómo revertir, o el cambio no está terminado
>   ([75-COMO-SE-DOCUMENTA.md](docs/korexia/75-COMO-SE-DOCUMENTA.md)).
> - **Antes de tocar nada**, el filtro obligatorio:
>   [REGLAS-DE-ARQUITECTURA.md](REGLAS-DE-ARQUITECTURA.md) — es la fuente
>   canónica de arquitectura, por encima de `docs/korexia/` en esa materia
>   (ver "Jerarquía documental" abajo: son dos tipos de autoridad distintos,
>   nunca se mezclan).

## Jerarquía documental (Fase 5, 16-sep-2026 — revisa la de Fase 4, 8-sep-2026)

`specs/` (Spec Kit) llegó con el template de Vocero y sirvió para construir el
producto base (`specs/001-vocero-core`, `specs/002-diseno-atlas-white-label`) —
pero korex.ia, desde que existe como instalación real, se gobierna con otros
documentos para lo operativo, y así se queda.

**Dos tipos de autoridad distintos — nunca se mezclan:**

- **Autoridad arquitectónica** (quién decide cómo funciona la plataforma:
  quién manda entre el LLM y el backend, qué contratos existen, qué se
  puede tocar sin romper el núcleo). Jerarquía, de mayor a menor autoridad:

  1. **Constitución** ([.specify/memory/constitution.md](.specify/memory/constitution.md)) — principios del producto, no negociables.
  2. **[REGLAS-DE-ARQUITECTURA.md](REGLAS-DE-ARQUITECTURA.md)** — fuente canónica de arquitectura. Ante cualquier contradicción arquitectónica, **esta gana**, sin excepción — incluida cualquier sección de `docs/korexia/` que diga otra cosa.
  3. **Este archivo (`CLAUDE.md`)** — repite y señala hacia la fuente canónica (Architecture Guard, al inicio); no define arquitectura por su cuenta.
  4. **`docs/korexia/` — solo sus secciones marcadas como "ARQUITECTURA VIGENTE"** (ver `00-INDICE.md`).
  5. **`specs/`** — implementación técnica de un cambio arquitectónico ya aprobado (ver Paso 5 de `REGLAS-DE-ARQUITECTURA.md`).
  6. **Documentación histórica** (`docs/korexia/` marcada explícitamente como histórica, o fechada y superada) — explica cómo funcionaba antes; nunca es instrucción para implementar algo nuevo.

- **Autoridad descriptiva del estado operativo** (qué está configurado hoy,
  qué cliente tiene qué flag, qué falta por hacer). Aquí manda
  **`docs/korexia/`** — pero solo como la mejor aproximación documentada:
  si hay duda o la fecha del documento es vieja, **se verifica contra la
  realidad** (la base de datos, el contenedor en producción, el log), nunca
  se asume que un documento —ni siquiera `docs/korexia/`— sigue vigente sin
  comprobarlo. El caso real que lo exige: `docs/korexia/16` y `01` decían
  `gemini-2.5-flash` como modelo de producción; verificado en el contenedor
  real el 16-sep-2026, es `gemini-3.7-flash`. Ningún documento —tampoco este
  archivo— es sustituto de mirar el sistema real cuando la pregunta es "qué
  está pasando ahora".

**`specs/`** se reserva para la categoría "cambio arquitectónico" de
`REGLAS-DE-ARQUITECTURA.md` (ver su Paso 5): ahí sí se escribe un `spec.md`
antes de implementar. El resto de solicitudes (configuración, capacidad de
vertical, capacidad global, incidentes) NO pasa por `specs/` — se resuelve y
documenta directo en `docs/korexia/`, como ya viene ocurriendo.

**Este archivo** conecta a los demás; si describe algo operativo distinto a
lo que el repo realmente hace, es este archivo el que está desactualizado
— pero si describe algo arquitectónico, la autoridad sigue siendo
`REGLAS-DE-ARQUITECTURA.md`, nunca `docs/korexia/` por defecto.

Vocero es un CRM de WhatsApp open source (MIT), self-hosted, con agente de IA y
Laboratorio de auto-evaluación. **korex.ia** es la instalación de agencia que
corre sobre él en `korexia.online`, y difiere del Vocero de fábrica en cosas que
importan (ver el recuadro de *Producción real* más abajo). Este archivo guía a
Claude Code (u otro asistente) para operar y **modificar** este repositorio — el
caso típico: una agencia hospedando a sus clientes.

**Una instancia = varios clientes.** Cada cliente es una organización aislada
(sus conversaciones, contactos, embudo, agente y marca). La agencia se
identifica con `user.platform_role = 'superadmin'`: ve el panel `/admin`, da de
alta clientes y puede entrar en la cuenta de cualquiera ("entrar como", con
banner visible). Un usuario normal solo alcanza las organizaciones donde tiene
membresía — la organización activa de la sesión se revalida en cada petición
(`src/lib/auth/session.ts`). Los mensajes entrantes se enrutan al cliente dueño
del NÚMERO destino (`src/server/inbox/ycloud-routing.ts`); un número sin dueño
se descarta.

## REGLA DE ORO (no negociable, por encima de todo lo demás)

**Nunca revises por encima. Encuentra el problema de fondo y resuélvelo.**

Prohibido quedarse en el primer síntoma que explica lo visto, parchear sin
entender por qué falló, culpar al banco de pruebas, dar por buena una hipótesis
sin comprobarla contra el sistema real, o decir "ya está" sin haberlo visto
funcionar.

El dueño de este proyecto no programa: no puede auditar el trabajo. Un arreglo a
medias no se queda en el repo — sale a los negocios que dependen de esto y se
descubre cuando ya costó una venta. Ha pasado: un score dado por bueno sin
verificar que el arreglo estuviera desplegado; un pedido incompleto atribuido al
Laboratorio cuando era el agente; un arreglo dado por fallido que sí funcionaba,
tapando dos causas distintas —una llevaba desde el principio costando ventas
cada mañana sin que nadie la viera.

1. **Reproduce y mide antes de opinar.** Consulta el sistema real (la base, el
   contenedor que corre, los logs, la conversación entera), no el repositorio ni
   la suposición. Sobre lo que pasa en producción, el repo NO es fuente de
   verdad.
2. **Llega al mecanismo.** "El modelo se confundió" no es un diagnóstico. La
   respuesta correcta nombra una línea de código o una fila de una tabla.
3. **Pregunta qué MÁS rompe esa causa.** Lo reportado suele ser un caso de algo
   mayor y silencioso.
4. **Escribe la prueba que lo habría cazado**, con el porqué en el comentario.
5. **Verifica en vivo antes de darlo por hecho**; si algo quedó sin comprobar,
   dilo con esas palabras.

## REGLAS DE ARQUITECTURA (no negociables, léelas ANTES de crear o editar nada)

Ver **[REGLAS-DE-ARQUITECTURA.md](REGLAS-DE-ARQUITECTURA.md)** — la guía
completa, con el procedimiento de auditoría obligatorio (Inventario → Hallazgos
→ Impacto → Recomendación) y lo permitido/prohibido cliente por cliente.

VOCERO no es un chatbot de un negocio: es una plataforma que incorpora
negocios nuevos por **configuración desde el CRM**, nunca por código
específico de un cliente. **Toda solicitud se clasifica antes de
implementarse**, en una de cuatro categorías:

1. **Configuración de un cliente** (una salsa, un servicio) → se toca su
   catálogo, nunca el código.
2. **Capacidad reutilizable de un vertical** (un combo, un paquete) → si
   *otro* negocio del mismo vertical podría necesitarlo, se construye
   genérico y configurable — nunca pensando en un solo cliente.
3. **Capacidad global del CRM** (cupones, sedes) → configurable y
   **opcional** para cualquier negocio.
4. **Cambio arquitectónico** → se detiene y se audita antes de tocar nada; si
   la respuesta es "solo le sirve a este cliente", no se implementa. Es la
   única categoría que requiere `specs/NNN-nombre/spec.md` antes de
   implementar (Principio VI de la constitución, Paso 5 de
   REGLAS-DE-ARQUITECTURA.md) — las otras tres van directo a
   `docs/korexia/`.

El núcleo solo conoce: catálogo, selección, datos, estado, validación,
confirmación, registro. Ni una salsa, ni un churro, ni una pestaña, ni un
profesional como opción de catálogo (eso es recursos y reservas).

## Stack

**Next.js 15 (App Router) + React 19** en monolito · TypeScript estricto
(`strict` + `noUncheckedIndexedAccess`) · Tailwind CSS (tema oscuro propio,
acento `#25D366`) · **PostgreSQL + Drizzle ORM** (migraciones versionadas en
`drizzle/`, aplicadas al ARRANCAR el contenedor) · **Better Auth** + plugin
organization · **Zod** en todo input externo · nanoid con prefijos (`ct_`,
`cv_`, `msg_`…) · pnpm · Vitest (unit) + guiones E2E en `tests/e2e/`
conducidos con Playwright · Docker multi-stage (standalone, healthcheck
`/api/health`) · el repo de fábrica documenta deploy en Coolify o docker compose
+ Caddy — **korex.ia no usa ninguno de los dos** (ver *Producción real*).

## 🔴 Producción real (korex.ia) — donde esta guía y la realidad difieren

Cuatro cosas que el resto de este archivo (y el `README.md`) describen como en
el Vocero de fábrica y que **aquí son distintas**. Dar por buena la versión de
fábrica ya causó incidentes.

| Tema | Lo que dice el repo | La realidad de korex.ia |
|---|---|---|
| **Despliegue** | Coolify / docker compose | **GitHub Actions** (`workflow_dispatch` manual) → `scripts/deploy.sh` → wrapper root verificado en el VPS `2.25.159.117`. El dueño dispara el workflow con el SHA y `CONFIRMAR`; el asistente nunca lo hace (ver más abajo) |
| **Canal WhatsApp** | Meta Cloud API directa (`src/lib/meta/`) | **YCloud** (`src/lib/ycloud/client.ts`), que envuelve a Meta. `src/lib/meta/` sigue existiendo debajo |
| **Modelo LLM** | `anthropic/claude-sonnet-4.5` | **`google/gemini-3.7-flash`** — verificado en el contenedor real el 16-sep-2026; `OPENROUTER_FALLBACK_MODEL`/`OPENROUTER_JUDGE_MODEL` apuntan hoy al mismo modelo que el principal, sin diversidad real de salvavidas (ver `specs/003-backend-como-autoridad/handoff-cambio-modelo.md` sección A) |
| **Instancia** | "una instancia = un negocio" (`README.md`) | Multi-cliente. Tres negocios vivos |

### ⚠️ Desplegar es por GitHub Actions — nunca a mano, salvo emergencia real

1. Gate en local
2. **`git commit` + `git push`** a `main`
3. El **dueño** ejecuta el workflow: GitHub → Actions → "Deploy a
   producción" → Run workflow, con el `commit_sha` exacto y escribiendo
   `CONFIRMAR`. **El asistente nunca dispara este paso.**
4. El workflow corre el gate en CI y, por SSH, pide al servidor construir
   ese SHA — el servidor lo verifica contra su propio espejo de GitHub
   antes de construir nada (detalle en
   [docs/korexia/160](docs/korexia/160-IDENTIDAD-DE-DEPLOY-MINIMO-PRIVILEGIO.md)
   a [162](docs/korexia/162-VERIFICACION-DE-PROCEDENCIA-DEL-SHA-DE-DEPLOY.md)).
5. **Verificar `/api/health` reporta el commit correcto** — `scripts/deploy.sh`
   ya lo hace al final y falla si no coincide, pero confírmalo tú también.

Antes de esta automatización (Fases 3A-3H) el proceso era manual —
`git archive` + `scp` + `tar` a una carpeta que EasyPanel construía, con el
dueño pulsando "Desplegar" ahí— y falló dos veces por desincronización. Ya
no es el flujo vigente; queda solo como excepción de última instancia,
documentada en
[docs/korexia/02-INFRAESTRUCTURA.md](docs/korexia/02-INFRAESTRUCTURA.md). Un
contenedor nuevo y `healthy` **no** prueba que lleve el cambio, y
"converged" + un 200 tampoco — receta completa de verificación en ese mismo
documento.

> 🔍 **Al verificar dentro del contenedor, busca literales SIN tildes.** Los
> nombres de función los renombra el minificador y el texto acentuado se
> corrompe por SSH: las dos cosas juntas dan `0` coincidencias con el código
> desplegado y correcto.

Tiempo real por **SSE** (`/api/events`): heartbeat `: ping` ~25s, headers
anti-buffering, catch-up por refetch con `since=`. Sin WebSockets, sin colas
externas: el trabajo en segundo plano (agente, Laboratorio) es in-process.

## Mapa del código (fronteras de modificación)

| Quieres cambiar… | Toca… |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` (adaptador OpenRouter-compatible, `chatJson<T>`) |
| **Qué modelo hace cada trabajo** | `src/lib/ai/modelos.ts` — el ÚNICO sitio. ⚠️ Conversar y leer medios (audio, imágenes, cartas) son papeles SEPARADOS desde el 21-sep-2026: no todo modelo oye |
| **La conducta del agente, para TODOS los clientes** | `src/server/ai/generador/conducta.ts` — ⚠️ escribir aquí **no entrega nada**: hay que `pnpm regenerar:flota --aplicar` |
| **Lo que sabe el agente de UN negocio** | su `agent_profile.ficha` (dato, no código). El prompt se **compila** con `generador/generar.ts` |
| El armazón del prompt y el contrato del turno | `src/server/ai/prompts.ts` |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` + ejecución en `src/server/ai/pipeline.ts` |
| Las personas o el juez del Laboratorio | `src/server/lab/personas.ts` · `src/server/lab/judge.ts` |
| El canal WhatsApp | **`src/lib/ycloud/client.ts`** (es por donde sale todo) · `src/lib/meta/client.ts` debajo · `src/server/whatsapp/` |
| Campos/tablas | `src/lib/db/schema.ts` → `pnpm db:generate` → migración nueva en `drizzle/` |
| La ingesta/envío de mensajes | `src/server/inbox/` (ingest idempotente, send con guard de sandbox, ventana 24h) |
| UI | `src/components/` + `src/app/(app)/` |
| El catálogo de pedidos y su configuración desde el CRM | `src/server/catalog/` (lectura del agente en `queries.ts`, configuración en `grupos.ts`) · `src/app/api/catalogo/` · `src/app/(app)/catalogo/` |
| El alta de clientes y el panel de agencia | `src/server/auth/provisioning.ts` · `src/server/admin/` · `src/app/api/admin/` · `src/app/(app)/admin/` |
| Los respaldos de la base | `scripts/respaldo/` + guía operativa en [docs/respaldos.md](docs/respaldos.md) |

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock) tras un gate único (`src/lib/dev-guard.ts`): 404 incondicional en
producción.

## Reglas de la constitución (no negociables)

Ver [.specify/memory/constitution.md](.specify/memory/constitution.md).

- **Soberanía (II, endurecida)**: dependencias de runtime SOLO WhatsApp Cloud
  API + proveedor LLM OpenRouter-compatible opcional. PROHIBIDO en v1
  introducir S3/R2, email, Stripe, Google u otros servicios externos. Auth y
  BD self-hosted.
- **Seguridad (I)**: secretos cifrados en reposo (AES-256-GCM, `lib/crypto`);
  jamás al cliente ni a logs. El token de WhatsApp solo muestra sus últimos 4.
- **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio;
  toda query pasa por `scoped()` de `src/lib/db/tenant.ts`.
- **Idempotencia (IV)**: webhooks dedup por `wa_message_id` UNIQUE; estados
  monotónicos; seeds y migraciones re-ejecutables.
- **Sandbox del Laboratorio**: las conversaciones `is_test` JAMÁS tocan la API
  real — el sender lanza excepción (no lo "arregles": es un guardrail).

## Variables de entorno

Ver `.env.example` (cada una con guía inline). Las claves: `APP_BASE_URL`,
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (32 bytes base64),
`META_WEBHOOK_VERIFY_TOKEN` (segmento secreto del webhook), `META_APP_SECRET`
(opcional, firma), y para IA:

```bash
OPENROUTER_API_TOKEN=sk-or-...
OPENROUTER_MODEL=google/gemini-3.7-flash          # el que CONVERSA. Verificado en el contenedor real, 16-sep-2026
OPENROUTER_TRANSCRIPTION_MODEL=                     # el que LEE MEDIOS: audio, imágenes y cartas. Vacío = usa el conversacional (avisando)
OPENROUTER_JUDGE_MODEL=google/gemini-3.7-flash    # opcional: si se omite, cae en OPENROUTER_MODEL. Hoy en prod = el mismo modelo, sin diversidad
OPENROUTER_FALLBACK_MODEL=google/gemini-3.7-flash   # salvavidas 1: entra si el principal agota 3 intentos sin dar nada usable. Hoy en prod = el mismo modelo (ídem)
OPENROUTER_FALLBACK_MODEL_2=                        # salvavidas 2, opcional, mismo criterio. Su valor real en prod NO está verificado en `handoff-cambio-modelo.md` (solo se comprobaron MODEL/JUDGE/FALLBACK) — confirmar con `docker exec <contenedor> printenv | grep OPENROUTER` antes de asumir
```

> 🔴 **Sin saldo en OpenRouter el agente enmudece con un 402**, y es la primera
> causa a descartar ante cualquier «el bot no responde». No da un error visible
> en el CRM: simplemente no contesta. Las otras causas confirmadas —relevo
> humano activo, webhook sin remitente, mensajes `unsupported` que Meta entrega
> vacíos, nombres de usuario de WhatsApp (BSUID) tomados por teléfono— están en
> [23](docs/korexia/23-BITACORA-3AGO-NOCHE.md) y
> [24](docs/korexia/24-MENSAJES-UNSUPPORTED.md).

`OPENROUTER_FALLBACK_MODEL` es la red de seguridad de `chatJson`: sin ella el
código pasa de largo y un hipo de formato acaba en handoff por error o en un
caso del Laboratorio sin veredicto. Solo se gasta cuando el modelo de diario ya
agotó sus tres intentos.

Para el self-test local existe además el modo de pruebas interno (mocks) —
ver `specs/001-vocero-core/quickstart.md`. Nunca actives mocks en producción.

## Manejo de credenciales (obligatorio)

Cuando una feature necesite una variable/credencial nueva: (1) agrégala a
`.env` como placeholder `REEMPLAZA_...` (append), (2) deja guía inline `#` de
cómo obtenerla, (3) resume en el chat y sigue. `.env` está gitignored; para
deploy, las vars van también en la plataforma de hosting (runtime, no build).

## Definición de Hecho REFORZADA (obligatoria)

"Typecheck + lint + build (+ tests)" es el piso, NO el techo. Una feature no
está "Hecha" hasta correr el **self-test de COMPORTAMIENTO de punta a punta**
(Playwright + mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock) y dejarlo verde: flujo real como usuario,
resultado observable, y el camino infeliz degradando sin colgarse. Prohibido
delegar la prueba al usuario. Si algo depende de un LLM/proveedor externo,
todo turno tolera formato inesperado con extracción robusta + reintentos — un
hipo del proveedor nunca tumba el turno. Al detectar un fallo: diagnostica,
corrige y re-verifica tú mismo hasta verde (loop de auto-corrección).

Gate técnico:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

> ⚠️ **Ese gate NO cubre `scripts/`**: `tsconfig.json` los excluye. Dos scripts
> que escriben en producción llevaban **cinco días rotos** con todo en verde. Si
> tocas un script, **ejecútalo**.

Guiones E2E por historia en `tests/e2e/*.md`. Y en korex.ia hay además pruebas
de dominio que valen más que el gate para lo que se rompe de verdad:

```bash
pnpm probar:estado       # 46 comprobaciones sobre clientes efímeros
pnpm probar:propiedad    # reenviar el cuestionario no pisa datos ajenos
pnpm probar:escenarios   # 24 clientes simulados, comprobaciones objetivas
```

> 🔑 **Cada queja nueva del dueño debe acabar como escenario en
> `probar:escenarios` ANTES de arreglarse.** Es lo que impide que el mismo fallo
> vuelva por otra puerta.

⚠️ Los scripts necesitan un túnel SSH a la base — **y ese túnel apunta a
PRODUCCIÓN**. Nunca lo uses como `TEST_DATABASE_URL`:

```bash
ssh -i ~/.ssh/churrabot_key -f -N -L 15433:172.16.1.1:5433 root@2.25.159.117
```

## Modo Objetivo — Loop SDD

Cuando el dueño da una META (no prompts paso a paso): Discover → Plan →
Execute → Verify → Iterate, de forma autónoma, volviendo solo con el objetivo
verificado en vivo o con un bloqueo real (decisión de producto, credenciales,
acción irreversible/costosa). Agrupa TODAS las preguntas bloqueantes al inicio.
El estado durable es `docs/korexia/` (ver "Jerarquía documental" arriba); los
artefactos SDD en `specs/` (spec/plan/tasks) solo aplican cuando el objetivo es
en sí mismo un cambio arquitectónico según `REGLAS-DE-ARQUITECTURA.md`.
Invocable como `/loop-sdd <objetivo>`.

## Memoria persistente

Memoria de archivos en `memory/` (índice `memory/MEMORY.md`, cargado por
sesión). Persiste decisiones, gotchas y correcciones; no dupliques lo que el
repo ya registra. Los subagentes con `memory: project` usan
`.claude/agent-memory/`.

## Arquitectura de agentes

1. **Orquestador** = la sesión principal de Claude Code (este CLAUDE.md + skill
   `loop-sdd`).
2. **Subagentes** (`.claude/agents/`): `deploy-ops` (deploy/logs/healthchecks,
   no escribe código de app) · `public-site-builder` (páginas públicas/legales
   y config de paneles externos).
