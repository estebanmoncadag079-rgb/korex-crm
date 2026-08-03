import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMIT,
  checkRateLimit,
  clientIpFrom,
  resetRateLimit,
} from "@/lib/rate-limit";

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("rate limit por IP (FR-062: 10 / 10 min → 429)", () => {
  beforeEach(() => resetRateLimit());

  it("permite hasta el máximo y bloquea el siguiente", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      expect(
        checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + i).allowed
      ).toBe(true);
    }
    expect(
      checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(false);
  });

  it("la ventana desliza: pasados 10 minutos vuelve a permitir", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      checkRateLimit("k", AUTH_RATE_LIMIT, t0 + i);
    }
    expect(checkRateLimit("k", AUTH_RATE_LIMIT, t0 + 1000).allowed).toBe(false);
    expect(
      checkRateLimit("k", AUTH_RATE_LIMIT, t0 + AUTH_RATE_LIMIT.windowMs + 500)
        .allowed
    ).toBe(true);
  });

  it("claves distintas (IPs) no se afectan entre sí", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      checkRateLimit("login:1.1.1.1", AUTH_RATE_LIMIT, t0 + i);
    }
    expect(
      checkRateLimit("login:1.1.1.1", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(false);
    expect(
      checkRateLimit("login:2.2.2.2", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(true);
  });
});

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
