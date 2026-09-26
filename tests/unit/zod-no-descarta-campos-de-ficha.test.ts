/**
 * Las rutas que guardan la ficha no pueden tirar en silencio un campo que el
 * backend usa como autoridad.
 *
 * ## El incidente que lo pide
 *
 * 20-sep-2026, rediseño del horario canónico: `ficha.horario.porDia` se
 * implementó entero —modelo, generador, runtime, UI— y funcionaba en las
 * pruebas. Pero ninguno de los dos esquemas de Zod lo declaraba, y Zod
 * **descarta sin avisar** lo que no está en el esquema. La pantalla lo
 * guardaba, la ruta lo tiraba, y todo el rediseño habría quedado decorativo
 * en producción sin que ningún test se pusiera rojo. Se cazó de milagro.
 *
 * ## La regla exacta, que no es "declararlo todo"
 *
 * `fusionarFicha` (`leer-ficha.ts:186`) hace `{...guardada[s], ...entrante[s]}`
 * por sección. Es una fusión **superficial, a nivel de clave de sección**, y
 * de ahí salen dos comportamientos opuestos:
 *
 * | Caso | Qué pasa |
 * |---|---|
 * | La ruta NO declara la clave (`cierre`) | llega `undefined`, `aSecciones` la omite → **se conserva** lo guardado |
 * | La ruta SÍ declara la clave (`entrega`, `horario`, `pago`) | el objeto entrante **reemplaza** al guardado entero |
 *
 * Por eso `porDia` se perdía y `cierre.requisitos` no: `horario` sí estaba
 * declarado —sin `porDia` dentro—, y `cierre` no estaba declarado en absoluto.
 *
 * Es decir: **lo peligroso no es olvidar un campo, es olvidar un campo DENTRO
 * de un objeto que la ruta sí declara.** Ese es el caso que esta prueba cubre.
 *
 * ## Por qué mira el TEXTO del archivo
 *
 * Los esquemas viven dentro de los módulos de ruta y no se exportan —
 * exportarlos solo para probarlos sería cambiar código de producción para
 * complacer a un test. Y lo que hay que garantizar es literalmente "este
 * nombre está declarado en el esquema", que es una propiedad del texto.
 *
 * ## Qué añadir aquí
 *
 * Un campo nuevo que (a) el backend lea para decidir algo y (b) viva dentro de
 * un objeto que esa ruta ya declara.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ADMIN = "src/app/api/admin/clients/[id]/ficha/route.ts";
const ALTA = "src/app/api/onboarding/route.ts";

/**
 * Campo → el objeto que lo contiene, y por qué el backend lo necesita.
 * Solo entran aquí los campos anidados en una clave que la ruta declara: si la
 * ruta no declara la clave madre, el valor guardado se conserva solo.
 */
const ANIDADOS_CON_AUTORIDAD: { campo: string; dentroDe: string; porque: string }[] = [
  { campo: "porDia", dentroDe: "horario", porque: "decide abierto/cerrado y qué días se ofrecen" },
  { campo: "haceDomicilios", dentroDe: "entrega", porque: "de aquí salen las modalidades ofrecidas" },
  {
    campo: "minimoDomicilioCents",
    dentroDe: "entrega",
    porque: "el backend rechaza cerrar un domicilio por debajo de este importe",
  },
  {
    campo: "compruebaUnaPersona",
    dentroDe: "pago",
    porque: "decide si el agente puede dar un pago por bueno",
  },
  {
    campo: "porModalidad",
    dentroDe: "pago",
    porque: "el backend responde con certeza qué método vale a domicilio y al recoger (doc 200, caso Sofía)",
  },
  {
    campo: "cuentaAntesDeConfirmar",
    dentroDe: "pago",
    porque: "decide si el bot da los datos de la cuenta antes de que el cliente confirme (doc 200)",
  },
];

describe("Zod declara todo campo anidado con autoridad", () => {
  for (const ruta of [ADMIN, ALTA]) {
    const fuente = readFileSync(ruta, "utf8");
    for (const { campo, dentroDe, porque } of ANIDADOS_CON_AUTORIDAD) {
      it(`${ruta}: \`${dentroDe}.${campo}\` — ${porque}`, () => {
        // Si la ruta no declara la clave madre, el campo se conserva solo y no
        // hay nada que exigir. Si la declara, tiene que declarar el hijo.
        if (!fuente.includes(`${dentroDe}:`)) return;
        expect(fuente).toContain(campo);
      });
    }
  }
});

describe("la fusión por secciones conserva lo que la ruta no declara", () => {
  it("el panel de admin NO declara `cierre`, y eso es correcto, no un olvido", () => {
    // Documenta la asimetría para quien venga después: es tentador "arreglarlo"
    // declarando `cierre` aquí, y sería justo al revés — declararlo a medias
    // vaciaría los requisitos del negocio en cada guardado desde /admin.
    const admin = readFileSync(ADMIN, "utf8");
    expect(admin).not.toContain("cierre:");
    expect(readFileSync(ALTA, "utf8")).toContain("cierre:");
  });

  it("la fusión sigue siendo superficial por sección — si esto cambia, revisa esta prueba", () => {
    // El razonamiento entero de arriba depende de esta línea. Si alguien la
    // convierte en una fusión profunda, la asimetría desaparece y estas reglas
    // dejan de aplicar.
    expect(readFileSync("src/server/ai/generador/leer-ficha.ts", "utf8")).toContain(
      "resultado[s] = { ...deGuardada[s], ...deEntrante[s] };"
    );
  });
});
