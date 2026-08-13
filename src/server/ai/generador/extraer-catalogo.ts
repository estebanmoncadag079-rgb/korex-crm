import { getEnv, isAiConfigured } from "@/lib/env";

/**
 * Sacar el catálogo de una foto de la carta, en vez de teclearlo producto a
 * producto.
 *
 * **Por qué existe**: el salón de lashes tiene más de 34 servicios. Pedirle al
 * dueño que los escriba uno por uno en un formulario es la mejor forma de que
 * abandone el alta a medias — o de que se equivoque. Ya pasó: el catálogo del
 * salón se cargó a mano y llegó con **12 precios equivocados** que nadie
 * detectó hasta que apareció el PDF oficial
 * ([32-CATALOGO-SALON.md](../../../docs/korexia/32-CATALOGO-SALON.md)).
 *
 * ⚠️ **Lo extraído NO se guarda directamente.** Se le enseña al cliente en una
 * tabla para que lo revise y corrija ANTES de escribir nada. Es la condición
 * que ya estaba escrita en los pendientes de escalabilidad, y viene justo de
 * aquel incidente: un catálogo cargado sin revisar es dinero equivocado
 * repetido en cada conversación durante meses.
 *
 * Reutiliza el mismo mecanismo de visión que ya lee los comprobantes de pago
 * (`transcribir.ts`): el modelo de producción admite imágenes.
 */

export type ProductoExtraido = {
  nombre: string;
  /** En pesos, tal cual aparece. `null` si en la carta no se lee un precio. */
  precio: number | null;
  /** Solo en catálogos de servicios que la traen. */
  duracionMin?: number | null;
  categoria?: string | null;
};

export type ResultadoExtraccion =
  | { ok: true; productos: ProductoExtraido[] }
  | { ok: false; motivo: "sin_ia" | "sin_texto" | "formato" | "error" };

const INSTRUCCION = [
  "Esta imagen es la carta, el menú o la lista de precios de un negocio.",
  "Extrae TODOS los productos o servicios que aparezcan, con su precio.",
  "",
  "Devuelve ÚNICAMENTE un array JSON, sin texto alrededor y sin ```:",
  '[{"nombre":"...","precio":12000,"duracionMin":null,"categoria":null}]',
  "",
  "Reglas:",
  "- `precio` es un NÚMERO entero en pesos, sin puntos ni símbolos: $12.000 → 12000.",
  "- Si de un producto no se lee el precio, pon null. NO lo inventes ni lo estimes.",
  "- `duracionMin` solo si la carta dice cuánto dura (90 min → 90). Si no, null.",
  "- `categoria` solo si la carta agrupa por secciones (Uñas, Pestañas…). Si no, null.",
  "- Copia los nombres TAL CUAL están escritos, sin corregirlos ni acortarlos.",
  "- No te saltes ninguno, aunque la lista sea larga.",
  "- Si la imagen no es una carta ni una lista de precios, devuelve [].",
].join("\n");

