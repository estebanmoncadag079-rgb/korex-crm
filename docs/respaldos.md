# Respaldos — cómo no perder el negocio de tus clientes

Toda la operación de cada cliente vive en **una sola base de datos**: sus
conversaciones, sus contactos, sus pedidos, su embudo, el conocimiento que le
enseñaste al agente y las credenciales de su número de WhatsApp. Si ese servidor
se muere y no hay copia, no hay a dónde volver. No es un contratiempo: es el fin
de la relación con ese cliente.

Esta guía es para operar, no para programar. Los pasos se copian y se pegan.

---

## Las dos cosas que hay que guardar

Mucha gente respalda la base de datos y cree que ya está. **No alcanza.**

| Qué | Dónde vive | Si se pierde… |
|---|---|---|
| **La base de datos** | Servicio Postgres en Coolify | Se pierden conversaciones, contactos, pedidos y conocimiento. |
| **Los secretos** (variables de entorno) | Coolify → Environment Variables | Aunque tengas la base, **no se puede leer**. |

El segundo punto es el que sorprende. Los tokens de WhatsApp se guardan cifrados
dentro de la base (así lo exige la constitución del proyecto), y la llave para
descifrarlos es la variable `ENCRYPTION_KEY`, que **no está dentro de la base**.

Traducido: si guardas la base pero pierdes `ENCRYPTION_KEY`, recuperas las
conversaciones pero **cada cliente tiene que volver a conectar su número de
WhatsApp desde cero**. Con lo que cuesta ese trámite en Meta, es casi tan grave
como perderlo todo.

### Guarda los secretos hoy mismo

En Coolify → tu aplicación → **Environment Variables**, copia el valor de:

- `ENCRYPTION_KEY` ← **el más crítico**
- `BETTER_AUTH_SECRET`
- `DATABASE_URL` (lleva la contraseña de la base)
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`
- `OPENROUTER_API_TOKEN`

Guárdalos en un **gestor de contraseñas** (Bitwarden, 1Password, el llavero de
tu navegador). No en un archivo `.txt` en el escritorio, ni en un chat de
WhatsApp contigo mismo, ni en este repositorio — `.env` está ignorado por git a
propósito y debe seguir así.

---

## Nivel 1 — Que Coolify saque copias solo

Tu Postgres es un servicio gestionado por Coolify, así que esto son unos clics,
sin scripts:

1. Entra a Coolify → tu proyecto → el recurso **PostgreSQL**.
2. Pestaña **Backups**.
3. Activa el respaldo automático. Recomendado: **diario, de madrugada**,
   reteniendo **14 días**.
4. Si Coolify te pide un destino S3, lee la sección "Nivel 2" antes de decidir.

Con esto quedas cubierto ante el error humano: alguien borró un cliente sin
querer, una migración salió mal, se corrompió una tabla.

**Lo que NO cubre:** que el servidor entero desaparezca. Si las copias viven en
el mismo disco que la base, se van con ella.

---

## Nivel 2 — Sacar una copia fuera del servidor

Este es el que protege del desastre de verdad: si el VPS entero desaparece, las
copias que vivían en su disco se van con él.

**Ruta actual: el computador va a buscar las copias.** Sin tarjeta de crédito no
hay almacenamiento en la nube que valga (ver más abajo), así que se hace al
revés: un guion en Windows se conecta al servidor cada día y se trae los
respaldos a una carpeta del Escritorio. Ver **"Traer las copias a tu PC"**.

La dirección importa. El servidor no puede *enviarle* archivos a un computador
doméstico: no tiene dirección fija en internet y se apaga por las noches. Por
eso es el PC quien pregunta, y no al contrario.

### Si algún día tienes tarjeta: Cloudflare R2

Es la opción más robusta, y queda documentada para cuando se pueda: 10 GB gratis
permanentes, sin pausas por inactividad, habla el protocolo S3 (Coolify escribe
ahí directo) y no cobra por descargar. Exige registrar una tarjeta aunque no se
cobre nada, y por eso hoy no es viable.

> **Por qué no Supabase**, aunque ya tengamos cuenta: el plan gratuito
> [pausa los proyectos tras una semana de inactividad](https://supabase.com/docs/guides/platform/free-project-pausing),
> y un depósito de respaldos es justamente lo que menos actividad tiene. El día
> del desastre te encontrarías el proyecto dormido. Usar el proyecto de la web
> (que sí tiene tráfico) evitaría la pausa, pero ataría los respaldos del CRM a
> la landing: el día que se migre o se limpie ese proyecto, se llevaría las
> copias por delante sin avisar.

Sobre la constitución: prohíbe depender de servicios externos
([CLAUDE.md](../CLAUDE.md) → Soberanía). Un destino de respaldos **no es** una
dependencia de runtime — si R2 se cae, Vocero sigue atendiendo clientes con
normalidad — así que no rompe la regla.

#### Pasos de R2 (para el día que haya tarjeta)

<details>
<summary>Desplegar</summary>

##### Parte A — Cloudflare R2 (unos 5 minutos)

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **R2**.
2. **Create bucket**. Nombre: `korex-respaldos`.
3. **Ubicación: elige Norteamérica (ENAM), no Europa.** Dos razones: estás en
   Colombia, y Coolify tiene un
   [fallo conocido](https://github.com/coollabsio/coolify/issues/9305) que
   recorta el `.eu.` del endpoint europeo al guardarlo — los respaldos fallarían
   sin decir por qué.
4. En R2 → **Manage API Tokens** → **Create Account API Token**.
5. Permiso: **Object Read & Write**, y acótalo **solo a `korex-respaldos`**. Si
   esa credencial se filtra, que no alcance a nada más.
6. Copia las tres cosas: **Access Key ID**, **Secret Access Key** y el
   **endpoint** (`https://<TU-ACCOUNT-ID>.r2.cloudflarestorage.com`).

   > El *Secret Access Key* **se muestra una sola vez**. Guárdalo en el gestor
   > de contraseñas antes de cerrar esa pantalla.

