/**
 * Las operaciones que el LLM puede proponer sobre el pedido en curso — Feature
 * 003-backend-como-autoridad, Principio 7 de `REGLAS-DE-ARQUITECTURA.md` ("El
 * backend es la autoridad").
 *
 * Sustituye al "estado completo" que hoy propone el modelo
 * (`esquemaDelEstado`, `pipeline.ts:4779`): en vez de reescribir el pedido
 * entero cada turno, el modelo emite una lista de `Operacion` y el backend las
 * aplica, una por una, sobre el estado YA guardado (`estado.ts`).
 *
 * Ver `specs/003-backend-como-autoridad/data-model.md` — este archivo es su
 * traducción directa a código, secciones 1 (el tipo), 2 (el lote atómico) y 3
 * (las compuertas) — las tres ya implementadas (T004-T007): `aplicarOperacion`
 * cubre las tres compuertas por operación, `aplicarOperaciones` el lote
 * completo.
 *
 * **Ninguna operación referencia por id.** Corrección de diseño del
 * 15-sep-2026: el diseño original de este archivo asumía ids que el backend
 * le daría al modelo (de `consultar_producto`, etc.) para que los citara
 * después — un patrón que no existe en ningún resolvedor real del proyecto.
 * `buscarProductos`, `buscarOpciones`, `resolverZonaDeEntrega` y
 * `buscarServicio` resuelven TODOS por nombre, con búsqueda difusa, en el
 * momento — nunca contra un id que el modelo deba recordar de un turno
 * anterior (`normalizar.ts:26`: "El LLM no ha visto un id en su vida y no
 * debe verlo"). Las operaciones de aquí siguen la misma regla.
 *
 * ⚠️ Igual que `estado.ts`: nada de esto corre para ningún cliente todavía.
 * Se activa recién en T027, tras completar y probar T001-T026.
 */
import { z } from "zod";
import type { EstadoDelPedido, ItemDelPedido } from "./estado";
import { normalizarPedido, type OpcionPropuesta } from "./normalizar";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * Una opción elegida, tal como la propone el modelo — **el mismo tipo que ya
 * usa `ItemPropuesto.opciones`** (`normalizar.ts:34`), reutilizado sin
 * redeclarar: `{ grupo?: string | null, opcion: string }`.
 *
 * Aparece en `agregar_item` para describir de una vez lo que el cliente pidió
 * (*"una Churrita con arequipe"* en una sola operación), y opcionalmente en
 * `cambiar_cantidad`/`quitar_item`/`elegir_opcion`/`declinar_grupo` — ahí
 * SOLO hace falta cuando el nombre del producto por sí solo no basta para
 * saber a cuál línea del pedido se refiere (dos líneas del mismo producto con
 * opciones distintas). La mayoría de los turnos no la necesitan: la mediana
 * de un pedido real es 1 ítem.
 */
const OpcionPropuestaSchema: z.ZodType<OpcionPropuesta> = z.object({
  grupo: z.string().nullish(),
  opcion: z.string().min(1),
});

/**
 * Las operaciones del vertical de pedidos. Unión discriminada por `tipo`, en
 * el mismo estilo que `AgentAction` (`ai/actions.ts:12`) — es el mismo tipo
 * de contrato (algo que el LLM propone y el servidor valida antes de
 * ejecutar), aplicado un nivel más abajo (al estado del pedido, no al turno
 * completo).
 *
 * `additionalProperties`/`required` estrictos se imponen en el JSON-schema
 * que se le manda al proveedor (T012, `ai/actions.ts` o `ai/prompts.ts` según
 * corresponda) — igual que hoy `AgentAction` no usa `.strict()` aquí porque
 * esa exigencia ya la impone `response_format: json_schema` del lado del
 * proveedor, no Zod.
 *
 * `cantidad` se deja como `number` suelto a propósito: la validación real
 * (entero, ≥ 1) es trabajo de la Compuerta 3 (T006), igual que
 * `validarPropuesta` ya hace con las propuestas de hoy — no se duplica la
 * regla en dos sitios.
 */
