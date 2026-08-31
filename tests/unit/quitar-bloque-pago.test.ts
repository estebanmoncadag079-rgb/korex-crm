import { describe, expect, it } from "vitest";
import { quitarPagoDuplicado } from "@/server/ai/generador/quitar-bloque-pago";

/**
 * Bug real (Malía Postres, 30-ago-2026, migración de payment_source a
 * 'ficha'): `datosDeCuenta` puede traer una línea en blanco PROPIA en medio
 * (una cuenta y, aparte, una llave) — el regex anterior cortaba en la
 * PRIMERA línea en blanco que encontraba, confundiéndola con el separador
 * entre bloques de `generar.ts`, y dejaba "LLAVE: @llanos818" huérfano.
 */

const INSTRUCTIONS_MALIA = `Eres la voz de Malia Postres.

## Cómo te pagan

Formas de pago: Transferencia y efectivo

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
AHORROS BANCOLOMBIA
81200017192
SALOMÉ LLANOS

LLAVE: @llanos818

Pídele la foto del comprobante para dejar el pedido en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.

## Regalos

Si, puedes agregar una tarjeta con mensaje sin costo adicional.`;

describe("quitarPagoDuplicado", () => {
  it("caso real de Malía: datos de cuenta con línea en blanco interna — no deja nada huérfano", () => {
    const { nuevo, huboCambio } = quitarPagoDuplicado(INSTRUCTIONS_MALIA);
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/AHORROS BANCOLOMBIA/);
    expect(nuevo).not.toMatch(/81200017192/);
    expect(nuevo).not.toMatch(/SALOMÉ LLANOS/);
    // El bug real: esto quedaba huérfano, sin contexto, tras la limpieza.
    expect(nuevo).not.toMatch(/LLAVE: @llanos818/);
    expect(nuevo).not.toMatch(/Formas de pago:/);
    // Lo que NO son datos de cuenta se conserva intacto.
    expect(nuevo).toMatch(/Pídele la foto del comprobante para dejar el pedido en firme/);
    expect(nuevo).toMatch(/## Regalos/);
    expect(nuevo).toMatch(/tarjeta con mensaje sin costo adicional/);
    // Sin saltos de línea huérfanos de más.
    expect(nuevo).not.toMatch(/\n{3,}/);
  });

  it("caso normal, sin líneas en blanco internas en los datos de cuenta (patrón Lis/La Churra)", () => {
    const instructions = `Eres la voz de La Churra.

## Cómo te pagan

Formas de pago: Bancolombia

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
Cuenta de ahorros 123-456789-00
A nombre de La Churra SAS

Pídele la foto del comprobante para dejar el pedido en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.

## Otra sección`;
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/123-456789-00/);
    expect(nuevo).not.toMatch(/La Churra SAS/);
    expect(nuevo).toMatch(/Pídele la foto del comprobante/);
    expect(nuevo).toMatch(/## Otra sección/);
  });

  it("sin 'Pídele la foto del comprobante' (compruebaUnaPersona=false): corta hasta el siguiente header", () => {
    const instructions = `Eres la voz de un negocio.

## Cómo te pagan

Formas de pago: Nequi

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
NEQUI-3001234567

## Regalos

No aplica.`;
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/NEQUI-3001234567/);
    expect(nuevo).toMatch(/## Regalos/);
    expect(nuevo).toMatch(/No aplica\./);
  });

  it("sin bloque '## Cómo te pagan': no cambia nada", () => {
    const instructions = "Eres la voz de un negocio sin sección de pago.";
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(false);
    expect(nuevo).toBe(instructions);
  });

  it("caso real de Lis: 'Formas de pago' en el mismo párrafo que una regla de comportamiento", () => {
    const instructions = `## Cómo te pagan

Formas de pago: Transferencia bancaria — incluye Bancolombia, Nequi y pago por llave. Si el cliente insiste en pagar en efectivo, dile que por ahora no se puede y que apenas se pueda se lo contamos.

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
NEQUI-3001112233

Pídele la foto del comprobante para dejar el pedido en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.

## Otra sección`;
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(true);
    // La regla de comportamiento ("Si el cliente insiste...") no la lee
    // `ficha.pago`, así que debe conservarse.
    expect(nuevo).toMatch(/Si el cliente insiste en pagar en efectivo/);
    expect(nuevo).not.toMatch(/NEQUI-3001112233/);
    expect(nuevo).not.toMatch(/Formas de pago: Transferencia bancaria/);
  });

  it("varias líneas en blanco seguidas dentro de los datos de cuenta también quedan limpias", () => {
    const instructions = `## Cómo te pagan

Formas de pago: Transferencia

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
Banco X
Cuenta 111


Llave: y@y.com

Pídele la foto del comprobante para dejar el pedido en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.

## Fin`;
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/Banco X|Cuenta 111|Llave: y@y\.com/);
    expect(nuevo).toMatch(/## Fin/);
    expect(nuevo).not.toMatch(/\n{3,}/);
  });
});

