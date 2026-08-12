import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { KorexMark } from "@/components/korex-mark";
import { FlowCanvas } from "@/components/landing/flow-canvas";

/**
 * Metadatos SEO propios de la portada.
 *
 * Se definen AQUÍ y no en el layout raíz a propósito: aquel lo comparten la
 * landing y el CRM, y además saca el nombre de `getBranding()` —la marca
 * white-label del cliente—, así que su título no es el de un sitio público.
 *
 * `canonical` es lo que resuelve el contenido duplicado: la misma aplicación
 * responde en korexia.online y en crm.korexia.online, y sin esta línea Google
 * ve dos sitios idénticos y reparte la autoridad entre los dos. Con ella, sabe
 * que el bueno es korexia.online.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://korexia.online"),
  title: "korex.ia — Automatización con IA, webs y apps a medida",
  description:
    "Diseñamos automatizaciones con IA, sitios web y aplicaciones a medida " +
    "para que tu negocio atienda al instante y venda más. Casos reales de " +
    "empresas que ya automatizan con nosotros.",
  alternates: { canonical: "https://korexia.online/" },
  openGraph: {
    type: "website",
    url: "https://korexia.online/",
    siteName: "korex.ia",
    locale: "es_CO",
    title: "korex.ia — Automatización con IA, webs y apps a medida",
    description:
      "Automatizaciones inteligentes, sitios web y aplicaciones que hacen " +
      "crecer tu empresa.",
  },
  twitter: {
    card: "summary_large_image",
    title: "korex.ia — Automatización con IA, webs y apps a medida",
    description:
      "Automatizaciones inteligentes, sitios web y aplicaciones que hacen " +
      "crecer tu empresa.",
  },
};

/**
 * Landing pública de korex.ia (ruta `/`).
 *
 * Server Component sin estado. Es una superficie OSCURA autocontenida: usa
 * colores explícitos (no depende de los tokens de tema del CRM, que es claro)
 * para verse igual aunque el resto de la app sea clara. No incluye toggle de
 * tema. Los CTAs abren WhatsApp; "Ingresar" va a /login.
 */

// Contacto por WhatsApp (Colombia +57)
const WHATSAPP_URL =
  "https://wa.me/573046838172?text=" +
  encodeURIComponent(
    "Hola korex.ia 🤖, quiero automatizar mi negocio, ¿me pueden brindar información?",
  );

type Feature = {
  title: string;
  desc: string;
  graphic: "bars" | "flow" | "chart";
};

const FEATURES: Feature[] = [
  {
    title: "Automatizaciones con IA",
    desc: "Flujos inteligentes que conectan tus herramientas, procesan datos y responden por ti. Recuperá horas cada semana.",
    graphic: "bars",
  },
  {
    title: "Sitios web a medida",
    desc: "Landing pages, corporativas y e-commerce diseñados para convertir. Rápidos, responsive y optimizados para SEO.",
    graphic: "flow",
  },
  {
    title: "Aplicaciones y software",
    desc: "Apps web y móviles construidas a la medida de tu operación. Integramos IA, pagos y datos donde suman valor real.",
    graphic: "chart",
  },
];

type Testimonio = {
  logo: string;
  name: string;
  servicio: string;
  resultado: string;
  imgClass: string;
};

const TESTIMONIOS: Testimonio[] = [
  {
    logo: "/testimonios/churra.png",
    name: "La Churra Churrería",
    servicio: "Automatización de WhatsApp",
    resultado:
      "Automatizamos la atención por WhatsApp de La Churra. Ahora responden al instante, no pierden clientes y venden el doble.",
    imgClass: "object-cover object-center",
  },
  {
    logo: "/testimonios/lis.png",
    name: "Lis Pastelería",
    servicio: "Automatización de WhatsApp",
    resultado:
      "Automatizamos el WhatsApp de Lis Pastelería para atender y tomar pedidos sin demoras, incluso fuera de horario.",
    imgClass: "object-cover object-center",
  },
  {
    logo: "/testimonios/alchili.png",
    name: "Alchili Gums",
    servicio: "Web + pedidos + panel admin",
    resultado:
      "Creamos la web de Alchili Gums: los clientes piden online y el pedido llega directo por WhatsApp, con panel de administración e inventario.",
    imgClass: "bg-white object-contain p-0.5",
  },
];

