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
/**
 * ¿Está satisfecho este requisito con lo que hay en el estado?
 *
 * Para todos, tener el valor basta. Pero para el NOMBRE, en el flujo con estado
 * en el backend, no: exige `procedenciaDelNombre === "cliente"` (Bloqueador 2,
 * última auditoría). Un valor sin procedencia —un estado heredado, o uno que se
 * coló por otra ruta— NO cuenta como confirmado.
 *
 * `exigirProcedenciaDeNombre` viene apagado por defecto: en el prompt y en
 * citas no existe la procedencia, y encenderla ahí dejaría el nombre imposible
 * de satisfacer. Solo el flujo de pedidos con estado en el backend la pide.
 */
export function requisitoSatisfecho(
  estado: EstadoDelPedido,
  r: Requisito,
  exigirProcedenciaDeNombre = false
): boolean {
  if (!estado.datos[r.id]?.trim()) return false;
  if (exigirProcedenciaDeNombre && r.id === "nombre") {
    return estado.procedenciaDelNombre === "cliente";
  }
  return true;
}

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
  vertical: Vertical = "pedidos",
  /** Exigir procedencia del cliente para dar el nombre por satisfecho. */
  exigirProcedenciaDeNombre = false
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
    if (r.obligatorio && !requisitoSatisfecho(estado, r, exigirProcedenciaDeNombre)) {
      falta.push(r.etiqueta);
    }
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
  requisitos: Requisito[] | undefined,
  /** Exigir procedencia del cliente para dar el nombre por satisfecho (Bloqueador 2). */
  exigirProcedenciaDeNombre = false
): Requisito[] | undefined {
  if (!estado) return requisitos;
  return requisitos?.filter((r) => !requisitoSatisfecho(estado, r, exigirProcedenciaDeNombre));
}

/**
 * ¿La hoja del pedido está lista para MOSTRAR el resumen? — la mitad de backend
 * del Bug 5 (24-sep-2026).
 *
 * Lo decide el ESTADO, nunca el texto del modelo (Principio 7): ítems
 * resueltos, subtotal calculado, requisitos obligatorios completos, y un total
 * CALCULABLE incluyendo el domicilio. Si el pedido es a domicilio y la tarifa
 * aún no está verificada, la hoja NO está lista — primero se verifica el
 * domicilio (no se fuerza un resumen sin él). Recibe primitivos ya calculados
 * por el pipeline para no reimplementar `requisitosPendientesDe` ni el total.
 */
export function hojaListaParaResumen(input: {
  /** Cuántos ítems resueltos lleva el pedido. */
  itemsResueltos: number;
  /** El subtotal que el backend calculó contra el catálogo (`estado.totalCents`). */
  totalCents: number | null | undefined;
  /** Cuántos requisitos obligatorios faltan (de `requisitosPendientesDe`). */
  requisitosPendientes: number;
  /** La entrega ya verificada y persistida, si la hay. */
  entrega?: { tipo: "domicilio" | "recogida"; feeCents: number | null } | null;
  /** La modalidad que eligió el cliente, cuando no hay `entrega` verificada. */
  modalidadDeEntrega?: string | null;
}): boolean {
  if (input.itemsResueltos <= 0) return false;
  if (typeof input.totalCents !== "number" || !Number.isFinite(input.totalCents)) return false;
  if (input.requisitosPendientes > 0) return false;

  // El total tiene que ser completo: un domicilio sin tarifa verificada aún no
  // tiene total, así que la hoja no está lista para el resumen.
  const entrega = input.entrega;
  if (entrega?.tipo === "domicilio") return typeof entrega.feeCents === "number";
  if (entrega?.tipo === "recogida") return true;

  // Sin entrega verificada, solo la recogida da un total seguro (= subtotal).
  // Un domicilio sin verificar, o una modalidad desconocida, no está listo.
  const modalidad = (input.modalidadDeEntrega ?? "").toLowerCase();
  return /recog/.test(modalidad);
}

/**
 * La dirección de entrega que dio el cliente: el valor del requisito de TIPO
 * `direccion` del negocio, se llame como se llame su id (cada negocio pone el
 * suyo desde el CRM).
 */
export function direccionDelPedido(
  estado: { datos: Record<string, string | undefined | null> } | null | undefined,
  requisitos: Requisito[] | undefined
): string | null {
  if (!estado) return null;
  for (const r of requisitos ?? []) {
    if (r.tipo !== "direccion") continue;
    const v = estado.datos[r.id]?.trim();
    if (v) return v;
  }
  return null;
}

/** Misma dirección salvo mayúsculas y espacios. */
export function mismaDireccion(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) !== "" && n(a) === n(b);
}

