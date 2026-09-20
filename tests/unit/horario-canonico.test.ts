import { describe, expect, it } from "vitest";
import {
  columnasDesdeHorario,
  diasAbiertos,
  franjaDelDia,
  horarioCanonico,
  horarioDeLaFila,
  horarioNormalizado,
  horarioSemanalDesdeLegacy,
  legacyDesdeHorarioSemanal,
  sinHorarioConfigurado,
  type HorarioSemanal,
} from "@/server/horario";

/**
 * EL MODELO CANÓNICO DE HORARIO (20-sep-2026).
 *
 * El incidente: la dueña de Lis desmarcó el domingo en su pantalla y el bot
 * siguió ofreciendo servicio ese día. El horario vivía en dos sitios que
 * podían contradecirse — `hours_days` sin el 7, y `hours_open_sunday` con
 * una franja huérfana— y el resolutor miraba la franja ANTES que los días.
 *
 * Estas pruebas fijan la regla que lo hace imposible: **un día que no está
 * en el horario está cerrado, y la única forma de decir que abre es ponerle
 * su franja.**
 */

const LUNES_A_SABADO: HorarioSemanal = {
  1: { abre: "10:00", cierra: "19:00" },
  2: { abre: "10:00", cierra: "19:00" },
  3: { abre: "10:00", cierra: "19:00" },
  4: { abre: "10:00", cierra: "19:00" },
  5: { abre: "10:00", cierra: "19:00" },
  6: { abre: "10:00", cierra: "19:00" },
};

describe("franjaDelDia: la función de dominio, sin ramas por día", () => {
  it("un día abierto devuelve su franja", () => {
    expect(franjaDelDia(LUNES_A_SABADO, 1)).toEqual({ abre: "10:00", cierra: "19:00" });
  });

  it("DOMINGO DESHABILITADO → cerrado (el incidente de Lis)", () => {
    expect(franjaDelDia(LUNES_A_SABADO, 7)).toBeNull();
  });

  it("domingo con franja propia → abierto con ESA franja", () => {
    const conDomingo = { ...LUNES_A_SABADO, 7: { abre: "14:00", cierra: "19:00" } };
    expect(franjaDelDia(conDomingo, 7)).toEqual({ abre: "14:00", cierra: "19:00" });
  });

  it("el domingo no tiene ningún trato especial: es el día 7 y ya", () => {
    // Si alguien vuelve a meter una rama `if (dia === 7)`, esta prueba no la
    // caza — pero sí caza su efecto: un lunes cerrado y un domingo cerrado
    // se comportan exactamente igual.
    const soloDomingo: HorarioSemanal = { 7: { abre: "08:00", cierra: "12:00" } };
    expect(franjaDelDia(soloDomingo, 1)).toBeNull();
    expect(franjaDelDia(LUNES_A_SABADO, 7)).toBeNull();
    expect(franjaDelDia(soloDomingo, 7)).toEqual({ abre: "08:00", cierra: "12:00" });
  });

  it("un día fuera de rango no revienta: es cerrado", () => {
    expect(franjaDelDia(LUNES_A_SABADO, 0)).toBeNull();
    expect(franjaDelDia(LUNES_A_SABADO, 8)).toBeNull();
    expect(franjaDelDia(LUNES_A_SABADO, 1.5)).toBeNull();
  });
});

describe("horarios distintos por día", () => {
  const variado: HorarioSemanal = {
    1: { abre: "08:00", cierra: "12:00" },
    3: { abre: "14:00", cierra: "20:00" },
    6: { abre: "09:00", cierra: "13:00" },
  };

  it("cada día conserva el suyo", () => {
    expect(franjaDelDia(variado, 1)).toEqual({ abre: "08:00", cierra: "12:00" });
    expect(franjaDelDia(variado, 3)).toEqual({ abre: "14:00", cierra: "20:00" });
    expect(franjaDelDia(variado, 6)).toEqual({ abre: "09:00", cierra: "13:00" });
  });

  it("los días que no se declararon están cerrados", () => {
    expect(diasAbiertos(variado)).toEqual([1, 3, 6]);
    for (const d of [2, 4, 5, 7]) expect(franjaDelDia(variado, d)).toBeNull();
  });
});

