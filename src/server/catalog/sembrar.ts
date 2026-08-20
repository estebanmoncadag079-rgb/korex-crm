import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { leerFicha } from "@/server/ai/generador/leer-ficha";

/**
 * Pasar el catálogo de un negocio de pedidos del TEXTO de su ficha a las tablas.
 *
 * La fuente no es el prompt renderizado sino `ficha.catalogo` + `ficha.variantes`
 * (`agent_profile.ficha`), que ya están medio estructurados: una línea por
 * producto y las opciones aparte.
 *
 * ⚠️ **Esto NO escribe nada por su cuenta.** Devuelve lo que ha entendido para
 * que una persona lo revise antes. Es la lección de
 * `docs/korexia/32-CATALOGO-SALON.md`: en el catálogo del salón se colaron **12
 * precios equivocados** que nadie vio, y un precio mal en una tabla se repite en
 * cada conversación durante meses.
 */

export type ProductoLeido = {
  nombre: string;
  categoria: string | null;
  /** `null` = la línea no traía precio. NO es 0. */
  precioCents: number | null;
  descripcion: string | null;
};

export type GrupoLeido = {
  nombre: string;
  minimo: number;
  maximo: number;
  opciones: { nombre: string; precioExtraCents: number }[];
  /**
   * A qué producto aplica. `null` = a todos.
   *
   * No es un adorno: en La Churra **cada presentación lleva un número distinto
   * de salsas** (la Churrita 1, la Besties 2, el Family Box 3, el Mega Box 5).
   * Un grupo global no puede expresar eso, y decirle al cliente que elija 5
   * salsas en una Churrita es un pedido mal tomado.
   */
  producto: string | null;
  /**
   * Por qué hay que mirar este grupo antes de escribirlo. `undefined` = el texto
   * lo dejaba claro.
   *
   * Existe porque **este lector no puede saberlo todo, y fingir que sí sale
   * caro**. De `RECUBIERTO: Azúcar-canela · Azúcar sola · Ambas · Sin azúcar` no
   * se deduce por ninguna parte que se elija UNO: eso lo sabe quien conoce el
   * negocio, no un programa.
   *
   * Hasta el 17-ago-2026 se adivinaba con una lista de palabras
   * —`recubiert|azucar|cobertura`, `adicion|extra`— dentro del núcleo. Acertaba
   * con un negocio de comida por casualidad de vocabulario y decidía a ciegas
   * para todos los demás: un taller que escribiera *"Cobertura del seguro"*
   * recibía un grupo de máximo 1 sin haberlo pedido.
   */
  revisar?: string;
};

export type CatalogoLeido = {
  productos: ProductoLeido[];
  grupos: GrupoLeido[];
  /** Líneas que no se supieron interpretar. Se enseñan para no perderlas. */
  sinInterpretar: string[];
};

/** "$10.000" / "10.000" / "10000" → 1000000 (centavos). `null` si no hay. */
function precioACents(texto: string): number | null {
  const m = texto.match(/\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/);
  if (!m) return null;
  const limpio = m[1]!.replace(/[.,]/g, "");
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * 100;
}

/**
 * Lee el catálogo escrito a mano.
 *
 * Formatos que entiende (los que usan los clientes de hoy):
 *   `🥨 Churrita — $10.000 (6 churros · 1 salsa)`
 *   `Cremoso 7 oz — $12.000`
 *   `*CREMOSOS*` / `CREMOSOS:`  → categoría
 * Y para las opciones (de `variantes`):
 *   `SALSAS: 🍯 AREQUIPE · 🍫 CHOCOLATE`
 *   `ADICIONES (opcionales…): 🍫 Salsa $2.000 · 💧 Agua $2.000`
 */

/**
 * Deja el nombre de una opción limpio: sin emoji, sin precio y sin la frase que
 * a veces viene pegada al último elemento de la línea.
 *
 * El texto real de La Churra acaba así:
 *
 *   `… · 🤍 CHOCOLATE BLANCO. Cada presentación incluye un número de salsas: …`
 *
 * Sin cortar por ahí, la última salsa se llamaría "CHOCOLATE BLANCO. Cada
 * presentación incluye…" y el agente se la ofrecería al cliente tal cual.
 */