/**
 * Auditoría de citas (FASE B, 31-ago-2026): Lashes Valen es hoy el único
 * cliente real de citas y su `instructions` trae el mismo bloque duplicado
 * que ya se corrigió en pedidos ("Pídele la foto del comprobante para dejar
 * LA CITA en firme" en vez de "EL PEDIDO en firme"). La función no distingue
 * vertical — el lookahead corta en "Pídele la foto del comprobante", una
 * frase idéntica en los dos casos, ANTES de "para dejar el pedido/la cita en
 * firme" — así que no hizo falta tocar el código: estos casos son la
 * verificación de que el mecanismo YA generaliza a citas sin cambios.
 */
const INSTRUCTIONS_LASHES_VALEN = `Eres la voz de Lashes Valen.

# Lo que ofreces y cómo te pagan

## Cómo te pagan

Formas de pago: NEQUI

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
NEQUI-3185940645
A nombre de Valentina Vargas.
Llave 3185940645

Pídele la foto del comprobante para dejar la cita en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.

## Regalos

NO

Si es un regalo, los datos de entrega son los de QUIEN RECIBE, no los de quien compra.`;

describe("quitarPagoDuplicado — vertical de citas (Lashes Valen)", () => {
  it("Caso A: bloque de pago normal, texto real de Lashes Valen", () => {
    const { nuevo, huboCambio } = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN);
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/Formas de pago:/);
    expect(nuevo).not.toMatch(/NEQUI-3185940645/);
    expect(nuevo).not.toMatch(/Valentina Vargas/);
    expect(nuevo).not.toMatch(/Llave 3185940645/);
    expect(nuevo).toMatch(/Pídele la foto del comprobante para dejar la cita en firme/);
    expect(nuevo).toMatch(/## Regalos/);
  });

  it("Caso B: líneas en blanco internas en los datos de cuenta (formato citas)", () => {
    const instructions = `## Cómo te pagan

Formas de pago: NEQUI

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
NEQUI-3001112233
A nombre de Valentina Vargas.

Llave 3001112233

Pídele la foto del comprobante para dejar la cita en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.

## Reglas propias de este negocio`;
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/NEQUI-3001112233|Llave 3001112233/);
    expect(nuevo).toMatch(/Pídele la foto del comprobante para dejar la cita en firme/);
    expect(nuevo).toMatch(/## Reglas propias de este negocio/);
    expect(nuevo).not.toMatch(/\n{3,}/);
  });

  it("Caso C: datos de cuenta con varias líneas (banco, titular, llave)", () => {
    const { nuevo } = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN);
    // Las tres líneas de datosDeCuenta desaparecen juntas, ninguna queda suelta.
    expect(nuevo).not.toMatch(/NEQUI-3185940645/);
    expect(nuevo).not.toMatch(/A nombre de Valentina Vargas/);
    expect(nuevo).not.toMatch(/Llave 3185940645/);
  });

  it("Caso D: texto editorial inmediatamente después del bloque se conserva íntegro", () => {
    const { nuevo } = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN);
    expect(nuevo).toMatch(
      /## Regalos\n\nNO\n\nSi es un regalo, los datos de entrega son los de QUIEN RECIBE/
    );
  });

  it("Caso E: el bloque de pago está al final de instructions (sin '## ' después)", () => {
    const instructions = `Eres la voz de un negocio de citas.

## Cómo te pagan

Formas de pago: Nequi

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
NEQUI-3009998877

Pídele la foto del comprobante para dejar la cita en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.`;
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/NEQUI-3009998877/);
    expect(nuevo).toMatch(/Pídele la foto del comprobante para dejar la cita en firme/);
  });

  it("Caso F: sin bloque de pago, el texto de citas queda idéntico", () => {
    const instructions =
      "Eres la voz de un negocio de citas sin sección de pago todavía.";
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions);
    expect(huboCambio).toBe(false);
    expect(nuevo).toBe(instructions);
  });

  it("Caso G: 'pago'/'comprobante' fuera del bloque no se tocan", () => {
    const instructions = `${INSTRUCTIONS_LASHES_VALEN}

## Reglas propias de este negocio

- Si un cliente pregunta "¿quedé agendada?" y no ves la cita, no le pidas otro pago ni comprobante: confirma con recepción primero.`;
    const { nuevo } = quitarPagoDuplicado(instructions);
    expect(nuevo).toMatch(
      /no le pidas otro pago ni comprobante: confirma con recepción primero/
    );
  });
});

