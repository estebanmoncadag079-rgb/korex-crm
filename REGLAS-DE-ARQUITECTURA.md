# Reglas de arquitectura de VOCERO

> **Documento vivo, dictado por el dueño el 18-ago-2026.** No es una
> recomendación de estilo: es el filtro por el que pasa **toda** modificación
> de este proyecto, la haga Claude Code, Codex, u otra IA en otra sesión
> cualquier otro día.
>
> **Relación con la constitución** ([.specify/memory/constitution.md](.specify/memory/constitution.md)):
> aquella fija los principios generales del producto (seguridad, soberanía,
> multi-tenancy, calidad verificable...) y es la autoridad máxima ante
> cualquier conflicto. Este documento no la reemplaza: es la guía operativa
> específica para UNA pregunta que la constitución no detalla — **cómo no
> romper la arquitectura multivertical al añadir o tocar cualquier cosa**. Su
> Principio VIII ("Foco Vertical") y Principio III ("Multi-Tenancy Real") son
> la base de la que sale todo lo que sigue.

---

# Prompt maestro para proteger la arquitectura de VOCERO durante cualquier cambio

## Rol

Actúa exclusivamente como arquitecto y desarrollador de VOCERO.

Tu prioridad absoluta es preservar la arquitectura existente.

No optimices, no simplifiques, no refactorices y no generalices nada sin demostrar primero que el cambio respeta los principios de la plataforma.

Cada modificación debe evaluarse desde la perspectiva de un CRM multiempresa y multivertical.

---

## Objetivo del proyecto

VOCERO no es un chatbot para un negocio concreto.

VOCERO es una plataforma capaz de incorporar múltiples empresas mediante configuración desde el CRM.

El objetivo final es que un nuevo cliente pueda:

1. Crear su negocio.
2. Completar su ficha.
3. Cargar su catálogo.
4. Conectar WhatsApp.
5. Generar su agente.
6. Probarlo.
7. Activarlo.

Sin modificar el núcleo.

Sin escribir código específico para ese cliente.

---

## Principios innegociables

### 1. El núcleo es intocable

El núcleo solo puede conocer estos conceptos:

* Catálogo.
* Selección.
* Datos.
* Estado.
* Validación.
* Confirmación.
* Registro.

El núcleo no puede conocer:

* Salsas.
* Churros.
* Pestañas.
* Uñas.
* Pasteles.
* Profesionales.
* Domicilios.
* Talleres.
* Clínicas.

Si aparece un concepto específico del negocio dentro del núcleo, el cambio debe rechazarse.

---

### 2. La configuración pertenece al CRM

Toda regla específica debe declararse en el CRM.

Nunca en el código.

Ejemplos:

* Productos.
* Servicios.
* Opciones.
* Tamaños.
* Sabores.
* Ingredientes.
* Recargos.
* Requisitos.
* Horarios.
* Políticas.

---

### 3. El CRM es la única fuente de verdad

La IA no inventa reglas.

La IA interpreta la información declarada en el CRM.

---

### 4. Configuración antes que desarrollo

Antes de escribir una sola línea de código, responde esta pregunta:

> ¿Se puede resolver mediante configuración?

Si la respuesta es sí, no se modifica el código.

---

### 5. Ningún cambio puede implementarse pensando en un cliente concreto

Antes de aprobar cualquier modificación, responde obligatoriamente:

> ¿Puede utilizarlo cualquier negocio de VOCERO sin modificar el núcleo?

Si la respuesta es no, el cambio debe rechazarse.

---

### 6. Toda solicitud se clasifica antes de implementarse (18-ago-2026)

Ninguna solicitud puede implementarse antes de responder:

> ¿Esto es una configuración, una capacidad del vertical, una funcionalidad global o un cambio arquitectónico?

Esa única pregunta evita la mayoría de los acoplamientos futuros. El
desarrollo de la clasificación completa está en la sección siguiente.

---

### 7. El backend es la autoridad (15-sep-2026)

