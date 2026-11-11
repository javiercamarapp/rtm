import type { Balance, Comprobaciones, Diario, EstadoResultados, Flujo, ListaCuentas, Mayor, Periodos, Valuacion, VerificacionAsiento } from '@/dominio/contabilidad/tipos';

/** Lo que la web lee de contabilidad. Cada lectura es una funcion de la base; la interfaz no calcula dinero. */
export interface LectorContabilidad {
  diario(ini: string | null, fin: string | null, limite: number): Promise<Diario>;
  verificarAsiento(id: number): Promise<VerificacionAsiento>;
  cuentas(hasta: string | null): Promise<ListaCuentas>;
  mayor(cuenta: string, ini: string | null, fin: string | null): Promise<Mayor>;
  estadoResultados(ini: string, fin: string): Promise<EstadoResultados>;
  balance(hasta: string | null): Promise<Balance>;
  flujo(ini: string, fin: string): Promise<Flujo>;
  valuacion(hasta: string | null): Promise<Valuacion>;
  comprobaciones(): Promise<Comprobaciones>;
  periodos(): Promise<Periodos>;
}