function limpiarOpcion(crudo: string): string {
  return crudo
    // La frase explicativa que sigue a un punto y espacio.
    .split(/\.\s+\p{L}/u)[0]!
    .replace(/\$?\s*\d[\d.,]*/g, "") // precio
    .replace(/^[^\p{L}\d]+/u, "") // emojis y viñetas del principio
    .replace(/[.,;]+$/, "") // el punto final de la línea
    .trim();
}

/**
 * Cuántas opciones declara el encabezado que se pueden elegir. `null` = no lo dice.
 *
 * Lee lo que el negocio escribió entre paréntesis: `(elige 1)`, `(máximo 2)`,
 * `(hasta 3)`, `(1)`. **Un número, no una palabra del sector** — así vale igual
 * para un salón, un taller o una papelería.
 *
 * Se ignoran los paréntesis sin número, que son los que explican otra cosa:
 * `(opcionales, se cobran aparte)`, `(los nombres van en MAYÚSCULAS)`.
 */
function cuantasDeclara(encabezado: string): number | null {
  for (const parentesis of encabezado.match(/\([^)]*\)/g) ?? []) {
    // Un precio no dice cuántas se eligen: "(desde $2.000)" no es "2.000 salsas".
    if (/\$|\d[.,]\d{3}/.test(parentesis)) continue;
    const n = parentesis.match(/\b(\d+)\b/);
    if (n) {
      const valor = Number(n[1]);
      if (valor > 0) return valor;
    }
  }
  return null;
}

