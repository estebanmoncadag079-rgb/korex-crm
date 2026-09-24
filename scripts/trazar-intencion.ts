/**
 * La traza determinista de los escenarios B–J de la auditoría de la PR #13.
 *
 * §13 pide correr el laboratorio real y registrar, por escenario: el mensaje,
 * la intención detectada, el plan, el prompt, la operación propuesta, si el
 * backend la aceptó o la rechazó, y el estado final.
 *
 * El laboratorio REAL necesita el túnel a producción y gasta saldo de
 * OpenRouter (el mismo que paga a los bots vivos) — y §10 dice "no tocar
 * producción". Así que esto traza lo que el backend DECIDE, que es lo que la
 * auditoría necesita comprobar y es 100% determinista: `leerIntencion`,
 * `planDelTurno`, `bloqueDelPlan`, `comoTexto` y las compuertas de
 * `aplicarOperaciones` corren sin base de datos y sin modelo. La "operación
 * propuesta" es la que el modelo emitiría en ese punto (escrita a mano, y
 * marcada como tal); lo que se PRUEBA es qué hace el backend con ella.
 *
 *   esbuild scripts/trazar-intencion.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-traza.mjs --alias:@=./src --packages=external && node .tmp-traza.mjs
 */
import { leerIntencion, planDelTurno, bloqueDelPlan } from "@/server/orders/intencion";
import { comoTexto } from "@/server/orders/extraer";
import { aplicarOperaciones, type Operacion, type ContextoOperaciones } from "@/server/orders/operaciones";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import type { Requisito } from "@/server/ai/generador/ficha";

const CARTA: ProductoDelCatalogo[] = [
  { id: "c7", nombre: "Cremoso 7 oz", categoria: null, precioCents: 1200000, descripcion: null, grupos: [] },
  { id: "c12", nombre: "Cremoso 12 oz", categoria: null, precioCents: 1800000, descripcion: null, grupos: [] },
  { id: "c16", nombre: "Cremoso 16 oz", categoria: null, precioCents: 2200000, descripcion: null, grupos: [] },
];

