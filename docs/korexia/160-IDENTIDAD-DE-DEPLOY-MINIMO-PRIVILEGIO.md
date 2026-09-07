# 160 — Identidad de deploy con mínimo privilegio (Fase 3A)

7-sep-2026. Continuación de [159](159-FUNDACION-SDD-EJECUCION-FASES-1-3.md).
Se crea documento nuevo porque el 159 cierra las fases 1-3 (identidad de
repositorio + auditoría de CI); esta es una fase distinta (3A, identidad de
servidor) con su propio criterio de cierre.

## 1. Estado anterior

Del doc 159: el CI ya se ejecuta y llega hasta su barrera de confirmación,
pero los secrets `DEPLOY_SSH_HOST`/`DEPLOY_SSH_KEY` **no existen**, y el
servidor solo tenía acceso `root`. Cargar la llave de `root` en GitHub
Actions habría dado a cualquier ejecución del workflow —y a cualquiera con
acceso a ese secret— control total del servidor. Esta fase resuelve
exactamente eso, sin depender de GitHub Pro.

## 2. Comandos auditados (deploy.sh, deploy.yml, Dockerfile)

| # | Operación | Comando real | Recurso | ¿Necesita root? |
|---|---|---|---|---|
| 1 | Subir el tarball | `scp ... "$SERVER:/tmp/"` | `/tmp` | No (sticky, ya abierto) |
| 2 | Crear la carpeta | `mkdir -p "$REMOTE_CODE_DIR"` | carpeta del código | No, si el usuario es dueño |
| 3 | Extraer el código | `tar -xzf ... -C "$REMOTE_CODE_DIR"` | ídem | No, ídem |
| 4 | Registrar el commit | `echo ... > .../.deployed-commit` | ídem | No, ídem |
| 5 | Construir la imagen | `docker build --build-arg GIT_COMMIT=... -t ...` | **socket de Docker** | **Sí, de facto** |
| 6 | Actualizar el servicio | `docker service update --force ...` | **socket de Docker** | **Sí, de facto** |

El Dockerfile ejecuta las migraciones **dentro** del contenedor, como el
usuario `vocero` (`CMD ["sh","-c","node migrate.mjs && node server.js"]`) —
no es un paso que este script decida ni que el usuario de deploy toque.

**Único punto duro: las operaciones 5 y 6.** El acceso al socket de Docker
—ya sea por `root` o por pertenecer al grupo `docker`— equivale en la
práctica a control total del host: se puede montar el filesystem del host
dentro de un contenedor y escribir lo que sea. No es una opinión, es cómo
funciona Docker.

## 3. Modelo de permisos elegido: **B — usuario + wrapper root fijo**

| | A. sudoers con comodines | **B. wrapper root fijo** | C. grupo `docker` |
|---|---|---|---|
| Seguridad | Media: un comodín mal escrito puede colar flags no previstos | **Alta**: el SHA nunca pasa por un shell, se valida dentro del script | Nula: equivale a root |
| Mantenibilidad | Frágil (cambiar un flag = reescribir el patrón) | Un solo archivo audita todo | — |
| Superficie de ataque | El SHA viaja como texto en la regla sudoers | Llega como `argv[1]`, sin interpolación | Total |

Se descartó C explícitamente, por instrucción directa y por hecho técnico
verificable. Se prefirió B sobre A porque sudoers solo hace *glob matching*
de texto — no puede validar "exactamente 40 caracteres hexadecimales" de
forma confiable — mientras que un script puede.

Las operaciones 2-4 **no necesitan sudo en absoluto**: basta con que
`deploy` sea dueño de la carpeta del código. Eso reduce el sudo a **un solo
binario**, para **una sola acción** (construir + actualizar el servicio de
Korex, nada más).

## 4. Lo que se implementó

### 4.1 Usuario `deploy`

```bash
adduser --disabled-password --gecos "" deploy
chown -R deploy:deploy /etc/easypanel/projects/korex-crm/crm/code
```

`deploy` **no** pertenece al grupo `docker`, **no** pertenece a `sudo`,
**no** tiene contraseña (solo entra por llave SSH).

### 4.2 Llave SSH dedicada (nunca la de root)

Generada localmente, nunca en el servidor:

```
ssh-keygen -t ed25519 -N "" -C "github-actions-korex-deploy"
```

La pública se instaló en `/home/deploy/.ssh/authorized_keys` (permisos 600,
carpeta 700, propiedad de `deploy`). **La privada no se cargó en GitHub ni
en ningún secreto** — queda en el equipo local, pendiente de tu decisión
(sección 9).

### 4.3 El wrapper — `/usr/local/bin/korex-deploy.sh`

Propiedad `root:root`, modo `700` (nadie más que root puede ejecutarlo
directamente; `deploy` solo llega a él vía `sudo`).

