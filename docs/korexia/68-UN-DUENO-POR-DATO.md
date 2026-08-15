# Un dueño por dato: el prompt con dos escritores

> **Dentro:** Quién escribe hoy · Las cinco colisiones · Lo que nadie había
> dicho: fuente contra derivado · El flujo actual · El flujo propuesto · El plan
> de migración con rollback

**Encargo del dueño (15-ago-2026):** *"Antes de continuar con la Fase 2, quiero
resolver el problema del prompt con dos escritores. Quiero identificar al
propietario de cada dato y eliminar las escrituras concurrentes sobre la misma
información. No quiero parches."*

---

## Quién escribe `agent_profile` hoy

Nueve rutas, contando el alta y la demo:

| Campo | Cuestionario `aplicarFicha` | Script `fichas-de-clientes` | `regenerar:flota` | Panel del cliente `PUT /api/agent/profile` | `/admin` | `migrar:catalogo` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `ficha` | ✍️ | ✍️ | | | | |
| `instructions` | ✍️ | ✍️ | ✍️ | | | |
| `escalationRules` | ✍️ | ✍️ | ✍️ | | | |
| `greeting` | ✍️ | ✍️ | ✍️ | | | |
| `name` | ✍️ | ✍️ | ✍️ | | | |
| `tone` | ✍️ | | | | | |
| `hoursDays` · `hoursOpen/Close` (+domingo) | ✍️ | | | | | |
| `notifyPhones` | ✍️ (condicional) | | | ✍️ | | |
| `notifyTemplate` · `notifyTemplateLang` | | | | ✍️ | | |
| `enabled` | ✍️ (fuerza `false`) | | | ✍️ | | |
| `appointmentsEnabled` | ✍️ | | | | ✍️ | |
| `catalogSource` | | | | | | ✍️ |

(`provisioning.ts` hace el `INSERT` inicial; `seed/demo.ts` no toca producción.)

## Las cinco colisiones

| # | Campo | Escritores | Qué pasa cuando chocan |
|---|---|---|---|
| **1** | **`ficha`** | cuestionario + script | 🔴 **La que ya mordió.** El 15-ago a las 12:59 el prompt de La Churra pasó de 18.053 a 11.889 caracteres y perdió sus reglas de flujo |
| **2** | `instructions` · `greeting` · `escalationRules` · `name` | los tres | El último gana. Ninguno avisa |
| **3** | **`enabled`** | cuestionario + panel del cliente | 🔴 El cuestionario lo fuerza a `false`: **un cliente enciende su agente y al reenviar el cuestionario se apaga solo** |
| **4** | `notifyPhones` | cuestionario + panel | Mitigado el 15-ago (solo escribe si vienen teléfonos), pero los dos siguen pudiendo |
| **5** | `appointmentsEnabled` | cuestionario + `/admin` | El cuestionario lo deduce del vertical y pisa lo que puso la agencia |

## Lo que nadie había dicho: fuente contra derivado

Repartir propiedad campo por campo **no basta**, porque hay dos clases de datos
mezcladas en la misma tabla:

- **Fuente**: `ficha`, `enabled`, `notifyPhones`, `catalogSource`. Alguien los
  decide. Aquí sí falta un dueño único.
- **Derivado**: `instructions`, `greeting`, `escalationRules`, `name`. **Nadie
  los decide: se compilan** desde `ficha` + `conducta.ts`. Que tengan tres
  escritores no es el problema — el problema es que sean **editables**.

> 🔑 La colisión #2 no se arregla con un dueño. Se arregla dejando de tratar el
> resultado de una compilación como un dato que se puede escribir.

De ahí que la regla no sea *"un escritor por campo"* sino:

> **Cada dato tiene un dueño. Lo derivado no se escribe: se recompila.**

## El flujo actual

```mermaid
flowchart TD
    C[Cliente rellena<br/>el cuestionario] --> AF[aplicarFicha]
    O[Operador] --> FC[fichas-de-clientes]
    O --> RF[regenerar:flota]
    P[Cliente en su panel] --> API[PUT /api/agent/profile]
    A[Agencia en /admin] --> ADM[PATCH /admin/clients]

    AF -->|ficha COMPLETA| F[(ficha)]
    FC -->|ficha COMPLETA| F
    AF --> I[(instructions<br/>greeting<br/>escalationRules)]
    FC --> I
    RF --> I
    AF -->|fuerza false| E[(enabled)]
    API --> E
    AF --> N[(notifyPhones)]
    API --> N
    AF --> AE[(appointmentsEnabled)]
    ADM --> AE

    F --> I

    style F fill:#c62828,color:#fff
    style E fill:#c62828,color:#fff
    style I fill:#ef6c00,color:#fff
```

