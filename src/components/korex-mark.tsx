/**
 * Marca korex.ia — hexágono tipo tuerca con hexágono interior.
 * SVG con `currentColor`, hereda el color del contenedor.
 */
export function KorexMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 130 130" className={className} fill="none" aria-hidden="true">
      <polygon
        points="65,8 118,38 118,92 65,122 12,92 12,38"
        fill="none"
        stroke="currentColor"
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <polygon points="65,34 96,52 96,78 65,96 34,78 34,52" fill="currentColor" />
    </svg>
  );
}
