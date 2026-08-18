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

Clasifica el cambio.

¿Es?

* Configuración.
* Catálogo.
* Requisito.
* Recurso.
* Reserva.
* Política.
* Cambio arquitectónico.

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
