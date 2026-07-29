#!/usr/bin/env bash
#
# Piezas compartidas por los guiones de respaldo.
#
# Sirven en las dos formas en que se llega a la base: con las herramientas de
# Postgres instaladas en la máquina, o a través del contenedor que las trae
# dentro. En un VPS recién hecho lo normal es lo segundo, y pedirle a alguien
# que instale postgresql-client antes de poder respaldar es justo la fricción
# que hace que no se respalde nunca.

error() {
  echo "ERROR: $*" >&2
  exit 1
}

legible() {
  local bytes="$1"
  if [ "$bytes" -ge 1073741824 ]; then
    echo "$((bytes / 1073741824)) GB"
  elif [ "$bytes" -ge 1048576 ]; then
    echo "$((bytes / 1048576)) MB"
  else
    echo "$((bytes / 1024)) KB"
  fi
}

# Decide por dónde se habla con Postgres y deja listo MODO_PG.
detectar_postgres() {
  if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
    MODO_PG="directo"
    return
  fi

  command -v docker >/dev/null 2>&1 ||
    error "No hay herramientas de Postgres ni Docker. Ejecuta esto en el servidor donde vive la base."

  if [ -z "${POSTGRES_CONTAINER:-}" ]; then
    local encontrados
    encontrados="$(docker ps --format '{{.Names}} {{.Image}}' |
      grep -i postgres | awk '{print $1}' || true)"
    local cuantos
    cuantos="$(printf '%s' "$encontrados" | grep -c . || true)"

    [ "$cuantos" -eq 0 ] &&
      error "No encontré ningún contenedor de Postgres corriendo. ¿Está encendido el servicio?"

    if [ "$cuantos" -gt 1 ]; then
      echo "Hay más de un Postgres corriendo:" >&2
      printf '  %s\n' $encontrados >&2
      error "Indica cuál con: POSTGRES_CONTAINER=<nombre> $0"
    fi
    POSTGRES_CONTAINER="$encontrados"
  fi

  docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER" ||
    error "El contenedor '$POSTGRES_CONTAINER' no está corriendo."

  MODO_PG="docker"
  echo "  (usando el contenedor $POSTGRES_CONTAINER)"
}

# Usuario y base dentro del contenedor. Los fija el despliegue de Vocero.
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-vocero}"

pg_dump_vocero() {
  if [ "$MODO_PG" = "directo" ]; then
    pg_dump -Fc --no-owner --no-acl "$DATABASE_URL"
  else
    docker exec "$POSTGRES_CONTAINER" \
      pg_dump -Fc --no-owner --no-acl -U "$PG_USER" "$PG_DB"
  fi
}

pg_restore_vocero() {
  if [ "$MODO_PG" = "directo" ]; then
    pg_restore "$@"
  else
    docker exec -i "$POSTGRES_CONTAINER" pg_restore "$@"
  fi
}

psql_vocero() {
  if [ "$MODO_PG" = "directo" ]; then
    psql "$DATABASE_URL" "$@"
  else
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" "$@"
  fi
}

# psql contra el servidor, no contra una base concreta: para crear o tirar la
# base de usar y tirar del simulacro.
psql_admin() {
  if [ "$MODO_PG" = "directo" ]; then
    psql "${DATABASE_URL%/*}/postgres" "$@"
  else
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$PG_USER" -d postgres "$@"
  fi
}

# --- Respaldos de cualquier procedencia ------------------------------------
#
# Conviven dos formatos, y los dos son legítimos:
#
#   vocero_*.dump    formato 'custom' de pg_dump  → se restaura con pg_restore
#   vocero-*.sql.gz  SQL plano comprimido         → se restaura con psql
#
# El segundo es el que genera el backup.sh que muchas instalaciones ya tienen
# montado en cron. No se fuerza a nadie a migrar: verificar y restaurar tiene
# que funcionar con la copia que uno YA tiene, no con la que debería tener.

# Carpetas donde se buscan respaldos, en orden.
CARPETAS_RESPALDO="${CARPETAS_RESPALDO:-/opt/korex-crm/backups $HOME/respaldos-vocero}"

# El respaldo más reciente de todas las carpetas conocidas.
respaldo_mas_reciente() {
  local encontrados=""
  for dir in $CARPETAS_RESPALDO; do
    [ -d "$dir" ] || continue
    encontrados="$encontrados $(find "$dir" -maxdepth 1 -type f \
      \( -name 'vocero_*.dump' -o -name 'vocero-*.sql.gz' -o -name 'vocero_*.sql.gz' \) \
      2>/dev/null || true)"
  done
  # shellcheck disable=SC2086
  ls -1t $encontrados 2>/dev/null | head -n 1
}

# Mete un respaldo dentro de una base concreta, según su formato.
restaurar_en_base() {
  local base="$1" archivo="$2"
  case "$archivo" in
    *.gz)
      # gunzip corre aquí y el SQL entra al servidor por la tubería: así no
      # hace falta copiar el archivo dentro del contenedor.
      gunzip -c "$archivo" | psql_en_base "$base"
      ;;
    *.sql)
      psql_en_base "$base" <"$archivo"
      ;;
    *)
      pg_restore_en_base "$base" <"$archivo"
      ;;
  esac
}

psql_en_base() {
  local base="$1"
  if [ "$MODO_PG" = "directo" ]; then
    psql -q "${DATABASE_URL%/*}/$base"
  else
    docker exec -i "$POSTGRES_CONTAINER" psql -q -U "$PG_USER" -d "$base"
  fi
}

pg_restore_en_base() {
  local base="$1"
  if [ "$MODO_PG" = "directo" ]; then
    pg_restore --no-owner --no-acl -d "${DATABASE_URL%/*}/$base"
  else
    docker exec -i "$POSTGRES_CONTAINER" \
      pg_restore --no-owner --no-acl -U "$PG_USER" -d "$base"
  fi
}

# Cuenta filas de una tabla en una base cualquiera. "?" si no se pudo.
contar_en_base() {
  local base="$1" tabla="$2"
  if [ "$MODO_PG" = "directo" ]; then
    psql -tA "${DATABASE_URL%/*}/$base" -c "SELECT count(*) FROM \"$tabla\";" 2>/dev/null || echo "?"
  else
    docker exec -i "$POSTGRES_CONTAINER" \
      psql -tA -U "$PG_USER" -d "$base" -c "SELECT count(*) FROM \"$tabla\";" 2>/dev/null || echo "?"
  fi
}
