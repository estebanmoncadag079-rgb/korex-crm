#!/usr/bin/env bash
#
# Simulacro de restauración: la única prueba de que un respaldo sirve.
#
# Tener copias no es tener respaldos. Lo que salva un negocio es haber
# restaurado una copia ANTES del día malo, y es exactamente el paso que nadie
# hace hasta que ya no hay tiempo. Esto lo hace solo: levanta una base de usar
# y tirar, mete dentro el respaldo, cuenta lo que llegó y la borra.
#
# NO toca la base de producción en ningún momento.
#
# Sirve con las dos clases de copia que existen por ahí: el formato 'custom'
# de pg_dump (.dump) y el SQL plano comprimido (.sql.gz) que genera el cron de
# muchas instalaciones. Verificar tiene que funcionar con la copia que YA
# tienes, no con la que deberías tener.
#
#   ./scripts/respaldo/simulacro.sh                  # la copia más reciente
#   ./scripts/respaldo/simulacro.sh ruta/al/archivo  # una concreta
#
set -euo pipefail

# shellcheck source=scripts/respaldo/comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"

archivo="${1:-}"
if [ -z "$archivo" ]; then
  archivo="$(respaldo_mas_reciente)"
  [ -n "$archivo" ] || error \
    "No encontré ningún respaldo en: $CARPETAS_RESPALDO"
fi
[ -f "$archivo" ] || error "No existe el archivo: $archivo"

detectar_postgres

base_prueba="vocero_simulacro_$(date +%s)"

# Pase lo que pase, la base de prueba se va. Un simulacro que deja basura
# detrás acaba llenando el disco del servidor que intentaba proteger.
limpiar() {
  psql_admin -q -c "DROP DATABASE IF EXISTS $base_prueba;" >/dev/null 2>&1 || true
}
trap limpiar EXIT

tamano="$(wc -c <"$archivo" | tr -d ' ')"
echo "→ Probando el respaldo: $(basename "$archivo") ($(legible "$tamano"))"
echo "→ Creando una base de prueba aparte ($base_prueba)…"
psql_admin -q -c "CREATE DATABASE $base_prueba;" >/dev/null ||
  error "No se pudo crear la base de prueba."

echo "→ Restaurando dentro…"
salida="$(mktemp)"
restaurar_en_base "$base_prueba" "$archivo" >"$salida" 2>&1 || true

# Al restaurar salen avisos inofensivos (permisos, DROP de cosas que aún no
# existen). Lo que de verdad importa se comprueba abajo, contando datos.
if grep -qiE "^(pg_restore: )?error" "$salida"; then
  echo "  Avisos durante la restauración (los primeros):"
  grep -iE "^(pg_restore: )?error" "$salida" | head -5 | sed 's/^/    /'
fi
rm -f "$salida"

echo
echo "Lo que se recuperó:"
fallo=0

# Estas dos no pueden estar vacías: sin ellas no hay a quién devolverle nada.
for tabla in user organization; do
  n="$(contar_en_base "$base_prueba" "$tabla" | tr -d ' \r')"
  if [ "$n" = "?" ] || [ -z "$n" ] || [ "$n" = "0" ]; then
    echo "  ✗ $tabla: $n  ← esto NO debería estar vacío"
    fallo=1
  else
    echo "  ✓ $tabla: $n"
  fi
done

# El resto es informativo: un cliente recién dado de alta tiene cero de casi
# todo, y eso no es un fallo del respaldo.
for tabla in contact conversation message kb_entry agent_profile meta_credentials; do
  echo "  · $tabla: $(contar_en_base "$base_prueba" "$tabla" | tr -d ' \r')"
done

echo
if [ "$fallo" -eq 0 ]; then
  echo "✓ SIMULACRO SUPERADO. Este respaldo sirve para revivir el servicio."
  echo "  (la base de prueba ya se borró; producción no se tocó)"
else
  echo "✗ SIMULACRO FALLIDO: el respaldo llegó incompleto."
  echo "  No confíes en esta copia. Revisa docs/respaldos.md → 'Cuando algo falla'."
  exit 1
fi