/**
 * ¿El backend debe verificar YA la tarifa del domicilio? (25-sep-2026)
 *
 * Caso real (MALIA, Maye Díaz): pedido a domicilio con dirección, la clienta
 * nunca preguntó cuánto costaba el envío, y el resumen salió con el total de
 * los productos solos. La verificación dependía de que el MODELO decidiera
 * consultarla. Con tabla de zonas, la tarifa es un dato del backend: la busca
 * él en cuanto tiene la dirección, pregunte el cliente o no.
 *
 * Solo en negocios con tabla (`delivery_source='tabla'`): donde el domicilio
 * se cotiza aparte (por app), no hay nada que buscar. Se decide por
 * configuración, nunca por el nombre del negocio.
 */
export function debeVerificarDomicilio(input: {
  tieneTablaDeZonas: boolean;
  modalidadDeEntrega: string | null | undefined;
  direccion: string | null | undefined;
  entrega:
    | { tipo: "domicilio" | "recogida"; feeCents: number | null; direccion?: string | null; barrioPedido?: boolean }
    | null
    | undefined;
}): boolean {
  if (!input.tieneTablaDeZonas) return false;
  if (!esModalidadADomicilio(input.modalidadDeEntrega)) return false;
  if (!input.direccion?.trim()) return false;
  const e = input.entrega;
  // El cliente dijo explícitamente que recoge: no se le busca (ni cobra) domicilio.
  if (e?.tipo === "recogida") return false;
  if (e?.tipo === "domicilio" && mismaDireccion(e.direccion, input.direccion)) {
    // Ya resuelta para esta dirección, o ya se le pidió el barrio por ella: no
    // se repite la misma búsqueda (daría lo mismo). Lo siguiente lo trae el
    // cliente con su barrio, o lo resuelve el cierre.
    return false;
  }
  return true;
}

