// Conversaciones simuladas del carril bot/conversacion: por cada operacion, el mensaje del socio, las preguntas del bot, las respuestas, el registro y el mensaje final.
// Sin red: almacen en memoria, ejecutor falso y transporte falso. Decision del dueno (14-nov): sin tarjeta de confirmacion y sin topes; el bot pregunta lo que falte.
import { describe, expect, it } from 'vitest';
import { OPERACIONES, OPERACIONES_CONV, slotsFaltantes } from '@/dominio/agente/slots';
import { Sim, textoDe, valoresBotones, JAVIER, RESUMEN_EJEMPLO } from './conversacion_ayudas';

const MARCO = 'Pedido registrado en sistema con folio';

describe('pedido de bodega', () => {
  it('pregunta cliente homonimo, contado o credito, plazo y envio; registra solo con todo y arma el mensaje final con cifras de SQL', async () => {
    const s = new Sim({ saldoCliente: async (id) => (id === 'c1' ? 150000n : 0n) });
    let r = await s.instruccion('pedido_bodega', { cliente: 'Memo', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 24 }] }, 'Memo me pidio 24 nexa mango');
    expect(r.tipo).toBe('pregunta');
    expect(textoDe(r)).toContain('1. Memo Garcia (debe $1,500.00)');
    expect(textoDe(r)).toContain('2. Memo Lopez (sin saldo)');
    expect(valoresBotones(r)).toEqual(['elegir:1', 'elegir:2']);
    expect(s.ejecutor.operaciones).toHaveLength(0);
    r = await s.texto('1');
    expect(textoDe(r)).toBe('¿Es de contado o a crédito?');
    expect(valoresBotones(r)).toEqual(['op:contado', 'op:credito']);
    r = await s.boton('op:credito');
    expect(textoDe(r)).toContain('¿A cuántos días o semanas paga?');
    expect(s.ejecutor.operaciones).toHaveLength(0);
    r = await s.texto('2 semanas');
    expect(textoDe(r)).toContain('¿Cobras envío');
    expect(valoresBotones(r)).toEqual(['op:0']);
    r = await s.boton('op:0');
    expect(r.tipo).toBe('registrado');
    expect(textoDe(r)).toContain(MARCO);
    expect(textoDe(r)).toContain('NEXA ULTRA 50K / MANGO');
    expect(textoDe(r)).toContain('Plazo: a crédito, 15 días');
    expect(textoDe(r)).toContain('Deshacer disponible por 10 minutos.');
    const op = s.ejecutor.operaciones[0]!;
    expect(op.operacion).toBe('pedido_bodega');
    expect(op.slots).toMatchObject({ cliente: { id: 'c1' }, modalidad: 'credito', plazo: 14, envio: 0, lineas: [{ modeloId: 'm1', saborId: 's1', piezas: 24 }] });
  });

  it('de contado no pregunta plazo (plazo 0) y no hay tarjeta de confirmacion', async () => {
    const s = new Sim();
    let r = await s.instruccion('pedido_bodega', { cliente: 'Lupita', lineas: [{ modelo: 'nexa', sabor: 'sandia', piezas: 12 }], modalidad: 'contado', envio: 0 }, 'Lupita 12 nexa sandia de contado sin envio');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots).toMatchObject({ modalidad: 'contado', plazo: 0, envio: 0 });
    expect(s.enviados.join('\n')).not.toMatch(/Confirmar|Todavía no se registró/);
    r = await s.texto('hola');
    expect(r.tipo).toBe('sin_conversacion');
  });

  it('pregunta modelo, sabor y piezas faltantes, una cosa a la vez', async () => {
    const s = new Sim();
    let r = await s.instruccion('pedido_bodega', { cliente: 'Ariel', lineas: [{ modelo: 'nexa', sabor: null, piezas: null }], modalidad: 'contado', envio: 0 }, 'Ariel quiere nexa');
    expect(textoDe(r)).toContain('¿Qué sabor de NEXA ULTRA 50K?');
    expect(valoresBotones(r)).toEqual(['op:Mango', 'op:Sandia', 'op:Mora Azul']);
    r = await s.boton('op:Sandia');
    expect(textoDe(r)).toBe('¿Cuántas piezas de NEXA ULTRA 50K SANDIA? Escribe solo el número.');
    r = await s.texto('treinta');
    expect(textoDe(r)).toContain('Escribe solo el número');
    r = await s.texto('30');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.lineas).toEqual([{ modeloId: 'm1', modelo: 'Nexa Ultra 50K', saborId: 's2', sabor: 'Sandia', piezas: 30 }]);
  });

  it('modelo desconocido: pregunta y sugiere; no registra', async () => {
    const s = new Sim();
    const r = await s.instruccion('pedido_bodega', { cliente: 'Ariel', lineas: [{ modelo: 'nexaa', sabor: 'mango', piezas: 3 }], modalidad: 'contado', envio: 0 }, 'Ariel 3 nexaa mango');
    expect(textoDe(r)).toContain('no encontre modelo "nexaa"');
    expect(s.ejecutor.operaciones).toHaveLength(0);
  });

  it('varios destinos: pregunta a cual va', async () => {
    const s = new Sim({ destinosDe: async () => ['Centro', 'Norte'] });
    let r = await s.instruccion('pedido_bodega', { cliente: 'Ariel', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 3 }], modalidad: 'contado', envio: 0 }, 'Ariel 3 nexa mango sin envio');
    expect(textoDe(r)).toBe('¿A cuál destino va: Centro o Norte?');
    r = await s.boton('op:Norte');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.destino).toBe('Norte');
  });
});

