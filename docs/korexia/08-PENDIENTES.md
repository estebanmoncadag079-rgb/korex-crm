# Qué quedó y qué no

Estado al cierre del **31-jul-2026**. Ordenado por urgencia real, no por
categoría: lo de arriba puede costar dinero o datos hoy; lo de abajo puede
esperar semanas.

---

## 🔴 URGENTE — solo lo puede hacer el dueño

### 1. Cambiar la contraseña del superadmin

Sigue siendo la que quedó expuesta en un chat. **La auditoría confirmó que es
peor de lo que parecía**: no es una cuenta más. Desde el login público, quien la
tenga puede entrar como **cualquier cliente**, leer y escribir todas sus
conversaciones, **borrar un cliente entero** y gestionar las credenciales de
WhatsApp de cada negocio.

Agravantes verificados en el código: **no hay segundo factor** (solo correo y
contraseña) y el límite de intentos no protege contra quien ya tiene la
contraseña correcta.

Al cambiarla, revisar la tabla `session` por sesiones que no se reconozcan.

### 2. Borrar la clave de OpenRouter compartida por chat

No está en uso (producción usa otra de la misma cuenta), pero **sigue viva**:
quien la haya visto puede gastar el saldo. Se borra en `openrouter.ai → Keys`,
sin tocar producción.

### 3. Borrar el repositorio viejo `estebanmoncadag079-rgb/korex.ia`

Ya hay respaldo completo verificado (39 commits) en
`OneDrive\Desktop\Respaldos Vocero\repo-korex-ia-landing-vieja-20260731.tar.gz`.
`gh repo delete` falla con **403: falta el permiso `delete_repo`** en el token.
Se arregla con `gh auth refresh -h github.com -s delete_repo` o desde la web.

*(Vercel ya está limpio: se verificó que la cuenta no tiene proyectos.)*

---

## 🟠 Seguridad pendiente (de la auditoría del 31-jul)

Lo grave ya se corrigió — la fuga del token del webhook y las firmas que fallaban
abiertas. Queda esto, por orden:

**4. Verificación en dos pasos para el superadmin.** Better Auth lo soporta con
su plugin `twoFactor`. Es lo que de verdad blinda el acceso, más que cambiar la
contraseña.

**5. Subir a `next@15.5.21`.** La versión instalada arrastra 8 avisos, todos
corregidos en ese parche. El más relevante necesita cuerpos con codificación
rara y respuestas cacheadas, y las rutas de API aquí son `force-dynamic`: riesgo
bajo, arreglo trivial.

**6. ~~Lista blanca de dominios en `/api/media/[id]`~~** — ✅ **hecho el
31-jul-2026**. Solo se descarga por https desde los hosts de YCloud y Meta,
comparando el host completo (no "termina en"). Pasó de higiene a requisito al
plantear el procesamiento de audio e imágenes.

**7. `drizzle-orm` a 0.45.2+.** El CVE conocido **no es explotable aquí** (se
revisó todo el SQL crudo: siempre interpola columnas o constantes). Actualizar
por higiene, probando, porque salta varias versiones menores.

**8. `contactPhoneOf()` no usa `scoped()`.** No es explotable —el id viene de una
conversación ya filtrada— pero rompe la disciplina del resto del código.

**9. Cabeceras de seguridad** (CSP, HSTS, X-Frame-Options) ausentes en
`next.config.ts`. Probablemente las añade Traefik; conviene verificarlo.

---

## 🟡 Funcionalidad: huecos conocidos

**10. Las ventas atendidas a mano no llegan a "Cliente".** El embudo solo salta
a ganado cuando el **agente** cierra con `notify_order`. Si atiende una persona
—como pasó todo el 29 y 30 de julio— el tablero no se entera. Propuesto: un
botón *"Registrar pedido"* en la conversación, que mueva la tarjeta y anote el
pedido igual que hace el agente. Es la opción que no depende de que nadie se
acuerde. Pendiente de decidir.

**11. Los mensajes de control quedan en el historial del agente.** El `#bot`
escrito desde el celular entra en la conversación y el agente lo lee como un
mensaje más; en una prueba llegó a imitarlo y proponer escribir "#bot" él mismo.
Es el mismo patrón del "se copia a sí mismo" que causó los cierres falsos.
**Deberían excluirse del historial**: son instrucciones internas, no conversación.

