#!/usr/bin/env bash
#
# Fase 10N-A — despliegue reproducible a EasyPanel, para reemplazar el
# proceso manual documentado en docs/korexia/02-INFRAESTRUCTURA.md
# (git archive + scp + ssh + tar + docker build + docker service update,
# hecho a mano). Este script hace exactamente esos mismos pasos, en el
# mismo orden, con verificación real de versión al final — nunca inventa
# un mecanismo de EasyPanel que no exista.
#
# Uso:
#   scripts/deploy.sh <commit-sha> [opciones]
#
# Opciones:
#   --server <user@host>       Por defecto: $DEPLOY_SERVER (ej. root@2.25.159.117)
#   --ssh-key <ruta>           Por defecto: $DEPLOY_SSH_KEY
#   --remote-code-dir <ruta>   Por defecto: /etc/easypanel/projects/korex-crm/crm/code
#   --service <nombre>         Por defecto: korex-crm_crm
#   --image-tag <tag>          Por defecto: easypanel/korex-crm/crm:latest
#   --health-url <url>         Por defecto: https://crm.korexia.online/api/health
#   --timeout-seconds <N>      Por defecto: 300 (espera de health check)
#   --allow-worker-enabled     Si NO se pasa, aborta si el health check
#                              reporta campaignWorkerEnabled:true tras el
#                              deploy — salvaguarda explícita pedida para
#                              el primer despliegue de este módulo.
#   --yes                      Sin confirmación interactiva (uso en CI).
#   --dry-run                  Imprime cada comando SSH/scp/docker sin
#                              ejecutarlo. No toca el servidor ni la red.
#
# NUNCA hace rollback de base de datos. Un "rollback de código" es,
# deliberadamente, la MISMA operación: volver a correr este script con un
# commit anterior conocido-bueno. Un rollback de base de datos es SIEMPRE
# manual, revisando el bloque "-- Rollback:" al inicio de cada migración
# en drizzle/, nunca automático.
#
# Las migraciones NO son un paso aparte de este script: el propio
# contenedor las corre solo al arrancar (`node migrate.mjs && node
# server.js`, ver Dockerfile) — es el comportamiento ya establecido antes
# de este script, no algo que este script decida.

set -euo pipefail

SERVER="${DEPLOY_SERVER:-}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"
REMOTE_CODE_DIR="/etc/easypanel/projects/korex-crm/crm/code"
SERVICE_NAME="korex-crm_crm"
IMAGE_TAG="easypanel/korex-crm/crm:latest"
HEALTH_URL="https://crm.korexia.online/api/health"
TIMEOUT_SECONDS=300
ALLOW_WORKER_ENABLED=false
ASSUME_YES=false
DRY_RUN=false
COMMIT=""

log() {
  printf '[deploy %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
}

fail() {
  log "ABORTADO: $1"
  exit 1
}

run() {
  # Nunca imprime contenido de secretos: solo el comando, y la ruta de la
  # llave SSH (no su contenido) si aplica.
  if [ "$DRY_RUN" = true ]; then
    log "[dry-run] $*"
  else
    log "+ $*"
    "$@"
  fi
}

if [ $# -eq 0 ]; then
  fail "uso: scripts/deploy.sh <commit-sha> [opciones] — ver el comentario de cabecera"
fi
COMMIT="$1"
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --remote-code-dir) REMOTE_CODE_DIR="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --image-tag) IMAGE_TAG="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --timeout-seconds) TIMEOUT_SECONDS="$2"; shift 2 ;;
    --allow-worker-enabled) ALLOW_WORKER_ENABLED=true; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) fail "opción desconocida: $1" ;;
  esac
done

# Fase 10N-D (revisión pre-commit) — `ssh` concatena su comando final en UNA
# cadena que el shell remoto vuelve a parsear: cualquier valor que se
# interpole ahí (REMOTE_CODE_DIR, SERVICE_NAME, IMAGE_TAG, SERVER) es
# potencialmente ejecutable si trae comillas o metacaracteres de shell. El
# SHA del commit ya es seguro por construcción (sale de `git rev-parse`,
# siempre hexadecimal — ver más abajo), pero estos otros parámetros vienen
# de la línea de comandos y se tratan como input NO confiable: se validan
# contra una lista blanca de caracteres antes de usarse en cualquier
# comando remoto, en vez de confiar en que nadie los pase con intención.
validar_seguro() {
  case "$2" in
    *[!a-zA-Z0-9./_:@-]*) fail "$1 contiene caracteres no permitidos: '$2'" ;;
    "") fail "$1 no puede estar vacío" ;;
  esac
}
validar_seguro "--server" "$SERVER"
validar_seguro "--remote-code-dir" "$REMOTE_CODE_DIR"
validar_seguro "--service" "$SERVICE_NAME"
validar_seguro "--image-tag" "$IMAGE_TAG"