El LLM interpreta intenciones. Korex orquesta operaciones seguras. El backend
valida, calcula y guarda el estado real.

**El backend es la autoridad sobre los hechos — no quien los conoce, sino
quien los decide.** Eso no significa que el backend no pueda entregarle
datos al modelo: sí puede, y ya lo hace (una tarifa de domicilio resuelta,
un producto encontrado, un horario disponible). Lo que el modelo recibe así
son **hechos verificados para comunicar**, no datos para recordar y volver
a escribir por su cuenta en el turno siguiente. La distinción exacta:

- El LLM **puede recibir** hechos verificados del backend y **puede
  comunicarlos/redactarlos** al cliente con sus propias palabras.
- El LLM **no puede convertirse en la fuente de verdad** de esos hechos: no
  los memoriza para reusarlos después sin volver a preguntarle al backend,
  no los corrige, no los completa por su cuenta.
- El LLM **no escribe hechos autoritativos**: propone operaciones de un
  conjunto cerrado, y el backend las valida contra datos reales antes de
  aplicarlas. Si no validan, el estado no se toca y el backend devuelve el
  motivo.
- Si el backend conoce el precio, el total, la disponibilidad, una tarifa,
  el estado o si algo quedó confirmado, **el backend decide ese valor** — el
  modelo, como mucho, comunica el valor que el backend ya le entregó.

> **Pregunta de guardia:** ¿este cambio hace que el sistema dependa de que el
> modelo escriba bien un hecho —una cifra, un nombre de producto, una
> confirmación—? Si la respuesta es sí, el cambio no se implementa así.

**De dónde sale.** La familia de fallos más cara de este proyecto tiene una
sola forma: el backend sabe algo con certeza, el modelo lo menciona en una
frase, y otro componente relee esa frase para verificarlo. Falla distinto cada
semana porque cambia la redacción, no la causa. Un guardarraíl nuevo nace cada
vez que el modelo encuentra una frase nueva para prometer algo que no hizo.

**El propio código ya lo aplica donde funciona, y ahí no hay incidentes:** las
zonas de domicilio nunca entran al prompt —se consultan, y el modelo no puede
equivocarse en una tarifa porque nunca la vio—; la disponibilidad de citas la
calcula el servidor; y `offered_slot` impide agendar un horario que el backend
no haya ofrecido.

**Cómo aplicarlo.** Ante cualquier dato nuevo, preguntar *quién tiene la
autoridad sobre él*. Si el backend puede conocerlo, es suyo: el modelo lo
consulta, no lo recuerda. Solo el tono, la redacción y la interpretación del
lenguaje del cliente son del modelo.

---

# Arquitectura oficial de Korex

> **Este bloque es la FUENTE CANÓNICA DE ARQUITECTURA DE KOREX.** Ante
> cualquier contradicción con otro documento — histórico, spec de una
> feature, bitácora, README — **gana este documento**. Ningún documento
> histórico puede modificar, ampliar ni contradecir lo que sigue.
>
> **Regla de precedencia documental**, en caso de conflicto entre fuentes:
>
> 1. `REGLAS-DE-ARQUITECTURA.md` (este documento)
> 2. `CLAUDE.md`
> 3. Documentación arquitectónica vigente (`docs/korexia/`, secciones marcadas como vigentes)
> 4. Specs/Features de implementación (`specs/NNN-nombre/`)
> 5. Documentación histórica (marcada explícitamente como tal)
> 6. Documentación antigua no vigente
>
> La documentación histórica **explica cómo funcionaba antes**. Nunca es
> instrucción para implementar nada nuevo.

## 1. Principio fundamental

**Backend como autoridad** (Principio 7, arriba). El LLM no es la fuente de
verdad sobre el estado de un negocio. Esta sección lo desarrolla en detalle
operativo; el Principio 7 sigue siendo la declaración de intención.

## 2. Flujo oficial

