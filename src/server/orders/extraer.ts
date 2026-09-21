/**
 * El extractor: de lo que dijo el cliente al estado estructurado — Fase 2.
 *
 * No llama al modelo. **Recibe** lo que el modelo propuso —en la misma llamada
 * que la respuesta, que es la estrategia que ganó la medición: más barata, más
 * rápida y acierta donde la llamada aparte falla— y su trabajo es contestar tres
 * preguntas comparando esa propuesta con el estado guardado:
 *
 *   ¿qué información NUEVA aportó el cliente?
 *   ¿qué campos CAMBIAN?
 *   ¿qué información PERMANECE igual?
 *
 * Esas tres respuestas son lo que permite decir *"ya me diste el teléfono, no te
 * lo vuelvo a pedir"* sin que el prompt tenga que suplicarlo.
 */
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import type { Requisito } from "@/server/ai/generador/ficha";
import type { Vertical } from "@/server/vertical";
import { enPesos, faltaParaElMinimoDeDomicilio } from "./minimo-de-domicilio";
import type { EstadoDelPedido } from "./estado";

export type Aporte = {
  campo: string;
  /** `null` cuando el campo estaba vacío: es información NUEVA. */
  antes: unknown;
  ahora: unknown;
};

export type Lectura = {
  /** Campos que pasan de vacío a tener valor. */
  nuevo: Aporte[];
  /** Campos que ya tenían valor y ahora tienen otro (cambio de opinión). */
  cambia: Aporte[];
  /** Campos que no se tocan. */
  permanece: string[];
};

function vacio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Los campos del estado que el cliente puede aportar, en orden del flujo. */
const CAMPOS: { campo: string; leer: (e: EstadoDelPedido) => unknown }[] = [
  { campo: "producto", leer: (e) => e.items.map((i) => i.ofrecible.nombre) },
  { campo: "cantidad", leer: (e) => e.items.map((i) => i.cantidad) },
  // Lo elegido va como una sola entrada: los grupos los pone el negocio, no
  // este archivo. Antes había una línea por grupo de La Churra. Y desde la v4
  // se dice de qué ítem es cada una, o pedir dos veces lo mismo parecería un
  // cambio de opinión.
  {
    campo: "opciones",
    leer: (e) =>
      e.items.flatMap((i, n) => i.seleccion.map((s) => `${n}·${s.grupoNombre}:${s.nombre}`)),
  },
  // Los datos de cierre NO están aquí: los declara cada negocio y entran por
  // `requisitos`. Poner una lista fija sería devolver al núcleo lo que el CRM
  // acaba de recuperar.
  { campo: "datos", leer: (e) => e.datos },
  { campo: "confirmado", leer: (e) => e.confirmado },
];

/**
 * @param antes El estado guardado. `null` si la conversación empieza.
 * @param propuesto El estado que el backend ya validó a partir de la propuesta.
 */
export function leerAporte(
  antes: EstadoDelPedido | null,
  propuesto: EstadoDelPedido
): Lectura {
  const nuevo: Aporte[] = [];
  const cambia: Aporte[] = [];
  const permanece: string[] = [];

  for (const { campo, leer } of CAMPOS) {
    const a = antes ? leer(antes) : null;
    const b = leer(propuesto);

    const iguales = JSON.stringify(a) === JSON.stringify(b);
    if (iguales) {
      if (!vacio(b)) permanece.push(campo);
      continue;
    }
    // `cantidad` empieza en 1 por defecto: pasar de 1 a 2 es un cambio, no un
    // aporte nuevo. Sin esta salvedad, todo pedido "aportaría" la cantidad.
    if (vacio(a) && campo !== "cantidad") nuevo.push({ campo, antes: a, ahora: b });
    else cambia.push({ campo, antes: a, ahora: b });
  }

  return { nuevo, cambia, permanece };
}

/**
 * Lo que falta para poder despachar, en el orden del flujo del negocio.
 *
 * Es lo que el backend le inyecta al prompt en vez de las tres súplicas que hoy
 * lleva escritas ("no vuelvas a preguntar lo que ya te dijeron"): el modelo deja
 * de tener que acordarse, porque se lo recuerda el servidor.
 */