/** Mismo criterio que el guardarraíl de cierre (`esPedidoADomicilio`). */
export function esModalidadADomicilio(modalidad: string | null | undefined): boolean {
  return /domicilio|env[íi]o|entrega a/i.test(modalidad ?? "");
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
  minimoDomicilioCents?: number,
  /** Exigir procedencia del cliente para dar el nombre por satisfecho (Bloqueador 2). */
  exigirProcedenciaDeNombre = false
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
    // "Ya recogido" tiene que decir lo mismo que "TE FALTA": un nombre heredado
    // sin procedencia NO está confirmado, así que no se anuncia como "ya está"
    // (si no, el modelo veía el nombre en las dos listas a la vez).
    if (!requisitoSatisfecho(estado, r, exigirProcedenciaDeNombre)) continue;
    const personal = r.tipo !== "texto";
    /*
     * "ya está" y no "ya la dio": la etiqueta la escribe cada negocio y puede
     * ser masculina, femenina o plural. Un texto con género dentro se rompe con
     * la primera etiqueta que no lo comparta — "el celular de contacto: ya la
     * dio".
     */
    /*
     * La etiqueta la escribe una persona en el CRM y puede quedarse a
     * medias: la ficha de Lis tenía el requisito `direccion` sin etiqueta ni
     * tipo, y este bloque le mandaba al modelo `undefined: ya está` (caso
     * real, 23-sep-2026, conv cv_oyhwvt9l5vn4hm020mtb). Se cae al `id` en vez
     * de omitir la línea: el propósito del bloque es "no vuelvas a preguntar
     * nada de esto", y saltárselo devolvería justo la repregunta que evita.
     *
     * El dato mal configurado se corrige aparte; esta guarda existe porque el
     * núcleo no puede fiarse de que una ficha esté completa.
     */
    const etiqueta = r.etiqueta?.trim() || r.id;
    partes.push(personal ? `${etiqueta}: ya está` : `${etiqueta}: ${valor}`);
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

  const falta = loQueFalta(estado, catalogo, requisitos, vertical, exigirProcedenciaDeNombre);
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
  /*
   * La MODALIDAD que eligió el cliente — distinta de la ENTREGA verificada.
   *
   * 23-sep-2026, Lis. El cliente dijo "Domicilio", el backend lo guardó en
   * `modalidadDeEntrega`, y veinticuatro segundos después el agente volvió a
   * preguntarle cómo lo recibía. No fue una carrera de turnos: es que este
   * bloque solo miraba `estado.entrega`, que es la zona y la tarifa ya
   * VERIFICADAS. Con `delivery_source='prompt'` eso es siempre `null`, así que la
   * modalidad elegida no llegaba nunca al modelo. Afecta a 3 de los 4
   * negocios vivos.
   *
   * 🛑 La salida NO es rellenar `estado.entrega` con la modalidad. Son dos
   * hechos con dos autoridades: uno lo dijo el cliente, el otro lo comprobó
   * el sistema. Fundirlos haría que el agente anunciara como verificada una
   * tarifa que nadie verificó — exactamente el fallo que los guardarraíles
   * del cierre existen para impedir.
   */
  /*
   * Lo que el cliente adelantó y no es ni ítem ni requisito.
   *
   * Va como CONTEXTO y nunca como dato pendiente: no entra en `TE FALTA` ni
   * bloquea el cierre. Solo se imprime cuando es `true` — decir "no es un
   * regalo" en cada turno sería ruido en un bloque que el modelo lee entero
   * cada vez.
   */
  const contexto = estado.paraRegalo
    ? "\nCONTEXTO DEL PEDIDO: es para regalo (ya lo dijo el cliente)."
    : "";

  const modalidad = (() => {
    const m = estado.modalidadDeEntrega?.trim();
    if (!m) return "";
    // Solo se avisa de la tarifa cuando de verdad falta: con la entrega ya
    // verificada, la línea de abajo trae la cifra real.
    const sinTarifa =
      m === "domicilio" && !estado.entrega
        ? " Todavía no hay tarifa verificada: no la inventes."
        : "";
    return `\nMODALIDAD DE ENTREGA: ${m} — ya la eligió, no se la vuelvas a preguntar.${sinTarifa}`;
  })();
  const entrega = (() => {
    const e = estado.entrega;
    if (!e) return "";
    if (e.tipo === "recogida") return "\nENTREGA VERIFICADA: recoge en el local, sin domicilio.";
    /*
     * `feeCents === null` es "pendiente"; `0` es una tarifa REAL de una zona
     * gratis (ver `EntregaVerificada` en `estado.ts`). Un `if (!e.feeCents)`
     * los confundiría y anunciaría como pendiente un domicilio ya resuelto.
     */
    if (e.feeCents === null) {
      return (
        "\nENTREGA VERIFICADA: domicilio, tarifa PENDIENTE de verificar" +
        " — no la inventes ni uses una anterior."
      );
    }
    const cuanto = `$${(e.feeCents / 100).toLocaleString("es-CO")}`;
    const donde = e.zonaNombre ? ` a ${e.zonaNombre}` : "";
    return `\nENTREGA VERIFICADA: domicilio${donde} — tarifa ${cuanto} (la verificó el sistema, úsala tal cual).`;
  })();
  /*
   * El total que se le da al modelo, calculado COMPLETO por el backend.
   *
   * Hasta el 25-sep-2026 esto decía "TOTAL (…úsalo tal cual)" con el subtotal
   * de productos aun con el domicilio verificado, y el modelo obedecía: fue el
   * "Total: $20.000" de Maye Díaz (MALIA). Solo cambia cuando hay una entrega
   * de DOMICILIO guardada, que solo escriben los negocios con tabla de zonas;
   * sin ella (Lis, La Churra, citas) sale igual que siempre.
   */
  const entregaADomicilio = estado.entrega?.tipo === "domicilio" ? estado.entrega : null;
  const total =
    estado.totalCents === null
      ? ""
      : entregaADomicilio && typeof entregaADomicilio.feeCents === "number"
        ? `\nPRODUCTOS ${enPesos(estado.totalCents)} + DOMICILIO ${enPesos(entregaADomicilio.feeCents)} = TOTAL ${enPesos(
            estado.totalCents + entregaADomicilio.feeCents
          )} (lo calculó el sistema, úsalo tal cual; el resumen muestra las tres líneas).`
        : entregaADomicilio
          ? `\nPRODUCTOS (lo calculó el sistema): ${enPesos(estado.totalCents)} — el domicilio aún no tiene valor: esto NO es el total, no lo presentes como total ni cierres el pedido.`
          : `\nTOTAL (lo calculó el sistema, úsalo tal cual): $${(estado.totalCents / 100).toLocaleString("es-CO")}`;
  // Ya se le pidió el barrio y no lo ha dado: es lo primero que falta, antes
  // que cualquier resumen (la tabla de domicilios va por barrios).
  if (entregaADomicilio && entregaADomicilio.feeCents === null && entregaADomicilio.barrioPedido) {
    falta.unshift("el barrio de la entrega (la tabla de domicilios va por barrios; sin él no hay total)");
  }
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
    contexto +
    modalidad +
    entrega +
    total +
    avisoDelMinimo +
    (falta.length ? `\nTE FALTA, en este orden: ${falta.join(", ")}` : "\nNo falta nada: ve al resumen.")
  );
}