```
CLIENTE
  ↓
LLM interpreta la intención
  ↓
LLM propone Operacion[] (conjunto cerrado, nunca texto libre ni id inventado)
  ↓
Korex orquesta: recibe la propuesta, la sanea, valida su forma
  ↓
BACKEND ejecuta las 3 compuertas (sección 6)
  ↓
Backend resuelve catálogo/servicio/estado contra datos reales
  ↓
Backend calcula (precios, totales)
  ↓
Backend persiste el estado real, atómicamente (sección 7)
  ↓
LLM comunica al cliente lo que el backend ya decidió
  ↓
CLIENTE
```

Implementado en: `src/server/orders/operaciones.ts`,
`src/server/appointments/operaciones.ts`, `src/server/orders/policy.ts`,
`src/server/ai/pipeline.ts` (`guardarEstadoPropuesto`,
`chatJsonConEstado`). Feature de referencia:
`specs/003-backend-como-autoridad/`.

## 3. Responsabilidad de cada capa

- **LLM**: interpreta lenguaje natural, identifica intención, propone
  operaciones del conjunto cerrado, comunica el resultado que el backend
  decidió. Nada más.
- **Korex** (el pipeline): orquesta el turno, sanea la respuesta cruda del
  proveedor (`sinNulos`), valida la forma antes de pasarla al backend,
  decide qué hacer con el veredicto (aplicar, reintentar con el modelo,
  dejar el estado intacto).
- **Backend**: valida cada operación contra las 3 compuertas, resuelve todo
  nombre contra catálogo/agenda/estado reales, calcula, persiste
  atómicamente, decide si un cierre puede ejecutarse.

## 4. Qué NO puede hacer el LLM

El LLM no decide, no escribe ni no inventa:

- precios ni tarifas;
- subtotales ni totales;
- disponibilidad de horarios ni de especialistas;
- costo de domicilio;
- el estado real persistido del pedido o la reserva;
- si un cierre/confirmación puede ejecutarse de verdad;
- identificadores internos (id de producto, de opción, de zona, de slot).

Todo lo anterior lo resuelve, calcula o decide el backend. El LLM solo lo
comunica una vez decidido.

## 5. Contrato de operaciones

El modelo propone **cero o más operaciones de un conjunto cerrado** — nunca
el estado completo, nunca texto libre como fuente de verdad.

**Pedidos** (`src/server/orders/operaciones.ts`): `agregar_item`,
`cambiar_cantidad`, `quitar_item`, `elegir_opcion`, `declinar_grupo`,
`fijar_dato`, `fijar_modalidad`, `confirmar`.

**Citas** (`src/server/appointments/operaciones.ts`): `fijar_servicio`,
`fijar_horario`, `fijar_especialista`, `fijar_dato`, `confirmar`.

Ninguna operación usa un id opaco que el modelo deba recordar. Toda
referencia (`ofrecible`, `servicio`, `especialista`, `grupo`, `opcion`) es el
**nombre tal como aparece en el catálogo real o como lo ofreció el
backend** — el backend la vuelve a resolver contra datos reales en el
momento de aplicarla, con los mismos resolvedores que ya usan las consultas
verificadas (`buscarProductos`, `buscarServicio`,
`resolverEspecialistaMultiple`). No existe `cancelar` en el conjunto:
"empezar de cero" es un mecanismo determinístico anterior al modelo
(`matchesReinicio`/`borrarEstado`), y se queda fuera de las operaciones a
propósito.

## 6. Las tres compuertas del backend

Toda operación pasa, en orden, por (`aplicarOperacion` en ambos módulos):

1. **¿Existe la operación y aplica a este vertical?** — Zod la rechaza antes de que el código de negocio la vea.
2. **¿Sus parámetros resuelven contra datos reales?** — el nombre debe encontrar una fila real en el catálogo/agenda/estado.
3. **¿El estado actual la permite?** — reglas puntuales de negocio (cantidad válida, el requisito existe, la modalidad es una de las ofrecidas).

Si cualquiera falla, la operación se rechaza con `{motivo, correccion}` y el
motivo se le entrega al modelo para que lo explique — nunca deriva
automáticamente a una persona por esto.

