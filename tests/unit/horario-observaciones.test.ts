import { describe, expect, it } from "vitest";
import { businessStatus } from "@/server/ai/prompts";
import {
  franjaDelDia,
  horarioDeLaFila,
  horarioNormalizado,
  observacionesDeHorario,
  type HorarioSemanal,
} from "@/server/horario";
import { faltantesDeLaFicha, type FichaDelNegocio } from "@/server/ai/generador/ficha";
import { fusionarFicha, leerFicha, serializarComoEstaba } from "@/server/ai/generador/leer-ficha";

/**
 * OBSERVACIONES DE HORARIO: contexto, nunca autoridad.
 *
 * No todo lo que un negocio necesita decir sobre sus horarios cabe en una
 * franja por día. Lis es el caso real: **toma pedidos por WhatsApp desde las
 * 10:00, pero su local físico abre a la 1 de la tarde.** Su horario operativo
 * —el que decide si el bot atiende— es el de WhatsApp; el del local es algo
 * que hay que poder contarle al cliente.
 *
 * La tentación sería añadir `horarioLocal`, y detrás vendrían
 * `horarioInstagram`, `horarioEntrega`… Un campo estructurado por cada
 * particularidad de cada negocio. En su lugar: **un texto libre que explica,
 * y que no puede decidir nada**.
 *
 * La garantía no es una regla escrita: es el tipo. `HorarioSemanal` es un
 * mapa de día a franja y `businessStatus` solo acepta eso — la observación
 * **no puede entrar físicamente** en la función que decide abierto/cerrado.
 */

const LUNES_A_SABADO: HorarioSemanal = {
  1: { abre: "10:00", cierra: "20:00" },
  2: { abre: "10:00", cierra: "20:00" },
  3: { abre: "10:00", cierra: "20:00" },
  4: { abre: "10:00", cierra: "20:00" },
  5: { abre: "10:00", cierra: "20:00" },
  6: { abre: "10:00", cierra: "20:00" },
};

/** Domingo 20-sep-2026 y lunes 21-sep-2026, 15:00 en Colombia. */
const DOMINGO = new Date("2026-09-20T20:00:00Z");
const LUNES = new Date("2026-09-21T20:00:00Z");

const BASE = {
  nombre: "X",
  queVende: "X",
  tono: "X",
  vertical: "pedidos",
  entrega: { haceDomicilios: false },
  pago: { formas: "efectivo", compruebaUnaPersona: false },
  preguntasFrecuentes: [],
  escalarSiempre: [],
  nuncaPrometer: [],
};

const fichaCon = (horario: unknown, observaciones?: string) =>
  JSON.stringify({ ...BASE, horario, observacionesHorario: observaciones });

describe("CASO 1 — la observación NO puede abrir un día cerrado", () => {
  /*
   * El caso que define toda la funcionalidad. Si esto falla, hemos vuelto al
   * incidente de Lis por otra puerta: un texto suelto decidiendo si el
   * negocio atiende.
   */
  const fila = {
    ficha: fichaCon(
      horarioNormalizado(LUNES_A_SABADO),
      "Los domingos atendemos por WhatsApp de 10:00 a 14:00."
    ),
  };

  it("el domingo sigue cerrado, diga lo que diga el texto", () => {
    expect(franjaDelDia(horarioDeLaFila(fila), 7)).toBeNull();
    expect(businessStatus(horarioDeLaFila(fila), DOMINGO)).toBe("cerrado");
  });

  it("la observación se lee aparte, nunca mezclada con el horario", () => {
    expect(observacionesDeHorario(fila)).toBe(
      "Los domingos atendemos por WhatsApp de 10:00 a 14:00."
    );
    // Y el horario canónico no la contiene por ningún lado.
    expect(JSON.stringify(horarioDeLaFila(fila))).not.toMatch(/domingo/i);
  });
});

describe("CASO 2 — el caso real de Lis: WhatsApp 10:00, local físico 13:00", () => {
  const fila = {
    ficha: fichaCon(
      horarioNormalizado(LUNES_A_SABADO),
      "Atendemos pedidos por WhatsApp desde las 10:00 a. m., pero el punto físico abre al público desde la 1:00 p. m."
    ),
  };

  it("el horario operativo sigue siendo el de WhatsApp: 10:00–20:00", () => {
    expect(franjaDelDia(horarioDeLaFila(fila), 1)).toEqual({ abre: "10:00", cierra: "20:00" });
    expect(businessStatus(horarioDeLaFila(fila), LUNES)).toBe("abierto");
    // A las 11:00 del lunes: abierto, aunque el local no haya abierto.
    expect(businessStatus(horarioDeLaFila(fila), new Date("2026-09-21T16:00:00Z"))).toBe(
      "abierto"
    );
  });

  it("y el contexto del local llega al modelo para que lo pueda contar", () => {
    expect(observacionesDeHorario(fila)).toContain("1:00 p. m.");
  });
});

