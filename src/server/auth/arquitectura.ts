/**
 * La arquitectura aprobada de `agent_profile`, por vertical — **una sola
 * fuente de verdad**, consumida tanto al dar de alta (`provisionOrganization`)
 * como al diagnosticar (`validarConfiguracionArquitectonica`).
 *
 * Nace del incidente real de Malía (28/29-ago-2026): entró con
 * `catalog_source='tabla'` pero `state_source` se quedó en `'prompt'` —nadie
 * corrió `pnpm fase2 --encender`— y el agente repetía preguntas que el
 * mecanismo de Fase 2 ya sabía resolver. La causa no era el agente: era que
 * `provisionOrganization()` solo decidía `appointmentsEnabled` y dejaba los
 * demás mecanismos en el valor más antiguo de la columna, a la espera de que
 * alguien se acordara de encenderlos a mano, cliente por cliente.
 *
 * Los cinco valores de abajo no son una preferencia: están respaldados por
 * clientes reales en producción sin incidentes (Lis y La Churra para
 * `catalog_source`/`state_source`; Lashes Valen para `state_source` en citas;
 * Lis para `payment_source`/`consultas_verificadas_enabled`), y los cuatro
 * mecanismos tienen apagado seguro ya construido cuando el negocio todavía no
 * tiene catálogo o ficha (`pipeline.ts`: cada uno cae solo al comportamiento
 * de `'prompt'`/`false` con un `console.warn`, nunca rompe). Por eso es
 * seguro fijarlos desde el primer segundo, antes de que exista un solo
 * producto: se activan solos en cuanto el negocio carga sus datos.
 *
 * `menu_mode` queda fuera a propósito: es una decisión de UX/negocio (menús
 * interactivos de WhatsApp), no una corrección de fiabilidad, y sigue siendo
 * opt-in igual que hoy.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { verticalDe, type Vertical } from "@/server/vertical";

export type ConfiguracionArquitectonica = {
  appointmentsEnabled: boolean;
  catalogSource: "prompt" | "tabla";
  stateSource: "prompt" | "backend";
  paymentSource: "prompt" | "ficha";
  consultasVerificadasEnabled: boolean;
};

export type CampoArquitectura = keyof ConfiguracionArquitectonica;

/**
 * Una regla por campo: si APLICA a este vertical, qué valor es el aprobado, y
 * qué tan grave es no tenerlo.
 *
 * `core` = mecanismo de fiabilidad (sin él, el agente se comporta peor con
 * clientes reales — es exactamente lo que le pasó a Malía con `stateSource`).
 * `recomendado` = mejora adicional, probada en al menos un cliente real, pero
 * sin el mismo respaldo todavía (`paymentSource`/`consultasVerificadasEnabled`,
 * hoy solo en Lis).
 */
type ReglaDeCampo<V> = {
  aplica: boolean;
  esperado: V;
  severidad: "core" | "recomendado";
};

type ReglasDeVertical = {
  [K in CampoArquitectura]: ReglaDeCampo<ConfiguracionArquitectonica[K]>;
};

/**
 * La matriz completa — el único lugar donde se decide qué es "arquitectura
 * aprobada" para cada vertical. `provisionOrganization` y
 * `validarConfiguracionArquitectonica` leen de aquí, nunca duplican la regla.
 */
const REGLAS: Record<Vertical, ReglasDeVertical> = {
  pedidos: {
    appointmentsEnabled: { aplica: true, esperado: false, severidad: "core" },
    catalogSource: { aplica: true, esperado: "tabla", severidad: "core" },
    stateSource: { aplica: true, esperado: "backend", severidad: "core" },
    paymentSource: { aplica: true, esperado: "ficha", severidad: "recomendado" },
    consultasVerificadasEnabled: { aplica: true, esperado: true, severidad: "recomendado" },
  },
  citas: {
    appointmentsEnabled: { aplica: true, esperado: true, severidad: "core" },
    stateSource: { aplica: true, esperado: "backend", severidad: "core" },
    // Los tres de abajo son conceptos de PEDIDOS (pipeline.ts los guarda tras
    // `!contrataCitas(vertical) && ...`): en citas no tienen ningún efecto,
    // así que "aprobado" es simplemente dejarlos en su valor neutro de
    // siempre. `validarConfiguracionArquitectonica` los marca "incompatible"
    // si alguna vez aparecen encendidos aquí — sería un dato suelto de otro
    // vertical, no una mejora.
    catalogSource: { aplica: false, esperado: "prompt", severidad: "core" },
    paymentSource: { aplica: false, esperado: "prompt", severidad: "recomendado" },
    consultasVerificadasEnabled: { aplica: false, esperado: false, severidad: "recomendado" },
  },
};

/**
 * La configuración con la que debe nacer HOY un cliente nuevo de este
 * vertical. La usa `provisionOrganization` para el `insert` completo de
 * `agent_profile` — nada de flags sueltos decididos aparte.
 */
