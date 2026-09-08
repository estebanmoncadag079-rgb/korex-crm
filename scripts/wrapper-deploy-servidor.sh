#!/usr/bin/env bash
#
# Wrapper root de despliegue de Korex — fuente versionada (Fase 3H, 7-sep-2026).
#
# ESTE archivo es la fuente de verdad. La copia que de verdad ejecuta el
# servidor vive en /usr/local/bin/korex-deploy.sh (root:root, modo 700,
# invocable solo por el usuario `deploy` vía `sudo` sin contraseña — ver
# docs/korexia/160). Para (re)instalarlo:
#
#   scp scripts/wrapper-deploy-servidor.sh root@<servidor>:/tmp/
#   ssh root@<servidor> 'install -o root -g root -m 700 \
#     /tmp/wrapper-deploy-servidor.sh /usr/local/bin/korex-deploy.sh && \
#     rm -f /tmp/wrapper-deploy-servidor.sh'
#
# Requiere, además (provisión manual, fuera de este archivo — ver docs/
# korexia/160-162 para el detalle completo de cada pieza):
#   - el usuario `deploy`, sin grupo `docker`, sin sudo general;
#   - la regla /etc/sudoers.d/korex-deploy (NOPASSWD solo para este binario);
#   - el espejo /opt/korex-repo-mirror.git (clon --bare, root:root, 700);
#   - la Deploy Key de solo lectura en /root/.ssh/korex_mirror_key (600, root:root).
#
# Historial de por qué cada pieza existe:
#   - Fase 3A (docs/korexia/160) — usuario `deploy` sin acceso a Docker.
#   - Fase 3B (docs/korexia/161) — deja de confiar en una carpeta persistente
#     que `deploy` pudiera tocar: la reconstruye desde cero, como root, en
#     cada invocación.
#   - Fase 3C (docs/korexia/162) — deja de confiar en el CONTENIDO que
#     `deploy` entregara: verifica el SHA contra su propio espejo de
#     GitHub (Deploy Key de solo lectura) antes de construir nada.
#   - Fase 3H (docs/korexia/165, ESTE cambio) — el refresco del espejo
#     (`git fetch`) dejó de depender de que `remote.origin.fetch` esté
#     configurado en el espejo. La Fase 3G descubrió, en el preflight
#     antes del primer deploy real, que `git clone --bare` NO configura
#     ningún refspec por defecto (es comportamiento estándar de git —
#     un clon `--bare` se asume destino de `push`, no espejo que se
#     refresca solo). Sin refspec, `git fetch origin main` descargaba los
#     objetos nuevos pero NUNCA actualizaba `refs/heads/main`: el espejo
#     quedaba congelado en el commit del momento del `clone`, y CUALQUIER
#     commit posterior —por legítimo que fuera— fallaba la verificación de
#     ancestro para siempre. Se corrigió primero a mano (`git config
#     remote.origin.fetch ...` directo en el servidor), pero esa
#     corrección se pierde si el espejo se reconstruye alguna vez. Ahora
#     el propio `fetch` de este script especifica el refspec EXPLÍCITO en
#     la línea de comando — funciona igual con o sin configuración
#     persistente en el espejo, y viaja con el código, no con el servidor.

set -euo pipefail

REMOTE_CODE_DIR="/etc/easypanel/projects/korex-crm/crm/code"
IMAGE_TAG="easypanel/korex-crm/crm:latest"
SERVICE_NAME="korex-crm_crm"
GIT_MIRROR="/opt/korex-repo-mirror.git"
GIT_MIRROR_KEY="/root/.ssh/korex_mirror_key"

fail() {
  echo "[korex-deploy] ABORTADO: $1" >&2
  exit 1
}

[ $# -eq 1 ] || fail "se esperaba exactamente 1 argumento (el commit SHA completo), se recibieron $#"

COMMIT_FULL="$1"
printf '%s' "$COMMIT_FULL" | grep -Eq '^[0-9a-f]{40}$' \
  || fail "el commit debe ser un SHA1 completo de 40 caracteres hexadecimales en minúscula, se recibió: '$COMMIT_FULL'"

[ -d "$GIT_MIRROR" ] || fail "no existe el espejo verificado $GIT_MIRROR"
[ -f "$GIT_MIRROR_KEY" ] || fail "no existe la deploy key del espejo $GIT_MIRROR_KEY"

echo "[korex-deploy] 1/6 refrescando el espejo de solo lectura contra GitHub"
# Fase 3H — refspec EXPLÍCITO en la línea de comando ("+refs/heads/main:
# refs/heads/main"), no "fetch origin main" a secas. Con el refspec
# explícito, este `fetch` actualiza refs/heads/main del espejo SIEMPRE,
# exista o no una entrada `remote.origin.fetch` configurada de antemano —
# es lo que hace que la corrección viaje con este archivo (versionado en
# scripts/wrapper-deploy-servidor.sh) en vez de vivir solo en la
# configuración de un servidor concreto, que se pierde si el espejo se
# reconstruye, el servidor se reinstala, o se provisiona uno nuevo.
GIT_SSH_COMMAND="ssh -i ${GIT_MIRROR_KEY} -o IdentitiesOnly=yes" \
  git --git-dir="$GIT_MIRROR" fetch origin '+refs/heads/main:refs/heads/main' --quiet \
  || fail "no se pudo refrescar el espejo desde GitHub"

echo "[korex-deploy] 2/6 verificando que el commit existe de verdad"
git --git-dir="$GIT_MIRROR" cat-file -e "${COMMIT_FULL}^{commit}" 2>/dev/null \
  || fail "el commit $COMMIT_FULL NO existe en el espejo verificado del repositorio — no se construye código sin confirmar en GitHub"

echo "[korex-deploy] 3/6 verificando que el commit es un ANCESTRO real de main"
git --git-dir="$GIT_MIRROR" merge-base --is-ancestor "$COMMIT_FULL" main \
  || fail "el commit $COMMIT_FULL existe pero NO es un ancestro de main en el espejo verificado — no se despliega código que no esté en main"

echo "[korex-deploy] 4/6 reconstruyendo $REMOTE_CODE_DIR desde el espejo verificado (nunca desde nada subido por deploy)"
rm -rf "$REMOTE_CODE_DIR"
mkdir -p "$REMOTE_CODE_DIR"
chown root:root "$REMOTE_CODE_DIR"
chmod 755 "$REMOTE_CODE_DIR"
git --git-dir="$GIT_MIRROR" archive "$COMMIT_FULL" | tar -x -C "$REMOTE_CODE_DIR"
chown -R root:root "$REMOTE_CODE_DIR"
echo "$COMMIT_FULL" > "$REMOTE_CODE_DIR/.deployed-commit"

echo "[korex-deploy] 5/6 construyendo $IMAGE_TAG con GIT_COMMIT=$COMMIT_FULL"
cd "$REMOTE_CODE_DIR"
docker build --build-arg GIT_COMMIT="$COMMIT_FULL" -t "$IMAGE_TAG" .

echo "[korex-deploy] 6/6 actualizando el servicio $SERVICE_NAME"
docker service update --force "$SERVICE_NAME"

echo "[korex-deploy] listo: $COMMIT_FULL (verificado contra GitHub, ancestro de main)"