**12. El prompt de La Churra está desactualizado.** Dice que se puede recoger en
el punto del C.C. Alfaguara, pero el equipo le respondió a un cliente real que
*"nuestros pedidos son solo a domicilio"*. Lo detectó el aprendizaje.
**Confirmar con el negocio y corregir el prompt**, no solo aprobar la propuesta.

**13. Los mensajes salientes se quedan en "pendiente".** No se procesa el evento
de YCloud que informa del estado (entregado, leído, fallido). Consecuencia real:
si un aviso de pedido lo rechaza WhatsApp por la ventana de 24 h, nadie se
entera. Es el mismo trabajo que falta para el punto 14.

**14. El costo real de cada mensaje de WhatsApp.** Hoy se cuentan pero se anotan
a 0, que es correcto mientras Meta no cobre. YCloud informa el importe de forma
asíncrona, así que hay que traerlo aparte. **Cerrarlo antes de octubre.**

**15. Alerta de saldo bajo de OpenRouter.** El monitor vigila que los servicios
estén vivos, pero no los saldos — justo lo que falló el 29-jul: todo en verde y
el agente mudo por falta de créditos.

**16. Los números del equipo aparecen en la bandeja** cuando escriben al negocio
para mantener abierta su ventana de 24 h. Decidir si se filtran.

**17. Guiones del Laboratorio genéricos.** Nacieron para una ferretería; sirven a
medias para churrería y pastelería.

**18. Faltan pantallas**: el horario y la marca de un cliente solo se configuran
por base de datos.

**19. Automatizar el aprendizaje** (una pasada semanal con aviso), cuando el uso
manual demuestre que las propuestas son buenas.

---

## 🔵 Infraestructura

**20. La copia externa depende de que el PC se encienda.** Funciona porque se usa
a diario, pero si la agencia crece conviene que el servidor suba las copias solo
(`rclone` a OneDrive o S3).

**21. Un solo servidor, sin réplica.** Si el VPS cae, cae todo. Se amortigua
porque YCloud reintenta los webhooks y hay copias fuera, pero el servicio estaría
caído hasta levantarlo a mano.

**22. Un solo núcleo.** Cualquier proceso descontrolado afecta a todo. Ya pasó
con el bot viejo de Lis.

**23. Los comprobantes de pago caducan a los 30 días** en YCloud y no hay copia.

---

## 💼 Negocio

**24. Cobro, contrato y qué incluye el servicio.** Sin empezar. Ahora hay un dato
que antes no existía: el contador dice cuánto cuesta cada cliente al mes.

**25. Antes del 1-oct-2026**: Meta empieza a cobrar **todos** los mensajes
salientes. Hoy las respuestas dentro de la ventana de 24 h son gratis, por eso el
saldo de YCloud lleva meses intacto. Hay que decidir **quién paga los mensajes de
cada cliente** — y el camino ya probado es que cada uno tenga su cuenta de
YCloud, como Lis.

**26. Verificación de negocio en Meta** para pasar de 2 números por portafolio.
No urge con dos clientes.

---

## Decisiones tomadas (no reabrir sin motivo nuevo)

- **Sin plantillas de WhatsApp**: se cobran por envío. Los avisos van en texto
  libre y el equipo mantiene su ventana abierta.
- **No ser Tech Provider de Meta**: 900 USD, no incluye mensajes y solo sirve
  para el modo *white label*.
- **No abrir cuentas de YCloud extra** para saltarse el límite de números: lo
  prohíbe su contrato y podrían cerrarlas todas a la vez. La vía legítima es que
  cada cliente tenga la suya.
- **No migrar a Supabase**: añade latencia y ~25 USD/mes sin aportar nada hoy.
- **No revivir los bots no oficiales** (Baileys): se caían cada 50 minutos por
  diseño y arriesgaban el bloqueo del número.
- **Sin modelo de respaldo** (31-jul): si el principal no resuelve, se avisa al
  cliente y se deriva a una persona. Lo que hace falta ahí no es otro modelo.
- **El aprendizaje se aprueba a mano** y es solo de la agencia: consume IA que
  paga ella, y aprender a ciegas propagaría los errores del equipo.
- **El panel de costos va solo en dólares**: convertir a pesos con una tasa fija
  daba una cifra que envejecía sola.
