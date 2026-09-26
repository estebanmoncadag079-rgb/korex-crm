/**
 * Las decisiones de la migración del doc 200, negocio por negocio. Módulo aparte
 * para que las use tanto `migrar-ficha-200.ts` (escribe) como
 * `probar-escenarios.ts` con FICHA_MIGRADA=1 (en memoria, sin escribir).
 */
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

type Ficha = Partial<FichaDelNegocio>;
type Cambio = { campo: string; antes: unknown; despues: unknown; porque: string };

const sinVacios = (l?: string[]) => (l ?? []).filter((x) => x.trim().length > 0);

/** Limpieza común: líneas vacías sueltas en listas (no cambian nada del comportamiento). */
function limpiar(f: Ficha, cambios: Cambio[]): Ficha {
  const out = { ...f };
  for (const campo of ["reglasPropias", "nuncaPrometer", "escalarSiempre"] as const) {
    const antes = f[campo];
    if (!antes) continue;
    const despues = sinVacios(antes);
    if (despues.length !== antes.length) {
      out[campo] = despues;
      cambios.push({ campo, antes: `${antes.length} líneas`, despues: `${despues.length} líneas`, porque: "se quitan líneas vacías" });
    }
  }
  return out;
}

/** Decisiones explícitas por negocio. Cada una cita de dónde sale. */
export const DECISIONES: Record<string, (f: Ficha, c: Cambio[]) => Ficha> = {
  // MALIA: "Transferencia y efectivo pero solo recogiendo en planta, para los domicilios solo recibimos transferencia"
  org_kf1suh8q9dtbmcq3f3ba: (f, c) => {
    const porModalidad = { domicilio: ["transferencia" as const], recoger: ["transferencia" as const, "efectivo" as const] };
    c.push({ campo: "pago.porModalidad", antes: f.pago?.porModalidad, despues: porModalidad, porque: `formas: «${f.pago?.formas}»` });
    return { ...f, pago: { ...f.pago!, porModalidad } };
  },

  // Lis
  org_lispasteleria0001: (f, c) => {
    // "Transferencia bancaria — incluye Bancolombia, Nequi y pago por llave. No se recibe efectivo"
    const porModalidad = { domicilio: ["transferencia" as const], recoger: ["transferencia" as const] };
    c.push({ campo: "pago.porModalidad", antes: f.pago?.porModalidad, despues: porModalidad, porque: `formas: «${f.pago?.formas}»` });

    // nuncaPrometer: "Dar los datos de la cuenta antes de la confirmación." → opción de la ficha
    const REGLA_CUENTA = "Dar los datos de la cuenta antes de la confirmación.";
    const nunca = (f.nuncaPrometer ?? []).filter((x) => x.trim() !== REGLA_CUENTA);
    const pasaCuenta = nunca.length !== (f.nuncaPrometer ?? []).length;
    if (pasaCuenta) {
      c.push({ campo: "pago.cuentaAntesDeConfirmar", antes: f.pago?.cuentaAntesDeConfirmar, despues: "nunca", porque: `nuncaPrometer: «${REGLA_CUENTA}»` });
      c.push({ campo: "nuncaPrometer", antes: `«${REGLA_CUENTA}»`, despues: "(pasa a la opción de arriba)", porque: "un solo lugar para lo mismo" });
    }

    // reglasPropias "## CÓMO ESCRIBES …" → al trato, donde manda
    const reglas = f.reglasPropias ?? [];
    const comoEscribe = reglas.find((r) => r.trimStart().startsWith("## CÓMO ESCRIBES"));
    let tono = f.tono;
    if (comoEscribe) {
      const cuerpo = comoEscribe.replace(/^\s*## CÓMO ESCRIBES\s*/, "").trim();
      tono = `${(f.tono ?? "").trim()}\n\n${cuerpo}`;
      c.push({ campo: "tono", antes: "(solo el trato)", despues: "trato + «CÓMO ESCRIBES»", porque: "era una regla propia sobre cómo escribir: va al trato, que manda" });
    }
    // "Tenes domicilios por rappi, este es el link …" repite `canales` (mismo enlace)
    const RAPPI = "https://rappi.app.link/Lis_Pasteleria";
    const repiteCanal = (r: string) => r.includes(RAPPI) && (f.canales ?? []).some((k) => k.enlace === RAPPI);
    const reglasNuevas = reglas.filter((r) => r !== comoEscribe && !repiteCanal(r));
    if (reglas.some(repiteCanal)) {
      c.push({ campo: "reglasPropias", antes: "«Tenes domicilios por rappi, … link»", despues: "(ya está en otros canales)", porque: "repetía el mismo enlace de `canales`" });
    }
    return {
      ...f,
      tono,
      reglasPropias: reglasNuevas,
      nuncaPrometer: nunca,
      pago: { ...f.pago!, porModalidad, ...(pasaCuenta ? { cuentaAntesDeConfirmar: "nunca" as const } : {}) },
    };
  },

  // La Churra: formas "Bancolombia" (solo transferencia declarada); "Tambien tenemo pedidos por rappi."
  org_lo5gdlt6k43z9fg1ling: (f, c) => {
    const porModalidad = { domicilio: ["transferencia" as const], recoger: ["transferencia" as const] };
    c.push({ campo: "pago.porModalidad", antes: f.pago?.porModalidad, despues: porModalidad, porque: `formas: «${f.pago?.formas}» (solo transferencia declarada)` });
    const reglas = f.reglasPropias ?? [];
    const esRappi = (r: string) => /pedidos por rappi/i.test(r);
    let canales = f.canales;
    if (reglas.some(esRappi) && !(f.canales ?? []).some((k) => /rappi/i.test(k.nombre))) {
      canales = [...(f.canales ?? []), { nombre: "Rappi" }];
      c.push({ campo: "canales", antes: f.canales ?? "(ninguno)", despues: canales, porque: "regla propia «Tambien tenemo pedidos por rappi.» (sin enlace: no lo dieron)" });
    }
    return { ...f, canales, reglasPropias: reglas.filter((r) => !esRappi(r)), pago: { ...f.pago!, porModalidad } };
  },

  // Lashes Valen (citas): nada que acomodar más allá de la limpieza.
  org_novxv78s08h12arzatr2: (f) => f,
};

export function acomodar(orgId: string, f: Ficha): { ficha: Ficha; cambios: Cambio[] } {
  const cambios: Cambio[] = [];
  const decidir = DECISIONES[orgId] ?? ((x: Ficha) => x);
  return { ficha: limpiar(decidir(f, cambios), cambios), cambios };
}

