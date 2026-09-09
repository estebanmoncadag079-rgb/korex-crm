/**
 * Opciones de un grupo que **el agente no puede distinguir entre sí**.
 *
 * Hermana de `catalogo-repeticion.ts`: aquélla mira la aritmética del grupo
 * (¿alcanzan las opciones para el máximo que pide?), ésta mira los nombres.
 * Las dos responden a la misma pregunta —¿este grupo atrapa al cliente?— y por
 * eso viven las dos en `lib/`, sin dependencias, disponibles para la pantalla
 * del CRM, el servidor, los scripts y las pruebas.
 *
 * ## El caso real que la trajo (MALIA, 8-sep-2026)
 *
 * El "Pavé Cremoso 8 oz" —su producto más vendido— tenía **los sabores y los
 * toppings revueltos en un solo grupo** llamado `Topping`, con `max_select: 1`
 * y con tres nombres repetidos dentro:
 *
 * ```
 * Topping >> Leche Klim (+$0)      ← sabor
 * Topping >> Milo (+$0)            ← sabor
 * Topping >> Arequipe (+$0)        ← sabor
 * Topping >> Leche Klim (+$2000)   ← topping, MISMO nombre
 * Topping >> Milo (+$2000)         ← MISMO nombre
 * Topping >> Arequipe (+$2000)     ← MISMO nombre
 * ```
 *
 * El mismo producto en 16 oz estaba bien: `Topping` [máx 1] con los 6 sabores
 * y `Toppings` [máx 9] con los 9 de pago, en grupos separados.
 *
 * Consecuencia en vivo: una clienta escribió "Sin toppings" **tres veces** y el
 * agente le preguntó **cuatro**, porque el sabor ya ocupaba el único cupo del
 * grupo y el carrito se rechazaba una y otra vez. La clienta no tenía forma de
 * salir del bucle: lo que le pedían era imposible.
 *
 * ## Por qué hace falta una comprobación y no bastan las pruebas
 *
 * Ese día la suite entera pasó —209 archivos, 2064 pruebas, cero fallos—
 * mientras el negocio perdía pedidos. **No había nada que arreglar en el
 * código: lo roto era el dato.** Una prueba unitaria no puede cazar un
 * catálogo mal cargado; hace falta mirar el catálogo. Esta función es esa
 * mirada, puesta donde se arregla: dentro del grupo, en la pantalla del CRM.
 *
 * Se compara sin tildes, sin mayúsculas y sin espacios de sobra porque así es
 * como las compara el agente cuando busca la opción que dijo el cliente
 * (`server/catalog/buscar.ts`): "Maracuyá" y "maracuya" son el mismo nombre
 * para él, y por lo tanto son igual de indistinguibles.
 */

/**
 * ¿Este grupo obliga al cliente a pagar un extra que quizá no quiere?
 *
 * Un grupo obligatorio (`minimo >= 1`) **no se puede rechazar**: si el cliente
 * dice que no lo quiere, `orders/normalizar.ts` ignora el rechazo a propósito
 * y `faltaDelItem` se lo vuelve a pedir. Eso está bien cuando el grupo es de
 * verdad obligatorio (el sabor de un helado hay que elegirlo). Cuando lo que
 * está marcado como obligatorio es un EXTRA DE PAGO, el cliente queda atrapado:
 * no hay respuesta que lo saque del bucle.
 *
 * Incidente real (MALIA, 8-sep-2026): el grupo `Topping` del Pavé de 8 oz
 * —nueve opciones, todas de $2.000— estaba marcado obligatorio. Una clienta
 * escribió "Sin toppings" TRES veces y el agente le preguntó CUATRO. El pedido
 * se perdió.
 *
 * La señal es "obligatorio Y todas las opciones cuestan extra". Se pide que
 * sean TODAS, no algunas, para no marcar el caso legítimo de un grupo donde
 * hay que elegir sí o sí entre una opción incluida y otra más cara (un tamaño,
 * una presentación). Aun así puede haber falsos positivos —un negocio donde
 * todos los tamaños suben de precio—; por eso el aviso explica el criterio y
 * deja decidir, en vez de bloquear nada.
 */
export function obligaAPagarUnExtra(grupo: {
  minimo: number;
  opciones: { precioExtraCents: number }[];
}): boolean {
  if (grupo.minimo < 1) return false;
  if (grupo.opciones.length === 0) return false;
  return grupo.opciones.every((o) => o.precioExtraCents > 0);
}

function normalizar(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Los nombres que aparecen más de una vez en el grupo, tal como los escribió
 * el negocio (se devuelve la primera grafía vista, no la normalizada, para que
 * quien lea el aviso reconozca lo que tiene cargado).
 *
 * Devuelve `[]` cuando el grupo está sano — el caso normal, y el que hace que
 * el aviso no aparezca casi nunca y por eso signifique algo cuando aparece.
 */
/**
 * Los grupos de un producto que **el agente no puede distinguir entre sí**.
 *
 * Es la causa raíz del incidente de arriba, y la más grave de las dos: el Pavé
 * de 8 oz tenía dos grupos llamados los dos `Topping` (alguien renombró
 * `Sabor`), y como "Milo" existe en los dos, la pregunta de desambiguación que
 * armaba `orders/normalizar.ts` era *«¿"Milo" como topping o como topping?»* —
 * imposible de responder, bucle infinito, pedido perdido.
 *
 * La comparación imita a la del agente (`coincideGrupo` en
 * `orders/normalizar.ts`: prefijo mutuo sobre el nombre normalizado), no a la
 * igualdad estricta. Por eso también marca `Topping` contra `Toppings`, que al
 * agente le parecen el mismo grupo aunque a una persona no —el Pavé de 16 oz
 * tiene justo ese par y es la misma trampa esperando a que alguien la pise—.
 *
 * Devuelve los grupos implicados, con la grafía del negocio.
 */
export function gruposAmbiguos(grupos: { nombre: string }[]): string[] {
  const claves = grupos.map((g) => ({ nombre: g.nombre, clave: normalizar(g.nombre) }));
  const implicados = new Set<string>();
  for (let i = 0; i < claves.length; i++) {
    for (let j = i + 1; j < claves.length; j++) {
      const a = claves[i]!;
      const b = claves[j]!;
      if (!a.clave || !b.clave) continue;
      if (a.clave.startsWith(b.clave) || b.clave.startsWith(a.clave)) {
        implicados.add(a.nombre);
        implicados.add(b.nombre);
      }
    }
  }
  return [...implicados];
}

export function opcionesAmbiguas(opciones: { nombre: string }[]): string[] {
  const vistas = new Map<string, string>();
  const repetidas = new Map<string, string>();
  for (const o of opciones) {
    const clave = normalizar(o.nombre);
    if (!clave) continue;
    const primera = vistas.get(clave);
    if (primera === undefined) vistas.set(clave, o.nombre);
    else repetidas.set(clave, primera);
  }
  return [...repetidas.values()];
}
