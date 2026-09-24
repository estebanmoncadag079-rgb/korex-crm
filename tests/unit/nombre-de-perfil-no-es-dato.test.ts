import { describe, expect, it } from "vitest";
import { aplicarOperacion, type ContextoOperaciones } from "@/server/orders/operaciones";
import { estadoVacio } from "@/server/orders/estado";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * El nombre del perfil de WhatsApp es CONTEXTO, nunca un dato confirmado.
 *
 * Incidente real (MALIA, 24-sep-2026, conv cv_zgm286k69bz1hmprf87a):
 *
 *     CLIENTE  Sería solo 1, es para un endulce de amigos secretos
 *     …
 *     BOT      Anoté que es para un endulce de amigos secretos y que va a
 *              nombre de Luisa Duque. ¿Me pasas el celular de contacto?
 *
 * La clienta NUNCA dijo su nombre. "Luisa Duque" es su usuario de WhatsApp
 * (`contact.phone` es `null`: ni siquiera hay teléfono). Y no quedó solo en la
 * frase — el estado guardado terminó en `datos: {"nombre":"Luisa Duque"}`, es
 * decir, un requisito de cierre dado por satisfecho con un dato que nadie
 * confirmó.
 *
 * **No fue una alucinación: se lo pedimos nosotros.** `fichaDelContacto()`
 * decía literalmente *"FICHA DEL CLIENTE (ya la tienes: no la preguntes)"* y
 * *"Úsala para completar el resumen del pedido"*.
 *
 * Por eso la defensa va en DOS capas y hacen falta las dos: el prompt deja de
 * ordenarlo, y el backend se niega a persistirlo. Solo el prompt no basta —
 * este caso demuestra que acaba en la base de datos.
 *
 * La regla es estrecha a propósito: rechaza únicamente cuando el valor
 * propuesto ES el nombre del perfil **y** el cliente no lo escribió en ningún
 * momento. Si lo dijo, se acepta; y un nombre distinto del perfil nunca se
 * mira siquiera.
 */
const NOMBRE: Requisito = {
  id: "nombre",
  tipo: "texto",
  etiqueta: "el nombre de quien lo pide",
  obligatorio: true,
};

const contexto = (
  nombreDePerfil: string | null,
  dichoPorElCliente: string[]
): ContextoOperaciones => ({
  organizationId: "org_1",
  catalogo: [],
  requisitos: [NOMBRE],
  modalidadesOfrecidas: [],
  nombreDePerfil,
  dichoPorElCliente,
});

const fijarNombre = (valor: string) =>
  ({ tipo: "fijar_dato", requisitoId: "nombre", valor }) as const;

describe("el perfil de WhatsApp no se convierte en nombre del pedido", () => {
  it("BUG REAL: 'Luisa Duque' no puede guardarse si la clienta nunca lo dijo", () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Luisa Duque"),
      contexto("Luisa Duque", ["Sería solo 1, es para un endulce de amigos secretos"])
    );
    expect(r.ok).toBe(false);
  });

  it("y el rechazo le explica al modelo qué hacer", () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Luisa Duque"),
      contexto("Luisa Duque", ["hola"])
    );
    if (r.ok) throw new Error("debería haberse rechazado");
    expect(r.correccion).toMatch(/pregúnta|preg[uú]nt/i);
  });

  it("si el cliente SÍ lo dijo, se guarda aunque coincida con el perfil", () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Juan Pérez"),
      contexto("Juan Perez", ["Hola, soy Juan Pérez"])
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estado.datos.nombre).toBe("Juan Pérez");
  });

  it("tolera tildes y mayúsculas al comparar lo que dijo", () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("JUAN PEREZ"),
      contexto("Juan Pérez", ["mi nombre es juan pérez"])
    );
    expect(r.ok).toBe(true);
  });

  it("sin nombre de perfil, la regla del perfil no se activa (pero sí la de procedencia)", () => {
    // Sin perfil que comparar, un nombre que el cliente escribió se guarda.
    const r = aplicarOperacion(estadoVacio(), fijarNombre("Luisa Duque"), contexto(null, ["soy Luisa Duque"]));
    expect(r.ok).toBe(true);
  });

  it("REGRESIÓN: otros datos no se ven afectados", () => {
    const telefono: Requisito = {
      id: "telefono", tipo: "telefono", etiqueta: "el celular", obligatorio: true,
    };
    const r = aplicarOperacion(
      estadoVacio(),
      { tipo: "fijar_dato", requisitoId: "telefono", valor: "3146814914" },
      { ...contexto("Luisa Duque", ["hola"]), requisitos: [NOMBRE, telefono] }
    );
    expect(r.ok).toBe(true);
  });

  it("EL DETECTOR DETECTA: sin evidencia rechaza, con evidencia acepta, mismo valor", () => {
    const sin = aplicarOperacion(estadoVacio(), fijarNombre("Luisa Duque"), contexto("Luisa Duque", ["hola"]));
    const con = aplicarOperacion(estadoVacio(), fijarNombre("Luisa Duque"), contexto("Luisa Duque", ["soy Luisa Duque"]));
    expect(sin.ok).toBe(false);
    expect(con.ok).toBe(true);
  });
});