export const Operacion = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("agregar_item"),
    ofrecible: z.string().min(1),
    opciones: z.array(OpcionPropuestaSchema),
    cantidad: z.number(),
  }),
  z.object({
    tipo: z.literal("cambiar_cantidad"),
    ofrecible: z.string().min(1),
    /** Solo para desambiguar si hay más de una línea con este nombre. */
    opciones: z.array(OpcionPropuestaSchema).optional(),
    cantidad: z.number(),
  }),
  z.object({
    tipo: z.literal("quitar_item"),
    ofrecible: z.string().min(1),
    opciones: z.array(OpcionPropuestaSchema).optional(),
  }),
  z.object({
    tipo: z.literal("elegir_opcion"),
    ofrecible: z.string().min(1),
    opciones: z.array(OpcionPropuestaSchema).optional(),
    grupo: z.string().min(1),
    opcion: z.string().min(1),
  }),
  z.object({
    tipo: z.literal("declinar_grupo"),
    ofrecible: z.string().min(1),
    opciones: z.array(OpcionPropuestaSchema).optional(),
    grupo: z.string().min(1),
  }),
  /**
   * `requisitoId` NO es una excepción a "nunca por id": es la clave que el
   * propio esquema JSON de este turno define fresca a partir de la ficha del
   * negocio (`requisitos.map(r => r.id)`, igual que hoy en
   * `chatJsonConEstado`) — el modelo no la recuerda de un turno anterior, la
   * recibe de nuevo cada vez como parte de la forma misma de la respuesta que
   * se le exige.
   */
  z.object({
    tipo: z.literal("fijar_dato"),
    requisitoId: z.string().min(1),
    valor: z.string(),
  }),
  /**
   * Mismo caso que `requisitoId`: el `enum` real de valores permitidos lo
   * arma el JSON-schema de este turno con `modalidadesOfrecidas` de la ficha
   * de ESTE negocio (igual que `pipeline.ts:4843-4849` hoy) — aquí no se
   * repite esa lista porque depende de datos de negocio, no del núcleo.
   */
  z.object({
    tipo: z.literal("fijar_modalidad"),
    modalidad: z.string().min(1),
  }),
  /**
   * NO hay `cancelar` en esta unión — corrección de diseño del 16-sep-2026.
   * "Empezar de cero"/cancelar el pedido entero ya existe hoy, y es
   * DETERMINÍSTICO, nunca una decisión del modelo:
   * `matchesReinicio`/`borrarEstado` (`pipeline.ts:4571-4582`, `:1180`), por
   * palabra clave configurable por negocio (`"0"` en La Churra), corriendo
   * ANTES de llamar al modelo — "si dependiera del LLM, un turno confuso
   * podría arrastrar un pedido que el cliente ya canceló" (comentario
   * original). Ese mecanismo sigue exactamente igual con este motor de
   * operaciones: no se le agrega, no se le quita nada, y no se convierte en
   * una `Operacion` que el modelo pueda emitir. La versión anterior de este
   * archivo sí tenía `cancelar` aquí, vaciando el estado con `estadoVacio()`
   * — una semántica inventada, nunca especificada en `data-model.md` ni en
   * `spec.md`, y que además contradecía el propio principio ya escrito en
   * `pipeline.ts`. Se retira sin reemplazo: el mecanismo correcto ya existe
   * y no necesita esta unión para nada.
   */
  z.object({ tipo: z.literal("confirmar") }),
]);

export type Operacion = z.infer<typeof Operacion>;

/**
 * Lo que `aplicarOperacion` necesita para resolver una operación contra
 * datos reales — nunca contra lo que el modelo recuerde.
 *
 * `catalogo` y `requisitos` llegan YA resueltos y YA filtrados por
 * organización (Principio III de la constitución: multi-tenancy real) —
 * este módulo no consulta la base directamente, los recibe de quien lo
 * invoque (mismo patrón que `validarPropuesta` ya usa hoy).
 */
export type ContextoOperaciones = {
  organizationId: string;
  catalogo: ProductoDelCatalogo[];
  requisitos: Requisito[];
  /** Las que ofrece ESTE negocio; ausente o `[]` si no aplica. */
  modalidadesOfrecidas: readonly string[];
  /** Mismo parámetro opcional que ya recibe `normalizarPedido`. */
  unidadesPorProducto?: Record<string, number>;
};

