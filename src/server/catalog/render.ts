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
      const cuantas = p.grupos
        .filter((g) => g.minimo >= 1 && g.opciones.length > 0)
        .map((g) =>
          g.maximo > 1
            ? `elige ${g.maximo} ${g.nombre.toLowerCase()}s`
            : `elige ${g.maximo} ${g.nombre.toLowerCase()}`
        )
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
  const bloquesDeOpciones: string[] = [];
  const vistos = new Set<string>();
  for (const p of productos) {
    for (const g of p.grupos) {
      if (g.opciones.length === 0) continue;
      const clave = `${g.nombre}::${g.opciones.map((o) => o.nombre).join("|")}`;
      if (vistos.has(clave)) continue; // no repetir el mismo grupo por producto
      vistos.add(clave);
      const opciones = g.opciones
        .map((o) =>
          o.precioExtraCents > 0
            ? `${o.nombre} ${pesos(o.precioExtraCents)}`
            : o.nombre
        )
        .join(" · ");
      // Aquí NO va el "elige N": ese número es de cada producto y ya está
      // escrito arriba, junto a él. Aquí solo la lista de lo que hay.
      const obligatorio = g.minimo >= 1 ? "" : " (opcional)";
      bloquesDeOpciones.push(
        `${g.nombre.toUpperCase()}${obligatorio}: ${opciones}`
      );
    }
  }

  if (bloquesDeOpciones.length) {
    lineas.push("**Opciones que elige el cliente:**");
    lineas.push(...bloquesDeOpciones);
  }

  return lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