describe("desactivar un día borra su horario, no lo deja huérfano", () => {
  it("quitar el día es quitar la franja: no quedan dos datos que discrepen", () => {
    const conDomingo: HorarioSemanal = {
      ...LUNES_A_SABADO,
      7: { abre: "14:00", cierra: "19:00" },
    };
    // Así es como la UI apaga un día: borra su entrada. No hay un segundo
    // campo del que acordarse, que es justo lo que falló.
    const { 7: _quitado, ...sinDomingo } = conDomingo;
    void _quitado;

    expect(franjaDelDia(sinDomingo, 7)).toBeNull();
    // Y el derivado tampoco puede conservarla:
    expect(legacyDesdeHorarioSemanal(sinDomingo).abreDomingo).toBeNull();
    expect(columnasDesdeHorario(sinDomingo).hoursOpenSunday).toBeNull();
  });
});

describe("LEGACY → canónico: aquí se corrige el fallo exacto de Lis", () => {
  it("domingo fuera de `dias` + franja de domingo puesta → CERRADO", () => {
    /*
     * El estado real que tenía Lis en producción el 19-sep-2026. Antes, el
     * resolutor devolvía 14:00–19:00 y `businessStatus` decía "abierto"
     * saltándose la comprobación de días con `tieneDomingoPropio`.
     */
    const h = horarioSemanalDesdeLegacy({
      dias: "1,2,3,4,5,6",
      abre: "10:00",
      cierra: "19:00",
      abreDomingo: "14:00",
      cierraDomingo: "19:00",
    });
    expect(franjaDelDia(h, 7)).toBeNull();
    expect(diasAbiertos(h)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("domingo DENTRO de `dias` con franja propia → abre con la suya", () => {
    const h = horarioSemanalDesdeLegacy({
      dias: "1,2,3,4,5,6,7",
      abre: "10:00",
      cierra: "19:00",
      abreDomingo: "14:00",
      cierraDomingo: "19:00",
    });
    expect(franjaDelDia(h, 7)).toEqual({ abre: "14:00", cierra: "19:00" });
    expect(franjaDelDia(h, 1)).toEqual({ abre: "10:00", cierra: "19:00" });
  });

  it("domingo dentro de `dias` SIN franja propia → usa la común", () => {
    const h = horarioSemanalDesdeLegacy({
      dias: [1, 7],
      abre: "10:00",
      cierra: "19:00",
    });
    expect(franjaDelDia(h, 7)).toEqual({ abre: "10:00", cierra: "19:00" });
  });

  it("acepta la lista como array o como texto, y normaliza la hora", () => {
    const comoTexto = horarioSemanalDesdeLegacy({ dias: "1,2", abre: "9 AM", cierra: "7 PM" });
    const comoArray = horarioSemanalDesdeLegacy({ dias: [1, 2], abre: "09:00", cierra: "19:00" });
    expect(comoTexto).toEqual(comoArray);
  });

  it("sin horas no inventa nada: el día no abre", () => {
    expect(horarioSemanalDesdeLegacy({ dias: "1,2,3" })).toEqual({});
    expect(sinHorarioConfigurado(horarioSemanalDesdeLegacy({}))).toBe(true);
  });

  it("basura en los días se ignora, no tumba la lectura", () => {
    const h = horarioSemanalDesdeLegacy({
      dias: "1, x, 9, 2, 2",
      abre: "10:00",
      cierra: "19:00",
    });
    expect(diasAbiertos(h)).toEqual([1, 2]);
  });
});

describe("canónico → derivados: proyección con pérdida, nunca autoridad", () => {
  it("lunes a sábado uniforme se proyecta tal cual", () => {
    expect(legacyDesdeHorarioSemanal(LUNES_A_SABADO)).toEqual({
      dias: [1, 2, 3, 4, 5, 6],
      abre: "10:00",
      cierra: "19:00",
      abreDomingo: null,
      cierraDomingo: null,
    });
  });

  it("el domingo distinto sí llega a los campos de domingo", () => {
    const h = { ...LUNES_A_SABADO, 7: { abre: "14:00", cierra: "19:00" } };
    expect(legacyDesdeHorarioSemanal(h)).toMatchObject({
      dias: [1, 2, 3, 4, 5, 6, 7],
      abre: "10:00",
      cierra: "19:00",
      abreDomingo: "14:00",
      cierraDomingo: "19:00",
    });
  });

  it("el domingo IGUAL al resto no ensucia los campos de domingo", () => {
    const h = { ...LUNES_A_SABADO, 7: { abre: "10:00", cierra: "19:00" } };
    const l = legacyDesdeHorarioSemanal(h);
    expect(l.dias).toContain(7);
    expect(l.abreDomingo).toBeNull();
  });

  it("sin horario, las columnas quedan vacías: no se inventa uno", () => {
    expect(columnasDesdeHorario({})).toEqual({
      hoursDays: null,
      hoursOpen: null,
      hoursClose: null,
      hoursOpenSunday: null,
      hoursCloseSunday: null,
    });
  });

  it("ida y vuelta por el modelo viejo conserva lo que el viejo sabe expresar", () => {
    const l = legacyDesdeHorarioSemanal(LUNES_A_SABADO);
    expect(horarioSemanalDesdeLegacy(l)).toEqual(LUNES_A_SABADO);
  });
});

describe("horarioCanonico: `porDia` manda sobre los derivados", () => {
  it("con `porDia`, los campos viejos no se miran aunque discrepen", () => {
    const h = horarioCanonico({
      porDia: { "1": { abre: "08:00", cierra: "12:00" } },
      // Derivados podridos a propósito: no deben ganar nunca.
      dias: [1, 2, 3, 4, 5, 6, 7],
      abre: "00:00",
      cierra: "23:59",
      abreDomingo: "14:00",
      cierraDomingo: "19:00",
    });
    expect(diasAbiertos(h)).toEqual([1]);
    expect(franjaDelDia(h, 7)).toBeNull();
  });

  it("`porDia: {}` significa SIN horario, no 'cae a los viejos'", () => {
    // Un negocio que apagó todos sus días es un dato, no un hueco.
    const h = horarioCanonico({ porDia: {}, dias: [1, 2], abre: "10:00", cierra: "19:00" });
    expect(sinHorarioConfigurado(h)).toBe(true);
  });

  it("sin `porDia` cae a los campos viejos, ya corregidos", () => {
    const h = horarioCanonico({
      dias: "1,2,3,4,5,6",
      abre: "10:00",
      cierra: "19:00",
      abreDomingo: "14:00",
      cierraDomingo: "19:00",
    });
    expect(franjaDelDia(h, 7)).toBeNull();
  });
});

describe("horarioNormalizado: los derivados se reescriben desde el canónico", () => {
  it("guardar deja canónico y derivados diciendo lo mismo", () => {
    const n = horarioNormalizado({ ...LUNES_A_SABADO, 7: { abre: "14:00", cierra: "19:00" } });
    expect(Object.keys(n.porDia)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(n.dias).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(n.abreDomingo).toBe("14:00");
  });

  it("apagar el domingo borra sus derivados en el mismo acto", () => {
    const n = horarioNormalizado(LUNES_A_SABADO);
    expect(n.porDia["7"]).toBeUndefined();
    expect(n.abreDomingo).toBeUndefined();
    expect(n.cierraDomingo).toBeUndefined();
  });
});

describe("horarioDeLaFila: el orden de autoridad, de arriba abajo", () => {
  const fichaConPorDia = JSON.stringify({
    horario: { porDia: { "1": { abre: "08:00", cierra: "12:00" } } },
  });

  it("1º la ficha canónica, aunque las columnas digan otra cosa", () => {
    const h = horarioDeLaFila({
      ficha: fichaConPorDia,
      hoursDays: "1,2,3,4,5,6,7",
      hoursOpen: "10:00",
      hoursClose: "19:00",
    });
    expect(diasAbiertos(h)).toEqual([1]);
  });

  it("2º las columnas: son lo que producción usa hoy, aunque la ficha vieja diga otra cosa", () => {
    /*
     * CASO REAL — Lashes Valen: su ficha dice `cierra: "22:30"` y su columna
     * `hours_close = "18:30"`. Alguien corrigió el cierre a mano el
     * 15-ago-2026 y la respuesta del cuestionario se quedó como estaba; el
     * motor de citas lleva desde entonces usando las 18:30.
     *
     * Si la ficha vieja ganara, el día del despliegue le abriríamos la agenda
     * cuatro horas de más sin que nadie lo pidiera. Una migración no puede
     * cambiarle el horario a nadie.
     */
    const h = horarioDeLaFila({
      ficha: JSON.stringify({
        horario: { dias: [1, 2, 3, 4, 5, 6], abre: "09:30", cierra: "22:30" },
      }),
      hoursDays: "1,2,3,4,5,6",
      hoursOpen: "09:30",
      hoursClose: "18:30",
    });
    expect(franjaDelDia(h, 1)).toEqual({ abre: "09:30", cierra: "18:30" });
  });

  it("3º la ficha vieja, solo si no hay columnas (configurado y nunca aplicado)", () => {
    const h = horarioDeLaFila({
      ficha: JSON.stringify({ horario: { dias: [1, 2], abre: "10:00", cierra: "19:00" } }),
    });
    expect(diasAbiertos(h)).toEqual([1, 2]);
    expect(franjaDelDia(h, 1)).toEqual({ abre: "10:00", cierra: "19:00" });
  });

  it("las columnas también se leen para quien NO tiene ficha", () => {
    const h = horarioDeLaFila({
      ficha: null,
      hoursDays: "1,2,3,4,5,6",
      hoursOpen: "10:00",
      hoursClose: "19:00",
      hoursOpenSunday: "14:00",
      hoursCloseSunday: "19:00",
    });
    // Y también ahí el domingo huérfano queda fuera.
    expect(franjaDelDia(h, 7)).toBeNull();
    expect(diasAbiertos(h)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("una ficha rota no tumba el horario: se cae a las columnas", () => {
    const h = horarioDeLaFila({
      ficha: "{ esto no es json",
      hoursDays: "1",
      hoursOpen: "10:00",
      hoursClose: "19:00",
    });
    expect(diasAbiertos(h)).toEqual([1]);
  });

  it("sin ficha y sin columnas: sin horario configurado, no 'cerrado siempre'", () => {
    expect(sinHorarioConfigurado(horarioDeLaFila({ ficha: null }))).toBe(true);
  });

  it("lee la ficha por secciones igual que la plana", () => {
    const h = horarioDeLaFila({
      ficha: JSON.stringify({
        negocio: { horario: { porDia: { "6": { abre: "09:00", cierra: "13:00" } } } },
      }),
    });
    expect(diasAbiertos(h)).toEqual([6]);
  });
});

describe("multi-tenant: cada negocio con el suyo, sin nada compartido", () => {
  it("dos horarios completamente distintos no se interfieren", () => {
    const a = horarioDeLaFila({
      ficha: JSON.stringify({ horario: { porDia: { "1": { abre: "06:00", cierra: "10:00" } } } }),
    });
    const b = horarioDeLaFila({
      ficha: JSON.stringify({ horario: { porDia: { "7": { abre: "18:00", cierra: "23:00" } } } }),
    });
    expect(diasAbiertos(a)).toEqual([1]);
    expect(diasAbiertos(b)).toEqual([7]);
    expect(franjaDelDia(a, 7)).toBeNull();
    expect(franjaDelDia(b, 1)).toBeNull();
  });
});

// ───────── EL CANÓNICO TIENE QUE SOBREVIVIR AL VIAJE ENTERO

describe("`porDia` no se pierde por el camino", () => {
  it("fusionar y reserializar la ficha lo conserva", async () => {
    /*
     * Un campo nuevo se pierde en silencio en dos sitios: el validador de la
     * API (zod descarta lo que no declara) y el lector/fusionador de la
     * ficha. Ya pasó con `duracionTipicaMin`, que está documentado en
     * `api/onboarding` — todos los servicios nacían con la duración por
     * defecto y nadie se enteró. Si `porDia` se cayera aquí, el horario que
     * la persona marca día a día no llegaría nunca al backend y el rediseño
     * entero sería decorativo.
     */
    const { fusionarFicha, leerFicha, serializarComoEstaba } = await import(
      "@/server/ai/generador/leer-ficha"
    );
    const conPorDia = {
      horario: horarioNormalizado({ 1: { abre: "08:00", cierra: "12:00" } }),
    } as unknown as Parameters<typeof fusionarFicha>[1];

    const { ficha } = fusionarFicha(null, conPorDia, ["negocio"]);
    expect(ficha.horario?.porDia).toEqual({ "1": { abre: "08:00", cierra: "12:00" } });

    const serializada = serializarComoEstaba(null, ficha);
    expect(horarioCanonico(leerFicha(serializada)?.horario)).toEqual({
      1: { abre: "08:00", cierra: "12:00" },
    });
  });

  it("y sobrevive también a la forma por secciones", async () => {
    const { aSecciones, aplanar } = await import("@/server/ai/generador/leer-ficha");
    const plana = {
      horario: horarioNormalizado({ 6: { abre: "09:00", cierra: "13:00" } }),
    } as unknown as Parameters<typeof aSecciones>[0];
    expect(horarioCanonico(aplanar(aSecciones(plana)).horario)).toEqual({
      6: { abre: "09:00", cierra: "13:00" },
    });
  });
});

// ────────── H-3: LAS COLUMNAS NO SABEN EXPRESAR UN HORARIO POR DÍA

describe("el auditor avisa cuando el canónico no cabe en las columnas", () => {
  it("con franjas distintas por día, lo dice (aunque no haya contradicción)", async () => {
    /*
     * H-3 de la auditoría del 20-sep-2026. Las columnas solo saben una franja
     * para toda la semana: con lun 08:00-12:00 y sáb 14:00-22:00 escriben
     * 08:00-12:00 y el sábado se pierde. No es una contradicción —canónico y
     * derivados "coinciden" en lo poco que los derivados saben decir—, así
     * que el chequeo de desalineación lo da por bueno. Importa mientras siga
     * habiendo código leyendo columnas: ese código ofrecería el sábado hasta
     * las 12:00.
     */
    const { incoherenciasDeHorario } = await import("@/server/horario-auditoria");
    const porDia = { 1: { abre: "08:00", cierra: "12:00" }, 6: { abre: "14:00", cierra: "22:00" } };
    const fila = {
      ficha: JSON.stringify({ horario: horarioNormalizado(porDia) }),
      ...columnasDesdeHorario(porDia),
    };
    const tipos = incoherenciasDeHorario(fila).map((f) => f.tipo);
    expect(tipos).toContain("derivados_con_perdida");
    // Avisa, no bloquea: no hay nada roto, hay algo que las columnas no saben.
    expect(incoherenciasDeHorario(fila).filter((f) => f.bloqueante)).toEqual([]);
  });

  it("un horario uniforme NO dispara el aviso", async () => {
    const { incoherenciasDeHorario } = await import("@/server/horario-auditoria");
    const fila = {
      ficha: JSON.stringify({ horario: horarioNormalizado(LUNES_A_SABADO) }),
      ...columnasDesdeHorario(LUNES_A_SABADO),
    };
    expect(incoherenciasDeHorario(fila).map((f) => f.tipo)).not.toContain("derivados_con_perdida");
  });

  it("el domingo con franja propia tampoco: para eso están sus columnas", async () => {
    const { incoherenciasDeHorario } = await import("@/server/horario-auditoria");
    const porDia = { ...LUNES_A_SABADO, 7: { abre: "14:00", cierra: "19:00" } };
    const fila = {
      ficha: JSON.stringify({ horario: horarioNormalizado(porDia) }),
      ...columnasDesdeHorario(porDia),
    };
    expect(incoherenciasDeHorario(fila).map((f) => f.tipo)).not.toContain("derivados_con_perdida");
  });
});
