#!/usr/bin/env bash
#
# Restauración REAL sobre la base de producción. Pisa lo que hay.
#
# Es el día malo, y en el día malo se cometen errores: por eso pide escribir
# una palabra a mano y, antes de tocar nada, guarda una copia de emergencia de
# lo que exista ahora mismo. Aunque estés restaurando porque los datos
# actuales están mal, esa copia es la que permite volver atrás si resulta que
# el respaldo elegido era peor.
#
# Antes de usar esto en serio, prueba la copia con:
#   ./scripts/respaldo/simulacro.sh <archivo>
#
#   ./scripts/respaldo/restaurar.sh ruta/al.dump
#
set -euo pipefail

DESTINO="${DESTINO:-$HOME/respaldos-vocero}"

# shellcheck source=scripts/respaldo/comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"

archivo="${1:-}"
[ -n "$archivo" ] || error "Falta el archivo: ./scripts/respaldo/restaurar.sh <archivo.dump>"
[ -f "$archivo" ] || error "No existe el archivo: $archivo"

detectar_postgres

echo
echo "════════════════════════════════════════════════════════════"
echo "  Vas a REEMPLAZAR la base de datos de producción"
echo "════════════════════════════════════════════════════════════"
echo "  Con:  $archivo"
echo "  Todo lo que haya ahora y no esté en esa copia se pierde:"
echo "  conversaciones, contactos y pedidos posteriores a ella."
echo
printf "  Para seguir, escribe RESTAURAR: "
read -r confirmacion
if [ "$confirmacion" != "RESTAURAR" ]; then
  echo "  Cancelado. No se tocó nada."
  exit 0
fi

echo
echo "→ Guardando una copia de emergencia de lo que hay AHORA…"
mkdir -p "$DESTINO"
emergencia="$DESTINO/antes-de-restaurar_$(date +%Y-%m-%d_%H%M%S).dump"
if pg_dump_vocero >"$emergencia" 2>/dev/null && [ -s "$emergencia" ]; then
  echo "  Guardada en: $emergencia"
else
  rm -f "$emergencia"
  echo "  AVISO: no se pudo guardar la copia de emergencia."
  printf "  ¿Seguir de todas formas? Escribe SI: "
  read -r seguir
  [ "$seguir" = "SI" ] || { echo "  Cancelado. No se tocó nada."; exit 0; }
fi

echo "→ Restaurando…"
# --clean --if-exists: borra cada objeto antes de recrearlo, así no quedan
# restos de la base anterior mezclados con la copia.
if [ "$MODO_PG" = "directo" ]; then
  pg_restore --clean --if-exists --no-owner --no-acl \
    -d "$DATABASE_URL" <"$archivo" 2>&1 | grep -i "error" | head -10 || true
else
  docker exec -i "$POSTGRES_CONTAINER" \
    pg_restore --clean --if-exists --no-owner --no-acl \
    -U "$PG_USER" -d "$PG_DB" <"$archivo" 2>&1 | grep -i "error" | head -10 || true
fi

echo
echo "✓ Restauración terminada."
echo
echo "AHORA, en este orden:"
echo "  1. Reinicia la aplicación en Coolify (para que suelte conexiones viejas)."
echo "  2. Abre https://TU-DOMINIO/api/health y comprueba que responde ok."
echo "  3. Entra al CRM y mira que estén las conversaciones de un cliente real."
echo "  4. Si algo quedó mal, la copia de antes está en:"
echo "     $emergencia"
