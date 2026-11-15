// Conversaciones simuladas del carril bot/ventas-compras: por cada operacion nueva, el mensaje del socio, las preguntas del bot, las respuestas, el registro y el mensaje final.
// Sin red: almacen en memoria, ejecutor falso y transporte falso. Decisiones del dueno (14-nov): sin tarjeta, sin topes; el bot pregunta lo que falte; todo credito exige plazo.
import { describe, expect, it } from 'vitest';
import { slotsFaltantes } from '@/dominio/agente/slots';
import { instruccionDeIntencion } from '@/dominio/agente/slots_desde_intencion';
import { intencionDeSlots } from '@/aplicacion/agente/slots_a_intencion';
import { preparar } from '@/infra/agente/postgres';
import type { AccionResuelta, ContextoEjecucion } from '@/aplicacion/agente/puertos';
import type { Miembro } from '@/dominio/agente/tipos';
import { emparejarGuias, paqueteriaDeCatalogo, parsearFolios, parsearGuiasTexto, type PedidoCandidato } from '@/dominio/agente/guias';
import { Sim, textoDe, valoresBotones } from './conversacion_ayudas';

const POR_ENVIAR: PedidoCandidato[] = [
  { folio: 'LS-001', cliente: 'Lupita Soto', folioExterno: null, paqueteria: null },
  { folio: 'MG-004', cliente: 'Memo Garcia', folioExterno: '73266', paqueteria: null },
  { folio: 'MG-005', cliente: 'Memo Garcia', folioExterno: null, paqueteria: null },
];

describe('pedido de dropshipping', () => {
  it('pregunta contado o credito, el plazo (obligatorio a credito) y el envio; registra con el origen y manda el aviso de datos de entrega', async () => {
    const s = new Sim();
    let r = await s.instruccion('pedido_dropshipping', { cliente: 'Lupita', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 24 }, { modelo: 'zafiro', sabor: 'uva', piezas: 10 }] }, 'dropshipping para Lupita');
    expect(textoDe(r)).toContain('¿Lo surte Karen directo, Karen vía Isaac o Isaac directo?');
    expect(s.ejecutor.operaciones).toHaveLength(0);
    r = await s.boton('op:karen_via_isaac');
    expect(textoDe(r)).toBe('¿Es de contado o a crédito?');
    r = await s.boton('op:credito');
    expect(textoDe(r)).toContain('¿A cuántos días o semanas paga?');
    expect(s.ejecutor.operaciones, 'un credito sin plazo no se registra').toHaveLength(0);
    r = await s.texto('quince dias');
    expect(textoDe(r)).toContain('¿Cobras envío');
    r = await s.boton('op:0');
    expect(r.tipo).toBe('registrado');
    const op = s.ejecutor.operaciones[0]!;
    expect(op.operacion).toBe('pedido_dropshipping');
    expect(slotsFaltantes('pedido_dropshipping', op.slots)).toEqual([]);
    expect(op.slots).toMatchObject({ origen: 'karen_via_isaac', modalidad: 'credito', plazo: 15, envio: 0 });
    expect((op.slots.lineas as unknown[]).length).toBe(2);
    expect(textoDe(r)).toContain('datos de entrega');
  });

  it('de contado no pregunta plazo y fija plazo 0', async () => {
    const s = new Sim();
    await s.instruccion('pedido_dropshipping', { cliente: 'Lupita', origen: 'isaac_directo', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 5 }], modalidad: 'contado', envio: 0 }, 'dropshipping de contado');
    expect(s.ejecutor.operaciones).toHaveLength(1);
    const t = intencionDeSlots('pedido_dropshipping', s.ejecutor.operaciones[0]!.slots, 'x');
    expect(t).toMatchObject({ ok: true, intencion: { tipo: 'pedido_ds', forma_pago: 'contado', plazo_dias: 0, proveedor_origen: 'isaac_directo' } });
  });

  it('el pedido a credito traduce su plazo en dias y SQL recibe plazo_dias, origen y renglones por modelo y sabor (el modelo no calcula nada)', () => {
    const slots = { cliente: { id: '3', nombre: 'Lupita Soto' }, origen: 'karen_directo', modalidad: 'credito', plazo: 15, envio: 5000, lineas: [{ modeloId: '1', modelo: 'Nexa', saborId: '2', sabor: 'Mango', piezas: 24 }], folio_proveedor: 'luego' };
    const t = intencionDeSlots('pedido_dropshipping', slots, 'x');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const a: AccionResuelta = { intencion: t.intencion, resoluciones: { clienteId: '3', proveedorId: null, modeloId: null, lineas: [{ modeloId: '1', saborId: '2' }] } as AccionResuelta['resoluciones'] };
    const ctx = { autor: { telegramUserId: 7, persona: 'angelo', rol: 'socio' } as Miembro, claveIdem: 'k', origen: { updateId: 0, chatId: 0, messageId: 0 }, ahora: new Date(), confirmado: false, efectoHash: null, tokenBoton: null } as ContextoEjecucion;
    const p = preparar(a, ctx, '2026-11-16')!;
    expect(p).toMatchObject({ hub: 'ejecutar_ext', tipo: 'pedido_ds' });
    expect(p.args).toMatchObject({ cliente_id: 3, origen_pedido: 'karen_directo', plazo_dias: 15, envio_cent: 5000, folio_externo: null, lineas: [{ modelo_id: 1, sabor_id: 2, piezas: 24, precio_cent: null }] });
    expect(JSON.stringify(p.args)).not.toMatch(/destinatario|telefono/i);
  });
});