// Barra de hatch diagonal reutilizada como textura de fondo.
const DIAGONAL_HATCH =
  "repeating-linear-gradient(-45deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 1px, transparent 5px)";

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-white">
      <KorexMark className="h-[22px] w-[22px]" />
      <span className="text-[17px] font-bold tracking-tight font-[family-name:var(--font-manrope)]">
        korex<span className="text-white/50">.ia</span>
      </span>
    </span>
  );
}

export default function Home() {
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0e0e10] text-white font-[family-name:var(--font-manrope)]">
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#0e0e10]/90 px-6 backdrop-blur">
        <div className="mx-auto flex h-[56px] max-w-[1200px] items-center justify-between">
          <Link href="/" aria-label="korex.ia — inicio">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="inline-flex h-8 items-center px-3 text-[13px] font-medium text-white/80 transition-colors hover:text-white"
            >
              Ingresar
            </Link>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center border border-white/40 px-3 text-[13px] font-medium text-white transition-colors hover:bg-white hover:text-[#0e0e10]"
            >
              Contactar
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 overflow-hidden px-6 pt-16">
        <div className="relative mx-auto max-w-[1200px]">
          <div className="max-w-[640px] pb-16 pt-[52px]">
            <h1 className="max-w-[560px] text-[clamp(2rem,4vw,3.2rem)] font-semibold leading-[1.08] tracking-[-0.04em] text-white font-[family-name:var(--font-sora)]">
              Automatizaciones con IA, webs y apps que impulsan tu negocio
            </h1>
            <p className="mt-6 max-w-[440px] text-base leading-relaxed text-white/60">
              En korex.ia diseñamos y desarrollamos soluciones digitales a
              medida: automatizaciones inteligentes, sitios web y aplicaciones
              que hacen crecer tu empresa.
            </p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-10 inline-flex items-center gap-2 bg-white px-6 py-3 text-[14px] font-medium text-[#0e0e10] transition-colors hover:bg-white/90"
            >
              Solicitar propuesta
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Canvas de flujo (visual principal del hero) */}
          <FlowCanvas />
        </div>
      </section>

      {/* Divisor a todo el ancho */}
      <div className="relative z-10 w-full border-t border-white/10" />

      {/* Features */}
      <section className="relative z-10 overflow-hidden px-6 pb-24 pt-24">
        <div className="relative mx-auto max-w-[1200px]">
          <p className="mb-4 text-[13px] uppercase tracking-[0.15em] text-white/50">
            Qué hacemos
          </p>
          <h2 className="max-w-[500px] text-[clamp(1.8rem,3vw,2.5rem)] font-[500] leading-[1.15] tracking-[-0.03em] text-white font-[family-name:var(--font-sora)]">
            Menos tareas repetitivas.
            <br />
            Más resultados.
          </h2>

          <div className="mt-16 border border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-3">
              {FEATURES.map((feature, i) => (
                <div
                  key={feature.title}
                  className={`relative p-8 ${
                    i < 2 ? "border-white/10 md:border-r" : ""
                  } ${i > 0 ? "border-t border-white/10 md:border-t-0" : ""} ${
                    i === 1
                      ? "bg-gradient-to-b from-white/[0.04] to-transparent md:border-t-2 md:border-t-white/50"
                      : ""
                  }`}
                >
                  <div className="mb-6 flex h-32 items-center justify-center rounded-lg border border-white/10 bg-white/[0.02]">
                    <div className="w-full space-y-2 px-6">
                      {feature.graphic === "bars" && (
                        <>
                          {[
                            { w: "w-full", color: "bg-white/80" },
                            { w: "w-3/4", color: "bg-white/55" },
                            { w: "w-1/2", color: "bg-white/35" },
                            { w: "w-1/4", color: "bg-white/20" },
                          ].map((bar, j) => (
                            <div key={j} className="flex items-center gap-2">
                              <div
                                className={`h-2 ${bar.w} rounded-full ${bar.color}`}
                              />
                            </div>
                          ))}
                        </>
                      )}
                      {feature.graphic === "flow" && (
                        <div className="flex items-center justify-center px-2">
                          <div className="w-full max-w-[200px] overflow-hidden rounded-lg border border-white/10 bg-[#0e0e10]/90 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.5)]">
                            <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.03] px-3 py-2">
                              <div className="h-2 w-2 rounded-full bg-white/40" />
                              <div className="h-2 w-2 rounded-full bg-white/30" />
                              <div className="h-2 w-2 rounded-full bg-white/20" />
                              <div className="ml-auto h-1.5 w-14 rounded-full bg-white/10" />
                            </div>
                            <div className="space-y-2.5 p-3">
                              <div className="h-2 w-1/2 rounded-full bg-white/20" />
                              <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2 flex h-12 items-end rounded bg-gradient-to-br from-white/[0.14] to-white/[0.04] p-1.5">
                                  <div className="h-1.5 w-10 rounded-full bg-white/30" />
                                </div>
                                <div className="h-12 rounded bg-white/10" />
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-white/10" />
                              <div className="h-1.5 w-3/4 rounded-full bg-white/10" />
                              <div className="flex items-center gap-2 pt-1">
                                <div className="h-5 w-5 rounded-full bg-white/20" />
                                <div className="h-1.5 w-16 rounded-full bg-white/15" />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {feature.graphic === "chart" && (
                        <div className="flex h-16 items-end gap-1.5 px-2">
                          {[40, 65, 45, 80, 55, 70, 90].map((h, j) => (
                            <div
                              key={j}
                              className="relative flex-1 overflow-hidden rounded-t border border-white/10"
                              style={{ height: `${h}%` }}
                            >
                              <div
                                className="absolute inset-0"
                                style={{ backgroundImage: DIAGONAL_HATCH }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <h3 className="mb-2 text-[15px] font-medium text-white">
                    {feature.title}
                  </h3>
                  <p className="text-[13px] leading-[1.6] text-white/60">
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Divisor a todo el ancho */}
      <div className="relative z-10 w-full border-t border-white/10" />

      {/* Casos de éxito */}
      <section className="relative z-10 overflow-hidden px-6 py-24">
        {/* Textura de líneas diagonales de fondo */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-45deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 8px)",
          }}
        />
        <div className="relative mx-auto max-w-[1200px]">
          <p className="mb-4 text-[13px] uppercase tracking-[0.15em] text-white/50">
            Casos de éxito
          </p>
          <h2 className="max-w-[520px] text-[clamp(1.8rem,3vw,2.5rem)] font-[500] leading-[1.15] tracking-[-0.03em] text-white font-[family-name:var(--font-sora)]">
            Clientes que ya automatizan con nosotros
          </h2>

          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {TESTIMONIOS.map((caso) => (
              <article
                key={caso.name}
                className="flex flex-col border border-white/10 bg-white/[0.03] p-7"
              >
                <div className="flex items-center gap-3.5">
                  <Image
                    src={caso.logo}
                    alt={`Logo de ${caso.name}`}
                    width={48}
                    height={48}
                    className={`h-12 w-12 shrink-0 rounded-full ring-1 ring-white/15 ${caso.imgClass}`}
                  />
                  <h3 className="text-[15px] font-medium leading-tight text-white">
                    {caso.name}
                  </h3>
                </div>

                <span className="mt-5 inline-flex w-fit items-center rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/60">
                  {caso.servicio}
                </span>

                <p className="mt-4 text-[14px] leading-[1.6] text-white/80">
                  {caso.resultado}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Divisor a todo el ancho */}
      <div className="relative z-10 w-full border-t border-white/10" />

      {/* CTA */}
      <section className="relative z-10 overflow-hidden px-6 pb-40 pt-32">
        <div className="relative mx-auto max-w-[1200px] text-center">
          <h2 className="mx-auto max-w-[560px] text-[clamp(2rem,4vw,3.2rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-white font-[family-name:var(--font-sora)]">
            ¿Listo para llevar tu negocio al siguiente nivel?
          </h2>
          <p className="mx-auto mt-5 max-w-[400px] text-[15px] text-white/60">
            Contanos tu proyecto y te respondemos con una propuesta clara.
            <br />
            Sin compromiso, sin llamadas eternas.
          </p>
          <div className="mt-10 flex justify-center">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 border border-white/40 px-8 py-3.5 text-[15px] font-medium text-white transition-colors hover:border-white hover:bg-white hover:text-[#0e0e10]"
            >
              Empezar ahora
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-6">
          <Wordmark />
          <span className="text-[12px] text-white/50">© {year} korex.ia</span>
        </div>
      </div>
    </div>
  );
}
