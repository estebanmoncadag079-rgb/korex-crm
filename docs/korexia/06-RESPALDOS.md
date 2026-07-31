# Respaldos y recuperación

## Cómo funciona (dos piezas)

**1. El servidor hace la copia.** `/opt/korex-crm/backup.sh` vuelca la base de
datos comprimida en `/opt/korex-crm/backups`, y guarda **14 días**. En cron
**cada 6 horas** (3:30, 9:30, 15:30 y 21:30 UTC). Cada copia pesa ~100 KB.

El script **valida el volcado**: comprueba que el archivo se pueda descomprimir
y que contenga la marca de final de `pg_dump`. Si sale truncado, lo descarta en
vez de guardar una copia inservible.

**2. El PC del dueño se la lleva fuera.** Una tarea programada de Windows
("Respaldos korex.ia", diaria a las 10:00) ejecuta
`descargar-respaldos.ps1`, que baja a una carpeta de **OneDrive** las copias
que falten. Al estar en OneDrive, se suben solas a la nube.

**Resultado: cada copia vive en tres sitios** — servidor, PC y nube.

Si el PC estaba apagado, Windows ejecuta la tarea al encenderlo. Y como el
servidor guarda 14 días, aunque pasen días sin encenderlo, al volver se
descargan todas las pendientes.

El script deja un registro legible (`_registro-automatico.txt`) y avisa si la
copia más reciente tiene 2 días o más.

## Qué SÍ se recupera

Todo lo que vive en la base de datos:

- Organizaciones, cuentas de acceso y contraseñas
- **Prompts, horarios y teléfonos de aviso** de cada agente
- **El conocimiento** de cada negocio
- **Todas las conversaciones y mensajes**
- Contactos, leads y el embudo
- Las credenciales de WhatsApp de cada cliente (cifradas)

## Qué NO se recupera

**1. Las claves para descifrar.** Las credenciales de WhatsApp se guardan
cifradas con `ENCRYPTION_KEY`, que vive **solo** en `/opt/korex-crm/.env` y
**no se incluye en las copias** (para no subir secretos a la nube). Sin esa
clave, las credenciales del respaldo son ilegibles y habría que reconectar cada
número desde cero.

> **El dueño guardó el `.env` completo en su gestor de contraseñas el
> 30-jul-2026.** Ese es el respaldo de los secretos. Si se cambia alguna
> variable en el servidor, hay que actualizarla ahí también.

**2. Los comprobantes de pago.** Las imágenes no se guardan: se piden a YCloud
al abrirlas, y allí solo viven **30 días**. Si un comprobante importa para un
reclamo, hay que descargarlo antes.

**3. Lo ocurrido desde la última copia**: como mucho, 6 horas.

**4. Las sesiones abiertas**: todos tendrán que volver a entrar. Sus usuarios y
contraseñas sí se recuperan.

## La prueba de restauración (31-jul-2026)

Un respaldo que no se ha probado no es un respaldo. Se restauró una copia real
en una base limpia y se recuperó **todo y legible**:

| Cliente | Conocimiento | Contactos | Conversaciones | Prompt |
|---|---|---|---|---|
| La Churra | 14 | 19 | 67 | 11.168 caracteres |
| Lis Pastelería | 12 | 7 | 7 | 12.061 caracteres |

Con horarios, teléfonos de aviso, credenciales de los dos números, y los textos
con sus acentos y emojis intactos.

### Cómo repetirla sin riesgo

```bash
docker exec korex-crm-postgres-1 psql -U postgres -c "CREATE DATABASE prueba_restauracion;"
zcat /opt/korex-crm/backups/vocero-XXXX.sql.gz | \
  docker exec -i korex-crm-postgres-1 psql -U postgres -d prueba_restauracion
# … verificar lo que interesa …
docker exec korex-crm-postgres-1 psql -U postgres -c "DROP DATABASE prueba_restauracion;"
```

> ⚠️ **El volcado lleva `--clean --if-exists`: borra objetos antes de crearlos.**
> Restaurarlo apuntando a `vocero` por error **destruye producción**. Pasar
> siempre `-d` de forma explícita y comprobarlo dos veces.

Conviene repetir esta prueba **cada pocos meses**: las cosas se rompen en
silencio.

## Levantar el servicio desde cero

El servicio son **cuatro piezas**, no una:

| Pieza | Dónde está |
|---|---|
| **Los datos** | las copias `.sql.gz` (servidor, PC y OneDrive) |
| **El código** | GitHub: `estebanmoncadag079-rgb/korex-crm` |
| **Los secretos** | el gestor de contraseñas del dueño |
| **Un servidor** | cualquiera con Docker |

El procedimiento paso a paso, escrito para alguien que no programa, está en
**`COMO-LEVANTAR-EL-SERVICIO.txt`**, guardado junto a las copias en OneDrive
(y por tanto también en la nube).

Resumen: servidor con Docker → clonar el repositorio → escribir el `.env` con
los valores guardados → levantar la base → restaurar la copia más reciente →
construir y levantar la aplicación → apuntar el dominio a la nueva IP.

**Si el dominio sigue siendo `korexia.online`, los webhooks de YCloud funcionan
tal cual y no hay que tocarlos.** Si cambia, hay que actualizarlos en la
consola de YCloud.

## Lo que aún se puede mejorar

- **La copia externa depende de que el PC se encienda.** Si la agencia crece,
  conviene que el servidor suba las copias por su cuenta (con `rclone` a
  OneDrive o a un almacenamiento tipo S3). Hoy no hay `rclone` instalado.
- **No hay comprobación automática de que una copia restaure bien.** Se hace a
  mano, cuando alguien se acuerda.
