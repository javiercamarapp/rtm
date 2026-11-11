// Errores tipados del inventario de proveedores. Los mensajes nunca incluyen la direccion de la fuente.

export type CodigoErrorProveedor =
  | 'importe_en_estado'
  | 'fuente_bloqueada'
  | 'presupuesto_agotado'
  | 'red'
  | 'tiempo_agotado'
  | 'configuracion'
  | 'robots_prohibe';

export class ErrorProveedor extends Error {
  readonly codigo: CodigoErrorProveedor;

  constructor(codigo: CodigoErrorProveedor, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorProveedor';
    this.codigo = codigo;
  }
}