export function arquitecturaAprobadaPara(vertical: Vertical): ConfiguracionArquitectonica {
  const reglas = REGLAS[vertical];
  return {
    appointmentsEnabled: reglas.appointmentsEnabled.esperado,
    catalogSource: reglas.catalogSource.esperado,
    stateSource: reglas.stateSource.esperado,
    paymentSource: reglas.paymentSource.esperado,
    consultasVerificadasEnabled: reglas.consultasVerificadasEnabled.esperado,
  };
}

export type EstadoArquitectura = "ALINEADO" | "ADVERTENCIA" | "INCONSISTENTE";

export type DiagnosticoArquitectura = {
  organizationId: string;
  vertical: Vertical;
  configuracionActual: ConfiguracionArquitectonica;
  configuracionEsperada: ConfiguracionArquitectonica;
  /** Campos que ya coinciden con lo aprobado (y sí aplican a este vertical). */
  alineados: CampoArquitectura[];
  /** Mecanismo CORE esperado y ausente — es lo que pone en INCONSISTENTE. */
  faltantes: CampoArquitectura[];
  /** Mecanismo recomendado esperado y ausente — solo baja a ADVERTENCIA. */
  advertencias: CampoArquitectura[];
  /** Un valor de OTRO vertical quedó encendido donde no tiene ningún efecto. */
  incompatibles: CampoArquitectura[];
  estado: EstadoArquitectura;
};

/**
 * La parte PURA del diagnóstico: dada una configuración ya leída, dice si
 * está alineada con la arquitectura aprobada de su vertical.
 *
 * Separada de la consulta (Fase 9, 19-sep-2026) para que el panel de agencia
 * pueda clasificar a TODOS los clientes con el JOIN que ya hace `listClients`,
 * sin una consulta por organización. La regla no se duplica: sigue viviendo
 * en `REGLAS`, y tanto esta función como `validarConfiguracionArquitectonica`
 * leen de ahí.
 */
export function diagnosticarConfiguracion(
  actual: ConfiguracionArquitectonica
): Omit<DiagnosticoArquitectura, "organizationId"> {
  const vertical = verticalDe(actual.appointmentsEnabled);
  const reglas = REGLAS[vertical];
  const esperada = arquitecturaAprobadaPara(vertical);

  const alineados: CampoArquitectura[] = [];
  const faltantes: CampoArquitectura[] = [];
  const advertencias: CampoArquitectura[] = [];
  const incompatibles: CampoArquitectura[] = [];

  for (const campo of Object.keys(reglas) as CampoArquitectura[]) {
    const regla = reglas[campo];
    const coincide = actual[campo] === regla.esperado;

    if (!regla.aplica) {
      if (!coincide) incompatibles.push(campo);
      continue;
    }

    if (coincide) alineados.push(campo);
    else if (regla.severidad === "core") faltantes.push(campo);
    else advertencias.push(campo);
  }

  const estado: EstadoArquitectura =
    faltantes.length > 0 || incompatibles.length > 0
      ? "INCONSISTENTE"
      : advertencias.length > 0
        ? "ADVERTENCIA"
        : "ALINEADO";

  return {
    vertical,
    configuracionActual: actual,
    configuracionEsperada: esperada,
    alineados,
    faltantes,
    advertencias,
    incompatibles,
    estado,
  };
}

/**
 * Diagnóstico de SOLO LECTURA: compara la fila real de `agent_profile` contra
 * la matriz aprobada para su vertical. Nunca escribe, nunca "arregla" nada —
 * es el mismo principio que ya usa el resto del proyecto para separar
 * "detectar" de "corregir" (`migrar:catalogo`/`fase2` sin `--aplicar`/
 * `--encender` hacen exactamente esto: mostrar el plan, no ejecutarlo).
 *
 * `null` = esta organización no tiene `agent_profile` (no existe, o el alta
 * quedó a medias).
 */
export async function validarConfiguracionArquitectonica(
  organizationId: string
): Promise<DiagnosticoArquitectura | null> {
  const db = getDb();
  const filas = await db
    .select({
      appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
      catalogSource: schema.agentProfile.catalogSource,
      stateSource: schema.agentProfile.stateSource,
      paymentSource: schema.agentProfile.paymentSource,
      consultasVerificadasEnabled: schema.agentProfile.consultasVerificadasEnabled,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));

  const fila = filas[0];
  if (!fila) return null;

  const actual: ConfiguracionArquitectonica = {
    appointmentsEnabled: fila.appointmentsEnabled,
    catalogSource: fila.catalogSource as ConfiguracionArquitectonica["catalogSource"],
    stateSource: fila.stateSource as ConfiguracionArquitectonica["stateSource"],
    paymentSource: fila.paymentSource as ConfiguracionArquitectonica["paymentSource"],
    consultasVerificadasEnabled: fila.consultasVerificadasEnabled,
  };

  return { organizationId, ...diagnosticarConfiguracion(actual) };
}
