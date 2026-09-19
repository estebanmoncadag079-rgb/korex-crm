import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 6 (imágenes de productos del catálogo) — `guardarMediaAsset` gana un
 * segundo criterio de "es la misma foto, reemplázala": antes solo miraba
 * `etiqueta`; ahora, cuando la llamada trae `productId`, primero busca por
 * ESE vínculo (más preciso y duradero) y solo si no hay nada cae a
 * `etiqueta` (para poder reclamar un recurso ya subido por el camino viejo
 * con el mismo nombre que el producto, sin duplicar la fila).
 */

type FilaCandidata = {
  id: string;
  etiqueta: string;
  kind: "producto" | "carta" | "otro";
  productId: string | null;
};
// Las fixtures traen las MISMAS columnas que el SELECT real
// (`id, etiqueta, kind, product_id`): si aquí faltara alguna, el test pasaría
// verde probando una decisión que en producción se toma con otros datos.
const selectResult: FilaCandidata[][] = [];
const insertValues = vi.fn();
const updateSet = vi.fn();
const updateWhereArg = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectResult.shift() ?? []),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        updateSet(v);
        return {
          where: (w: unknown) => {
            updateWhereArg(w);
            return Promise.resolve();
          },
        };
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

vi.mock("@/lib/db/ids", () => ({ newId: () => "media_nuevo" }));

beforeEach(() => {
  selectResult.length = 0;
  insertValues.mockReset();
  updateSet.mockReset();
  updateWhereArg.mockReset();
});

describe("guardarMediaAsset: prioridad de coincidencia con productId", () => {
  it("con productId y una fila YA vinculada a ese producto -> actualiza esa fila (no crea otra)", async () => {
    selectResult.push([
      { id: "media_existente", etiqueta: "Amor y Amistad", kind: "producto", productId: "p_amor" },
    ]);
    const { guardarMediaAsset } = await import("@/server/media/assets");

    const resultado = await guardarMediaAsset("org_1", {
      etiqueta: "Amor y Amistad",
      kind: "producto",
      base64: "QQ==",
      mimeType: "image/jpeg",
      productId: "p_amor",
    });

    expect(resultado).toEqual({ id: "media_existente", etiqueta: "Amor y Amistad", reemplazada: true });
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ productId: "p_amor" }));
  });

  it("con productId sin vínculo previo, pero YA existe una fila con esa etiqueta -> la reclama (actualiza, no duplica)", async () => {
    // La búsqueda es un solo SELECT con OR(productId, etiqueta); ninguna fila
    // tiene el productId todavía, pero una coincide por etiqueta.
    selectResult.push([
      { id: "media_por_etiqueta", etiqueta: "Amor y Amistad", kind: "producto", productId: null },
    ]);
    const { guardarMediaAsset } = await import("@/server/media/assets");

    const resultado = await guardarMediaAsset("org_1", {
      etiqueta: "Amor y Amistad",
      kind: "producto",
      base64: "QQ==",
      mimeType: "image/jpeg",
      productId: "p_amor",
    });

    expect(resultado.reemplazada).toBe(true);
    expect(resultado.id).toBe("media_por_etiqueta");
    // Al reclamarla, el UPDATE debe fijar el productId nuevo.
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ productId: "p_amor" }));
  });

  it("con productId y ninguna coincidencia -> crea una fila nueva con el productId", async () => {
    selectResult.push([]);
    const { guardarMediaAsset } = await import("@/server/media/assets");

    const resultado = await guardarMediaAsset("org_1", {
      etiqueta: "Combo Navidad",
      kind: "producto",
      base64: "QQ==",
      mimeType: "image/jpeg",
      productId: "p_navidad",
    });

    expect(resultado).toEqual({ id: "media_nuevo", etiqueta: "Combo Navidad", reemplazada: false });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: "media_nuevo", organizationId: "org_1", productId: "p_navidad" })
    );
  });

  it("sin productId (comportamiento histórico) -> sigue resolviendo solo por etiqueta", async () => {
    selectResult.push([
      { id: "media_vieja", etiqueta: "Carta completa", kind: "carta", productId: null },
    ]);
    const { guardarMediaAsset } = await import("@/server/media/assets");

    const resultado = await guardarMediaAsset("org_1", {
      etiqueta: "Carta completa",
      kind: "carta",
      base64: "QQ==",
      mimeType: "application/pdf",
    });

    expect(resultado).toEqual({ id: "media_vieja", etiqueta: "Carta completa", reemplazada: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ productId: null }));
  });
});