describe('pedido a costo para el socio de menudeo', () => {
  it('pregunta el proveedor y la fecha de pago y registra con la fecha ya interpretada por el codigo', async () => {
    const s = new Sim();
    let r = await s.instruccion('pedido_a_costo', { lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 12 }] }, 'pedido a costo de 12 nexa mango');
    expect(textoDe(r)).toContain('¿Lo surte Karen o Isaac?');
    r = await s.boton('op:karen_directo');
    expect(textoDe(r)).toContain('¿Cuándo pagas este pedido?');
    r = await s.texto('sin fecha');
    expect(r.tipo).toBe('registrado');
    const t = intencionDeSlots('pedido_a_costo', s.ejecutor.operaciones[0]!.slots, 'x');
    expect(t).toMatchObject({ ok: true, intencion: { tipo: 'pedido_menudeo', proveedor_origen: 'karen_directo', sin_fecha: true, fecha_compromiso: null } });
  });
});

describe('compras y recepcion', () => {
  it('compra con guia: pregunta quien la pago; sin guia no la pregunta', async () => {
    const s = new Sim();
    let r = await s.instruccion('compra', { proveedor: 'isaac', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 100 }], guia: 35000 }, 'compra a isaac con guia de 350');
    expect(textoDe(r)).toContain('¿Quién pagó la guía');
    r = await s.boton('op:sociedad');
    expect(r.tipo).toBe('registrado');
    const t = intencionDeSlots('compra', s.ejecutor.operaciones[0]!.slots, 'x');
    expect(t).toMatchObject({ ok: true, intencion: { tipo: 'compra', guia_centavos: 35000, pagado_por: 'sociedad' }, overrides: { proveedor: 'isaac' } });
    const s2 = new Sim();
    const r2 = await s2.instruccion('compra', { proveedor: 'karen', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 10 }] }, 'compra a karen');
    expect(r2.tipo).toBe('registrado');
  });

  it('orden de compra en borrador pregunta proveedor y piezas', async () => {
    const s = new Sim();
    let r = await s.instruccion('orden_compra', {}, 'hazme una orden de compra');
    expect(textoDe(r)).toContain('Isaac o Karen');
    r = await s.boton('op:karen');
    expect(textoDe(r)).toContain('¿Qué modelo, sabor y cuántas piezas?');
    r = await s.texto('nexa mango 50');
    expect(r.tipo).toBe('registrado');
    expect(intencionDeSlots('orden_compra', s.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'orden_compra', aplicar_saldo: false } });
  });

  it('llego total y llego parcial (con lo que llego por sabor)', async () => {
    const s = new Sim();
    let r = await s.instruccion('recepcion_compra', { folio_compra: 'c-0007' }, 'llego la compra c-0007');
    expect(textoDe(r)).toContain('¿Llegó todo o solo una parte?');
    r = await s.boton('op:total');
    expect(r.tipo).toBe('registrado');
    expect(intencionDeSlots('recepcion_compra', s.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'compra_recepcion', compra_folio: 'C-0007', lineas: [] } });
    const s2 = new Sim();
    await s2.instruccion('recepcion_compra', { folio_compra: 'c-0007', alcance: 'parcial' }, 'llegaron algunas');
    const r2 = await s2.texto('nexa mango 40');
    expect(r2.tipo).toBe('registrado');
    expect(intencionDeSlots('recepcion_compra', s2.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { lineas: [{ piezas: 40 }] }, overrides: { 'lineas.0.modelo': 'm1', 'lineas.0.sabor': 's1' } });
  });

  it('estado de la compra (en trayecto o llego a Merida) y cierre con faltante', async () => {
    const s = new Sim();
    let r = await s.instruccion('compra_estado', { folio_compra: 'C-0003' }, 'actualiza la compra');
    expect(textoDe(r)).toContain('¿Salió el paquete');
    expect(valoresBotones(r)).toEqual(['op:enviada', 'op:llego_merida']);
    r = await s.boton('op:llego_merida');
    expect(r.tipo).toBe('registrado');
    expect(intencionDeSlots('compra_estado', s.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'compra_estado', estado: 'llego_merida' } });
    const s2 = new Sim();
    const r2 = await s2.instruccion('compra_cierre', {}, 'cierra la compra con faltante');
    expect(textoDe(r2)).toContain('¿Qué compra cierras con faltante?');
    const r3 = await s2.texto('c-0009');
    expect(r3.tipo).toBe('registrado');
    expect(intencionDeSlots('compra_cierre', s2.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'compra_cierre', compra_folio: 'C-0009', motivo: null } });
  });
});