##### Parte B — Conectar Coolify con R2 (3 minutos)

1. En Coolify: **Settings → S3 Storage** (según la versión, *Server →
   Destinations*) → **Add**.
2. Rellena:
   - **Endpoint**: el `https://<ACCOUNT-ID>.r2.cloudflarestorage.com`
   - **Access Key / Secret Key**: los de la Parte A
   - **Bucket**: `korex-respaldos`
   - **Region**: `auto`
3. Guarda y usa el botón de probar conexión.

##### Parte C — Activar el respaldo automático

1. Coolify → tu proyecto → recurso **PostgreSQL** → pestaña **Backups**.
2. Frecuencia **diaria de madrugada** (`0 3 * * *`), retención **14** días.
3. Marca **Save to S3** y elige el destino de la Parte B.
4. Lanza un respaldo **manual ahora** y comprueba que el archivo aparece en el
   bucket de R2.

##### Parte D — Cerrar el círculo

Que el archivo esté en R2 demuestra que se subió, no que sirva. Baja esa copia
del bucket y pásala por el simulacro:

```bash
./scripts/respaldo/simulacro.sh ~/la-copia-que-bajaste.dump
```

</details>

---

## Traer las copias a tu PC

Esta es la ruta sin tarjeta, y bien montada protege igual de bien.

### Paso 1 — Que el servidor no pida contraseña

Para que la descarga corra sola hace falta una **llave SSH**: un par de archivos
que sustituyen a la contraseña. Uno se queda en tu PC (privado, no se comparte
nunca) y el otro se instala en el servidor.

En PowerShell, en tu computador:

```powershell
ssh-keygen -t ed25519 -C "respaldos-korex"
```

Cuando pregunte por *passphrase*, **déjalo vacío** (Enter dos veces). Con
contraseña, la tarea automática se quedaría esperando a que alguien la escriba
de madrugada.

Luego instala la llave pública en el servidor:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh USUARIO@IP-DEL-SERVIDOR "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Comprueba que funcionó: `ssh USUARIO@IP-DEL-SERVIDOR` debe entrar **sin pedir
contraseña**. Si aún la pide, la descarga automática no va a funcionar.

### Paso 2 — Traer las copias

```powershell
.\scripts\respaldo\descargar-a-mi-pc.ps1 -Servidor USUARIO@IP-DEL-SERVIDOR
```

Deja los archivos en `Escritorio\Respaldos Vocero`, junto a un `registro.txt`
con lo que fue pasando cada día.