/**
 * El veredicto de aplicar UNA operación — mismo contrato que ya usa la Policy
 * de pedidos (`orders/policy.ts`, `VeredictoDePedido`): un veredicto y nada
 * más. Reintentar con el modelo, derivar o registrar la traza siguen siendo
 * responsabilidad de quien llama, no de esta función.
 */
export type ResultadoDeOperacion =
  | { ok: true; estado: EstadoDelPedido }
  | { ok: false; motivo: string; correccion: string };

/**
 * Sin tildes, sin mayúsculas: comparar nombres, no ortografías.
 *
 * Mismo criterio que `catalog/buscar.ts`/`normalizar.ts`/`appointments/logic.ts`
 * ya usan cada uno por su cuenta (el propio proyecto documenta esta
 * duplicación como un patrón conocido, `docs/korexia/156`, hallazgo D) — este
 * archivo necesita su propia copia por el mismo motivo que los otros tres: no
 * hay una función exportada que reutilizar, y el algoritmo es un one-liner.
 * A diferencia de esos, aquí NO hace falta tolerancia difusa (prefijos,
 * plurales): lo que se compara contra `estado.items` es el nombre CANÓNICO
 * que el propio backend ya escribió al agregar el ítem, no texto libre de un
 * cliente — una igualdad exacta tras normalizar basta.
 */
function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

type BusquedaItem =
  | { status: "found"; indice: number }
  | { status: "not_found" }
  | { status: "multiple_matches" };

/**
 * Encuentra, dentro del pedido YA guardado, la línea que nombra
 * `cambiar_cantidad`/`quitar_item`/`elegir_opcion`/`declinar_grupo`.
 *
 * Es la única pieza de resolución genuinamente NUEVA de esta feature: no
 * existía antes porque hoy el modelo reescribe el pedido entero cada turno,
 * así que nunca tuvo que "encontrar una línea ya puesta". Sigue el mismo
 * principio que los buscadores del catálogo: por nombre, nunca por id, y
 * ante la ambigüedad se pregunta en vez de adivinar.
 */
function buscarItemExistente(
  items: ItemDelPedido[],
  ofrecible: string,
  opciones?: OpcionPropuesta[]
): BusquedaItem {
  const q = normalizarNombre(ofrecible);
  const candidatos = items
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => item.ofrecible.nombre && normalizarNombre(item.ofrecible.nombre) === q);

  if (candidatos.length === 0) return { status: "not_found" };
  if (candidatos.length === 1) return { status: "found", indice: candidatos[0]!.indice };

  // Dos o más líneas con el mismo producto: solo se resuelve si `opciones`
  // alcanza para distinguirlas (mismo criterio que la ambigüedad de
  // `buscarProductos`/`buscarOpciones`: preguntar, no adivinar).
  if (opciones && opciones.length > 0) {
    const masEspecificos = candidatos.filter(({ item }) =>
      opciones.every((op) =>
        item.seleccion.some(
          (s) =>
            normalizarNombre(s.nombre) === normalizarNombre(op.opcion) &&
            (!op.grupo || normalizarNombre(s.grupoNombre) === normalizarNombre(op.grupo))
        )
      )
    );
    if (masEspecificos.length === 1) return { status: "found", indice: masEspecificos[0]!.indice };
  }
  return { status: "multiple_matches" };
}

/** Copia superficial de un `ItemDelPedido` — nunca se muta el original. */
function copiarItems(items: ItemDelPedido[]): ItemDelPedido[] {
  return items.map((i) => ({
    ...i,
    ofrecible: { ...i.ofrecible },
    seleccion: [...i.seleccion],
    gruposDeclinados: i.gruposDeclinados ? [...i.gruposDeclinados] : i.gruposDeclinados,
  }));
}

