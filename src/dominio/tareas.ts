// Expresiones cron de cinco campos (minuto hora dia mes dia-de-semana) evaluadas en UTC. Admite `*`, listas, rangos y pasos (`*/5`, `1-5/2`).
// Mérida es UTC-6 fijo: cada tarea declara su hora local y su expresion en UTC; una prueba comprueba que coinciden.

function campo(texto: string, min: number, max: number): Set<number> {
  const valores = new Set<number>();
  for (const parte of texto.split(',')) {
    const [rango, paso] = parte.split('/');
    const salto = paso === undefined ? 1 : Number(paso);
    if (!Number.isInteger(salto) || salto < 1) throw new RangeError(`paso invalido en ${texto}`);
    let desde = min;
    let hasta = max;
    if (rango !== '*') {
      const [a, b] = rango!.split('-');
      desde = Number(a);
      hasta = b === undefined ? (paso === undefined ? desde : max) : Number(b);
    }
    if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < min || hasta > max || desde > hasta) throw new RangeError(`campo cron invalido: ${texto}`);
    for (let v = desde; v <= hasta; v += salto) valores.add(v);
  }
  return valores;
}

export interface Cron {
  minutos: Set<number>;
  horas: Set<number>;
  dias: Set<number>;
  meses: Set<number>;
  semana: Set<number>;
  diaLibre: boolean;
  semanaLibre: boolean;
}

export function parsearCron(expr: string): Cron {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) throw new RangeError(`cron de cinco campos: ${expr}`);
  const semana = campo(p[4]!, 0, 7);
  if (semana.has(7)) semana.add(0);
  return { minutos: campo(p[0]!, 0, 59), horas: campo(p[1]!, 0, 23), dias: campo(p[2]!, 1, 31), meses: campo(p[3]!, 1, 12), semana, diaLibre: p[2] === '*', semanaLibre: p[4] === '*' };
}

/** Verdadero si el minuto UTC de `fecha` cae en la expresion. Dia y dia de semana siguen la regla clasica (si ambos estan fijados basta uno). */
export function coincide(c: Cron, fecha: Date): boolean {
  if (!c.minutos.has(fecha.getUTCMinutes()) || !c.horas.has(fecha.getUTCHours()) || !c.meses.has(fecha.getUTCMonth() + 1)) return false;
  const dia = c.dias.has(fecha.getUTCDate());
  const sem = c.semana.has(fecha.getUTCDay());
  if (c.diaLibre && c.semanaLibre) return true;
  if (c.diaLibre) return sem;
  if (c.semanaLibre) return dia;
  return dia || sem;
}

/** Ventanas (minutos UTC, ISO) de una tarea dentro de (desde, hasta]. Pensado para el latido de 5 minutos: nunca mas de unas decenas de minutos. */
export function ventanasDebidas(expr: string, desde: Date, hasta: Date): string[] {
  const c = parsearCron(expr);
  const salida: string[] = [];
  const ini = Math.floor(desde.getTime() / 60_000) + 1;
  const fin = Math.floor(hasta.getTime() / 60_000);
  for (let m = ini; m <= fin && m - ini < 1_500; m++) {
    const f = new Date(m * 60_000);
    if (coincide(c, f)) salida.push(f.toISOString().slice(0, 16));
  }
  return salida;
}

/** Pasa una expresion en hora de Merida (UTC-6) a UTC desplazando solo hora (y dia de semana si cruza la medianoche) para expresiones de hora fija. */
export function horaLocalAUtc(hora: number, minuto: number): { hora: number; minuto: number; sumaDia: boolean } {
  const h = hora + 6;
  return { hora: h % 24, minuto, sumaDia: h >= 24 };
}
