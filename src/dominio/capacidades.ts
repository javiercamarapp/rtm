// Tabla accion x rol (patron de vexa-ai). La unica fuente de verdad de quien puede que.
// Lo que un rol no puede ver no aparece en su interfaz (sin candados ni botones deshabilitados).

export type Rol = 'socio' | 'omar' | 'bodega';

export const ACCIONES = [
  'ver_inicio',
  'ver_pedidos',
  'ver_catalogo',
  'ver_clientes',
  'cambiar_disponibilidad',
  'ver_inventario',
  'ver_proveedores',
  'ver_cuenta_socios',
  'ver_cuenta_omar',
  'ver_paquetes',
  'ver_cuentas_por_cobrar',
  'ver_avisos',
  'operar_pedidos',
  'operar_compras',
  'operar_pagos',
  'gestionar_cuentas',
] as const;
export type Accion = (typeof ACCIONES)[number];

export const CAPACIDADES: Record<Accion, readonly Rol[]> = {
  ver_inicio: ['socio'],
  ver_pedidos: ['socio'],
  ver_catalogo: ['socio'],
  ver_clientes: ['socio'],
  cambiar_disponibilidad: ['socio'],
  ver_inventario: ['socio'],
  ver_proveedores: ['socio'],
  ver_cuenta_socios: ['socio'],
  ver_cuenta_omar: ['socio'],
  ver_paquetes: ['socio'],
  ver_cuentas_por_cobrar: ['socio'],
  ver_avisos: ['socio'],
  operar_pedidos: ['socio'],
  operar_compras: ['socio'],
  operar_pagos: ['socio'],
  // Dar de alta, desactivar y reactivar cuentas de bodega por correo: solo un socio.
  gestionar_cuentas: ['socio'],
};

export function puede(rol: Rol | null | undefined, accion: Accion): boolean {
  return !!rol && CAPACIDADES[accion].includes(rol);
}

// Acciones propias de la vista de Omar. Solo el rol `omar` (y solo si su cuenta esta activa) las tiene; un socio no las usa desde aqui.
export const ACCIONES_OMAR = ['omar_ver_bodega', 'omar_solicitar_piezas', 'omar_ver_cuenta', 'omar_ver_paquetes'] as const;
export type AccionOmar = (typeof ACCIONES_OMAR)[number];
export const CAPACIDADES_OMAR: Record<AccionOmar, readonly Rol[]> = {
  omar_ver_bodega: ['omar'],
  omar_solicitar_piezas: ['omar'],
  omar_ver_cuenta: ['omar'],
  omar_ver_paquetes: ['omar'],
};

/** `activo` es el interruptor de la cuenta (seguridad.usuario.activo): desactivada, Omar no puede nada. */
export function puedeOmar(rol: Rol | null | undefined, activo: boolean | null | undefined, accion: AccionOmar): boolean {
  return activo === true && !!rol && CAPACIDADES_OMAR[accion].includes(rol);
}

// Acciones propias de la vista de bodega (solo lectura). Solo el rol `bodega` activo las tiene; un socio las ve como vista previa desde su propia sesion.
export const ACCIONES_BODEGA = ['bodega_ver_hoy', 'bodega_ver_llegadas'] as const;
export type AccionBodega = (typeof ACCIONES_BODEGA)[number];
export const CAPACIDADES_BODEGA: Record<AccionBodega, readonly Rol[]> = {
  bodega_ver_hoy: ['bodega'],
  bodega_ver_llegadas: ['bodega'],
};

export function puedeBodega(rol: Rol | null | undefined, activo: boolean | null | undefined, accion: AccionBodega): boolean {
  return activo === true && !!rol && CAPACIDADES_BODEGA[accion].includes(rol);
}
