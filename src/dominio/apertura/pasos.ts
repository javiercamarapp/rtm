// Los diez pasos del asistente de apertura (10b, 5.2, adaptado al alcance: la declaracion ciega y el conteo ciego quedan fuera de esta herramienta).
export interface PasoApertura {
  n: number;
  clave: string;
  titulo: string;
  texto: string;
  categorias: string[];
}

export const PASOS: readonly PasoApertura[] = [
  { n: 1, clave: 'alcance', titulo: 'Alcance y fecha de corte', texto: 'Fija la fecha de corte. Todo evento posterior es operación normal. El inventario no admite fechas anteriores al último movimiento de un modelo.', categorias: [] },
  { n: 2, clave: 'catalogo', titulo: 'Catálogo mínimo', texto: 'Cada modelo, sabor, cliente y proveedor que vas a cargar debe existir una sola vez en el catálogo. Aquí se revisa lo que hay.', categorias: [] },
  { n: 3, clave: 'socios', titulo: 'Aportaciones y gastos de los socios', texto: 'Capital que cada socio declara haber puesto y gastos que pagó de su bolsillo y se le reembolsan.', categorias: ['aportacion', 'reembolso_socio'] },
  { n: 4, clave: 'inventario', titulo: 'Inventario por modelo y sabor', texto: 'Piezas contadas al corte con su costo puesto unitario. Entran al kárdex como movimiento de apertura.', categorias: ['inventario'] },
  { n: 5, clave: 'caja', titulo: 'Caja y fondos en poder de cada socio', texto: 'Efectivo de la sociedad por persona y cobros de clientes que cayeron en la cuenta personal de un socio.', categorias: ['caja', 'fondos_en_poder'] },
  { n: 6, clave: 'cobrar', titulo: 'Cuentas por cobrar', texto: 'Saldo de cada cliente al corte con la fecha del adeudo.', categorias: ['cxc'] },
  { n: 7, clave: 'proveedores', titulo: 'Cuentas con Isaac y Karen', texto: 'Lo que se les debe y los saldos a favor de la sociedad (anticipos), cada proveedor por separado.', categorias: ['proveedor_debemos', 'proveedor_a_favor'] },
  { n: 8, clave: 'utilidades', titulo: 'Utilidades, retiros y deuda de Angelo', texto: 'Utilidades asignadas y no retiradas, retiros anteriores y las 12 piezas faltantes de la compra inicial, que son deuda de Angelo.', categorias: ['utilidad_no_repartida', 'retiro_previo', 'deuda_faltante_socio'] },
  { n: 9, clave: 'validar', titulo: 'Validación, vista previa y ensayo', texto: 'Activo = pasivo + capital. La diferencia se queda en la cuenta puente 3990. La vista previa y el ensayo no escriben nada.', categorias: [] },
  { n: 10, clave: 'firmar', titulo: 'Firma de los dos socios', texto: 'Firman Angelo y Javier sobre la misma huella del contenido. La segunda firma publica la apertura; se puede revertir con motivo.', categorias: [] },
] as const;

export function pasoPorNumero(n: number): PasoApertura | null {
  return PASOS.find((p) => p.n === n) ?? null;
}
