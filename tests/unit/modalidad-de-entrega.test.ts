import { describe, expect, it } from "vitest";
import {
  MODALIDAD_DOMICILIO,
  MODALIDAD_RECOGIDA,
  modalidadesDeEntrega,
  requisitosDe,
  type FichaDelNegocio,
  type Requisito,
} from "@/server/ai/generador/ficha";
import { normalizarModalidad } from "@/server/orders/normalizar";
import { validarPropuesta } from "@/server/orders/estado";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

/**
 * La dirección tal como la declaran las fichas reales tras el 20-ago-2026:
 * las DOS condiciones. `soloSi` mira la ficha (¿este negocio reparte?) y
 * `soloEnModalidades` mira el pedido (¿este va a domicilio?).
 */
const DIRECCION: Requisito = {
  id: "direccion",
  tipo: "direccion",
  etiqueta: "la dirección de entrega",
  obligatorio: true,
  soloSi: "entrega.haceDomicilios",
  soloEnModalidades: [MODALIDAD_DOMICILIO],
};
const NOMBRE: Requisito = {
  id: "nombre",
  tipo: "texto",
  etiqueta: "el nombre de quien lo pide",
  obligatorio: true,
};

function ficha(entrega: FichaDelNegocio["entrega"]): FichaDelNegocio {
  return {
    nombre: "Negocio de prueba",
    queVende: "Vende cosas.",
    ubicacion: "Una dirección",
    horario: { abre: "09:00", cierra: "18:00", dias: [1, 2, 3, 4, 5] },
    vertical: "pedidos",
    catalogo: "Algo — $10.000",
    entrega,
    cierre: { requisitos: [NOMBRE, DIRECCION] },
  } as FichaDelNegocio;
}

const AMBAS = ficha({ haceDomicilios: true, recogerEnLocal: "Sí, en la tienda" });
const SOLO_DOMICILIO = ficha({ haceDomicilios: true });
const SOLO_RECOGIDA = ficha({ haceDomicilios: false, recogerEnLocal: "Sí, en la tienda" });

const ids = (rs: Requisito[] | undefined) => (rs ?? []).map((r) => r.id);

describe("qué modalidades OFRECE el negocio (ficha)", () => {
  it("las deriva de lo que ya declara la ficha, sin campos nuevos", () => {
    expect(modalidadesDeEntrega(AMBAS)).toEqual([MODALIDAD_DOMICILIO, MODALIDAD_RECOGIDA]);
    expect(modalidadesDeEntrega(SOLO_DOMICILIO)).toEqual([MODALIDAD_DOMICILIO]);
    expect(modalidadesDeEntrega(SOLO_RECOGIDA)).toEqual([MODALIDAD_RECOGIDA]);
  });

  it("un negocio que no declara nada no ofrece ninguna", () => {
    expect(modalidadesDeEntrega(ficha({ haceDomicilios: false }))).toEqual([]);
  });
});

describe("qué modalidad ELIGIÓ el cliente (estado)", () => {
  it("resuelve la propuesta del modelo contra lo que el negocio ofrece", () => {
    const ofrecidas = modalidadesDeEntrega(AMBAS);
    expect(normalizarModalidad("domicilio", ofrecidas)).toBe(MODALIDAD_DOMICILIO);
    expect(normalizarModalidad("Recogida", ofrecidas)).toBe(MODALIDAD_RECOGIDA);
    // Tolerante en la forma, no en el contenido: sin tildes, sin plural, y
    // aceptando que la frase contenga el id.
    expect(normalizarModalidad("recogida en el local", ofrecidas)).toBe(MODALIDAD_RECOGIDA);
  });

  /** Caso D del encargo: una propuesta inválida no puede volverse verdad. */
  it("una modalidad que el negocio NO ofrece queda sin saber, nunca se inventa", () => {
    const ofrecidas = modalidadesDeEntrega(SOLO_RECOGIDA);
    expect(normalizarModalidad("domicilio", ofrecidas)).toBeNull();
    expect(normalizarModalidad("envío nacional", ofrecidas)).toBeNull();
    expect(normalizarModalidad("", ofrecidas)).toBeNull();
    expect(normalizarModalidad(null, ofrecidas)).toBeNull();
  });

  it("sin modalidades ofrecidas no resuelve nada", () => {
    expect(normalizarModalidad("domicilio", [])).toBeNull();
  });

  /**
   * El límite de la tolerancia, escrito a propósito.
   *
   * Una frase que no CONTIENE el id no se resuelve: "paso a recogerlo" no
   * lleva la palabra "recogida". Resolverla exigiría un diccionario de
   * sinónimos dentro del núcleo — vocabulario de negocio en el sitio donde
   * este proyecto lleva meses sacándolo.
   *
   * No es un agujero porque el fallo es hacia el lado seguro: sin resolver,
   * la modalidad queda sin saber y los requisitos se piden como siempre. Y en
   * la práctica no llega: el esquema estructurado le impone al modelo los
   * valores exactos que puede usar.
   */
  it("una frase que no contiene el id no se resuelve, y eso es lo seguro", () => {
    expect(normalizarModalidad("paso a recogerlo", modalidadesDeEntrega(AMBAS))).toBeNull();
  });
});

