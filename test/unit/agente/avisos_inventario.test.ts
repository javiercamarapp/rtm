// Avisos de inventario con RELOJ SIMULADO y TRANSPORTE FALSO (nada sale a Telegram) y conversaciones de /vende, /reponer, /minimo y /avisos con el agente en memoria.
import { describe, expect, it } from 'vitest';
import { ejecutarRelojAvisos, type TransporteGrupo } from '@/aplicacion/agente/avisos_inventario';
import { redactarMensaje, ventanasDelMomento, type ItemAviso } from '@/dominio/agente/avisos_inventario';
import { PuertoAvisosInventarioMemoria } from '@/infra/agente/avisos_inventario_memoria';
import { escenario } from './ayudas';

// Instantes en hora de Merida (UTC-6): lunes 16-nov-2026.
const merida = (d: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, d, h + 6, m));

class Falso implements TransporteGrupo {
  enviados: string[] = [];
  falla = false;
  async aGrupo(texto: string): Promise<boolean> {
    if (this.falla) return false;
    this.enviados.push(texto);
    return true;
  }
}

const SIN_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('ventanas del reloj (hora de Merida)', () => {
  it('inmediatos siempre; pendientes a las 09; resumen a las 20; semanal el lunes a las 07', () => {
    expect(ventanasDelMomento(merida(16, 9, 15))).toEqual(['I', 'M']);
    expect(ventanasDelMomento(merida(16, 7, 5))).toEqual(['I', 'S']);
    expect(ventanasDelMomento(merida(17, 7, 5))).toEqual(['I']);
    expect(ventanasDelMomento(merida(16, 20, 0))).toEqual(['I', 'R']);
    expect(ventanasDelMomento(merida(16, 13, 0))).toEqual(['I']);
  });
});

describe('redaccion con plantillas', () => {
  const item = (id: number, codigo: string, canal: ItemAviso['canal'], payload: Record<string, unknown>): ItemAviso => ({ id, codigo, canal, severidad: 'I', payload });

  it('la reposicion se agrupa por modelo, en mayusculas, con transito y la etiqueta Estimado', () => {
    const t = redactarMensaje('M', [
      item(1, 'inv_reponer', 'M', { modelo: 'Nexa Ultra 50K', sabor: 'Miami Mint', disponible: 70, transito: 0, llega: null, minimo: 100, estado: 'estimado', dias: null }),
      item(2, 'inv_reponer', 'M', { modelo: 'Nexa Ultra 50K', sabor: 'Cool Mint', disponible: 8, transito: 30, llega: '2026-11-17', minimo: 40, estado: 'estimado', dias: null }),
    ])!;
    expect(t).toContain('Reposicion NEXA ULTRA 50K: MIAMI MINT 70 pz (minimo 100 pz), COOL MINT 8 pz (en camino 30 pz, llega 17/11/2026; minimo 40 pz).');
    expect(t).toContain('Estimado: todavia no hay 28 dias de historia');
    expect(t.startsWith('Pendientes de hoy')).toBe(true);
    expect(SIN_EMOJI.test(t)).toBe(false);
  });

  it('el cambio de costo dice sentido y porcentaje entero, nunca el importe del proveedor', () => {
    const t = redactarMensaje('I', [item(1, 'prv_costo', 'I', { modelo: 'Waka 15K', proveedor: 'Isaac', sentido: 'sube', pct: 7, clientes: 3, clientes_bajo_minimo: 2, peor_margen_pct: 3, margen_min_pct: 5 })])!;
    expect(t).toContain('sube cerca de 7 por ciento');
    expect(t).toContain('2 clientes quedan por debajo de 5 por ciento de margen');
    expect(t).toContain('no cambia costos ni precios solo');
    expect(t).not.toMatch(/\$\d/);
  });

  it('resumen de llegada: sabores nuevos, reposiciones cerradas y diferencias', () => {
    const t = redactarMensaje('I', [item(1, 'oc_llego', 'I', { folio: 'C-0002', proveedor: 'Isaac', recibidas: 529, facturadas: 529, parcial: false, sabores_nuevos: [{ modelo: 'Nexa Ultra 50K', sabor: 'Blue Wizard', piezas: 200 }], repone: ['Nexa Ultra 50K Cool Mint'], diferencias: 0 })])!;
    expect(t).toContain('Llego C-0002 (Isaac): 529 pz de 529 pz.');
    expect(t).toContain('1 sabor nuevo para el catalogo propio: NEXA ULTRA 50K BLUE WIZARD 200.');
    expect(t).toContain('Salen de reposicion: NEXA ULTRA 50K COOL MINT.');
    expect(t).toContain('Diferencias: ninguna.');
  });

  it('los pedidos pendientes se agrupan y el corte avisa cuantos faltan', () => {
    const t = redactarMensaje('M', [
      item(1, 'ped_pendiente_envio', 'M', { folio: 'LS-001', etapa: 'empacar', piezas: 40, horas: 6 }),
      item(2, 'ped_pendiente_envio', 'M', { folio: 'MG-002', etapa: 'empacar', piezas: 20, horas: 9 }),
      item(3, 'ped_guia_pendiente', 'M', { folio: 'LS-009', paqueteria: 'Castores', horas: 30 }),
    ], 4)!;
    expect(t).toContain('2 pedidos por empacar: LS-001 (40 pz, 6 h), MG-002 (20 pz, 9 h).');
    expect(t).toContain('1 pedido enviado sin guia: LS-009 (Castores).');
    expect(t).toContain('Y 4 avisos mas en el siguiente resumen.');
  });

  it('sin items no hay mensaje', () => {
    expect(redactarMensaje('M', [])).toBeNull();
  });
});

