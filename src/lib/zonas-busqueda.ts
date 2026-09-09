/**
 * Buscar un barrio entre las zonas de domicilio del negocio, **como lo busca
 * el agente**.
 *
 * Vive en `lib/` y sin dependencias por la misma razón que
 * `catalogo-repeticion.ts`: la usan la pantalla del CRM y las pruebas, y
 * escribirla dos veces sería la clase de regla que se corrige en un sitio y se
 * queda vieja en el otro.
 *
 * ## Por qué no vale un `includes` cualquiera
 *
 * `resolverZonaDeEntrega` (`server/delivery/zonas.ts`) compara sin tildes, sin
 * mayúsculas y por substring **en los dos sentidos** —el cliente escribe una
 * dirección entera ("Cra 24R #85-69 Barrio Talanga") y la zona cargada es solo
 * "Talanga"—. Si la pantalla comparara de otra forma, diría cosas falsas en
 * las dos direcciones:
 *
 * - decir "no tienes ese barrio" de uno que el agente SÍ encuentra → alguien
 *   lo carga por segunda vez y quedan dos tarifas para el mismo sitio;
 * - decir "sí lo tienes" de uno que el agente NO encuentra → el negocio se
 *   queda tranquilo mientras el bot sigue sin poder cotizarlo.
 *
 * La pantalla tiene que contestar lo mismo que va a contestar el bot. Esto no
 * replica los pasos de tokens del matcher del servidor a propósito: replica el
 * de substring, que es el que decide en la práctica cuando alguien teclea un
 * nombre de barrio en un buscador.
 */

export function normalizarNombreDeZona(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Con la consulta vacía coincide todo: la lista sin filtrar es la lista entera. */
export function coincideConLaBusqueda(nombreZona: string, consulta: string): boolean {
  const a = normalizarNombreDeZona(nombreZona);
  const b = normalizarNombreDeZona(consulta);
  if (!b) return true;
  return a.includes(b) || b.includes(a);
}
