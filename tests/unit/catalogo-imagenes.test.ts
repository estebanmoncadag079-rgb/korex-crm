import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 6/15 (imágenes de productos del catálogo) — la capa que ve
 * `/catalogo`: confirma que un producto de OTRA organización nunca es
 * visible ni editable desde aquí, y que subir una imagen usa el nombre
 * real del producto como etiqueta (nunca uno que escriba el operador).
 */

// Cada función bajo prueba hace UN solo SELECT — una cola compartida basta,
// sin necesidad de distinguir de qué tabla (`producto`/`media`).
const selectQueue: unknown[][] = [];
const guardarMediaAssetMock = vi.fn();
const eliminarMediaAssetMock = vi.fn();
const referenciasMock = vi.fn();
const desvincularMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectQueue.shift() ?? []),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

vi.mock("@/server/media/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/media/assets")>();
  return {
    ...real,
    guardarMediaAsset: (...a: unknown[]) => guardarMediaAssetMock(...a),
    eliminarMediaAsset: (...a: unknown[]) => eliminarMediaAssetMock(...a),
    referenciasAMediaAsset: (...a: unknown[]) => referenciasMock(...a),
    desvincularMediaAssetDeProducto: (...a: unknown[]) => desvincularMock(...a),
  };
});

beforeEach(() => {
  selectQueue.length = 0;
  guardarMediaAssetMock.mockReset();
  eliminarMediaAssetMock.mockReset();
  referenciasMock.mockReset();
  referenciasMock.mockResolvedValue([]);
  desvincularMock.mockReset();
  desvincularMock.mockResolvedValue({ etiqueta: "irrelevante" });
});

describe("guardarImagenDeProducto: aislamiento multi-tenant", () => {
  it("producto que no existe en ESTA organización -> producto_no_encontrado, nunca llama a guardarMediaAsset", async () => {
    selectQueue.push([]); // scoped() no encontró nada: no existe, o es de otra org
    const { guardarImagenDeProducto } = await import("@/server/catalog/imagenes");

    const resultado = await guardarImagenDeProducto(
      "org_A",
      "p_de_otra_org",
      { base64: "QQ==", mimeType: "image/jpeg" },
      "user:1"
    );

    expect(resultado).toEqual({ ok: false, motivo: "producto_no_encontrado" });
    expect(guardarMediaAssetMock).not.toHaveBeenCalled();
  });

  it("producto real de esta organización -> usa SU nombre como etiqueta y su id como productId", async () => {
    selectQueue.push([{ nombre: "Amor y Amistad" }]);
    guardarMediaAssetMock.mockResolvedValue({ id: "media_1", etiqueta: "Amor y Amistad", reemplazada: false });
    const { guardarImagenDeProducto } = await import("@/server/catalog/imagenes");

    const resultado = await guardarImagenDeProducto(
      "org_A",
      "p_amor",
      { base64: "QQ==", mimeType: "image/jpeg" },
      "user:1"
    );

    expect(resultado).toEqual({ ok: true, id: "media_1" });
    expect(guardarMediaAssetMock).toHaveBeenCalledWith(
      "org_A",
      expect.objectContaining({ etiqueta: "Amor y Amistad", productId: "p_amor", kind: "producto" })
    );
  });
});