/**
 * `agregar_item`: construye el ítem nuevo pasándolo por `normalizarPedido`
 * con una lista de un solo elemento.
 *
 * **Por qué Compuerta 2 y 3 se implementan juntas para esta operación (y para
 * `elegir_opcion`/`declinar_grupo` más abajo):** `normalizarPedido` resuelve
 * el nombre contra el catálogo Y aplica correcciones de negocio (cantidad
 * mínima, opciones repetidas) en la MISMA pasada — no hay forma de pedirle
 * "solo resuelve, no corrijas" sin reescribir una función ya calibrada en
 * producción. Separarlas aquí habría significado duplicar esa lógica para
 * fingir una frontera que el propio normalizador no tiene. `cambiar_cantidad`
 * y `quitar_item`, en cambio, sí separan limpio: Compuerta 2 encuentra la
 * línea (`buscarItemExistente`), Compuerta 3 decide si el cambio es válido.
 */
function resolverAgregarItem(
  operacion: Extract<Operacion, { tipo: "agregar_item" }>,
  contexto: ContextoOperaciones
): { ok: true; item: ItemDelPedido } | { ok: false; motivo: string; correccion: string } {
  const resultado = normalizarPedido(
    {
      items: [
        {
          ofrecible: operacion.ofrecible,
          cantidad: operacion.cantidad,
          opciones: operacion.opciones,
          gruposDeclinados: null,
        },
      ],
      datos: {},
    },
    contexto.catalogo,
    contexto.unidadesPorProducto,
    contexto.requisitos
  );
  if (resultado.dudas.length > 0) {
    const duda = resultado.dudas[0]!;
    return { ok: false, motivo: duda.porque, correccion: duda.preguntar };
  }
  const normalizado = resultado.estado.items[0]!;
  return {
    ok: true,
    item: {
      ofrecible: { id: normalizado.ofrecibleId, nombre: normalizado.ofrecible },
      cantidad: normalizado.cantidad,
      seleccion: normalizado.seleccion,
      gruposDeclinados: normalizado.gruposDeclinados,
      totalCents: normalizado.totalCents,
    },
  };
}

/**
 * `elegir_opcion`/`declinar_grupo`: reconstruye el ítem existente con la
 * opción nueva agregada a lo que ya tenía elegido, y lo vuelve a pasar por
 * `normalizarPedido` — mismo motivo que `resolverAgregarItem`: es la función
 * ya calibrada que sabe resolver un grupo/opción contra el catálogo real
 * (nombres de grupo con tolerancia, ambigüedad entre grupos con el mismo
 * nombre, opciones repetidas), y reimplementarla aparte sería duplicar una
 * lógica con incidentes reales ya corregidos detrás (`docs/korexia/156`,
 * caso MALIA de grupos "Topping" duplicados).
 */
function resolverModificacionDeOpciones(
  itemActual: ItemDelPedido,
  operacion:
    | Extract<Operacion, { tipo: "elegir_opcion" }>
    | Extract<Operacion, { tipo: "declinar_grupo" }>,
  contexto: ContextoOperaciones
): { ok: true; item: ItemDelPedido } | { ok: false; motivo: string; correccion: string } {
  const opcionesPrevias: OpcionPropuesta[] = itemActual.seleccion.map((s) => ({
    grupo: s.grupoNombre,
    opcion: s.nombre,
  }));
  const declinadosPrevios = (itemActual.gruposDeclinados ?? []).map((g) => g.grupoNombre);

  const propuesto =
    operacion.tipo === "elegir_opcion"
      ? {
          ofrecible: itemActual.ofrecible.nombre ?? "",
          cantidad: itemActual.cantidad,
          opciones: [...opcionesPrevias, { grupo: operacion.grupo, opcion: operacion.opcion }],
          gruposDeclinados: declinadosPrevios,
        }
      : {
          ofrecible: itemActual.ofrecible.nombre ?? "",
          cantidad: itemActual.cantidad,
          opciones: opcionesPrevias,
          gruposDeclinados: [...declinadosPrevios, operacion.grupo],
        };

  const resultado = normalizarPedido(
    { items: [propuesto], datos: {} },
    contexto.catalogo,
    contexto.unidadesPorProducto,
    contexto.requisitos
  );
  if (resultado.dudas.length > 0) {
    const duda = resultado.dudas[0]!;
    return { ok: false, motivo: duda.porque, correccion: duda.preguntar };
  }
  const normalizado = resultado.estado.items[0]!;
  return {
    ok: true,
    item: {
      ofrecible: { id: normalizado.ofrecibleId, nombre: normalizado.ofrecible },
      cantidad: normalizado.cantidad,
      seleccion: normalizado.seleccion,
      gruposDeclinados: normalizado.gruposDeclinados,
      totalCents: normalizado.totalCents,
    },
  };
}

