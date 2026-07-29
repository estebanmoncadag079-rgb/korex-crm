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

El destino elegido es **Cloudflare R2**: 10 GB gratis permanentes, sin pausas por
inactividad, habla el protocolo S3 (Coolify escribe ahí directo) y no cobra por
descargar. Las copias de este CRM pesan pocos megas, así que en la práctica no
cuesta nada.

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

### Parte A — Cloudflare R2 (unos 5 minutos)

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

### Parte B — Conectar Coolify con R2 (3 minutos)

1. En Coolify: **Settings → S3 Storage** (según la versión, *Server →
   Destinations*) → **Add**.
2. Rellena:
   - **Endpoint**: el `https://<ACCOUNT-ID>.r2.cloudflarestorage.com`
   - **Access Key / Secret Key**: los de la Parte A
   - **Bucket**: `korex-respaldos`
   - **Region**: `auto`
3. Guarda y usa el botón de probar conexión.

### Parte C — Activar el respaldo automático

1. Coolify → tu proyecto → recurso **PostgreSQL** → pestaña **Backups**.
2. Frecuencia **diaria de madrugada** (`0 3 * * *`), retención **14** días.
3. Marca **Save to S3** y elige el destino de la Parte B.
4. Lanza un respaldo **manual ahora** y comprueba que el archivo aparece en el
   bucket de R2.

### Parte D — Cerrar el círculo (esto es lo que casi nadie hace)

Que el archivo esté en R2 demuestra que se subió, no que sirva. Baja esa copia
del bucket y pásala por el simulacro:

```bash
./scripts/respaldo/simulacro.sh ~/la-copia-que-bajaste.dump
```

Hasta que no veas `✓ SIMULACRO SUPERADO` con un archivo venido de R2, la cadena
completa no está probada — solo sus piezas por separado.

---

## Los guiones de este repositorio

Coolify saca copias, pero **no comprueba que sirvan**, y no te da una forma
guiada de restaurar el día que haga falta. Eso lo cubren estos tres guiones.
Se ejecutan **en el servidor**, entrando por SSH:

### Sacar una copia ahora mismo

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

1. Correr `./scripts/respaldo/simulacro.sh` y ver el ✓.
2. Comprobar en Coolify que la última copia automática es reciente, y que en el
   bucket de R2 hay archivos de esta semana.
3. Confirmar que `ENCRYPTION_KEY` sigue guardada en el gestor de contraseñas.

Tres minutos al mes. Es el seguro más barato del negocio.

---

## Resumen: qué te protege de qué

| Ante esto… | Te salva… |
|---|---|
| Alguien borró datos sin querer | El respaldo automático de Coolify |
| El servidor entero desaparece | La copia en Cloudflare R2 (Nivel 2) |
| El respaldo estaba corrupto | El simulacro mensual, que lo detecta antes |
| Perdiste el acceso a Coolify | Los secretos en el gestor de contraseñas |
| Restauraste la copia equivocada | La copia de emergencia que hace `restaurar.sh` |

Si alguna fila de esa tabla no está cubierta hoy, esa es la siguiente tarea.
