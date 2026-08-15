/**
 * La restricción obligatoria del paso 2, dictada por el dueño (15-ago-2026):
 *
 *   ficha original → convertir → reenviar cuestionario → prompt final = prompt anterior
 *
 * Y el cuestionario **nunca** puede modificar `flujo`, `politicas`, `enabled`
 * ni `appointmentsEnabled`.
 *
 * Estas pruebas no usan base de datos a propósito: comprueban la fusión y la
 * recompilación, que es donde vive la garantía. Los dos últimos campos ya no se
 * escriben en `aplicarFicha` (ver `verificar-migracion.ts` y su prueba).
 */
import { describe, expect, it } from "vitest";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";
import { generarPerfil } from "@/server/ai/generador/generar";
import {
  aSecciones,
  fusionarFicha,
  leerFicha,
  serializarComoEstaba,
} from "@/server/ai/generador/leer-ficha";

/** Una ficha de pedidos completa, como la de La Churra. */
const ORIGINAL = {
  nombre: "La Churra",
  queVende: "churros de masa madre",
  vertical: "pedidos",
  horario: { dias: [1, 2, 3, 4, 5], abre: "12:30", cierra: "20:30" },
  catalogo: "CHURRITA — $10.000",
  entrega: {
    haceDomicilios: true,
    como: "domicilio propio en Jamundí",
    quienPagaElDomicilio: "el cliente, al recibir",
  },
  pago: { formas: "efectivo y Nequi", datosDeCuenta: "Nequi 300 000 0000" },
  tono: "cercano, con emojis",
  // Lo que el operador ajustó a mano y NO puede perderse:
  reglasPropias: [
    "Un pedido completo son CINCO mensajes tuyos, ni uno más.",
    'Si el cliente escribe "0", reinicia como si fuera la primera vez.',
  ],
  saludoInicial: "¡Hola Churr@! 🥨 Estas son nuestras presentaciones:",
  escalarSiempre: ["reclamos", "domicilios fuera de zona"],
  nuncaPrometer: ["tiempos de entrega exactos"],
} as unknown as FichaDelNegocio;

/**
 * Lo que manda el cuestionario del cliente: sus datos, y con los campos del
 * operador **vacíos o distintos** — que es justo el caso peligroso.
 */
const DEL_CUESTIONARIO = {
  ...ORIGINAL,
  tono: "cercano, con emojis y más alegre",
  reglasPropias: [],
  saludoInicial: undefined,
  escalarSiempre: [],
  nuncaPrometer: [],
} as unknown as FichaDelNegocio;

describe("el ciclo completo que exige el dueño", () => {
  it("ficha original → convertir → reenviar cuestionario → el prompt NO cambia", () => {
    // 1. El prompt de partida.
    const promptAntes = generarPerfil(ORIGINAL).instructions;

    // 2. Se convierte a secciones (paso 3 del plan).
    const convertida = JSON.stringify(aSecciones(ORIGINAL));
    expect(leerFicha(convertida)).toEqual(ORIGINAL);

    // 3. El cliente reenvía su cuestionario: solo posee `negocio`.
    const { ficha, conservadas } = fusionarFicha(convertida, DEL_CUESTIONARIO, ["negocio"]);
    expect(conservadas.sort()).toEqual(["flujo", "politicas"]);

    // 4. El prompt final. Cambia solo lo que el cliente sí posee (el tono),
    //    y las reglas del operador siguen enteras.
    const promptDespues = generarPerfil(ficha).instructions;
    expect(ficha.reglasPropias).toEqual(ORIGINAL.reglasPropias);
    expect(ficha.saludoInicial).toBe(ORIGINAL.saludoInicial);
    expect(promptDespues).toContain("CINCO mensajes");
    expect(promptDespues).toContain('Si el cliente escribe "0"');

    // Y con el mismo cuestionario (sin cambiar el tono), idéntico carácter a
    // carácter: es la garantía que pidió el dueño.
    const sinCambios = fusionarFicha(convertida, { ...DEL_CUESTIONARIO, tono: ORIGINAL.tono }, [
      "negocio",
    ]);
    expect(generarPerfil(sinCambios.ficha).instructions).toBe(promptAntes);
  });

  it("sin la fusión, el mismo reenvío BORRA las reglas — el fallo del 15-ago", () => {
    // Así se comportaba antes: la ficha entrante ganaba entera.
    const comoAntes = generarPerfil(DEL_CUESTIONARIO).instructions;
    expect(comoAntes).not.toContain("CINCO mensajes");
    expect(comoAntes.length).toBeLessThan(generarPerfil(ORIGINAL).instructions.length);
  });
});

describe("el cuestionario no puede tocar lo que no es suyo", () => {
  it("no modifica flujo ni politicas", () => {
    const { ficha } = fusionarFicha(JSON.stringify(ORIGINAL), DEL_CUESTIONARIO, ["negocio"]);
    expect(ficha.reglasPropias).toEqual(ORIGINAL.reglasPropias);
    expect(ficha.saludoInicial).toBe(ORIGINAL.saludoInicial);
    expect((ficha as unknown as Record<string, unknown>).escalarSiempre).toEqual(
      ORIGINAL.escalarSiempre
    );
    expect((ficha as unknown as Record<string, unknown>).nuncaPrometer).toEqual(
      ORIGINAL.nuncaPrometer
    );
  });

  it("sí modifica lo suyo: los datos del negocio", () => {
    const { ficha } = fusionarFicha(JSON.stringify(ORIGINAL), DEL_CUESTIONARIO, ["negocio"]);
    expect(ficha.tono).toBe("cercano, con emojis y más alegre");
  });
});

describe("el operador escribe lo suyo, y tampoco pisa lo demás", () => {
  it("cambia el flujo sin tocar los datos del negocio", () => {
    const delOperador = {
      ...ORIGINAL,
      nombre: "OTRO NOMBRE QUE NO DEBE ENTRAR",
      reglasPropias: ["regla nueva del operador"],
    } as unknown as FichaDelNegocio;

    const { ficha, conservadas } = fusionarFicha(JSON.stringify(ORIGINAL), delOperador, [
      "flujo",
      "politicas",
    ]);
    expect(ficha.reglasPropias).toEqual(["regla nueva del operador"]);
    expect(ficha.nombre).toBe("La Churra");
    expect(conservadas).toEqual(["negocio"]);
  });
});

describe("rellenar un formulario no le cambia el formato a nadie", () => {
  it("una ficha plana se guarda plana", () => {
    const guardado = serializarComoEstaba(JSON.stringify(ORIGINAL), ORIGINAL);
    expect(JSON.parse(guardado).schema_version).toBeUndefined();
  });

  it("una ficha convertida se guarda convertida", () => {
    const convertida = JSON.stringify(aSecciones(ORIGINAL));
    const guardado = serializarComoEstaba(convertida, ORIGINAL);
    expect(JSON.parse(guardado).schema_version).toBe(2);
  });
});

describe("el alta, que es el caso sin conflicto posible", () => {
  it("un negocio nuevo nace con su ficha entera", () => {
    const { ficha, conservadas } = fusionarFicha(null, ORIGINAL, ["negocio"]);
    expect(ficha).toEqual(ORIGINAL);
    expect(conservadas).toEqual([]);
  });
});