describe("obtenerImagenDeProducto / eliminarImagenDeProducto", () => {
  it("sin imagen vinculada -> null, no inventa nada", async () => {
    selectQueue.push([]);
    const { obtenerImagenDeProducto } = await import("@/server/catalog/imagenes");
    expect(await obtenerImagenDeProducto("org_A", "p_sin_foto")).toBeNull();
  });

  it("eliminar cuando no hay imagen vinculada no lanza y no llama a eliminarMediaAsset", async () => {
    selectQueue.push([]);
    const { eliminarImagenDeProducto } = await import("@/server/catalog/imagenes");
    expect(await eliminarImagenDeProducto("org_A", "p_sin_foto")).toEqual({ accion: "sin_imagen" });
    expect(eliminarMediaAssetMock).not.toHaveBeenCalled();
    expect(desvincularMock).not.toHaveBeenCalled();
    // Ni siquiera pregunta por referencias: no hay nada que proteger.
    expect(referenciasMock).not.toHaveBeenCalled();
  });

  it("eliminar cuando SÍ hay imagen vinculada y NADIE más la usa la borra de verdad", async () => {
    selectQueue.push([{ id: "media_a_borrar", etiqueta: "Amor y Amistad" }]);
    referenciasMock.mockResolvedValue([]);
    const { eliminarImagenDeProducto } = await import("@/server/catalog/imagenes");

    expect(await eliminarImagenDeProducto("org_A", "p_con_foto")).toEqual({ accion: "eliminada" });

    expect(eliminarMediaAssetMock).toHaveBeenCalledWith("org_A", "media_a_borrar");
    expect(desvincularMock).not.toHaveBeenCalled();
  });
});

/**
 * El defecto que encontró la auditoría independiente del 19-sep-2026:
 * `media_asset` es un recurso COMPARTIDO. La misma fila puede ser la imagen
 * de un producto y, a la vez, el header de una plantilla de WhatsApp ya
 * aprobada (`template.components.header`, JSONB SIN FK) o la imagen de una
 * campaña (`campaign.mediaAssetId`).
 *
 * Borrarla desde `/catalogo` dejaba esa plantilla sin poder enviarse —
 * `resolverAssetDeHeaderImagen` (`server/whatsapp/templates.ts:511`) devuelve
 * *"El asset de header no existe en esta organización"* en CADA envío— y sin
 * forma de recuperar el archivo: vive en la base, no hay copia en ningún otro
 * sitio. El negocio se enteraría cuando la campaña fallara.
 */
describe("eliminarImagenDeProducto: no destruye un recurso que alguien más usa", () => {
  it("si una CAMPAÑA la usa, la desvincula y la conserva (no la borra)", async () => {
    selectQueue.push([{ id: "media_compartida", etiqueta: "Amor y Amistad" }]);
    referenciasMock.mockResolvedValue([
      { tipo: "campana", id: "cmp_1", nombre: "Promo de febrero" },
    ]);
    const { eliminarImagenDeProducto } = await import("@/server/catalog/imagenes");

    const resultado = await eliminarImagenDeProducto("org_A", "p_amor");

    expect(resultado).toEqual({
      accion: "desvinculada",
      referencias: [{ tipo: "campana", id: "cmp_1", nombre: "Promo de febrero" }],
    });
    expect(eliminarMediaAssetMock).not.toHaveBeenCalled();
    // Con la etiqueta REAL de la fila: es lo que `desvincular` renombra para
    // liberar el nombre del producto (índice único `media_org_etiqueta_uq`).
    expect(desvincularMock).toHaveBeenCalledWith("org_A", "media_compartida", "Amor y Amistad");
  });

  it("si una PLANTILLA la usa como header, tampoco la borra", async () => {
    selectQueue.push([{ id: "media_compartida", etiqueta: "Amor y Amistad" }]);
    referenciasMock.mockResolvedValue([
      { tipo: "plantilla", id: "tpl_1", nombre: "recordatorio_pedido" },
    ]);
    const { eliminarImagenDeProducto } = await import("@/server/catalog/imagenes");

    const resultado = await eliminarImagenDeProducto("org_A", "p_amor");

    expect(resultado).toMatchObject({ accion: "desvinculada" });
    expect(eliminarMediaAssetMock).not.toHaveBeenCalled();
    expect(desvincularMock).toHaveBeenCalledTimes(1);
  });

  it("pregunta por las referencias de ESTA organización, nunca por id suelto", async () => {
    selectQueue.push([{ id: "media_x", etiqueta: "Churros" }]);
    const { eliminarImagenDeProducto } = await import("@/server/catalog/imagenes");

    await eliminarImagenDeProducto("org_A", "p_churros");

    expect(referenciasMock).toHaveBeenCalledWith("org_A", "media_x");
  });
});
