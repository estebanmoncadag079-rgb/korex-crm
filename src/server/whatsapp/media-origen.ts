/**
 * De dónde se acepta descargar un adjunto de WhatsApp.
 *
 * La dirección del archivo llega DENTRO del evento del webhook, y para bajarlo
 * hay que ir con la API key de YCloud en la cabecera. Sin esta comprobación,
 * quien lograra colar un evento con una URL suya recibiría esa clave en su
 * propio servidor — y con ella puede enviar WhatsApp a nombre del cliente y
 * gastarle el saldo.
 *
 * Vive fuera de la ruta porque Next.js solo deja exportar handlers desde un
 * `route.ts`, y porque esto es una regla del dominio: la usará también el
 * procesamiento de audio e imágenes cuando el agente empiece a escucharlos.
 */

/**
 * Los 14 adjuntos que hay en producción vienen todos de `api.ycloud.com`. Los
 * dominios de Meta se incluyen porque son los que sirven los medios cuando un
 * cliente se conecta por Cloud API directa, camino que el código conserva.
 */
const HOSTS_PERMITIDOS = [
  "api.ycloud.com",
  "lookaside.fbsbx.com",
  "mmg.whatsapp.net",
  "graph.facebook.com",
];

/**
 * Solo https y un host de la lista.
 *
 * Se compara el host COMPLETO (o un subdominio suyo), nunca con "termina en":
 * `api.ycloud.com.atacante.net` acaba con un dominio legítimo y burlaría un
 * filtro ingenuo.
 */
export function esOrigenPermitido(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return HOSTS_PERMITIDOS.some(
    (host) => u.hostname === host || u.hostname.endsWith(`.${host}`)
  );
}
