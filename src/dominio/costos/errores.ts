// Errores tipados del dominio de costos.

export type CodigoErrorCostos =
  | 'monto_invalido'
  | 'porcentaje_invalido'
  | 'tipo_cambio_invalido'
  | 'sin_dato'
  | 'evidencia_requerida'
  | 'reembolso_invalido'
  | 'cargo_no_encontrado'
  | 'cargo_ya_anulado'
  | 'clave_idem_reutilizada'
  | 'asiento_descuadrado'
  | 'servicio_sin_metodo';

export class ErrorCostos extends Error {
  readonly codigo: CodigoErrorCostos;
  constructor(codigo: CodigoErrorCostos, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCostos';
    this.codigo = codigo;
  }
}
