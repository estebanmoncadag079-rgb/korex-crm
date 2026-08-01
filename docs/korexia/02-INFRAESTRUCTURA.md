# Infraestructura y despliegue

> **Dentro:** El servidor · Qué corre ahí · Los dominios · Cómo desplegar un cambio · Seguridad de la red · Vigilancia

## El servidor

Un único VPS con **EasyPanel**: `2.25.159.117`, **3,8 GB de RAM y un solo
núcleo**, con 3 GB de swap añadidos y `swappiness=10`. Disco de 48 GB (usados
11 GB a 31-jul-2026).

Acceso: `ssh -i ~/.ssh/churrabot_key root@2.25.159.117`

Que tenga **un solo núcleo** no es un detalle menor: cualquier proceso que se
descontrole afecta a todo lo demás. Pasó de verdad — ver el caso del bot viejo
de Lis en [07-BITACORA.md](07-BITACORA.md).

## Qué corre ahí

| Servicio | Qué es |
|---|---|
| `korex-crm_crm` | **La aplicación** (servicio de EasyPanel sobre Docker Swarm) |
| `korex-crm-postgres-1` | **La base de datos** (docker compose, en `/opt/korex-crm`) |
| `easypanel-traefik` | El portero: recibe todo el tráfico y reparte por dominio |
| `easypanel` | El panel de administración (puerto 3000) |
| `asistente-ia_ia` | Otro proyecto, no tocar |

⚠️ **La aplicación y la base de datos se gestionan de formas distintas.** La app
es un servicio de EasyPanel; la base sigue en `docker compose`. Es herencia de
la migración del 29-jul-2026 y conviene recordarlo antes de tocar nada.

## Los dominios

| Dominio | A dónde va |
|---|---|
| `korexia.online` | la portada |
| `www.korexia.online` | la portada |
| `crm.korexia.online` | la aplicación y los webhooks |

Los tres apuntan al mismo servicio. **Se configuran en EasyPanel** (proyecto
`korex-crm` → servicio `crm` → Dominios), y EasyPanel los escribe en
`/etc/easypanel/traefik/config/main.yaml`.

> 🔑 **El puerto del dominio es `80`, no `3000`.** La aplicación corre con
> `PORT=80` y escucha en `0.0.0.0:80` dentro del contenedor; el `3000/tcp` que
> muestra `docker ps` es solo el `EXPOSE` del Dockerfile. Si al añadir un
> dominio se pone 3000, da **502**. Todas las filas deben apuntar a
> `http://korex-crm_crm:80/`.

El certificado HTTPS es de Let's Encrypt y cubre los tres dominios (uno solo,
con `crm.korexia.online` como principal y los otros dos como alternativos).

### Si un dominio deja de funcionar

Síntoma típico: una página **404 con un hexágono verde**. Esa página es de
Traefik/EasyPanel, **no de la aplicación**: significa que el dominio llegó al
servidor pero no hay ninguna ruta que lo atienda.

Comprobar qué rutas hay activas:

```bash
docker exec <contenedor-traefik> wget -qO- http://localhost:8080/api/http/routers \
  | python3 -c "import sys,json;[print(r['name'],r.get('rule')) for r in json.load(sys.stdin) if 'korexia' in json.dumps(r)]"
```

**Arreglo de emergencia** (si hay que restaurar el servicio ya): Traefik lee
**todos** los archivos de `/etc/easypanel/traefik/config/` y los recarga solo.
Se puede añadir un `.yaml` propio con la ruta que falte, apuntando a
`http://korex-crm_crm:80/`, sin tocar `main.yaml`. Es un parche: lo correcto
después es añadir el dominio en EasyPanel y borrar el archivo.

## Cómo desplegar un cambio

**El botón de Desplegar lo pulsa el dueño, en EasyPanel.** Así quedó acordado y
así se hace: EasyPanel construye desde su propia carpeta y reinicia el servicio,
sin que nadie tenga que acordarse de etiquetas ni de comandos.

El reparto de trabajo:

| Quién | Qué |
|---|---|
| Asistente | 1. Gate en local · 2. Commit y push · 3. **Dejar el código en la carpeta de EasyPanel** |
| Dueño | 4. **EasyPanel → proyecto `korex-crm` → servicio `crm` → Desplegar** |
| Asistente | 5. Verificar que el cambio está dentro del contenedor |

