# 159 — Fundación SDD: ejecución de las fases 1 a 3

7-sep-2026. **Registro de ejecución**, no una propuesta. Cada afirmación de
este documento tiene evidencia reproducible al lado. La auditoría que dio
origen a este plan es el doc [157](157-AUDITORIA-DEL-PLAN-SDD.md).

## Alcance respetado

- **Cero cambios en lógica de producto**: no se tocó pedidos, confirmación,
  citas, pagos, catálogo, campañas, handoff ni WhatsApp.
- **Cero despliegues de la aplicación.** El CI se ejecutó de forma
  deliberadamente segura (ver Fase 3): el job de deploy se detuvo en su
  propia barrera sin tocar el servidor.
- **Cero secretos creados o expuestos.**
- Los incidentes abiertos (turno de ~20 h, domicilio en modo `prompt`)
  quedan **fuera de alcance**, como se pidió.

---

## FASE 1 — Identidad del repositorio ✅ COMPLETADA

### Evidencia del problema

```
$ git remote -v
origin    https://github.com/estebanmoncadag079-rgb/korex-crm.git
upstream  https://github.com/kevinrivm/vocero-crm.git

$ gh repo view --json nameWithOwner
kevinrivm/vocero-crm        ← la CLI operaba sobre el proyecto EQUIVOCADO
```

Riesgo real y confirmado: al consultar PRs o CI con `gh`, la respuesta venía
del repositorio padre (Vocero), con ramas, features (`fix(003)`, `fix(015)`,
integraciones con Google) e historial que **no existen en Korex** — y que
además contradicen la constitución vigente aquí. Durante la auditoría del doc
157 este historial ajeno estuvo a punto de tomarse como propio.

### Corrección aplicada

```
$ gh repo set-default estebanmoncadag079-rgb/korex-crm
$ gh repo view --json nameWithOwner
estebanmoncadag079-rgb/korex-crm     ← verificado
```

Escribe `remote.origin.gh-resolved` en `.git/config` (configuración local del
repositorio; no toca código ni el remoto).

### Otras referencias auditadas

| Referencia | Archivo | Veredicto |
|---|---|---|
| `"name": "vocero-crm"` | `package.json` | **Cosmética**: nombre de paquete npm heredado. No dirige ninguna operación |
| `kevinrivm/agentic-microservice-deployer` | `skills-lock.json` | **No aplica**: es otro repositorio (una skill), no el upstream |
| Menciones a Vocero | `docs/korexia/01, 25, 26, 28, 157` | **Informativas**, correctas en su contexto histórico |

**Conclusión: la única referencia operativa peligrosa era `gh`, y está
corregida y verificada.**

### Recomendación pendiente (decisión del dueño)

El remote `upstream` sigue configurado. El doc
[25](25-UPSTREAM-VOCERO.md) ya descartó el merge con Vocero. Eliminarlo
(`git remote remove upstream`) cerraría el riesgo de raíz, pero también la
posibilidad de consultar el proyecto padre. **No se hizo**: es una decisión
del dueño, no una corrección técnica obligada.

---

## FASE 2 — Auditoría del CI/CD existente ✅ COMPLETADA

Las 16 preguntas obligatorias, respondidas con evidencia:

