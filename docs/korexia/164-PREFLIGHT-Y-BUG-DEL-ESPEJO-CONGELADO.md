# 164 — Fase 3G: preflight oficial, y un bug que habría bloqueado el primer deploy real

7-sep-2026. Preflight de extremo a extremo del camino oficial de GitHub
Actions, sobre el commit de cierre de la Fase 3F
(`f3a6417d6bdc0f9b1ac6ba20db0ddfb027a89312`), antes de autorizar el primer
deploy real. **Encontró un bug bloqueante real, corregido en el sitio.**

## 1. Estado de `main` — limpio

```
HEAD          = f3a6417d6bdc0f9b1ac6ba20db0ddfb027a89312
origin/main   = f3a6417d6bdc0f9b1ac6ba20db0ddfb027a89312   (idénticos)
```

## 2. El hallazgo: el espejo del servidor nunca se actualizaba

Al probar la cadena de verificación con el commit real de cierre
(`f3a6417`), el paso "¿es ancestro de `main`?" **falló** — a pesar de que
`f3a6417` es, obviamente, el propio `HEAD` de `main`.

### Causa raíz

`git clone --bare` (usado en la Fase 3C para crear
`/opt/korex-repo-mirror.git`) **no configura ningún refspec** para el
remoto `origin` — es comportamiento estándar de git: un clon `--bare` se
asume, por diseño, que va a ser destino de `push` desde otro lado, no un
espejo que se refresca con `fetch` repetidos. Confirmado:

```
$ git --git-dir=/opt/korex-repo-mirror.git config --get-regexp "remote\.origin\..*"
remote.origin.url git@github.com:estebanmoncadag079-rgb/korex-crm.git
```
(sin ninguna línea `remote.origin.fetch`)

**Consecuencia real**: cada `git fetch origin main` que el wrapper ejecuta
(paso 1/6 de `korex-deploy.sh`) SÍ descargaba los objetos nuevos —por eso
`cat-file -e` encontraba el commit sin problema— pero **nunca actualizaba
`refs/heads/main`** dentro del espejo. `main` seguía apuntando, congelado,
al commit que existía en el momento del `clone` original (Fase 3C:
`85ac98a91b...`).

**Esto habría bloqueado TODOS los deploys futuros, para siempre**, salvo
el primer commit que ya existía al clonar: cualquier commit nuevo, por
más legítimo que fuera, habría fallado la verificación de ancestro con el
mensaje *"existe pero NO es un ancestro de main"* — exactamente el mismo
mensaje que las pruebas negativas de la Fase 3C, pero disparado por un bug,
no por un intento real de fraude.

### Por qué no se vio en la Fase 3C

Las pruebas de esa fase usaron el SHA que YA era `main` en el momento del
`clone` (`85ac98a`) — coincidía con el `main` congelado del espejo por
casualidad, así que el `merge-base --is-ancestor` pasaba sin que el
refspec faltante se notara. La prueba C de esa fase (el commit huérfano)
tampoco lo habría revelado, porque un commit fuera de `main` falla el
`merge-base` de todos modos, sea `main` el real o uno congelado. Hacía
falta, específicamente, probar con un commit **posterior** al `clone`
original — que es exactamente lo que esta fase de preflight hizo al usar
`f3a6417` en vez de repetir `85ac98a`.

## 3. Corrección aplicada — mínima, sin tocar el wrapper ni la arquitectura

Solo configuración del espejo, ningún archivo de código ni el wrapper se
modificó:

```bash
git --git-dir=/opt/korex-repo-mirror.git config remote.origin.fetch \
  "+refs/heads/main:refs/heads/main"
```

Con esto, `git fetch origin main` —el mismo comando que el wrapper ya
ejecuta, sin cambios— actualiza `refs/heads/main` como se esperaba desde
el diseño original de la Fase 3C.

### Verificado

```
$ git --git-dir=/opt/korex-repo-mirror.git rev-parse main
f3a6417d6bdc0f9b1ac6ba20db0ddfb027a89312   ← antes: 85ac98a91b... (congelado)

$ git --git-dir=/opt/korex-repo-mirror.git merge-base --is-ancestor f3a6417... main
CORRECTO: aceptado
```

## 4. Preflight del camino oficial — resultado

Se disparó el workflow real con el commit de cierre y una confirmación
deliberadamente inválida (misma técnica que las Fases 2 y 3D — nunca se
escribió `CONFIRMAR`):

```
Run 34168113695, commit f3a6417d6bdc0f9b1ac6ba20db0ddfb027a89312:
✓ Gate local (typecheck, lint, tests, build)     4m15s
X Deploy → entra a environment `production`         3s
    X Barrera de confirmación (falla, como debe — nunca se escribió CONFIRMAR)
    - Checkout, llave SSH, deploy.sh                  ← nunca se ejecutan
```

Producción, verificada al cierre de la fase:

```
docker ps: Up 2 hours (healthy)
/api/health: {"ok":true,"commit":"85ac98a91b...","campaignWorkerEnabled":false}
```

Sigue en el commit anterior — correcto, ningún deploy real ha ocurrido
todavía.

## 5. Riesgo residual, honesto

El refresco del refspec vive en la **configuración** del espejo
(`/opt/korex-repo-mirror.git/config`), no en el wrapper. Si algún día
alguien reconstruye el espejo desde cero (`rm -rf` + `clone --bare` de
nuevo) sin conocer este documento, el bug reaparece silenciosamente —
volvería a congelar `main` en el commit del momento del clone. **No se
corrigió en el wrapper mismo** (que sería la solución permanente:
`git fetch origin +refs/heads/main:refs/heads/main` explícito en cada
invocación, sin depender de configuración persistente) porque esta fase
restringe explícitamente "no modificar la arquitectura" — se aplicó el
arreglo mínimo que la regla permite y se documenta la mejora pendiente
para que quede decidida, no perdida.

## 6. Estado de preparación para el primer deploy real

| Verificación | Resultado |
|---|---|
| `HEAD` == `origin/main` | Sí |
| `scripts/deploy.sh` en `main` coincide con el servidor | Sí (dry-run real, mismo commit) |
| El espejo del servidor conoce y acepta el commit de cierre | Sí (tras la corrección de esta fase) |
| Gate CI (typecheck/lint/test/build) sobre el commit de cierre | Verde, 4m15s |
| Barrera de confirmación del workflow | Funciona, detiene antes de tocar el servidor |
| Producción | Intacta, sin interrupciones, en el commit anterior |

**No queda ningún bloqueador técnico conocido para el primer deploy real.**
La decisión de ejecutarlo (escribir `CONFIRMAR`) sigue siendo tuya.

## 7. Alcance respetado

- **Cero deploys de aplicación** — segunda vez que se dispara el workflow
  sin cruzar la barrera de confirmación.
- **Cero `docker service update`, cero reinicio de servicios.**
- **Cero cambios de secrets.**
- El único cambio de esta fase es una línea de configuración de `git` en
  el espejo, no en ningún archivo del repositorio ni en el wrapper.

## 8. Rollback

```bash
git --git-dir=/opt/korex-repo-mirror.git config --unset remote.origin.fetch
```

Vuelve al estado (con bug) de la Fase 3C — no se recomienda.