/**
 * Aplica UNA operación sobre el estado actual, pasando sus tres compuertas
 * (`data-model.md` sección 3):
 *
 * 1. ¿Existe la operación y aplica a este vertical? (Zod ya cubre la forma).
 * 2. ¿Resuelven sus parámetros contra datos reales? (`ContextoOperaciones`).
 * 3. ¿El estado actual la permite?
 *
 * Atómica para ESTA operación: pasa las tres o no cambia nada. La atomicidad
 * del LOTE completo (si una operación de varias falla, ninguna se persiste)
 * es responsabilidad de `aplicarOperaciones`, que llama a esta función
 * repetidas veces — ver más abajo.
 *
 * **Nota de implementación (T004):** la mitad de la Compuerta 1 —"¿existe la
 * operación?"— ya no necesita un chequeo en runtime aquí. Zod la rechaza
 * antes de que esta función se llame (el parseo del lote, T012/T013), y la
 * otra mitad —"¿aplica a este vertical?"— la impone el propio TIPO: este
 * archivo declara su propio `Operacion` sin `fijar_servicio`/`fijar_horario`/
 * `fijar_especialista` (esos viven solo en `appointments/operaciones.ts`), así
 * que un negocio de pedidos no puede ni siquiera CONSTRUIR esa operación —no
 * hace falta rechazarla en runtime lo que el compilador ya hace imposible.
 * Lo que queda de la Compuerta 1, y es real: el `switch` de abajo cubre los 8
 * `tipo` uno por uno, con `default` exhaustivo comprobado por TypeScript — si
 * mañana se agrega un `tipo` nuevo a la unión sin manejarlo aquí, esto deja de
 * compilar en vez de fallar en silencio en producción.
 *
 * **`confirmar` (nota T006):** solo marca la intención sobre el ESTADO EN
 * MEMORIA —pone `confirmado: true`—; la AUTORIDAD real sobre si eso se
 * ejecuta de verdad sigue siendo de la Policy (`orders/policy.ts:93`,
 * `puedeConfirmarPedido`, T017), que corre DESPUÉS de guardado el lote. Es
 * deliberado (`data-model.md` sección 4: "`confirmar` no es una operación
 * como las demás"). **No hay `cancelar` aquí** — ver el comentario junto a la
 * unión `Operacion`, arriba: cancelar el pedido entero ya es determinístico
 * y anterior al modelo (`matchesReinicio`/`borrarEstado`), y no se toca.
 */
