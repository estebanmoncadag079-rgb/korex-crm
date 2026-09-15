# 174 — Las plantillas que nunca llegaban

**15-sep-2026.** La sincronización de plantillas desde YCloud leía un campo que
YCloud no devuelve. Nunca trajo una sola plantilla, y nadie lo sabía porque
nunca se había usado de verdad.

## El disparador

Camilabrandcol entra como cliente **solo de plantillas**: no usa el agente, solo
envía mensajes fuera de la ventana de 24 h. Aprobó su primera plantilla en
YCloud (`ventana_cerrada_23h`, UTILITY, es_CO) y había que traerla a Korex.

## Lo que se encontró

Todo el camino existía y funcionaba… menos una línea.

| Pieza | Estado |
|---|---|
| Token de YCloud de la organización | ✅ responde |
| `resolveWabaId` → WABA real de Meta | ✅ `360940597111677` |
| YCloud devuelve la plantilla | ✅ APPROVED |
| `mapYCloudTemplateToKorex` | ✅ nombre, idioma, categoría, body, header |
| **Lectura de la lista** | ❌ **el bug** |
| Estado `reconnect_required` del cliente | ❌ bloqueaba antes de empezar |
| Forma de dispararlo desde la interfaz | ❌ no existía |

### El bug

```js
const data = (json as { data?: unknown }).data;   // ← esperaba "data"
if (!Array.isArray(data)) return null;
```

Y `GET /v2/whatsapp/templates` devuelve, verificado contra producción:

```json
{ "offset": 0, "limit": 10, "length": 1, "items": [ … ] }
```

El campo se llama **`items`**. Cada respuesta real caía en
`AMBIGUOUS` — *"YCloud respondió 2xx sin una lista reconocible"* — y la
sincronización terminaba sin traer nada.

### Por qué no se detectó antes

Dos capas de prueba, y ninguna tocaba la API real:

1. `listarTemplatesYCloud()` **no tuvo ningún caller en producción** hasta la
   Fase 10D (lo dice el propio comentario de `sync-ycloud-templates.ts`,
   confirmado en la auditoría 153). Se escribió en la 9D y quedó dormida.
2. Su prueba unitaria (caso "R") **daba por buena la forma `data[]`** sin
   haberla contrastado nunca con YCloud. Y las pruebas del sync **mockean**
   `listarTemplatesYCloud`, así que saltaban justo por encima del fallo.

Un adaptador sin caller, con una prueba que consagra una suposición, está verde
y roto a la vez.

## El arreglo

**1. Leer la forma real.** `items` primero, `data` después (se conserva por si
alguna ruta del proveedor la usa).

**2. Prueba con la respuesta textual de producción** — `items[]` con la
plantilla de Camilabrandcol entera, incluidos header con variable y botón. Más
otra que garantiza que un 2xx sin lista reconocible **sigue** siendo
`AMBIGUOUS`, que era el comportamiento correcto que protegía la Fase 9F.

**3. Botón "Traer de YCloud"** en `/admin/templates`, junto a "Nuevo borrador".
Pide un cliente seleccionado a propósito: el endpoint sincroniza contra el WABA
de UNO, y hacerlo para todos a ciegas multiplicaría llamadas al proveedor.

**4. Estado del cliente.** Camilabrandcol estaba en `reconnect_required`, que
corta el paso en `resolverContextoYCloud` antes de cualquier llamada. Se
comprobó primero que el token **sí funciona** contra YCloud y se devolvió a
`connected`.

> No se pudo determinar qué lo marcó: el único camino que escribe ese estado es
> `translateMetaError` ante un error de autenticación, y los logs de esa hora
> (02:36) ya no existían. Queda dicho así, sin inventar la causa.

## Verificación

Con el código arreglado, contra YCloud real:

```
kind: SUCCESS
✅ 1 plantilla(s): ventana_cerrada_23h (es_CO) · UTILITY · APPROVED

sincronizarTemplatesYCloud → {"creadas":1,"actualizadas":0,"marcadasAusentes":0,"total":1}
```

Y en la tabla `template` de producción:

```
Camilabrandcol · ventana_cerrada_23h · es_CO · UTILITY
estado: approved · id Meta: 998036376595829
```

Gate completo: typecheck, 2174 pruebas, lint y build.

## Sobre el botón de la plantilla

La plantilla trae un `QUICK_REPLY` ("Continuar consulta.") que el mapeo local
no guarda. **No se pierde al enviar**: `sendTemplate` manda `name` +
`language` y solo los componentes con variables — los botones los aplica Meta
desde la definición aprobada.

## Cómo revertir

`git revert` del commit. El parser vuelve a leer solo `data` (y la
sincronización a no funcionar); el botón desaparece del panel. El estado de
Camilabrandcol y la fila de `template` ya sincronizada son datos, no código: no
los toca el revert.