describe('montos con k o mil', () => {
  it('repite la cifra y pregunta si son 20,000 antes de registrar; con si registra; sin tope', async () => {
    const s = new Sim();
    let r = await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 2000000, cuenta: 'efectivo' }, 'Ariel pago 20k en efectivo');
    expect(textoDe(r)).toBe('Entendí $20,000.00. ¿Son $20,000.00? Responde sí, o escribe la cifra completa (por ejemplo 12,500).');
    expect(s.ejecutor.operaciones).toHaveLength(0);
    r = await s.texto('si');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.monto).toBe(2000000);
  });

  it('con "no" vuelve a pedir la cifra completa; un monto grande (sin topes) se acepta cuando esta completo', async () => {
    const s = new Sim();
    let r = await s.instruccion('gasto', { tipo_gasto: 'uber', monto: 2000000, pagado_por: 'javier' }, 'gasto uber 20 mil javier');
    expect(textoDe(r)).toContain('¿Son $20,000.00?');
    r = await s.texto('no');
    expect(textoDe(r)).toContain('¿De cuánto fue? Escribe la cifra completa');
    r = await s.texto('5,000,000');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.monto).toBe(500000000);
  });

  it('una cifra con formato ambiguo se pide sin ambiguedad', async () => {
    const s = new Sim();
    await s.instruccion('gasto', { tipo_gasto: 'uber', pagado_por: 'javier' }, 'gasto uber');
    const r = await s.texto('1.250');
    expect(textoDe(r)).toContain('el monto sin ambigüedad');
  });

  it('una cifra que el extractor invento (no esta en el mensaje) se vuelve a preguntar', async () => {
    const s = new Sim();
    const r = await s.instruccion('gasto', { tipo_gasto: 'uber', monto: 99900, pagado_por: 'javier' }, 'gasto uber de javier');
    expect(textoDe(r)).toContain('¿De cuánto fue?');
  });
});

