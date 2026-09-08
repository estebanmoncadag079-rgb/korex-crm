# 165 — Fase 3H: la corrección del espejo congelado ya viaja con el código, no con el servidor

7-sep-2026. Cierra el riesgo residual dejado abierto explícitamente en
[164](164-PREFLIGHT-Y-BUG-DEL-ESPEJO-CONGELADO.md) §5: el arreglo del bug del
espejo congelado (Fase 3G) vivía solo en la **configuración** de un servidor
concreto (`git config remote.origin.fetch` en `/opt/korex-repo-mirror.git`),
no en ningún archivo versionado. Si el espejo se reconstruye, el servidor se
reinstala, o se provisiona uno nuevo, el bug reaparece silenciosamente y
vuelve a bloquear todo deploy futuro — nadie que no conociera el doc 164 lo
sabría corregir.

## 1. El principio exigido para esta fase

> El comportamiento correcto debe quedar garantizado por código/configuración
> **versionada**. No depender de una configuración manual del servidor que
> pueda perderse si: se reconstruye el espejo; se reinstala el servidor; se
> crea un nuevo entorno; se vuelve a provisionar el deploy.

Es decir: la propiedad "el espejo se actualiza contra GitHub sin importar su
estado previo" tiene que sobrevivir aunque `/opt/korex-repo-mirror.git` se
borre y se vuelva a clonar desde cero mañana, sin que nadie recuerde ejecutar
ningún comando manual.

## 2. La corrección — un refspec explícito en la línea de comando, no en `git config`

`scripts/wrapper-deploy-servidor.sh` (nuevo, versionado) es ahora la fuente de
verdad del wrapper que corre en `/usr/local/bin/korex-deploy.sh`. Difiere de
la v3 (Fase 3C) en exactamente una línea funcional:

```diff
- git --git-dir="$GIT_MIRROR" fetch origin main --quiet
+ git --git-dir="$GIT_MIRROR" fetch origin '+refs/heads/main:refs/heads/main' --quiet
```

`git fetch origin main` depende de que exista una entrada `remote.origin.fetch`
en la configuración del repositorio para saber a qué ref local mapear lo
descargado — y `git clone --bare` nunca crea esa entrada (causa raíz ya
documentada en el 164). Con el refspec **explícito en la propia línea de
comando**, ese mapeo no depende de ninguna configuración previa: el `fetch`
actualiza `refs/heads/main` del espejo siempre, exista o no `remote.origin.fetch`
en el `config`. La corrección queda dentro del archivo que se instala, no en
un estado que solo existe en la memoria de un servidor.

## 3. Instalado y probado contra el escenario exacto que preocupaba

Paso a paso, en el servidor real:

1. Se extrajo el wrapper que corría de verdad (`/usr/local/bin/korex-deploy.sh`)
   y se confirmó, byte a byte salvo comentarios, que era la v3 de la Fase 3C.
2. Se instaló `scripts/wrapper-deploy-servidor.sh` reemplazándolo
   (`install -o root -g root -m 700`), y se verificó sintaxis (`bash -n`) antes
   y después de la instalación.
3. **Se deshizo deliberadamente el parche manual de la Fase 3G**:
   ```
   git --git-dir=/opt/korex-repo-mirror.git config --unset remote.origin.fetch
   ```
   Confirmado sin ninguna línea `remote.origin.fetch` en el `config` — exactamente
   el estado de un espejo recién clonado desde cero, sin el arreglo manual.
4. Se forzó el `main` del espejo hacia atrás para simular un espejo desactualizado/
   recién reconstruido:
   ```
   git --git-dir=/opt/korex-repo-mirror.git update-ref refs/heads/main 85ac98a91b...
   ```
   Confirmado con `rev-parse main` → `85ac98a91b...` (el commit viejo, no el real de `main`).
5. Se ejecutó el `fetch` **exacto** que ahora usa el wrapper (con la Deploy Key
   de solo lectura, igual que en producción):
   ```
   GIT_SSH_COMMAND="ssh -i /root/.ssh/korex_mirror_key -o IdentitiesOnly=yes" \
     git --git-dir=/opt/korex-repo-mirror.git fetch origin \
     "+refs/heads/main:refs/heads/main" --quiet
   ```
6. Resultado:
   ```
   === main del espejo DESPUES del fetch ===
   f3a6417d6bdc0f9b1ac6ba20db0ddfb027a89312
   ```
   Correcto — el `main` real de GitHub, recuperado **sin que existiera ninguna
   configuración persistente** que lo permitiera. La corrección vino solo del
   comando, no del estado del servidor.