En rojo, los dos campos donde una escritura **borra en silencio** el trabajo de
la otra.

## El flujo propuesto

La `ficha` deja de ser un bloque único y pasa a **secciones con dueño**. Cada
escritor toca **solo su sección**, con `jsonb_set`, nunca reemplazando el
objeto entero:

```json
{
  "schema_version": 2,
  "negocio":   { "nombre": "…", "tono": "…", "horario": {}, "pagos": {}, "domicilios": {} },
  "flujo":     { "reglasPropias": [], "saludoInicial": "…" },
  "politicas": { "cancelacion": "…", "salud": "…" }
}
```

| Sección | Dueño único | Quién NO la toca |
|---|---|---|
| `negocio` | **el cliente**, por el cuestionario | el script |
| `flujo` | **el operador**, por script | el cuestionario |
| `politicas` | **el operador**, por script | el cuestionario |
| ~~`catalogo`~~ | **se elimina**: vive en `product` desde la Fase 1 | — |

```mermaid
flowchart TD
    C[Cliente:<br/>cuestionario] -->|solo .negocio| FN[(ficha.negocio)]
    O[Operador:<br/>script] -->|solo .flujo| FF[(ficha.flujo)]
    O -->|solo .politicas| FP[(ficha.politicas)]
    P[Cliente en su panel] -->|dueño único| E[(enabled)]
    A[Agencia /admin] -->|dueño único| AE[(appointmentsEnabled)]
    CAT[migrar:catalogo] -->|dueño único| CS[(catalogSource)]

    FN --> G{generarPerfil}
    FF --> G
    FP --> G
    PROD[(product<br/>Fase 1)] --> G
    COND[conducta.ts] --> G
    G -->|RECOMPILA, nadie escribe a mano| I[(instructions · greeting<br/>escalationRules)]

    style FN fill:#2e7d32,color:#fff
    style FF fill:#2e7d32,color:#fff
    style FP fill:#2e7d32,color:#fff
    style I fill:#1565c0,color:#fff
```

Tres cambios más, pequeños y con consecuencia grande:

1. **El cuestionario deja de tocar `enabled`.** Encender y apagar es del
   cliente. Hoy reenviar el cuestionario apaga un agente que estaba vendiendo.
2. **`appointmentsEnabled` pasa a `/admin`**, que es quien contrata el vertical;
   el cuestionario deja de deducirlo.
3. **`generado_de` (hash de la ficha)**: si no coincide con la ficha actual, el
   prompt está viejo y se sabe **antes** de que alguien lo note en una
   conversación.

## El plan de migración, con rollback en cada paso

Aditivo, por cliente y reversible sin desplegar — como la Fase 1.

| Paso | Qué se hace | Rollback |
|---|---|---|
| **1** | Migración aditiva: `ficha_v2 jsonb` + `ficha_schema int` + `generado_de text`. **Nada las lee todavía** | `DROP COLUMN` (aún vacías) |
| **2** | Backfill: partir la `ficha` actual en las tres secciones, **por cliente y revisado a ojo**. `ficha` v1 intacta | no se ha tocado v1 |
| **3** | **Doble escritura**: cada escritor escribe su sección en v2 y sigue escribiendo v1 como hoy. Se lee de v1 | quitar la escritura de v2 |
| **4** | Comparar v1 contra lo que produciría v2 en toda la flota. **Solo se avanza si el prompt sale idéntico** | — |
| **5** | Voltear la lectura a v2 con `ficha_schema = 2`, **cliente por cliente**: primero el salón (apagado), luego La Churra, **Lis la última** | `UPDATE ficha_schema = 1`, sin desplegar |
| **6** | Semanas después: dejar de escribir v1 y borrar la columna | tras respaldo |

**Orden de clientes** (regla 9): salón → La Churra → Lis.

## Lo que este plan NO hace

- **No toca `conversation_state`** ni nada de la Fase 2: son problemas distintos.
- **No cambia el flujo conversacional** (regla 12).
- **No migra a Lis** hasta el final, y solo con la fase validada.
- **No arregla el hueco del catálogo** (recubierto y adiciones siguen fuera de
  `product`); eso es completar la Fase 1 y va aparte.

## La pregunta de control (regla 14)

> ¿Esto reduce la dependencia del prompt de 18.000 caracteres?

**Sí.** Hoy el prompt es la única copia de verdad de las reglas de un negocio, y
por eso perderlo duele tanto. Con las secciones separadas, el prompt vuelve a
ser lo que debería: **un artefacto que se puede tirar y recompilar** desde
datos con dueño.
