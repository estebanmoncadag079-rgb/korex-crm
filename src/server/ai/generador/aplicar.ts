import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import {
  columnasDesdeHorario,
  horarioCanonico,
  horarioNormalizado,
  horarioSemanalDesdeLegacy,
  sinHorarioConfigurado,
} from "@/server/horario";
import { faltantesDeLaFicha, type FichaDelNegocio } from "./ficha";
import { verticalDe } from "@/server/vertical";
import {
  fusionarFicha,
  leerFicha,
  serializarComoEstaba,
  type Seccion,
} from "./leer-ficha";
import { generarPerfil } from "./generar";
import { opcionesDeGeneracion, type OpcionesDeGeneracion } from "./fuentes";
import type { Fila } from "./comparar-fila";
import { conRegistro, type Actor } from "@/server/registro-de-cambios";

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

/**
 * Lo que el cuestionario debe mostrar: el borrador a medias si lo hay y, si no,
 * **la ficha que el agente está usando de verdad**.
 *
 * Antes devolvía `{}` cuando no había borrador, y eso rompía la promesa del
 * producto: un negocio configurado por script —los tres de agosto lo
 * fueron— abría "Cuéntanos sobre tu negocio" y lo veía **todo en blanco**,
 * mientras su agente contestaba con esa misma configuración. Si el CRM es la
 * fuente de verdad, no puede enseñar vacío lo que sí está puesto
 * (20-ago-2026).
 *
 * Y no era solo cosmético: al enviar, el cuestionario **reemplazaba la sección
 * entera**, así que partiendo de un formulario en blanco lo que no se volviera a
 * escribir —los regalos, las variantes, la ubicación— se perdía en silencio.
 * Precargar convierte el envío en lo que la persona cree que es: editar lo que
 * ya había.
 *
 * Ese segundo daño se cerró aparte el mismo día: `fusionarFicha` ya no
 * reemplaza la sección, la fusiona. Los dos arreglos son independientes y hacen
 * falta los dos — precargar sin fusionar deja el borrado a un despiste, y
 * fusionar sin precargar deja al cliente editando a ciegas.
 *
 * **Se FUSIONA, no se elige uno de los dos.** La ficha aplicada es la base y el
 * borrador va encima, campo por campo: lo que la persona estaba editando se
 * respeta, y todo lo que no tocó aparece como está. Elegir uno entero fallaba
 * por los dos lados — sin borrador se veía vacío, y con un borrador de un solo
 * campo (el que deja quien abre el formulario y escribe una cosa) se tapaba una
 * ficha completa.
 */
export function fusionarBorrador(
  aplicada: Partial<FichaDelNegocio>,
  borrador: Partial<FichaDelNegocio> | null | undefined
): Partial<FichaDelNegocio> {
  /*
   * La ficha aplicada es la BASE y el borrador va encima.
   *
   * No es lo mismo que devolver uno u otro, y las dos formas de equivocarse ya
   * ocurrieron el mismo día (20-ago-2026):
   *
   *   - devolver solo el borrador → sin borrador se ve todo vacío, y con un
   *     borrador de UN campo se tapa una ficha completa. Le pasó a un cliente
   *     real cuyo borrador tenía una sola regla escrita a medias;
   *   - devolver solo lo aplicado → se pierde lo que la persona estaba
   *     escribiendo ahora mismo.
   */
  return { ...aplicada, ...(borrador ?? {}) };
}

export async function leerBorrador(
  organizationId: string
): Promise<Partial<FichaDelNegocio>> {
  const db = getDb();
  const filas = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);

  let borrador: Partial<FichaDelNegocio> | null = null;
  try {
    const meta = filas[0]?.metadata
      ? (JSON.parse(filas[0].metadata) as Record<string, unknown>)
      : {};
    borrador = (meta.fichaBorrador as Partial<FichaDelNegocio>) ?? null;
  } catch {
    borrador = null;
  }
  const perfil = await db
    .select({ ficha: schema.agentProfile.ficha })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  // Lector tolerante: la ficha puede estar por secciones o plana, y el
  // cuestionario trabaja siempre con la forma plana.
  const aplicada = (leerFicha(perfil[0]?.ficha) as Partial<FichaDelNegocio> | null) ?? {};

  return fusionarBorrador(aplicada, borrador);
}

/**
 * Las fuentes de autoridad de un cliente, ya traducidas a opciones del
 * generador.
 *
 * Existe para que **la vista previa de /admin enseñe el prompt que de verdad
 * se va a guardar**. Hasta el 20-sep-2026 la vista previa solo pasaba el
 * vertical: a un cliente con `catalog_source='tabla'` le mostraba un prompt
 * con la carta dentro que después no se guardaba así. Un sitio donde se
 * revisa un prompt antes de aplicarlo es justo donde no puede mentir.
 */
