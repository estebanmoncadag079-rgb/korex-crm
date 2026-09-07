# 162 — Fase 3C: el servidor deja de confiar en el SHA, empieza a verificarlo

7-sep-2026. Cierra el Hallazgo B dejado abierto en
[161](161-VULNERABILIDAD-ESCALADA-VIA-DUENO-DEL-BUILD-CONTEXT.md).

## 1. El problema exacto

Hasta esta fase, el wrapper root (`korex-deploy.sh`) validaba que el SHA
recibido tuviera el **formato** correcto (40 caracteres hexadecimales) y
construía lo que encontrara en un tarball que `deploy` había subido. Nunca
comprobaba que ese SHA fuera un commit **real** de `main`. `git rev-parse
SHA` —la comprobación obvia y **insuficiente**, señalada explícitamente
como inaceptable para esta fase— solo confirma que un string *parece* un
SHA; ni siquiera confirma que el objeto exista, y mucho menos que esté en
la historia de `main`.

**Consecuencia real**: quien tuviera la llave SSH de `deploy` podía pedir
la construcción y el despliegue de código que nunca pasó por el CI —
saltándose ancestro-de-`main`, tests, `typecheck`, `lint` y `build` — con
tal de nombrar el tarball con un SHA de forma válida.

## 2. La regla que debía cumplirse

El servidor NO debe aceptar:

- un SHA inventado — **verificado, rechazado** (sección 4, prueba A);
- un SHA real pero de otro repositorio — **verificado, rechazado** (prueba B);
- un commit real de Korex que existe pero no está en `main` — **verificado,
  rechazado** (prueba C, la más exigente: un commit real, publicado en
  GitHub, en una rama aparte);
- un tarball cuyo contenido no corresponda al commit — **eliminado de raíz**:
  ya no existe ningún tarball que `deploy` suba. El código se extrae
  directo de la fuente verificada.

## 3. Diseño implementado

**El servidor mantiene su propia copia de solo lectura del repositorio
real**, y es esa copia —nunca nada que `deploy` entregue— la que decide qué
se construye.

```
GitHub (korex-crm, privado)
    │  Deploy Key de solo lectura ("servidor-korex-espejo-solo-lectura")
    │  registrada vía `gh repo deploy-key add`, verificado: read-only
    ▼
/opt/korex-repo-mirror.git   (clon --bare, root:root, modo 700)
    │  la llave privada vive en /root/.ssh/korex_mirror_key (600, root:root)
    │
    ▼  invocado DENTRO del wrapper, en cada deploy:
    1. git fetch origin main          (refresca contra GitHub real)
    2. git cat-file -e SHA^{commit}   (¿existe de verdad?)
    3. git merge-base --is-ancestor SHA main   (¿es un ancestro real?)
    4. git archive SHA | tar -x -C <carpeta root:root>   (extrae de AHÍ, nunca de deploy)
    5. docker build / docker service update
```

### Por qué una Deploy Key, y por qué de solo lectura

Una Deploy Key de GitHub es una credencial atada a **un solo repositorio**
(no a la cuenta completa, a diferencia de un PAT), y puede marcarse
`read-only` desde su creación — GitHub la aplica del lado del servidor, no
es una convención que el cliente pueda ignorar. Verificado tras crearla:

```
$ gh repo deploy-key list --repo estebanmoncadag079-rgb/korex-crm
162584574  servidor-korex-espejo-solo-lectura  read-only  ssh-ed25519 ...
```

### Por qué extraer del espejo y no solo "verificar y confiar en el tarball"

Verificar el SHA pero seguir construyendo desde el tarball de `deploy`
dejaría una ventana: nada garantizaría que el tarball CONTIENE lo mismo que
ese SHA en GitHub. La solución que cierra esto de raíz es no usar el
tarball en absoluto — `git archive` extrae byte a byte lo que GitHub tiene
para ese commit, generado por el propio git del servidor, nunca copiado de
una fuente que `deploy` controla. Esto también simplificó `scripts/deploy.sh`:
los pasos "subir el código" y "preflight" desaparecen como pasos propios —
ya no hay nada que este script deba copiar.

## 4. Pruebas — las tres negativas exigidas, más la positiva