export function leerCatalogoDeTexto(
  catalogo: string,
  variantes?: string
): CatalogoLeido {
  const productos: ProductoLeido[] = [];
  const sinInterpretar: string[] = [];
  let categoriaActual: string | null = null;

  for (const cruda of (catalogo ?? "").split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;

    // Cabecera de categoría: *CREMOSOS*, **CREMOSOS**, CREMOSOS:, 🥤 *CREMOSOS*
    // (el emoji delante es habitual — no debe impedir reconocer la cabecera).
    const cat =
      linea.match(/^[^\p{L}\d*]*\*{1,2}\s*([^*]+?)\s*\*{1,2}$/u) ??
      linea.match(/^([A-ZÁÉÍÓÚÑ\s]{3,}):$/);
    if (cat && !/\d/.test(linea)) {
      categoriaActual = cat[1]!.trim();
      continue;
    }

    /*
     * Una lista de opciones colada en el bloque de productos.
     *
     * Se reconoce por la FORMA, no por la palabra: `ENCABEZADO: a · b · c`, con
     * varios elementos separados. Un producto es una línea suelta con su
     * precio; esto es un grupo de opciones que el negocio escribió aquí en vez
     * de en `variantes`. Va a `sinInterpretar` para que se vea y no se pierda.
     *
     * Antes esto era `/^adiciones?\s*:/`: la palabra de un negocio de comida
     * decidiendo por todos. Un salón que escriba `TONOS: rubio · castaño`
     * quedaba convertido en un producto llamado "TONOS".
     */
    if (/^[^:]{2,60}:\s*\S+\s*[·|]\s*\S+/.test(linea)) {
      sinInterpretar.push(linea);
      continue;
    }

    // El nombre es lo que va antes del guion largo o del precio; el precio se
    // busca SOLO después de ese punto de corte, nunca en el nombre.
    //
    // Antes se buscaba el precio en la línea entera, y el primer número que
    // apareciera ganaba — en "Cremoso 7 oz — $12.000" ese número era el "7"
    // de la onzada, no el precio real. Cortar primero y buscar después evita
    // que cualquier tamaño, talla o cantidad en el nombre del producto se
    // confunda con su precio.
    const partes = linea.split(/—|--|\s-\s|\$/);
    const nombre = partes[0]!
      .replace(/^[^\p{L}\d]+/u, "") // emojis y viñetas del principio
      .trim();
    const restoParaPrecio = linea.slice(partes[0]!.length);
    const precioCents = precioACents(restoParaPrecio || linea);

    if (!nombre) {
      sinInterpretar.push(linea);
      continue;
    }

    const desc = linea.match(/\(([^)]+)\)/);
    productos.push({
      nombre,
      categoria: categoriaActual,
      precioCents,
      descripcion: desc ? desc[1]!.trim() : null,
    });
  }

  const grupos: GrupoLeido[] = [];
  for (const cruda of (variantes ?? "").split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;

    /*
     * Formato "por producto", el que usa La Churra de verdad:
     *   `CHURRITA — $10.000-1 salsa a eleccion entre chocolate,arequipe,lechera`
     * De ahí salen tres cosas: a qué producto aplica, CUÁNTAS puede elegir, y
     * la lista. El número importa: cada presentación trae distinta cantidad.
     */
    const porProducto = linea.match(
      /^(.+?)\s*[—-]\s*\$?[\d.,]*\s*[-–]\s*(\d+)\s+([\p{L}\s]+?)\s+a\s+elecci[oó]n\s+entre\s+(.+)$/iu
    );
    if (porProducto) {
      const nombreProducto = porProducto[1]!.replace(/^[^\p{L}\d]+/u, "").trim();
      const cuantas = Number(porProducto[2]);
      const tipo = porProducto[3]!.trim();
      const opciones = porProducto[4]!
        .split(/[,·|]/)
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => ({ nombre: o, precioExtraCents: 0 }));
      if (opciones.length) {
        grupos.push({
          // "1 salsa" → "SALSA"; "2 salsas" → "SALSAS". Se normaliza en plural
          // solo para el rótulo; lo que manda es `maximo`.
          nombre: tipo.toUpperCase(),
          minimo: cuantas,
          maximo: cuantas,
          opciones,
          producto: nombreProducto,
        });
      }
      continue;
    }

    const m = linea.match(/^([^:]{2,60}):\s*(.+)$/);
    if (!m) {
      sinInterpretar.push(linea);
      continue;
    }
    const encabezado = m[1]!.trim();
    const opcional = /opcional/i.test(encabezado);
    const nombre = encabezado
      .replace(/\([^)]*\)/g, "")
      .replace(/[^\p{L}\s]/gu, "")
      .trim();
    /*
     * Se corta la frase explicativa ANTES de partir por separadores.
     *
     * La línea real de La Churra es:
     *   `SALSAS: … · 🤍 CHOCOLATE BLANCO. Cada presentación incluye un número
     *    de salsas: la Churrita 1, la Besties 2, el Family Box 3 y el Mega Box 5.`
     *
     * Esa frase lleva COMAS, así que si se corta después del split ya se ha
     * convertido en tres salsas fantasma ("la Churrita 1", "la Besties 2"…).
     * El punto final de la línea no parte nada porque no lleva letra detrás.
     */
    const lista = m[2]!.split(/\.\s+\p{L}/u)[0]!;
    const opciones = lista
      .split(/·|\||,(?![^(]*\))/)
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => ({
        nombre: limpiarOpcion(o),
        precioExtraCents: precioACents(o) ?? 0,
      }))
      .filter((o) => o.nombre);

    if (opciones.length) {
      /*
       * CUÁNTAS puede elegir el cliente, que no siempre es "todas".
       *
       * Solo hay dos fuentes legítimas, y las dos son del negocio:
       *   — el número que escriba: "RECUBIERTO (elige 1)", "SALSAS (máximo 2)"
       *   — la palabra "opcional", que dice que se puede no llevar ninguna
       *
       * Lo que NO se hace es deducirlo del nombre del grupo. Cuando el texto no
       * lo dice, **el máximo queda en «todas» y el grupo sale marcado para que
       * lo mire una persona** — que es para lo que existe este lector.
       */
      const declaradas = cuantasDeclara(encabezado);

      grupos.push({
        nombre,
        minimo: opcional ? 0 : Math.min(1, declaradas ?? 1),
        maximo: declaradas ?? opciones.length,
        opciones,
        producto: null, // formato "SALSAS: a · b · c" = aplica a todo
        revisar:
          declaradas === null && opciones.length > 1
            ? `no dice cuántas se eligen: queda en ${opciones.length} (todas)`
            : undefined,
      });
    }
  }

  return { productos, grupos, sinInterpretar };
}

