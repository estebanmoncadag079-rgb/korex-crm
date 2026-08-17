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

/**
 * Una opción tal como la propone el modelo: **por nombre, nunca por id**.
 *
 * El LLM no ha visto un id en su vida y no debe verlo. Dice *"arequipe"* y, si
 * puede, de qué grupo es; resolver eso contra el catálogo es trabajo del
 * backend — exactamente lo que ya se hacía con el producto.
 *
 * `grupo` es opcional a propósito (regla 3: contratos tolerantes). Cuando falta
 * y el nombre existe en más de un grupo, **no se adivina: se pregunta**.
 */
export type OpcionPropuesta = {
  /** El nombre del grupo, si el modelo lo dijo. `"SALSAS"`, `"TAMAÑO"`… */
  grupo?: string | null;
  opcion: string;
};

/**
 * Una opción ya resuelta contra el catálogo.
 *
 * Lleva los ids **y** el nombre y el precio del momento. Los ids son para
 * operar; los otros dos son testimonio: si mañana el negocio renombra la opción
 * o le cambia el precio, el pedido guardado **sigue siendo legible**. Es la
 * misma decisión que ya se tomó con `producto.nombre`, aplicada un nivel abajo.
 *
 * ⚠️ `precioDeltaCents` **no se usa para calcular**: el total se recalcula
 * siempre desde el catálogo (regla 2, el total lo pone el servidor). Está para
 * poder responder *"¿cuánto se le cobró aquel día?"*.
 */
export type OpcionElegida = {
  grupoId: string;
  grupoNombre: string;
  opcionId: string;
  nombre: string;
  precioDeltaCents: number;
};

