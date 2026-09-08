<!--
SYNC IMPACT REPORT
==================
Versión: 1.1.0 (plantilla starter) → 1.2.0

Cambios:
  - Título y descripción del producto: Vocero CRM (CRM de WhatsApp con agente de
    IA, open source MIT, self-hosted, gratuito; una instancia = un negocio).
  - Principio II "Soberanía / Self-Hosted" → ENDURECIDO: se elimina la excepción
    de almacenamiento de objetos S3-compatible; lista cerrada de dependencias
    externas en runtime (WhatsApp Cloud API + proveedor LLM opcional vía
    adaptador OpenRouter-compatible); prohibición explícita v1 de S3/R2, email,
    Stripe y Google; requisitos mínimos del instalador fijados.
  - Principio VIII "Foco Vertical" → definido: CRM de conversaciones y leads de
    WhatsApp que las agencias despliegan para negocios.
  - Principios I, III, IV, V, VI, VII y IX: íntegros (sin cambio semántico).
  - Governance: Ratified / Last Amended = 2026-07-09.

Bump: MINOR (1.1.0 → 1.2.0) — expansión material del Principio II y definición
del Principio VIII; sin eliminaciones ni redefiniciones incompatibles.

Plantillas dependientes:
  - .specify/templates/plan-template.md — ✅ compatible (Constitution Check
    genérico; los gates se evalúan contra esta versión).
  - .specify/templates/spec-template.md — ✅ compatible (sin secciones nuevas).
  - .specify/templates/tasks-template.md — ✅ compatible.
  - CLAUDE.md — ⚠ se personaliza para el usuario final del repo en la fase de
    implementación (tarea planificada de la feature 001).

TODOs diferidos: ninguno.
==================
Versión: 1.2.0 → 2.0.0 (Fase 4B, 8-sep-2026)

Contexto: la auditoría de Fase 4 (sesión del 8-sep-2026, sin documento propio
en docs/korexia/ — reportada en conversación) encontró que el Principio VI,
tal como estaba escrito, exigía spec previa para "ninguna feature" sin
excepción real (solo typos/refactors) — en contradicción directa con 60 días
de práctica real de korex.ia, donde configuración de cliente, capacidades de
vertical/CRM e incidentes se resuelven y documentan en docs/korexia/ sin pasar
por specs/, y con la jerarquía documental ya declarada en CLAUDE.md y
REGLAS-DE-ARQUITECTURA.md (8-sep-2026, Fase 4A).

Cambios:
  - Principio VI "Specs Antes de Código" → REDEFINIDO: el requisito de
    especificación previa (specify → plan → tasks → implement) se acota a
    "cambio arquitectónico", definido AQUÍ MISMO en términos generales y
    propios de la constitución (modifica comportamiento, contratos o modelo
    de datos compartidos por el núcleo de la plataforma; no configuración,
    catálogo o datos de un cliente, ni extender una capacidad ya genérica y
    opcional). Un documento operativo (hoy, REGLAS-DE-ARQUITECTURA.md) puede
    clasificar y ejemplificar ese criterio, pero NO lo define ni puede
    ampliarlo/reducirlo por su cuenta — evita que un documento de menor
    autoridad cambie indirectamente el alcance de un principio
    constitucional. Configuración de cliente, capacidad de vertical,
    capacidad global de CRM e incidentes/hotfixes que no cumplen el criterio
    quedan fuera de este principio. Es una redefinición INCOMPATIBLE con el
    texto anterior (antes exigía spec para prácticamente todo; ahora exige
    spec solo para cambios arquitectónicos, con criterio propio).
  - Sección "Flujo de Desarrollo y Puertas de Calidad" → el bullet "Orden del
    flujo" ya remitía a "Principio VI" como autoridad (no a
    REGLAS-DE-ARQUITECTURA.md); no requirió cambio adicional en esta
    revisión.
  - Principios I, II, III, IV, V, VII, VIII y IX: íntegros (sin cambio
    semántico).
  - Governance: Ratified 2026-07-09 / Last Amended = 2026-09-08.

Bump: MAJOR (1.2.0 → 2.0.0) — redefinición incompatible de un principio
existente, según la propia política de versionado de esta constitución
("MAJOR: eliminación o redefinición incompatible de un principio").

