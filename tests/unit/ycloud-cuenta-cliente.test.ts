import { describe, expect, it } from "vitest";

/**
 * Un cliente puede traer su PROPIA cuenta de YCloud: así paga sus mensajes,
 * aporta su propio cupo de números y la agencia deja de tener techo de
 * clientes. Lo delicado es no confundir credenciales entre proveedores ni
 * entre negocios: mandar con la key equivocada sale por el número de otro.
 */

import { ycloudApiKeyOf } from "@/server/inbox/send";
import type { Credentials } from "@/server/whatsapp/credentials";

const credencial = (over: Partial<Credentials>): Credentials => ({
  id: "cred_1",
  organizationId: "org_1",
  wabaId: "waba_1",
  phoneNumberId: "ycloud:573155136091",
  displayPhoneNumber: "573155136091",
  verifiedName: "Negocio",
  status: "connected",
  token: "",
  webhookSecret: null,
  metaWabaId: null,
  ...over,
});

describe("de qué cuenta de YCloud sale cada cliente", () => {
  it("usa la key propia del cliente cuando trajo su cuenta", () => {
    const cred = credencial({ token: "sk_del_cliente" });
    expect(ycloudApiKeyOf(cred)).toBe("sk_del_cliente");
  });

  it("cae a la cuenta de la agencia cuando el cliente no tiene la suya", () => {
    expect(ycloudApiKeyOf(credencial({ token: "" }))).toBeUndefined();
    expect(ycloudApiKeyOf(credencial({ token: "   " }))).toBeUndefined();
  });

  it("JAMÁS toma el token de Meta como si fuera una key de YCloud", () => {
    // Con Meta directo el mismo campo guarda el token de Graph: usarlo como
    // X-API-Key contra YCloud sería mandar una credencial ajena a otro
    // proveedor.
    const meta = credencial({
      phoneNumberId: "109876543210987",
      token: "EAAG_token_de_graph",
    });
    expect(ycloudApiKeyOf(meta)).toBeUndefined();
  });

  it("no se deja engañar por un número que solo contiene 'ycloud'", () => {
    const raro = credencial({
      phoneNumberId: "123ycloud:456",
      token: "no_es_una_key",
    });
    expect(ycloudApiKeyOf(raro)).toBeUndefined();
  });
});