7. Cadena completa reverificada tras el fetch:
   ```
   cat-file -e f3a6417...^{commit}                  → existe: sí
   merge-base --is-ancestor f3a6417... main          → CORRECTO: aceptado, sin config manual
   ```

Esto reproduce con fidelidad el escenario que preocupaba: un espejo nuevo (o
reconstruido) sin ningún ajuste manual previo, y el wrapper se corrige solo en
la primera invocación.

## 4. Nota de método: un intento descartado antes de llegar a esta prueba

Se intentó primero probar con un commit real nuevo: crear una rama
`prueba-3h-fetch` con un commit vacío y empujarla a GitHub. Se abandonó de
inmediato al notar que esa rama **no avanza `origin/main`** — no probaba la
propiedad que importaba (que el fetch actualice `main`), solo que existiera un
commit alcanzable por otro nombre de rama. La rama se borró de GitHub
(`git push origin --delete prueba-3h-fetch`) antes de continuar, y se optó por
la prueba de la sección 3 (`update-ref` sobre el espejo), que sí aísla
exactamente la variable relevante sin publicar nada innecesario en GitHub.

## 5. Qué NO se tocó

- El wrapper sigue verificando existencia + ancestro contra `main` exactamente
  igual que en la Fase 3C — cero cambios de lógica de seguridad, solo de cómo
  se refresca el espejo.
- `scripts/deploy.sh` (lado cliente/CI): sin cambios en esta fase.
- El parche manual de la Fase 3G (`git config remote.origin.fetch`) se dejó
  **deliberadamente sin restaurar** en el servidor al cerrar esta fase — ver
  §6, es una decisión explícita, no un olvido.
- Ningún deploy de aplicación, ningún `docker service update`, ninguna
  modificación de datos de producción o de secrets.

## 6. Decisión: no restaurar el `git config` manual como "defensa en profundidad"

Con el refspec explícito ya en el propio comando del wrapper, la entrada
`remote.origin.fetch` en el `config` del espejo pasó a ser **redundante**: el
wrapper nunca vuelve a depender de ella, la tenga el espejo o no. Restaurarla
no añade ninguna protección real y sí añade una segunda fuente de verdad
(servidor + código) que podría divergir del comentario del propio wrapper, que
ahora documenta la historia completa de por qué existe cada pieza. Se deja
sin restaurar a propósito — la única fuente de verdad es
`scripts/wrapper-deploy-servidor.sh`.

## 7. Estado de producción al cierre

```
docker ps --filter name=korex-crm_crm --format "{{.Status}}"
Up 2 hours (healthy)

cat-file -e f3a6417...^{commit}          → existe: sí
merge-base --is-ancestor f3a6417... main → CORRECTO: aceptado, sin config manual
```

Sin interrupciones. Ningún deploy real ha ocurrido en ninguna fase de esta
serie (3A-3H) — todas las verificaciones se hicieron por SSH directo o con el
workflow disparado con una confirmación deliberadamente inválida.

## 8. Alcance respetado

- **Cero deploys de aplicación**, cero `docker service update` de esta fase.
- **Cero cambios de secrets ni de datos de producción.**
- El único cambio de código es un archivo nuevo (`scripts/wrapper-deploy-servidor.sh`)
  que documenta y versiona lo que antes solo existía como un binario instalado
  a mano en el servidor — no se tocó ninguna lógica de negocio ni arquitectura
  de Korex.
- Efecto colateral limpio: la rama de prueba creada y descartada
  (`prueba-3h-fetch`) ya no existe ni local ni remotamente.

## 9. Rollback

```bash
# En el servidor: volver a la v3 (Fase 3C), sin refspec explícito
ssh root@<servidor> 'git --git-dir=/opt/korex-repo-mirror.git config \
  remote.origin.fetch "+refs/heads/main:refs/heads/main"'
# y reinstalar la versión anterior del wrapper si hiciera falta —
# aunque no hay razón funcional para revertir: el comportamiento es idéntico,
# solo cambia DÓNDE vive la garantía (código vs. configuración de servidor).
```

## 10. Pendiente

Ninguno técnico para esta fase. Queda, como en todas las anteriores, la
decisión del dueño de cuándo autorizar el primer deploy real
(`workflow_dispatch` con `confirm=CONFIRMAR`).