describe("CASO 3 — sin observación, todo funciona igual que antes", () => {
  it("vacía, ausente o solo espacios dan `null`", () => {
    expect(observacionesDeHorario({ ficha: fichaCon(horarioNormalizado(LUNES_A_SABADO)) })).toBeNull();
    expect(observacionesDeHorario({ ficha: fichaCon(horarioNormalizado(LUNES_A_SABADO), "") })).toBeNull();
    expect(observacionesDeHorario({ ficha: fichaCon(horarioNormalizado(LUNES_A_SABADO), "   ") })).toBeNull();
    expect(observacionesDeHorario({ ficha: null })).toBeNull();
  });

  it("no es obligatoria: la ficha se da por completa sin ella", () => {
    const ficha = { ...BASE, horario: horarioNormalizado(LUNES_A_SABADO) } as unknown as FichaDelNegocio;
    expect(faltantesDeLaFicha(ficha)).toEqual([]);
  });
});

describe("CASO 4 — texto libre complejo no rompe nada", () => {
  it("saltos de línea, emojis, comillas y horas sueltas se conservan tal cual", () => {
    const texto =
      '⏰ "Horarios especiales":\n- 24 y 31 de diciembre cerramos a las 14:00\n- Festivos: 11:00 a 17:00\n- El local abre 1 h más tarde que el WhatsApp';
    const fila = { ficha: fichaCon(horarioNormalizado(LUNES_A_SABADO), texto) };
    expect(observacionesDeHorario(fila)).toBe(texto);
    // Y NINGUNA de esas horas cambia el horario operativo.
    expect(franjaDelDia(horarioDeLaFila(fila), 1)).toEqual({ abre: "10:00", cierra: "20:00" });
    expect(businessStatus(horarioDeLaFila(fila), new Date("2026-09-21T21:30:00Z"))).toBe(
      "abierto"
    );
  });

  it("una ficha rota no tumba la lectura", () => {
    expect(observacionesDeHorario({ ficha: "{ no es json" })).toBeNull();
  });
});

describe("CASO 5 — cambiar la observación no toca `porDia`", () => {
  it("el horario queda byte a byte igual", () => {
    const antes = { ...BASE, horario: horarioNormalizado(LUNES_A_SABADO) } as unknown as FichaDelNegocio;
    const despues = { ...antes, observacionesHorario: "El local abre a la 1 p. m." };
    expect(JSON.stringify(despues.horario)).toBe(JSON.stringify(antes.horario));
  });
});

describe("CASO 6 — cambiar `porDia` no borra la observación", () => {
  it("normalizar el horario deja el texto intacto, porque ni lo toca", () => {
    /*
     * `horarioNormalizado` reescribe `ficha.horario` ENTERO. Si la
     * observación viviera dentro, cada guardado la borraría — la misma
     * trampa que H-1. Por eso vive fuera: el normalizador no puede perder
     * lo que nunca maneja.
     */
    const ficha = {
      ...BASE,
      horario: horarioNormalizado(LUNES_A_SABADO),
      observacionesHorario: "El local abre a la 1 p. m.",
    } as unknown as FichaDelNegocio;

    const conDomingo = {
      ...ficha,
      horario: horarioNormalizado({ ...LUNES_A_SABADO, 7: { abre: "14:00", cierra: "18:00" } }),
    };
    expect(conDomingo.observacionesHorario).toBe("El local abre a la 1 p. m.");
    expect(Object.keys(conDomingo.horario.porDia!)).toContain("7");
  });

  it("fusionar y reserializar la ficha la conserva (no es un campo huérfano)", () => {
    const entrante = {
      ...BASE,
      horario: horarioNormalizado(LUNES_A_SABADO),
      observacionesHorario: "El local abre a la 1 p. m.",
    } as unknown as FichaDelNegocio;

    const { ficha } = fusionarFicha(null, entrante, ["negocio"]);
    expect(ficha.observacionesHorario).toBe("El local abre a la 1 p. m.");

    const ida = serializarComoEstaba(null, ficha);
    expect(leerFicha(ida)?.observacionesHorario).toBe("El local abre a la 1 p. m.");
  });
});

