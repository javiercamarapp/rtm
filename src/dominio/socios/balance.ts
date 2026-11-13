// Renglones del capital contable POR SOCIO para el Balance (decision del dueno: excepcion deliberada a no dividir por duenio; es contabilidad de capital de los socios).
// No recalcula: toma de api.cuenta_socios_valuacion las mismas cifras de /socios. Los fondos de la sociedad en poder del socio se muestran como memorando que resta, como los trata el libro (activo 1150/1160).
import type { CuentaSociosValuacion, Socio } from './valuacion';

export interface FilaCapitalSocio {
  clave: string;
  etiqueta: string;
  monto_cent: bigint;
  nivel: 'rubro' | 'subtotal' | 'memo' | 'total';
  /** Renglon que resta de la valuacion (se muestra con signo menos). */
  resta: boolean;
  /** Identificador para Explicar este numero, si la base sabe explicarlo. */
  cifra?: string;
}

export function filasCapitalPorSocio(c: CuentaSociosValuacion, yo: Socio | null): FilaCapitalSocio[] {
  const filas: FilaCapitalSocio[] = [];
  for (const nombre of ['Angelo', 'Javier'] as const) {
    const f = c.socios.find((s) => s.socio === nombre);
    if (!f) continue;
    filas.push({ clave: `cap-${nombre}`, etiqueta: `Capital aportado - ${nombre}`, monto_cent: f.capital_aportado_cent, nivel: 'rubro', resta: false, cifra: `historial:invertido:${nombre}` });
    filas.push({ clave: `util-${nombre}`, etiqueta: `Utilidades acumuladas - ${nombre}`, monto_cent: f.utilidades_acumuladas_cent, nivel: 'rubro', resta: false, cifra: `historial:utilidad:${nombre}` });
    filas.push({ clave: `ret-${nombre}`, etiqueta: `Retiros - ${nombre}`, monto_cent: -f.retirado_cent, nivel: 'rubro', resta: true, cifra: `historial:retirado:${nombre}` });
    filas.push({ clave: `sub-${nombre}`, etiqueta: `Capital contable de ${nombre}${nombre === yo ? ' (tú)' : ''}`, monto_cent: f.subtotal_cent, nivel: 'subtotal', resta: false });
    if (f.fondos_en_poder_cent > 0n) {
      filas.push({ clave: `fondos-${nombre}`, etiqueta: `Fondos de la sociedad en poder de ${nombre} (memorando, resta)`, monto_cent: -f.fondos_en_poder_cent, nivel: 'memo', resta: true, cifra: `socio:fondos:${nombre}` });
      filas.push({ clave: `val-${nombre}`, etiqueta: `Valuación personal de ${nombre}`, monto_cent: f.valuacion_cent, nivel: 'subtotal', resta: false, cifra: `historial:valor:${nombre}` });
    }
  }
  filas.push({ clave: 'suma', etiqueta: 'Suma por socio = capital contable del libro', monto_cent: c.total.subtotal_cent, nivel: 'total', resta: false });
  return filas;
}