const REQS: Requisito[] = [
  { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
  { id: "telefono", tipo: "telefono", etiqueta: "el celular de contacto", obligatorio: true },
];

const conCremoso = (extra: Partial<EstadoDelPedido> = {}): EstadoDelPedido => ({
  ...estadoVacio(),
  items: [
    { ofrecible: { id: "c7", nombre: "Cremoso 7 oz" }, cantidad: 1, seleccion: [], gruposDeclinados: [], totalCents: 1200000 },
  ],
  totalCents: 1200000,
  paso: "eligiendo",
  ...extra,
});

type Escenario = {
  clave: string;
  mensaje: string;
  estadoPrevio: EstadoDelPedido;
  /** El nombre del perfil de WhatsApp de ese contacto. */
  perfil: string | null;
  /** Lo que el CLIENTE ha escrito (evidencia para las compuertas). */
  dicho: string[];
  /** La operación que el modelo emitiría en ese punto. `null` = solo consulta. */
  propuesta: Operacion | null;
  hayPedidoEnCurso: boolean;
  /** Con `state_source='backend'` el backend sabe si hay pedido; si no, no. */
  loSabemos: boolean;
  /** ¿El nombre venía pendiente al empezar el turno? (contexto de la pregunta previa). */
  nombrePendiente?: boolean;
};

const ESCENARIOS: Escenario[] = [
  {
    clave: "B — pregunta el domicilio dentro del pedido",
    mensaje: "y cuánto cuesta el domicilio?",
    estadoPrevio: conCremoso(),
    perfil: "Laura Pérez",
    dicho: ["hola, quiero un cremoso de 7 oz", "y cuánto cuesta el domicilio?"],
    propuesta: null,
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
  {
    clave: "C — pregunta el horario dentro del pedido",
    mensaje: "hasta qué hora atienden hoy?",
    estadoPrevio: conCremoso(),
    perfil: "Laura Pérez",
    dicho: ["hola, quiero un cremoso de 7 oz", "hasta qué hora atienden hoy?"],
    propuesta: null,
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
  {
    clave: "D — pregunta el precio dentro del pedido",
    mensaje: "cuánto vale eso?",
    estadoPrevio: conCremoso(),
    perfil: "Laura Pérez",
    dicho: ["hola, quiero un cremoso de 7 oz", "cuánto vale eso?"],
    propuesta: null,
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
  {
    clave: "E — dice que es para regalo",
    mensaje: "es para un regalo",
    estadoPrevio: conCremoso(),
    perfil: "Laura Pérez",
    dicho: ["hola, quiero un cremoso de 7 oz", "es para un regalo"],
    propuesta: { tipo: "marcar_regalo", esRegalo: true },
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
  {
    clave: "F — el nombre del perfil no es el del cliente",
    mensaje: "quiero uno para un amigo secreto",
    estadoPrevio: conCremoso(),
    perfil: "Luisa Duque",
    dicho: ["quiero uno para un amigo secreto"],
    // El modelo, tentado por la ficha del contacto, propone el nombre del perfil.
    propuesta: { tipo: "fijar_dato", requisitoId: "nombre", valor: "Luisa Duque" },
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
  {
    clave: "G — elige la modalidad de entrega desde el primer mensaje",
    mensaje: "quiero un cremoso de 7 oz a domicilio",
    estadoPrevio: estadoVacio(),
    perfil: "Laura Pérez",
    dicho: ["quiero un cremoso de 7 oz a domicilio"],
    propuesta: { tipo: "fijar_modalidad", modalidad: "domicilio" },
    hayPedidoEnCurso: false,
    loSabemos: true,
  },
  {
    clave: "H — domicilio elegido, sin tarifa verificada",
    mensaje: "listo",
    estadoPrevio: conCremoso({ modalidadDeEntrega: "domicilio", entrega: null }),
    perfil: "Laura Pérez",
    dicho: ["a domicilio", "listo"],
    propuesta: null,
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
  {
    clave: "J — pide un tamaño que no existe",
    mensaje: "me das 2 cremosos de 9 oz",
    estadoPrevio: estadoVacio(),
    perfil: "Laura Pérez",
    dicho: ["me das 2 cremosos de 9 oz"],
    // El modelo intenta agregar el 9 oz; el catálogo no lo tiene.
    propuesta: { tipo: "agregar_item", ofrecible: "Cremoso 9 oz", opciones: [], cantidad: 2 },
    hayPedidoEnCurso: false,
    loSabemos: true,
  },
  {
    clave: "K — el bot pidió el nombre y el cliente responde suelto",
    mensaje: "Ana Gómez",
    estadoPrevio: conCremoso(),
    perfil: "Luisa Duque",
    dicho: ["Ana Gómez"],
    propuesta: { tipo: "fijar_dato", requisitoId: "nombre", valor: "Ana Gómez" },
    hayPedidoEnCurso: true,
    loSabemos: true,
    nombrePendiente: true,
  },
  {
    clave: "L — nombre heredado sin procedencia (no está confirmado)",
    mensaje: "hola",
    // Estado heredado: tiene el valor, no la procedencia. El nombre sigue en TE FALTA.
    estadoPrevio: conCremoso({ datos: { nombre: "Juan Pérez" } }),
    perfil: "Luisa Duque",
    dicho: ["hola"],
    propuesta: null,
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
  {
    clave: "M — 'no es para regalo' con el modelo proponiendo regalo",
    mensaje: "no es para regalo",
    estadoPrevio: conCremoso(),
    perfil: "Luisa Duque",
    dicho: ["no es para regalo"],
    propuesta: { tipo: "marcar_regalo", esRegalo: true },
    hayPedidoEnCurso: true,
    loSabemos: true,
  },
];

function bloque(l: string, cuerpo: string): string {
  return `  ${l}:\n${cuerpo
    .split("\n")
    .map((x) => `      ${x}`)
    .join("\n")}`;
}

for (const e of ESCENARIOS) {
  const lectura = leerIntencion(e.mensaje, CARTA);
  const plan = planDelTurno(lectura, e.hayPedidoEnCurso);
  const planTexto = bloqueDelPlan(lectura, plan, e.loSabemos);
  // El nombre exige procedencia del cliente para darse por satisfecho (backend pedidos).
  const promptEstado = comoTexto(e.estadoPrevio, CARTA, REQS, "pedidos", undefined, true);

  const contexto: ContextoOperaciones = {
    organizationId: "org_traza",
    catalogo: CARTA,
    requisitos: REQS,
    modalidadesOfrecidas: ["domicilio", "recogida"],
    nombreDePerfil: e.perfil,
    dichoPorElCliente: e.dicho,
    mensajeDelTurno: e.mensaje,
    nombrePendienteAntesDelTurno: e.nombrePendiente ?? false,
  };

  let veredicto: string;
  let estadoFinal: unknown;
  if (e.propuesta) {
    const r = aplicarOperaciones(e.estadoPrevio, [e.propuesta], contexto);
    if (r.persistido) {
      veredicto = "ACEPTADA";
      estadoFinal = r.estadoFinal;
    } else {
      veredicto = `RECHAZADA — ${r.rechazo.motivo}`;
      estadoFinal = e.estadoPrevio;
    }
  } else {
    veredicto = "(sin operación: es una consulta, el modelo solo responde)";
    estadoFinal = e.estadoPrevio;
  }

  console.log(`\n${"═".repeat(72)}\n${e.clave}\n${"═".repeat(72)}`);
  console.log(bloque("mensaje", e.mensaje));
  console.log(
    bloque(
      "intención",
      `${lectura.intencion} (${lectura.porque})` +
        (lectura.productoMencionado ? `  ·  producto: ${lectura.productoMencionado}` : "")
    )
  );
  console.log(
    bloque(
      "plan",
      `responderPrimero=${plan.responderPrimero ?? "—"}  continuar=${plan.continuarEnElMismoMensaje}  reiniciar=${plan.reiniciar}`
    )
  );
  console.log(bloque("bloque del plan (al modelo)", planTexto ?? "(ninguno)"));
  console.log(bloque("estado que ve el modelo", promptEstado));
  console.log(
    bloque("operación propuesta (modelo)", e.propuesta ? JSON.stringify(e.propuesta) : "(ninguna)")
  );
  console.log(bloque("veredicto del backend", veredicto));
  console.log(bloque("estado final", JSON.stringify(estadoFinal)));
}

console.log("\n" + "─".repeat(72));
console.log("Traza determinista: sin base de datos, sin modelo, sin producción.");
console.log("La respuesta redactada y la operación exacta las pone el modelo en");
console.log("el laboratorio real, que necesita el túnel + saldo de OpenRouter.");