describe('devolucion y paquete perdido (antes: "hazlo en el software")', () => {
  it('devolucion: pregunta pedido, piezas, destino y motivo; el puente la deja lista para SQL', async () => {
    const s = new Sim();
    let r = await s.instruccion('devolucion', { cliente: 'Ariel' }, 'ariel devuelve');
    expect(textoDe(r)).toContain('¿De qué pedido es la devolución?');
    await s.texto('ag-003');
    await s.texto('nexa mango 3');
    await s.boton('op:merma');
    r = await s.texto('llego mal');
    expect(r.tipo).toBe('registrado');
    expect(intencionDeSlots('devolucion', s.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'devolucion', pedido_folio: 'AG-003', destino: 'merma', motivo: 'llego mal' }, overrides: { cliente: 'c4' } });
  });

  it('paquete perdido o danado: pedido, que paso y detalle', async () => {
    const s = new Sim();
    let r = await s.instruccion('paquete_perdido', { pedido_folio: 'MG-004' }, 'se perdio el paquete de MG-004');
    expect(textoDe(r)).toContain('¿Se perdió o llegó dañado?');
    r = await s.boton('op:perdido');
    expect(textoDe(r)).toContain('¿Qué pasó?');
    r = await s.texto('la paqueteria no lo entrego');
    expect(r.tipo).toBe('registrado');
    expect(intencionDeSlots('paquete_perdido', s.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'paquete_perdido', incidente: 'perdido', pedido_folio: 'MG-004' } });
  });
});

