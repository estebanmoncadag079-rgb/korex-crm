/**
 * Validación semántica de un pedido extraído — **Fase 1.5, todo en memoria**.
 *
 * Existe porque un estado puede ser JSON válido, con un producto que existe en
 * la carta, y estar **mal**: *"quiero 6 churros"* se extrajo como
 * `{cantidad: 6}` cuando una Churrita **son** 6 churros y lo correcto era
 * `{producto: "Churrita", cantidad: 1}` — $60.000 contra $10.000. Pasó el
 * esquema y pasó el catálogo ([62](../../../docs/korexia/62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md)).
 *
 * Reglas de la casa, y ninguna es negociable
 * ([66-REGLAS-FASE-2.md](../../../docs/korexia/66-REGLAS-FASE-2.md)):
 *
 * - **No persiste nada.** Funciones puras: entra el estado propuesto, sale el
 *   normalizado. Ni una escritura, ni una tabla, ni una migración.
 * - **Normaliza, nunca rechaza.** Un nombre en mayúsculas, con tilde o en
 *   plural se corrige; jamás se descarta la conversación por eso.
 * - **El total lo calcula el servidor**, nunca el número que diga el modelo.
 * - **Ante la duda, preguntar.** Si el backend no puede reconstruir el pedido
 *   con certeza, lo dice — no adivina. Adivinar es cobrar de más.
 */
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

export type EstadoPropuesto = {
  producto: string | null;
  cantidad: number | null;
  salsas: string[];
  recubierto: string | null;
  adiciones: string[];
  /** Los tres datos de entrega. Sin ellos el pedido no se puede despachar. */
  nombre?: string | null;
  telefono?: string | null;
  direccion?: string | null;
};

export type Correccion = {
  campo: string;
  de: string;
  a: string;
  regla: string;
};

/** Lo que el backend NO puede resolver solo. No se adivina: se pregunta. */
export type Duda = {
  campo: string;
  porque: string;
  preguntar: string;
};

export type EstadoNormalizado = {
  productoId: string | null;
  producto: string | null;
  cantidad: number;
  salsas: string[];
  recubierto: string | null;
  adiciones: string[];
  /** Lo suma el servidor a partir de la tabla. `null` = todavía no se puede. */
  totalCents: number | null;
};

export type Resultado = {
  estado: EstadoNormalizado;
  correcciones: Correccion[];
  dudas: Duda[];
  /**
   * Lo que le falta al pedido para poder despacharlo, en el orden del flujo del
   * negocio: presentación → salsas → recubierto → datos de entrega.
   *
   * Es distinto de `reconstruible`: un pedido puede estar entendido sin
   * ambigüedad (nada que preguntar de lo dicho) y aun así estar **a medias**.
   * Mezclar las dos cosas fue lo que infló la primera métrica de este informe.
   */
  faltaParaCerrar: string[];
  /**
   * La pregunta obligatoria de la Fase 1.5: *¿puede el backend reconstruir el
   * pedido exactamente igual que lo haría un humano?* Solo es `true` cuando no
   * queda ninguna duda **y** el total está calculado.
   */
  reconstruible: boolean;
};

/** Sin tildes, sin mayúsculas y sin plural: comparar nombres, no ortografías. */
function llave(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");
}

