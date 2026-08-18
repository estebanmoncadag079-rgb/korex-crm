# El agente puede enviar catálogos en PDF, no solo fotos

> **Dentro:** Objetivo · Por qué no era pura configuración · Archivos
> modificados · El tamaño real del archivo · Cómo se sube uno nuevo · Lo que
> NO se construyó, y por qué · Las pruebas · Resultado del gate · Cómo
> revertir

**18-ago-2026.** Lashes Valen necesitaba mandar su catálogo de diseños de
pestañas (un PDF de varias páginas, no una foto suelta) cuando una clienta
pregunta cómo se ven. El mecanismo de "fotos que el agente puede enviar"
(`media_asset`, acción `send_image`, docs desde el 13-ago) solo aceptaba
JPG/PNG/WEBP — un catálogo de diseños no cabía ahí.

---

## 1 · Objetivo

Que el agente pueda mandar un PDF completo cuando lo piden ("¿tienes
catálogo?", "quiero ver los diseños"), con el mismo criterio que ya rige
las fotos: **solo cuando lo piden, nunca de oficio**, y que la capacidad
sirva para cualquier negocio que quiera mandar un catálogo, un menú en PDF
o un brochure — no solo para pestañas ni solo para Lashes Valen.

---

## 2 · Por qué esto NO era pura configuración (clasificación)

Categoría 2 de `REGLAS-DE-ARQUITECTURA.md` — capacidad reutilizable, no
config de un cliente. Verificado antes de escribir nada: la validación de
subida (`/api/media`) rechazaba `application/pdf` con un 415, y el envío
por WhatsApp (`sendImage`/`ycloudSendImage`) solo sabe mandar mensajes tipo
`image`, no `document`. Sin código nuevo, no había forma de que NINGÚN
cliente mandara un PDF, así que esto no podía resolverse subiendo el
archivo desde ningún lado.

---

## 3 · Archivos modificados

| Archivo | Qué |
|---|---|
| `src/app/api/media/route.ts` | Acepta `application/pdf` además de JPG/PNG/WEBP; el límite sube de 4 a 8 MB en base64 |
| `src/lib/db/schema.ts` | Docblock de `mediaAsset` actualizado (ya no son solo "fotos") — sin migración, ninguna columna cambió |
| `src/lib/ycloud/client.ts` | `ycloudSendDocument` nueva, hermana de `ycloudSendImage` (mensaje tipo `document`, con `filename`) |
| `src/server/inbox/send.ts` | `sendDocument` nueva; se extrajo `prepararEnvioDeMedia`/`registrarEnvioDeMedia` compartidos con `sendImage` para no duplicar las comprobaciones (conversación real, ventana de 24h, credenciales) |
| `src/server/ai/fotos.ts` | `FotoDisponible`/`fotoPorEtiqueta` ganan `mimeType` — es lo que decide cómo se entrega |
| `src/server/ai/pipeline.ts` | El caso `send_image` elige `deliverImage`/`deliverDocument` (nueva) según `foto.mimeType === "application/pdf"` — el modelo sigue pidiendo `send_image` para las dos cosas, sin saber la diferencia |
| `src/server/ai/prompts.ts` | Una frase en `CONTRATO_DE_ACCIONES`: `send_image` puede entregar "una foto (o un catálogo en PDF)" |
| `scripts/subir-media.ts` (nuevo) | Herramienta genérica para cargar un archivo a `media_asset` por línea de comandos, mientras no exista una pantalla de "Configuración → Fotos" post-onboarding (ver §6) |
| `package.json` | `pnpm subir:media` |
| `tests/unit/pipeline-send-image.test.ts` (nuevo) | Cobertura del turno completo eligiendo foto o documento |

**No tocado, y no hacía falta**: `message-thread.tsx` (la bandeja) ya
sabía pintar un mensaje `type: "document"` genérico con clip y
`mediaLabel` — ya existía para documentos recibidos (comprobantes), solo
faltaba que alguien lo mandara. `/api/media/[id]/route.ts` ya servía
cualquier `mimeType` guardado, sin cambios.

---

## 4 · El tamaño real del archivo — la parte que casi se pasa por alto

El PDF original (`Catálogo lashes valen.pdf`, del Google Drive del
dueño) pesaba **36,1 MB** — 10 páginas de fotos de diseños sin comprimir.
La base de datos entera del CRM pesa hoy ~16 MB (dato del propio docblock
de `mediaAsset`). Subir el original de un solo golpe habría **más que
triplicado** la base en una sola fila, desproporcionado frente a lo que
pesa el resto del catálogo de cualquier cliente (~9 MB para 46 servicios).

**Se comprimió antes de subirlo**, re-renderizando cada página a ~130 DPI
y recodificando a JPEG con `pymupdf` (Python, herramienta ya instalada en
esta máquina): **36,1 MB → 1,51 MB**, 10 páginas, calidad verificada
visualmente (portada revisada a mano) antes de subir nada. El límite de
`/api/media` se subió de 4 a 8 MB en base64 pensando en este caso —
holgado para un catálogo bien comprimido, sin dejar de poner techo.

No quedó un script reutilizable para la compresión (fue un one-off en
Python, fuera del proyecto Node): si otro cliente trae un PDF pesado, hay
que repetir el mismo criterio (re-render a ~130 DPI, JPEG ~70%) a mano
antes de `pnpm subir:media`.

---

## 5 · Cómo se subió — y cómo se sube uno nuevo

```bash
pnpm subir:media <organizationId> <ruta-del-archivo> "<etiqueta>" <producto|carta|otro>
```

Ejecutado para Lashes Valen:

```bash
pnpm subir:media org_novxv78s08h12arzatr2 catalogo-comprimido.pdf "catálogo de diseños" carta
```

Escribe **exactamente lo mismo que `POST /api/media`** — misma tabla,
mismos tipos aceptados, mismo límite, misma regla de "subir la misma
etiqueta reemplaza" — para que no importe si un archivo se cargó por
aquí o por el CRM el día que exista esa pantalla.

**Verificado directo en la base de producción tras subirlo** (no solo que
el script no lanzó error):

```
id: med_uvbq6nqp2yo1h7le5n18
etiqueta: catálogo de diseños
kind: carta
mime_type: application/pdf
tamano: 1.511.442 bytes
```

---

## 6 · Lo que NO se construyó, y por qué

**Una pantalla de "Configuración → Fotos" para clientes ya dados de
alta.** Hoy `FotosDeProductos` (el componente que sube a `/api/media`)
solo vive dentro del asistente de ONBOARDING — un cliente ya activo, como
Lashes Valen, no tiene dónde subir una foto o un PDF nuevo desde el CRM.
`scripts/subir-media.ts` es el puente mientras tanto, con el mismo
criterio que `pnpm repeticion` tuvo para `permiteRepeticion` antes de que
esa pantalla existiera: mismo camino de escritura, sin acceso a la base
para nadie más. **Es una capacidad global del CRM (categoría 3) que falta
del todo**, no solo para PDFs — un negocio no puede cambiar NINGUNA de sus
fotos después de darse de alta sin este script. Vale la pena construirla,
pero es una pantalla nueva, no una línea de este cambio.

---

## 7 · Pruebas

`tests/unit/pipeline-send-image.test.ts` (nuevo, 3 casos): una etiqueta
con `mimeType image/*` se entrega como foto, una con `application/pdf` se
entrega como documento (con el nombre de archivo correcto), y una etiqueta
que no existe se degrada a texto sin importar el tipo. Mismo patrón que
`pipeline-appointments-dispatch.test.ts`: `@/server/ai/fotos` mockeado
entero, conversación `isTest: true` para leer del `insert` a `message` en
vez de mockear `send.ts` aparte.

Sin prueba de integración: no hay ninguna para `send_image` desde antes de
este cambio (deuda preexistente, no de aquí — no se creó una para no
inflar el alcance).

**Gate**: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅
**804 passed, 73 skipped (877)**.

---

## 8 · Cómo revertir

**El código** (independiente de todo lo demás en este repo): quitar
`application/pdf` de `TIPOS` en `/api/media/route.ts`, quitar
`ycloudSendDocument`/`sendDocument`/`deliverDocument`, y en `pipeline.ts`
volver a llamar siempre `deliverImage` en el caso `send_image`. Nada de
esto tiene migración — son funciones nuevas y un `if` que se quita.

**El dato**: `DELETE FROM media_asset WHERE id = 'med_uvbq6nqp2yo1h7le5n18'`
— o `pnpm subir:media` con la misma etiqueta para reemplazarlo por otra
versión. No arrastra nada más (sin FK entrantes).