/**
 * Los dos huecos que dejó la Fase 6 y que encontró la auditoría independiente
 * del 19-sep-2026, los dos alrededor de la misma idea: la `etiqueta` es texto
 * que el negocio escribe a mano, así que NO es identidad suficiente para
 * decidir "esta fila es la misma, sobrescríbela".
 */
describe("guardarMediaAsset: el vínculo con el producto manda sobre el texto", () => {
  it("con AMBAS coincidencias a la vez (una por producto y otra por etiqueta) gana la del producto", async () => {
    // El caso real: el producto se llamaba "Amor y Amistad", el negocio lo
    // renombró a "San Valentín", y por el camino alguien había subido a
    // Recursos otra imagen llamada "San Valentín". El SELECT devuelve las DOS
    // (OR de productId y etiqueta) y hay que elegir bien: sobrescribir la de
    // la etiqueta dejaría al producto con su imagen vieja y destruiría la otra.
    //
    // La fila por etiqueta va PRIMERO a propósito: si la elección dependiera
    // del orden que devuelve Postgres (que no está garantizado), este test lo
    // caza.
    selectResult.push([
      { id: "media_otra", etiqueta: "San Valentín", kind: "producto", productId: null },
      { id: "media_del_producto", etiqueta: "Amor y Amistad", kind: "producto", productId: "p_amor" },
    ]);
    const { guardarMediaAsset } = await import("@/server/media/assets");

    const resultado = await guardarMediaAsset("org_1", {
      etiqueta: "San Valentín",
      kind: "producto",
      base64: "QQ==",
      mimeType: "image/jpeg",
      productId: "p_amor",
    });

    expect(resultado.id).toBe("media_del_producto");
    expect(resultado.reemplazada).toBe(true);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("NO se apropia de un recurso que se llama igual pero no es de un producto", async () => {
    // La carta del negocio se llama "Carta completa" y resulta que hay un
    // producto con ese mismo nombre. Antes, subirle imagen al producto
    // convertía la carta en esa imagen: mismo id, `kind` pisado a `producto`,
    // el PDF reemplazado por un JPG. Sin aviso y sin vuelta atrás.
    selectResult.push([
      { id: "media_carta", etiqueta: "Carta completa", kind: "carta", productId: null },
    ]);
    const { guardarMediaAsset, MediaAssetError } = await import("@/server/media/assets");

    await expect(
      guardarMediaAsset("org_1", {
        etiqueta: "Carta completa",
        kind: "producto",
        base64: "QQ==",
        mimeType: "image/jpeg",
        productId: "p_carta",
      })
    ).rejects.toBeInstanceOf(MediaAssetError);

    // Ni la pisa ni intenta insertar otra con la misma etiqueta (que chocaría
    // contra `media_org_etiqueta_uq` con un error de base crudo).
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("NO le roba la imagen a otro producto que se llama igual", async () => {
    // `product` no tiene índice único sobre (organization_id, name): dos
    // productos PUEDEN llamarse igual. Antes, subirle imagen al segundo se
    // llevaba la del primero —mismo id, `product_id` reapuntado— y el primero
    // se quedaba sin ninguna, sin que nadie se enterara.
    selectResult.push([
      { id: "media_del_otro", etiqueta: "Combo", kind: "producto", productId: "p_combo_viejo" },
    ]);
    const { guardarMediaAsset, MediaAssetError } = await import("@/server/media/assets");

    await expect(
      guardarMediaAsset("org_1", {
        etiqueta: "Combo",
        kind: "producto",
        base64: "QQ==",
        mimeType: "image/jpeg",
        productId: "p_combo_nuevo",
      })
    ).rejects.toBeInstanceOf(MediaAssetError);

    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("una foto de producto HUÉRFANA que se llama igual SÍ se puede reclamar (es el caso que la reclamación existe para cubrir)", async () => {
    selectResult.push([
      { id: "media_onboarding", etiqueta: "Churros", kind: "producto", productId: null },
    ]);
    const { guardarMediaAsset } = await import("@/server/media/assets");

    const resultado = await guardarMediaAsset("org_1", {
      etiqueta: "Churros",
      kind: "producto",
      base64: "QQ==",
      mimeType: "image/jpeg",
      productId: "p_churros",
    });

    expect(resultado.id).toBe("media_onboarding");
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ productId: "p_churros" }));
  });
});

/**
 * La comprobación que no existía y por la que se podía destruir un recurso
 * que una plantilla aprobada estaba usando. Los dos SELECT salen en el mismo
 * `Promise.all`, en este orden: campañas, luego plantillas.
 */
describe("referenciasAMediaAsset: quién más está usando este recurso", () => {
  it("sin campañas ni plantillas que lo usen -> vacío (se puede borrar tranquilo)", async () => {
    selectResult.push([], []);
    const { referenciasAMediaAsset } = await import("@/server/media/assets");
    expect(await referenciasAMediaAsset("org_1", "med_x")).toEqual([]);
  });

  it("junta las de las DOS tablas, cada una etiquetada con su tipo y su nombre real", async () => {
    selectResult.push(
      [{ id: "cmp_1", nombre: "Promo de febrero" } as unknown as FilaCandidata],
      [{ id: "tpl_1", nombre: "recordatorio_pedido" } as unknown as FilaCandidata]
    );
    const { referenciasAMediaAsset } = await import("@/server/media/assets");

    expect(await referenciasAMediaAsset("org_1", "med_x")).toEqual([
      { tipo: "campana", id: "cmp_1", nombre: "Promo de febrero" },
      { tipo: "plantilla", id: "tpl_1", nombre: "recordatorio_pedido" },
    ]);
  });

  it("una plantilla que lo usa como header basta para protegerlo, aunque ninguna campaña lo use", async () => {
    // Es el caso que peor fallaba: `template.components.header` es JSONB SIN
    // FK, así que la base no protege nada — borrar el asset deja la plantilla
    // aprobada sin poder enviarse.
    selectResult.push([], [{ id: "tpl_1", nombre: "promo_imagen" } as unknown as FilaCandidata]);
    const { referenciasAMediaAsset } = await import("@/server/media/assets");

    const referencias = await referenciasAMediaAsset("org_1", "med_x");
    expect(referencias).toHaveLength(1);
    expect(referencias[0]).toMatchObject({ tipo: "plantilla" });
  });
});

describe("desvincularMediaAssetDeProducto: suelta el recurso sin destruirlo", () => {
  it("pone product_id a NULL, lo demota a 'otro' y libera el nombre del producto", async () => {
    const { desvincularMediaAssetDeProducto } = await import("@/server/media/assets");

    const { etiqueta } = await desvincularMediaAssetDeProducto("org_1", "med_x", "Amor y Amistad");

    expect(updateSet).toHaveBeenCalledWith({
      productId: null,
      kind: "otro",
      etiqueta: "Amor y Amistad (sin producto · med_x)",
    });
    expect(etiqueta).toBe("Amor y Amistad (sin producto · med_x)");
  });

  it("el nombre nuevo lleva el id del recurso, así que desvincular dos imágenes del mismo nombre no colisiona", async () => {
    // `media_org_etiqueta_uq` es UNIQUE sobre (organization_id, etiqueta): un
    // sufijo con la fecha chocaría al desvincular dos veces el mismo día.
    const { desvincularMediaAssetDeProducto } = await import("@/server/media/assets");

    const a = await desvincularMediaAssetDeProducto("org_1", "med_a", "Combo");
    const b = await desvincularMediaAssetDeProducto("org_1", "med_b", "Combo");

    expect(a.etiqueta).not.toBe(b.etiqueta);
  });
});