log "=== Fase 10N-A: deploy.sh ==="
log "commit solicitado: $COMMIT"
log "branch/repo actual: $(git branch --show-current 2>/dev/null || echo 'desconocido')"
log "disparado por: ${GITHUB_ACTOR:-${USER:-desconocido}}"

# 1a. Fase 10N-G — formato: SOLO un SHA1 hexadecimal (7-40 caracteres),
#     NUNCA un nombre de rama/tag/HEAD/HEAD~N. Una rama es un puntero
#     mutable — podría moverse entre el momento en que alguien la valida
#     y el momento en que este script realmente construye la imagen; un
#     SHA es inmutable por definición. Se rechaza cualquier otra forma
#     ANTES de intentar resolverla con git, para no aceptar "código
#     arbitrario" bajo ningún nombre simbólico.
case "$COMMIT" in
  [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]*)
    printf '%s' "$COMMIT" | grep -Eq '^[0-9a-fA-F]{7,40}$' \
      || fail "el commit debe ser un SHA hexadecimal de 7 a 40 caracteres, no '$COMMIT'"
    ;;
  *) fail "el commit debe ser un SHA hexadecimal (7-40 caracteres) — nunca una rama, tag o referencia simbólica como 'HEAD'/'main': '$COMMIT'" ;;
esac

# 1b. Validar commit — debe existir localmente y ser un SHA real, no una
#     referencia ambigua tipo "HEAD" (querer un commit EXACTO, trazable).
git rev-parse --verify "${COMMIT}^{commit}" > /dev/null 2>&1 \
  || fail "el commit '$COMMIT' no existe en este checkout local (¿hiciste git fetch?)"
COMMIT_FULL="$(git rev-parse "$COMMIT")"
log "commit resuelto: $COMMIT_FULL"

# 2. Validar branch — el commit debe ser un ancestro real de origin/main
#    (nunca desplegar algo que nunca se publicó/revisó).
git fetch origin main --quiet 2>/dev/null || log "aviso: no se pudo hacer fetch de origin/main (¿sin red en este dry-run?)"
if git rev-parse --verify origin/main > /dev/null 2>&1; then
  git merge-base --is-ancestor "$COMMIT_FULL" origin/main \
    || fail "el commit $COMMIT_FULL no es un ancestro de origin/main — no se despliega código no publicado"
  log "verificado: $COMMIT_FULL es ancestro de origin/main"
else
  log "aviso: no se pudo verificar origin/main en este entorno — omitido"
fi

if [ -z "$SSH_KEY" ] && [ "$DRY_RUN" = false ]; then
  fail "falta --ssh-key (o \$DEPLOY_SSH_KEY)"
fi

if [ "$ASSUME_YES" = false ] && [ "$DRY_RUN" = false ]; then
  read -r -p "¿Desplegar $COMMIT_FULL a $SERVER, servicio $SERVICE_NAME? [escribe 'si' para continuar] " CONFIRMACION
  [ "$CONFIRMACION" = "si" ] || fail "cancelado por el operador"
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")

# 3. Sincronizar código — mismo mecanismo ya documentado y probado a mano
#    (docs/korexia/02-INFRAESTRUCTURA.md): EasyPanel construye SOLO desde
#    esta carpeta del servidor, nunca clona el repo ni se entera del push.
TARBALL="/tmp/korex-crm-${COMMIT_FULL}.tar.gz"
log "3/8 sincronizando código (git archive + scp + tar)"
run git archive --format=tar.gz -o "$TARBALL" "$COMMIT_FULL"
run scp "${SSH_OPTS[@]}" "$TARBALL" "${SERVER}:/tmp/"
run ssh "${SSH_OPTS[@]}" "$SERVER" \
  "mkdir -p '${REMOTE_CODE_DIR}' && tar -xzf '/tmp/$(basename "$TARBALL")' -C '${REMOTE_CODE_DIR}' && rm -f '/tmp/$(basename "$TARBALL")'"
rm -f "$TARBALL"

