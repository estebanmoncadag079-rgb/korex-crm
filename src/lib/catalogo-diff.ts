import { leerCatalogoPegado, type FilaCatalogo } from "@/lib/catalogo-texto";

/**
 * Comparar la lista de servicios que escribió el cliente contra los que ya
 * tiene cargados.
 *
 * **Por qué existe**: el catálogo se escribe en un sitio (el alta, el generador
 * de prompts) y se usa en otro (la pantalla de Servicios, donde se marca quién
 * atiende cada cosa). Hasta ahora esas dos mitades no se hablaban: si el
 * cliente añadía un servicio a su lista, no aparecía en las casillas de las
 * especialistas — y un servicio que nadie atiende no se puede agendar. Si lo
 * quitaba, seguía ofreciéndose. La lista parecía la fuente de verdad y no lo
 * era.
 *
 * Aquí no se escribe nada: esto solo dice en qué se diferencian las dos, para
 * que una persona decida. Cambiar un precio o retirar un servicio afecta a lo
 * que se le cobra a una clienta.
 */

/** Un servicio tal y como está guardado (lo mínimo para comparar). */
export type ServicioGuardado = {
  id: string;
  name: string;
  category: string | null;
  priceCents: number;
  durationMin: number;
};

export type CambioDeServicio = {
  id: string;
  nombre: string;
  precioAntes: number;
  precioAhora: number;
  duracionAntes: number;
  duracionAhora: number;
};

export type DiffCatalogo = {
  /** Están en la lista escrita y no en el catálogo: hay que crearlos. */
  nuevos: FilaCatalogo[];
  /** Están guardados y ya no aparecen en la lista: candidatos a archivar. */
  sobrantes: ServicioGuardado[];
  /** El mismo servicio con otro precio o con otra duración. */
  cambios: CambioDeServicio[];
  /** Iguales en ambos lados: no se tocan. */
  sinCambios: number;
};

/**
 * La clave con la que se reconoce "el mismo servicio": el nombre en minúsculas,
 * sin tildes y sin espacios de más.
 *
 * Se compara por nombre y no por id porque la lista escrita no tiene ids — es
 * texto que teclea una persona. "Volumen Ruso" y "volumen ruso" son el mismo
 * servicio; tratarlos como distintos duplicaría el catálogo en cada
 * sincronización.
 */
export function claveDeServicio(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compara **la lista ya revisada** (las filas que la persona corrigió en
 * pantalla) contra el catálogo guardado.
 *
 * Se separa de la versión que lee texto porque en la pantalla de Servicios lo
 * que hay que comparar no es lo que se pegó, sino lo que quedó después de que
 * alguien arreglara los precios y las duraciones.
 */
export function compararFilas(input: {
  filas: FilaCatalogo[];
  guardados: ServicioGuardado[];
}): DiffCatalogo {
  const filas = input.filas.filter((f) => f.nombre.trim());
  const porClave = new Map(input.guardados.map((s) => [claveDeServicio(s.name), s]));
  const vistas = new Set<string>();

  const nuevos: FilaCatalogo[] = [];
  const cambios: CambioDeServicio[] = [];
  let sinCambios = 0;

  for (const fila of filas) {
    const clave = claveDeServicio(fila.nombre);
    // Una lista con el mismo servicio dos veces no debe crearlo dos veces.
    if (vistas.has(clave)) continue;
    vistas.add(clave);

    const guardado = porClave.get(clave);
    if (!guardado) {
      nuevos.push(fila);
      continue;
    }

    /*
     * Un hueco en la lista NO es un cambio: si la línea no trae precio o no
     * trae minutos, se conserva lo que ya estaba. Interpretar "no lo escribió"
     * como "vale 0" pondría a cero los precios del catálogo entero, que es
     * justo el tipo de daño silencioso que este archivo existe para evitar.
     */
    const precioAhora =
      fila.precio === null ? guardado.priceCents : Math.round(fila.precio * 100);
    const duracionAhora = fila.duracionMin ?? guardado.durationMin;

    if (precioAhora !== guardado.priceCents || duracionAhora !== guardado.durationMin) {
      cambios.push({
        id: guardado.id,
        nombre: guardado.name,
        precioAntes: guardado.priceCents,
        precioAhora,
        duracionAntes: guardado.durationMin,
        duracionAhora,
      });
    } else {
      sinCambios++;
    }
  }

  const sobrantes = input.guardados.filter((s) => !vistas.has(claveDeServicio(s.name)));

  return { nuevos, sobrantes, cambios, sinCambios };
}

/**
 * Lo mismo, partiendo del texto tal y como lo escribió el cliente.
 *
 * ⚠️ La duración típica se usa **solo para los servicios nuevos**, al crearlos.
 * Aquí las filas van tal cual: rellenar los huecos antes de comparar
 * convertiría "esta línea no dice cuánto dura" en "ahora dura 60 minutos", y
 * un Volumen Ruso de 150 minutos pasaría a 60 sin que nadie lo pidiera.
 */
export function compararCatalogo(input: {
  texto: string;
  guardados: ServicioGuardado[];
  /** Solo informativa aquí: la aplica quien crea los servicios nuevos. */
  duracionTipicaMin: number;
}): DiffCatalogo {
  return compararFilas({
    filas: leerCatalogoPegado(input.texto),
    guardados: input.guardados,
  });
}