## 7. Atomicidad

Un lote de `Operacion[]` es **todo o nada** (`aplicarOperaciones`): si una
operación falla, ninguna del lote se persiste — ni siquiera las que pasaron
sus propias tres compuertas antes que ella. No existe persistencia parcial.

## 8. Confirmación

`confirmar` solo marca la intención en memoria. La autoridad real sobre si
un cierre se ejecuta de verdad vive en la Policy de negocio
(`puedeConfirmarPedido`, `src/server/orders/policy.ts`), que corre después
de guardado el lote y exige ítems resueltos, total calculado y todo
requisito obligatorio cubierto.

## 9. Estado

Distinguir siempre:

- **Estado conversacional**: el historial de mensajes, lo que se le pasa al
  modelo para que entienda el hilo de la conversación.
- **Estado canónico del dominio** (`conversation_state.estado`,
  `EstadoDelPedido`/reserva): el pedido o la cita reales, de los que el
  **backend** es la única autoridad. El modelo nunca reescribe este estado
  directamente — solo lo modifica proponiendo operaciones que el backend
  valida.

## 10. Nuevos clientes

Todo cliente nuevo nace en la arquitectura oficial, sin excepción y sin
paso manual: `arquitecturaAprobadaPara` (`src/server/auth/arquitectura.ts`)
declara `stateSource: 'backend'` como requisito `core` para los dos
verticales, y `provisionOrganization` (`src/server/auth/provisioning.ts`) lo
aplica en el único `insert` de `agent_profile` que existe en el código. No
hay ninguna ruta de la aplicación que pueda crear un cliente en
`state_source='prompt'`.

**El default de la columna (`state_source='prompt'` en `schema.ts`) sigue así
a propósito, y no contradice lo anterior.** Es una protección para cualquier
inserción de `agent_profile` que en el futuro ocurra por fuera de
`provisionOrganization` (un script nuevo, una migración de datos): nacería en
la arquitectura histórica, conocida y segura, en vez de activar sin
verificación la arquitectura nueva sobre un negocio sin catálogo real que
validar. Cambiar ese default a `'backend'` no mejora nada — el camino real ya
no depende de él desde el 29-ago-2026 — y sí debilitaría esa protección.
Investigado sin tocar código el 16-sep-2026 (T030-B); ver
`specs/003-backend-como-autoridad/` para el detalle completo.

## 11. Clientes pausados o sin configurar

**Fuera de alcance no es fuera de arquitectura.** Un cliente puede estar
deshabilitado, pausado, sin catálogo o sin ficha completa — eso nunca
significa que deba usar o vaya a usar la arquitectura histórica. Nace en
`state_source='backend'` y se queda ahí mientras no haya una decisión
explícita y documentada de bajarlo temporalmente (como la contención
operativa de Lis/MALIA durante el rollout de Feature 003 — ver
`specs/003-backend-como-autoridad/tasks.md` y `t029-medicion-operacional.md`
para el estado real vigente). Esa contención puntual **no es una segunda
arquitectura oficial**.

## 12. Cambios de negocio

Un cambio de producto, precio, promoción, servicio, imagen, campaña,
archivo o mensaje **no es, por defecto, un cambio arquitectónico** — se
clasifica y resuelve con las cuatro categorías de la sección siguiente
("Clasificación obligatoria de toda solicitud"). Una necesidad de un
cliente concreto nunca es, por sí sola, justificación para tocar esta
arquitectura.

## 13. Bugs: encontrar la capa responsable

Un bug se corrige en la capa que lo causó, nunca con un parche arbitrario en
otra:

| Capa posible | Ejemplos de causa |
|---|---|
| Modelo / interpretación | el LLM entendió mal la intención del cliente |
| Prompt / comunicación | el LLM entendió bien pero redactó mal la respuesta |
| Orquestación (Korex) | el pipeline saneó, reintentó o decidió mal qué hacer con el veredicto |
| Resolver | el nombre no se resolvió bien contra el catálogo/agenda real |
| Catálogo/estado | el dato real está mal cargado o mal representado |
| Backend / compuertas | una validación, un cálculo o la persistencia fallaron |
| Guardarraíl | un guardarraíl existente no cubre el caso o da un falso positivo |

**No usar el prompt para compensar un error de otra capa.** Antes de cambiar
un prompt o un modelo: reproducir el problema, determinar la causa raíz,
identificar la capa responsable, y confirmar que el problema pertenece
genuinamente a interpretación o comunicación del LLM — nunca asumirlo
porque cambiar el prompt es lo más rápido.

## Regla de no regresión arquitectónica

**La arquitectura oficial no puede retroceder a una arquitectura histórica
por decisión de una IA, cambio de cliente, error de modelo, nueva
funcionalidad o cambio de prompt.**

Ninguna IA puede decidir unilateralmente, sin autorización humana explícita:

- volver a `state_source='prompt'` como arquitectura (no como contención
  operativa puntual y documentada, que sí puede existir);
- hacer que el LLM mantenga o reescriba el estado completo;
- hacer que el LLM sea la fuente de verdad de un hecho de negocio;
- devolver el catálogo completo al prompt como autoridad;
- hacer que el LLM calcule precios, totales o disponibilidad;
- restaurar el flujo antiguo de "una sola acción sin operaciones validadas";
- eliminar el principio de backend como autoridad;
- introducir una excepción arquitectónica pensada para un solo cliente.

Cualquier cambio arquitectónico futuro requiere, en este orden: problema
demostrado → causa raíz → justificación arquitectónica → alternativas
consideradas → impacto → pruebas → revisión explícita → autorización antes
de implementar. Una necesidad de un cliente nunca es, por sí sola,
justificación automática.

## Architecture Checkpoint (obligatorio antes de cualquier cambio relevante)

Antes de modificar algo que toque el flujo de pedidos, citas, precios,
estado o confirmación, responder:

1. ¿Cuál es el problema?
2. ¿Cuál es la causa raíz?
3. ¿Qué capa es responsable (sección 13)?
4. ¿El cambio modifica la arquitectura oficial?
5. ¿La solución conserva Backend como autoridad?
6. ¿El LLM seguirá siendo solo intérprete/comunicador?
7. ¿El backend seguirá siendo la autoridad?
8. ¿Se está creando una excepción específica para un cliente?
9. ¿Se está intentando resolver esto con un parche de prompt?
10. ¿Se está usando documentación histórica como referencia de implementación?
11. ¿El cambio podría reintroducir `state_source=prompt` como arquitectura?
12. ¿Qué prueba demuestra que la arquitectura no retrocedió?

**Si alguna respuesta indica regresión arquitectónica: detenerse. No
implementar. Reportar la contradicción en vez de resolverla por cuenta
propia.**

---

## Clasificación obligatoria de toda solicitud

Cualquier solicitud debe clasificarse en una de estas categorías, y solo
después se implementa.

**1. Configuración de un cliente.** Solo afecta a una empresa, como agregar
una salsa en La Churra o un servicio en Lashes Valen. Se resuelve solo con
configuración. No se toca el núcleo.

**2. Capacidad reutilizable de un vertical.** Si algo puede servir para
varios salones o varios restaurantes, se implementa como capacidad genérica
y configurable para todo ese vertical — nunca para un solo cliente.

**3. Capacidad global del CRM.** Cosas útiles para cualquier negocio: cupones,
descuentos, horarios especiales, múltiples sedes. Deben ser configurables y
opcionales, sin forzar a todos los clientes a usarlas.

**4. Cambio arquitectónico.** Si la solicitud obliga a modificar cómo
funciona la plataforma, antes de implementarse se debe responder:

* ¿Qué problema resuelve?
* ¿Por qué no puede resolverse con configuración?
* ¿Afecta la compatibilidad con otros verticales?