describe('reloj simulado de un dia completo con transporte falso', () => {
  it('inmediato de dia, pendientes a las 09, resumen a las 20; el silencio nocturno retiene y nada se manda dos veces', async () => {
    const p = new PuertoAvisosInventarioMemoria();
    const t = new Falso();
    const base = merida(16, 6, 0).getTime();
    p.encolar('oc_atraso', 'oc_atraso|1', 'I', { folio: 'C-0002', proveedor: 'Isaac', dias_atraso: 3, esperada: '2026-11-13', sin_fecha: false, valor_cent: 4761000, piezas: 529 }, base);
    p.encolar('inv_agotado', 'inv_agotado|9', 'M', { modelo: 'Nexa Ultra 50K', sabor: 'Cool Mint', vendidas_ventana: 20 }, base);
    p.encolar('prv_puente', 'prv_puente|5', 'R', { texto: 'Karen agoto 2 sabores de un modelo que no vendemos.' }, base);

    // 06:00: silencio nocturno (07 a 21 es el dia): el inmediato no critico espera.
    let r = await ejecutarRelojAvisos(p, t, merida(16, 6, 0));
    expect(r.enviados).toHaveLength(0);
    // 08:00: ya es dia: sale el inmediato (atraso).
    r = await ejecutarRelojAvisos(p, t, merida(16, 8, 0));
    expect(r.enviados.map((x) => x.ventana)).toEqual(['I']);
    expect(t.enviados[0]).toContain('C-0002 de Isaac lleva 3 dias de atraso (esperada el 13/11/2026). Valor pagado $47,610.00.');
    // 08:15: no se repite.
    r = await ejecutarRelojAvisos(p, t, merida(16, 8, 15));
    expect(r.enviados).toHaveLength(0);
    // 09:00: pendientes (el agotado).
    r = await ejecutarRelojAvisos(p, t, merida(16, 9, 0));
    expect(r.enviados.map((x) => x.ventana)).toEqual(['M']);
    expect(t.enviados[1]).toContain('Agotado: NEXA ULTRA 50K COOL MINT');
    // 20:00: resumen con lo no relevante.
    r = await ejecutarRelojAvisos(p, t, merida(16, 20, 0));
    expect(r.enviados.map((x) => x.ventana)).toEqual(['R']);
    expect(t.enviados).toHaveLength(3);
    expect(t.enviados.every((x) => !SIN_EMOJI.test(x))).toBe(true);
  });

  it('si el envio falla, el aviso queda pendiente y sale en la siguiente pasada', async () => {
    const p = new PuertoAvisosInventarioMemoria();
    const t = new Falso();
    p.encolar('cli_pago_dup', 'dup|1', 'I', { cliente: 'Cliente Uno', monto_cent: 100000, folio: 'PG-2', folio_previo: 'PG-1' }, merida(16, 10).getTime());
    t.falla = true;
    expect((await ejecutarRelojAvisos(p, t, merida(16, 10, 5))).enviados).toHaveLength(0);
    t.falla = false;
    const r = await ejecutarRelojAvisos(p, t, merida(16, 10, 20));
    expect(r.enviados).toHaveLength(1);
    expect(t.enviados[0]).toContain('Posible pago duplicado de Cliente Uno: $1,000.00 en PG-2 y en PG-1');
  });

  it('techo: 3 inmediatos al dia; el cuarto no sale suelto y se une al digest de las 09', async () => {
    const p = new PuertoAvisosInventarioMemoria();
    const t = new Falso();
    for (let i = 1; i <= 4; i++) {
      const base = merida(16, 8, i * 10).getTime();
      p.encolar('din_descuento', `dd|${i}`, 'I', { folio: `X-00${i}`, cliente: 'Cliente', pct: 8, descuento_cent: 1000 }, base);
      await ejecutarRelojAvisos(p, t, merida(16, 8, i * 10 + 1));
    }
    expect(t.enviados).toHaveLength(3);
    const r = await ejecutarRelojAvisos(p, t, merida(16, 9, 0));
    expect(r.enviados.map((x) => x.ventana)).toEqual(['M']);
    expect(t.enviados[3]).toContain('X-004');
  });

  it('todo apagado: el reloj no manda nada', async () => {
    const p = new PuertoAvisosInventarioMemoria();
    p.general = false;
    const t = new Falso();
    expect((await ejecutarRelojAvisos(p, t, merida(16, 9, 0))).apagado).toBe(true);
    expect(t.enviados).toHaveLength(0);
  });
});

