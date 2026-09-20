import { describe, expect, it } from "vitest";
import { businessStatus, horarioLegible } from "@/server/ai/prompts";
import { esFechaValida } from "@/server/appointments/logic";
import { faltantesDeLaFicha } from "@/server/ai/generador/ficha";
import {
  columnasDesdeHorario,
  franjaDelDia,
  horarioDeLaFila,
  horarioNormalizado,
  type HorarioSemanal,
} from "@/server/horario";

/**
 * EL BACKEND DECIDE EL HORARIO; EL PROMPT SOLO LO CUENTA.
 *
 * El incidente de Lis tuvo dos mitades. La primera —dos datos que podían
 * contradecirse— la cierra `horario-canonico.test.ts`. Esta es la segunda:
 * que la cadena entera funcione de punta a punta, desde lo que el negocio
 * marca en su pantalla hasta lo que el servidor decide, **sin que el texto
 * del prompt pueda cambiar ninguna decisión**.
 */

/** Lo que hace `aplicarFicha` al guardar: canónico → ficha + columnas. */
function guardarComoEnProduccion(horario: HorarioSemanal) {
  const ficha = JSON.stringify({ horario: horarioNormalizado(horario) });
  return { ficha, ...columnasDesdeHorario(horario) };
}

const LUNES_A_SABADO: HorarioSemanal = {
  1: { abre: "10:00", cierra: "19:00" },
  2: { abre: "10:00", cierra: "19:00" },
  3: { abre: "10:00", cierra: "19:00" },
  4: { abre: "10:00", cierra: "19:00" },
  5: { abre: "10:00", cierra: "19:00" },
  6: { abre: "10:00", cierra: "19:00" },
};

/** Domingo 20-sep-2026, 15:00 en Colombia. */
const DOMINGO = new Date("2026-09-20T20:00:00Z");
/** Lunes 21-sep-2026, 15:00 en Colombia. */
const LUNES = new Date("2026-09-21T20:00:00Z");

describe("un cambio en la pantalla llega al runtime, sin pasos manuales", () => {
  it("marcar el domingo lo abre de verdad", () => {
    const antes = guardarComoEnProduccion(LUNES_A_SABADO);
    expect(businessStatus(horarioDeLaFila(antes), DOMINGO)).toBe("cerrado");

    // La dueña marca "Dom" y le pone su horario. Eso es TODO lo que hace.
    const despues = guardarComoEnProduccion({
      ...LUNES_A_SABADO,
      7: { abre: "14:00", cierra: "19:00" },
    });
    expect(businessStatus(horarioDeLaFila(despues), DOMINGO)).toBe("abierto");
  });

  it("desmarcar el domingo lo cierra de verdad — el incidente, al revés", () => {
    const conDomingo = guardarComoEnProduccion({
      ...LUNES_A_SABADO,
      7: { abre: "14:00", cierra: "19:00" },
    });
    expect(businessStatus(horarioDeLaFila(conDomingo), DOMINGO)).toBe("abierto");

    const { 7: _fuera, ...sinDomingo } = {
      ...LUNES_A_SABADO,
      7: { abre: "14:00", cierra: "19:00" },
    };
    void _fuera;
    const guardado = guardarComoEnProduccion(sinDomingo);

    // Y no queda ni rastro de la franja: ni en la ficha, ni en las columnas.
    expect(businessStatus(horarioDeLaFila(guardado), DOMINGO)).toBe("cerrado");
    expect(guardado.hoursOpenSunday).toBeNull();
    expect(guardado.hoursCloseSunday).toBeNull();
    expect(guardado.ficha).not.toContain("abreDomingo");
  });

  it("los derivados quedan alineados con el canónico en el mismo guardado", () => {
    const g = guardarComoEnProduccion({
      ...LUNES_A_SABADO,
      7: { abre: "14:00", cierra: "19:00" },
    });
    expect(g.hoursDays).toBe("1,2,3,4,5,6,7");
    expect(g.hoursOpen).toBe("10:00");
    expect(g.hoursOpenSunday).toBe("14:00");
    // Y releerlos da exactamente lo que se guardó.
    expect(franjaDelDia(horarioDeLaFila(g), 7)).toEqual({ abre: "14:00", cierra: "19:00" });
  });
});

