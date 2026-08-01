import { describe, expect, it } from "vitest";
import { esOrigenPermitido } from "@/server/whatsapp/media-origen";

/**
 * De dónde se acepta descargar un adjunto.
 *
 * La dirección viene DENTRO del evento del webhook y se descarga con la API
 * key de YCloud en la cabecera. Si se aceptara cualquier dirección, quien
 * lograra colar un evento con una URL suya recibiría esa clave en su servidor
 * — y con ella puede enviar WhatsApp a nombre del cliente y gastarle el saldo.
 */
describe("origen permitido para descargar adjuntos", () => {
  it("acepta el dominio real por el que llegan hoy los adjuntos", () => {
    expect(
      esOrigenPermitido("https://api.ycloud.com/v2/whatsapp/media/abc123")
    ).toBe(true);
  });

  it("acepta los dominios de Meta, que sirven los medios por Cloud API directa", () => {
    expect(esOrigenPermitido("https://lookaside.fbsbx.com/whatsapp/x")).toBe(true);
    expect(esOrigenPermitido("https://mmg.whatsapp.net/d/f/x.enc")).toBe(true);
  });

  it("acepta subdominios de un host permitido", () => {
    expect(esOrigenPermitido("https://cdn.api.ycloud.com/x.jpg")).toBe(true);
  });

  /**
   * El caso que hace inútil un filtro ingenuo: comprobar "termina en" en lugar
   * del host completo deja pasar un dominio del atacante que solo CONTIENE el
   * nombre legítimo.
   */
  it("rechaza un dominio que solo IMITA al permitido", () => {
    expect(esOrigenPermitido("https://api.ycloud.com.atacante.net/x")).toBe(false);
    expect(esOrigenPermitido("https://noapi.ycloud.com.evil.io/x")).toBe(false);
    expect(esOrigenPermitido("https://api-ycloud.com/x")).toBe(false);
  });

  it("rechaza cualquier otro servidor", () => {
    expect(esOrigenPermitido("https://atacante.net/roba.jpg")).toBe(false);
    expect(esOrigenPermitido("https://evil.com/api.ycloud.com/x")).toBe(false);
  });

  it("rechaza lo que no sea https", () => {
    expect(esOrigenPermitido("http://api.ycloud.com/x.jpg")).toBe(false);
    expect(esOrigenPermitido("file:///etc/passwd")).toBe(false);
    expect(esOrigenPermitido("ftp://api.ycloud.com/x")).toBe(false);
  });

  /** La red interna: el clásico para leer metadatos del servidor. */
  it("rechaza direcciones internas", () => {
    expect(esOrigenPermitido("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(esOrigenPermitido("https://localhost/x")).toBe(false);
    expect(esOrigenPermitido("https://172.16.1.1:3987/x")).toBe(false);
  });

  it("aguanta basura sin reventar", () => {
    expect(esOrigenPermitido("")).toBe(false);
    expect(esOrigenPermitido("no es una url")).toBe(false);
    expect(esOrigenPermitido("javascript:alert(1)")).toBe(false);
  });
});