| # | Pregunta | Respuesta verificada |
|---|---|---|
| 1 | ¿El workflow está activo? | **Sí.** `gh workflow list` → `Deploy a produccion  active  349803648` |
| 2 | ¿Qué lo dispara? | **Solo `workflow_dispatch`** (manual). Nunca push ni pull_request — por diseño explícito |
| 3 | ¿Qué jobs ejecuta? | `build-test` y `deploy` (con `needs: build-test`) |
| 4 | ¿Qué gates ejecuta? | `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `build`. **Los gates de arquitectura no son un paso aparte: viven dentro de `pnpm test`** |
| 5 | ¿Qué secrets requiere? | Exactamente **dos**: `DEPLOY_SSH_KEY` y `DEPLOY_SSH_HOST` |
| 6 | ¿Qué secrets existen? | **NINGUNO.** `gh secret list` devuelve vacío ← *la razón por la que nunca corrió* |
| 7 | ¿Permisos del acceso remoto? | Acceso **root** total al servidor |
| 8 | ¿Se usa root? | **Sí.** `whoami` → `root`. Es el único usuario con shell (`/etc/passwd`) |
| 9 | ¿Existe un usuario deploy? | **No.** `id deploy` → *no such user*. El grupo `docker` está **vacío** |
| 10 | ¿Se puede saltar el CI? | **Sí.** Cualquiera con la llave SSH despliega a mano; ocurrió 4 veces esta semana |
| 11 | ¿Hay deploy manual? | Sí, documentado en [02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md) |
| 12 | ¿Hay protección de producción? | Environment `production` **existe**. Sin *required reviewers* (no disponible en GitHub Free para repos privados). Las barreras reales son las 3 del propio workflow |
| 13 | ¿Hay rollback? | Sí, **de código**: volver a correr el script con un commit anterior. **Nunca de base de datos** — explícitamente manual, revisando el bloque `-- Rollback:` de cada migración |
| 14 | ¿Cómo comprueba el SHA final? | `scripts/deploy.sh` paso 8: compara el `commit` que devuelve `/api/health` contra el solicitado, y **falla si difieren** |
| 15 | ¿Cómo comprueba el health? | Sondea `https://crm.korexia.online/api/health` hasta 300 s esperando `"ok":true`; además aborta si `campaignWorkerEnabled:true` sin `--allow-worker-enabled` |
| 16 | ¿Limitaciones del plan de GitHub? | **Protección de rama imposible**: `gh api .../branches/main/protection` → `403 Upgrade to GitHub Pro`. Sin ella, el CI **no puede ser obligatorio** |

### Calidad del diseño existente

El workflow y `scripts/deploy.sh` son **notablemente sólidos** y no necesitan
rediseño:

- valida que `commit_sha` sea hexadecimal de 7–40 (nunca una rama o `HEAD`);
- exige que sea **ancestro real de `origin/main`**;
- exige escribir literalmente `CONFIRMAR`, **verificado dentro del job**, no
  solo en el formulario;
- **ningún `${{ inputs.* }}` ni `${{ secrets.* }}` se interpola dentro de un
  `run:`** — todo pasa por `env:` para evitar inyección de comandos;
- borra la llave SSH del runner con `if: always()`;
- verifica el SHA desplegado contra el esperado, con el argumento correcto
  escrito en el propio código: *"'healthy' no es evidencia suficiente"*.

**No hay nada que corregir en el workflow.** Lo único que falta es
configuración.

---

## FASE 3 — Ejecución real del CI ✅ PRIMER RUN DE LA HISTORIA

### Cómo se probó sin desplegar

Se lanzó el workflow con la confirmación **deliberadamente inválida**:

```
commit_sha = 85ac98a91bc9589710f13247bbfd67cf954ada53   (HEAD de main)
confirm    = NO-DESPLEGAR-SOLO-PROBAR-GATES
```

Así el job `build-test` corre completo y el job `deploy` se detiene en su
primera barrera, **antes** de hacer checkout, antes de escribir la llave SSH
y antes de tocar el servidor.

### Resultado (run `34161971856`)

```
✓ Gate local (typecheck, lint, tests, build)            4m33s
X Deploy → "Debes escribir exactamente CONFIRMAR…"         4s
    ✓ Set up job
    X Verificar la barrera de confirmacion (server-side)
    - Checkout                          ← nunca se ejecutó
    - Configurar la llave SSH           ← nunca se ejecutó
    - Ejecutar scripts/deploy.sh        ← nunca se ejecutó
```

**Dos cosas quedaron demostradas, no supuestas:**

1. **El CI funciona.** Nunca estuvo roto: nunca se había ejecutado.
2. **La barrera de confirmación funciona del lado del servidor.**

### Los invariantes corren de verdad en CI

Extraído del log del run real, no de la máquina local:

```
✓ tests/unit/arquitectura-aprobada.test.ts             (5 tests)
✓ tests/unit/vertical-fuente-unica.test.ts             (6 tests)
✓ tests/unit/tenant.test.ts                            (3 tests)
✓ tests/unit/session-tenant.test.ts                    (6 tests)
✓ tests/unit/esquema-json-de-accion.test.ts            (3 tests)
✓ tests/unit/provision-organization-arquitectura.test.ts (3 tests)
✓ tests/unit/propiedad-de-la-ficha.test.ts             (8 tests)

Test Files  189 passed | 14 skipped (203)
Tests      1888 passed | 124 skipped (2012)
```

---

## Mapa de protección real