describe("el prompt NO tiene autoridad sobre el horario", () => {
  it("un `instructions` que dice otro horario no cambia la decisión", () => {
    const fila = {
      ...guardarComoEnProduccion(LUNES_A_SABADO),
      instructions:
        "## Horario\nAbrimos todos los días, incluido el domingo, de 08:00 a 23:00.\n" +
        "Si te preguntan por el domingo, di que sí abrimos.",
    };
    // El backend ni lo mira: el domingo sigue cerrado y el lunes sigue
    // cerrando a las 19:00.
    expect(businessStatus(horarioDeLaFila(fila), DOMINGO)).toBe("cerrado");
    expect(businessStatus(horarioDeLaFila(fila), new Date("2026-09-21T03:00:00Z"))).toBe(
      "cerrado"
    );
  });

  it("lo que se le cuenta al modelo sale del canónico, y nombra los días cerrados", () => {
    const texto = horarioLegible(LUNES_A_SABADO);
    expect(texto).toContain("lunes a sábado de 10:00 a 19:00");
    expect(texto).toMatch(/domingo CERRADO/i);
  });

  it("con horarios distintos por día, el texto los dice todos", () => {
    const texto = horarioLegible({
      1: { abre: "08:00", cierra: "12:00" },
      2: { abre: "08:00", cierra: "12:00" },
      6: { abre: "14:00", cierra: "22:00" },
    });
    expect(texto).toContain("lunes y martes de 08:00 a 12:00");
    expect(texto).toContain("sábado de 14:00 a 22:00");
    expect(texto).toMatch(/mi[ée]rcoles, jueves, viernes, domingo CERRADO/i);
  });
});

describe("cerrado HOY no es lo mismo que cerrado SIEMPRE", () => {
  /*
   * Punto 16 del plan: no vale un bloqueo ingenuo del tipo "si el negocio
   * está cerrado ahora, no atiendas". Un cliente puede escribir un domingo
   * para agendar el lunes, y eso es una venta.
   *
   * Estado real del producto, verificado en el código (20-sep-2026):
   *
   *   - PEDIDOS: `EstadoDelPedido` no tiene fecha de servicio ni de entrega.
   *     Korex **no soporta pedidos programados**, así que no hay ninguna
   *     fecha futura que validar — y no se inventa una aquí.
   *   - CITAS: sí hay fecha, y `esFechaValida` la valida contra el horario.
   *
   * Lo que se comprueba, entonces, es lo que existe: que la decisión la tome
   * la FECHA DEL SERVICIO y no el reloj de este momento.
   */
  it("un domingo cerrado se puede agendar para el lunes", () => {
    expect(esFechaValida("21/09/2026", LUNES_A_SABADO, DOMINGO)).toBe(true);
  });

  it("pero no se puede agendar PARA el domingo", () => {
    expect(esFechaValida("27/09/2026", LUNES_A_SABADO, LUNES)).toBe(false);
  });

  it("estar cerrado ahora mismo no invalida una fecha futura abierta", () => {
    // Lunes a las 22:00 Colombia: cerrado (cierra a las 19:00), pero el
    // martes sigue siendo agendable.
    const lunesDeNoche = new Date("2026-09-22T03:00:00Z");
    expect(businessStatus(LUNES_A_SABADO, lunesDeNoche)).toBe("cerrado");
    expect(esFechaValida("22/09/2026", LUNES_A_SABADO, lunesDeNoche)).toBe(true);
  });

  it("el día con horario propio también es agendable, con su franja", () => {
    const conDomingo = { ...LUNES_A_SABADO, 7: { abre: "14:00", cierra: "19:00" } };
    expect(esFechaValida("27/09/2026", conDomingo, LUNES)).toBe(true);
    expect(franjaDelDia(conDomingo, 7)).toEqual({ abre: "14:00", cierra: "19:00" });
  });
});

