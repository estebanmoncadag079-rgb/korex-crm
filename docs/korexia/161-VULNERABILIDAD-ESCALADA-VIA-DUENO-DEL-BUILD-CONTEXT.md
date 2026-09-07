# 161 — Fase 3B: escalada real cerrada, y una segunda brecha documentada

7-sep-2026. Continuación de [160](160-IDENTIDAD-DE-DEPLOY-MINIMO-PRIVILEGIO.md).
La Fase 3A creó un usuario `deploy` sin acceso a Docker; esta fase (3B)
auditó si ese diseño podía convertirse en ejecución arbitraria como root de
todos modos — **y encontró que sí**, por un camino que la Fase 3A no
consideró: la propiedad de la carpeta, no el acceso al socket de Docker.

## 1. El hallazgo (A) — confirmado con evidencia, cerrado en esta fase

### La cadena exacta

```
deploy es dueño de  /etc/easypanel/projects/korex-crm/crm/code   (Fase 3A, chown -R deploy:deploy)
deploy es dueño del  Dockerfile  dentro de esa carpeta            (heredado del chown -R)
el wrapper (root, vía sudo) hace:  cd <esa carpeta> && docker build .
```

`docker build .` no es "construir un artefacto conocido": es **ejecutar
como root todo lo que declare el `Dockerfile` que esté ahí en ese momento**
(`RUN pnpm install`, `RUN pnpm build`, y cualquier `RUN` que alguien
agregue). Como `deploy` era dueño de esa carpeta, podía escribir cualquier
`Dockerfile` —o modificar cualquier archivo fuente, ya que `pnpm install`/
`pnpm build` ejecutan lo que diga `package.json`— y esperar a que la
**siguiente** invocación legítima del wrapper lo construyera con privilegio
de root.

Esto significa: **la Fase 3A eliminó el acceso directo al socket de Docker,
pero dejó una vía equivalente**: quien controla el contenido que se
construye, controla lo que el root que lo construye ejecuta. El wrapper de
la Fase 3A era, en la práctica, "root ejecuta lo que `deploy` haya dejado
escrito", que es la definición misma de una escalada de privilegios.

### Verificación (sin explotarla)

```
$ ls -ld /etc/easypanel/projects/korex-crm/crm/code
drwxr-xr-x 12 deploy deploy ...

$ ls -l .../code/Dockerfile
-rw-rw-r-- 1 deploy deploy ...

$ ssh deploy@... "test -w .../code/Dockerfile && echo CONFIRMADO"
CONFIRMADO: deploy tiene permiso de escritura sobre el Dockerfile real de despliegue
```

No se escribió contenido malicioso real para demostrarlo — el clasificador
de seguridad de la propia sesión bloqueó ese intento (correctamente, por
tocar el archivo real de despliegue), y la evidencia de permisos ya es
concluyente sin necesidad de ejecutar nada.

### Por qué la Fase 3A no lo vio

La Fase 3A auditó "¿puede `deploy` hablar con Docker directamente?" (no) y
"¿puede escalar por sudo a otro comando?" (no). No auditó "¿qué construye
exactamente el ÚNICO comando que sí puede pedir, y quién controla su
contenido?" — que es precisamente lo que esta fase pidió verificar.

## 2. La corrección aplicada

**Principio**: la carpeta que se construye debe ser propiedad exclusiva de
root, reconstruida DESDE CERO por el propio wrapper en cada invocación —
nunca una carpeta persistente que `deploy` pueda tocar entre una invocación
y la siguiente.

### Cambios en el servidor

```bash
# el wrapper YA NO confía en una carpeta preexistente:
rm -rf "$REMOTE_CODE_DIR"
mkdir -p "$REMOTE_CODE_DIR"; chown root:root "$REMOTE_CODE_DIR"; chmod 755 "$REMOTE_CODE_DIR"
tar -xzf "$TARBALL" -C "$REMOTE_CODE_DIR"
chown -R root:root "$REMOTE_CODE_DIR"     # ninguna parte del árbol extraído queda con otro dueño
echo "$COMMIT_FULL" > "$REMOTE_CODE_DIR/.deployed-commit"
rm -f "$TARBALL"
# recién AHORA se construye:
docker build ...
```

```bash
chown -R root:root /etc/easypanel/projects/korex-crm/crm/code   # deploy pierde la propiedad
```

`deploy` sigue subiendo el tarball a `/tmp` (sin cambios — `/tmp` siempre
fue territorio no confiable por diseño, sticky/1777, eso nunca fue el
problema). Lo que cambió es que **ya nadie más que root vuelve a tocar la
carpeta de construcción**: la extracción, antes un paso de `deploy` sin
sudo (pasos 3-4 de `deploy.sh`), ahora vive DENTRO del wrapper root.

### Cambio en `scripts/deploy.sh`

Los pasos 3 y 4 se reescribieron: el paso 3 solo sube el tarball (ya no lo
extrae); el paso 4 desaparece como acción propia (ahora lo hace el wrapper).
Sin cambio en el comportamiento observable del deploy — mismo resultado
final, misma verificación de SHA al terminar — solo cambia QUIÉN escribe
los archivos y CUÁNDO.

## 3. Prueba de la corrección