describe('envio de pedidos en lote (primer tiempo: sin exigir guia)', () => {
  it('valida los folios contra los pedidos por enviar, pregunta la paqueteria del catalogo cerrado y no pide guia', async () => {
    const s = new Sim({ pedidosPorEnviar: async () => POR_ENVIAR });
    let r = await s.instruccion('envio_lote', { folios: ['ls-001', 'zz-9'] }, 'salieron ls-001 y zz-9');
    expect(textoDe(r)).toContain('No encuentro como pedido por enviar: ZZ-9');
    expect(s.ejecutor.operaciones).toHaveLength(0);
    r = await s.texto('LS-001, MG-004');
    expect(textoDe(r)).toContain('¿Con qué paquetería salen: Castores, Pitic, DHL o Estafeta?');
    expect(valoresBotones(r)).toEqual(['op:Castores', 'op:Pitic', 'op:DHL', 'op:Estafeta']);
    r = await s.texto('fedex');
    expect(textoDe(r)).toContain('No entendí');
    expect(s.ejecutor.operaciones).toHaveLength(0);
    r = await s.boton('op:Castores');
    expect(r.tipo).toBe('registrado');
    expect(intencionDeSlots('envio_lote', s.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'envio_lote', paqueteria: 'castores', folios: ['LS-001', 'MG-004'] } });
  });

  it('"todos" envia todos los pedidos que esperan salir', async () => {
    const s = new Sim({ pedidosPorEnviar: async () => POR_ENVIAR });
    await s.instruccion('envio_lote', { paqueteria: 'DHL' }, 'ya salieron');
    const r = await s.texto('todos');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.folios).toEqual(['LS-001', 'MG-004', 'MG-005']);
  });

  it('un envio suelto (pedido_envio sin guia) pasa por el mismo camino; con guia dictada conserva el anterior', () => {
    expect(instruccionDeIntencion({ tipo: 'pedido_envio', pedido_folio: 'MG-004', estado: 'enviado', paqueteria_texto: 'dhl', guia_texto: null, fuente_cita: 'x' })).toMatchObject({ operacion: 'envio_lote', candidatos: { folios: ['MG-004'], paqueteria: 'dhl' } });
    expect(instruccionDeIntencion({ tipo: 'pedido_envio', pedido_folio: 'MG-004', estado: 'enviado', paqueteria_texto: 'dhl', guia_texto: '123', fuente_cita: 'x' })).toBeNull();
    expect(instruccionDeIntencion({ tipo: 'pedido_envio', pedido_folio: 'MG-004', estado: 'entregado', paqueteria_texto: null, guia_texto: null, fuente_cita: 'x' })).toBeNull();
  });
});

describe('guias en lote (segundo tiempo: la guia llega despues y se empareja por pedido)', () => {
  const entorno = { pedidosSinGuia: async () => POR_ENVIAR };

  it('empareja por folio y por cliente; si hay duda (dos pedidos del mismo cliente) pregunta y conserva lo ya emparejado', async () => {
    const s = new Sim(entorno);
    let r = await s.instruccion('guias_lote', { guias: [{ pedido_folio: 'LS-001', cliente_texto: null, guia_texto: '5551' }, { pedido_folio: null, cliente_texto: 'Memo Garcia', guia_texto: '5552' }] }, 'guias');
    expect(r.tipo).toBe('pregunta');
    expect(textoDe(r)).toContain('Ya emparejé: LS-001 con la guía 5551');
    expect(textoDe(r)).toContain('Guía 5552');
    expect(textoDe(r)).toContain('MG-004 Memo Garcia; MG-005 Memo Garcia');
    expect(s.ejecutor.operaciones, 'con duda no registra').toHaveLength(0);
    r = await s.texto('MG-005 5552');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.guias).toEqual([{ folio: 'LS-001', guia: '5551' }, { folio: 'MG-005', guia: '5552' }]);
    expect(intencionDeSlots('guias_lote', s.ejecutor.operaciones[0]!.slots, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'guias_lote', guias: [{ pedido_folio: 'LS-001', guia_texto: '5551' }, { pedido_folio: 'MG-005', guia_texto: '5552' }] } });
  });

  it('texto pegado: una guia por linea con folio, o folio del proveedor', async () => {
    const s = new Sim(entorno);
    await s.instruccion('guias_lote', {}, 'te paso las guias');
    const r = await s.texto('LS-001 5551234\n73266 99887766');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots.guias).toEqual([{ folio: 'LS-001', guia: '5551234' }, { folio: 'MG-004', guia: '99887766' }]);
  });

  it('una guia sin pedido ni cliente con varios pedidos esperando se pregunta, no se adivina', async () => {
    const s = new Sim(entorno);
    const r = await s.instruccion('guias_lote', { guias: [{ pedido_folio: null, cliente_texto: null, guia_texto: '7771' }] }, 'guia 7771');
    expect(r.tipo).toBe('pregunta');
    expect(textoDe(r)).toContain('Guía 7771');
    expect(s.ejecutor.operaciones).toHaveLength(0);
  });
});