export function loQueFalta(
  estado: EstadoDelPedido,
  /**
   * El catálogo del negocio, con sus grupos. Desde la v4 es **la carta entera**
   * y no un producto: un pedido puede llevar varios, y cada uno tiene los suyos.
   */
  catalogo: ProductoDelCatalogo[] = [],
  /** Lo que este negocio pide para cerrar, en su orden. */
  requisitos: Requisito[] = [],
  /** Vocabulario: "presentación" en pedidos, "servicio" en citas. */
  vertical: Vertical = "pedidos"
): string[] {
  const falta: string[] = [];
  const variosItems = estado.items.length > 1;
  const loQueFaltaElegir = vertical === "citas" ? "servicio" : "presentación";

  if (estado.items.length === 0) falta.push(loQueFaltaElegir);
  for (const item of estado.items) {
    if (!item.ofrecible.id) {
      falta.push(loQueFaltaElegir);
      continue;
    }
    /*
     * Los grupos obligatorios salen del catálogo del negocio — ni un nombre
     * escrito aquí. Sirve igual para *salsas*, *tamaño* o *diseño de uñas*.
     */
    const ofrecible = catalogo.find((p) => p.id === item.ofrecible.id);
    for (const g of ofrecible?.grupos ?? []) {
      if (g.opciones.length === 0 || g.minimo < 1) continue;
      const elegidas = item.seleccion.filter((s) => s.grupoId === g.id).length;
      if (elegidas < g.minimo) {
        // Con varios ítems se dice de cuál: "salsas" dos veces seguidas no le
        // dice a nadie qué preguntar.
        const nombre = g.nombre.toLowerCase();
        falta.push(variosItems ? `${nombre} de ${item.ofrecible.nombre}` : nombre);
      }
    }
  }
  // En el orden en que el negocio los declaró: ese orden ES la configuración.
  // Y son del PEDIDO: el nombre se pide una vez, lleve una cosa o cinco.
  for (const r of requisitos) {
    if (r.obligatorio && !estado.datos[r.id]?.trim()) falta.push(r.etiqueta);
  }
  return falta;
}

/**
 * Los requisitos que el PROMPT debe seguir pidiendo — los que TODAVÍA no
 * están en `estado.datos`, no la lista completa de lo que el negocio
 * declaró.
 *
 * Bug real, auditoría de citas (Lashes Valen, 31-ago-2026), reproducido de
 * forma determinista en 5 guiones distintos: el prompt volvía a listar
 * "nombre" turno tras turno aunque `estado.datos.nombre` ya tuviera un
 * valor, con una instrucción que decía "si el cliente ya te dio esto, EN
 * ESTE MENSAJE O ANTES EN LA CONVERSACIÓN, emítelo" — una condición que,
 * una vez cierta, sigue siendo cierta para siempre. El modelo la seguía al
 * pie de la letra: repetía `provide_requirement` con el mismo valor en
 * cada turno, sin nunca avanzar a `consult_availability`/`book_appointment`
 * (o `notify_order` en pedidos).
 *
 * Mismo criterio que ya usa `loQueFalta` para decidir "esto falta"
 * (`!estado.datos[r.id]?.trim()`) — no un criterio nuevo.
 *
 * `estado: null` (negocios sin Fase 2, o el turno que crea el primer
 * estado) devuelve `requisitos` tal cual: sin nada guardado, todo sigue
 * pendiente — mismo comportamiento de siempre.
 */
export function requisitosPendientesDe(
  estado: EstadoDelPedido | null,
  requisitos: Requisito[] | undefined
): Requisito[] | undefined {
  if (!estado) return requisitos;
  return requisitos?.filter((r) => !estado.datos[r.id]?.trim());
}

/**
 * El bloque que se le da al modelo en cada turno.
 *
 * Corto a propósito: sustituye instrucciones, no las añade. Si esto crece, el
 * prompt vuelve a engordar y la Fase 2 habrá servido para nada.
 */
