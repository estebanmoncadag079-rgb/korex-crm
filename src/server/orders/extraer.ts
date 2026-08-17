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
  { campo: "producto", leer: (e) => e.producto.nombre },
  { campo: "cantidad", leer: (e) => e.producto.cantidad },
  // Lo elegido va como una sola entrada: los grupos los pone el negocio, no
  // este archivo. Antes había una línea por grupo de La Churra.
  { campo: "opciones", leer: (e) => e.seleccion.map((s) => `${s.grupoNombre}:${s.nombre}`) },
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
  /** El producto del catálogo, con SUS grupos. `undefined` = aún sin elegir. */
  producto?: ProductoDelCatalogo,
  /** Lo que este negocio pide para cerrar, en su orden. */
  requisitos: Requisito[] = []
): string[] {
  const falta: string[] = [];
  if (!estado.producto.id) {
    falta.push("presentación");
  } else {
    /*
     * Los grupos obligatorios salen del catálogo del negocio — ni un nombre
     * escrito aquí. Sirve igual para *salsas*, *tamaño* o *diseño de uñas*.
     */
    for (const g of producto?.grupos ?? []) {
      if (g.opciones.length === 0 || g.minimo < 1) continue;
      const elegidas = estado.seleccion.filter((s) => s.grupoId === g.id).length;
      if (elegidas < g.minimo) falta.push(g.nombre.toLowerCase());
    }
  }
  // En el orden en que el negocio los declaró: ese orden ES la configuración.
  for (const r of requisitos) {
    if (r.obligatorio && !estado.datos[r.id]?.trim()) falta.push(r.etiqueta);
  }
  return falta;
}

/**
 * El bloque que se le da al modelo en cada turno.
 *
 * Corto a propósito: sustituye instrucciones, no las añade. Si esto crece, el
 * prompt vuelve a engordar y la Fase 2 habrá servido para nada.
 */
export function comoTexto(
  estado: EstadoDelPedido,
  producto?: ProductoDelCatalogo,
  requisitos: Requisito[] = []
): string {
  if (!estado.producto.id && estado.seleccion.length === 0) return "";

  const partes: string[] = [];
  if (estado.producto.nombre) {
    partes.push(`${estado.producto.cantidad} × ${estado.producto.nombre}`);
  }
  // Una línea por grupo, con el nombre que le puso el negocio.
  const porGrupo = new Map<string, string[]>();
  for (const s of estado.seleccion) {
    const clave = s.grupoNombre || "opciones";
    porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), s.nombre]);
  }
  for (const [grupo, nombres] of porGrupo) {
    partes.push(`${grupo.toLowerCase()}: ${nombres.join(", ")}`);
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

  const falta = loQueFalta(estado, producto, requisitos);
  const total =
    estado.totalCents === null
      ? ""
      : `\nTOTAL (lo calculó el sistema, úsalo tal cual): $${(estado.totalCents / 100).toLocaleString("es-CO")}`;

  return (
    `PEDIDO EN CURSO — no vuelvas a preguntar nada de esto:\n${partes.join(" · ")}` +
    total +
    (falta.length ? `\nTE FALTA, en este orden: ${falta.join(", ")}` : "\nNo falta nada: ve al resumen.")
  );
}