/** *"6 churros"*, *"una caja de 6"*, *"6"* → 6. Sin número, `null`. */
function unidadesQueMenciona(texto: string): number | null {
  const m = texto.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function normalizarPedido(
  propuesto: EstadoPropuesto,
  catalogo: ProductoDelCatalogo[],
  /**
   * Cuántas unidades trae cada presentación (`{"churrita": 6}`).
   *
   * ⚠️ **Hoy la tabla `product` no guarda este dato** —`description` está
   * vacío en los cuatro productos de La Churra— y sin él *"quiero 6 churros"*
   * es irresoluble para el backend. Se recibe como parámetro, y su ausencia se
   * declara como duda en lugar de fingir que no existe el problema.
   */
  unidadesPorProducto?: Record<string, number>
): Resultado {
  const correcciones: Correccion[] = [];
  const dudas: Duda[] = [];

  const porNombre = new Map(catalogo.map((p) => [llave(p.nombre), p]));
  const opcionesConocidas = new Map<string, { grupo: string; producto: string }>();
  for (const p of catalogo) {
    for (const g of p.grupos) {
      for (const o of g.opciones) {
        opcionesConocidas.set(llave(o.nombre), { grupo: g.nombre, producto: p.nombre });
      }
    }
  }

  // --- El producto -------------------------------------------------------
  let producto: ProductoDelCatalogo | undefined;
  const crudo = propuesto.producto?.trim() ?? "";

  if (crudo) {
    producto = porNombre.get(llave(crudo));

    // Coincidencia parcial: "churrita con chocolate" trae el nombre dentro.
    if (!producto) {
      for (const [k, p] of porNombre) {
        if (llave(crudo).includes(k)) {
          producto = p;
          correcciones.push({
            campo: "producto",
            de: crudo,
            a: p.nombre,
            regla: "el nombre de la presentación venía dentro de una frase",
          });
          break;
        }
      }
    } else if (crudo !== producto.nombre) {
      correcciones.push({
        campo: "producto",
        de: crudo,
        a: producto.nombre,
        regla: "mismo producto escrito distinto (mayúsculas, tildes o plural)",
      });
    }

    // Lo que llegó como producto es en realidad una OPCIÓN: "chocolate" no es
    // una presentación, es una salsa. Se mueve, no se descarta.
    if (!producto) {
      const comoOpcion = opcionesConocidas.get(llave(crudo));
      if (comoOpcion) {
        correcciones.push({
          campo: "producto",
          de: crudo,
          a: `${comoOpcion.grupo.toLowerCase()}: ${crudo}`,
          regla: "es una opción, no una presentación",
        });
        if (!propuesto.salsas.some((s) => llave(s) === llave(crudo))) {
          propuesto = { ...propuesto, salsas: [...propuesto.salsas, crudo] };
        }
        dudas.push({
          campo: "producto",
          porque: `"${crudo}" es ${comoOpcion.grupo.toLowerCase()}, y no dice qué presentación quiere`,
          preguntar: "¿Cuál presentación desea?",
        });
      }
    }

    // Habla de UNIDADES, no de una presentación: "6 churros", "caja de 6".
    //
    // El número puede venir en el propio texto ("caja de 6") o haberse ido al
    // campo `cantidad` — que es exactamente el caso que originó todo esto:
    // producto "churros" + cantidad 6. Si se toma al pie de la letra son seis
    // presentaciones y $60.000.
    if (!producto && dudas.length === 0) {
      const n = unidadesQueMenciona(crudo) ?? propuesto.cantidad;
      const porUnidades = n === null ? undefined : buscarPorUnidades(n, catalogo, unidadesPorProducto);
      if (porUnidades) {
        producto = porUnidades;
        correcciones.push({
          campo: "producto",
          de: crudo,
          a: porUnidades.nombre,
          regla: `${n} unidades es la presentación ${porUnidades.nombre}`,
        });
        // Si el número venía en `cantidad`, ese campo era unidades, no
        // presentaciones: se confirma antes de cobrar seis.
        if (unidadesQueMenciona(crudo) === null && propuesto.cantidad === n) {
          dudas.push({
            campo: "cantidad",
            porque: `dijo ${n} y una ${porUnidades.nombre} trae justo ${n}: puede ser una sola presentación`,
            preguntar: `¿Desea ${n} ${porUnidades.nombre} o una sola?`,
          });
          correcciones.push({
            campo: "cantidad",
            de: String(propuesto.cantidad),
            a: "1",
            regla: "número de unidades tomado como número de presentaciones",
          });
          propuesto = { ...propuesto, cantidad: 1 };
        }
      } else {
        dudas.push({
          campo: "producto",
          porque:
            n === null
              ? `"${crudo}" no es ninguna presentación de la carta`
              : `"${crudo}" habla de ${n} unidades, y la carta no dice cuántas trae cada presentación`,
          preguntar: "¿Cuál presentación desea?",
        });
      }
    }
  } else {
    dudas.push({
      campo: "producto",
      porque: "todavía no ha elegido presentación",
      preguntar: "¿Cuál presentación desea?",
    });
  }

  // --- La cantidad -------------------------------------------------------
  // Una presentación pedida sin número es UNA. Pero si el número que traía
  // coincide con las unidades de esa presentación, es la trampa de "6 churros":
  // se pregunta en vez de multiplicar por seis.
  let cantidad = propuesto.cantidad ?? 1;
  if (producto) {
    const unidades = unidadesDe(producto, unidadesPorProducto);
    if (propuesto.cantidad !== null && unidades !== null && propuesto.cantidad === unidades) {
      dudas.push({
        campo: "cantidad",
        porque: `pidió ${propuesto.cantidad} y una ${producto.nombre} trae justo ${unidades}: puede ser una sola presentación`,
        preguntar: `¿Desea ${propuesto.cantidad} ${producto.nombre} o una sola?`,
      });
      cantidad = 1;
      correcciones.push({
        campo: "cantidad",
        de: String(propuesto.cantidad),
        a: "1",
        regla: "número de unidades tomado como número de presentaciones",
      });
    }
    if (propuesto.cantidad === null) {
      correcciones.push({
        campo: "cantidad",
        de: "null",
        a: "1",
        regla: "una presentación sin número es una",
      });
    }
  }
  if (cantidad < 1) cantidad = 1;

  // --- Las opciones ------------------------------------------------------
  //
  // Los grupos se buscan POR NOMBRE. Antes se cogía "el primer grupo con
  // opciones", que funcionaba solo mientras el catálogo tuviera un único grupo
  // — y el flujo real de La Churra tiene tres: salsas, recubierto y adiciones.
  const grupoLlamado = (p: ProductoDelCatalogo | undefined, ...nombres: string[]) =>
    p?.grupos.find((g) => nombres.some((n) => llave(g.nombre).startsWith(llave(n))));

  const salsas: string[] = [];
  if (!producto) {
    // Sin presentación no se pueden validar contra su grupo, pero lo que el
    // cliente ya dijo NO se tira: se conserva para cuando elija.
    for (const s of propuesto.salsas) {
      if (opcionesConocidas.has(llave(s)) && !salsas.includes(s)) salsas.push(s);
    }
  }
  if (producto) {
    const grupo =
      grupoLlamado(producto, "salsa") ?? producto.grupos.find((g) => g.opciones.length > 0);
    const validas = new Map(
      (grupo?.opciones ?? []).map((o) => [llave(o.nombre), o.nombre] as const)
    );
    for (const s of propuesto.salsas) {
      const buena = validas.get(llave(s));
      if (buena) {
        if (buena !== s) {
          correcciones.push({ campo: "salsas", de: s, a: buena, regla: "nombre de salsa normalizado" });
        }
        if (!salsas.includes(buena)) salsas.push(buena);
      } else {
        dudas.push({
          campo: "salsas",
          porque: `"${s}" no está entre las opciones de ${producto.nombre}`,
          preguntar: `¿Cuál salsa desea? Hay: ${[...validas.values()].join(", ")}`,
        });
      }
    }
    // El "elige N" es del producto, no del grupo: una Churrita lleva 1 y un
    // Mega Box 5. Faltar salsas no es un error, es un pedido a medias.
    const cuantas = grupo?.maximo ?? 0;
    if (grupo && salsas.length < cuantas) {
      dudas.push({
        campo: "salsas",
        porque: `${producto.nombre} lleva ${cuantas} y hay ${salsas.length}`,
        preguntar: `¿Cuál${cuantas - salsas.length > 1 ? "es" : ""} salsa${cuantas - salsas.length > 1 ? "s" : ""} desea?`,
      });
    }
  }

  // --- El recubierto -----------------------------------------------------
  // Va aparte de las salsas porque es otra elección del flujo y con otras
  // opciones (azúcar-canela, azúcar sola, sin azúcar). Si el catálogo todavía
  // no lo tiene en tablas, se acepta lo que venga sin validarlo: no se puede
  // rechazar contra una lista que no existe.
  let recubierto = propuesto.recubierto;
  const grupoRecubierto = grupoLlamado(producto, "recubierto", "azucar", "azúcar");
  if (producto && grupoRecubierto && recubierto) {
    const buena = grupoRecubierto.opciones.find((o) => llave(o.nombre) === llave(recubierto!));
    if (buena) {
      if (buena.nombre !== recubierto) {
        correcciones.push({
          campo: "recubierto",
          de: recubierto,
          a: buena.nombre,
          regla: "nombre de recubierto normalizado",
        });
      }
      recubierto = buena.nombre;
    } else {
      dudas.push({
        campo: "recubierto",
        porque: `"${recubierto}" no está entre los recubiertos de la carta`,
        preguntar: `¿Cuál recubierto desea? Hay: ${grupoRecubierto.opciones.map((o) => o.nombre).join(", ")}`,
      });
    }
  }

  // --- El total, siempre del servidor ------------------------------------
  let totalCents: number | null = null;
  if (producto && dudas.length === 0) {
    if (producto.precioCents === null) {
      dudas.push({
        campo: "total",
        porque: `${producto.nombre} no tiene precio cargado`,
        preguntar: "el equipo confirma el precio",
      });
    } else {
      const extras = sumaDeExtras(producto, salsas, propuesto.adiciones);
      totalCents = (producto.precioCents + extras) * cantidad;
    }
  }

  // --- Qué falta para poder despachar ------------------------------------
  // El flujo del negocio, en su orden: presentación → salsas → recubierto →
  // datos de entrega. Las adiciones son opcionales y por eso no están aquí.
  const faltaParaCerrar: string[] = [];
  if (!producto) faltaParaCerrar.push("presentación");
  else {
    const cuantasSalsas = grupoLlamado(producto, "salsa")?.maximo ?? 0;
    if (salsas.length < cuantasSalsas) faltaParaCerrar.push("salsas");
    if (grupoRecubierto && !recubierto) faltaParaCerrar.push("recubierto");
  }
  if (!propuesto.nombre?.trim()) faltaParaCerrar.push("nombre");
  if (!propuesto.telefono?.trim()) faltaParaCerrar.push("teléfono");
  if (!propuesto.direccion?.trim()) faltaParaCerrar.push("dirección");

  return {
    faltaParaCerrar,
    estado: {
      productoId: producto?.id ?? null,
      producto: producto?.nombre ?? null,
      cantidad,
      salsas,
      recubierto,
      adiciones: propuesto.adiciones,
      totalCents,
    },
    correcciones,
    dudas,
    reconstruible: dudas.length === 0 && totalCents !== null,
  };
}

function unidadesDe(
  producto: ProductoDelCatalogo,
  unidades?: Record<string, number>
): number | null {
  if (!unidades) return null;
  const encontrado = Object.entries(unidades).find(([k]) => llave(k) === llave(producto.nombre));
  return encontrado ? encontrado[1] : null;
}

function buscarPorUnidades(
  n: number,
  catalogo: ProductoDelCatalogo[],
  unidades?: Record<string, number>
): ProductoDelCatalogo | undefined {
  if (!unidades) return undefined;
  return catalogo.find((p) => unidadesDe(p, unidades) === n);
}

function sumaDeExtras(
  producto: ProductoDelCatalogo,
  salsas: string[],
  adiciones: string[]
): number {
  let extra = 0;
  for (const g of producto.grupos) {
    for (const o of g.opciones) {
      const pedida =
        salsas.some((s) => llave(s) === llave(o.nombre)) ||
        adiciones.some((a) => llave(a) === llave(o.nombre));
      if (pedida) extra += o.precioExtraCents;
    }
  }
  return extra;
}
