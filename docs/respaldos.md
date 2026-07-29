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

Este es el que protege del desastre de verdad, y el que exige una decisión tuya
porque tiene costo. Tres caminos, de menos a más automático:

**A. Descargarla a tu computador, a mano.** Cero costo, cero cuentas nuevas.
Sirve si lo haces de verdad, cada semana, sin fallar. Es fácil de prometer y
fácil de olvidar.

**B. Un almacenamiento S3 barato** (Backblaze B2, Cloudflare R2, Wasabi).
Coolify sube las copias solo. Cuesta unos pocos dólares al mes y es la opción
que elegiría cualquier equipo.

**C. Un segundo servidor tuyo.** Más control, más cosas que mantener.

Ojo con una cosa: la constitución del proyecto prohíbe depender de servicios
externos ([CLAUDE.md](../CLAUDE.md) → Soberanía). Un destino de respaldos **no
es** una dependencia de runtime — si Backblaze se cae, Vocero sigue atendiendo
clientes con normalidad — así que la opción B no rompe la regla. Pero es tu
decisión, y por eso está escrita aquí en vez de dada por hecha.

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
2. Comprobar en Coolify que la última copia automática es reciente.
3. Confirmar que `ENCRYPTION_KEY` sigue guardada en el gestor de contraseñas.

Tres minutos al mes. Es el seguro más barato del negocio.
