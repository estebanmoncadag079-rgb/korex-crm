import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { normalizarHora } from "@/lib/hora";
import { faltantesDeLaFicha, type FichaDelNegocio } from "./ficha";
import {
  fusionarFicha,
  serializarComoEstaba,
  type Seccion,
} from "./leer-ficha";
import { generarPerfil } from "./generar";

/**
 * Deja un cliente configurado a partir de su ficha, en una sola operación.
 *
 * Es la mitad del alta que hasta ahora se hacía **a mano por SQL** (pasos 3 a 6
 * de [05-CLIENTES.md]): el prompt, el horario, los teléfonos de aviso y el
 * conocimiento. Eran cuatro comandos sueltos que había que recordar, y olvidar
 * uno dejaba al cliente a medio configurar sin que nada avisara.
 *
 * Todo va en **una transacción**: si algo falla, no queda un cliente con el
 * prompt puesto y el horario sin poner, que es el peor estado posible — el
 * agente atendería creyendo que siempre está abierto.
 */

export type ResultadoDelAlta = {
  organizationId: string;
  /** Caracteres del prompt generado, para enseñarlo en la pantalla. */
  largoDelPrompt: number;
  /**
   * Cuántas preguntas frecuentes se sembraron. **0 si el cliente ya tenía
   * conocimiento**: en ese caso no se toca nada (ver `aplicarFicha`).
   */
  entradasDeConocimiento: number;
  /**
   * Presente cuando la ficha y lo contratado en `/admin` **no coinciden** en el
   * vertical de citas. Antes esto no existía porque la ficha simplemente
   * sobrescribía lo contratado; ahora se avisa y decide una persona.
   */
  avisoDeVertical?: string;
  /**
   * Secciones que este llamante NO podía escribir y se conservaron tal cual.
   * Sirve para que quien envía el cuestionario sepa que sus reglas de flujo
   * siguen ahí en vez de suponerlo.
   */
  seccionesConservadas: string[];
};

/**
 * El borrador de la ficha, mientras el cliente la va llenando.
 *
 * Se guarda en `organization.metadata` (que ya existe y es JSON) para no añadir
 * una tabla por algo que se usa una vez en la vida de cada cliente.
 *
 * Existe porque el formulario se llena **por etapas y a lo largo de días**: un
 * dueño de negocio no se sienta 40 minutos a responder de un tirón. Sin
 * guardado parcial cierra la pestaña en la etapa 4, lo pierde todo y no vuelve.
 */
export async function guardarBorrador(
  organizationId: string,
  borrador: Partial<FichaDelNegocio>
): Promise<void> {
  const db = getDb();
  const filas = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);

  // Se conserva lo que ya hubiera en metadata (la marca white-label vive ahí):
  // esto AÑADE una clave, no reemplaza el objeto entero.
  let meta: Record<string, unknown> = {};
  try {
    meta = filas[0]?.metadata ? JSON.parse(filas[0].metadata) : {};
  } catch {
    meta = {};
  }

  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify({ ...meta, fichaBorrador: borrador }) })
    .where(eq(schema.organization.id, organizationId));
}