Plantillas dependientes:
  - .specify/templates/plan-template.md — ✅ compatible (el Constitution Check
    ya es genérico; para features normales de korex.ia simplemente no aplica,
    porque no pasan por specs/).
  - .specify/templates/spec-template.md — ✅ compatible (sin secciones
    nuevas; sigue siendo el formato correcto para cuando SÍ se abre un spec de
    cambio arquitectónico).
  - .specify/templates/tasks-template.md — ✅ compatible, mismo motivo.
  - CLAUDE.md / REGLAS-DE-ARQUITECTURA.md / docs/sdd-workflow.md — ✅ ya
    actualizados en la Fase 4A (8-sep-2026) con la misma regla; esta enmienda
    los alinea con la constitución en vez de crear una nueva contradicción.

TODOs diferidos: ninguno.
-->

# Vocero CRM Constitution

Vocero CRM es un CRM de WhatsApp con agente de IA, open source (MIT), self-hosted y
gratuito, diseñado para que las agencias de IA lo desplieguen en el VPS de sus
clientes: una instancia = un negocio. Esta constitución define las reglas no
negociables del producto. Aplica a todas las fases del flujo de trabajo (specify,
plan, tasks, implement). Cualquier conflicto entre una decisión de implementación y
esta constitución SE RESUELVE A FAVOR de esta constitución.

## Core Principles

### I. Seguridad de Datos Primero (NO NEGOCIABLE)

La protección de datos es la primera responsabilidad del sistema, por encima de
velocidad de entrega o conveniencia de desarrollo.

- Tokens, credenciales y secretos sensibles NUNCA se exponen al cliente (navegador,
  app, respuestas de API) ni se escriben en logs, trazas o mensajes de error.
- Todo secreto se almacena cifrado en reposo. Las claves de cifrado se gestionan
  fuera del código fuente y fuera del control de versiones.
- Si el producto es multi-tenant, todo dato de un tenant está aislado de los demás:
  ninguna consulta, endpoint o tarea en segundo plano debe devolver o modificar datos
  de un tenant distinto al del solicitante. El aislamiento se aplica por defecto.

**Rationale**: Una fuga de credenciales o un cruce de datos entre clientes es un
fallo catastrófico e irreversible; prevenirlo siempre cuesta menos que remediarlo.

### II. Soberanía / Self-Hosted (ENDURECIDO)

Vocero CRM opera completo sobre la infraestructura del operador. La lista de
dependencias externas en runtime es CERRADA:

- Dependencias externas permitidas en runtime, ÚNICAMENTE:
  1. **WhatsApp Cloud API** (Meta Graph API) — el canal es la razón de ser del
     producto.
  2. **El proveedor LLM**, opcional, accedido EXCLUSIVAMENTE a través del adaptador
     OpenRouter-compatible (`OPENROUTER_BASE_URL` / `OPENROUTER_MODEL`). Sin token
     configurado, el producto funciona como CRM sin agente de IA.
- **PROHIBIDO en v1**: almacenamiento de objetos externo (S3/R2), servicios de
  email, Stripe u otro billing, y servicios de Google. Cualquier feature que los
  requiera queda fuera del alcance de v1.
- El instalador solo necesita: un VPS con Coolify o Docker, un dominio, credenciales
  de Meta y (opcional) un token de OpenRouter. Nada más.
- Las funciones core —autenticación y base de datos— corren self-hosted (Better
  Auth + PostgreSQL propios de la instancia).
- Las integraciones externas permitidas se aíslan tras adaptadores dedicados
  (cliente Graph API propio; adaptador LLM) para no acoplar el dominio a ellas.

**Rationale**: El producto se regala para que agencias lo desplieguen en VPS de
clientes; cada dependencia externa adicional es un costo, un punto de fallo y una
fuga de soberanía que rompe la promesa "gratis y tuyo".

### III. Multi-Tenancy Real

El sistema sirve a organizaciones independientes desde una sola instancia lógica.
En Vocero cada instancia sirve a UN negocio, pero el modelo de datos es
multi-tenant real (organización del plugin de auth) para mantener el aislamiento
exigible y no cerrar la puerta a evoluciones.