export async function fuentesDelCliente(
  organizationId: string
): Promise<OpcionesDeGeneracion> {
  const [fila] = await getDb()
    .select({
      catalogSource: schema.agentProfile.catalogSource,
      paymentSource: schema.agentProfile.paymentSource,
      deliverySource: schema.agentProfile.deliverySource,
      menuMode: schema.agentProfile.menuMode,
      appointmentsEnabled: schema.agentProfile.appointmentsEnabled,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return opcionesDeGeneracion(fila ?? {});
}

/**
 * Aplica la ficha sobre una organización que ya existe.
 *
 * La organización y su dueño se crean antes con `createClientWithOwner`, que ya
 * deja el `agent_profile` vacío y las etapas del pipeline puestas.
 *
 * ⚠️ **Un alta nace con el agente APAGADO**, y encenderlo es un acto deliberado
 * que va después de probar: es el paso 8 del alta, y saltárselo fue lo que
 * enseñó `05-CLIENTES.md` que no hay que hacer. Un agente que responde antes de
 * que nadie haya visto una conversación de prueba es un cliente enfadado
 * esperando a que pase.
 *
 * Pero eso **no lo hace esta función**: lo hace `default(false)` en la columna.
 * Hasta el 16-ago aquí se forzaba `enabled: false` en cada llamada, y el efecto
 * era que un negocio que ya estaba vendiendo **se apagaba solo** al reenviar el
 * cuestionario. Nacer apagado y apagarse al reeditar no son la misma regla.
 */
export async function aplicarFicha(
  organizationId: string,
  fichaEntrante: FichaDelNegocio,
  opciones?: {
    telefonosDeAviso?: string[];
    /**
     * Qué secciones puede escribir QUIEN LLAMA. Por defecto, solo `negocio`.
     *
     * El defecto es conservador a propósito: quien no declara nada solo puede
     * tocar lo más inocuo. **No es lo que pasa el cuestionario**, que declara
     * las tres — pregunta el saludo y las reglas (`flujo`) y el paso de cuándo
     * escalar (`politicas`), y con el defecto los descartaba en silencio al
     * reeditar (20-ago-2026, [120]).
     *
     * Lo que sigue en pie es la otra mitad: **el script del operador no puede
     * tocar `negocio`**, que es del cliente.
     *
     * Y esto ya no es lo único que protege los datos ajenos: desde el 20-ago
     * una sección escribible **se fusiona** (`fusionarFicha`), así que omitir un
     * campo lo conserva y solo mandarlo vacío lo borra.
     */
    puedeEscribir?: readonly Seccion[];
    /** Quién ejecuta esto. Sin actor no hay trazabilidad que valga. */
    actor?: Actor;
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
      // Las cuatro columnas que deciden qué puede escribirse en el prompt. Se
      // leen JUNTAS y se traducen en un solo sitio (`opcionesDeGeneracion`):
      // leerlas sueltas es lo que dejó a `payment_source` ignorado durante
      // semanas mientras `migrar:pago` limpiaba y el generador reponía.
      catalogSource: schema.agentProfile.catalogSource,
      paymentSource: schema.agentProfile.paymentSource,
      deliverySource: schema.agentProfile.deliverySource,
      menuMode: schema.agentProfile.menuMode,
      // Las columnas del horario, para NO borrarlas si la ficha fusionada se
      // quedara sin él (ver `canonico` más abajo).
      hoursDays: schema.agentProfile.hoursDays,
      hoursOpen: schema.agentProfile.hoursOpen,
      hoursClose: schema.agentProfile.hoursClose,
      hoursOpenSunday: schema.agentProfile.hoursOpenSunday,
      hoursCloseSunday: schema.agentProfile.hoursCloseSunday,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const fichaCruda = guardada[0]?.ficha ?? null;

  const { ficha: fichaFusionada, conservadas } = fusionarFicha(
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
  // Qué contrató este negocio: es lo que manda.
  const antes = await db
    .select({ appointmentsEnabled: schema.agentProfile.appointmentsEnabled })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  /*
   * EL VERTICAL LO DECIDE LA COLUMNA, no la ficha (ver `@/server/vertical`).
   *
   * Antes esto solo AVISABA de la discrepancia y seguía adelante con lo que
   * dijera la ficha, así que un negocio podía acabar con un agente prometiendo
   * *"te agendo"* mientras la API rechazaba la reserva con un 403. Ahora la
   * ficha se corrige y se registra: `vertical` pasa a ser una copia derivada.
   */
  const contratado = verticalDe(antes[0]?.appointmentsEnabled);
  const avisoDeVertical =
    fichaFusionada.vertical === contratado
      ? undefined
      : `La ficha decía «${fichaFusionada.vertical}» y este negocio tiene contratado «${contratado}». ` +
        "Manda lo contratado: se corrigió la ficha. Si es un error, cámbialo en /admin.";
  /**
   * La ficha con su copia del vertical corregida **y el horario normalizado**.
   *
   * Normalizar aquí, en cada guardado, es lo que impide que el canónico
   * (`horario.porDia`) y sus derivados (`dias`, `abre`, `abreDomingo`) se
   * separen. Antes eran datos independientes y se separaron: Lis desmarcó el
   * domingo y su franja de domingo se quedó puesta, abriendo un día que ella
   * había cerrado (ver `@/server/horario`).
   */
  /*
   * El horario canónico que se va a guardar.
   *
   * Si la ficha fusionada se quedara SIN horario, no se borra el que el
   * negocio ya tenía: se conserva el de las columnas. La combinación que lo
   * exige es real aunque rara — un llamante que no puede escribir la sección
   * `negocio` hereda el horario guardado, y si ese estuviera vacío mientras
   * las columnas sí tienen datos, recalcular a ciegas dejaría al cliente sin
   * horario y al agente creyendo que siempre está abierto. Borrar un horario
   * tiene que ser un acto explícito, nunca el efecto colateral de guardar
   * otra cosa.
   */
  const deLaFicha = horarioCanonico(fichaFusionada.horario);
  /*
   * H-4 de la auditoría: la ficha que YA declaró su canónico manda, aunque
   * declare cero días. `porDia: {}` es "cierro toda la semana", no un hueco
   * — la misma semántica que `horarioDeLaFila`, y tenerla distinta aquí era
   * una contradicción esperando a que alguien permitiera cerrar los 7 días.
   */
  const fichaYaDeclaroSuCanonico =
    (fichaFusionada.horario as { porDia?: unknown } | undefined)?.porDia !== undefined;
  const canonico = !fichaYaDeclaroSuCanonico && sinHorarioConfigurado(deLaFicha)
    ? horarioSemanalDesdeLegacy({
        dias: guardada[0]?.hoursDays ?? "",
        abre: guardada[0]?.hoursOpen,
        cierra: guardada[0]?.hoursClose,
        abreDomingo: guardada[0]?.hoursOpenSunday,
        cierraDomingo: guardada[0]?.hoursCloseSunday,
      })
    : deLaFicha;
  const ficha = {
    ...fichaFusionada,
    vertical: contratado,
    horario: horarioNormalizado(canonico),
  };

  const perfil = generarPerfil(ficha, {
    ...opcionesDeGeneracion(guardada[0] ?? {}),
    // El vertical ya se resolvió arriba contra lo CONTRATADO, que es lo que
    // manda; no hace falta que lo vuelva a derivar la traducción.
    vertical: contratado,
  });


  const preguntas = (ficha.preguntasFrecuentes ?? []).filter(
    (p) => p.pregunta.trim() && p.respuesta.trim()
  );
  /** Cuántas se sembraron de verdad: 0 si el cliente ya tenía conocimiento. */
  let sembradas = 0;

  /**
   * Instrumentado: cualquier campo que cambie sin estar declarado sale en el log
   * como `[NO DECLARADO]`. Es el proceso que revirtió el horario del salón el
   * 15-ago sin que nada avisara.
   */
  const leerFila = async () => {
    const [f] = await db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId));
    return (f as unknown as Fila) ?? null;
  };

  await conRegistro(
    {
      tabla: "agent_profile",
      registro: organizationId,
      leerFila,
      declarados: [
        "name",
        "tone",
        "instructions",
        "escalationRules",
        "greeting",
        "ficha",
        "notifyPhones",
        "updatedAt",
        // Derivados del horario canónico: cambian cuando cambia la ficha, y
        // eso es lo esperado. Si cambiaran SIN que cambie la ficha, saltaría
        // la alarma — que es justo lo que hay que vigilar ahora.
        "hoursDays",
        "hoursOpen",
        "hoursClose",
        "hoursOpenSunday",
        "hoursCloseSunday",
      ],
      proceso: "aplicarFicha",
      actor: opciones?.actor ?? "script:desconocido",
    },
    async () => {
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
         * LAS COLUMNAS `hours_*` SE REESCRIBEN SIEMPRE, PORQUE YA NO MANDAN.
         *
         * Hasta el 20-sep-2026 era al revés: las columnas eran la fuente y la
         * ficha "un registro histórico", así que aquí había que congelarlas
         * —reescribirlas en cada reenvío del cuestionario revirtió el horario
         * del salón el 15-ago a las 19:46:41, de 9:30–18:30 a 9:00–20:00, sin
         * que nada avisara—.
         *
         * Ese congelado resolvía el síntoma y dejaba la causa: dos sitios con
         * el mismo dato. Ahora la autoridad es `ficha.horario.porDia`, que es
         * lo que el negocio edita en su pantalla, y estas columnas son una
         * proyección suya. Una proyección no se congela: se recalcula, o se
         * queda vieja y vuelve a contradecir a su fuente — que es exactamente
         * lo que pasó con el domingo de Lis.
         *
         * Lo que protegía el congelado sigue protegido por otra vía: quien
         * corrige el horario lo corrige EN LA FICHA, no en una columna suelta,
         * y `fusionarFicha` ya impide que un llamante pise la sección de otro.
         */
        ...columnasDesdeHorario(canonico),
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

    }
  );

  return {
    organizationId,
    largoDelPrompt: perfil.instructions.length,
    entradasDeConocimiento: sembradas,
    avisoDeVertical,
    seccionesConservadas: conservadas,
  };
}