Solo baja lo que falte, y **verifica cada archivo por su huella SHA-256** contra
el original del servidor. Esto no es cosmético: una descarga cortada a la mitad
pesa distinto pero se abre igual, y una copia así solo se descubre rota el día
que hace falta. Si la huella no cuadra, el archivo se descarta.

### Paso 3 — Que se haga sola

Se programa con un comando, sin pelearse con el asistente gráfico. Ajusta la
ruta y el servidor y pégalo en PowerShell:

```powershell
$ruta = 'C:\ruta\a\vocero\scripts\respaldo\descargar-a-mi-pc.ps1'
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ruta`" -Servidor USUARIO@IP"
$disparo = New-ScheduledTaskTrigger -Daily -At (Get-Date '10:00')
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'Respaldos Vocero' -Action $accion -Trigger $disparo -Settings $ajustes -Force
```

Dos ajustes que no son adorno: `-StartWhenAvailable` hace que la copia se haga
al encender el PC si estaba apagado a esa hora, y `-AllowStartIfOnBatteries`
evita que se salte el día que trabajes sin enchufe. Sin ellos, un portátil se
queda semanas sin copiar nada y nadie se entera.

La hora, a media mañana. No de madrugada: el servidor sí está siempre
encendido, tu computador no.

**Compruébala de verdad**, no te fíes de que aparezca creada:

```powershell
Start-ScheduledTask -TaskName 'Respaldos Vocero'
Start-Sleep 25
(Get-ScheduledTaskInfo -TaskName 'Respaldos Vocero').LastTaskResult   # 0 = correcto
```

Lanzarla así la ejecuta como la ejecutará Windows —otro entorno, otras
variables— y es donde aparecen los fallos que no salen cuando la lanzas tú.

### Paso 4 — Que la copia salga también de tu casa

Falta una cosa, y es importante: si se te daña o te roban el PC, pierdes las
copias igual que si se hubiera muerto el servidor. Un incendio se lleva las dos.

La forma gratuita y sin tarjeta de arreglarlo: **que la carpeta esté dentro de
OneDrive o Google Drive**, que en Windows ya sincronizan solos.

Míralo antes de mover nada, porque en Windows 11 el Escritorio suele estar ya
dentro de OneDrive:

```powershell
[Environment]::GetFolderPath('Desktop')
```

Si la respuesta incluye `OneDrive`, ya está resuelto y no hay que hacer nada.
Si no, apunta el guion a la carpeta sincronizada:

```powershell
.\scripts\respaldo\descargar-a-mi-pc.ps1 -Servidor USUARIO@IP -Destino "$env:USERPROFILE\OneDrive\Respaldos Vocero"
```

(OneDrive regala 5 GB y Google Drive 15 GB — de sobra para copias de decenas de
KB.) Con eso la copia acaba en tres sitios: el servidor, tu PC y la nube
personal. Para que los tres fallen a la vez tiene que pasar algo muy raro.

> **Ojo con la privacidad:** ese archivo contiene conversaciones reales de los
> clientes de tus clientes. Que la carpeta sincronizada sea tuya y privada —
> nada de compartirla por enlace ni dejarla en un equipo compartido.

---

## Los guiones de este repositorio

Un panel (Coolify, EasyPanel) o un cron propio saca copias, pero **no comprueba
que sirvan**, y no te da una forma guiada de restaurar el día que haga falta.
Eso es lo que cubren estos guiones. Se ejecutan **en el servidor**, por SSH.

> **Antes de nada, mira si ya tienes un respaldo montado:**
> ```bash
> crontab -l
> ```
> Es más común de lo que parece encontrarse un `backup.sh` que alguien dejó
> corriendo. Si lo hay y funciona, **no lo reemplaces**: dos sistemas copiando
> el mismo dato compiten por el disco y ninguno de los dos queda claro. Quédate
> con el que ya está probado en producción y usa de aquí lo que le falte, que
> casi siempre es el simulacro y la salida del servidor.

Los guiones trabajan con las **dos clases de copia** que existen por ahí:

| Archivo | Cómo se generó | Se restaura con |
|---|---|---|
| `vocero_*.dump` | `pg_dump -Fc` (`respaldar.sh`) | `pg_restore` |
| `vocero-*.sql.gz` | `pg_dump \| gzip` (el cron típico) | `psql` |

Verificar y restaurar tiene que funcionar con la copia que **ya** tienes, no
con la que deberías tener.

### Sacar una copia ahora mismo

> Solo si **no** tienes ya un respaldo automático funcionando. Si lo tienes,
> sáltate esto y ve directo al simulacro.

```bash
./scripts/respaldo/respaldar.sh
```

Guarda un archivo comprimido en `~/respaldos-vocero`, **comprueba que se puede
leer** y solo entonces borra las copias de más de 14 días. Si algo falla, no
borra nada: prefiere gastar disco a dejarte sin red.

### Comprobar que una copia sirve  ← el importante

```bash
./scripts/respaldo/simulacro.sh
```

Levanta una base de datos de usar y tirar, mete dentro el último respaldo,
cuenta lo que llegó y la borra. **No toca producción en ningún momento.**

Sin argumentos busca la copia más reciente en `/opt/korex-crm/backups` y en
`~/respaldos-vocero`, y reconoce el formato por la extensión. Si tus copias
viven en otro sitio:

```bash
CARPETAS_RESPALDO=/ruta/a/tus/copias ./scripts/respaldo/simulacro.sh
```

Si termina en `✓ SIMULACRO SUPERADO`, tienes un respaldo de verdad. Si no, lo
que tienes es un archivo.

> **Hazlo una vez al mes.** Es la diferencia entre creer que estás cubierto y
> estarlo. Un respaldo que nunca se restauró es una suposición.

### Restaurar (el día malo)

```bash
./scripts/respaldo/simulacro.sh ~/respaldos-vocero/vocero_2026-07-28_030000.dump
./scripts/respaldo/restaurar.sh ~/respaldos-vocero/vocero_2026-07-28_030000.dump
```

Siempre en ese orden: primero se prueba la copia, después se restaura. El guion
pide escribir `RESTAURAR` a mano y, antes de tocar nada, guarda una copia de
emergencia de lo que exista en ese momento — por si el respaldo elegido resulta
estar peor que lo que ibas a reemplazar.

---

## Cuando algo falla

**«No encontré ningún contenedor de Postgres corriendo»**
El servicio de base de datos está apagado. Enciéndelo desde Coolify y repite.

**«Hay más de un Postgres corriendo»**
Tienes varias bases en el mismo servidor. El mensaje te lista los nombres:
```bash
POSTGRES_CONTAINER=el-nombre-que-salió ./scripts/respaldo/respaldar.sh
```

**«La copia salió vacía» o «La copia está corrupta»**
Casi siempre es **disco lleno** en el servidor. Compruébalo con `df -h`. El
guion ya descartó el archivo malo y **no borró** los respaldos anteriores.

**El simulacro dice `✗ SIMULACRO FALLIDO`**
Esa copia no sirve. Prueba con la anterior (`ls ~/respaldos-vocero`). Si fallan
varias seguidas, el problema está en cómo se generan: no sigas confiando en el
respaldo automático hasta resolverlo.

---

## Qué revisar cada mes

1. Correr `./scripts/respaldo/simulacro.sh` en el servidor y ver el ✓.
2. Abrir la carpeta `Respaldos Vocero` del PC y comprobar que hay archivos de
   esta semana. Si el más nuevo tiene un mes, la tarea programada dejó de correr
   y llevas un mes sin red sin saberlo.
3. Confirmar que `ENCRYPTION_KEY` sigue guardada en el gestor de contraseñas.

Tres minutos al mes. Es el seguro más barato del negocio.

---

## Resumen: qué te protege de qué

| Ante esto… | Te salva… |
|---|---|
| Alguien borró datos sin querer | El respaldo automático de Coolify, en el servidor |
| El servidor entero desaparece | La copia en tu PC (`descargar-a-mi-pc.ps1`) |
| Se daña o te roban el PC | La carpeta sincronizada con OneDrive / Google Drive |
| El respaldo estaba corrupto | La huella SHA-256 al descargar, y el simulacro mensual |
| Perdiste el acceso a Coolify | Los secretos en el gestor de contraseñas |
| Restauraste la copia equivocada | La copia de emergencia que hace `restaurar.sh` |

Si alguna fila de esa tabla no está cubierta hoy, esa es la siguiente tarea.