describe('correcciones, cancelar y mensajes que no son respuesta', () => {
  it('"no, era X" reescribe el ultimo dato; "cambia el monto a Y" reescribe el monto; "mejor a credito" cambia la modalidad sin reiniciar', async () => {
    const s = new Sim();
    let r = await s.instruccion('pedido_bodega', { cliente: 'Lupita', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 5 }], modalidad: 'contado' }, 'Lupita 5 nexa mango contado');
    expect(textoDe(r)).toContain('¿Cobras envío');
    r = await s.texto('mejor a credito');
    expect(textoDe(r)).toContain('¿A cuántos días');
    r = await s.texto('no, era 8 dias');
    expect(textoDe(r)).toContain('¿Cobras envío');
    r = await s.texto('cambia el cliente a Ariel');
    expect(textoDe(r)).toContain('¿Cobras envío');
    r = await s.boton('op:0');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots).toMatchObject({ cliente: { id: 'c4' }, modalidad: 'credito', plazo: 8, envio: 0 });
  });

  it('cambia el monto de un cobro ya preguntado', async () => {
    const s = new Sim();
    let r = await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 1250000 }, 'Ariel pago 12,500');
    expect(textoDe(r)).toContain('¿A qué cuenta entró el pago');
    r = await s.texto('cambia el monto a 11,000');
    expect(textoDe(r)).toContain('¿A qué cuenta entró el pago');
    r = await s.boton('op:javier');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots).toMatchObject({ monto: 1100000, cuenta: 'javier' });
  });

  it('cancelar no registra nada y libera el chat', async () => {
    const s = new Sim();
    await s.instruccion('cobro_cliente', { cliente: 'Ariel' }, 'cobro de Ariel');
    const r = await s.texto('cancela');
    expect(r.tipo).toBe('cancelada');
    expect(textoDe(r)).toContain('No registré nada');
    expect(s.ejecutor.operaciones).toHaveLength(0);
    expect((await s.texto('si')).tipo).toBe('sin_conversacion');
  });

  it('una instruccion nueva con pregunta abierta: pregunta si cancela la anterior; con si reemplaza; con no sigue con la anterior', async () => {
    const s = new Sim();
    await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 100000 }, 'Ariel pago 1,000');
    let r = await s.instruccion('gasto', { tipo_gasto: 'uber', monto: 30000, pagado_por: 'javier' }, 'gasto de uber 300 javier');
    expect(textoDe(r)).toContain('¿Cancelo lo anterior y empiezo con "Gasto"?');
    expect(valoresBotones(r)).toEqual(['reemplazar', 'seguir']);
    r = await s.boton('seguir');
    expect(textoDe(r)).toContain('Seguimos con lo anterior.');
    expect(textoDe(r)).toContain('¿A qué cuenta entró el pago');
    await s.instruccion('gasto', { tipo_gasto: 'uber', monto: 30000, pagado_por: 'javier' }, 'gasto de uber 300 javier');
    r = await s.boton('reemplazar');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones.map((o) => o.operacion)).toEqual(['gasto']);
  });

  it('un texto largo con palabras del negocio mientras hay una pregunta pendiente se trata como instruccion nueva (pregunta si cancela)', async () => {
    const s = new Sim();
    await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 100000 }, 'Ariel pago 1,000');
    let r = await s.texto('registra un gasto de uber de 300 pagado por javier');
    expect(textoDe(r)).toContain('¿Cancelo lo anterior y empiezo con lo nuevo?');
    r = await s.boton('reemplazar');
    expect(r).toEqual({ tipo: 'reprocesar', texto: 'registra un gasto de uber de 300 pagado por javier' });
  });

  it('una respuesta que no se entiende repite la pregunta sin avanzar', async () => {
    const s = new Sim();
    await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 100000 }, 'Ariel pago 1,000');
    const r = await s.texto('mmm');
    expect(textoDe(r)).toContain('No entendí');
  });

  it('a los 30 minutos de silencio la conversacion caduca y contestar avisa', async () => {
    const s = new Sim();
    await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 100000 }, 'Ariel pago 1,000');
    s.hora = new Date(s.hora.getTime() + 31 * 60_000);
    expect((await s.texto('efectivo')).tipo).toBe('sin_conversacion');
    expect(s.ejecutor.operaciones).toHaveLength(0);
  });
});