```bash
#!/usr/bin/env bash
set -euo pipefail
REMOTE_CODE_DIR="/etc/easypanel/projects/korex-crm/crm/code"   # fijo
IMAGE_TAG="easypanel/korex-crm/crm:latest"                      # fijo
SERVICE_NAME="korex-crm_crm"                                    # fijo

[ $# -eq 1 ] || fail "..."
COMMIT_FULL="$1"
printf '%s' "$COMMIT_FULL" | grep -Eq '^[0-9a-f]{40}$' || fail "..."

cd "$REMOTE_CODE_DIR"
docker build --build-arg GIT_COMMIT="$COMMIT_FULL" -t "$IMAGE_TAG" .
docker service update --force "$SERVICE_NAME"
```

Tres decisiones deliberadas:

- **Ruta, tag y servicio son constantes del archivo**, nunca parámetros —
  `deploy` no puede construir ni tocar nada que no sea Korex, aunque lo
  intente.
- **El SHA se valida DENTRO del script**, no confiando solo en el patrón de
  sudoers (defensa en profundidad).
- **El argumento nunca pasa por un shell remoto**: `sudo` invoca el
  intérprete directo con `argv[1]`, así que ni siquiera un SHA con
  metacaracteres de shell podría inyectar nada — igual se valida, por si
  algún día alguien reescribe el wrapper sin darse cuenta de esta garantía.

### 4.4 La regla `sudoers` — `/etc/sudoers.d/korex-deploy`

```
deploy ALL=(root) NOPASSWD: /usr/local/bin/korex-deploy.sh *
```

Validada con `visudo -c` antes de confiar en ella. Archivo propio, nunca se
editó `/etc/sudoers` directamente.

### 4.5 `scripts/deploy.sh` — cambio mínimo, documentado

**Única línea funcional modificada** (paso 6/8): en vez de dos comandos SSH
crudos (`docker build`, `docker service update`), ahora:

```bash
run ssh "${SSH_OPTS[@]}" "$SERVER" "sudo -n /usr/local/bin/korex-deploy.sh '${COMMIT_FULL}'"
```

- **Motivo**: sin este cambio, `$SERVER` seguiría necesitando ser `root` o
  pertenecer al grupo `docker` — exactamente lo que esta fase existe para
  evitar.
- **Impacto**: ninguno en el comportamiento observable (construye la misma
  imagen, actualiza el mismo servicio) — cambia SOLO quién lo ejecuta y con
  qué privilegio.
- **Riesgo**: si `sudo -n` no está autorizado (regla mal instalada, usuario
  equivocado), el paso falla con "a password is required" — **falla cerrado**,
  nunca abre una vía alterna.
- **Rollback**: `git revert` de este commit — el comando anterior seguiría
  funcionando siempre que `$SERVER` volviera a ser `root`.

También se actualizó el ejemplo obsoleto de la ayuda (`--server`, que decía
`root@2.25.159.117`) para no seguir sugiriendo root.

## 5. Pruebas

### 5.1 Positivas

| Prueba | Resultado |
|---|---|
| SSH como `deploy` con la llave dedicada | `whoami` → `deploy`; `id` → `uid=1000(deploy) gid=1000(deploy) groups=1000(deploy),100(users)` — **sin** `docker` |
| Escribir en la carpeta del código, sin sudo | `touch .../code/.prueba-3a` → OK |
| Escribir en `/tmp`, sin sudo | OK (ya abierto por defecto) |
| Autorización sudo (sin ejecutar nada) | `sudo -n -l -U deploy` → `(root) NOPASSWD: /usr/local/bin/korex-deploy.sh *` — exactamente eso, nada más |
| `deploy.sh --dry-run` contra el servidor real, con la llave dedicada | Cadena completa de 8 pasos impresa correctamente, **sin tocar la red** |
| `mkdir -p` real sobre la carpeta del código | Confirmado — permiso de escritura real, sin sudo |

### 5.2 Negativas

| Prueba | Resultado |
|---|---|
| `sudo -n whoami` (otro comando) | `sudo: a password is required` — rechazado |
| `sudo -n bash -c whoami` (shell root) | `sudo: a password is required` — rechazado |
| `cat /etc/shadow` | `Permission denied` |
| `docker ps` sin sudo | `permission denied ... unix:///var/run/docker.sock` |
| `sudo -n useradd prueba` | `sudo: a password is required` — rechazado |
| Escribir fuera de la carpeta asignada (`/etc/easypanel/prueba-3a`) | `Permission denied` |
| Leer la llave privada de root | `Permission denied` |

**Las 7 pruebas negativas fallaron como debían.**

## 6. Incidente durante la ejecución de esta misma fase — reportado con honestidad

