#!/usr/bin/env bash
#
# Respaldo de los volúmenes Docker: lo que NO vive en Postgres.
#
# Un servidor con varios servicios guarda datos en dos sitios muy distintos, y
# respaldar solo la base deja fuera la mitad:
#
#   - Bases SQLite de los bots (asistente.db, negocio.db). Son bases de datos
#     completas dentro de un archivo, tan importantes como el Postgres.
#   - Carpetas de sesión de WhatsApp (Baileys). Si se pierden, el número se
#     desconecta y hay que volver a escanear el QR — con el negocio parado
#     mientras tanto.
#
# El volumen de Postgres se EXCLUYE a propósito: copiar su carpeta de datos con
# la base encendida produce una copia corrupta que parece buena. Eso ya está
# cubierto, y bien, por el volcado con pg_dump.
#
#   ./respaldar-volumenes.sh                  # todo lo que tenga datos
#   ./respaldar-volumenes.sh asistente-ia     # solo lo que case con eso
#
# Variables:
#   DESTINO           dónde dejarlo (default /opt/korex-crm/backups)
#   RETENCION_DIAS    días que se conservan (default 14)
#
set -euo pipefail

# Filtros de inclusión: sin argumentos entra todo lo que tenga datos. Con
# ellos, solo los volúmenes cuyo nombre los contenga. No todo lo que hay en un
# servidor merece respaldarse, y respaldar de más también cuesta — disco y
# tiempo de descarga.
FILTROS=("$@")

DESTINO="${DESTINO:-/opt/korex-crm/backups}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
RAIZ_VOLUMENES="${RAIZ_VOLUMENES:-/var/lib/docker/volumes}"

# Copiar el directorio de datos de Postgres en caliente da una copia corrupta.
EXCLUIR_PATRON="${EXCLUIR_PATRON:-_pg$|postgres|mysql|mariadb}"

error() { echo "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 ||
  error "No hay Docker aquí. Esto se ejecuta en el servidor."
[ -d "$RAIZ_VOLUMENES" ] ||
  error "No encuentro los volúmenes en $RAIZ_VOLUMENES"

mkdir -p "$DESTINO"

marca="$(date +%Y%m%d-%H%M)"
# El nombre lleva el filtro: en la carpeta de respaldos tiene que verse de un
# vistazo QUÉ contiene cada copia, sin abrirla.
etiqueta="todo"
[ ${#FILTROS[@]} -gt 0 ] && etiqueta="$(echo "${FILTROS[*]}" | tr ' ' '-' | tr -cd 'a-zA-Z0-9-')"
archivo="$DESTINO/volumenes-${etiqueta}-${marca}.tar.gz"

# Qué entra: todo volumen con datos dentro, menos los de bases que ya se
# respaldan por su propia vía. Un volumen vacío solo añade ruido.
incluidos=()
for ruta in "$RAIZ_VOLUMENES"/*/_data; do
  [ -d "$ruta" ] || continue
  nombre="$(basename "$(dirname "$ruta")")"

  if [ ${#FILTROS[@]} -gt 0 ]; then
    coincide=0
    for f in "${FILTROS[@]}"; do
      case "$nombre" in *"$f"*) coincide=1 ;; esac
    done
    [ "$coincide" -eq 1 ] || continue
  fi

  if echo "$nombre" | grep -qE "$EXCLUIR_PATRON"; then
    echo "  omitido (se respalda aparte): $nombre"
    continue
  fi
  if [ -z "$(ls -A "$ruta" 2>/dev/null)" ]; then
    continue # vacío
  fi
  incluidos+=("$nombre/_data")
done

if [ ${#incluidos[@]} -eq 0 ]; then
  if [ ${#FILTROS[@]} -gt 0 ]; then
    error "Ningún volumen con datos coincide con: ${FILTROS[*]}"
  fi
  echo "No hay volúmenes con datos que respaldar."
  exit 0
fi

echo "→ Empaquetando ${#incluidos[@]} volumen(es)…"
for v in "${incluidos[@]}"; do echo "    ${v%/_data}"; done

# Al temporal primero: un tar a medias no debe llegar a ocupar el sitio de un
# respaldo bueno. Los avisos de "file changed as we read it" son normales con
# los servicios encendidos y no invalidan la copia.
if ! tar czf "$archivo.tmp" -C "$RAIZ_VOLUMENES" "${incluidos[@]}" 2>/dev/null; then
  if [ ! -s "$archivo.tmp" ]; then
    rm -f "$archivo.tmp"
    error "No se pudo empaquetar. NO se borró ningún respaldo anterior."
  fi
fi

echo "→ Comprobando que el paquete se puede abrir…"
if ! tar tzf "$archivo.tmp" >/dev/null 2>&1; then
  rm -f "$archivo.tmp"
  error "El paquete salió corrupto: se descartó. NO se borró nada anterior."
fi

mv "$archivo.tmp" "$archivo"
tamano="$(du -h "$archivo" | cut -f1)"
echo "✓ Respaldo verificado: $archivo ($tamano)"

# La limpieza va DESPUÉS de verificar, nunca antes.
borrados="$(find "$DESTINO" -maxdepth 1 -name "volumenes-${etiqueta}-*.tar.gz" -type f \
  -mtime "+${RETENCION_DIAS}" -print -delete 2>/dev/null | wc -l | tr -d ' ')"
[ "$borrados" -gt 0 ] && echo "  ($borrados copia(s) de más de $RETENCION_DIAS días borradas)"

total="$(find "$DESTINO" -maxdepth 1 -name "volumenes-${etiqueta}-*.tar.gz" -type f | wc -l | tr -d ' ')"
echo "  Copias de volúmenes guardadas: $total en $DESTINO"