Todas ejecutadas contra el repositorio real, sin invocar jamás el wrapper
completo (eso habría sido un deploy real).

| Prueba | Cómo se construyó | Resultado |
|---|---|---|
| **A — SHA inventado** | `1111...1111` (formato válido, no existe) | `fatal: Not a valid object name` → **rechazado** |
| **B — SHA real, otro repositorio** | HEAD real de `kevinrivm/vocero-crm` (`8cba28f...`) | No existe en el espejo de Korex → **rechazado** |
| **C — commit real de Korex, fuera de main** | Se creó un commit real (`git commit --allow-empty`), se publicó en una rama nueva (`prueba-3c-huerfano`) en el repositorio real, y se probó — **existe** en el espejo (`cat-file -e` → sí) pero **no es ancestro de main** (`merge-base --is-ancestor` → falla) → **rechazado**. Rama eliminada de GitHub inmediatamente después de la prueba | **rechazado** |
| **Positiva — ancestro real** | El SHA actualmente desplegado, `85ac98a91b...` | `cat-file -e` → existe; `merge-base --is-ancestor` → **aceptado** |
| `deploy` lee la llave de la deploy key | — | `Permission denied` |
| `deploy` lee o escribe el espejo | — | Al detectarse que SÍ podía **listar** el contenido (lectura, no escritura) se endureció a `chmod 700` — reverificado: `Permission denied` incluso para listar |

La prueba C es la más fuerte de las cuatro exigidas: demuestra que la
verificación no se conforma con "el objeto existe" (que ya habría bastado
para descartar A y B) — exige además la pertenencia real a `main`.

## 5. Hallazgo adicional encontrado y cerrado en esta misma fase

Al revisar permisos del espejio recién creado, `deploy` podía **listar**
su contenido (`drwxr-xr-x`, heredado del `git clone` por defecto) aunque no
escribirlo. No era una vía de escalada —es exactamente el mismo código
fuente que `deploy` ya está autorizado a pedir que se despliegue— pero
excedía el mínimo estrictamente necesario (a `deploy` le basta con poder
*pedir* un SHA, nunca necesita *leer* el repositorio). Se corrigió a `700
root:root`, verificado.

## 6. Estado de los tres hallazgos de la Fase 3 completa

| Fase | Hallazgo | Estado |
|---|---|---|
| 3A | `deploy` con acceso directo a Docker/root | Cerrado |
| 3B | `deploy` dueño persistente del build context → escalada vía `Dockerfile` propio | Cerrado |
| 3C | El servidor no verificaba la procedencia del SHA contra `main` | **Cerrado en esta fase** |

No queda ningún hallazgo abierto de la frontera de privilegios del deploy.
Lo único pendiente para que el flujo automático funcione de punta a punta
es cargar los dos secrets de GitHub (`DEPLOY_SSH_HOST`, `DEPLOY_SSH_KEY`),
que sigue siendo una decisión explícita del dueño, no técnica.

## 7. Alcance respetado

- **Cero secrets creados en GitHub Actions** (la Deploy Key es un mecanismo
  distinto — vive en la configuración del repositorio, no en Secrets, y es
  de solo lectura por diseño de GitHub).
- **Cero deploys de aplicación** — producción mantuvo el mismo *uptime*
  desde el inicio de la Fase 3A hasta el cierre de esta (más de una hora
  seguida, verificado al final).
- **Cero cambios en lógica de producto.**
- El commit "huérfano" de la prueba C se creó, se publicó, se probó y se
  **eliminó de GitHub** en la misma sesión — no queda rastro en el
  repositorio salvo el propio objeto git (inevitable e inofensivo: un
  commit vacío, sin código, que ya no es alcanzable desde ninguna rama).

## 8. Rollback

- Wrapper: reinstalar la versión de la Fase 3B (sin el espejo) — pierde
  esta protección, no se recomienda.
- Deploy Key: `gh repo deploy-key delete 162584574 --repo
  estebanmoncadag079-rgb/korex-crm` + borrar `/opt/korex-repo-mirror.git` y
  `/root/.ssh/korex_mirror_key` en el servidor.
- `scripts/deploy.sh`: `git revert` de este commit vuelve al flujo de subir
  tarball (reabre el Hallazgo B si además se revierte el wrapper).