describe('cobro: pedidos abiertos y exceso (coherencia, no tope)', () => {
  it('con varios pedidos abiertos pregunta a cual se aplica', async () => {
    const s = new Sim({ pedidosAbiertos: async () => [{ folio: 'AG-001', saldoCent: 500000n }, { folio: 'AG-002', saldoCent: 300000n }], saldoCliente: async () => 800000n });
    let r = await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 500000, cuenta: 'efectivo' }, 'Ariel pago 5,000 efectivo');
    expect(textoDe(r)).toContain('debe $8,000.00 en 2 pedidos (AG-001, AG-002). ¿Lo aplico al más antiguo o a otro?');
    r = await s.boton('op:AG-001');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.pedido).toBe('AG-001');
  });

  it('si el cobro excede lo que debe pregunta anticipo o corregir; corregir pide el monto otra vez', async () => {
    const s = new Sim({ saldoCliente: async () => 1180000n, pedidosAbiertos: async () => [] });
    let r = await s.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 11800000, cuenta: 'efectivo' }, 'Ariel pago 118,000 efectivo');
    expect(textoDe(r)).toBe('El monto es mayor que lo que debe el cliente ($11,800.00). ¿Es un anticipo o corrijo el monto?');
    r = await s.boton('op:corregir');
    expect(textoDe(r)).toContain('¿De cuánto fue?');
    r = await s.texto('11,800');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.monto).toBe(1180000);
    const s2 = new Sim({ saldoCliente: async () => 1180000n, pedidosAbiertos: async () => [] });
    await s2.instruccion('cobro_cliente', { cliente: 'Ariel', monto: 11800000, cuenta: 'efectivo' }, 'Ariel pago 118,000 efectivo');
    expect((await s2.boton('op:anticipo')).tipo).toBe('registrado');
  });
});

describe('el servidor puede rechazar o preguntar', () => {
  it('un rechazo no registra y espera correccion (no reintenta con cualquier mensaje)', async () => {
    const s = new Sim();
    s.ejecutor.respuesta = () => ({ tipo: 'rechazado', texto: 'solo un pedido enviado admite recargo' });
    let r = await s.instruccion('reembolso', { socio: 'javier', monto: 100000, via: 'efectivo' }, 'reembolso a javier 1,000 efectivo');
    expect(r.tipo).toBe('rechazado');
    expect(textoDe(r)).toContain('No registré nada');
    r = await s.texto('gracias');
    expect(textoDe(r)).toContain('Dime qué dato corrijo');
    expect(s.ejecutor.operaciones).toHaveLength(1);
  });

  it('antiduplicado: la pregunta del carril de frenos vuelve a ejecutar con permitirDuplicado solo si dicen que es otro', async () => {
    const s = new Sim();
    let n = 0;
    s.ejecutor.respuesta = () => (n++ === 0 ? { tipo: 'pregunta', motivo: 'duplicado', texto: 'Ya hay un cobro igual hace 4 minutos. ¿Es otro?' } : { tipo: 'registrado', folio: 'PG-0009' });
    let r = await s.instruccion('retiro', { socio: 'javier', monto: 100000, via: 'efectivo' }, 'retiro javier 1,000 efectivo');
    expect(valoresBotones(r)).toEqual(['si', 'no']);
    r = await s.boton('si');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[1]!.permitirDuplicado).toBe(true);
  });
});

