// Plantillas puras y tareas programadas de reporte, con reloj simulado y un puerto falso. Datos sinteticos; no se envia nada.
import { describe, expect, it } from 'vitest';
import { textoPendientes, textoResumenDiario, type RepPendientes, type RepResumen } from '@/dominio/agente/reportes_programados';
import { ejecutarPendientes, ejecutarResumenDiario, type PuertoReportes } from '@/aplicacion/notificaciones/reportes_programados';

// Cifras sinteticas en centavos: lo que devolveria SQL. El texto debe reproducirlas al centavo.
const resumen: RepResumen = {
  hoy: '2026-11-16',
  ventas: { pedidos: 2, piezas: 30, facturado_cent: 123_456 },
  cobrado_cent: 2_000_000,
  por_cobrar_cent: 987_654,
  vencidos_cent: 150_000,
  por_pagar: { total_cent: 1_182_530, renglones: [
    { clave: 'isaac', etiqueta: 'Isaac', monto_cent: 765_432 }, { clave: 'karen', etiqueta: 'Karen', monto_cent: 321_098 }, { clave: 'renta_omar', etiqueta: 'Renta de Omar', monto_cent: 96_000 }] },
  valuacion: { socios: [{ socio: 'Angelo', valuacion_cent: 12_000_000 }, { socio: 'Javier', valuacion_cent: 11_000_050 }] },
  igualacion: { igualados: false, le_toca_aportar: 'Angelo', lleva_mas: 'Javier', diferencia_cent: 99_995 },
  fondos_en_poder: { total_cent: 222_200, socios: [{ socio: 'Angelo', cent: 222_200, dias: 2 }] },
  pedidos_enviados: [{ cliente: 'Cliente Sintetico', pedidos: 2, folios: ['CS-001', 'CS-002'], piezas: 30, modelos: [{ modelo: 'Modelo Uno', piezas: 20 }, { modelo: 'Modelo Dos', piezas: 10 }] }],
  concentracion: { mayor_bp: 5400, top: [{ cliente: 'Cliente Sintetico', bp: 5400 }], sobre_umbral: true, total_cent: 987_654 },
  margen: { minimo_bp: 500, pedidos: [{ folio: 'CS-002', cliente: 'Cliente Sintetico', margen_bp: 410 }] },
  libro: { rojas: [], total: 27 },
};

const pendientes: RepPendientes = {
  hoy: '2026-11-16',
  cartera: { dias: 3,
    vencidos: [{ cliente: 'Cliente Uno', saldo_cent: 1_799_000, pedidos: 2, dias_atraso_max: 3 }],
    vencen_manana: [{ cliente: 'Cliente Dos', saldo_cent: 250_000, pedidos: 1 }],
    proximos: [{ cliente: 'Cliente Dos', saldo_cent: 250_000, pedidos: 1, vence: '2026-11-17' }, { cliente: 'Cliente Tres', saldo_cent: 100_000, pedidos: 1, vence: '2026-11-19' }],
    sin_plazo_cent: 0 },
  proveedores: { dias: 3, proveedores: [
    { proveedor: 'Isaac', plazo_dias: 7, deuda_cent: 987_654, vencido_cent: 0, proximo_cent: 500_000, proximo_vence: '2026-11-19', sin_fecha_cent: 0 },
    { proveedor: 'Karen', plazo_dias: 10, deuda_cent: 0, vencido_cent: 0, proximo_cent: 0, proximo_vence: null, sin_fecha_cent: 0 }] },
  liquidez: { pagable_cent: 987_654, cobrable_cent: 1_100_000, cobertura_centesimas: 118, fecha_pago: '2026-11-19', bajo_uno: false },
  tareas: { avisos_con_accion: 2, diferencias_abiertas: 1, tomas_omar_pendientes: 0 },
};