/** El borrador guardado, o `{}` si aún no hay nada. */
export async function leerBorrador(
  organizationId: string
): Promise<Partial<FichaDelNegocio>> {
  const db = getDb();
  const filas = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  try {
    const meta = filas[0]?.metadata
      ? (JSON.parse(filas[0].metadata) as Record<string, unknown>)
      : {};
    return (meta.fichaBorrador as Partial<FichaDelNegocio>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Aplica la ficha sobre una organización que ya existe.
 *
 * La organización y su dueño se crean antes con `createClientWithOwner`, que ya
 * deja el `agent_profile` vacío y las etapas del pipeline puestas.
 *
 * ⚠️ **El agente queda APAGADO** (`enabled: false`). Encenderlo es un acto
 * deliberado y va después de probar: es el paso 8 del alta, y saltárselo fue lo
 * que enseñó `05-CLIENTES.md` que no hay que hacer. Un agente que empieza a
 * responder antes de que nadie haya visto una conversación de prueba es un
 * cliente enfadado esperando a que pase.
 */
export async function aplicarFicha(
  organizationId: string,
  fichaEntrante: FichaDelNegocio,
  opciones?: {
    telefonosDeAviso?: string[];
    /**
     * Qué secciones puede escribir QUIEN LLAMA. Por defecto, solo `negocio`:
     * es lo que el cliente responde en su cuestionario.
     *
     * `flujo` y `politicas` son del operador —el orden de los mensajes y las
     * reglas que se escriben después de un incidente—, y el cuestionario no
     * puede tocarlas. Desde `/admin` se pasan las tres, porque ahí quien actúa
     * es la agencia.
     */
    puedeEscribir?: readonly Seccion[];
  }
): Promise<ResultadoDelAlta> {
  const faltan = faltantesDeLaFicha(fichaEntrante);
  if (faltan.length > 0) {
    throw new Error(`Faltan datos en la ficha: ${faltan.join(", ")}.`);
  }

  const db = getDb();

  /*
   * NADIE sobrescribe el objeto entero.
   *
   * Hasta el 15-ago-2026 esta función escribía la ficha completa, y el script
   * del operador también: el último ganaba en silencio. Así perdió La Churra
   * sus reglas de flujo a las 12:59, y el síntoma —tres horas más tarde— fue
   * "el bot dejó de hacer caso".
   *
   * Ahora se lee lo guardado y se fusiona por secciones: se escribe solo lo
   * que este llamante posee y se conserva el resto.
   */
  const guardada = await db
    .select({
      ficha: schema.agentProfile.ficha,
      catalogSource: schema.agentProfile.catalogSource,
      hoursOpen: schema.agentProfile.hoursOpen,
      hoursClose: schema.agentProfile.hoursClose,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const fichaCruda = guardada[0]?.ficha ?? null;
  /** Con horario ya puesto, esto es un reenvío: no se toca. */
  const horarioYaConfigurado = Boolean(
    guardada[0]?.hoursOpen?.trim() && guardada[0]?.hoursClose?.trim()
  );

  const { ficha, conservadas } = fusionarFicha(
    fichaCruda,
    fichaEntrante,
    opciones?.puedeEscribir ?? ["negocio"]
  );

  /*
   * `catalogoEnTabla` NO es opcional aquí, y olvidarlo costó un prompt.
   *
   * Esta función nunca se enteró de la Fase 1: seguía embebiendo el catálogo en
   * el prompt aunque el cliente ya lo tuviera en `product`. Como nadie había
   * reenviado el cuestionario de La Churra desde que se encendió su bandera, el
   * fallo estuvo latente — hasta que la prueba de conversión lo destapó: su
   * prompt pasó de 17.355 a 18.053 caracteres, con la carta duplicada (una en
   * el texto y otra que el pipeline inyecta desde las tablas).
   */
  const perfil = generarPerfil(ficha, {
    catalogoEnTabla: guardada[0]?.catalogSource === "tabla",
  });

  /*
   * ¿Coincide lo que dice la ficha con lo que la agencia contrató?
   *
   * Antes esto no se preguntaba: se sobrescribía `appointmentsEnabled` con lo
   * que dijera la ficha. Ahora se compara y, si difieren, se devuelve el aviso
   * para que alguien lo mire — que es lo que se hace con un desacuerdo entre
   * dos fuentes, en vez de dejar ganar a la última que escribe.
   */
  const antes = await db
    .select({ appointmentsEnabled: schema.agentProfile.appointmentsEnabled })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const contratadoConCitas = antes[0]?.appointmentsEnabled ?? false;
  const fichaDiceCitas = ficha.vertical === "citas";
  const avisoDeVertical =
    contratadoConCitas === fichaDiceCitas
      ? undefined
      : fichaDiceCitas
        ? "La ficha dice que este negocio agenda citas, pero en /admin no tiene el vertical de citas activado."
        : "En /admin este negocio tiene el vertical de citas activado, pero su ficha no es de citas.";

  const preguntas = (ficha.preguntasFrecuentes ?? []).filter(
    (p) => p.pregunta.trim() && p.respuesta.trim()
  );
  /** Cuántas se sembraron de verdad: 0 si el cliente ya tenía conocimiento. */
  let sembradas = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.agentProfile)
      .set({
        name: `Asistente de ${ficha.nombre}`,
        tone: ficha.tono.trim(),
        instructions: perfil.instructions,
        escalationRules: perfil.escalationRules,
        greeting: perfil.greeting,
        /*
         * EL HORARIO SOLO SE ESCRIBE EN EL ALTA.
         *
         * Las columnas `hours*` son la fuente canónica: las leen el pipeline,
         * el prompt y el motor de citas. `ficha.horario` es lo que el cliente
         * respondió el día del alta — un registro histórico, no un dato
         * operativo.
         *
         * Reescribirlas en cada reenvío del cuestionario revirtió el horario
         * del salón el 15-ago a las 19:46:41: alguien lo había corregido a
         * 9:30–18:30 y volvió a 9:00–20:00 sin que nada avisara. El agente
         * habría ofrecido citas a las 19:00 con el salón cerrado.
         *
         * En el alta sí se escriben —si no, un negocio nuevo nace sin horario y
         * el agente cree que siempre está abierto—, y a partir de ahí solo las
         * cambia su dueño.
         */
        ...(horarioYaConfigurado
          ? {}
          : {
              hoursDays: ficha.horario.dias.join(","),
              // Normalizado a "HH:MM": el cliente escribe "9 AM" y el motor de
              // citas necesita "09:00". El texto crudo dejaba la agenda sin un
              // solo hueco, en silencio (ver `lib/hora.ts`).
              hoursOpen: normalizarHora(ficha.horario.abre) ?? ficha.horario.abre,
              hoursClose: normalizarHora(ficha.horario.cierra) ?? ficha.horario.cierra,
              hoursOpenSunday: normalizarHora(ficha.horario.abreDomingo) ?? null,
              hoursCloseSunday: normalizarHora(ficha.horario.cierraDomingo) ?? null,
            }),
        // Vacío es una decisión válida y hay que poder expresarla: Lis pidió
        // expresamente que no se avisara a ningún número, ni al suyo.
        //
        // Pero "no me pasaron teléfonos" no es lo mismo que "no quiero
        // ninguno": si no vienen en las opciones se deja lo que ya hubiera, o
        // reenviar el cuestionario borraría los avisos que el negocio configuró
        // en su pantalla. Es el mismo borrado silencioso que tenía el
        // conocimiento aquí abajo.
        ...(opciones?.telefonosDeAviso
          ? { notifyPhones: opciones.telefonosDeAviso.join(",") || null }
          : {}),
        /*
         * NI `enabled` NI `appointmentsEnabled` se escriben aquí: los dos
         * tienen otro dueño y escribirlos era pisarle el trabajo.
         *
         * - `enabled` es del CLIENTE, desde su panel. Forzarlo a `false`
         *   significaba que un negocio que ya estaba vendiendo **se apagaba
         *   solo** al reenviar el cuestionario. Y no hace falta para que un
         *   alta nazca apagada: la columna ya tiene `default(false)`.
         * - `appointmentsEnabled` es de la AGENCIA, desde `/admin`, que es
         *   quien contrata el vertical y ya lo escribe en `provisioning.ts`.
         *   Deducirlo de la ficha lo sobrescribía sin avisar.
         *
         * Si la ficha y lo contratado no coinciden se AVISA (`avisoDeVertical`):
         * un desacuerdo se reporta, no se resuelve pisando al otro.
         */
        /*
         * La ficha se guarda para poder REGENERAR el prompt.
         *
         * Antes se perdía al terminar el alta, y con ella la posibilidad de que
         * una lección nueva llegara a los clientes que ya existían: `conducta.ts`
         * mejoraba y solo lo heredaba el siguiente. Con la ficha guardada,
         * `pnpm regenerar:flota` vuelve a ensamblar el prompt de todos.
         */
        // En el MISMO formato en que estaba: rellenar un formulario no puede
        // convertirle los datos a nadie. La conversión es un acto explícito.
        ficha: serializarComoEstaba(fichaCruda, ficha),
        updatedAt: new Date(),
      })
      .where(eq(schema.agentProfile.organizationId, organizationId));

    /*
     * El conocimiento SOLO se siembra, nunca se reemplaza.
     *
     * Hasta el 15-ago-2026 esto borraba `kb_entry` entero y lo reponía desde la
     * ficha, con el argumento de que no convivieran dos versiones del mismo
     * dato. El efecto real era el contrario: **la pantalla de Conocimiento y el
     * cuestionario preguntaban lo mismo, y el cuestionario ganaba en silencio.**
     *
     * Lo que costó: a Lashes Valen se le corrigió a mano una respuesta que
     * prometía que la extensión de pestañas no irrita los ojos —en un asunto de
     * salud, lo que la conducta prohíbe—, se verificó contra el agente real y se
     * dio por cerrada. Al enviar el cuestionario, la respuesta vieja volvió: la
     * corrección se había hecho en la KB y no en la ficha. Nadie se enteró
     * porque el borrado no deja rastro ni aviso.
     *
     * Es el mismo razonamiento que ya se aplicó al catálogo unas líneas más
     * abajo, y la misma conclusión: **una sola fuente de verdad**. Aquí esa
     * fuente es la pantalla de Conocimiento, porque el conocimiento crece con el
     * negocio (dirección, parqueadero, cancelación, retardos) en vez de llenarse
     * una vez el día del alta.
     */
    const yaTieneConocimiento = await tx
      .select({ id: schema.kbEntry.id })
      .from(schema.kbEntry)
      .where(eq(schema.kbEntry.organizationId, organizationId))
      .limit(1);

    if (yaTieneConocimiento.length === 0 && preguntas.length > 0) {
      await tx.insert(schema.kbEntry).values(
        preguntas.map((p) => ({
          id: newId("kbEntry"),
          organizationId,
          kind: "qa" as const,
          question: p.pregunta.trim(),
          answer: p.respuesta.trim(),
        }))
      );
      sembradas = preguntas.length;
    }

    /*
     * Aquí NO se crean servicios.
     *
     * El catálogo de un negocio de citas vive en la tabla `service` —con su
     * duración y con quién atiende cada uno— y se carga entero en la pantalla
     * de Servicios: PDF, foto o lista pegada, con su tabla de revisión y el
     * reparto entre especialistas. El alta llegó a pedirlo también, y eso
     * significaba cargarlo dos veces y que una de las dos copias empezara a
     * quedarse vieja el mismo día.
     *
     * `generar.ts` ya excluye el catálogo del prompt en este vertical por la
     * misma razón: una sola fuente de verdad.
     */
  });

  return {
    organizationId,
    largoDelPrompt: perfil.instructions.length,
    entradasDeConocimiento: sembradas,
    avisoDeVertical,
    seccionesConservadas: conservadas,
  };
}
