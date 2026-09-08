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
