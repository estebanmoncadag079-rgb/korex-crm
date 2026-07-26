/**
 * Canvas de flujo de automatización del hero de la landing.
 *
 * Visual estático (Server Component, sin estado): entradas (canales) → núcleo
 * de IA → salidas (acciones/productos). Colores oscuros EXPLÍCITOS para que la
 * landing se vea igual sin depender de los tokens de tema del CRM.
 */

type Glyph =
  | "form"
  | "chat"
  | "web"
  | "app"
  | "code"
  | "instagram"
  | "messenger"
  | "mail"
  | "phone"
  | "clock"
  | "calendar"
  | "funnel";

function GlyphIcon({ kind, className }: { kind: Glyph; className?: string }) {
  const s = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "form":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case "chat":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.3-4.4A7.5 7.5 0 1 1 20 11.5Z" />
          <path d="M9 11h6M9 14h3.5" />
        </svg>
      );
    case "web":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 8.5h18" />
        </svg>
      );
    case "app":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <rect x="7" y="3" width="10" height="18" rx="2.5" />
          <path d="M10.5 18h3" />
        </svg>
      );
    case "code":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="16.6" cy="7.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "messenger":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <path d="M12 3.5c-4.7 0-8.5 3.4-8.5 7.7 0 2.4 1.1 4.6 3 6v3l2.8-1.5c.9.2 1.8.4 2.7.4 4.7 0 8.5-3.4 8.5-7.9S16.7 3.5 12 3.5Z" />
          <path d="m7.6 13.4 2.7-2.9 2 1.6 2.4-2.6" />
        </svg>
      );
    case "mail":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m4 7.5 8 5.5 8-5.5" />
        </svg>
      );
    case "phone":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <path d="M15.4 13.7c-1 .5-2.3-.1-3.6-1.4-1.3-1.3-1.9-2.6-1.4-3.6l1-1c.3-.3.3-.7.1-1L9.7 4.6c-.3-.5-.9-.6-1.4-.4-1 .5-1.9 1.4-2 2.5-.2 2 .9 4.9 3.4 7.4s5.4 3.6 7.4 3.4c1.1-.1 2-1 2.5-2 .2-.5.1-1.1-.4-1.4l-2.1-1.7c-.3-.2-.7-.2-1 .1Z" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M4 9.5h16M8.5 3v4M15.5 3v4" />
        </svg>
      );
    case "funnel":
      return (
        <svg viewBox="0 0 24 24" className={className} {...s}>
          <path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z" />
        </svg>
      );
  }
}

function HexBadge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 3 27 9.5V22.5L16 29 5 22.5V9.5Z" />
    </svg>
  );
}

function FlowChip({ icon, label }: { icon: Glyph; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 shadow-[0_2px_10px_-2px_rgba(0,0,0,0.5)]">
      <GlyphIcon kind={icon} className="h-4 w-4 shrink-0 text-white/70" />
      <span className="whitespace-nowrap text-[11px] font-medium text-white">
        {label}
      </span>
    </div>
  );
}

type FlowNode = { icon: Glyph; label: string; x: number; y: number };

// Entradas: canales y fuentes que llegan al núcleo de IA.
const FLOW_INPUTS: FlowNode[] = [
  { icon: "chat", label: "WhatsApp", x: 14, y: 14 },
  { icon: "instagram", label: "Instagram", x: 14, y: 28.4 },
  { icon: "mail", label: "Correo", x: 14, y: 42.8 },
  { icon: "messenger", label: "Messenger", x: 14, y: 57.2 },
  { icon: "form", label: "Formulario web", x: 14, y: 71.6 },
  { icon: "phone", label: "Llamadas", x: 14, y: 86 },
];

// Salidas: acciones automatizadas + productos a medida.
const FLOW_OUTPUTS: FlowNode[] = [
  { icon: "clock", label: "Respuestas 24/7", x: 86, y: 14 },
  { icon: "calendar", label: "Agenda de citas", x: 86, y: 28.4 },
  { icon: "funnel", label: "Seguimiento de leads", x: 86, y: 42.8 },
  { icon: "web", label: "Sitio web", x: 86, y: 57.2 },
  { icon: "app", label: "App móvil", x: 86, y: 71.6 },
  { icon: "code", label: "Software a medida", x: 86, y: 86 },
];

