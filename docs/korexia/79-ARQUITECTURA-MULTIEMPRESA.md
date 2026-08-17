# Arquitectura multiempresa: las decisiones del 17-ago

> **Dentro:** La restricción que manda sobre todo · Las siete reglas · Las tres
> decisiones · La hoja de ruta en cuatro pasos · La ventana que se cierra · Qué
> queda congelado

**Dictadas por el dueño el 17-ago-2026**, después de la auditoría del modelo de
las opciones ([77](77-EL-MODELO-DE-LAS-OPCIONES.md)) y del informe de impacto
([78](78-CAMBIAR-EL-MODELO-IMPACTO.md)). Son **restricciones de diseño**, no
recomendaciones: un cambio que las incumpla no entra.

---

## La restricción que manda sobre todo

> **Esta arquitectura NO se está construyendo para La Churra.** La Churra es el
> primer caso de uso y el entorno de validación. El objetivo es una plataforma
> capaz de sostener **varios tipos de negocio con el mismo núcleo
> conversacional**.

Y de ahí sale la pregunta con la que se evalúa cualquier cambio:

> ### ¿Esta solución sigue funcionando cuando el negocio no vende comida?

Si la respuesta es no, la solución se replantea. **No se corrige: se
replantea.**

## Las siete reglas

1. **Prohibida la lógica específica de La Churra en el núcleo.**
2. **Ningún nombre de grupo codificado en la lógica del estado** — ni `salsas`,
   ni `recubierto`, ni `adiciones`.
3. **El estado del pedido no puede depender del catálogo de un solo negocio.**
4. **La definición del catálogo y la selección del cliente son dos modelos
   distintos.**
5. **Las reglas del negocio se configuran desde el CRM.**
6. **Un cliente debe poder definir su metodología sin que nadie toque código.**
7. La pregunta deja de ser *"¿cómo funciona La Churra?"* y pasa a ser **"¿cómo
   describe cualquier negocio lo que vende?"**

## Las tres decisiones

### 1. La Fase 2 es un componente COMÚN, no del vertical de pedidos

Hoy el pipeline la excluye de citas por diseño
(`!profile.appointmentsEnabled && …`). Deja de ser aceptable: el estado
estructurado tiene que servir a restaurantes, salones y a los verticales que
vengan.

### 2. El estado se unifica en una SELECCIÓN

```
seleccion: [ { grupoId, opcionId, cantidad } ]
```

Tres de los cinco errores de la noche del 16 **dejan de ser expresables** en
cuanto cada elemento sabe a qué grupo pertenece
([78](78-CAMBIAR-EL-MODELO-IMPACTO.md), §7).

### 3. El dueño del flujo es el CRM, no el backend

Hoy están en código: el orden de las preguntas, los requisitos para cerrar y los
campos obligatorios. Eso es configuración de cada negocio, y su sitio es Pocero.

---

## La hoja de ruta

| Paso | Qué | Estado |
|---|---|---|
| **1** | **La selección genérica.** Solo eso. Sin tocar citas | 🔄 en curso |
| **2** | **Un solo dueño para el vertical**: hoy son dos (`appointmentsEnabled` y `ficha.vertical`), y existe código para comprobar que no se contradigan — que es la señal del problema | ⬜ |
| **3** | **Opciones en los servicios.** Un salón no puede describir *manicura → con esmalte · diseño sencillo · diseño elaborado*: hoy acaba en texto libre del prompt | ⬜ |
| **4** | **Citas entra en la Fase 2** | ⬜ |
| **5** | Solo entonces, **encender** | ⬜ |

## 🔴 Lo que queda CONGELADO

**Ni una corrección más específica de La Churra.** En concreto, y a propósito:

- `faltaParaCerrar()` (tarea 2C) — **no se toca**: se rehace entero en el paso 1.
- El `"0"` del reinicio — se resuelve como configuración en el paso 3, no como
  parche.
- La carga de `RECUBIERTO` y `ADICIONES` en La Churra — **no se ejecuta**: el
  modelo que la valida está a punto de cambiar.
- El encendido de la bandera, en cualquier cliente.

## La ventana que se cierra

`conversation_state` está **vacía** — verificado en producción el 17-ago: 0
filas, 0 organizaciones, los cuatro clientes en `'prompt'`.

Eso permite cambiar **el contrato central del sistema sin una sola migración de
datos y sin romper ninguna conversación viva**. El propio código trata un
`schema_version` desconocido como *"se empieza limpio"*: con pedidos en curso,
eso significaría perder el pedido de alguien.

> **Es el único argumento de esta lista que caduca.** Dentro de un mes, con la
> Fase 2 encendida, este cambio deja de ser gratis y pasa a ser una migración
> con conversaciones reales encima.
