import { describe, expect, it } from "vitest";
import { requisitosDe, type FichaDelNegocio } from "@/server/ai/generador/ficha";

/**
 * La configuración REAL de cierre de La Churra, leída de producción el
 * 19-sep-2026 después de corregir el requisito de dirección.
 *
 * El defecto que cierra: la entrada era `{"id":"direccion"}` a secas. Sin
 * `obligatorio`, `estado.ts:427` (`if (r.obligatorio && ...)`) no la exigía
 * nunca — se podía cerrar un pedido a domicilio sin dirección.
 *
 * Y no bastaba con `obligatorio: true`: sin `soloEnModalidades` se le pediría
 * también a quien pasa a recoger, que es el incidente del 20-ago-2026 (el
 * modelo escribió "Recoge en el local" DENTRO del campo dirección).
 */
const FICHA_CHURRA = {
  cierre: {
    requisitos: [
      {
        id: "direccion",
        tipo: "direccion",
        etiqueta: "la direccion de entrega",
        obligatorio: true,
        soloEnModalidades: ["domicilio"],
      },
      { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
      { id: "telefono", tipo: "telefono", etiqueta: "el celular de contacto", obligatorio: true },
    ],
  },
} as unknown as FichaDelNegocio;

const ids = (modalidad: string | null) =>
  (requisitosDe(FICHA_CHURRA, { modalidadDeEntrega: modalidad }) ?? []).map((r) => r.id);

describe("La Churra — requisito de direccion por modalidad", () => {
  it("CASO A/B — con modalidad domicilio, la direccion SE exige y es obligatoria", () => {
    const reqs = requisitosDe(FICHA_CHURRA, { modalidadDeEntrega: "domicilio" }) ?? [];
    const direccion = reqs.find((r) => r.id === "direccion");
    expect(direccion).toBeDefined();
    expect(direccion!.obligatorio).toBe(true);
    // `estado.ts:427` bloquea el cierre con `obligatorio && !datos[id]`:
    // con esto, un pedido a domicilio sin direccion no puede confirmarse.
  });

  it("CASO C — con modalidad recogida, la direccion NO se exige", () => {
    expect(ids("recogida")).not.toContain("direccion");
    // Y los demas siguen ahi: no se relajo el cierre.
    expect(ids("recogida")).toEqual(expect.arrayContaining(["nombre", "telefono"]));
  });

  it("sin modalidad resuelta todavia, SI se exige — y es a proposito", () => {
    // Protección anti-bypass documentada en `aplica()`: si con la modalidad
    // sin resolver se dejara de pedir la dirección, bastaría con que el
    // modelo propusiera una modalidad que el negocio NO ofrece —que se
    // normaliza a `null`— para saltarse el requisito. Se exige por defecto y
    // solo se relaja cuando el backend confirmó una modalidad que no la
    // necesita.
    expect(ids(null)).toContain("direccion");
  });

  it("nombre y telefono siguen siendo obligatorios en cualquier modalidad", () => {
    for (const m of ["domicilio", "recogida", null]) {
      expect(ids(m)).toEqual(expect.arrayContaining(["nombre", "telefono"]));
    }
  });

  it("una modalidad inventada por el modelo NO sirve para saltarse la direccion", () => {
    /*
     * El bypass que cierra la regla de arriba. Ojo al valor que se pasa: una
     * modalidad que el negocio no ofrece NO llega hasta aquí como texto — la
     * normalización del backend la convierte en `null` antes, y `null` exige
     * la dirección. Por eso el caso realista se escribe con `null`, no con la
     * cadena inventada: pasar la cadena probaría un flujo que no existe.
     */
    const comoLoNormalizaElBackend = null;
    expect(ids(comoLoNormalizaElBackend)).toContain("direccion");
  });
});