/**
 * FASE C (31-ago-2026): la limpieza de arriba deja intacta la frase "Pídele
 * la foto del comprobante para dejar [el pedido/la cita] en firme" — correcto
 * para PEDIDOS (siempre se pide comprobante), pero contradice al bloque
 * estructurado de citas cuando `pagoAntesDeLaCita=false` (caso real: Lashes
 * Valen). `opciones.quitarFraseComprobante` retira también esa frase, sin
 * tocar nada del resto — por defecto (sin pasarlo) el comportamiento es
 * IDÉNTICO al de siempre, así que pedidos no cambia ni un bit.
 */
describe("quitarPagoDuplicado — opciones.quitarFraseComprobante", () => {
  it("1. Pedido existente (sin la opción) no cambia: mismo resultado que antes", () => {
    const sinOpciones = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN);
    const conOpcionFalse = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN, {
      quitarFraseComprobante: false,
    });
    expect(conOpcionFalse).toEqual(sinOpciones);
    expect(sinOpciones.nuevo).toMatch(/Pídele la foto del comprobante para dejar la cita en firme/);
  });

  it("2. Cita con pagoAntesDeLaCita=true (no se pide quitar la frase): se conserva", () => {
    const { nuevo } = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN, {
      quitarFraseComprobante: false,
    });
    expect(nuevo).toMatch(/Pídele la foto del comprobante para dejar la cita en firme/);
    expect(nuevo).toMatch(/\*\*Tú nunca das un pago por bueno\*\*: lo revisa una persona del equipo\./);
  });

  it("3. Cita con pagoAntesDeLaCita=false: quitarFraseComprobante=true retira la frase completa", () => {
    const { nuevo, huboCambio } = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN, {
      quitarFraseComprobante: true,
    });
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/Pídele la foto del comprobante/);
    expect(nuevo).not.toMatch(/Tú nunca das un pago por bueno/);
    // Los datos de cuenta y las formas de pago también se fueron (mismo criterio de siempre).
    expect(nuevo).not.toMatch(/NEQUI-3185940645|Formas de pago:/);
    // El resto del prompt sigue intacto.
    expect(nuevo).toMatch(/## Regalos/);
    expect(nuevo).toMatch(/## Cómo te pagan/);
  });

  it("4. Una mención de 'comprobante' fuera del contexto de confirmación no se toca, incluso con la opción activa", () => {
    const instructions = `${INSTRUCTIONS_LASHES_VALEN}

## Reglas propias de este negocio

- Si la clienta manda el comprobante antes de que confirmemos la cita, dile que primero hay que agendar.`;
    const { nuevo } = quitarPagoDuplicado(instructions, { quitarFraseComprobante: true });
    expect(nuevo).toMatch(/Si la clienta manda el comprobante antes de que confirmemos la cita/);
  });

  it("5. Líneas en blanco internas en los datos de cuenta + quitarFraseComprobante: limpio, sin huérfanos", () => {
    const instructions = `## Cómo te pagan

Formas de pago: NEQUI

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
NEQUI-3001112233
A nombre de Valentina Vargas.

Llave 3001112233

Pídele la foto del comprobante para dejar la cita en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.

## Reglas propias de este negocio`;
    const { nuevo } = quitarPagoDuplicado(instructions, { quitarFraseComprobante: true });
    expect(nuevo).not.toMatch(/NEQUI-3001112233|Llave 3001112233|Pídele la foto/);
    expect(nuevo).toMatch(/## Reglas propias de este negocio/);
    expect(nuevo).not.toMatch(/\n{3,}/);
  });

  it("6. Bloque de pago al final de instructions + quitarFraseComprobante: no revienta sin '## ' después", () => {
    const instructions = `Eres la voz de un negocio de citas.

## Cómo te pagan

Formas de pago: Nequi

Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):
NEQUI-3009998877

Pídele la foto del comprobante para dejar la cita en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.`;
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions, { quitarFraseComprobante: true });
    expect(huboCambio).toBe(true);
    expect(nuevo).not.toMatch(/NEQUI-3009998877|Pídele la foto/);
  });

  it("7. Sin bloque de pago: quitarFraseComprobante no cambia nada", () => {
    const instructions = "Eres la voz de un negocio de citas sin sección de pago todavía.";
    const { nuevo, huboCambio } = quitarPagoDuplicado(instructions, { quitarFraseComprobante: true });
    expect(huboCambio).toBe(false);
    expect(nuevo).toBe(instructions);
  });

  it("8. No deja líneas huérfanas ni saltos de línea de más al quitar la frase completa", () => {
    const { nuevo } = quitarPagoDuplicado(INSTRUCTIONS_LASHES_VALEN, { quitarFraseComprobante: true });
    expect(nuevo).not.toMatch(/\n{3,}/);
    const inicio = nuevo.indexOf("## Cómo te pagan");
    const fin = nuevo.indexOf("\n## ", inicio + 1);
    // El bloque queda vacío de contenido de pago: solo el encabezado, sin nada huérfano en medio.
    expect(nuevo.slice(inicio, fin).trim()).toBe("## Cómo te pagan");
  });
});
