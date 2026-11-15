import type { ReactNode } from 'react';

// Iconos de trazo fino propios (24x24, currentColor). Decorativos: el texto vecino los nombra.
function Base({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconoInicio = () => <Base><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /></Base>;
export const IconoPedidos = () => <Base><path d="M7 4h10a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1Z" /><path d="M9 9h6M9 13h4" /></Base>;
export const IconoInventario = () => <Base><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /><path d="M12 12v8" /></Base>;
export const IconoProveedores = () => <Base><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></Base>;
export const IconoSocios = () => <Base><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.4" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M15 15.2c.7-.3 1.4-.4 2-.4 2.2 0 3.8 1.2 4.3 3.7" /></Base>;
export const IconoOmar = () => <Base><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /></Base>;
export const IconoSol = () => <Base><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></Base>;
export const IconoLuna = () => <Base><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /></Base>;
export const IconoMenu = () => <Base><path d="M4 7h16M4 12h16M4 17h16" /></Base>;
export const IconoAjustes = () => <Base><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Base>;
export const IconoCatalogo = () => <Base><path d="M5 5h9l5 5v9H5z" /><path d="M14 5v5h5M9 14h6M9 17h4" /></Base>;
export const IconoClientes = () => <Base><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.7-3.6 3.2-5.5 6.5-5.5s5.8 1.9 6.5 5.5" /></Base>;
export const IconoContactos = () => <Base><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><circle cx="12" cy="10" r="2.4" /><path d="M8 17c.5-2 2-3 4-3s3.5 1 4 3" /></Base>;
export const IconoPaquete = () => <Base><path d="M4 8l8-4 8 4v8l-8 4-8-4V8Z" /><path d="M4 8l8 4 8-4M12 12v8M8 6l8 4" /></Base>;
export const IconoDropshipping = () => <Base><path d="M3 9l9-5 9 5v8l-9 4-9-4V9Z" /><path d="M3 9l9 5 9-5M12 14v7" /><path d="M16.5 6.5L7.5 11.5" /></Base>;
export const IconoDevolucion = () => <Base><path d="M9 7H5v4" /><path d="M5 11a7 7 0 1 1 2 6" /><path d="M12 9v4l2.5 1.5" /></Base>;
export const IconoTrayecto = () => <Base><path d="M3 12h13M12 7l5 5-5 5" /><path d="M19 6v12" /></Base>;
export const IconoCobrar = () => <Base><rect x="3.5" y="6" width="17" height="12" rx="2" /><circle cx="12" cy="12" r="2.4" /><path d="M7 9v.01M17 15v.01" /></Base>;
export const IconoAviso = () => <Base><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17Z" /><path d="M10 21h4" /></Base>;
export const IconoContabilidad = () => <Base><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h3M13 12h3M8 16h3M13 16h3" /></Base>;
export const IconoApertura = () => <Base><path d="M5 20V4" /><path d="M5 5h11l-2 3.5 2 3.5H5" /><path d="M9 20h10" /></Base>;
export const IconoMovimientos = () => <Base><path d="M4 8h13M14 5l3 3-3 3" /><path d="M20 16H7M10 13l-3 3 3 3" /></Base>;

export const IconoReportes = () => <Base><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h5" /></Base>;
export const IconoCostos = () => <Base><circle cx="12" cy="12" r="8" /><path d="M14.5 9.5c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.4.7-2.4 1.8 0 2.6 5 1.2 5 3.9 0 1.1-1.1 1.9-2.6 1.9-1.2 0-2.2-.5-2.7-1.4M12 6.5v1.8M12 15.7v1.8" /></Base>;

/** Glifo oficial de WhatsApp (24x24, relleno currentColor, monocromo): forma de simple-icons (CC0). Va en tinta del tema, nunca en el verde de marca, para respetar blanco y negro. Decorativo: el texto vecino lo nombra. */
export const IconoWhatsApp = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
);
