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
import type { Requisito } from "@/server/ai/generador/ficha";

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

/**
 * Un elemento del pedido: qué, cuánto y con qué opciones.
 *
 * **La unidad no es el producto: es la línea elegida.** Un cliente pide *"una
 * Churrita con arequipe y un Besties con chocolate y chocolate"* en un solo
 * mensaje, y eso son dos ítems con sus opciones cada uno — no un producto con
 * cinco opciones sueltas de las que ya nadie sabe de quién son.
 *
 * Se llama `ofrecible` y no `producto` porque un servicio de un salón entra por
 * aquí exactamente igual (ver `catalog/queries.ts`, tipo `Ofrecible`).
 */
export type ItemPropuesto = {
  /** El nombre tal y como lo dijo el modelo. El backend lo resuelve. */
  ofrecible: string | null;
  cantidad: number | null;
  /**
   * Lo elegido para ESTE ítem, **en su orden**.
   *
   * Sustituye a `salsas` / `recubierto` / `adiciones` (17-ago): eran los grupos
   * de UN negocio metidos en el núcleo, y con ellos un salón no tenía dónde
   * poner *"con esmalte"*.
   *
   * **Es una lista, no un conjunto**: `[arequipe, arequipe]` son dos salsas.
   */
  opciones: OpcionPropuesta[];
  /**
   * Grupos OPCIONALES que el cliente dijo explícitamente que NO quiere para
   * este ítem ("sin toppings", "sin salsa") — por nombre, igual que las
   * opciones. Distinto de no mencionarlo: un grupo ausente aquí sigue
   * "pendiente", uno declinado aquí queda resuelto como "el cliente no
   * quiere" y no debe volver a ofrecerse.
   */
  gruposDeclinados?: string[] | null;
};