export type EstadoPropuesto = {
  producto: string | null;
  cantidad: number | null;
  /**
   * Todo lo que el cliente eligió, **en una sola lista y en su orden**.
   *
   * Sustituye a `salsas` / `recubierto` / `adiciones` (17-ago-2026): eran los
   * grupos de UN negocio metidos en el núcleo, y con ellos un salón no tenía
   * dónde poner *"con esmalte"*. Ver
   * [79-ARQUITECTURA-MULTIEMPRESA.md](../../../docs/korexia/79-ARQUITECTURA-MULTIEMPRESA.md).
   *
   * **Es una lista, no un conjunto**: `[arequipe, arequipe]` son dos salsas.
   */
  opciones: OpcionPropuesta[];
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
  /** Lo elegido, resuelto y en orden. Una lista: las repeticiones se conservan. */
  seleccion: OpcionElegida[];
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
        if (!propuesto.opciones.some((o) => llave(o.opcion) === llave(crudo))) {
          propuesto = {
            ...propuesto,
            opciones: [...propuesto.opciones, { grupo: comoOpcion.grupo, opcion: crudo }],
          };
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
  // Los grupos se buscan POR NOMBRE (`grupoLlamado`, arriba). Antes se cogía "el
  // primer grupo con opciones", que funcionaba solo mientras el catálogo tuviera
  // un único grupo — y el flujo real de La Churra tiene tres: salsas, recubierto
  // y adiciones.
  /*
   * 🔴 LAS SALSAS NO SON ÚNICAS (decisión del dueño, 16-ago-2026).
   *
   * Un Mega Box lleva CINCO salsas y el catálogo tiene CUATRO sabores: repetir
   * no es un error del cliente, es la única forma de completarlo. Hasta hoy
   * esto deduplicaba con `salsas.includes(...)`, así que
   *
   *   ["arequipe", "arequipe", "lechera"]  →  ["arequipe", "lechera"]
   *
   * y el Mega Box **no se podía completar jamás**: se quedaba en cuatro, con
   * duda permanente, sin total y sin poder confirmarse.
   *
   * Se conserva la lista TAL CUAL la pidió el cliente. Lo que sí se comprueba
   * ahora, porque el `includes` lo tapaba de rebote, es que no se pase del
   * máximo del producto.
   */
  const seleccion: OpcionElegida[] = [];

  if (producto) {
    for (const propuesta of propuesto.opciones) {
      const cruda = propuesta.opcion?.trim();
      if (!cruda) continue;

      /*
       * Dónde vive esta opción. Si el modelo dijo el grupo, se busca ahí; si no,
       * se busca en todos los del producto.
       *
       * 🔴 Y si aparece en MÁS DE UNO, **no se elige por el código**. En La
       * Churra `AREQUIPE` está como salsa incluida y como adición de $1.500: de
       * adivinar salía un cobro de más. Ante la ambigüedad, se pregunta.
       */
      const candidatos = producto.grupos
        .filter((g) => (propuesta.grupo ? llave(g.nombre).startsWith(llave(propuesta.grupo)) : true))
        .flatMap((g) =>
          g.opciones.filter((o) => llave(o.nombre) === llave(cruda)).map((o) => ({ g, o }))
        );

      if (candidatos.length === 0) {
        const todas = producto.grupos.flatMap((g) => g.opciones.map((o) => o.nombre));
        dudas.push({
          campo: propuesta.grupo ?? "opciones",
          porque: `"${cruda}" no está entre las opciones de ${producto.nombre}`,
          preguntar: todas.length
            ? `¿Cuál desea? Hay: ${[...new Set(todas)].join(", ")}`
            : `¿Qué desea de ${producto.nombre}?`,
        });
        continue;
      }

      if (candidatos.length > 1) {
        dudas.push({
          campo: propuesta.grupo ?? "opciones",
          porque: `"${cruda}" está en ${candidatos.length} grupos de ${producto.nombre} y no se dijo cuál`,
          preguntar: `¿"${cruda}" como ${candidatos.map((c) => c.g.nombre.toLowerCase()).join(" o como ")}?`,
        });
        continue;
      }

      const { g, o } = candidatos[0]!;
      if (o.nombre !== cruda) {
        correcciones.push({
          campo: g.nombre.toLowerCase(),
          de: cruda,
          a: o.nombre,
          regla: "nombre de opción normalizado",
        });
      }
      seleccion.push({
        grupoId: g.id,
        grupoNombre: g.nombre,
        opcionId: o.id,
        nombre: o.nombre,
        precioDeltaCents: o.precioExtraCents,
      });
    }

    /*
     * Las reglas de CADA grupo, salidas del catálogo — ni un nombre en el código.
     *
     * Antes esto eran dos bloques escritos a mano, uno para las salsas y otro
     * para el recubierto, con sus nombres dentro. Un salón con *"con esmalte"* o
     * una pizzería con *"tamaño"* no cabían. Ahora se recorre lo que el negocio
     * haya definido, sea lo que sea.
     */
    for (const g of producto.grupos) {
      if (g.opciones.length === 0) continue;
      const elegidas = seleccion.filter((s) => s.grupoId === g.id).length;
      const etiqueta = g.nombre.toLowerCase();

      if (elegidas < g.minimo) {
        const faltan = g.minimo - elegidas;
        dudas.push({
          campo: etiqueta,
          porque: `${producto.nombre} lleva ${g.minimo} de ${etiqueta} y hay ${elegidas}`,
          preguntar: `¿Cuál${faltan > 1 ? "es" : ""} ${etiqueta} desea?`,
        });
      }
      // Pasarse tampoco vale, y NO se recorta en silencio: elegir cuáles quitar
      // es del cliente, no del backend.
      if (g.maximo > 0 && elegidas > g.maximo) {
        dudas.push({
          campo: etiqueta,
          porque: `${producto.nombre} lleva ${g.maximo} de ${etiqueta} y pidió ${elegidas}`,
          preguntar: `Una ${producto.nombre} lleva ${g.maximo} de ${etiqueta}. ¿Cuáles deja?`,
        });
      }
    }
  } else {
    /*
     * Sin presentación elegida no hay grupos contra los que validar, pero lo que
     * el cliente ya dijo NO se tira: se conserva sin resolver, para cuando
     * elija. Las repeticiones también.
     */
    for (const propuesta of propuesto.opciones) {
      const cruda = propuesta.opcion?.trim();
      if (cruda && opcionesConocidas.has(llave(cruda))) {
        seleccion.push({
          grupoId: "",
          grupoNombre: propuesta.grupo ?? "",
          opcionId: "",
          nombre: cruda,
          precioDeltaCents: 0,
        });
      }
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
      // Se recorre LO ELEGIDO, no el catálogo: dos botellas de agua son dos.
      const extras = seleccion.reduce((suma, s) => suma + s.precioDeltaCents, 0);
      totalCents = (producto.precioCents + extras) * cantidad;
    }
  }

  /*
   * --- Qué falta para poder despachar ------------------------------------
   *
   * Sale del CATÁLOGO, no de una lista escrita a mano. Un grupo con `minimo >=
   * 1` que no esté completo es algo que falta, se llame *salsas*, *tamaño* o
   * *diseño de uñas*.
   *
   * ⚠️ Los tres datos de entrega siguen aquí, y **siguen siendo lo de La
   * Churra**: un salón no entrega nada a domicilio. Convertirlos en
   * configuración es el paso 3 de
   * [79-ARQUITECTURA-MULTIEMPRESA.md](../../../docs/korexia/79-ARQUITECTURA-MULTIEMPRESA.md).
   */
  const faltaParaCerrar: string[] = [];
  if (!producto) faltaParaCerrar.push("presentación");
  else {
    for (const g of producto.grupos) {
      if (g.opciones.length === 0 || g.minimo < 1) continue;
      const elegidas = seleccion.filter((s) => s.grupoId === g.id).length;
      if (elegidas < g.minimo) faltaParaCerrar.push(g.nombre.toLowerCase());
    }
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
      seleccion,
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

