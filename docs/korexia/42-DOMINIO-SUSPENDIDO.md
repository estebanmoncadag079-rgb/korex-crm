# El día que el dominio se suspendió y nadie se enteró (11-12 ago 2026)

> **Dentro:** Qué pasó · Por qué el monitor calló · Cómo se diagnosticó ·
> Lo que costó · El chequeo externo nuevo · Cómo reconocerlo en 2 minutos ·
> Lo que queda

**23 horas sin que ningún bot respondiera, con toda la infraestructura sana.**
Es el primer incidente del proyecto cuya causa está **fuera** del servidor.

## Qué pasó

Hostinger **suspendió `korexia.online`** el **11-ago a las 08:40 UTC**
(3:40 a.m. Colombia). Los nameservers pasaron a
`ns1/ns2.verification-hold.dns-suspended.com` y el dominio quedó apuntando a
`2.57.91.93`, una IP de parking que sirve una página titulada literalmente
*"Your domain is suspended"* y que **no tiene HTTPS**.

**La causa: la verificación de ICANN.** Al registrar un dominio, el titular
tiene **15 días** para confirmar su correo. El dominio se creó el **26-jul**;
el plazo venció el 10-ago; la suspensión entró el 11. El correo de
verificación nunca se abrió.

**Cómo dejó mudos a los bots:** el webhook de YCloud apunta a
`https://crm.korexia.online/api/webhooks/ycloud`. Con el dominio en el parking
sin certificado, **cada mensaje moría en un error de TLS antes de tocar el
CRM**. También cayó el panel, para la agencia y para los clientes.

No fue falta de pago: el dominio está pagado **hasta 2029**.

## Por qué el monitor calló 23 horas

Esta es la parte que importa. `monitor-bots-alerta.sh` funcionaba
perfectamente y no tenía nada que decir, porque **todo lo que vigilaba estaba
bien**:

| Lo que miraba el monitor | Estado real durante el apagón |
|---|---|
| Contenedor del CRM | ✅ `Up 26 hours (healthy)` |
| Base de datos | ✅ `Up 13 days (healthy)` |
| Cola de turnos (`agent_job`) | ✅ vacía — nadie escribía |
| Logs de la aplicación | ✅ sin un solo error |
| Salud interna (`/api/health`) | ✅ `{"ok":true}` |

> **La lección, en una frase: el monitor le preguntaba a la casa si estaba
> bien, pero nadie tocaba el timbre desde la calle.**

Y hay una vuelta de tuerca: la cola vacía *parecía* buena señal. En realidad
era el síntoma. Ninguna de las señales existentes puede distinguir "no llega
trabajo porque no hay clientes" de "no llega trabajo porque nadie puede
llegar hasta nosotros".

## Cómo se diagnosticó (12-ago, ~07:45 UTC)

El checklist de "el bot no responde" (13 causas confirmadas, resumidas en la
memoria del asistente) descartó las causas conocidas en 3 minutos: saldo de
OpenRouter con **8,57 USD**, contenedores sanos, logs limpios. **Ninguna
encajaba** — todas las anteriores viven dentro del servidor. La pista llegó al ver que el `curl` al dominio fallaba
mientras el mismo `curl` **saltándose el DNS** funcionaba:

```bash
# Desde el VPS — falla por el nombre
curl https://crm.korexia.online/api/health          # → HTTP 000, ip 2.57.91.93

# Mismo servidor, saltando el DNS — funciona
curl --resolve crm.korexia.online:443:127.0.0.1 -k \
     https://crm.korexia.online/api/health          # → {"ok":true} HTTP 200
```

Esa diferencia señala el DNS, y el `dig` lo confirmó:

```bash
dig +short korexia.online NS @8.8.8.8
# ns1.verification-hold.dns-suspended.com.
# ns2.verification-hold.dns-suspended.com.
```

## Lo que costó

- **Último mensaje recibido: 11-ago 01:37 UTC** (10-ago 20:37 Colombia).
- **Cero mensajes durante ~23 h**, con un volumen normal de 100-180 al día.
- **Los mensajes de ese lapso se perdieron.** YCloud reintenta 7 veces
  durante ~6 h y después descarta el evento para siempre
  ([03-WHATSAPP-Y-YCLOUD.md](03-WHATSAPP-Y-YCLOUD.md)). Se consultó su API y
  **no expone los entrantes**: solo devuelve los mensajes que salieron.
