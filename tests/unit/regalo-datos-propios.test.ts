import { describe, expect, it } from "vitest";
import { requisitosDe, type FichaDelNegocio } from "@/server/ai/generador/ficha";
import { generarPerfil } from "@/server/ai/generador/generar";
import { loQueFalta, requisitoSatisfecho } from "@/server/orders/extraer";
import { aplicarOperacion } from "@/server/orders/operaciones";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";

/**
 * Los datos del REGALO tienen su propio lugar (E2E del 26-sep-2026).
 *
 * No había dónde guardar a quién va el regalo ni el mensaje de la tarjeta, así
 * que el modelo improvisaba: en MALIA el nombre de quien recibía ("Marta")
 * REEMPLAZÓ al del cliente, y en Lis salió un lote con un dato sin
 * `requisitoId` que se descartó entero. Ahora, en los negocios que hacen
 * regalos (ficha con `regalos`), existen tres datos propios —quién recibe, su
 * celular y el mensaje de la tarjeta— que solo cuentan como pendientes cuando
 * el pedido ES un regalo. El cliente sigue siendo el cliente.
 */
const FICHA: FichaDelNegocio = {
  nombre: "Pastelería",
  queVende: "Postres",
  ubicacion: "Cali",
  horario: { dias: [1, 2, 3, 4, 5, 6], abre: "10:00", cierra: "19:00" },
  vertical: "pedidos",
  catalogo: "",
  entrega: { haceDomicilios: true, quienPagaElDomicilio: "Aparte", recogerEnLocal: "Sí" },
  pago: { formas: "transferencia", datosDeCuenta: "Banco 1", compruebaUnaPersona: true },
  tono: "cercano",
  regalos: "Sí, con tarjeta.",
  preguntasFrecuentes: [],
  escalarSiempre: [],
  nuncaPrometer: [],
  cierre: {
    requisitos: [
      { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
      { id: "telefono", tipo: "telefono", etiqueta: "el celular de contacto", obligatorio: true },
    ],
  },
};

const ids = (f: FichaDelNegocio) => (requisitosDe(f) ?? []).map((r) => r.id);

describe("los datos del regalo existen solo en negocios que hacen regalos", () => {
  it("con `regalos` en la ficha: quién recibe, su celular y el mensaje de la tarjeta", () => {
    expect(ids(FICHA)).toEqual(
      expect.arrayContaining(["destinatario", "telefonoDestinatario", "mensajeTarjeta"])
    );
  });

  it("sin `regalos`: no aparecen", () => {
    expect(ids({ ...FICHA, regalos: "" })).not.toContain("destinatario");
  });
});

describe("solo cuentan como pendientes cuando el pedido ES un regalo", () => {
  const destinatario = (requisitosDe(FICHA) ?? []).find((r) => r.id === "destinatario")!;
  const pedido = (extra: Partial<EstadoDelPedido> = {}): EstadoDelPedido => ({ ...estadoVacio(), ...extra });

  it("no es regalo → no hace falta (no bloquea el cierre)", () => {
    expect(requisitoSatisfecho(pedido({ paraRegalo: false }), destinatario)).toBe(true);
    expect(requisitoSatisfecho(pedido(), destinatario)).toBe(true);
  });

  it("es regalo y falta → pendiente", () => {
    expect(requisitoSatisfecho(pedido({ paraRegalo: true }), destinatario)).toBe(false);
  });

  it("es regalo y está → listo", () => {
    expect(requisitoSatisfecho(pedido({ paraRegalo: true, datos: { destinatario: "Ana López" } }), destinatario)).toBe(true);
  });

  it("'lo que falta' lo nombra solo si es regalo", () => {
    const reqs = requisitosDe(FICHA) ?? [];
    const conItem = (paraRegalo: boolean) =>
      pedido({
        paraRegalo,
        datos: { nombre: "Pedro", telefono: "3001112233" },
        procedenciaDelNombre: "cliente",
      });
    expect(loQueFalta(conItem(true), [], reqs).join(" ")).toMatch(/quien recibe/);
    expect(loQueFalta(conItem(false), [], reqs).join(" ")).not.toMatch(/quien recibe/);
  });
});

describe("se guardan aparte: quien recibe no reemplaza al cliente", () => {
  it("fijar_dato 'destinatario' se acepta y no toca el nombre del cliente", () => {
    const antes: EstadoDelPedido = {
      ...estadoVacio(),
      paraRegalo: true,
      datos: { nombre: "Pedro" },
      procedenciaDelNombre: "cliente",
    };
    const r = aplicarOperacion(
      antes,
      { tipo: "fijar_dato", requisitoId: "destinatario", valor: "Ana López" },
      {
        organizationId: "o",
        catalogo: [],
        requisitos: requisitosDe(FICHA) ?? [],
        modalidadesOfrecidas: ["domicilio", "recoger"],
        mensajeDelTurno: "recibe Ana López",
      }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estado.datos.destinatario).toBe("Ana López");
    expect(r.estado.datos.nombre).toBe("Pedro");
  });
});

describe("el prompt le dice al modelo dónde guardar los datos del regalo", () => {
  it("nombra los tres datos del regalo por su id", () => {
    const p = generarPerfil(FICHA).instructions;
    expect(p).toContain("destinatario");
    expect(p).toContain("telefonoDestinatario");
    expect(p).toContain("mensajeTarjeta");
  });

  it("sin regalos en la ficha, no los menciona", () => {
    expect(generarPerfil({ ...FICHA, regalos: "" }).instructions).not.toContain("telefonoDestinatario");
  });
});
