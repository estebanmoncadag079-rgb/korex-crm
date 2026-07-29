#!/usr/bin/env bash
#
# Respaldo de la base de datos de Vocero.
#
# Saca una copia comprimida, COMPRUEBA que se puede leer y solo entonces borra
# las viejas. Ese orden es lo único que separa un respaldo de una carpeta llena
# de archivos rotos: un disco lleno o un contenedor que se reinicia a mitad
# dejan un fichero a medias que parece bueno hasta el día que hace falta.
#
#   ./scripts/respaldo/respaldar.sh
#
# Variables (todas opcionales):
#   DESTINO              carpeta donde dejar las copias (default ~/respaldos-vocero)
#   RETENCION_DIAS       días que se conservan (default 14)
#   DATABASE_URL         cadena de conexión; si falta, se usa el contenedor
#   POSTGRES_CONTAINER   nombre del contenedor de Postgres (si hay varios)
#
set -euo pipefail

DESTINO="${DESTINO:-$HOME/respaldos-vocero}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"

# shellcheck source=scripts/respaldo/comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"

mkdir -p "$DESTINO"
detectar_postgres

marca="$(date +%Y-%m-%d_%H%M%S)"
archivo="$DESTINO/vocero_${marca}.dump"

echo "→ Copiando la base de datos…"
# Formato 'custom' (-Fc): comprimido y restaurable pieza por pieza, que es lo
# que hace falta el día que solo se perdió una tabla.
if ! pg_dump_vocero >"$archivo"; then
  rm -f "$archivo"
  error "No se pudo copiar la base de datos. NO se ha borrado ningún respaldo anterior."
fi

# Un archivo de 0 bytes también "se creó sin errores".
tamano="$(wc -c <"$archivo" | tr -d ' ')"
if [ "$tamano" -lt 1024 ]; then
  rm -f "$archivo"
  error "La copia salió vacía (${tamano} bytes). NO se ha borrado ningún respaldo anterior."
fi

echo "→ Comprobando que la copia se puede leer…"
if ! pg_restore_vocero --list <"$archivo" >/dev/null 2>&1; then
  rm -f "$archivo"
  error "La copia está corrupta: se descartó. NO se ha borrado ningún respaldo anterior."
fi

echo "✓ Respaldo verificado: $archivo ($(legible "$tamano"))"

# La limpieza va DESPUÉS de verificar, y jamás toca el más reciente: si algo
# saliera mal arriba, preferimos gastar disco a quedarnos sin nada.
borrados=0
while IFS= read -r viejo; do
  [ "$viejo" = "$archivo" ] && continue
  rm -f "$viejo"
  borrados=$((borrados + 1))
done < <(find "$DESTINO" -maxdepth 1 -name 'vocero_*.dump' -type f -mtime "+${RETENCION_DIAS}" 2>/dev/null || true)

if [ "$borrados" -gt 0 ]; then
  echo "  (se borraron $borrados respaldo(s) de más de $RETENCION_DIAS días)"
fi

total="$(find "$DESTINO" -maxdepth 1 -name 'vocero_*.dump' -type f | wc -l | tr -d ' ')"
echo "  Copias guardadas: $total en $DESTINO"
echo
echo "RECUERDA: esta copia por sí sola NO alcanza para revivir el servicio."
echo "Sin la variable ENCRYPTION_KEY, los tokens de WhatsApp que hay dentro son"
echo "ilegibles y cada cliente tendría que reconectar su número. Guarda los"
echo "secretos aparte — ver docs/respaldos.md."