export function aplicarOperacion(
  estadoActual: EstadoDelPedido,
  operacion: Operacion,
  contexto: ContextoOperaciones
): ResultadoDeOperacion {
  switch (operacion.tipo) {
    case "agregar_item": {
      // Compuerta 2 + 3 combinadas (ver el comentario de `resolverAgregarItem`).
      const r = resolverAgregarItem(operacion, contexto);
      if (!r.ok) return r;
      return {
        ok: true,
        estado: { ...estadoActual, items: [...copiarItems(estadoActual.items), r.item] },
      };
    }

    case "cambiar_cantidad": {
      // Compuerta 2: encontrar la línea.
      const busqueda = buscarItemExistente(estadoActual.items, operacion.ofrecible, operacion.opciones);
      if (busqueda.status === "not_found") {
        return {
          ok: false,
          motivo: `"${operacion.ofrecible}" no está en el pedido actual`,
          correccion: `[SISTEMA] No hay ningún "${operacion.ofrecible}" en el pedido todavía. Si quieres agregarlo, usa agregar_item.`,
        };
      }
      if (busqueda.status === "multiple_matches") {
        return {
          ok: false,
          motivo: `"${operacion.ofrecible}" aparece más de una vez en el pedido, sin suficiente detalle para saber cuál`,
          correccion: `[SISTEMA] Hay más de un "${operacion.ofrecible}" en el pedido, con opciones distintas. Pregunta al cliente cuál de los dos, o con qué opciones, antes de cambiar la cantidad.`,
        };
      }
      // Compuerta 3: la cantidad propuesta es válida.
      if (!Number.isInteger(operacion.cantidad) || operacion.cantidad < 1) {
        return {
          ok: false,
          motivo: `cantidad inválida: ${operacion.cantidad}`,
          correccion: "[SISTEMA] La cantidad debe ser un número entero de 1 o más.",
        };
      }
      const items = copiarItems(estadoActual.items);
      const item = items[busqueda.indice]!;
      item.cantidad = operacion.cantidad;
      // El total de la línea se recalcula desde el precio unitario ya resuelto
      // (nunca un número que proponga el modelo): `totalCents` de un ítem con
      // cantidad N es su precio base + el de sus opciones, multiplicado por N.
      // Se deriva del total anterior entre la cantidad anterior para no volver
      // a sumar precios de opciones aquí (ya están resueltos en `seleccion`).
      const cantidadAnterior = estadoActual.items[busqueda.indice]!.cantidad;
      const totalAnterior = estadoActual.items[busqueda.indice]!.totalCents;
      item.totalCents =
        totalAnterior !== null && cantidadAnterior > 0
          ? Math.round((totalAnterior / cantidadAnterior) * operacion.cantidad)
          : null;
      return { ok: true, estado: { ...estadoActual, items } };
    }

    case "quitar_item": {
      // Compuerta 2: encontrar la línea. Compuerta 3: siempre permitido si se
      // encontró — quitar algo del carrito no tiene una regla de negocio que
      // pueda rechazarlo.
      const busqueda = buscarItemExistente(estadoActual.items, operacion.ofrecible, operacion.opciones);
      if (busqueda.status === "not_found") {
        return {
          ok: false,
          motivo: `"${operacion.ofrecible}" no está en el pedido actual`,
          correccion: `[SISTEMA] No hay ningún "${operacion.ofrecible}" en el pedido — no hay nada que quitar.`,
        };
      }
      if (busqueda.status === "multiple_matches") {
        return {
          ok: false,
          motivo: `"${operacion.ofrecible}" aparece más de una vez en el pedido, sin suficiente detalle para saber cuál`,
          correccion: `[SISTEMA] Hay más de un "${operacion.ofrecible}" en el pedido. Pregunta al cliente cuál de los dos quitar.`,
        };
      }
      const items = copiarItems(estadoActual.items);
      items.splice(busqueda.indice, 1);
      return { ok: true, estado: { ...estadoActual, items } };
    }

    case "elegir_opcion":
    case "declinar_grupo": {
      const busqueda = buscarItemExistente(estadoActual.items, operacion.ofrecible, operacion.opciones);
      if (busqueda.status === "not_found") {
        return {
          ok: false,
          motivo: `"${operacion.ofrecible}" no está en el pedido actual`,
          correccion: `[SISTEMA] No hay ningún "${operacion.ofrecible}" en el pedido todavía.`,
        };
      }
      if (busqueda.status === "multiple_matches") {
        return {
          ok: false,
          motivo: `"${operacion.ofrecible}" aparece más de una vez en el pedido, sin suficiente detalle para saber cuál`,
          correccion: `[SISTEMA] Hay más de un "${operacion.ofrecible}" en el pedido. Pregunta al cliente cuál de los dos.`,
        };
      }
      // Compuerta 2 + 3 combinadas (ver `resolverModificacionDeOpciones`).
      const r = resolverModificacionDeOpciones(
        estadoActual.items[busqueda.indice]!,
        operacion,
        contexto
      );
      if (!r.ok) return r;
      const items = copiarItems(estadoActual.items);
      items[busqueda.indice] = r.item;
      return { ok: true, estado: { ...estadoActual, items } };
    }

    case "fijar_dato": {
      // Compuerta 2: el requisito existe en la ficha de este negocio.
      const requisito = contexto.requisitos.find((r) => r.id === operacion.requisitoId);
      if (!requisito) {
        return {
          ok: false,
          motivo: `"${operacion.requisitoId}" no es un requisito declarado por este negocio`,
          correccion: "[SISTEMA] Ese dato no está entre lo que este negocio pide para cerrar.",
        };
      }
      // Compuerta 3: sin reglas adicionales — cualquier texto no vacío vale
      // (es prosa que lee una persona, ver `estructura-vs-prosa`).
      if (!operacion.valor.trim()) {
        return {
          ok: false,
          motivo: "valor vacío",
          correccion: `[SISTEMA] Todavía falta ${requisito.etiqueta}.`,
        };
      }
      return {
        ok: true,
        estado: { ...estadoActual, datos: { ...estadoActual.datos, [operacion.requisitoId]: operacion.valor } },
      };
    }

    case "fijar_modalidad": {
      // Compuerta 2 + 3: la modalidad debe ser una de las que este negocio
      // ofrece — mismo criterio que `normalizarModalidad` ya aplica hoy.
      const ofrecida = contexto.modalidadesOfrecidas.find(
        (m) => normalizarNombre(m) === normalizarNombre(operacion.modalidad)
      );
      if (!ofrecida) {
        return {
          ok: false,
          motivo: `"${operacion.modalidad}" no es una modalidad que ofrezca este negocio`,
          correccion: `[SISTEMA] Este negocio solo ofrece: ${contexto.modalidadesOfrecidas.join(", ")}.`,
        };
      }
      return { ok: true, estado: { ...estadoActual, modalidadDeEntrega: ofrecida } };
    }

    case "confirmar":
      return { ok: true, estado: { ...estadoActual, confirmado: true } };

    default: {
      // Exhaustividad: si TypeScript se queja aquí de que `operacion` no es
      // `never`, falta manejar un `tipo` nuevo arriba — es la señal a
      // propósito, no un caso a silenciar.
      const _exhaustivo: never = operacion;
      return {
        ok: false,
        motivo: `operación desconocida: ${JSON.stringify(_exhaustivo)}`,
        correccion: "Esa operación no existe. Usa una de las permitidas.",
      };
    }
  }
}