Si la respuesta a "¿a quién sirve?" es **"solo le sirve a este cliente"**, el
cambio no se implementa inmediatamente. **Esta categoría es la única que
requiere `specs/NNN-nombre/spec.md` antes de implementar — ver el Paso 5.**

### ¿Es un dato o una capacidad?

**Dato (configuración del cliente):**

* Agregar una salsa a La Churra.
* Agregar un pastel a Lis Pastelería.
* Agregar un nuevo servicio a Lashes Valen.

➡️ Se modifica el catálogo del cliente.

**Capacidad (funcionalidad reutilizable):**

* Combos de manos y pies.
* Servicios que pueden agruparse.
* Paquetes promocionales.
* Múltiples profesionales para un mismo servicio.

➡️ La pregunta obligatoria: **¿puede otro salón necesitar esto?** Si la
respuesta es sí, deja de ser una configuración individual y pasa a ser una
capacidad del vertical de citas.

### ¿La solicitud pertenece al cliente, al vertical o al CRM?

Clasificación obligatoria:

| Tipo | Ejemplo | Acción |
|---|---|---|
| Cliente | Agregar una nueva salsa | Configuración |
| Vertical | Combos de manicura y pedicura | Capacidad reutilizable |
| CRM | Cupones o descuentos | Funcionalidad global |
| Arquitectura | Cambiar el modelo de reservas | Auditoría obligatoria |

### ¿Otro cliente podría necesitarlo mañana? — la pregunta más importante

Ejemplo resuelto, para no repetir el error dos veces:

**La Churra**: *"Quiero agregar una salsa de queso."* → Configuración. Se
modifica el catálogo de ese cliente y nada más.

**Lashes Valen**: *"Quiero vender un paquete de uñas y pies."* → **No se debe
asumir que es una necesidad exclusiva de Lashes Valen.** La pregunta es:
¿los paquetes pueden existir en otros salones? La respuesta es sí. Por tanto
no se crea una solución específica para Lashes Valen — se crea una capacidad
genérica (por ejemplo, "Paquetes de servicios") que cualquier salón del
vertical de citas puede activar desde el CRM.

### El árbol de decisión

```
¿Solo cambia el catálogo?
  Sí → Configuración del cliente.

¿La funcionalidad puede servir a otros negocios del mismo vertical?
  Sí → Capacidad del vertical.

¿La funcionalidad puede servir a cualquier negocio del CRM?
  Sí → Funcionalidad global.

¿La funcionalidad obliga a modificar el núcleo?
  Sí → Detener la implementación. Realizar la auditoría del Paso 5.
```

---

## Procedimiento obligatorio antes de modificar cualquier cosa

### Paso 1

Identifica el cambio solicitado.

Ejemplos:

* Añadir una salsa.
* Añadir un producto.
* Añadir un tamaño.
* Añadir un recargo.
* Añadir un servicio.

---

### Paso 2

Clasifica el cambio en una de las cuatro categorías de la sección
"Clasificación obligatoria de toda solicitud" (más abajo):

1. Configuración de un cliente.
2. Capacidad reutilizable de un vertical.
3. Capacidad global del CRM.
4. Cambio arquitectónico.

Y dentro de la categoría 1, de qué tipo de dato se trata:

* Catálogo.
* Requisito.
* Recurso.
* Reserva.
* Política.

**Cuidado (8-sep-2026):** el lenguaje de la solicitud no basta para
clasificar. Cuando exista duda, comprobar primero qué mecanismo/archivos
reales serían afectados (adelantando la pregunta del Paso 4) y si son
compartidos por la plataforma, antes de fijar la categoría — una petición
redactada en términos de un solo cliente puede requerir tocar algo
compartido por todas las organizaciones.

---

### Paso 3

Busca el propietario del dato.

¿Quién debe controlar ese dato?

* El CRM.
* El catálogo.
* La ficha.
* El núcleo.

---

### Paso 4

Comprueba el impacto.

Debes responder estas preguntas:

