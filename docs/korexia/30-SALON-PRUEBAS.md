# El salón de belleza: catálogo real y la tanda de pruebas antes del día 1

> **Dentro:** Qué se cargó · Los tres bugs que salieron · Qué se probó y cómo
> respondió · Lo que queda por afinar

Primer cliente real del vertical de citas (7-ago-2026). Antes de conectarlo se
cargó su catálogo de verdad en la organización de pruebas y se ejercitó el
agente contra el modelo real, en conversaciones `is_test` que **nunca tocan
WhatsApp**.

## Qué se cargó

**41 servicios** en 5 categorías y **5 especialistas**, con la regla del salón:
la asignación es **por categoría, no por servicio**, y **nadie cruza entre los
dos grupos**.

| Grupo | Quiénes | Qué atienden |
|---|---|---|
| Uñas | Geimar, Laura | los 12 servicios de Uñas |
| Estética | Hilary, Valentina, Carolina | Pestañas (9), Efectos Modernos (6), Retoques (12), Labios (2) |

Duraciones de 15 min a 3 h, precios de $8.000 a $150.000.

## Los tres bugs que salieron (los tres, corregidos)

**1. Al agente le faltaba el AÑO.** Recibía "viernes, 7 de agosto, 18:30" y el
prompt le pedía convertir "el lunes" a DD/MM/AAAA. Se inventaba el año, ponía
uno pasado y el servidor le respondía —con razón— que ya pasó. La clienta oía
**"el lunes 10 de agosto ya pasó"** un viernes 7.

**2. El modelo no sabe contar días.** Con el año ya puesto, seguía fallando:
dijo "el lunes 9 de agosto" cuando el 9 era domingo (el día que el salón
cierra). Se le quitó la aritmética: ahora recibe un **CALENDARIO** de 14 días
con cada fecha, su día de la semana y si el negocio abre. Mismo principio que
el horario y la disponibilidad — **la cuenta la hace el servidor**.

**3. "Ese horario ya no está disponible"… siendo suya.** Al decir "sí,
confirmo" después de que la cita ya quedó hecha, el hueco está ocupado **por
ella misma** y salía el mensaje genérico, como si se le hubiera caído la cita.
Salió tres veces seguidas. Ahora responde *"Tranquila, esa cita ya está
confirmada: Hidralips el 14/08 a las 3:00 PM"*.

Los dos primeros estaban anotados desde el 3-ago como "el modelo interpreta
mal las fechas relativas". No era el modelo: **le faltaban los datos**.

## Qué se probó y cómo respondió

| Escenario | Resultado |
|---|---|
| Agendar con fecha relativa ("el lunes") | ✅ lunes 10, 9:00 AM con Geimar |
| **Cita duplicada** (reconfirmar) | ✅ no duplica; avisa que ya es suya |
| **Dos clientas, mismo horario** | ✅ la 2ª entra a la MISMA hora con Laura |
| **Tres clientas, mismo horario** | ✅ a la 3ª le ofrece las horas libres reales |
| Especialista que no atiende ese servicio | ✅ "Hilary no atiende uñas; Geimar o Laura" |
| Servicio ambiguo ("un retoque", hay 12) | ✅ pregunta cuál en vez de adivinar |
| Servicio de 3 h cerca del cierre | ✅ último hueco 15:30 (19:00 − 3 h), no ofrece las 17:00 |
| Reagendar | ✅ jueves 13 → viernes 14, misma hora |
| Cancelar | ✅ queda `cancelada`, no borrada |

Verificado además en la base: **6 citas, ningún duplicado y ningún solape** en
la agenda de una misma especialista.

## Lo que queda por afinar

- ✅ **Ofrecía 17 horarios de golpe** — corregido el mismo día. Ahora menciona
  **3** (mañana, mediodía y tarde, o los más cercanos a lo que pidió) y avisa
  de que tiene más.

  > ⚠️ **El primer intento rompió algo peor.** Al decirle solo "ofrece máximo
  > 3", el modelo empezó a tratar esos 3 como los ÚNICOS y le negó a una
  > clienta las 11:00 de un día con la agenda **entera vacía**. Un muro de
  > texto se lee mal; esto pierde citas. Hizo falta decirle explícitamente que
  > mencionar 3 no borra las demás, y que negar una hora que sí está libre
  > "es un error grave: le quita una cita al negocio". Reverificado: ofrece 3
  > y, al pedirle las 11:00, la agenda sin discutir.
  >
  > La lección se repite: **recortar lo que el modelo VE es peligroso;
  > recortar lo que DICE es lo que se quería.** Al modelo se le sigue pasando
  > la lista completa.
- **Al elegir especialista para una hora libre** prefiere correr la hora antes
  que usar a la compañera libre en algunos casos. El motor sí ofrece ambas
  (verificado: a las 9:00 aparecía Laura); es el modelo el que elige. Se
  observa, no se ha corregido.
- **Los recordatorios siguen sin plantilla** — ver
  [29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md).

## Cómo repetir la tanda

El catálogo está en `org_novxv78s08h12arzatr2` (la organización de pruebas).
Al dar de alta al salón de verdad hay que **copiarlo a su organización** — el
SQL de carga quedó en el scratchpad de la sesión. Para reprobar:

```bash
# bundle autocontenido del script (la imagen de producción no trae scripts/)
npx esbuild scripts/probar-citas.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/pc.mjs --alias:@=./src \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
# → scp al VPS, docker cp al contenedor y:
docker exec <contenedor> node /app/pc.mjs <organizationId> 'mensaje 1' 'mensaje 2' …
```