/**
 * Escribe en las tablas lo que una persona ya revisó.
 *
 * Reemplaza el catálogo entero de esa organización dentro de una transacción:
 * sembrar dos veces no duplica. **No toca `catalog_source`** — encender la
 * bandera es un acto aparte y deliberado, después de mirar el resultado.
 */
export async function escribirCatalogo(
  organizationId: string,
  leido: CatalogoLeido
): Promise<{ productos: number; grupos: number; opciones: number }> {
  const db = getDb();
  let nGrupos = 0;
  let nOpciones = 0;

  // Un borrado masivo deja rastro: cuántas filas desaparecen y por orden de
  // quién. Sin esto, re-sembrar el catálogo es invisible en el log.
  const antes = await db
    .select({ id: schema.product.id })
    .from(schema.product)
    .where(scoped(schema.product.organizationId, organizationId));
  if (antes.length > 0) {
    console.log(
      `[cambio] tabla=product registro=${organizationId} campo=<catálogo completo> ` +
        `valor_anterior=<${antes.length} productos> valor_nuevo=<${leido.productos.length} productos> ` +
        `proceso=escribirCatalogo actor=script:migrar-catalogo timestamp=${new Date().toISOString()}`
    );
  }

  await db.transaction(async (tx) => {
    // Los hijos caen por ON DELETE CASCADE de la FK compuesta.
    await tx
      .delete(schema.product)
      .where(scoped(schema.product.organizationId, organizationId));

    for (const [i, p] of leido.productos.entries()) {
      const productId = newId("product");
      await tx.insert(schema.product).values({
        id: productId,
        organizationId,
        name: p.nombre,
        category: p.categoria,
        priceCents: p.precioCents,
        description: p.descripcion,
        position: i,
      });
    }

    // Un grupo con `producto` va SOLO a ese producto (la Churrita lleva 1 salsa
    // y el Mega Box 5); uno con `producto: null` va a todos (las adiciones se
    // pueden pedir con cualquier presentación).
    const productos = await tx
      .select({ id: schema.product.id, name: schema.product.name })
      .from(schema.product)
      .where(scoped(schema.product.organizationId, organizationId));

    const normalizar = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim();

    for (const prod of productos) {
      const suyos = leido.grupos.filter(
        (g) => g.producto === null || normalizar(g.producto) === normalizar(prod.name)
      );
      for (const [gi, g] of suyos.entries()) {
        const groupId = newId("productOptionGroup");
        await tx.insert(schema.productOptionGroup).values({
          id: groupId,
          organizationId,
          productId: prod.id,
          name: g.nombre,
          minSelect: g.minimo,
          maxSelect: g.maximo,
          position: gi,
        });
        nGrupos++;
        for (const [oi, o] of g.opciones.entries()) {
          await tx.insert(schema.productOption).values({
            id: newId("productOption"),
            organizationId,
            groupId,
            name: o.nombre,
            priceDeltaCents: o.precioExtraCents,
            position: oi,
          });
          nOpciones++;
        }
      }
    }
  });

  return { productos: leido.productos.length, grupos: nGrupos, opciones: nOpciones };
}

/** La ficha guardada de una organización, o `null` si su prompt es manual. */
export async function fichaDe(
  organizationId: string
): Promise<{ catalogo?: string; variantes?: string } | null> {
  const db = getDb();
  const filas = await db
    .select({ ficha: schema.agentProfile.ficha })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  // Lector tolerante: la ficha puede venir plana o por secciones, y aquí solo
  // interesan dos de sus campos. Ver `generador/leer-ficha.ts`.
  return leerFicha(filas[0]?.ficha) as { catalogo?: string; variantes?: string } | null;
}
