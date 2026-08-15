/**
 * El guardarraíl que decide si un cliente se puede convertir — o si se aborta.
 *
 * Exigido por el dueño antes de migrar a nadie (15-ago-2026): la conversión de
 * la ficha **no puede cambiar nada de lo que ve el cliente ni de lo que decide
 * la agencia**. Se comprueban tres cosas y basta con que falle una:
 *
 *   1. El prompt recompilado es **idéntico** al guardado.
 *   2. `enabled` no cambia — es del cliente, y apagarle el agente sin querer es
 *      exactamente el fallo que se acaba de corregir.
 *   3. `appointmentsEnabled` no cambia — es de la agencia.
 *
 * No es una comprobación de estilo: es la diferencia entre una migración y una
 * pérdida silenciosa. Ya hubo una, y el síntoma fue *"el bot dejó de hacer
 * caso"* tres horas más tarde.
 */

export type EstadoDelPerfil = {
  instructions: string | null;
  greeting: string | null;
  escalationRules: string | null;
  enabled: boolean;
  appointmentsEnabled: boolean;
};

export type Comprobacion = {
  /** `false` = NO migrar a este cliente. */
  ok: boolean;
  fallos: string[];
  detalle: {
    prompt: boolean;
    saludo: boolean;
    escalado: boolean;
    enabled: boolean;
    appointmentsEnabled: boolean;
  };
};

/** Primera línea distinta, para explicar el fallo sin volcar 17.000 caracteres. */
function primeraDiferencia(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return `línea ${i + 1}: guardado ${JSON.stringify(la[i] ?? "(no existe)")} vs recompilado ${JSON.stringify(lb[i] ?? "(no existe)")}`;
    }
  }
  return "longitudes distintas sin línea divergente";
}

export function verificarAntesDeMigrar(
  antes: EstadoDelPerfil,
  despues: EstadoDelPerfil
): Comprobacion {
  const fallos: string[] = [];

  const prompt = (antes.instructions ?? "") === (despues.instructions ?? "");
  if (!prompt) {
    fallos.push(
      `el prompt recompilado NO es idéntico (${(antes.instructions ?? "").length} → ${(despues.instructions ?? "").length} caracteres) · ${primeraDiferencia(antes.instructions ?? "", despues.instructions ?? "")}`
    );
  }

  const saludo = (antes.greeting ?? "") === (despues.greeting ?? "");
  if (!saludo) fallos.push("el saludo recompilado NO es idéntico");

  const escalado = (antes.escalationRules ?? "") === (despues.escalationRules ?? "");
  if (!escalado) fallos.push("las reglas de escalado recompiladas NO son idénticas");

  const enabled = antes.enabled === despues.enabled;
  if (!enabled) {
    fallos.push(
      `\`enabled\` cambiaría de ${antes.enabled} a ${despues.enabled}: es del CLIENTE y la migración no puede tocarlo`
    );
  }

  const appointmentsEnabled = antes.appointmentsEnabled === despues.appointmentsEnabled;
  if (!appointmentsEnabled) {
    fallos.push(
      `\`appointmentsEnabled\` cambiaría de ${antes.appointmentsEnabled} a ${despues.appointmentsEnabled}: es de la AGENCIA y la migración no puede tocarlo`
    );
  }

  return {
    ok: fallos.length === 0,
    fallos,
    detalle: { prompt, saludo, escalado, enabled, appointmentsEnabled },
  };
}
