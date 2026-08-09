import { describe, expect, it } from "vitest";
import { clientIpFrom } from "@/lib/rate-limit";

/**
 * La cuenta de intentos se probaba aquí con el tiempo inyectado, cuando el
 * contador vivía en un `Map` de este proceso. Desde el 8-ago-2026 vive en la
 * base (para que el límite no se multiplique por réplica), así que **la lógica
 * es el SQL**: probarla con un doble sería probar el doble.
 *
 * Su prueba real, contra Postgres de verdad, está en
 * `tests/integration/rate-limit-db.test.ts`.
 */

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("clientIpFrom (IP real detrás del proxy)", () => {
  it("prefiere X-Real-Ip cuando está presente", () => {
    expect(
      clientIpFrom(
        headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" })
      )
    ).toBe("9.9.9.9");
  });

  it("sin X-Real-Ip, usa el ÚLTIMO salto de X-Forwarded-For (el que añade el proxy)", () => {
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))
    ).toBe("9.9.9.9");
  });

  it("un atacante que falsifica el primer salto no cambia la IP detectada", () => {
    // Simula rotar el primer valor en cada intento: la clave del rate-limit
    // no debe cambiar, o el límite nunca se dispara.
    const a = clientIpFrom(headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" }));
    const b = clientIpFrom(headers({ "x-forwarded-for": "2.2.2.2, 9.9.9.9" }));
    expect(a).toBe("9.9.9.9");
    expect(b).toBe("9.9.9.9");
  });

  it("sin ninguna cabecera, cae a 'local' en vez de reventar", () => {
    expect(clientIpFrom(headers({}))).toBe("local");
  });
});
