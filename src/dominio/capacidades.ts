// Tabla accion x rol (patron de vexa-ai). La unica fuente de verdad de quien puede que.
// Lo que un rol no puede ver no aparece en su interfaz (sin candados ni botones deshabilitados).

export type Rol = 'socio' | 'omar';

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
};

export function puede(rol: Rol | null | undefined, accion: Accion): boolean {
  return !!rol && CAPACIDADES[accion].includes(rol);
}