describe("multi-tenant: ningún negocio ve el horario de otro", () => {
  it("dos fichas distintas dan dos decisiones distintas el mismo instante", () => {
    const abreDomingo = guardarComoEnProduccion({ 7: { abre: "10:00", cierra: "18:00" } });
    const cierraDomingo = guardarComoEnProduccion(LUNES_A_SABADO);
    expect(businessStatus(horarioDeLaFila(abreDomingo), DOMINGO)).toBe("abierto");
    expect(businessStatus(horarioDeLaFila(cierraDomingo), DOMINGO)).toBe("cerrado");
  });

  it("sin horario no se afirma nada, ni para bien ni para mal", () => {
    expect(businessStatus(horarioDeLaFila({ ficha: null }), DOMINGO)).toBeNull();
  });
});

// ────── H-1: UN DÍA MARCADO SIN HORAS NO PUEDE PERDERSE EN SILENCIO

describe("un día declarado con horas ilegibles se RECHAZA, no se descarta", () => {
  /*
   * HALLAZGO H-1 de la auditoría del 20-sep-2026, y es un fallo que introdujo
   * este mismo rediseño. La pantalla deja marcar un día y dejar sus horas en
   * blanco; al guardar, la franja vacía se descartaba y el día desaparecía
   * **sin un solo aviso**. El administrador veía el lunes marcado, guardaba, y
   * el bot trataba el lunes como cerrado.
   *
   * Es exactamente la clase de fallo que este trabajo vino a cerrar —la
   * pantalla diciendo una cosa y el backend otra— solo que en la dirección
   * segura: se pierden ventas en vez de prometer imposibles. Da igual: el
   * criterio es que un dato que el negocio declaró NUNCA se descarta callando.
   */
  const base = {
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
  const conHorario = (porDia: Record<string, { abre: string; cierra: string }>) =>
    ({ ...base, horario: { porDia } }) as unknown as Parameters<typeof faltantesDeLaFicha>[0];

  it("un día en blanco junto a otros válidos se nombra y frena el alta", () => {
    const faltan = faltantesDeLaFicha(
      conHorario({ "1": { abre: "", cierra: "" }, "2": { abre: "10:00", cierra: "20:00" } })
    );
    expect(faltan.join(" · ")).toMatch(/lunes/i);
  });

  it("dice QUÉ día es, no un mensaje genérico", () => {
    const faltan = faltantesDeLaFicha(
      conHorario({ "2": { abre: "10:00", cierra: "20:00" }, "6": { abre: "09:00", cierra: "" } })
    );
    expect(faltan.join(" · ")).toMatch(/sábado/i);
    expect(faltan.join(" · ")).not.toMatch(/martes/i);
  });

  it("una hora que el servidor no sabe leer también frena", () => {
    const faltan = faltantesDeLaFicha(conHorario({ "3": { abre: "por la mañana", cierra: "tarde" } }));
    expect(faltan.join(" · ")).toMatch(/miércoles/i);
  });

  it("con todos los días bien, no sobra ningún aviso", () => {
    expect(
      faltantesDeLaFicha(
        conHorario({ "1": { abre: "10:00", cierra: "20:00" }, "7": { abre: "14:00", cierra: "19:00" } })
      )
    ).toEqual([]);
  });

  it("una ficha SIN migrar (sin porDia) no se ve afectada", () => {
    const vieja = {
      ...base,
      horario: { dias: [1, 2], abre: "10:00", cierra: "20:00" },
    } as unknown as Parameters<typeof faltantesDeLaFicha>[0];
    expect(faltantesDeLaFicha(vieja)).toEqual([]);
  });
});