| Prueba | Antes (Fase 3A) | Después (Fase 3B) |
|---|---|---|
| `deploy` puede escribir el `Dockerfile` real | **Sí** (vulnerable) | `Permission denied` |
| `deploy` puede crear cualquier archivo en la carpeta | **Sí** | `Permission denied` |
| `deploy.sh --dry-run` (flujo completo) | 8 pasos correctos | 8 pasos correctos, con el 3/4 renombrados |
| Subida real del tarball a `/tmp` (sin invocar el wrapper) | — | Confirmada — llega, sin tocar Docker |
| Producción durante toda la auditoría | — | Sin interrupción: mismo *uptime* al final que al principio |

No se invocó el wrapper de verdad en esta fase (habría sido un deploy real,
expresamente prohibido) — la corrección se verificó por inspección de
permisos y por lectura del propio script, no por ejecución.

## 4. Auditoría de superficies adicionales (todas descartadas, con evidencia)

| Vector | Resultado |
|---|---|
| Symlinks dentro de la carpeta de código | Ninguno |
| `deploy` reemplaza la carpeta por un symlink | Imposible — el directorio PADRE es `root:root`, `deploy` no tiene permiso de escritura ahí |
| Inyección de `PATH` hacia el wrapper | Bloqueada — `sudoers` fija `secure_path` y usa `env_reset`; el entorno de `deploy` nunca llega al wrapper |
| `eval`/`source`/`xargs` en el wrapper | Ninguno |
| El propio wrapper (permisos) | `700 root:root` — correcto, sin cambios necesarios |

## 5. El hallazgo (B) — NO cerrado en esta fase, requiere tu decisión

El wrapper valida que el SHA tenga **formato** correcto (40 hex), pero
**nunca verifica que sea un commit real de `main`**. Esa verificación hoy
solo existe en `deploy.sh`, que corre en la máquina/runner que *invoca* el
deploy — no en el servidor.

**Consecuencia**: quien tenga la llave SSH de `deploy` (sin necesitar
ningún otro acceso) puede subir CUALQUIER tarball a `/tmp` con el nombre
correcto y pedirle al wrapper que lo construya y lo despliegue —
saltándose por completo el chequeo de "ancestro de `origin/main`", los
tests, el `typecheck`, el `lint` y el `build` del CI. El wrapper de la Fase
3B ya no permite ESCALAR más allá de Korex, pero sigue confiando
ciegamente en que el contenido que le llega es legítimo.

**Esto es un problema distinto** al hallazgo A: A era "¿puede alguien
ejecutar más de lo previsto?" (sí, cerrado). B es "¿puede alguien ejecutar
EXACTAMENTE lo previsto (construir y desplegar Korex) mostrando un código
que nunca pasó por el CI?" (sí, sigue abierto).

### Por qué no se corrigió en esta fase

Cerrarlo de raíz requiere que el **servidor** tenga su propia fuente de
verdad para verificar que un SHA es real y viene de `main` — lo más simple
y estándar es una copia del repositorio en el servidor (un clon `--bare`,
actualizado por `root`), usando una **Deploy Key de solo lectura** de
GitHub (una credencial NUEVA, distinta de todo lo usado hasta ahora,
atada a un solo repositorio, sin permiso de escritura).

Eso es una decisión de infraestructura nueva, no una corrección dentro del
alcance ya autorizado de "la frontera de privilegios del wrapper" — por
eso se documenta en vez de implementarse sin preguntar.

### Opciones, si decides cerrarlo

1. **Deploy Key de solo lectura** (recomendada): el wrapper mantiene un
   clon `--bare` del repo, hace `git fetch` y verifica `merge-base
   --is-ancestor` él mismo antes de construir — la MISMA verificación que
   `deploy.sh` ya hace, pero re-hecha por una fuente que `deploy` no
   controla.
2. **Firmar el tarball**: `deploy.sh` firma el tarball (GPG/HMAC con una
   clave que el servidor conoce) antes de subirlo; el wrapper verifica la
   firma antes de extraer. Evita el clon del repo, pero añade gestión de
   claves de firma.
3. **Aceptar el riesgo residual, documentado**: si la llave de `deploy`
   solo va a vivir en el secret de GitHub Actions (nunca en un equipo
   personal), el riesgo real es "GitHub Actions comprometido" — un
   escenario ya cubierto por las propias protecciones de GitHub. Válido
   como decisión consciente, no como omisión.

## 6. Alcance respetado

- **Cero secrets creados.**
- **Cero deploys de aplicación** — producción mantuvo el mismo *uptime*
  desde el inicio hasta el final de esta fase.
- **Cero cambios en lógica de producto.**
- El único intento de escritura real contra el `Dockerfile` de producción
  fue bloqueado por el clasificador de seguridad de la sesión, y no se
  intentó de nuevo por otra vía — se usó `test -w` en su lugar.

## 7. Rollback

- Wrapper: `scp` de vuelta la versión anterior (queda en el respaldo de la
  Fase 3A) o simplemente `git revert` del commit de esta fase para
  `scripts/deploy.sh`, y reinstalar el wrapper anterior manualmente.
- Propiedad de la carpeta: `chown -R deploy:deploy .../code` deshace el
  endurecimiento (no recomendado — reabre el hallazgo A).