/** El veredicto de aplicar un LOTE completo — `data-model.md` sección 2. */
export type ResultadoDelLote =
  | { persistido: true; estadoFinal: EstadoDelPedido }
  | {
      persistido: false;
      rechazo: Extract<ResultadoDeOperacion, { ok: false }>;
      /** Índice, dentro del lote, de la operación que hizo fallar todo. */
      operacionFallida: number;
    };

/**
 * Aplica una lista de operaciones **en orden**, sobre una copia en memoria a
 * partir del estado guardado — nunca escribe nada. Traducción directa del
 * pseudocódigo de `data-model.md` sección 2 (corregida 15-sep-2026: lote
 * atómico, no persistencia parcial). Gemelo síncrono de
 * `appointments/operaciones.ts` (esa es `async` porque `aplicarOperacion` de
 * citas consulta `disponibilidadRealMultiple`; aquí `aplicarOperacion` no
 * toca la base, así que esta función tampoco).
 *
 * Si CUALQUIER operación falla, se descarta TODO lo calculado en memoria —ni
 * siquiera las que pasaron antes que ella cuentan— y se devuelve
 * `persistido: false` con el rechazo exacto y en qué posición del lote
 * ocurrió. Si las `operaciones.length` pasan, se devuelve `persistido: true`
 * con el estado final.
 *
 * **No llama a `guardarEstado`.** Esta función es pura: quien la invoque
 * (T012/T013, `pipeline.ts`) decide cuándo y cómo persistir `estadoFinal`.
 */
export function aplicarOperaciones(
  estadoGuardado: EstadoDelPedido,
  operaciones: Operacion[],
  contexto: ContextoOperaciones
): ResultadoDelLote {
  let estado = estadoGuardado;
  for (let i = 0; i < operaciones.length; i++) {
    const resultado = aplicarOperacion(estado, operaciones[i]!, contexto);
    if (!resultado.ok) {
      return { persistido: false, rechazo: resultado, operacionFallida: i };
    }
    estado = resultado.estado;
  }
  return { persistido: true, estadoFinal: estado };
}
