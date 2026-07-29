#!/usr/bin/env bash
#
# Simulacro de restauración: la única prueba de que un respaldo sirve.
#
# Tener copias no es tener respaldos. Lo que salva un negocio es haber
# restaurado una copia ANTES del día malo, y es exactamente el paso que nadie
# hace hasta que ya no hay tiempo. Esto lo hace solo: levanta una base de usar
# y tirar, mete dentro el último respaldo, cuenta lo que llegó y la borra.
#
# NO toca la base de producción en ningún momento.
#
#   ./scripts/respaldo/simulacro.sh                  # el respaldo más reciente
#   ./scripts/respaldo/simulacro.sh ruta/al.dump     # uno concreto
#
set -euo pipefail

DESTINO="${DESTINO:-$HOME/respaldos-vocero}"

# shellcheck source=scripts/respaldo/comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"

archivo="${1:-}"
if [ -z "$archivo" ]; then
  archivo="$(find "$DESTINO" -maxdepth 1 -name 'vocero_*.dump' -type f |
    sort | tail -n 1)"
  [ -n "$archivo" ] ||
    error "No hay ningún respaldo en $DESTINO. Corre primero ./scripts/respaldo/respaldar.sh"
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

echo "→ Probando el respaldo: $(basename "$archivo")"
echo "→ Creando una base de prueba aparte ($base_prueba)…"
psql_admin -q -c "CREATE DATABASE $base_prueba;" >/dev/null ||
  error "No se pudo crear la base de prueba."

echo "→ Restaurando dentro…"
salida_restore="$(mktemp)"
if [ "$MODO_PG" = "directo" ]; then
  pg_restore --no-owner --no-acl -d "${DATABASE_URL%/*}/$base_prueba" \
    <"$archivo" >"$salida_restore" 2>&1 || true
else
  docker exec -i "$POSTGRES_CONTAINER" \
    pg_restore --no-owner --no-acl -U "$PG_USER" -d "$base_prueba" \
    <"$archivo" >"$salida_restore" 2>&1 || true
fi

# pg_restore avisa de cosas inofensivas (permisos, extensiones ya presentes).
# Lo que de verdad importa se comprueba abajo, contando datos.
if grep -qi "error" "$salida_restore"; then
  echo "  Avisos durante la restauración (los primeros):"
  grep -i "error" "$salida_restore" | head -5 | sed 's/^/    /'
fi
rm -f "$salida_restore"

contar() {
  local tabla="$1"
  if [ "$MODO_PG" = "directo" ]; then
    psql -tA "${DATABASE_URL%/*}/$base_prueba" \
      -c "SELECT count(*) FROM \"$tabla\";" 2>/dev/null || echo "?"
  else
    docker exec -i "$POSTGRES_CONTAINER" \
      psql -tA -U "$PG_USER" -d "$base_prueba" \
      -c "SELECT count(*) FROM \"$tabla\";" 2>/dev/null || echo "?"
  fi
}

echo
echo "Lo que se recuperó:"
fallo=0

# Estas dos no pueden estar vacías: sin ellas no hay a quién devolverle nada.
for tabla in user organization; do
  n="$(contar "$tabla" | tr -d ' \r')"
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
  echo "  · $tabla: $(contar "$tabla" | tr -d ' \r')"
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
