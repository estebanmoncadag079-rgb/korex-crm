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

  it("un nombre DISTINTO del perfil se guarda sin mirar nada más", () => {
    // El caso normal: la clienta da el nombre del destinatario del regalo.
    const r = aplicarOperacion(
      estadoVacio(),
      fijarNombre("Ana"),
      contexto("Luisa Duque", ["es para Ana"])
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estado.datos.nombre).toBe("Ana");
  });

  it("sin nombre de perfil, la regla no se activa nunca", () => {
    const r = aplicarOperacion(estadoVacio(), fijarNombre("Luisa Duque"), contexto(null, []));
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