describe("CASO 7 — regenerar el prompt conserva la observación", () => {
  it("el generador no la toca: vive en la ficha, no en `instructions`", async () => {
    const { generarPerfil } = await import("@/server/ai/generador/generar");
    const ficha = {
      ...BASE,
      catalogo: "Algo — $1.000",
      horario: horarioNormalizado(LUNES_A_SABADO),
      observacionesHorario: "El local abre a la 1 p. m.",
    } as unknown as FichaDelNegocio;

    const perfil = generarPerfil(ficha);
    /*
     * NO va a `instructions`: ahí se quedaría congelada y volvería a ser una
     * segunda fuente. La inyecta el pipeline en cada turno, junto al horario
     * (ver `estadoDelNegocio`), que es el mismo criterio que ya se aplicó al
     * catálogo y a los pagos.
     */
    expect(perfil.instructions).not.toContain("El local abre a la 1 p. m.");
    // Y la ficha sigue teniéndola para quien la necesite.
    expect(ficha.observacionesHorario).toBe("El local abre a la 1 p. m.");
  });

  it("llega al prompt del turno como CONTEXTO, marcada como tal", async () => {
    const { buildAgentSystemPrompt } = await import("@/server/ai/prompts");
    const perfil = {
      name: "Asistente",
      tone: null,
      instructions: null,
      escalationRules: null,
      greeting: null,
      ficha: fichaCon(horarioNormalizado(LUNES_A_SABADO), "El local abre a la 1 p. m."),
      hoursDays: null,
      hoursOpen: null,
      hoursClose: null,
      hoursOpenSunday: null,
      hoursCloseSunday: null,
    } as unknown as Parameters<typeof buildAgentSystemPrompt>[0]["profile"];

    const prompt = buildAgentSystemPrompt({
      profile: perfil,
      kb: [],
      stages: [{ name: "Nuevo" }],
      now: LUNES,
    });
    expect(prompt).toContain("El local abre a la 1 p. m.");
    // Y con el aviso de que NO decide si se atiende.
    expect(prompt).toMatch(/no decide|no cambia|no es el horario/i);
  });
});

describe("CASO 8 — el auditor no confunde una observación con una contradicción", () => {
  it("una observación que menciona días y horas no bloquea", async () => {
    const { incoherenciasDeHorario } = await import("@/server/horario-auditoria");
    const { columnasDesdeHorario } = await import("@/server/horario");
    const fila = {
      ficha: fichaCon(
        horarioNormalizado(LUNES_A_SABADO),
        "Los domingos el local abre de 10:00 a 14:00 solo para recoger."
      ),
      ...columnasDesdeHorario(LUNES_A_SABADO),
    };
    expect(incoherenciasDeHorario(fila).filter((f) => f.bloqueante)).toEqual([]);
  });

  it("pero SÍ sigue bloqueando una contradicción estructural de verdad", async () => {
    const { incoherenciasDeHorario } = await import("@/server/horario-auditoria");
    const fila = {
      ficha: fichaCon(horarioNormalizado(LUNES_A_SABADO), "Nada raro."),
      hoursDays: "1,2,3,4,5,6",
      hoursOpen: "10:00",
      hoursClose: "23:59", // ← las columnas mienten respecto a la ficha
      hoursOpenSunday: null,
      hoursCloseSunday: null,
    };
    expect(incoherenciasDeHorario(fila).map((f) => f.tipo)).toContain("derivados_desalineados");
  });
});

describe("CASOS 9 y 10 — multi-tenant: la misma mecánica, sin nombres propios", () => {
  it("dos negocios distintos, con observaciones distintas, sin interferirse", () => {
    const lis = {
      ficha: fichaCon(
        horarioNormalizado(LUNES_A_SABADO),
        "Pedidos por WhatsApp desde las 10:00; el punto físico abre a la 1:00 p. m."
      ),
    };
    const otro = {
      ficha: fichaCon(
        horarioNormalizado({ 7: { abre: "08:00", cierra: "12:00" } }),
        "Solo domingos, en la plaza de mercado."
      ),
    };

    expect(businessStatus(horarioDeLaFila(lis), DOMINGO)).toBe("cerrado");
    expect(businessStatus(horarioDeLaFila(otro), new Date("2026-09-20T14:00:00Z"))).toBe(
      "abierto"
    );
    expect(observacionesDeHorario(lis)).toContain("punto físico");
    expect(observacionesDeHorario(otro)).toContain("plaza de mercado");
  });

  it("un tenant sin observación no hereda la de nadie", () => {
    const sinNada = { ficha: fichaCon(horarioNormalizado(LUNES_A_SABADO)) };
    expect(observacionesDeHorario(sinNada)).toBeNull();
  });
});
