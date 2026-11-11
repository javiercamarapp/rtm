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
export const IconoTrayecto = () => <Base><path d="M3 12h13M12 7l5 5-5 5" /><path d="M19 6v12" /></Base>;
export const IconoCobrar = () => <Base><rect x="3.5" y="6" width="17" height="12" rx="2" /><circle cx="12" cy="12" r="2.4" /><path d="M7 9v.01M17 15v.01" /></Base>;
export const IconoAviso = () => <Base><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17Z" /><path d="M10 21h4" /></Base>;
export const IconoContabilidad = () => <Base><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h3M13 12h3M8 16h3M13 16h3" /></Base>;
