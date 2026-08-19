/**
 * La aritmética de un grupo de opciones: **¿se puede completar sin repetir?**
 *
 * Vive en `lib/` y sin una sola dependencia porque la usan los cuatro lados: la
 * pantalla del CRM para avisar, el script de respaldo para listar, el servidor
 * y las pruebas. Escrita dos veces sería la clase de regla que se corrige en un
 * sitio y se queda vieja en el otro.
 */

/**
 * ¿Este grupo **solo** se puede completar repitiendo una opción?
 *
 * Es aritmética, no una preferencia: si el grupo pide hasta 5 y el negocio
 * cargó 4 opciones, sin repetición su pedido más caro no se puede cerrar jamás
 * — el bug del Mega Box del 16-ago-2026
 * ([86](../../docs/korexia/86-DOS-PRODUCTOS-EN-UN-PEDIDO.md)).
 *
 * Un grupo **sin opciones cargadas** no cuenta: el validador se lo salta entero
 * (`orders/normalizar.ts`, `if (g.opciones.length === 0) continue`), así que
 * avisar ahí mandaría a alguien a tocar la repetición cuando lo que le falta es
 * cargar las opciones.
 */
export function repeticionObligatoria(grupo: {
  maximo: number;
  opciones: number;
}): boolean {
  return grupo.opciones > 0 && grupo.maximo > grupo.opciones;
}