# 4. Preflight — confirma que el código que se sincronizó es el commit
#    esperado, ANTES de construir nada. No hay `.git` en esa carpeta
#    (docs/korexia/02-INFRAESTRUCTURA.md), así que se compara contra un
#    archivo que el propio `git archive` no incluye por defecto: se
#    escribe aparte.
log "4/8 preflight: registrando el commit exacto sincronizado"
run ssh "${SSH_OPTS[@]}" "$SERVER" "echo '${COMMIT_FULL}' > '${REMOTE_CODE_DIR}/.deployed-commit'"

# 5. Migraciones — NO es un paso aparte: `migrate.mjs` corre solo al
#    arrancar el contenedor nuevo (ver Dockerfile, CMD). Este script no
#    ejecuta ningún ALTER TABLE por su cuenta; lo único que puede hacer un
#    humano manualmente es el "-- Rollback:" de una migración concreta, y
#    eso está deliberadamente fuera de este script.
log "5/8 migraciones: se aplican solas al arrancar el contenedor nuevo (migrate.mjs) — sin paso manual aparte"

# 6. Deploy — build con el commit horneado + swarm update forzado, EXACTO
#    al mecanismo de emergencia ya documentado y probado.
log "6/8 build + deploy (docker build --build-arg GIT_COMMIT + service update --force)"
run ssh "${SSH_OPTS[@]}" "$SERVER" \
  "cd '${REMOTE_CODE_DIR}' && docker build --build-arg GIT_COMMIT='${COMMIT_FULL}' -t '${IMAGE_TAG}' ."
run ssh "${SSH_OPTS[@]}" "$SERVER" "docker service update --force '${SERVICE_NAME}'"

if [ "$DRY_RUN" = true ]; then
  log "[dry-run] fin — no se esperó health check real ni se verificó versión"
  exit 0
fi

# 7. Esperar health.
log "7/8 esperando health check en ${HEALTH_URL} (hasta ${TIMEOUT_SECONDS}s)"
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
HEALTH_BODY=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if HEALTH_BODY="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
    if printf '%s' "$HEALTH_BODY" | grep -q '"ok":true'; then
      log "health check OK"
      break
    fi
  fi
  sleep 5
done
if [ -z "$HEALTH_BODY" ] || ! printf '%s' "$HEALTH_BODY" | grep -q '"ok":true'; then
  fail "health check no respondió 'ok:true' dentro de ${TIMEOUT_SECONDS}s — el servicio puede estar sirviendo código VIEJO o caído. No se intenta rollback automático: decide y, si hace falta, vuelve a correr este script con el commit anterior conocido-bueno."
fi

# 8. Verificar versión — "EasyPanel dice healthy" NUNCA es suficiente por
#    sí solo (docs/korexia/02-INFRAESTRUCTURA.md, incidentes del 1-ago y
#    5-ago-2026): se compara el commit que /api/health reporta contra el
#    que se pidió desplegar.
log "8/8 verificando versión desplegada"
DEPLOYED_COMMIT="$(printf '%s' "$HEALTH_BODY" | grep -o '"commit":"[^"]*"' | cut -d'"' -f4)"
log "commit esperado:   $COMMIT_FULL"
log "commit desplegado: ${DEPLOYED_COMMIT:-<vacío>}"
if [ "$DEPLOYED_COMMIT" != "$COMMIT_FULL" ]; then
  fail "el commit desplegado NO coincide con el esperado — 'healthy' no es evidencia suficiente, esto lo confirma. Revisa el paso 3 (sincronización) antes de reintentar."
fi

WORKER_ENABLED="$(printf '%s' "$HEALTH_BODY" | grep -o '"campaignWorkerEnabled":[a-z]*' | cut -d':' -f2)"
log "CAMPAIGN_WORKER_ENABLED reportado: ${WORKER_ENABLED:-<desconocido>}"
if [ "$WORKER_ENABLED" = "true" ] && [ "$ALLOW_WORKER_ENABLED" = false ]; then
  fail "el worker de campañas está ENCENDIDO y no se pasó --allow-worker-enabled — salvaguarda del primer despliegue de este módulo. El deploy de código salió bien; esto detiene solo la confirmación final, revisa la configuración de EasyPanel antes de dar por bueno el resultado."
fi

log "=== DEPLOY COMPLETO: $COMMIT_FULL, servicio $SERVICE_NAME, worker=${WORKER_ENABLED:-desconocido} ==="