- ⚠️ **Pero no se perdieron para el negocio.** Con coexistencia, esos
  mensajes **sí llegaron al WhatsApp del celular** de cada cliente. Lo que
  se perdió fue la respuesta automática, no la conversación.

Coincidió con la semana en que entraba el cliente de mayor volumen.

## El chequeo externo nuevo (instalado el 12-ago)

Se añadió un bloque a `/root/monitor-bots-alerta.sh` que mira el sistema
**desde fuera**, de internet hacia dentro:

| # | Qué comprueba | Cuándo avisa |
|---|---|---|
| 1 | **Nameservers** del dominio | Dejan de ser los de Hostinger → 🔴 |
| 2 | **DNS** de `crm.` y raíz | No resuelve, o no apunta a `2.25.159.117` → 🔴 |
| 3 | **HTTPS** real a `/api/health` | No da 200 con `{"ok":true}` → 🔴 |
| 4 | **Certificado** TLS | Caducado → 🔴 · quedan <10 días → 🟡 |
| 5 | **WHOIS** (1 vez al día) | El dominio vence en <30 días → 🟡 |

El **#1 es el que habría cazado este incidente**, y es además la señal más
temprana: un cambio de nameservers que nadie hizo a propósito solo puede ser
suspensión o secuestro.

### Contra las falsas alarmas

Al instalarlo se descubrió en vivo que **los nodos de Google DNS se
contradicen entre sí** mientras un cambio propaga: `8.8.8.8` devolvía la IP
vieja y `1.1.1.1` la nueva, alternándose. Un monitor que grita y se desdice
cada 15 minutos se acaba ignorando, y entonces no sirve de nada.

Por eso **se pregunta a dos servidores DNS (Google y Cloudflare) y solo se da
por cierto lo que responden igual los dos**. Si discrepan, no se alerta: se
anota `⏳ propagando` y se decide en la vuelta siguiente. El chequeo HTTPS,
además, reintenta una vez antes de dar nada por malo.

**Límite conocido y aceptado**: la petición sale del propio VPS y vuelve, así
que valida DNS + Traefik + certificado, pero **no detectaría un firewall que
bloquee la entrada desde fuera**. Habría cazado este incidente sin problema.

### Verificación (12-ago)

- `bash -n` limpio; el monitor completo corre en **6,5 s** y sale con 0.
- Probado en seco contra el estado real: con el dominio aún en el parking
  disparaba las dos alertas rojas correctas.
- **Probado de verdad, sin querer**: el cron de las 08:00 UTC corrió con la
  primera versión y **envió las dos alertas rojas al Telegram del dueño**.
  El circuito completo quedó demostrado de punta a punta.
- Certificado Let's Encrypt del CRM verificado: válido hasta el **24-oct-2026**
  — no caducó durante el apagón.

## Cómo reconocerlo en 2 minutos

Si vuelve a pasar (o pasa con otro dominio), estos tres comandos lo cierran:

```bash
dig +short korexia.online NS @8.8.8.8        # ¿los NS son los de Hostinger?
dig +short crm.korexia.online A @8.8.8.8     # ¿apunta a 2.25.159.117?
curl -s https://crm.korexia.online/api/health # ¿contesta {"ok":true}?
```

Si los NS dicen `verification-hold` o `dns-suspended`: es el correo del
titular sin verificar. **Se arregla en Hostinger → Dominios**, confirmando el
correo de ICANN (mirar también en spam). El registro se restaura solo, pero
**el DNS tarda hasta 1 hora más en propagar** por el TTL.

## Lo que queda

- **El script sigue viviendo solo en `/root` del VPS.** Ya era el pendiente
  de higiene #9 de [36-PENDIENTES-ESCALADO.md](36-PENDIENTES-ESCALADO.md), y
  ahora pesa más: lleva la vigilancia entera y **los respaldos automáticos no
  cubren `/root`**. Si se pierde el servidor, se pierde el monitor. Lo
  razonable es versionarlo con el token de Telegram sacado a una variable de
  entorno. Copia de seguridad de esta sesión en
  `/root/monitor-bots-alerta.sh.bak-12ago`.
- **Renovación automática del dominio**: conviene confirmarla en Hostinger.
  El chequeo #5 avisa con 30 días, pero es mejor que no haga falta.
- **Vigilar los demás dominios** el día que existan (un cliente con dominio
  propio, por ejemplo): hoy la lista `DOMINIOS_WEB` está escrita a mano.
