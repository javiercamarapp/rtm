// Tabla accion x rol (patron de vexa-ai). La unica fuente de verdad de quien puede que.
// Lo que un rol no puede ver no aparece en su interfaz (sin candados ni botones deshabilitados).

export type Rol = 'socio' | 'omar';

export const ACCIONES = [
  'ver_inicio',
  'ver_pedidos',
  'ver_inventario',
  'ver_proveedores',
  'ver_cuenta_socios',
  'ver_cuenta_omar',
] as const;
export type Accion = (typeof ACCIONES)[number];

export const CAPACIDADES: Record<Accion, readonly Rol[]> = {
  ver_inicio: ['socio'],
  ver_pedidos: ['socio'],
  ver_inventario: ['socio'],
  ver_proveedores: ['socio'],
  ver_cuenta_socios: ['socio'],
  ver_cuenta_omar: ['socio'],
};

export function puede(rol: Rol | null | undefined, accion: Accion): boolean {
  return !!rol && CAPACIDADES[accion].includes(rol);
}