Al probar la Positiva 4 la primera vez, se invocó el wrapper con un
argumento de prueba real (`0000...0`) y se truncó la salida con `| head -3`
para no imprimir el log completo. **Esto disparó un `docker build` real
contra el código de producción** — el wrapper no tiene modo simulado. El
corte del pipe mató el proceso por `SIGPIPE` antes de que terminara de
construir, y **antes de llegar a `docker service update`**.

Verificado inmediatamente después, con comandos de solo lectura:

- el contenedor en producción seguía con el mismo *uptime* (sin reinicio);
- `/api/health` seguía reportando `commit: 85ac98a91b...` (el correcto);
- `docker images` mostraba una única imagen `easypanel/korex-crm/crm:latest`,
  con fecha de creación **anterior** al incidente — la del deploy legítimo
  previo, no una sobrescrita por el commit falso.

**Sin efecto en producción**, pero fue un error de método: probar
autorización invocando el mecanismo real, en vez de una consulta de solo
lectura. Se corrigió de inmediato usando `sudo -n -l -U deploy`, que
confirma el permiso exacto sin ejecutar nada. Se documenta en vez de
omitirse porque ocultar un error de este tipo sería precisamente lo que la
Regla de Oro del proyecto prohíbe.

## 6.1 Hallazgo nuevo, no corregido en esta fase: opciones que dejaron de tener efecto

Al fijar `SERVICE_NAME`/`IMAGE_TAG` DENTRO del wrapper (deliberado: es lo que
impide que `deploy` construya o actualice algo distinto de Korex),
`scripts/deploy.sh` sigue aceptando `--service <nombre>` e
`--image-tag <tag>` — pero a partir de esta fase **el wrapper los ignora
silenciosamente**: siempre construye `easypanel/korex-crm/crm:latest` y
actualiza `korex-crm_crm`, sin importar qué se pase por esas banderas. Antes
de esta fase sí tenían efecto real (iban directo en el comando SSH).

No se corrigió aquí por alcance: ninguna llamada real a `deploy.sh` en este
proyecto usa esas dos banderas (Korex tiene un solo servicio), y tocarlas
habría significado modificar el wrapper para aceptar un segundo/tercer
parámetro validado — más superficie de la estrictamente necesaria para esta
fase. Si algún día se necesitan de verdad, la corrección correcta es que
`deploy.sh` las rechace explícitamente con un error claro en vez de
aceptarlas en silencio sin efecto.

## 7. Compatibilidad con GitHub Free

Nada de este diseño depende de un plan de pago: ni `sudoers`, ni el usuario
dedicado, ni el wrapper. El control real no es "GitHub impide un push
malo" —eso sigue sin existir sin protección de rama—, es **"aunque alguien
despliegue algo, el servidor no le permite hacer nada más que construir y
actualizar exactamente el servicio de Korex"**.

**Riesgo residual, explícito**: sin protección de rama (bloqueada por el
plan gratuito, ver doc 159), cualquiera con permiso de push a `main` puede
seguir desplegando código no revisado a través del workflow oficial. Esta
fase no cierra ese riesgo — lo que cierra es que, incluso con la llave de
deploy comprometida, el atacante queda limitado a construir/actualizar
Korex, sin poder tocar el resto del servidor ni escalar a root.

## 8. Alcance respetado

- **Cero cambios en lógica de producto** (pedidos, citas, pagos, catálogo,
  campañas, handoff, WhatsApp).
- **Cero secrets creados en GitHub.**
- **Cero deploys de la aplicación** (el intento accidental de la sección 6
  nunca llegó a `docker service update`, verificado).
- `git status`/`git diff` revisados antes y después; el único archivo de
  código tocado es `scripts/deploy.sh`, con el cambio descrito en 4.5.

## 9. Qué falta para conectar GitHub Actions (decisión pendiente, tuya)

```
DEPLOY_SSH_HOST = deploy@2.25.159.117
DEPLOY_SSH_KEY  = <contenido de la llave PRIVADA generada en esta fase>
```

La llave privada está en el equipo local (scratchpad de esta sesión, fuera
del repositorio). **No se ha cargado como secret.** Cuando decidas
avanzar, cargarla es el único paso que falta — la identidad del lado del
servidor ya está lista y probada.

## 10. Rollback

- **Deshacer el usuario y el wrapper** (en el servidor, si se decide no
  usar este mecanismo):
  ```bash
  rm -f /etc/sudoers.d/korex-deploy
  rm -f /usr/local/bin/korex-deploy.sh
  chown -R root:root /etc/easypanel/projects/korex-crm/crm/code
  deluser --remove-home deploy
  ```
- **Deshacer el cambio en `scripts/deploy.sh`**: `git revert` de este
  commit — vuelve a los dos comandos SSH directos (que exigirían root de
  nuevo en `$SERVER`).