export type EstadoPropuesto = {
  /**
   * Todo lo que lleva el pedido, **en el orden en que se pidió**.
   *
   * Sustituye a `producto` + `cantidad` + `opciones` sueltos en la raíz
   * (17-ago-2026). Aquellos eran un pedido de un solo elemento, y el primer
   * cliente real que probó la Fase 2 pidió dos cosas en el mismo mensaje.
   */
  items: ItemPropuesto[];
  /**
   * Lo que el cliente ha ido dando de lo que su negocio pide para cerrar,
   * indexado por el `id` del requisito.
   *
   * Sustituye a `nombre` / `telefono` / `direccion` (17-ago-2026): eran los tres
   * datos de un negocio que entrega a domicilio, escritos dentro del núcleo. Un
   * salón arrastraba una dirección que nadie iba a darle.
   *
   * **Nunca se interpreta solo**: sin los `Requisito` de la ficha no se sabe
   * cuál falta, cuál es obligatorio ni cómo se llama.
   */
  datos: Record<string, string | null>;
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

/** Un ítem ya resuelto contra el catálogo. */
export type ItemNormalizado = {
  ofrecibleId: string | null;
  ofrecible: string | null;
  cantidad: number;
  /** Lo elegido, resuelto y en orden. Una lista: las repeticiones se conservan. */
  seleccion: OpcionElegida[];
  /**
   * Grupos OPCIONALES que el cliente rechazó explícitamente para este ítem —
   * resueltos contra el catálogo, igual que `seleccion`. El agente no debe
   * volver a ofrecerlos. Un grupo obligatorio nunca aparece aquí: no se
   * puede "declinar" algo que el catálogo exige elegir.
   */
  gruposDeclinados: { grupoId: string; grupoNombre: string }[];
  /** Lo de ESTE ítem, con su cantidad ya multiplicada. `null` = no se puede aún. */
  totalCents: number | null;
};

export type EstadoNormalizado = {
  items: ItemNormalizado[];
  /**
   * La suma de los ítems. `null` si a alguno le falta el precio: **medio total
   * es peor que ninguno**, porque parece un número bueno.
   */
  totalCents: number | null;
};

export type Resultado = {
  estado: EstadoNormalizado;
  correcciones: Correccion[];
  dudas: Duda[];
  /**
   * Lo que le falta al pedido para poder despacharlo, en el orden del flujo del
   * negocio: presentación → los grupos obligatorios de su catálogo → datos de
   * entrega. Los nombres los pone cada negocio, no este archivo.
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
/**
 * Resuelve la modalidad que propuso el modelo contra las que el negocio OFRECE.
 *
 * El modelo propone; **esta función decide**. Devuelve siempre uno de los ids
 * que vinieron en `ofrecidas` o `null` — nunca inventa una modalidad, ni deja
 * pasar texto libre a la base. Un negocio sin modalidades declaradas devuelve
 * `null` siempre, y entonces la modalidad no participa en nada.
 *
 * La tolerancia es mecánica, no un diccionario de sinónimos: se comparan las
 * dos partes ya normalizadas (sin tildes, sin mayúsculas, sin plural) y se
 * acepta que la propuesta CONTENGA el id — así "recogida en el local" resuelve
 * a "recogida" sin que este archivo aprenda vocabulario de ningún negocio.
 * Meter aquí una lista de sinónimos sería el conocimiento del negocio volviendo
 * al núcleo por la puerta de atrás.
 */
export function normalizarModalidad(
  propuesta: string | null | undefined,
  ofrecidas: readonly string[]
): string | null {
  if (!propuesta?.trim() || ofrecidas.length === 0) return null;
  const dicho = llave(propuesta);
  if (!dicho) return null;
  for (const id of ofrecidas) {
    const canonica = llave(id);
    if (dicho === canonica) return id;
  }
  // Segunda pasada, para que "recogida en el local" resuelva a "recogida".
  // Va aparte para que una coincidencia EXACTA siempre gane a una parcial.
  for (const id of ofrecidas) {
    const canonica = llave(id);
    if (canonica && dicho.split(" ").includes(canonica)) return id;
  }
  return null;
}

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


/**
 * Cuántos elementos como máximo caben en un pedido.
 *
 * 🔒 Decisión del dueño (17-ago-2026). **Es un límite técnico, no una regla de
 * negocio**, y por eso vive aquí y no en la ficha: 40 ítems caben de sobra en un
 * `jsonb` y no caben en un prompt. Un negocio no elige su límite técnico, igual
 * que no elige el tamaño máximo de una foto.
 *
 * El día que un cliente necesite 41, **eso sí es una conversación de negocio**:
 * el número se muda a la ficha, no se sube a mano aquí.
 */
export const MAX_ITEMS = 40;

/**
 * Resuelve UN ítem contra el catálogo.
 *
 * Es, casi línea por línea, lo que hasta el 17-ago-2026 hacía `normalizarPedido`
 * entera — porque el pedido *era* un ítem. Lo que cambió no es cómo se resuelve
 * un elemento, sino que ahora se resuelven **todos**.
 *
 * Las correcciones y las dudas se acumulan en las listas del pedido: son de la
 * conversación, no del ítem. Cuando importa de cuál vienen, el texto lo dice
 * —lleva el nombre del ofrecible— y con eso basta para preguntar bien.
 */
function resolverItem(
  propuesto: ItemPropuesto,
  catalogo: ProductoDelCatalogo[],
  porNombre: Map<string, ProductoDelCatalogo>,
  opcionesConocidas: Map<string, { grupo: string; producto: string }>,
  correcciones: Correccion[],
  dudas: Duda[],
  unidadesPorProducto?: Record<string, number>
): ItemNormalizado {
  // --- El producto -------------------------------------------------------
  let producto: ProductoDelCatalogo | undefined;
  const crudo = propuesto.ofrecible?.trim() ?? "";

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

  /*
   * Sin ningún grupo declarado (todo servicio de citas hoy, docs/korexia/83:
   * `catalogoDe` los devuelve con `grupos: []`), cualquier `opciones` que
   * proponga el modelo es ruido sobre un campo que este producto/servicio no
   * tiene — no una elección real que se esté perdiendo. Tratarlo como duda
   * ("no está entre las opciones de X") lo convertía en un RECHAZO
   * (`validarPropuesta`, estado.ts) que descartaba el turno ENTERO —
   * servicio y cantidad correctos incluidos — violando la regla de este
   * archivo: "normaliza, nunca rechaza". Bug real, encontrado auditando
   * citas (Lashes Valen, 31-ago-2026): "quiero un Laminado de cejas" nunca
   * dejaba nada en `conversation_state`.
   */
  const sinGruposDeclarados = producto ? producto.grupos.length === 0 : false;

  if (producto) {
    for (const propuesta of propuesto.opciones) {
      const cruda = propuesta.opcion?.trim();
      if (!cruda) continue;
      if (sinGruposDeclarados) continue;

      /*
       * Dónde vive esta opción. Si el modelo dijo el grupo, se busca ahí; si no,
       * se busca en todos los del producto.
       *
       * 🔴 Y si aparece en MÁS DE UNO, **no se elige por el código**. En La
       * Churra `AREQUIPE` está como salsa incluida y como adición de $1.500: de
       * adivinar salía un cobro de más. Ante la ambigüedad, se pregunta.
       *
       * La comparación es en LOS DOS SENTIDOS a propósito (29-ago-2026): el
       * modelo ve el catálogo con anotaciones que no son el nombre real del
       * grupo —"TOPPINGS (opcional)", "aplica a: X, Y"— y a veces las repite
       * tal cual en `grupo`. Comparar solo "¿el nombre real EMPIEZA como lo
       * que dijo el modelo?" fallaba justo al revés: lo que dijo el modelo
       * era más LARGO que el nombre real ("toppings opcional" no empieza
       * como "topping"), y una opción real de un grupo real quedaba
       * rechazada como si no existiera.
       */
      const coincideGrupo = (nombreReal: string, dicho: string) => {
        const a = llave(nombreReal);
        const b = llave(dicho);
        return a.startsWith(b) || b.startsWith(a);
      };
      const candidatos = producto.grupos
        .filter((g) => (propuesta.grupo ? coincideGrupo(g.nombre, propuesta.grupo) : true))
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

      /*
       * ¿Ya la había elegido? Lo permite o no **su grupo**, no este archivo.
       *
       * Entre el 16 y el 17-ago esto fue una regla del núcleo dos veces: primero
       * prohibida —y un Mega Box, cinco salsas de cuatro sabores, no se podía
       * cerrar jamás— y luego universal, con lo que un salón admitía "esmaltado
       * tradicional + tradicional". Las dos veces la decidió lo que necesitaba
       * un solo negocio. Ahora lo dice el catálogo.
       *
       * Repetir donde no se puede **no se recorta en silencio**: se pregunta.
       * Quitar por su cuenta la segunda es decidir por el cliente cuál sobra.
       */
      const yaEstaba = seleccion.some((sel) => sel.opcionId === o.id);
      if (yaEstaba && !g.permiteRepeticion) {
        dudas.push({
          campo: g.nombre.toLowerCase(),
          porque: `${o.nombre} ya estaba elegida y ${g.nombre.toLowerCase()} no admite repetir`,
          preguntar: `${o.nombre} ya está en tu ${g.nombre.toLowerCase()}. ¿Querías otra distinta?`,
        });
        continue;
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

  // --- Grupos que el cliente rechazó explícitamente -----------------------
  //
  // Solo tiene sentido declinar un grupo OPCIONAL: uno obligatorio hay que
  // elegirlo sí o sí, y si el modelo propone declinar uno (nunca debería,
  // pero no se rechaza el turno por eso) se ignora en silencio — el grupo
  // sigue pendiente y `faltaDelItem` lo va a seguir pidiendo, que es lo
  // correcto.
  const gruposDeclinados: { grupoId: string; grupoNombre: string }[] = [];
  if (producto) {
    for (const nombreDeclinado of propuesto.gruposDeclinados ?? []) {
      const cruda = nombreDeclinado?.trim();
      if (!cruda) continue;
      const grupo = producto.grupos.find((g) => llave(g.nombre) === llave(cruda));
      if (grupo && grupo.minimo < 1) {
        gruposDeclinados.push({ grupoId: grupo.id, grupoNombre: grupo.nombre });
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

  return {
    ofrecibleId: producto?.id ?? null,
    ofrecible: producto?.nombre ?? null,
    cantidad,
    seleccion,
    gruposDeclinados,
    totalCents,
  };
}

/**
 * Lo que le falta a UN ítem, con los nombres que puso el negocio.
 *
 * Sale del CATÁLOGO, no de una lista escrita a mano: un grupo con `minimo >= 1`
 * sin completar es algo que falta, se llame *salsas*, *tamaño* o *diseño de
 * uñas*.
 */
function faltaDelItem(item: ItemNormalizado, catalogo: ProductoDelCatalogo[]): string[] {
  const falta: string[] = [];
  const ofrecible = catalogo.find((p) => p.id === item.ofrecibleId);
  if (!ofrecible) return ["presentación"];
  for (const g of ofrecible.grupos) {
    if (g.opciones.length === 0 || g.minimo < 1) continue;
    const elegidas = item.seleccion.filter((s) => s.grupoId === g.id).length;
    if (elegidas < g.minimo) falta.push(g.nombre.toLowerCase());
  }
  return falta;
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
  unidadesPorProducto?: Record<string, number>,
  /**
   * Qué pide ESTE negocio para cerrar, en su orden. Sale de la ficha
   * (`requisitosDe`), nunca de una lista escrita aquí.
   */
  requisitos: Requisito[] = []
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

  /*
   * El tope NO recorta en silencio: se queda con los primeros y se declara como
   * duda. Tirar la mitad de un pedido sin decir nada es la peor forma de
   * respetar un límite — el cliente creería que va completo.
   */
  const propuestos = propuesto.items ?? [];
  const items = propuestos.slice(0, MAX_ITEMS).map((item) =>
    resolverItem(item, catalogo, porNombre, opcionesConocidas, correcciones, dudas, unidadesPorProducto)
  );
  if (propuestos.length > MAX_ITEMS) {
    dudas.push({
      campo: "items",
      porque: `el pedido trae ${propuestos.length} elementos y el máximo es ${MAX_ITEMS}`,
      preguntar: `Solo puedo tomar ${MAX_ITEMS} cosas en un mismo pedido. ¿Lo dividimos en dos?`,
    });
  }
  /*
   * Un pedido sin ningún ítem no es un pedido vacío: es alguien que todavía no
   * ha elegido. Se resuelve un ítem en blanco para que la pregunta salga igual
   * que siempre — «¿cuál presentación desea?» — en vez de un silencio.
   */
  if (items.length === 0) {
    items.push(
      resolverItem(
        { ofrecible: null, cantidad: null, opciones: [] },
        catalogo, porNombre, opcionesConocidas, correcciones, dudas, unidadesPorProducto
      )
    );
  }

  /*
   * El total del pedido: la suma de sus ítems.
   *
   * `null` en cuanto uno solo no se pueda calcular. **Medio total es peor que
   * ninguno**, porque parece bueno y se le dice al cliente.
   */
  const totalCents = items.some((i) => i.totalCents === null)
    ? null
    : items.reduce((suma, i) => suma + (i.totalCents ?? 0), 0);

  /*
   * --- Qué falta para poder despachar ------------------------------------
   *
   * Lo de cada ítem, y después los datos del cliente — que son **del pedido**,
   * no de cada línea: el nombre y el teléfono se piden una vez aunque lleve
   * cinco cosas. Los declara la ficha; ni este archivo ni ninguno del núcleo
   * sabe qué es un teléfono.
   */
  const faltaParaCerrar: string[] = [];
  for (const item of items) {
    for (const f of faltaDelItem(item, catalogo)) {
      // Con varios ítems se dice de cuál, o «salsas» dos veces no ayuda a nadie.
      faltaParaCerrar.push(items.length > 1 && item.ofrecible ? `${f} de ${item.ofrecible}` : f);
    }
  }
  for (const r of requisitos) {
    if (!r.obligatorio) continue;
    // La ETIQUETA, no el id: es lo que se le enseña a alguien, y `loQueFalta`
    // usa la misma. Dos formas de nombrar lo mismo es como empiezan los líos.
    if (!propuesto.datos?.[r.id]?.trim()) faltaParaCerrar.push(r.etiqueta);
  }

  return {
    faltaParaCerrar,
    estado: { items, totalCents },
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

