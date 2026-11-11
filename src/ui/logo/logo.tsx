import { useId } from 'react';
import { MARCA } from '@/config/marca';

// Logo de RTM dibujado por codigo (SVG, sin imagenes). Marca: cuadrado de tinta con una "R" recortada;
// y el nombre en trazos finos. Todo con currentColor: sigue al tema (claro/oscuro) sin cambiar de archivo.

interface PropsMarca {
  /** Alto en px; el ancho sale de la proporcion. */
  alto?: number;
  className?: string;
}

/** Solo la marca (cuadrado con "R"), para espacios reducidos. Decorativa si va junto al nombre. */
export function LogoMarca({ alto = 24, className, titulo }: PropsMarca & { titulo?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      width={alto}
      height={alto}
      className={className}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
      focusable="false"
    >
      <defs>
        <mask id={`${id}-r`}>
          <rect width="24" height="24" fill="white" />
          <path d="M8 17.5V6.5H12.75a2.9 2.9 0 0 1 0 5.8H8M12.2 12.3L15.8 17.5" fill="none" stroke="black" strokeWidth="1.9" strokeLinejoin="miter" />
        </mask>
      </defs>
      <rect width="24" height="24" rx="7" fill="currentColor" mask={`url(#${id}-r)`} />
    </svg>
  );
}

/** Logo completo: marca y nombre. */
export function Logo({ alto = 24, className }: PropsMarca) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 80 24"
      height={alto}
      width={(alto * 80) / 24}
      className={className}
      role="img"
      aria-label={MARCA.nombre}
      focusable="false"
    >
      <defs>
        <mask id={`${id}-r`}>
          <rect width="24" height="24" fill="white" />
          <path d="M8 17.5V6.5H12.75a2.9 2.9 0 0 1 0 5.8H8M12.2 12.3L15.8 17.5" fill="none" stroke="black" strokeWidth="1.9" strokeLinejoin="miter" />
        </mask>
      </defs>
      <rect width="24" height="24" rx="7" fill="currentColor" mask={`url(#${id}-r)`} />
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="miter">
        <path d="M32 18V6H38a3.5 3.5 0 0 1 0 7H32M37.4 13L42 18" />
        <path d="M46.5 6H57M51.75 6V18" />
        <path d="M62 18V6L69 14L76 6V18" />
      </g>
    </svg>
  );
}