describe('conversaciones con el bot', () => {
  const con = (p = new PuertoAvisosInventarioMemoria()) => ({ p, e: escenario([], { inventario: p }) });

  it('/minimo sin datos: pregunta modelo y sabor, luego piezas, y solo con todo registra y avisa al grupo', async () => {
    const { p, e } = con();
    await e.socio('angelo', '/minimo');
    expect(e.ultimoGrupo().texto).toBe('¿De qué modelo y sabor quieres fijar el mínimo? Por ejemplo: nexa mango 20.');
    await e.socio('angelo', 'nexa mango');
    expect(e.ultimoGrupo().texto).toBe('¿Cuántas piezas es el mínimo de NEXA MANGO? Escribe la cifra completa.');
    expect(p.minimos.size).toBe(0);
    await e.socio('angelo', '2k');
    expect(e.ultimoGrupo().texto).toContain('sin k ni mil');
    expect(p.minimos.size).toBe(0);
    await e.socio('angelo', '20');
    expect(p.minimos.get('nexa/mango')).toBe(20);
    const textos = e.textosGrupo().slice(-2);
    expect(textos[0]).toBe('Mínimo registrado: NEXA MANGO en 20 piezas.');
    expect(textos[1]).toContain('Angelo fijó el mínimo de NEXA MANGO en 20 piezas.');
  });

  it('/minimo con todos los datos registra de una vez y un cambio dice cuanto era antes', async () => {
    const { p, e } = con();
    await e.socio('javier', '/minimo nexa uva 15');
    await e.socio('javier', '/minimo nexa uva 25');
    expect(p.minimos.get('nexa/uva')).toBe(25);
    expect(e.ultimoGrupo().texto).toContain('(antes 15)');
  });

  it('un mensaje largo mientras hay una pregunta abierta NO se toma como respuesta', async () => {
    const { p, e } = con();
    await e.socio('angelo', '/minimo nexa');
    await e.socio('angelo', 'ok el pedido de Lupita fue de 24 mango y 10 uva');
    expect(p.minimos.size).toBe(0);
  });

  it('en solo lectura no escribe: el bot dice por que', async () => {
    const { p, e } = con();
    p.escritura = false;
    await e.socio('angelo', '/minimo nexa mango 20');
    expect(e.ultimoGrupo().texto).toContain('solo lectura');
    expect(p.minimos.size).toBe(0);
  });

  it('/vende y /reponer dan las cifras de SQL; tambien con frases naturales', async () => {
    const { p, e } = con();
    p.lineas.mas_vendido = [{ etiqueta: 'WAKA 15K', piezas: 992 }, { etiqueta: 'En Karen: WAKA 15K', texto: '14 de 20 sabores disponibles' }];
    p.lineas.reponer = [{ etiqueta: 'NEXA ULTRA 50K COOL MINT', texto: 'quedan 8 pz, en camino 30 pz, minimo 40 pz (estimado)' }];
    await e.socio('angelo', '/vende');
    expect(e.ultimoGrupo().texto).toBe('Lo que mas se vende (ultimos 28 dias)\n- WAKA 15K: 992 pz\n- En Karen: WAKA 15K: 14 de 20 sabores disponibles');
    await e.socio('javier', 'que reponer?');
    expect(e.ultimoGrupo().texto).toBe('Que reponer\n- NEXA ULTRA 50K COOL MINT: quedan 8 pz, en camino 30 pz, minimo 40 pz (estimado)');
  });

  it('/avisos enciende y apaga el general y cada regla; sin argumentos explica el uso', async () => {
    const { p, e } = con();
    p.general = false;
    await e.socio('angelo', '/avisos encender');
    expect(p.general).toBe(true);
    await e.socio('angelo', '/avisos regla inv_reponer encender');
    expect(p.reglasActivas.has('inv_reponer')).toBe(true);
    expect(e.ultimoGrupo().texto).toBe('Regla inv_reponer ENCENDIDA.');
    await e.socio('angelo', '/avisos apagar');
    expect(p.general).toBe(false);
    await e.socio('angelo', '/avisos');
    expect(e.ultimoGrupo().texto).toContain('Uso: /avisos');
  });

  it('Omar no usa estos comandos (no es socio) y el puerto no se toca', async () => {
    const { p, e } = con();
    await e.omar('/minimo nexa mango 99');
    expect(p.minimos.size).toBe(0);
  });
});
