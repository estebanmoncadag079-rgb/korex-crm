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
  { campo: "salsas", leer: (e) => e.salsas },
  { campo: "recubierto", leer: (e) => e.recubierto },
  { campo: "adiciones", leer: (e) => e.adiciones },
  { campo: "nombre", leer: (e) => e.entrega.nombre },
  { campo: "telefono", leer: (e) => e.entrega.telefono },
  { campo: "direccion", leer: (e) => e.entrega.direccion },
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
export function loQueFalta(estado: EstadoDelPedido, salsasQueLleva: number): string[] {
  const falta: string[] = [];
  if (!estado.producto.id) falta.push("presentación");
  else if (estado.salsas.length < salsasQueLleva) falta.push("salsas");
  if (estado.producto.id && !estado.recubierto) falta.push("recubierto");
  if (!estado.entrega.nombre?.trim()) falta.push("nombre");
  if (!estado.entrega.telefono?.trim()) falta.push("teléfono");
  if (!estado.entrega.direccion?.trim()) falta.push("dirección");
  return falta;
}

/**
 * El bloque que se le da al modelo en cada turno.
 *
 * Corto a propósito: sustituye instrucciones, no las añade. Si esto crece, el
 * prompt vuelve a engordar y la Fase 2 habrá servido para nada.
 */
export function comoTexto(estado: EstadoDelPedido, salsasQueLleva: number): string {
  if (!estado.producto.id && estado.salsas.length === 0) return "";

  const partes: string[] = [];
  if (estado.producto.nombre) {
    partes.push(`${estado.producto.cantidad} × ${estado.producto.nombre}`);
  }
  if (estado.salsas.length) partes.push(`salsas: ${estado.salsas.join(", ")}`);
  if (estado.recubierto) partes.push(`recubierto: ${estado.recubierto}`);
  if (estado.adiciones.length) partes.push(`adiciones: ${estado.adiciones.join(", ")}`);
  if (estado.entrega.nombre) partes.push(`nombre: ${estado.entrega.nombre}`);
  if (estado.entrega.telefono) partes.push("teléfono: ya lo dio");
  if (estado.entrega.direccion) partes.push("dirección: ya la dio");

  const falta = loQueFalta(estado, salsasQueLleva);
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
