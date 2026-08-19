# El noveno guardarraíl: confirmar una especialista sin verificar

> **Dentro:** El caso · Por qué esta vez el texto no basta · La medición que
> descartó el regex · El hecho que sí es fiable · El fix · Cómo se
> verificó · Deuda que queda · Cómo revertir

**19-ago-2026.** El fix de ayer ([104](104-ALGORITMO-BUSCAR-SERVICIO-SUBSTRING-AMBIGUO.md))
funcionó: el agente ahora pregunta *"¿qué retoque?"* en vez de rechazar a
Hilary por error. Pero apareció el bug siguiente, un paso más adelante en
la misma conversación.

---

## El caso

```
Cliente: "Quisiera agendar un retoque con hillary"
Agente:  "¿Qué retoque te gustaría agendar con Hilary?..."        ← correcto,
                                                                      el fix
                                                                      de ayer
Cliente: "Quiero un retoque de volumen ruso"
Agente:  "¡Perfecto! Un retoque de Volumen Ruso con Hilary.
          ¿Para qué día y hora...?"                                ← falso
```

Verificado en la base: **ni "Retoque Volumen Ruso" (10-15 ni 20 días) ni el
servicio base tienen a Hilary asignada** — solo Valentina y Carolina. El
mismo día, otro caso más caro: el agente le dio a una clienta horas
concretas para **dos especialistas distintas en un solo mensaje**
("Podríamos agendarte... con Geimar... 3:30pm. Y a tu mami... con Laura...
4:00pm o 4:30pm"), sin una sola consulta de por medio.

## Por qué esta vez el texto no basta

El instinto natural era repetir el patrón de `prometeRecurso` ([101](101-GUARDARRAIL-RECURSO-PROMETIDO.md)):
un regex de "frases de confirmación" (perfecto, claro que sí + nombre +
pregunta de fecha). Se midió contra 20 mensajes reales de la flota antes de
escribir una línea, y el regex habría fallado:

```
"¡Claro que sí, hermosa! ¿Qué tipo de servicio de pestañas te gustaría
 agendar con Valentina para mañana...? Así te confirmo la disponibilidad."
```

Este mensaje tiene *"claro que sí"* y el nombre real de una especialista —
y es exactamente el flujo **correcto**: el agente pregunta el servicio,
sin confirmar nada todavía. El mismo texto que delata el bug también
aparece en respuestas sanas. Un regex de frases lo habría bloqueado por
error.

## El hecho que sí es fiable

`pipeline.ts` ya lleva la cuenta de cuántas veces se llamó a
`consult_availability` **en ese turno** (`consultas`, del bucle que
resuelve la acción interna). Si es `0` y la acción final es un `reply` de
texto libre, el modelo respondió sin haber verificado nada — sin importar
qué palabras haya usado. Comprobar el hecho, no el prompt.

```
consultas === 0                              ← el modelo nunca consultó
  Y action.action === "reply"                ← no fue una acción verificable
  Y el texto AFIRMA (no pregunta) mencionando
    a una especialista real de este negocio  ← afirmaConEspecialistaSinVerificar()
→ rehacer el turno
```

`afirmaConEspecialistaSinVerificar()` (`anuncio-de-cierre.ts`) solo hace la
mitad pura: evalúa por oración (mismo patrón que `prometeRecurso`) y
descarta cualquier oración que sea pregunta. Los nombres vienen de
`services.flatMap(s => s.staffNames)` — **datos de ese negocio**, nunca un
nombre hardcodeado.

## El fix

Guardarraíl en `pipeline.ts`, justo después del bucle de
`consult_availability` (mismo lugar donde `consultas` está disponible).
Con una diferencia respecto a los ocho anteriores: si el reintento decide
consultar de verdad (`action === "consult_availability"`), se resuelve ahí
mismo — una vuelta más, para no abrir un segundo bucle sin límite.

## Cómo se verificó

```
pnpm test        # 872 passed (8 nuevas), 73 skipped
pnpm typecheck   # limpio
pnpm lint        # limpio
```

Las 8 pruebas incluyen los **dos mensajes reales** que motivaron esto, el
**falso positivo que el regex habría cometido** (ahora un caso negativo
correcto), y una comparación por palabra completa (que "Lauraceae" no
cuente como "Laura").

## Deuda que queda

- **No hay test de integración del reintento completo** — igual que los
  ocho guardarraíles anteriores: se prueba la función de detección pura,
  no el turno de servidor de punta a punta con `chatJson` mockeado.
- **No probado contra WhatsApp real.** La próxima prueba en un chat limpio
  con Lashes Valen debería repetir exactamente el guion de Hilary +
  Volumen Ruso.
- **Un límite conocido y aceptado**: si el modelo afirma con el nombre de
  una especialista que **sí** atiende el servicio, sin haber consultado, el
  guardarraíl igual frena y reintenta — es más caro (una llamada extra al
  modelo) pero no dañino: fuerza exactamente lo que el contrato ya pedía
  hacer siempre.

## Cómo revertir

```bash
git revert <commit>
```

Sin esquema, sin datos, sin estado. Revertir deja el `reply` sin verificar
pasar tal cual, como antes de hoy.