* ¿Qué archivos se modifican?
* ¿Qué contratos cambian?
* ¿Hay migraciones?
* ¿Hay datos en producción?
* ¿Hay pruebas afectadas?
* ¿Existe riesgo de romper otro vertical?

---

### Paso 5

Auditoría obligatoria.

Antes de escribir código, entrega siempre este informe:

## Inventario

* Archivos afectados.
* Responsabilidades.
* Dependencias.

## Hallazgos

* Riesgos.
* Acoplamientos.
* Contradicciones.

## Impacto

* Local.
* Producción.
* Migraciones.

## Recomendación

* Implementar.
* Posponer.
* Rechazar.

No se escribe código hasta terminar la auditoría.

**Si la clasificación del Paso 2 fue "cambio arquitectónico" (Fase 4,
8-sep-2026):** esta auditoría no se queda en un mensaje — se escribe como
`specs/NNN-nombre/spec.md` (numeración siguiente disponible en `specs/`)
**antes** de implementar, y se aprueba explícitamente antes de escribir
código. Las demás categorías (configuración de cliente, capacidad de
vertical, capacidad global) NO pasan por `specs/`: se documentan directo en
`docs/korexia/`, como ya es la práctica.

---

## Cambios permitidos sin tocar la arquitectura

### La Churra

Se puede:

* Añadir productos.
* Añadir sabores.
* Añadir salsas.
* Añadir tamaños.
* Añadir recargos.
* Cambiar precios.

No se puede:

* Añadir reglas al núcleo.

---

### Lashes Valen

Se puede:

* Añadir servicios.
* Añadir profesionales.
* Cambiar horarios.
* Cambiar disponibilidad.

No se puede:

* Convertir un profesional en una opción del catálogo.

Los profesionales pertenecen al sistema de recursos y reservas.

---

### Lis Pastelería

Se puede:

* Añadir productos.
* Añadir tamaños.
* Añadir presentaciones.

No se puede:

* Modificar el núcleo para adaptarlo a la pastelería.

La pastelería debe adaptarse mediante configuración.

---

### Capacidad reutilizable del vertical de citas (ejemplo)

Se puede:

* Combos de servicios (manos y pies, corte y barba).
* Paquetes promocionales.
* Múltiples profesionales para un mismo servicio.

No se puede:

* Implementarlo pensando solo en Lashes Valen. Si otro salón puede
  necesitarlo, se construye como capacidad del vertical, configurable y
  opcional, no como código específico de un cliente.

---

### Capacidades globales del CRM (para cualquier negocio)

Ejemplos: cupones, descuentos, horarios especiales, múltiples sedes.

Se puede:

* Construirlas como funcionalidad del CRM, disponible para cualquier
  vertical.

No se puede:

* Forzar a todos los clientes a usarlas. Deben ser configurables y
  **opcionales** — un cliente que no las active no nota que existen.

---

## Orden de implementación

1. Configuración.
2. Simulación.
3. Pruebas locales.
4. Cliente efímero.
5. Revisión manual.
6. Producción.

Nunca se puede saltar un paso.

---

## Banco de escenarios

No crear miles de escenarios.

Solo mantener escenarios críticos.

Cuando aparezca un error en producción:

1. Documentarlo.
2. Convertirlo en una prueba.
3. Añadirlo al banco de escenarios.

---

## Restricción absoluta sobre Codex

Codex solo puede actuar como auditor.

Puede:

* Revisar.
* Analizar.
* Detectar riesgos.
* Revisar arquitectura.
* Auditar migraciones.
* Revisar pruebas.

No puede:

* Editar código.
* Crear archivos.
* Modificar funciones.
* Escribir migraciones.
* Hacer commits.
* Hacer push.

Codex nunca puede modificar el proyecto.

---

## Regla final

Si una modificación obliga a tocar el núcleo para incorporar un nuevo negocio, la implementación debe detenerse inmediatamente.

El objetivo no es hacer funcionar un cliente.

El objetivo es hacer crecer una plataforma.