- Cada organización (tenant) gestiona sus propios usuarios, roles y permisos.
- El identificador de tenant (`organization_id`) es un parámetro de primer nivel en
  el modelo de datos y en la capa de acceso a datos, no un campo opcional añadido a
  posteriori. Toda tabla de dominio lo lleva NOT NULL e indexado org-first.

**Rationale**: Multi-tenancy diseñado desde el inicio evita reescrituras costosas y
hace cumplible el aislamiento del Principio I.

### IV. Idempotencia en Integraciones Externas

Todo evento entrante de un sistema externo (webhooks, callbacks, notificaciones de
terceros) se procesa de forma idempotente.

- Recibir el mismo evento dos o más veces NO duplica efectos observables (mensajes
  reenviados, registros duplicados, acciones del agente repetidas).
- Cada evento entrante se identifica de forma única (p. ej. `wa_message_id` UNIQUE)
  y su procesamiento se registra para detectar y descartar reintentos.

**Rationale**: Los proveedores externos reintentan entregas por diseño; sin
idempotencia, los reintentos corrompen datos y generan acciones duplicadas.

### V. Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)

Ninguna tarea se considera terminada sin pasar verificación.

- "Hecho" requiere, como mínimo: comprobación de tipos, lint y build; y tests donde
  apliquen al alcance de la tarea.
- Lo que NO se pueda verificar automáticamente se marca explícitamente como
  "pendiente de verificación humana"; no se reporta como completado sin esa marca.
- No se reporta una tarea como terminada describiendo que "debería funcionar": o pasa
  la verificación, o se declara su estado real (incluyendo fallos).

**Rationale**: La verificación automática es la única definición de "hecho" que no
depende de optimismo.

### VI. Specs Antes de Código (para cambios arquitectónicos)

Todo cambio arquitectónico requiere una especificación previa. Es "cambio
arquitectónico", por definición de esta constitución, el que modifica el
comportamiento, los contratos o el modelo de datos **compartidos por la
plataforma misma** —su núcleo y sus reglas generales— en vez de limitarse a
la configuración, el catálogo o los datos de un cliente, o a extender una
capacidad ya prevista y opcional para cualquier negocio de un mismo tipo. Si
el cambio solo toca configuración, catálogo o datos de un negocio concreto,
o extiende algo ya diseñado como genérico y opcional, NO es cambio
arquitectónico, sin importar cuán grande parezca; si obliga a modificar cómo
funciona el núcleo, sus contratos o su modelo de datos para todos los
negocios, SÍ lo es, sin importar cuán pequeño parezca el diff.

- Para un cambio arquitectónico, la especificación describe el comportamiento
  observable por el usuario, no la implementación, y se escribe ANTES de
  empezar a codificar.
- Para esa categoría, el orden del flujo es specify → plan → tasks → implement;
  el código no comienza antes de existir su spec.
- Configuración de un cliente, capacidades de un vertical, capacidades
  globales del CRM e incidentes/hotfixes que no cumplen el criterio anterior
  NO pasan por este principio: se implementan y documentan por su propio
  camino operativo (código + pruebas + documentación + reversión, mismo
  commit).
- Un documento operativo (hoy, REGLAS-DE-ARQUITECTURA.md) puede
  **clasificar y operacionalizar** este criterio con ejemplos y un
  procedimiento de auditoría concretos, para hacerlo aplicable sin
  ambigüedad caso a caso. Ese documento no define ni amplía ni reduce el
  criterio de este principio — lo aplica. Si algún día ese documento
  cambiara sus categorías sin que el criterio de este párrafo cambiara, el
  criterio de este párrafo sigue siendo la prueba final (Governance: ante
  cualquier conflicto, gana la constitución).
- Dentro de un cambio arquitectónico, correcciones triviales y cambios sin
  comportamiento observable nuevo (typos, formato, refactors internos sin
  cambio de contrato) siguen exentos.

