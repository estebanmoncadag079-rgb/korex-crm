# 163 — Fase 3D: GitHub Actions conectado a la infraestructura segura

7-sep-2026. Cierra la conexión entre el workflow oficial y lo construido en
[159](159-FUNDACION-SDD-EJECUCION-FASES-1-3.md)-[162](162-VERIFICACION-DE-PROCEDENCIA-DEL-SHA-DE-DEPLOY.md).

## 1. Auditoría previa — nombres exactos, sin inventar nada

`.github/workflows/deploy.yml` líneas 119-120:

```yaml
DEPLOY_SSH_KEY_CONTENT: ${{ secrets.DEPLOY_SSH_KEY }}
DEPLOY_SERVER: ${{ secrets.DEPLOY_SSH_HOST }}
```

Y línea 149: `scripts/deploy.sh "$COMMIT_SHA" --server "$DEPLOY_SERVER" --ssh-key ~/.ssh/deploy_key --yes $ALLOW_FLAG`.

Dos nombres, exactos, ya fijados por el propio workflow: **`DEPLOY_SSH_HOST`**
y **`DEPLOY_SSH_KEY`**. `DEPLOY_SSH_HOST` debe tener la forma `usuario@host`
(es lo que `--server` espera). Ninguno se inventó — ambos ya estaban
escritos en el workflow desde la Fase 10N-G, antes de esta sesión.

El job `deploy` declara `environment: production` — por diseño (comentario
del propio workflow, Fase 10N-G): un Environment separa esos dos secrets de
cualquier otro workflow o job que no lo declare, gratis en cualquier plan.
Por eso los secrets se cargaron **en el Environment**, no como secreto de
repositorio general.

## 2. Lo que se cargó

```
gh secret set DEPLOY_SSH_HOST --env production   valor: deploy@2.25.159.117
gh secret set DEPLOY_SSH_KEY  --env production   valor: la llave privada generada en la Fase 3A
                                                          (github-actions-korex-deploy)
```

Verificado — solo nombres y fecha, nunca valores:

```
$ gh secret list --repo estebanmoncadag079-rgb/korex-crm --env production
DEPLOY_SSH_HOST   2026-09-07T22:06:38Z
DEPLOY_SSH_KEY    2026-09-07T22:07:14Z
```

Protección del Environment revisada antes de cargar nada:
`protection_rules: []`, `deployment_branch_policy: null` — sin *required
reviewers* ni restricción de rama (límites ya conocidos de GitHub Free,
doc 159). El aislamiento real que sí aporta el Environment: estos dos
secrets **no existen** para ningún otro job ni workflow del repositorio.

## 3. Verificación SIN desplegar

Regla de esta fase: ningún deploy de aplicación. Se disparó el workflow con
una confirmación deliberadamente inválida — la misma técnica de la Fase 2 —
para comprobar la cadena sin llegar a usar los secrets de verdad:

```
Run 34165601794:
✓ Gate local (typecheck, lint, tests, build)          4m8s
X Deploy → entra al Environment `production`             3s
    X Verificar la barrera de confirmación (falla, como debe)
    - Checkout, configurar llave SSH, ejecutar deploy.sh   ← nunca se ejecutan
```

**Lo que esto SÍ demuestra**: el job `deploy` resuelve el Environment
`production` correctamente (solo es posible porque los secrets ya existen
ahí) y la barrera de confirmación lo detiene antes de tocar la llave SSH.

**Lo que esto NO demuestra**: que el contenido exacto de `DEPLOY_SSH_KEY`
sea usable por GitHub Actions para conectarse de verdad — eso solo se
ejerce después de la barrera de confirmación, que deliberadamente no se
cruzó en esta fase. La confianza en que la llave es correcta viene de
haberla usado, byte a byte, docenas de veces esta sesión directamente
contra el servidor (Fases 3A-3C) — nunca de una ejecución real del
workflow.

## 4. Hallazgo real encontrado en esta fase: `scripts/deploy.sh` no está commiteado

**Esto es importante y afecta directamente si un deploy real funcionaría
hoy.** Las Fases 3A-3C reescribieron `scripts/deploy.sh` (ya no sube ningún
tarball, ya no asume acceso root) — pero ese cambio sigue **solo en el
working tree local**, nunca comiteado ni empujado a GitHub.

```
$ git log --oneline -1
85ac98a fix: no exigir una verificacion de domicilio ...

$ git status --short scripts/deploy.sh
 M scripts/deploy.sh    ← modificado, SIN commitear
```

**Consecuencia concreta**: el workflow real revisado (checkout) usa el
`scripts/deploy.sh` **del commit que se pida desplegar** — hoy, cualquier
commit real de `main` trae la versión VIEJA de ese script (la que hace
`ssh $SERVER "docker build..."` directo, asumiendo que `$SERVER` es root).
Como `DEPLOY_SSH_HOST` ahora apunta a `deploy@...` (sin acceso a Docker),
**un deploy real intentado HOY fallaría** en el paso de build — de forma
visible y segura (permiso denegado), nunca silenciosa ni insegura, pero
fallaría de todos modos.

No se corrigió en esta fase por alcance: la regla explícita de la Fase 3D
es "no cambiar arquitectura de Korex" y "no hacer deploy de aplicación" —
comitear y empujar `scripts/deploy.sh` es una acción de código real que
merece su propia autorización explícita, no una consecuencia automática de
"conectar los secrets".

### Qué falta para que un deploy real funcione de punta a punta

1. Comitear `scripts/deploy.sh` + los docs 160-163 (o al menos el script).
2. Empujar a `main`.
3. Recién ahí, un `workflow_dispatch` con el SHA de ESE commit (o uno
   posterior) usaría la versión correcta del script contra el servidor ya
   preparado.

## 5. Estado de la conexión

| Pieza | Estado |
|---|---|
| Nombres de secrets | Confirmados contra el workflow real, sin inventar |
| Secrets cargados | `DEPLOY_SSH_HOST`, `DEPLOY_SSH_KEY` — en el Environment `production` |
| Verificación de la barrera | Confirmada, sin ejecutar el deploy real |
| Servidor (usuario, wrapper, espejo) | Listo desde la Fase 3C |
| **`scripts/deploy.sh` en GitHub** | **Desactualizado — sigue siendo la versión pre-Fase-3A** |
| Un deploy real hoy | Fallaría de forma segura en el paso de build (sin acceso root) |

## 6. Alcance respetado

- **Cero deploys de aplicación** — segunda ejecución del workflow, misma
  técnica de confirmación inválida que la primera vez.
- **Cero cambios de código** en esta fase — solo configuración del lado de
  GitHub (Environment secrets).
- **Cero cambios de lógica de negocio ni de arquitectura de Korex.**
- Producción: mismo *uptime* ininterrumpido verificado al final (~1 hora
  desde el inicio de la Fase 3A).

## 7. Rollback

```
gh secret delete DEPLOY_SSH_HOST --repo estebanmoncadag079-rgb/korex-crm --env production
gh secret delete DEPLOY_SSH_KEY  --repo estebanmoncadag079-rgb/korex-crm --env production
```

Elimina la conexión sin afectar nada del servidor (Fases 3A-3C siguen
intactas e independientes).
