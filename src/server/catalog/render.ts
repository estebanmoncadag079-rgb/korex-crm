import type { ProductoDelCatalogo } from "./queries";

/**
 * El catálogo de pedidos, escrito para el prompt.
 *
 * El formato imita **deliberadamente** al que hoy escribe el negocio a mano en
 * su ficha (`🥨 Churrita — $10.000 (6 churros · 1 salsa)`), porque la Fase 1 no
 * pretende cambiar cómo se le habla al modelo: solo de dónde sale el dato. Si
 * además cambiara el formato, un fallo después no diría si fue por la tabla o
 * por el texto nuevo.
 */

function pesos(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 0 })}`;
}

export function renderCatalogoDePedidos(
  productos: ProductoDelCatalogo[]
): string {
  if (productos.length === 0) return "(sin productos cargados todavía)";

  const porCategoria = new Map<string, ProductoDelCatalogo[]>();
  for (const p of productos) {
    const cat = p.categoria?.trim() || "";
    const arr = porCategoria.get(cat) ?? [];
    arr.push(p);
    porCategoria.set(cat, arr);
  }

  const lineas: string[] = [];
  for (const [categoria, items] of porCategoria) {
    if (categoria) lineas.push(`*${categoria.toUpperCase()}*`);
    for (const p of items) {
      // Sin precio NO es gratis: se dice que hay que confirmarlo, para que el
      // agente pregunte en vez de regalarlo.
      const precio =
        p.precioCents === null
          ? "(precio a confirmar con el equipo)"
          : pesos(p.precioCents);
      // Cuántas opciones lleva ESTE producto va pegado a él, no en el bloque
      // común: la Churrita lleva 1 salsa y el Mega Box 5, y perder ese número
      // es tomar el pedido mal. (Lo tenía el texto viejo como "· 1 salsa".)
      //
      // Un grupo OPCIONAL (mínimo 0, ej. toppings) también va aquí, no solo
      // los obligatorios: omitirlo dejaba al producto sin ninguna marca de
      // que ese grupo existiera para ÉL — el agente solo veía la lista de
      // opciones en el bloque común, sin saber a cuál de sus productos
      // pertenecía, y tenía que adivinar (incidente real: dijo que los
      // toppings solo aplicaban a una de dos presentaciones que sí los tenían
      // ambas).
      const cuantas = p.grupos
        .filter((g) => g.opciones.length > 0)
        .map((g) => {
          // "N opciones de {nombre}" en vez de pluralizar el nombre a mano:
          // el negocio lo escribe libre ("Topping" o "Toppings", "Salsa" o
          // "Salsas") y agregarle una "s" a ciegas duplicaba el plural
          // cuando ya venía en plural ("toppingss").
          const nombre = g.nombre.toLowerCase();
          const cantidad = g.maximo === 1 ? `1 ${nombre}` : `${g.maximo} opciones de ${nombre}`;
          return g.minimo >= 1 ? `elige ${cantidad}` : `opcional: hasta ${cantidad}`;
        })
        .join(", ");
      const partes = [p.descripcion?.trim(), cuantas].filter(Boolean);
      const desc = partes.length ? ` (${partes.join(" · ")})` : "";
      lineas.push(`${p.nombre} — ${precio}${desc}`);
    }
    lineas.push("");
  }

  // Las opciones van en su propio bloque, no pegadas a cada producto: es lo que
  // el negocio pregunta en un segundo mensaje, y mezclarlas con la carta hace
  // que el agente las suelte todas de golpe en el primero.
  //
  // Cada bloque dice a qué producto(s) pertenece. Sin esto, dos grupos con el
  // MISMO nombre y las MISMAS opciones se fundían en un solo bloque flotante
  // —correcto, porque de verdad son la misma lista para los dos— pero un
  // grupo que solo existe en UN producto quedaba igual de flotante, sin nada
  // que diga que es solo de ese: el agente no tenía cómo distinguir "esto
  // aplica a todos mis productos" de "esto es solo de uno", y tenía que
  // adivinar cuál.
  const bloques = new Map<
    string,
    { nombre: string; obligatorio: boolean; opciones: string; productos: string[] }
  >();
  for (const p of productos) {
    for (const g of p.grupos) {
      if (g.opciones.length === 0) continue;
      const clave = `${g.nombre}::${g.opciones.map((o) => o.nombre).join("|")}`;
      const existente = bloques.get(clave);
      if (existente) {
        existente.productos.push(p.nombre);
        continue;
      }
      const opciones = g.opciones
        .map((o) =>
          o.precioExtraCents > 0
            ? `${o.nombre} ${pesos(o.precioExtraCents)}`
            : o.nombre
        )
        .join(" · ");
      // Aquí NO va el "elige N": ese número es de cada producto y ya está
      // escrito arriba, junto a él. Aquí solo la lista de lo que hay.
      bloques.set(clave, {
        nombre: g.nombre,
        obligatorio: g.minimo >= 1,
        opciones,
        productos: [p.nombre],
      });
    }
  }

  if (bloques.size) {
    lineas.push("**Opciones que elige el cliente:**");
    for (const b of bloques.values()) {
      const etiqueta = b.obligatorio ? "" : " (opcional)";
      lineas.push(
        `${b.nombre.toUpperCase()}${etiqueta} — aplica a: ${b.productos.join(", ")}: ${b.opciones}`
      );
    }
  }

  return lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