describe("los requisitos se resuelven con las dos mitades", () => {
  /** Caso A. */
  it("a domicilio: la dirección es obligatoria", () => {
    const rs = requisitosDe(AMBAS, { modalidadDeEntrega: MODALIDAD_DOMICILIO });
    expect(ids(rs)).toEqual(["nombre", "direccion"]);
  });

  /** Caso B — el que originó todo. */
  it("para recoger: la dirección DEJA de ser obligatoria", () => {
    const rs = requisitosDe(AMBAS, { modalidadDeEntrega: MODALIDAD_RECOGIDA });
    expect(ids(rs)).toEqual(["nombre"]);
  });

  /**
   * Caso C: el cliente cambia de idea. No hay estado que "recordar" — los
   * requisitos se recalculan enteros en cada turno desde la modalidad vigente,
   * así que el cambio funciona en los dos sentidos por construcción.
   */
  it("si cambia de domicilio a recogida y vuelve, los requisitos siguen el cambio", () => {
    expect(ids(requisitosDe(AMBAS, { modalidadDeEntrega: MODALIDAD_DOMICILIO }))).toContain("direccion");
    expect(ids(requisitosDe(AMBAS, { modalidadDeEntrega: MODALIDAD_RECOGIDA }))).not.toContain("direccion");
    expect(ids(requisitosDe(AMBAS, { modalidadDeEntrega: MODALIDAD_DOMICILIO }))).toContain("direccion");
  });

  /**
   * 🔴 La regla conservadora, y la razón de que exista.
   *
   * Si al no saber la modalidad se dejara de pedir la dirección, bastaría con
   * que el modelo propusiera una modalidad inexistente —normalizada a `null`—
   * para cerrar un pedido a domicilio sin dirección. "No se sabe" no es "no
   * hace falta".
   */
  it("mientras no se sepa la modalidad, la dirección se sigue pidiendo", () => {
    expect(ids(requisitosDe(AMBAS, { modalidadDeEntrega: null }))).toContain("direccion");
    expect(ids(requisitosDe(AMBAS))).toContain("direccion");
  });

  /** Caso F. */
  it("un negocio que solo reparte sigue exigiendo dirección", () => {
    expect(ids(requisitosDe(SOLO_DOMICILIO, { modalidadDeEntrega: MODALIDAD_DOMICILIO }))).toContain("direccion");
    expect(ids(requisitosDe(SOLO_DOMICILIO))).toContain("direccion");
  });

  /** Caso G: nadie empieza a pedir dirección por culpa de este cambio. */
  it("un negocio que NO reparte nunca pide dirección, elija lo que elija el cliente", () => {
    expect(ids(requisitosDe(SOLO_RECOGIDA, { modalidadDeEntrega: MODALIDAD_RECOGIDA }))).toEqual(["nombre"]);
    expect(ids(requisitosDe(SOLO_RECOGIDA, { modalidadDeEntrega: MODALIDAD_DOMICILIO }))).toEqual(["nombre"]);
    expect(ids(requisitosDe(SOLO_RECOGIDA))).toEqual(["nombre"]);
  });
});

describe("el estado del pedido guarda la modalidad, no la esconde en la dirección", () => {
  const CATALOGO: ProductoDelCatalogo[] = [
    { id: "prod_1", nombre: "Torta", categoria: null, precioCents: 1000000, descripcion: null, grupos: [] },
  ];
  const propuesta = (modalidad: string | null) => ({
    items: [{ ofrecible: "Torta", cantidad: 1, opciones: [] }],
    datos: { nombre: "Ana", telefono: "3001234567" },
    modalidadDeEntrega: modalidad,
    paso: "datos",
    confirmado: false,
  });

  it("guarda la modalidad ya resuelta en su propio campo", () => {
    // El contrato de extracción le da al modelo los valores exactos que puede
    // usar (y el esquema estructurado se los impone), así que lo que llega es
    // uno de ellos, no una frase libre.
    const v = validarPropuesta(
      propuesta("Recogida en el local"),
      CATALOGO,
      undefined,
      [NOMBRE],
      modalidadesDeEntrega(AMBAS)
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.estado.modalidadDeEntrega).toBe(MODALIDAD_RECOGIDA);
    // Lo que originó la auditoría: la dirección es una dirección, y nada más.
    expect(v.estado.datos.direccion).toBeUndefined();
  });

  it("una modalidad que el negocio no ofrece no llega al estado", () => {
    const v = validarPropuesta(
      propuesta("envío nacional"),
      CATALOGO,
      undefined,
      [NOMBRE],
      modalidadesDeEntrega(AMBAS)
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.estado.modalidadDeEntrega).toBeNull();
  });

  /** Caso E: compatibilidad, la razón de no subir `SCHEMA_VERSION`. */
  it("una propuesta sin modalidad sigue siendo válida, como antes de que existiera", () => {
    const sinModalidad = { ...propuesta(null) };
    delete (sinModalidad as { modalidadDeEntrega?: unknown }).modalidadDeEntrega;
    const v = validarPropuesta(sinModalidad, CATALOGO, undefined, [NOMBRE], modalidadesDeEntrega(AMBAS));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.estado.modalidadDeEntrega).toBeNull();
  });
});