/**
 * Bloqueador 3 de la auditoría: `datos.nombre` es el nombre de QUIEN PIDE
 * (la etiqueta lo dice: "el nombre de quien lo pide"). No basta con que un
 * nombre aparezca en algún mensaje — hay que distinguir la PROCEDENCIA:
 *
 *   el cliente se identificó       → se guarda
 *   es el destinatario ("para Ana") → NO es el comprador
 *   nunca apareció / lo negó        → no se guarda
 *
 * Y la confirmación no puede depender de que el mensaje siga dentro de la
 * ventana de historial: si ya se guardó, el estado mismo es la evidencia (CA8).
 */
describe("datos.nombre exige procedencia del cliente, no aparición del texto", () => {
  it('"es para Ana" NO convierte a Ana en el comprador (es la destinataria)', () => {
    const r = aplicarOperacion(estadoVacio(), fijarNombre("Ana"), contexto("Luisa Duque", ["es para Ana"]));
    expect(r.ok).toBe(false);
  });

  it("un nombre que el cliente nunca escribió no se guarda, aunque no sea el del perfil", () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Juan Pérez"),
      contexto("Luisa Duque", ["quiero uno para Ana"])
    );
    expect(r.ok).toBe(false);
  });

  it("un nombre SUELTO no confirma nada: aparecer no es identificarse", () => {
    // 2.ª auditoría: "aparición de texto ≠ procedencia". Un token que parece
    // nombre, sin "soy"/"me llamo" ni un teléfono propio, no basta — el backend
    // no puede saber si es el comprador o una mención.
    const r = aplicarOperacion(estadoVacio(), fijarNombre("Ana Gómez"), contexto("Luisa Duque", ["Ana Gómez"]));
    expect(r.ok).toBe(false);
  });

  it("un nombre junto a su propio teléfono se guarda (son los datos del pedido)", () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Ana Gómez"),
      contexto("Luisa Duque", ["Ana Gómez, 3155551234, Calle 5 # 12-34"])
    );
    expect(r.ok).toBe(true);
  });

  it('"no me llamo Juan Pérez" NO es evidencia de que se llame así', () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Juan Pérez"),
      contexto("Luisa Duque", ["no me llamo Juan Pérez"])
    );
    expect(r.ok).toBe(false);
  });

  /* Los casos del auditor: el nombre aparece, pero como mención, no como identidad. */
  it('"El pedido anterior era de Juan Pérez" NO confirma el nombre del cliente actual', () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Juan Pérez"),
      contexto("Luisa Duque", ["El pedido anterior era de Juan Pérez"])
    );
    expect(r.ok).toBe(false);
  });

  it('"¿Juan Pérez está disponible?" NO confirma el nombre', () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Juan Pérez"),
      contexto("Luisa Duque", ["¿Juan Pérez está disponible?"])
    );
    expect(r.ok).toBe(false);
  });

  it('"Me recomendaron a Juan Pérez" NO confirma el nombre', () => {
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Juan Pérez"),
      contexto("Luisa Duque", ["Me recomendaron a Juan Pérez"])
    );
    expect(r.ok).toBe(false);
  });

  it("al confirmar por autoidentificación, el estado guarda la PROCEDENCIA, no solo el valor", () => {
    const r = aplicarOperacion(estadoVacio(), fijarNombre("Juan Pérez"), contexto("Luisa Duque", ["soy Juan Pérez"]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.estado.datos.nombre).toBe("Juan Pérez");
      expect(r.estado.procedenciaDelNombre).toBe("cliente");
    }
  });

  it("CA8: con procedencia guardada, reafirmar el nombre vale aunque la evidencia ya no esté en la ventana", () => {
    // El cliente lo confirmó hace >20 mensajes; el estado conserva valor +
    // procedencia. Reafirmarlo no vuelve a exigir la frase original.
    const yaConfirmado = {
      ...estadoVacio(),
      datos: { nombre: "Juan Pérez" },
      procedenciaDelNombre: "cliente" as const,
    };
    const r = aplicarOperacion(
      yaConfirmado,
      fijarNombre("Juan Pérez"),
      contexto("Luisa Duque", ["gracias", "listo", "perfecto"])
    );
    expect(r.ok).toBe(true);
  });

  it("un valor en datos SIN procedencia no se toma como confirmado (la procedencia es la llave, no el valor)", () => {
    // Estado heredado con nombre pero sin procedencia: reafirmar un valor
    // distinto sin evidencia se rechaza.
    const sinProcedencia = { ...estadoVacio(), datos: { nombre: "Juan Pérez" } };
    const r = aplicarOperacion(
      sinProcedencia,
      fijarNombre("Carlos Ruiz"),
      contexto("Luisa Duque", ["dos por favor"])
    );
    expect(r.ok).toBe(false);
  });

  it("EL DETECTOR DETECTA: mismo 'Ana', destinataria rechaza / autoidentificada acepta", () => {
    const destinataria = aplicarOperacion(estadoVacio(), fijarNombre("Ana"), contexto("Luisa Duque", ["es para Ana"]));
    const ella = aplicarOperacion(estadoVacio(), fijarNombre("Ana"), contexto("Luisa Duque", ["soy Ana"]));
    expect(destinataria.ok).toBe(false);
    expect(ella.ok).toBe(true);
  });
});
