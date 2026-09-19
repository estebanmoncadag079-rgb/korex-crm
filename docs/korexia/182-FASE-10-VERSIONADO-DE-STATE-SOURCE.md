# 182 · Fase 10 — versionado de `state_source`: requiere decisión

**19-sep-2026** · Estado: **REQUIERE DECISIÓN ARQUITECTÓNICA**. No se implementó
nada, y es deliberado. No hay cambio de esquema.

---

## El problema exacto

`agent_profile.state_source = 'backend'` dice **qué mecanismo usar**, pero no
**qué versión de ese mecanismo**. El código que interpreta esa bandera viaja en
la imagen desplegada; la bandera vive en la base. Son dos cosas que cambian por
caminos distintos.

Consecuencia concreta: si se despliega un commit anterior —el rollback de código
es volver a desplegar un SHA conocido-bueno (`scripts/deploy.sh`)— la columna
sigue diciendo `backend`, pero el comportamiento de un cliente real puede ser
otro. Por ejemplo, un SHA previo a las tres compuertas o a T030-A trataría las
mismas filas con menos validación, **sin que nada lo señale**.

Hoy no hay ninguna señal. Ni un error, ni un log, ni una diferencia visible en
el CRM. El pedido simplemente se comporta distinto.

## Qué habría que persistir

Una versión de la arquitectura de estado, por organización o global. Como
mínimo:

- qué versión de contrato implementa el código desplegado;
- qué versión esperaba la configuración cuando se encendió.

Hoy no existe dónde guardarlo: `agent_profile` no tiene esa columna, y el
registro de cambios (`conRegistro`) escribe a `console.log`, no a una tabla, así
que tampoco queda rastro consultable de cuándo se encendió ni con qué versión.

## Lo que ya existe y cubre parte del riesgo

- **`/api/health` reporta el commit desplegado** (`GIT_COMMIT`, horneado en la
  imagen). Se sabe qué código corre.
- **`migrate.mjs` verifica el esquema** tras migrar: si falta una columna que el
  código espera, el servidor no arranca (doc 167).

Ninguno de los dos liga `state_source` a una versión de contrato. Saber el
commit no dice si ese commit interpreta la bandera igual que el anterior.

## Las decisiones que faltan — y por qué no las tomo

La parte técnica (dónde guardar un número) es la fácil. Lo que no está
definido es **qué debe pasar cuando no coincide**, y eso decide qué le ocurre a
un cliente real en mitad de un rollback:

1. **¿Se apaga el mecanismo?** El cliente vuelve al comportamiento de `prompt`
   en silencio. Seguro, pero degrada sin avisar — y es justo el tipo de cambio
   invisible que este proyecto ya pagó caro con Malía.
2. **¿Se bloquea el turno?** El cliente deja de recibir respuestas. Correcto en
   lo formal, desastroso en el negocio: un rollback de código dejaría a los
   negocios mudos.
3. **¿Solo se alerta?** No protege de nada por sí solo, pero no rompe nada.
   Requiere que alguien mire la alerta — el mismo problema que tenía
   `validarConfiguracionArquitectonica` antes de la Fase 9.

Ninguna es obviamente correcta, y la elección es de negocio, no técnica.

## Alternativas técnicas y su riesgo

| Alternativa | Qué implica | Riesgo |
|---|---|---|
| Columna `state_source_version` en `agent_profile` | Migración nueva + backfill de 6 clientes | Bajo en esquema; el riesgo real es la política de incompatibilidad (arriba) |
| Constante de versión en el código + comparación al arrancar | Sin cambio de esquema; el código declara su versión | No sabe con qué versión se encendió cada cliente: solo detecta saltos globales |
| Tabla de historial de configuración | Resuelve también la trazabilidad de contenciones (ver doc 180, MALIA) | El mayor de los tres; es una capacidad nueva, no un arreglo |
| No hacer nada y documentarlo | Cero riesgo de implementación | El riesgo original sigue abierto |

La tercera resolvería de paso el otro problema abierto: hoy no se puede
distinguir una contención deliberada (`fase2 --apagar`) de una regresión, y por
eso MALIA aparecerá siempre en rojo en `auditar:arquitectura`.

## Qué NO se hizo

- No se creó ninguna columna ni tabla.
- No se eligió ninguna política de incompatibilidad.
- No se tocó `state_source` de ningún cliente.

Aplica la REGLA DE DETENCIÓN del plan: la decisión es de arquitectura y de
negocio, y no se improvisa.
