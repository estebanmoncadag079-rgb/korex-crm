# El guardarraíl noveno, completado: también cubre negar sin verificar

> **Dentro:** El caso real · La auditoría con protocolo formal · La
> medición contra la flota · El riesgo que la medición reveló · El
> criterio final · El fix · Cómo se verificó · Deuda que queda · Cómo
> revertir

**19-ago-2026, mismo día que [106](106-ESPECIALISTA-VERIFICADA-TRAS-CONSULTAR.md).**
El guardarraíl noveno ([105](105-GUARDARRAIL-ESPECIALISTA-SIN-VERIFICAR.md))
cubre "afirmar sin verificar" — un agente que confirma una especialista sin
haber consultado. Faltaba su mitad simétrica: **negar sin verificar**.

## El caso real

```
Agente:  Valentina tiene disponibilidad a las 6:00 p.m. y 6:30 p.m.
Clienta: 6:30 pm
Agente:  Ese horario ya no está disponible. ¿Qué otra hora prefieres?    ← falso,
                                                                            19s antes
                                                                            lo acababa
                                                                            de ofrecer
Clienta: a las 10 am
Agente:  ya no tenemos citas disponibles en la mañana.                  ← falso
Clienta: ¿qué horarios tienes disponibles para mañana?
Agente:  ya no tengo horarios disponibles.                              ← falso, el
                                                                            más grave
Clienta: valentina no tiene ningún horario disponible?
Agente:  Valentina sí tiene disponibilidad... 12:00, 12:30 o 1:00 p.m.  ← contradice
                                                                            todo lo de
                                                                            arriba
```

## La auditoría con protocolo formal

`usage_event` (misma técnica que en 105/106) probó, no infirió, que en los
tres turnos donde el agente negó disponibilidad **no hubo ninguna llamada a
`consult_availability`**. Cuando sí consultó, el sistema devolvió datos
reales y consistentes con la queja del dueño.

## La medición contra la flota

Antes de escribir un solo carácter de regex: se buscaron todas las
respuestas reales de Lashes Valen con patrones de negación de
disponibilidad, en toda su historia (no solo el 19-ago). **7 candidatos**,
cruzados uno por uno contra `usage_event`:

| Caso | `consultas` en ese turno | Veredicto |
|---|---|---|
| "Lo siento, ya no tengo disponibilidad para ambos servicios" | > 0 | legítimo |
| "la cita... a las 6:30 PM no está disponible" | 0 | **legítimo** (ver abajo) |
| "en la mañana ya no tengo disponibilidad para las pestañas" | > 0 | legítimo |
| "Ese horario ya no está disponible" (Valentina) ×2 | 0 | alucinado |
| "ya no tenemos citas disponibles en la mañana" | 0 | alucinado |
| "ya no tengo horarios disponibles" | 0 | alucinado |
| "Ese horario ya no está disponible" (comprobante fuera de contexto) | 0 | alucinado |

El último caso es un cuarto incidente real, independiente del de Valentina:
una clienta mandó el comprobante de una cita YA confirmada, el agente le
resumió la cita bien, y ante un "Muchas gracias" respondió *"Ese horario ya
no está disponible"* — una negación completamente fuera de lugar, disparada
por un agradecimiento, no por una petición de horario.

## El riesgo que la medición reveló

Un primer diseño —"cualquier negación con `consultas===0`"— habría
bloqueado un caso real y correcto: el agente había ofrecido solo "2:00 PM"
en el turno anterior; la clienta insistió con "6:30"; el agente respondió
que esa hora no estaba disponible **sin volver a consultar en ese turno**,
porque no hacía falta — ya sabía, por su propia oferta reciente, que 6:30
no era una de las horas libres. Es una deducción válida, no una invención,
y el contrato de la acción ya reconoce este caso ("EN ESTE TURNO O EL
INMEDIATO ANTERIOR").

La diferencia con los casos alucinados no está en si hubo o no consulta EN
ESE turno —los dos grupos tienen `consultas===0`— sino en la FORMA de la
negación: el caso legítimo nombra la hora explícita que se está negando
("a las 6:30 PM"); los alucinados usan una referencia vaga ("ese horario")
o niegan un periodo/todo entero, sin ninguna hora de por medio.

## El criterio final

`niegaDisponibilidadSinVerificar()` (`anuncio-de-cierre.ts`) solo caza:

- negaciones vagas de una cita/hora/horario **sin la hora al lado**
  ("ese horario ya no está disponible"), o
- negaciones categóricas de un periodo entero o de TODOS los horarios
  ("no tenemos citas disponibles en la mañana", "ya no tengo horarios
  disponibles").

Deja pasar a propósito cualquier negación que mencione una hora explícita
(`6:30 PM`, `10:00`) — es el precio de no bloquear el caso legítimo medido,
y queda anotado como deuda conocida más abajo.

## El fix

Se fusiona con el guardarraíl noveno en vez de crear uno nuevo:
`pipeline.ts` ahora evalúa `afirmaConEspecialistaSinVerificar(...) ||
niegaDisponibilidadSinVerificar(...)` en el mismo bloque, con el mismo
reintento y la misma resolución de `consult_availability` ya existentes.
El mensaje de corrección se generalizó a
`CORRECCION_DE_DISPONIBILIDAD_SIN_VERIFICAR` para cubrir los dos sentidos
("afirma o niega disponibilidad... podrías estar equivocado, en cualquiera
de los dos sentidos").

## Cómo se verificó

```
pnpm test        # 897 passed (11 nuevas), 73 skipped — antes: 886 passed
pnpm typecheck   # limpio
pnpm lint        # limpio
pnpm build       # compila
```

- `tests/unit/niega-disponibilidad-sin-verificar.test.ts` (9 pruebas
  puras): los 4 mensajes reales alucinados, los 2 legítimos —incluido el
  de la hora puntual que motivó el ajuste del criterio—, y los casos de
  guardia habituales (pregunta, texto vacío).
- `tests/unit/pipeline-niega-disponibilidad.test.ts` (2 de integración
  sobre `runAgentTurn`): la negación categórica rehace el turno y acepta
  la respuesta ya verificada; la negación de hora puntual **no dispara
  nada**, ni un reintento — una sola llamada al modelo, tal cual.
- `tests/unit/especialista-sin-verificar.test.ts` y
  `tests/unit/pipeline-especialista-verificada.test.ts` (los 10 anteriores)
  siguen pasando sin cambios: la mitad de "afirmar" no se tocó.

## Deuda que queda

- **No cubre negar una hora puntual sin ninguna consulta previa, ni en
  este turno ni en el anterior** (por ejemplo, un cliente que pregunta
  directo por una hora nueva y el agente la rechaza de una, inventada). Se
  dejó fuera a propósito para no arriesgar el falso positivo medido; sería
  el siguiente candidato a medir si aparece un caso real de este tipo.
- Igual que 105/106: no probado contra WhatsApp real, solo contra
  conversaciones reales ya ocurridas.

## Cómo revertir

```bash
git revert <commit>
```

Sin esquema, sin datos, sin estado. Revertir deja el guardarraíl noveno
cubriendo solo "afirmar sin verificar", como antes de hoy.