**Rationale**: Especificar el comportamiento observable antes de codificar un
cambio que afecta a la plataforma entera previene retrabajo y desalineación
entre verticales. Exigir el mismo ritual para un ajuste de catálogo o un
incidente de producción no aporta ese beneficio y sí añade fricción: 60 días
de operación real de korex.ia (docs/korexia/) muestran que ese tipo de cambio
se gobierna mejor con documentación inmediata que con especificación previa.
El criterio se define aquí, en la constitución, precisamente para que ningún
documento de menor autoridad pueda ampliar o reducir por su cuenta cuándo
aplica este principio.

### VII. Trazabilidad de Decisiones

Las decisiones tomadas sin contexto suficiente se documentan para revisión humana.

- Cuando una decisión se toma con información incompleta o supuestos no confirmados,
  se registra de forma visible (en el spec, el plan, el PR o un marcador
  `NEEDS CLARIFICATION` / TODO con responsable), no se entierra en el código.
- Los supuestos que condicionan el comportamiento se hacen explícitos para que un
  humano pueda revisarlos y revertirlos.

**Rationale**: Las decisiones implícitas bajo incertidumbre son la principal fuente
de deuda oculta; hacerlas visibles permite corregirlas a tiempo.

### VIII. Foco Vertical — CRM de Conversaciones y Leads de WhatsApp

Es un CRM de conversaciones y leads de WhatsApp que las agencias despliegan para
negocios. No es plataforma de marketing masivo, ni constructor visual de flujos, ni
herramienta de scraping. Lo que no ayude a *atender, organizar y convertir
conversaciones de WhatsApp de UN negocio* se rechaza.

- El modelo de datos y los flujos MUST reflejar ese dominio: contactos que escriben
  por WhatsApp, conversaciones con ventana de 24h, leads en un pipeline, un agente
  de IA que atiende con el conocimiento del negocio y escala a humanos.
- WhatsApp Cloud API es el canal; el producto es el CRM. Features de canal que no
  sirvan a atender/organizar/convertir (broadcast masivo, scraping de números,
  flujos visuales genéricos) quedan FUERA del alcance de v1.
- Toda feature MUST servir a la agencia que despliega o al negocio que opera UNA
  instancia. Lo que solo sirva a una plataforma centralizada (billing, planes,
  multi-instancia) queda FUERA.

**Rationale**: Un foco vertical explícito mantiene el modelo de datos alineado con el
negocio real y da un criterio claro para aceptar o rechazar alcance.

### IX. Verificación de Comportamiento en Vivo (NO NEGOCIABLE)

Complementa el Principio V. TODA feature con comportamiento observable —UI web,
mensajería, API o integración externa— se verifica ejerciendo ese comportamiento como
lo haría un usuario real antes de declararse "Hecha". El gate técnico (Principio V) es
el piso, no el techo.

- **Self-test + loop por el implementador (self-improvement loop).** Tras implementar,
  quien implementa ejecuta el self-test E2E —camino feliz Y camino infeliz (degradación
  sin colgarse)— y, si algo falla, diagnostica, corrige y re-verifica él mismo hasta
  verde. No se entrega trabajo a medio verificar ni se delega la prueba funcional al
  dueño. Lo único delegable a verificación humana es lo intrínsecamente no verificable
  por herramientas (juicio visual, aprobación de un tercero), marcado explícitamente.
- **Se conduce la interfaz real.** Navegador vía Playwright para features de UI; la línea
  del canal (p. ej. una API de WhatsApp de prueba) para mensajería; llamadas a la API
  donde esa sea la superficie. No basta con tipos/lint/build, ni con que un endpoint
  devuelva 2xx, ni con inspeccionar la base de datos: se observa el resultado de cara al
  usuario.
- **Local primero, nube después.** Si el comportamiento puede reproducirse en `localhost`
  —incluyendo integraciones externas vía túnel (p. ej. ngrok + handshake del webhook desde
  el panel del proveedor)—, SHOULD probarse ahí antes de desplegar. El deploy a la nube se
  reserva para lo que el entorno local no pueda reproducir, porque desplegar consume tiempo
  y reduce la agilidad del ciclo.