| Invariante | Test | ¿Corre en CI? | ¿Bloquea el deploy? | Estado |
|---|---|---|---|---|
| Arquitectura del alta de un cliente | `arquitectura-aprobada` | **Sí (verificado)** | Sí (`deploy` needs `build-test`) | 🟢 |
| Fuente única del vertical | `vertical-fuente-unica` | **Sí** | Sí | 🟢 |
| Aislamiento multi-tenant | `tenant`, `session-tenant` | **Sí** | Sí | 🟢 |
| Deriva del contrato de acciones | `esquema-json-de-accion` | **Sí** | Sí | 🟢 |
| Arquitectura en el provisioning | `provision-organization-arquitectura` | **Sí** | Sí | 🟢 |
| Un dueño por dato | `propiedad-de-la-ficha` | **Sí** | Sí | 🟢 |
| **Que el CI sea el ÚNICO camino** | — | — | **No** | 🔴 falta protección de rama (GitHub Pro) |
| **Que el deploy oficial sea usable** | — | — | **No** | 🔴 faltan 2 secrets |

La cadena `INVARIANTE → TEST → CI → DEPLOY` está **completa y demostrada
salvo su último eslabón**.

---

## Lo que falta, y por qué NO se hizo

Todo lo pendiente requiere una decisión del dueño sobre credenciales,
infraestructura o gasto. Ninguna se tomó por iniciativa propia.

### 1. Los dos secrets (bloquea el deploy oficial)

```
DEPLOY_SSH_HOST   → p. ej.  deploy@2.25.159.117
DEPLOY_SSH_KEY    → contenido de una llave PRIVADA con acceso al servidor
```

**No se cargaron.** Cargar hoy la llave existente significaría dar a GitHub
Actions **acceso root total** al servidor, y las reglas de esta ejecución
prohíben expresamente *"usar root si no es estrictamente necesario"*.

### 2. Usuario `deploy` con permisos mínimos (recomendado antes del punto 1)

Hoy solo existe `root`. Lo mínimo que el deploy necesita: escribir en
`/etc/easypanel/projects/korex-crm/crm/code` y hablar con Docker.

```bash
# EN EL SERVIDOR — pendiente de tu autorización, NO ejecutado
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
chown -R deploy:deploy /etc/easypanel/projects/korex-crm/crm/code
# llave NUEVA y dedicada (nunca la de root, nunca una personal):
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/korex_deploy
# la pública va a /home/deploy/.ssh/authorized_keys
# la privada va a GitHub → Settings → Secrets → DEPLOY_SSH_KEY
```

⚠️ Pertenecer al grupo `docker` equivale a root en la práctica. Reduce la
superficie (sin shell de root, sin acceso al resto del sistema), pero no la
elimina. Es el estándar habitual y una mejora clara sobre root directo.

### 3. Protección de rama (bloquea "el CI es obligatorio")

Requiere **GitHub Pro** (~4 USD/mes) o hacer público el repositorio. Sin
ella, el CI existe pero **es voluntario**: cualquiera puede seguir
desplegando a mano. Es la diferencia entre *tener* control y *ejercerlo*.

---

## Hallazgos nuevos, documentados y NO implementados

1. **Node.js 20 deprecado en las actions.** `actions/checkout@v4`,
   `actions/setup-node@v4` y `pnpm/action-setup@v4` se fuerzan a Node 24.
   Hoy no bloquea; conviene subir de versión antes de que sí lo haga.
2. **El `build-test` tarda 4m33s.** Aceptable para un disparo manual;
   habría que vigilarlo si algún día se dispara en cada push.
3. `package.json` sigue llamándose `vocero-crm`. Cosmético; cambiarlo tocaría
   un archivo con trabajo pendiente sin commitear.

---

## Estado de las fases

| Fase | Estado |
|---|---|
| 1 — Identidad del repositorio | ✅ **Completada y verificada** |
| 2 — Auditoría del CI/CD | ✅ **Completada**, 16/16 preguntas con evidencia |
| 3 — Camino CI oficial | 🟡 **Gates ejecutándose y verificados**; el deploy queda bloqueado por 2 secrets y una decisión de acceso |
| 4+ (invariantes, autoridad documental, carriles) | ⏸️ No iniciadas |

**Próximo paso, y es tuyo**: decidir sobre el usuario `deploy` y los secrets.
Sin eso, la Fase 3 no puede cerrarse y el deploy oficial sigue sin poder
usarse.