describe('plantillas puras', () => {
  it('el resumen reproduce las cifras del servidor al centavo', () => {
    const t = textoResumenDiario(resumen);
    for (const s of ['$1,234.56', '$20,000.00', '$9,876.54', '$1,500.00', '$11,825.30', '$7,654.32', '$3,210.98', '$2,222.00', '$999.95']) expect(t, s).toContain(s);
  });
  it('agrupa pedidos enviados por cliente y modelo, en mayusculas', () => {
    const t = textoResumenDiario(resumen);
    expect(t).toContain('- CLIENTE SINTETICO: 2 pedidos (CS-001, CS-002), 30 piezas: 20 MODELO UNO, 10 MODELO DOS.');
    expect(t).not.toContain('Cliente Sintetico');
  });
  it('trae la linea de concentracion, el margen bajo y el libro', () => {
    const t = textoResumenDiario(resumen);
    expect(t).toContain('Concentracion: CLIENTE SINTETICO es el 54.00 por ciento de la cartera (arriba del limite).');
    expect(t).toContain('Margen menor a 5.00 por ciento: CS-002 4.10.');
    expect(t).toContain('Libro: cuadra.');
    expect(textoResumenDiario({ ...resumen, libro: { rojas: ['C7'], total: 27 } })).toContain('Libro: NO cuadra (C7).');
  });
  it('sin ventas ni pedidos el resumen sigue completo', () => {
    const t = textoResumenDiario({ ...resumen, ventas: { pedidos: 0, piezas: 0, facturado_cent: 0 }, pedidos_enviados: [], fondos_en_poder: { total_cent: 0, socios: [] }, igualacion: { igualados: true, le_toca_aportar: null, lleva_mas: null, diferencia_cent: 0 } });
    expect(t).toContain('Ventas del dia: 0 pedidos, 0 piezas, $0.00.');
    expect(t).toContain('Pedidos enviados: ninguno.');
    expect(t).toContain('los socios estan igualados');
  });
  it('sin emojis ni caracteres fuera de texto normal y de maximo 12 lineas utiles', () => {
    const t = textoResumenDiario(resumen);
    expect(/\p{Extended_Pictographic}/u.test(t)).toBe(false);
    expect(t.split('\n').length).toBeLessThanOrEqual(16);
  });
  it('el resumen no lleva contactos ni datos de dueno de cliente', () => {
    const t = textoResumenDiario(resumen);
    expect(/\d{10}|@/.test(t)).toBe(false);
  });
  it('los pendientes listan vencidos, manana, proximos, proveedores, cobertura y tareas', () => {
    const t = textoPendientes(pendientes);
    expect(t).toContain('Vencidos: CLIENTE UNO $17,990.00 (3 dias de atraso).');
    expect(t).toContain('Vencen manana: CLIENTE DOS $2,500.00.');
    expect(t).toContain('CLIENTE TRES $1,000.00 (19-11)');
    expect(t).toContain('Pago a Isaac (plazo 7 dias): debemos $9,876.54; $5,000.00 vence el 19-11.');
    expect(t).not.toContain('Pago a Karen');
    expect(t).toContain('Cobertura de pagos a proveedores: 1.18;');
    expect(t).toContain('Tareas abiertas: 2 avisos con accion, 1 diferencia de recepcion abierta.');
  });
  it('sin nada accionable lo dice en una linea', () => {
    const t = textoPendientes({ ...pendientes, cartera: { dias: 3, vencidos: [], vencen_manana: [], proximos: [], sin_plazo_cent: 0 }, proveedores: { dias: 3, proveedores: [] }, liquidez: { ...pendientes.liquidez, cobertura_centesimas: null }, tareas: { avisos_con_accion: 0, diferencias_abiertas: 0, tomas_omar_pendientes: 0 } });
    expect(t).toBe('Pendientes del 16-11\nNada pendiente para hoy.');
  });
  it('cobertura menor a uno se rotula', () => {
    expect(textoPendientes({ ...pendientes, liquidez: { ...pendientes.liquidez, cobertura_centesimas: 54, bajo_uno: true } })).toContain('0.54 (menor a 1.00)');
  });
});

class PuertoFalso implements PuertoReportes {
  emitidos: { regla: string; clave: string; texto: string; ahora: Date }[] = [];
  constructor(private readonly encendidas: Set<string>) {}
  async cifrasResumen(): Promise<RepResumen> { return resumen; }
  async cifrasPendientes(): Promise<RepPendientes> { return pendientes; }
  async emitir(e: { regla: string; clave: string; severidad: 'C' | 'I' | 'F'; titulo: string; texto: string; ahora: Date }): Promise<{ estado: string }> {
    if (!this.encendidas.has(e.regla)) return { estado: 'apagada' };
    if (this.emitidos.some((x) => x.clave === e.clave)) return { estado: 'duplicado' };
    this.emitidos.push(e);
    return { estado: 'emitido' };
  }
}

describe('tareas programadas con reloj simulado', () => {
  // 20:00 de Merida del 16-nov es las 02:00 UTC del 17-nov; 09:00 de Merida es las 15:00 UTC.
  const a20 = (dia: number) => new Date(Date.UTC(2026, 10, dia + 1, 2, 0, 0));
  const a09 = (dia: number) => new Date(Date.UTC(2026, 10, dia, 15, 0, 0));

  it('con la regla apagada no emite nada', async () => {
    const p = new PuertoFalso(new Set());
    expect(await ejecutarResumenDiario(p, a20(16))).toEqual({ estado: 'omitida', detalle: 'apagada' });
    expect(await ejecutarPendientes(p, a09(16))).toEqual({ estado: 'omitida', detalle: 'apagada' });
    expect(p.emitidos).toHaveLength(0);
  });

  it('encendida emite una vez por dia con clave estable de la fecha de Merida (no de UTC)', async () => {
    const p = new PuertoFalso(new Set(['resumen_diario', 'pendientes_diarios']));
    for (const dia of [16, 17, 18]) {
      expect((await ejecutarResumenDiario(p, a20(dia))).estado).toBe('ok');
      expect((await ejecutarPendientes(p, a09(dia))).estado).toBe('ok');
    }
    expect(p.emitidos.map((e) => e.clave)).toEqual(['resumen:2026-11-16', 'pendientes:2026-11-16', 'resumen:2026-11-17', 'pendientes:2026-11-17', 'resumen:2026-11-18', 'pendientes:2026-11-18']);
  });

  it('repetir la tarea el mismo dia no duplica', async () => {
    const p = new PuertoFalso(new Set(['resumen_diario']));
    await ejecutarResumenDiario(p, a20(16));
    const r = await ejecutarResumenDiario(p, new Date(a20(16).getTime() + 5 * 60_000));
    expect(r).toEqual({ estado: 'omitida', detalle: 'duplicado' });
    expect(p.emitidos).toHaveLength(1);
  });
});