/** Quita el envoltorio ```json que algunos modelos añaden pese a pedirlo. */
function limpiar(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Lee una carta y devuelve sus productos.
 *
 * Nunca lanza: si algo falla, el cliente sigue pudiendo escribir el catálogo a
 * mano. Es una ayuda, no un requisito.
 */
export async function extraerCatalogoDeImagen(input: {
  /** La imagen en base64, sin el prefijo `data:`. */
  base64: string;
  mimeType: string;
}): Promise<ResultadoExtraccion> {
  if (!isAiConfigured()) return { ok: false, motivo: "sin_ia" };
  const env = getEnv();
  const modelo = env.OPENROUTER_MODEL;
  if (!modelo) return { ok: false, motivo: "sin_ia" };

  const mime = input.mimeType.split(";")[0]?.trim() || "image/jpeg";
  const dataUrl = `data:${mime};base64,${input.base64}`;

  return pedirCatalogo(modelo, [
    {
      role: "user",
      content: [
        { type: "text", text: INSTRUCCION },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ]);
}

/** La llamada al modelo y el parseo de su respuesta, común a foto y a texto. */
async function pedirCatalogo(
  modelo: string,
  messages: unknown[]
): Promise<ResultadoExtraccion> {
  const env = getEnv();
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelo,
        messages,
        // Temperatura 0: aquí no se quiere creatividad, se quiere el precio que
        // pone en la carta. Es el mismo criterio que en el resto del proyecto
        // para lo que se lee de un documento.
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.warn(`[catalogo] el proveedor respondió ${res.status}`);
      return { ok: false, motivo: "error" };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content;
    if (!raw?.trim()) return { ok: false, motivo: "sin_texto" };

    const datos: unknown = JSON.parse(limpiar(raw));
    if (!Array.isArray(datos)) return { ok: false, motivo: "formato" };

    const productos = datos
      .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
      .map((p) => ({
        nombre: String(p.nombre ?? "").trim(),
        precio: typeof p.precio === "number" && p.precio > 0 ? p.precio : null,
        duracionMin:
          typeof p.duracionMin === "number" && p.duracionMin > 0
            ? p.duracionMin
            : null,
        categoria:
          typeof p.categoria === "string" && p.categoria.trim()
            ? p.categoria.trim()
            : null,
      }))
      // Un producto sin nombre no sirve para nada y ensucia la tabla de revisión.
      .filter((p) => p.nombre.length > 0);

    return { ok: true, productos };
  } catch (err) {
    console.warn("[catalogo] no se pudo leer la carta:", err);
    return { ok: false, motivo: "error" };
  }
}

/**
 * Lo mismo, pero a partir del TEXTO de un catálogo (el de un PDF).
 *
 * Existe porque un catálogo de verdad viene maquetado, no en lista. En el del
 * salón, el nombre del servicio, sus tres líneas de descripción y su precio
 * están en renglones distintos:
 *
 *     EFECTO NATURAL
 *     Realza tu mirada con un
 *     acabado suave, ligero y elegante.
 *     95.000$
 *
 * Leer eso línea a línea da 108 servicios inventados a partir de las
 * descripciones. El texto sale exacto del PDF —no hay OCR de por medio—, así
 * que lo único que falta es que alguien entienda la maquetación: eso lo hace el
 * modelo, y sale mucho más barato que mirar la imagen.
 */
export async function extraerCatalogoDeTexto(
  texto: string
): Promise<ResultadoExtraccion> {
  if (!isAiConfigured()) return { ok: false, motivo: "sin_ia" };
  const env = getEnv();
  const modelo = env.OPENROUTER_MODEL;
  if (!modelo) return { ok: false, motivo: "sin_ia" };
  if (!texto.trim()) return { ok: false, motivo: "sin_texto" };

  const instruccion = [
    "Este es el texto de la carta, el menú o la lista de precios de un negocio, extraído de un PDF.",
    "Viene maquetado: el nombre de cada producto, su descripción y su precio pueden estar en líneas distintas.",
    "",
    INSTRUCCION.split("\n").slice(2).join("\n"),
    "",
    "- La DESCRIPCIÓN de un producto no es un producto: no la conviertas en una fila.",
    "- Ignora encabezados, teléfonos, direcciones, redes sociales y textos de portada.",
    "",
    "TEXTO:",
    texto.slice(0, 20_000),
  ].join("\n");

  return pedirCatalogo(modelo, [{ role: "user", content: instruccion }]);
}

/**
 * Los productos, en el formato de texto que espera la ficha ("Nombre — $12.000").
 *
 * Se separa de la extracción para poder probarla sin llamar a ningún modelo.
 *
 * Cuando la carta trae **categorías**, se escriben como título en MAYÚSCULAS
 * sobre su grupo: es exactamente lo que `leerCatalogoPegado` vuelve a leer al
 * aplicar la ficha, así que la agrupación del catálogo del salón (Pestañas pelo
 * a pelo, Volumen tecnológico, Retoques…) sobrevive el viaje. Sin categorías la
 * salida es la de siempre, una línea por producto.
 */
export function catalogoATexto(productos: ProductoExtraido[]): string {
  const linea = (p: ProductoExtraido) => {
    const precio =
      p.precio === null ? "$ (falta el precio)" : `$${p.precio.toLocaleString("es-CO")}`;
    const duracion = p.duracionMin ? ` · ${p.duracionMin} min` : "";
    return `${p.nombre} — ${precio}${duracion}`;
  };

  if (!productos.some((p) => p.categoria?.trim())) {
    return productos.map(linea).join("\n");
  }

  // `Map` y no un objeto: conserva el orden en que aparecen en la carta, que es
  // el que el negocio eligió. Los que no traen categoría van al final, juntos.
  const grupos = new Map<string, ProductoExtraido[]>();
  for (const p of productos) {
    const clave = p.categoria?.trim() || "";
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }

  return [...grupos.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0))
    .map(([categoria, suyos]) => {
      const cuerpo = suyos.map(linea).join("\n");
      return categoria ? `${categoria.toUpperCase()}\n${cuerpo}` : cuerpo;
    })
    .join("\n\n");
}