describe('una conversacion simulada por operacion', () => {
  // Cada caso: instruccion inicial (candidatos crudos), respuestas del socio y lo que el ejecutor debe recibir.
  const casos: Array<{ op: (typeof OPERACIONES_CONV)[number]; cand: Record<string, unknown>; cita: string; resp: string[]; preguntas: string[]; slots: Record<string, unknown> }> = [
    { op: 'pedido_dropshipping', cand: { cliente: 'Ariel', lineas: [{ modelo: 'zafiro', sabor: 'uva', piezas: 10 }] }, cita: 'Ariel 10 zafiro uva por dropshipping',
      resp: ['op:karen_via_isaac', 'op:credito', '1 semana', 'op:0'], preguntas: ['Karen directo', '¿Es de contado o a crédito?', '¿A cuántos días', '¿Cobras envío'], slots: { origen: 'karen_via_isaac', modalidad: 'credito', plazo: 7, envio: 0 } },
    { op: 'pedido_a_costo', cand: { lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 6 }] }, cita: 'pedido a costo 6 nexa mango',
      resp: ['op:isaac_directo', 'el 20 de noviembre'], preguntas: ['¿Lo surte Karen o Isaac?', '¿Cuándo pagas este pedido?'], slots: { origen: 'isaac_directo', fecha_pago: { fecha: '2026-11-20', sinFecha: false } } },
    { op: 'pago_redirigido', cand: { cliente: 'Ariel' }, cita: 'Ariel pago directo a karen',
      resp: ['op:karen', '4,000'], preguntas: ['¿Con qué proveedor es', '¿De cuánto fue?'], slots: { proveedor: { id: 'karen' }, monto: 400000 } },
    { op: 'pago_proveedor', cand: { proveedor: 'isaac', monto: 500000 }, cita: 'pague a isaac 5,000',
      resp: ['op:javier', 'op:reembolso'], preguntas: ['¿Pagó Angelo, Javier o la sociedad', '¿Es dinero que quieres invertir como capital o es un reembolso?'], slots: { pagado_por: 'javier', intencion: 'reembolso' } },
    { op: 'compra', cand: { proveedor: 'karen' }, cita: 'compra a karen',
      resp: ['nexa mango 100'], preguntas: ['¿Qué modelo, sabor y cuántas piezas?'], slots: { lineas: [{ modeloId: 'm1', saborId: 's1', piezas: 100 }] } },
    { op: 'recepcion_compra', cand: {}, cita: 'llego la compra',
      resp: ['c-12', 'op:parcial', 'nexa mango 40'], preguntas: ['¿De qué compra es?', '¿Llegó todo o solo una parte?', '¿Cuántas piezas de cada sabor llegaron?'], slots: { folio_compra: 'C-12', alcance: 'parcial', lineas: [{ piezas: 40 }] } },
    { op: 'gasto', cand: { monto: 25000 }, cita: 'gasto de 250',
      resp: ['op:guia', 'op:angelo'], preguntas: ['¿Qué tipo de gasto es', '¿Quién pagó el gasto'], slots: { tipo_gasto: 'guia', pagado_por: 'angelo', monto: 25000 } },
    { op: 'aportacion', cand: { socio: 'javier', monto: 1000000 }, cita: 'javier aporto 10,000',
      resp: ['op:capital'], preguntas: ['¿Lo pones como capital para invertir o es un reembolso?'], slots: { intencion: 'capital' } },
    { op: 'deposito', cand: { monto: 500000 }, cita: 'deposito de 5,000',
      resp: ['op:angelo', 'op:reembolso'], preguntas: ['¿Quién depositó', '¿Lo pones como capital'], slots: { socio: 'angelo', intencion: 'reembolso' } },
    { op: 'reembolso', cand: { socio: 'javier' }, cita: 'reembolso a javier',
      resp: ['3,000', 'op:transferencia'], preguntas: ['¿De cuánto fue?', '¿Fue por transferencia o en efectivo?'], slots: { monto: 300000, via: 'transferencia' } },
    { op: 'retiro', cand: { monto: 800000, via: 'efectivo' }, cita: 'retiro de 8,000 efectivo',
      resp: ['op:javier'], preguntas: ['¿Quién retira, Angelo o Javier?'], slots: { socio: 'javier', via: 'efectivo' } },
    { op: 'entrega_fondos', cand: { socio: 'angelo', monto: 200000 }, cita: 'angelo entrego 2,000',
      resp: ['op:karen', 'op:efectivo'], preguntas: ['¿A la sociedad, a Isaac o a Karen?', '¿Fue por transferencia'], slots: { destino: 'karen', via: 'efectivo' } },
    { op: 'liquidacion', cand: { monto: 150000 }, cita: 'liquidacion de 1,500',
      resp: ['op:javier', 'op:angelo', 'op:efectivo'], preguntas: ['¿Quién paga', '¿A quién le paga', '¿Fue por transferencia'], slots: { socio: 'javier', contraparte: 'angelo' } },
    { op: 'retiro_capital', cand: { monto: 500000 }, cita: 'quiero retirar 5,000 de capital',
      resp: ['op:javier'], preguntas: ['¿Quién retira capital, Angelo o Javier?'], slots: { socio: 'javier', monto: 500000 } },
    { op: 'renta_omar', cand: { monto: 100000 }, cita: 'pague la renta de Omar 1,000',
      resp: ['op:angelo', 'op:transferencia'], preguntas: ['¿Quién pagó la renta de Omar', '¿Fue por transferencia o en efectivo?'], slots: { pagado_por: 'angelo', via: 'transferencia' } },
    { op: 'gasto_servicio', cand: { servicio: 'OpenRouter', moneda: 'usd', monto: 2000 }, cita: 'pague 20.00 usd de OpenRouter',
      resp: ['op:javier', '18.50'], preguntas: ['¿Quién lo pagó', '¿A qué tipo de cambio'], slots: { pagado_por: 'javier', tipo_cambio: '18.50' } },
    { op: 'conteo', cand: {}, cita: 'conteo',
      resp: ['zafiro uva 12'], preguntas: ['¿Qué modelo, sabor y cuántas piezas contaste?'], slots: { lineas: [{ modeloId: 'm2', saborId: 's5', piezas: 12 }] } },
    { op: 'merma', cand: { lineas: [{ modelo: 'zafiro', sabor: 'menta', piezas: 2 }] }, cita: 'merma 2 zafiro menta',
      resp: ['se cayeron'], preguntas: ['¿Cuál es el motivo de la merma?'], slots: { motivo: 'se cayeron' } },
    { op: 'obsequio', cand: { lineas: [{ modelo: 'zafiro', sabor: 'uva', piezas: 1 }] }, cita: 'obsequio 1 zafiro uva',
      resp: ['para un cliente nuevo'], preguntas: ['¿Para quién o por qué es el obsequio?'], slots: { motivo: 'para un cliente nuevo' } },
    { op: 'devolucion', cand: { cliente: 'Ariel' }, cita: 'devolucion de ariel',
      resp: ['ag-003', 'nexa mango 3', 'op:inventario', 'llego mal'], preguntas: ['¿De qué pedido es la devolución?', '¿Qué modelo, sabor y cuántas piezas devolvió?', '¿Las piezas regresan al inventario o van a merma?', '¿Cuál fue el motivo de la devolución?'], slots: { pedido_folio: 'AG-003', destino_piezas: 'inventario', motivo: 'llego mal' } },
    { op: 'alta_cliente', cand: {}, cita: 'dar de alta un cliente',
      resp: ['Beto Ramirez', 'op:menudeo'], preguntas: ['¿Cómo se llama el cliente', '¿Es mayoreo o menudeo?'], slots: { nombre: 'Beto Ramirez', tipo_cliente: 'menudeo' } },
    { op: 'alta_sabor', cand: {}, cita: 'nuevo sabor',
      resp: ['uva helada'], preguntas: ['¿Cuál es el nombre exacto del sabor?'], slots: { nombre: 'uva helada' } },
    { op: 'alta_modelo', cand: { nombre: 'Waka 30K' }, cita: 'nuevo modelo waka 30k',
      resp: ['Waka', '95'], preguntas: ['¿De qué marca es?', '¿Cuál es el costo de lista?'], slots: { marca: 'Waka', costo: 9500 } },
  ];

  for (const c of casos) {
    it(`${c.op}: pregunta lo que falta y registra con todos los datos`, async () => {
      const s = new Sim();
      let r = await s.instruccion(c.op, c.cand, c.cita);
      for (let i = 0; i < c.resp.length; i++) {
        expect(r.tipo, `antes de la respuesta ${i + 1} debe haber una pregunta (${s.enviados.at(-1)})`).toBe('pregunta');
        expect(textoDe(r), `pregunta ${i + 1}`).toContain(c.preguntas[i]!);
        expect(s.ejecutor.operaciones, 'no registra antes de tener todo').toHaveLength(0);
        r = c.resp[i]!.startsWith('op:') ? await s.boton(c.resp[i]!) : await s.texto(c.resp[i]!);
      }
      expect(r.tipo, textoDe(r)).toBe('registrado');
      const op = s.ejecutor.operaciones[0]!;
      expect(op.operacion).toBe(c.op);
      expect(slotsFaltantes(c.op, op.slots)).toEqual([]);
      expect(op.slots).toMatchObject(c.slots);
      expect(op.claveIdem).toMatch(/^conv:/);
    });
  }

  it('hay un caso por cada operacion definida (ninguna queda sin conversacion simulada)', () => {
    const cubiertas = new Set<string>(casos.map((c) => c.op));
    for (const k of ['pedido_bodega', 'cobro_cliente']) cubiertas.add(k);
    expect([...OPERACIONES_CONV].filter((o) => !cubiertas.has(o))).toEqual([]);
  });
});