export function comoTexto(
  estado: EstadoDelPedido,
  catalogo: ProductoDelCatalogo[] = [],
  requisitos: Requisito[] = [],
  /** Vocabulario: "PEDIDO EN CURSO" en pedidos, "CITA EN CURSO" en citas. */
  vertical: Vertical = "pedidos",
  /**
   * Pedido mínimo para domicilio de ESTE negocio, en centavos
   * (`ficha.entrega.minimoDomicilioCents`). Ausente en casi todos.
   *
   * Se le dice al modelo aquí, y no solo en el cierre, por la misma razón que
   * la tarifa de entrega: el guardarraíl de `puedeConfirmarPedido` ya impide
   * cerrar por debajo del mínimo, pero enterarse SOLO al confirmar significa
   * que el cliente ya eligió sabores y toppings para nada. Avisar a tiempo es
   * la diferencia entre "añade algo más" y un pedido que se cae al final.
   */
  minimoDomicilioCents?: number
): string {
  const conAlgo = estado.items.filter((i) => i.ofrecible.id || i.seleccion.length > 0);
  if (conAlgo.length === 0) return "";

  const partes: string[] = [];
  /*
   * Una línea por ítem, con SUS opciones debajo del suyo.
   *
   * Hasta la v3 todo iba en una lista plana, y con dos productos el modelo veía
   * `salsas: arequipe, chocolate, chocolate` sin saber de quién era cada una —
   * que es exactamente lo que le hacía preguntar dos veces.
   */
  for (const item of conAlgo) {
    const cabecera = item.ofrecible.nombre
      ? `${item.cantidad} × ${item.ofrecible.nombre}`
      : "(sin elegir todavía)";
    // Una línea por grupo, con el nombre que le puso el negocio.
    const porGrupo = new Map<string, string[]>();
    for (const s of item.seleccion) {
      const clave = s.grupoNombre || "opciones";
      porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), s.nombre]);
    }
    const opciones = [...porGrupo]
      .map(([grupo, nombres]) => `${grupo.toLowerCase()}: ${nombres.join(", ")}`)
      .join(" · ");
    /*
     * Lo que el cliente rechazó explícitamente ("sin toppings") va aparte de
     * lo elegido — no es una opción, es la ausencia deliberada de una. Sin
     * esta línea, un grupo opcional sin nada en `seleccion` se ve IGUAL que
     * uno al que nunca se le preguntó, y el agente lo volvía a ofrecer.
     */
    const declinados = (item.gruposDeclinados ?? [])
      .map((g) => g.grupoNombre.toLowerCase())
      .join(", ");
    const detalle = [opciones, declinados ? `sin ${declinados}` : ""]
      .filter(Boolean)
      .join(" · ");
    partes.push(detalle ? `${cabecera} (${detalle})` : cabecera);
  }
  /*
   * Lo ya recogido, con la etiqueta del negocio. Un dato personal no se repite
   * en el prompt —solo se dice que ya está—; el resto sí, porque el modelo
   * necesita poder resumirlo.
   */
  for (const r of requisitos) {
    const valor = estado.datos[r.id];
    if (!valor?.trim()) continue;
    const personal = r.tipo !== "texto";
    /*
     * "ya está" y no "ya la dio": la etiqueta la escribe cada negocio y puede
     * ser masculina, femenina o plural. Un texto con género dentro se rompe con
     * la primera etiqueta que no lo comparta — "el celular de contacto: ya la
     * dio".
     */
    partes.push(personal ? `${r.etiqueta}: ya está` : `${r.etiqueta}: ${valor}`);
  }

  /*
   * La reserva (fecha/hora/especialista), si ya se sabe algo de ella. Sin
   * esto, se le pedía al modelo que la reportara pero nunca se le devolvía
   * en el recordatorio del turno siguiente — el mismo "no vuelvas a
   * preguntar" que ya vale para items/datos no aplicaba a cuándo y con quién.
   */
  const r = estado.reserva;
  if (r?.fecha || r?.hora || r?.recursoNombre) {
    const cuando = [r.fecha, r.hora].filter(Boolean).join(" ");
    const conQuien = r.recursoNombre ? ` con ${r.recursoNombre}` : "";
    partes.push(cuando ? `reserva: ${cuando}${conQuien}` : `reserva:${conQuien}`.trim());
  }

  const falta = loQueFalta(estado, catalogo, requisitos, vertical);
  /*
   * Cómo se entrega este pedido, tal como lo verificó el backend.
   *
   * Hasta el 10-sep-2026 este bloque no decía NADA de la entrega: ni la
   * modalidad, ni la zona, ni la tarifa. El backend sí lo sabía —lo guarda en
   * `estado.entrega` y los guardarraíles del cierre validan contra él—, pero
   * ese dato viajaba por una tubería que solo persistía y validaba, nunca por
   * la que informa al modelo. El modelo tenía que acordarse del historial.
   *
   * Mientras la conversación es lineal se acuerda. Cuando el cliente
   * interrumpe —"déjame el pedido así tal cual", "se equivocó de nombre",
   * "cuánto es en total?"— rehace el resumen y ahí se le cae: tres pedidos
   * perdidos en dos días (MALIA, 9 y 10-sep-2026), los tres cerrando sin
   * cobrar un domicilio que estaba verificado. Se le exigía un dato que no se
   * le daba.
   *
   * Solo REPRESENTA lo que ya existe: no hay campo nuevo, ni fuente de verdad
   * nueva, ni estado que mantener. Con `entrega` ausente —los cuatro negocios
   * en `delivery_source='prompt'` y todo el vertical de citas— no se imprime
   * nada y el bloque sale idéntico a como salía.
   */
  const entrega = (() => {
    const e = estado.entrega;
    if (!e) return "";
    if (e.tipo === "recogida") return "\nENTREGA: recoge en el local, sin domicilio.";
    /*
     * `feeCents === null` es "pendiente"; `0` es una tarifa REAL de una zona
     * gratis (ver `EntregaVerificada` en `estado.ts`). Un `if (!e.feeCents)`
     * los confundiría y anunciaría como pendiente un domicilio ya resuelto.
     */
    if (e.feeCents === null) {
      return (
        "\nENTREGA: domicilio, tarifa PENDIENTE de verificar" +
        " — no la inventes ni uses una anterior."
      );
    }
    const cuanto = `$${(e.feeCents / 100).toLocaleString("es-CO")}`;
    const donde = e.zonaNombre ? ` a ${e.zonaNombre}` : "";
    return `\nENTREGA: domicilio${donde} — tarifa ${cuanto} (la verificó el sistema, úsala tal cual).`;
  })();
  const total =
    estado.totalCents === null
      ? ""
      : `\nTOTAL (lo calculó el sistema, úsalo tal cual): $${(estado.totalCents / 100).toLocaleString("es-CO")}`;
  const encabezado = vertical === "citas" ? "CITA EN CURSO" : "PEDIDO EN CURSO";

  /*
   * El pedido mínimo para domicilio, cuando este pedido no llega. Va como
   * una línea propia y no dentro de `TE FALTA` porque no es un dato que el
   * cliente tenga que DAR: es una condición del pedido, y la salida no es
   * preguntarle algo sino ofrecerle dos caminos.
   */
  const minimo = faltaParaElMinimoDeDomicilio({
    minimoCents: minimoDomicilioCents,
    modalidadDeEntrega: estado.modalidadDeEntrega,
    subtotalCents: estado.totalCents,
  });
  const avisoDelMinimo = minimo
    ? `\nMÍNIMO DE DOMICILIO: este pedido lleva ${enPesos(minimo.subtotalCents)} y el mínimo ` +
      `es ${enPesos(minimo.minimoCents)} — faltan ${enPesos(minimo.faltanCents)}. NO se puede ` +
      `despachar así: díselo y ofrécele añadir algo más o pasar a recoger.`
    : "";

  return (
    `${encabezado} — no vuelvas a preguntar nada de esto:\n${partes.join(" · ")}` +
    entrega +
    total +
    avisoDelMinimo +
    (falta.length ? `\nTE FALTA, en este orden: ${falta.join(", ")}` : "\nNo falta nada: ve al resumen.")
  );
}
