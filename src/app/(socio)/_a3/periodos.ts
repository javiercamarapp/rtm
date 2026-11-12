// Periodo anterior comparable (solo fechas, sin reloj): el mes anterior si el rango es un mes calendario completo; si no, el mismo numero de dias justo antes.
import { sumarDias } from '@/dominio/calendario';
import { mesAnterior, mesDe } from '@/dominio/contabilidad/rangos';
import { diasEntre } from '@/dominio/reportes/proyecciones';

export function periodoAnterior(ini: string, fin: string): { ini: string; fin: string } {
  const mes = mesDe(ini);
  if (ini === mes.ini && fin === mes.fin) return mesAnterior(ini);
  const n = diasEntre(ini, fin) + 1;
  const finAnt = sumarDias(ini, -1);
  return { ini: sumarDias(finAnt, -(n - 1)), fin: finAnt };
}