describe('mensaje final de pedido y avisos', () => {
  it('el pedido dropshipping agrega que los datos de entrega no pasan por Telegram y no usa tarjeta', async () => {
    const s = new Sim({}, { resumen: async () => ({ ...RESUMEN_EJEMPLO, origen: 'karen_directo', proveedor: 'Karen', por_pagar_proveedor_cent: 100000, costo_pedido_estimado_cent: 240000, por_pagar_proveedor_con_pedido_cent: 340000, inventario: null }) });
    const r = await s.instruccion('pedido_dropshipping', { cliente: 'Ariel', origen: 'karen_directo', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 24 }], modalidad: 'contado', envio: 0 }, 'Ariel 24 nexa mango dropshipping karen contado');
    expect(r.tipo).toBe('registrado');
    const t = textoDe(r);
    expect(t).toContain('Por pagar a Karen: $1,000.00; con este pedido queda en $3,400.00');
    expect(t).toContain('Plazo: a crédito');
    expect(t).toContain('no se escriben en Telegram');
    expect(t).not.toContain('Inventario disponible');
  });

  it('las cifras del mensaje final pasan el guardia de cifras (todas vienen del servidor)', async () => {
    const s = new Sim();
    const r = await s.instruccion('pedido_bodega', { cliente: 'Ariel', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 24 }], modalidad: 'contado', envio: 0 }, 'Ariel 24 nexa mango contado');
    if (r.tipo !== 'registrado') throw new Error('debio registrar');
    expect(() => r.mensaje.registro.exigir(r.mensaje.texto)).not.toThrow();
  });

  it('Javier tambien opera (el autor se respeta)', async () => {
    const s = new Sim({}, undefined, JAVIER);
    await s.instruccion('retiro', { socio: 'javier', monto: 100000, via: 'efectivo' }, 'retiro javier 1,000 efectivo');
    expect(s.ejecutor.operaciones[0]!.autor.persona).toBe('javier');
  });
});

describe('todas las operaciones tienen sus preguntas y ninguna usa emojis', () => {
  it('textos en espanol neutro sin emojis y con botones solo en opciones cerradas', () => {
    for (const op of OPERACIONES_CONV) {
      for (const sl of OPERACIONES[op].slots) {
        expect(sl.pregunta).not.toMatch(/\p{Extended_Pictographic}/u);
        if (sl.obligatorio && sl.tipo !== 'bandera') expect(sl.pregunta.length, `${op}.${sl.clave}`).toBeGreaterThan(5);
      }
    }
  });
});
