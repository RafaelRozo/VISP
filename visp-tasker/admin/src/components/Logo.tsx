type Props = { size?: number; className?: string };

/**
 * Logo de VISP: V dentro de un anillo abierto. Misma geometría que
 * `vispapp/src/components/visp/VispLogo.tsx` y `vispapp/assets/brand/*.svg`
 * (medida sobre el logo oficial, lienzo 1280). Usa `currentColor`: toma el
 * color del texto, así sirve en claro y en oscuro sin variantes.
 */
export default function Logo({ size = 36, className }: Props) {
  return (
    <svg
      viewBox="225 225 830 830"
      width={size}
      height={size}
      className={className}
      aria-label="VISP"
    >
      <circle cx="640" cy="640" r="390" fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={35} />
      <path d="M 640 250 A 390 390 0 1 1 307.8 844.4" fill="none" stroke="currentColor" strokeWidth={35} strokeLinecap="round" />
      <path
        d="M 453 453 L 519 453 Q 547 453 556 479.5 L 640 728 L 722.7 479.5 Q 731.5 453 759.5 453 L 826 453 L 710.3 780.8 Q 693.6 828 643.6 828 L 587 828 Z"
        fill="currentColor"
      />
    </svg>
  );
}
