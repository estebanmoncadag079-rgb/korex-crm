# Lis entra en la arquitectura nueva

> **Dentro:** Por qué estaba fuera · El "92" que no era comparable · Los tres
> bugs que salieron por el camino · Lo que se aplicó · Cómo revertir cada paso

**19–20 de agosto de 2026.** Lis Pastelería pasa de ser el último cliente con
prompt escrito a mano a ser **el primero de la flota con la arquitectura
completa**: ficha propia, catálogo en tablas y estado en el backend.

---

## Por qué llevaba semanas fuera

No era un olvido: estaba **excluida a propósito**. `migrar:catalogo` se negaba a
correr sobre ella («este negocio no tiene ficha guardada»), el plan de ownership
decía «Lis nunca (no tiene ficha)», y el orden congelado la ponía la última —
porque su valor no es ser el segundo cliente de pedidos, sino **la prueba de que
la plataforma se replica**, y eso solo significa algo con los otros dos modelos
estabilizados.

Y había un candado concreto: su ficha estaba escrita pero `pausado: true`, con
esta razón — *"su Laboratorio quedó entre 83 y 75 frente a los 92 de su prompt
de siempre, y eso no alcanza para tocarle el prompt al cliente que más
factura"*.

## El "92" que no era comparable

Se midió otra vez, el mismo día, con el mismo juez, para las dos:

| | Laboratorio (19-ago) |
|---|---|
| Prompt generado desde la ficha | **83**, luego 75 en otra corrida |
| **Prompt manual, el que estaba en producción** | **75** |

**No había diferencia.** El "92" venía de otra versión del juez y del código,
semanas atrás; comparar contra él era comparar contra otra vara. Y el prompt
manual traía un defecto propio que el generado no tiene: en su corrida
**alucinó un total** ($18.000) para un pedido sin toppings ni celular todavía.

> 🔑 La lección no es "el generado es mejor". Es que **un número medido con otra
> versión del sistema no es un número**: si va a decidir algo, se vuelve a medir.

---

## Los tres bugs que salieron por el camino

Ninguno era de Lis. Los tres afectaban a la plataforma entera y llevaban días
sin que nadie los viera.

### 1. Dos scripts de la flota no compilaban desde el 15-ago

`fichas-de-clientes.ts` y `regenerar-flota.ts` tenían un bloque de sintaxis roto
(un `})` de más y un `);` suelto, en los dos archivos, del commit `ce2912d`).
Cualquiera que hubiera intentado regenerar el prompt de la flota en estos cinco
días se habría encontrado con que **no arranca**. Nadie lo intentó.

### 2. El lector de catálogo confundía el tamaño con el precio

`precioACents` buscaba el primer número de la línea entera:

```
"Cremoso 7 oz — $12.000"   →   precio: $7      ← el "7" de la onzada
"Cremoso Familiar 44 oz"   →   precio: $44
```

Ahora el nombre se corta primero y el precio se busca **después** de ese corte.
Es genérico: le habría pasado a cualquier catálogo con tallas, pesos o medidas
en el nombre.

### 3. Las cabeceras con emoji no se reconocían

`🥤 *CREMOSOS*` se leía como un producto, porque el patrón exigía que la línea
empezara literalmente en `*`. Tres categorías acabaron convertidas en productos
sin precio.

Los dos últimos se corrigieron en `catalog/sembrar.ts` y **se probaron contra La
Churra** antes de tocar a Lis: su catálogo sigue leyéndose idéntico.

---

## Lo que se aplicó, en orden

| Paso | Qué | Cómo revertir |
|---|---|---|
| **1** | Verificar el estado real en la base | — (solo lectura) |
| **2** | Corregir el horario del domingo en la ficha (decía "domingos no abrimos"; la base dice 14:00–19:00 y **la base manda**) | incluido en el paso 3 |
| **3** | Guardar su ficha y recompilar el prompt (`instructions` pasa de manual a derivado) | restaurar desde `agent_profile_bk_lis_19ago` |
| **4** | Reformatear su catálogo al formato "por producto" que ya usa La Churra: bebidas y porciones de torta una por línea, y los toppings declarando **cuántos lleva cada tamaño** | idem |
| **5** | `migrar:catalogo --aplicar` → 15 productos · 5 grupos · 55 opciones | `DELETE FROM product WHERE organization_id='org_lispasteleria0001'` |
| **6** | `migrar:catalogo --encender` (`catalog_source='tabla'`) | `pnpm migrar:catalogo <org> --apagar` |
| **7** | `migrar:requisitos --aplicar` (nombre, teléfono, dirección) | restaurar la ficha del respaldo |
| **8** | `pnpm fase2 <org> --encender` (`state_source='backend'`) | `pnpm fase2 <org> --apagar` |

Todos los pasos son de **datos**: ni uno solo necesitó código específico para
Lis, y el rollback de cada uno es un `UPDATE`/`DELETE` acotado por
`organization_id`, sin desplegar.

---

## Verificado en vivo

Dos pedidos completos por el pipeline real (conversación `is_test`, nunca toca
WhatsApp):

- Producto resuelto a un **id real del catálogo**, no a texto
- **El total lo calcula el servidor**: `totalCents=1200000` para el de 7 oz
- Opciones resueltas a sus grupos: `TOPPING:MILO`
- Los toppings se piden según el tamaño: 1 para el de 7 oz, 2 para el de 12
- Confirmación aceptada, `rechazos=0`, latencia de backend ~890 ms
- Un pedido de **varios productos** ("2 cremosos de 12 y una porción de torta")
  con toppings distintos por ítem, resumido bien y con su total correcto

---

## Estado de la flota

| Negocio | Ficha | Catálogo | Fase 2 |
|---|---|---|---|
| **Lis Pastelería** | ✅ | tabla | **backend** |
| La Churra | ✅ | tabla | prompt |
| Lashes Valen | ✅ | prompt | prompt |

⚠️ **La Fase 2 de Lis solo funciona con el código de
[110](110-EL-MODELO-NO-EMITIA-EL-ESTADO.md) desplegado.** Con el contenedor
viejo la bandera está encendida pero el estado no se guarda — degrada al
comportamiento de siempre, sin romper nada, pero sin protección ninguna.