describe('cobros: varios pedidos abiertos, sobrepago y sin tope', () => {
  it('pregunta a cual de los pedidos abiertos se aplica y acepta un monto grande sin tope', async () => {
    const s = new Sim({ pedidosAbiertos: async () => [{ folio: 'LS-001', saldoCent: 500000n }, { folio: 'LS-002', saldoCent: 300000n }], saldoCliente: async () => 80_000_000_00n });
    let r = await s.instruccion('cobro_cliente', { cliente: 'lupita', monto: 5_000_000_00, cuenta: 'efectivo' }, 'lupita pago 5,000,000');
    expect(textoDe(r)).toContain('debe $8,000.00 en 2 pedidos');
    r = await s.boton('op:LS-002');
    expect(r.tipo).toBe('registrado');
    expect(s.ejecutor.operaciones[0]!.slots).toMatchObject({ pedido: 'LS-002', monto: 5_000_000_00 });
  });

  it('un cobro mayor a lo que debe pregunta si es anticipo (nunca rechaza por monto)', async () => {
    const s = new Sim({ pedidosAbiertos: async () => [{ folio: 'LS-001', saldoCent: 500000n }], saldoCliente: async () => 500000n });
    let r = await s.instruccion('cobro_cliente', { cliente: 'lupita', monto: 900000, cuenta: 'efectivo' }, 'lupita pago 9,000');
    expect(textoDe(r)).toContain('mayor que lo que debe el cliente');
    r = await s.boton('op:anticipo');
    expect(r.tipo).toBe('registrado');
  });
});

describe('modulo de guias (puro)', () => {
  it('catalogo cerrado de paqueterias', () => {
    expect(paqueteriaDeCatalogo('castores')).toBe('Castores');
    expect(paqueteriaDeCatalogo(' DHL ')).toBe('DHL');
    expect(paqueteriaDeCatalogo('Fedex')).toBeNull();
    expect(paqueteriaDeCatalogo(null)).toBeNull();
  });
  it('lee folios y guias de un texto pegado', () => {
    expect(parsearFolios('salieron ls-001, MG-4 y p-0012 ls-001')).toEqual(['LS-001', 'MG-4', 'P-0012']);
    expect(parsearGuiasTexto('MG-001 5551234\nMemo Garcia: 99887766\n5550000 LS-002')).toEqual([
      { pedidoFolio: 'MG-001', clienteTexto: null, guia: '5551234' },
      { pedidoFolio: null, clienteTexto: 'Memo Garcia', guia: '99887766' },
      { pedidoFolio: 'LS-002', clienteTexto: null, guia: '5550000' },
    ]);
  });
  it('dos guias para el mismo pedido: la segunda queda en duda', () => {
    const r = emparejarGuias([{ pedidoFolio: 'LS-001', clienteTexto: null, guia: '1111' }, { pedidoFolio: 'LS-001', clienteTexto: null, guia: '2222' }], POR_ENVIAR);
    expect(r.emparejadas).toEqual([{ folio: 'LS-001', guia: '1111' }]);
    expect(r.dudas).toHaveLength(1);
  });
  it('un folio que no espera guia es duda con motivo no_pendiente', () => {
    const r = emparejarGuias([{ pedidoFolio: 'ZZ-001', clienteTexto: null, guia: '1111' }], POR_ENVIAR);
    expect(r.dudas[0]).toMatchObject({ motivo: 'no_pendiente', guia: '1111' });
  });
});