```bash
# 1. En local: que pase todo
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm vitest run

# 2. Guardar el cambio
git add -A && git commit -m "..." && git push origin main

# 3. Dejar el código donde EasyPanel lo va a buscar
git archive --format=tar.gz -o /tmp/korex-crm.tar.gz HEAD
scp -i ~/.ssh/churrabot_key /tmp/korex-crm.tar.gz root@2.25.159.117:/tmp/
ssh ... 'tar -xzf /tmp/korex-crm.tar.gz -C /etc/easypanel/projects/korex-crm/crm/code'
```

> 🔴 **El paso 3 no es opcional ni cosmético.** Esa carpeta es la ÚNICA fuente
> de la que construye EasyPanel: no clona el repositorio, **no tiene `.git`** y
> no se entera de ningún push. Si se omite, el botón Desplegar reconstruye el
> código viejo y **deshace lo que ya estuviera arriba**.
>
> Pasó el 1-ago-2026: se desplegó a mano por SSH sin sincronizar la carpeta, y
> quedó una bomba de relojería — el siguiente Desplegar habría revertido tres
> funcionalidades. Se detectó a tiempo y se sincronizó (con copia previa en
> `/root/code-respaldo-antes-sync-*`).

Detalles que importan:

- El `Dockerfile` es autocontenido: **no necesita secretos ni argumentos** para
  construir; las claves llegan al arrancar.
- **Coste real**: el reinicio deja a los clientes sin agente unos **30
  segundos**. La construcción tarda 2–4 minutos.

### Si hay que desplegar a mano (EasyPanel caído, urgencia)

```bash
cd /etc/easypanel/projects/korex-crm/crm/code
docker build -t easypanel/korex-crm/crm:latest .   # ⚠️ ESA etiqueta, exacta
docker service update --force korex-crm_crm
```

⚠️ **`easypanel/korex-crm/crm:latest`, no `korex-crm:latest`**, que es lo que
sale natural de escribir. El 1-ago-2026 se construyó tres veces con la etiqueta
corta: cada build terminó bien, cada reinicio dijo `converged` y la web
respondía 200 — mientras se construía una imagen **que no usa nadie**.

```bash
docker service inspect korex-crm_crm --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
```

### Comprobar que se desplegó lo que se editó

**`converged` y un 200 en la web no prueban nada**: los dos salen igual de bien
reiniciando con la imagen vieja. Lo único que prueba algo es buscar el texto
nuevo **dentro del contenedor que está corriendo**:

```bash
docker exec <contenedor-app> sh -c "grep -rl 'un trozo del texto nuevo' /app/.next | head -3"
```

⚠️ Buscar un fragmento **sin acentos ni emojis**: el `grep` dentro del
contenedor falla con caracteres especiales y da un falso negativo.

Y comprobar que el arranque no tocó datos: contar `kb_entry`, `contact` y
`pipeline_stage` por organización antes y después.

## Seguridad de la red

- **Puertos abiertos a propósito**: 22 (SSH), 80 y 443 (Traefik) y 3000
  (EasyPanel, con el que se administra el servidor).
- **Puertos 2377 / 7946 / 4789** (administración de Docker Swarm): bloqueados
  con iptables, y se mantienen bloqueados tras reiniciar gracias al servicio
  `korex-firewall.service`.
- **La aplicación no publica ningún puerto** desde que corre en EasyPanel: solo
  se llega a ella a través de Traefik, con HTTPS.
- La base de datos publica el 5433 **solo en la red interna de Docker**
  (`172.16.1.1`), no en la IP pública.

> **Aprendizaje que costó tiempo**: una regla de iptables sobre `--dport 3987`
> no funcionaba ni en `DOCKER-USER` ni en `INPUT`, porque Docker reescribe el
> puerto de destino antes de que la regla se evalúe. La solución correcta fue
> **no publicar el puerto**, no filtrarlo.

## Vigilancia

`/root/monitor-bots-alerta.sh`, en cron **cada 15 minutos**, avisa por Telegram
si algo se cae. Vigila `korex-crm_crm`, la base de datos y `asistente-ia`,
comprobando además el *healthcheck* de Docker (no solo que el contenedor
exista). Manda un resumen diario y no repite la misma alerta más de una vez por
hora.

⚠️ **Al renombrar o jubilar un servicio, hay que actualizarlo aquí.** El 30-jul
mandó **19 falsas alarmas** en un día porque seguía buscando el contenedor
viejo `korex-crm-app-1` después de migrar a EasyPanel. La lista de bots vive en
la variable `BOTS` (hoy vacía) y los servicios en el bucle `for SVC in`.