// Curvas auto-generadas: cada nodo se conecta al núcleo (50,50) con la misma
// forma de S, así los conectores quedan siempre alineados con su chip.
const FLOW_PATHS = [
  ...FLOW_INPUTS.map((n) => `M${n.x},${n.y} C${n.x + 18},${n.y} 34,50 50,50`),
  ...FLOW_OUTPUTS.map((n) => `M50,50 C66,50 ${n.x - 18},${n.y} ${n.x},${n.y}`),
];

const FLOW_KEYFRAMES = `
  @keyframes korexFlow { to { stroke-dashoffset: -18; } }
  .korex-flow { stroke-dasharray: 2 7; animation: korexFlow 1.1s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .korex-flow { animation: none; } }
`;

export function FlowCanvas() {
  return (
    <div className="relative">
      <div className="relative z-10 overflow-hidden rounded-t-xl border border-b-0 border-white/10 bg-white/[0.03]">
        <style dangerouslySetInnerHTML={{ __html: FLOW_KEYFRAMES }} />

        {/* Fondo punteado del canvas */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        {/* Encabezado del canvas */}
        <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-[#0e0e10]/70 px-3 py-1.5 backdrop-blur-sm">
          <HexBadge className="h-3.5 w-3.5 text-white/70" />
          <span className="text-[11px] font-medium text-white/80">
            Flujo de automatización
          </span>
        </div>
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-[#0e0e10]/70 px-3 py-1.5 backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white/70" />
          </span>
          <span className="text-[11px] font-medium text-white/70">En ejecución</span>
        </div>

        {/* Diagrama de escritorio */}
        <div className="hidden px-6 pb-24 pt-20 md:block">
          <div className="relative mx-auto h-[440px] max-w-[860px]">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              {FLOW_PATHS.map((d, i) => (
                <g key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke="white"
                    strokeOpacity={0.12}
                    strokeWidth={1.25}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke="white"
                    strokeOpacity={0.42}
                    strokeWidth={1.25}
                    vectorEffect="non-scaling-stroke"
                    className="korex-flow"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                </g>
              ))}
            </svg>

            {FLOW_INPUTS.map((n) => (
              <div
                key={n.label}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${n.x}%`, top: `${n.y}%` }}
              >
                <FlowChip icon={n.icon} label={n.label} />
              </div>
            ))}
            {FLOW_OUTPUTS.map((n) => (
              <div
                key={n.label}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${n.x}%`, top: `${n.y}%` }}
              >
                <FlowChip icon={n.icon} label={n.label} />
              </div>
            ))}

            {/* Núcleo de IA */}
            <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
              <div className="relative flex h-[78px] w-[78px] items-center justify-center rounded-2xl border border-white/25 bg-[#161619] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.6)]">
                <div className="pointer-events-none absolute -inset-2 animate-pulse rounded-3xl bg-white/[0.05]" />
                <HexBadge className="h-10 w-10 text-white/25" />
                <span className="absolute text-[16px] font-semibold tracking-tight text-white font-[family-name:var(--font-sora)]">
                  IA
                </span>
              </div>
              <span className="mt-2.5 whitespace-nowrap text-[11px] font-medium text-white/70">
                Automatización con IA
              </span>
            </div>
          </div>
        </div>

        {/* Diagrama móvil */}
        <div className="px-5 pb-24 pt-20 md:hidden">
          <div className="flex flex-wrap justify-center gap-2.5">
            {FLOW_INPUTS.map((n) => (
              <FlowChip key={n.label} icon={n.icon} label={n.label} />
            ))}
          </div>
          <div className="mx-auto my-3 h-7 w-px border-l border-dashed border-white/15" />
          <div className="flex flex-col items-center">
            <div className="relative flex h-[68px] w-[68px] items-center justify-center rounded-2xl border border-white/25 bg-[#161619] shadow-[0_6px_24px_-8px_rgba(0,0,0,0.6)]">
              <HexBadge className="h-9 w-9 text-white/25" />
              <span className="absolute text-[15px] font-semibold text-white font-[family-name:var(--font-sora)]">
                IA
              </span>
            </div>
            <span className="mt-2 text-[11px] font-medium text-white/70">
              Automatización con IA
            </span>
          </div>
          <div className="mx-auto my-3 h-7 w-px border-l border-dashed border-white/15" />
          <div className="grid grid-cols-2 gap-2">
            {FLOW_OUTPUTS.map((n) => (
              <div
                key={n.label}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-2.5 text-center"
              >
                <GlyphIcon kind={n.icon} className="h-4 w-4 text-white/70" />
                <span className="text-[11px] font-medium text-white">{n.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-[#0e0e10] to-transparent" />
      </div>
    </div>
  );
}
