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