- **Guardarraíles con herramientas no oficiales.** Cuando la prueba use herramientas no
  oficiales vinculadas a un número/cuenta real, MUST respetarse reglas duras: enviar solo a
  destinatarios de una allowlist, NUNCA mensajes en ráfaga (anti-flood obligatorio), y
  minimizar el volumen. La integridad de la cuenta del operador es un activo a proteger, en
  línea con el Principio I.

**Rationale**: El gate técnico no detecta que un agente "se calló", que una tarjeta no
llegó como un solo mensaje, o que un botón de UI no disparó nada — eso solo aparece
ejerciendo el flujo real. Y el valor del paso no está solo en detectar el fallo sino en
cerrarlo: el implementador itera hasta verde en vez de devolver trabajo a medias. Probar
en local primero mantiene el ciclo ágil; y sin guardarraíles duros, una prueba con
herramientas no oficiales podría provocar un baneo irreversible.

## Restricciones de Plataforma y Seguridad

Estas restricciones derivan de los Principios I y II y son verificables en revisión:

- **Gestión de secretos**: los secretos se inyectan vía configuración de entorno o un
  gestor de secretos; nunca se comprometen a control de versiones.
- **Cifrado en reposo**: credenciales y datos sensibles se almacenan cifrados; el
  almacenamiento en claro de secretos es una violación.
- **Frontera de tenant**: la capa de acceso a datos exige el identificador
  de tenant; cualquier acceso que pueda omitirlo requiere justificación explícita.
- **Aislamiento de integraciones**: las dependencias de APIs externas se acceden a
  través de adaptadores dedicados (cliente Graph API propio, adaptador LLM
  OpenRouter-compatible), no dispersas por el dominio.
- **Instancia pública endurecida**: las rutas de mock/desarrollo devuelven 404
  incondicional en producción; el registro se cierra tras la primera organización
  (salvo habilitación explícita); los entornos de prueba internos JAMÁS alcanzan la
  API real de WhatsApp.

## Flujo de Desarrollo y Puertas de Calidad

- **Orden del flujo** (solo para cambios arquitectónicos, Principio VI):
  specify → plan → tasks → implement. Cada fase consume el artefacto de la
  anterior. Configuración, capacidad de vertical, capacidad global e
  incidentes siguen su propio flujo (REGLAS-DE-ARQUITECTURA.md +
  docs/korexia/75-COMO-SE-DOCUMENTA.md), sin estas cuatro fases.
- **Puerta constitucional (Constitution Check)**: el plan de cada feature evalúa el
  cumplimiento de estos principios antes de la Fase 0 y se re-evalúa tras el diseño de
  la Fase 1. Las violaciones se registran y justifican en Complexity Tracking o se
  eliminan.
- **Puerta de calidad (Definición de "Hecho")**: tipos + lint + build en verde, y
  tests donde apliquen; lo no verificable automáticamente se marca como pendiente de
  verificación humana (Principio V). Para features con comportamiento observable de cara
  al usuario, "Hecho" exige además el self-test de comportamiento en vivo ejecutado por el
  implementador, con sus guardarraíles (Principio IX).
- **Trazabilidad**: decisiones bajo incertidumbre y supuestos se documentan de forma
  visible (Principio VII), no en comentarios enterrados.

## Governance

Esta constitución es la autoridad máxima del proyecto. Prevalece sobre cualquier otra
práctica, convención o preferencia; ante un conflicto, gana la constitución.

- **Procedimiento de enmienda**: toda enmienda se propone por escrito describiendo el
  cambio y su motivación, se aprueba por el responsable del proyecto y se registra en
  el control de versiones junto con el Sync Impact Report actualizado.
- **Política de versionado** (semantic versioning de la constitución):
  - **MAJOR**: eliminación o redefinición incompatible de un principio o de la
    gobernanza.
  - **MINOR**: adición de un principio/sección nueva o expansión material.
  - **PATCH**: aclaraciones, correcciones de redacción y refinamientos no semánticos.
- **Revisión de cumplimiento**: cada PR y cada revisión de diseño verifican el
  cumplimiento de estos principios. La complejidad que viole un principio debe
  justificarse; si no, debe eliminarse.
- **Propagación**: al enmendar la constitución se revisan y, si procede, se actualizan
  las plantillas dependientes (plan, spec, tasks).

**Version**: 2.0.0 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-09-08
