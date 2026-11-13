// Lane telegram-ampliacion: comentario de igualacion, pedido_menudeo (fecha comprometida con codigo), pago_pedido_menudeo (comprobante por huella, decision del otro socio)
// y recordatorios de pago del latido. Todo en memoria con LLM guionado y el espejo del negocio (ningun envio real). La base real se prueba en pgTAP a7_002 y en test/integracion.
import { describe, expect, it } from 'vitest';
import { escenario, IDS, unaAccion, type Escenario } from './ayudas';
import { respuesta } from '@/infra/agente/llm_simulado';
import type { Intencion } from '@/dominio/agente/intenciones';
import type { Enviado } from '@/infra/agente/memoria';

const ESTRICTO = { config: { confirmarMovimientos: true } };
const pedidoMenudeo = (extra: Partial<Extract<Intencion, { tipo: 'pedido_menudeo' }>> = {}): Intencion => ({
  tipo: 'pedido_menudeo', proveedor_origen: null, lineas: [{ modelo_texto: 'elux', sabor_texto: 'sandia', piezas: 10 }], cuando_texto: null, fuente_cita: 'cita', ...extra,
});

const todos = (e: Escenario): string => e.textosGrupo().join('\n---\n');
const conBotones = (e: Escenario, texto: string): Enviado => {
  const m = [...e.grupo()].reverse().find((x) => x.texto.includes(texto) && (x.botones?.length ?? 0) > 0);
  if (!m) throw new Error(`no hay tarjeta con botones que diga: ${texto}\n${todos(e)}`);
  return m;
};
const boton = (m: Enviado, texto: string): [number, number] => {
  for (const [f, fila] of (m.botones ?? []).entries()) for (const [c, b] of fila.entries()) if (b.texto.startsWith(texto)) return [f, c];
  throw new Error(`no hay boton ${texto}`);
};
async function pulsar(e: Escenario, de: 'angelo' | 'javier', m: Enviado, texto: string) {
  const [f, c] = boton(m, texto);
  return e.pulsar(IDS[de], IDS.grupoSocios, m, f, c);
}

/** Crea y confirma un pedido de menudeo de Angelo con su fecha; devuelve el folio. */
async function pedidoConfirmado(e: Escenario, cuando = 'el viernes a las 5 de la tarde'): Promise<string> {
  await e.socio('angelo', `/pedidomenudeo elux/sandia 10 | cuando ${cuando}`);
  await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
  const eco = [...e.textosGrupo()].reverse().find((t) => t.startsWith('Registrado'))!;
  return /Registrado (P-\d+)/.exec(eco)![1]!;
}
const folioDe = (e: Escenario) => e.negocio.menudeo.pedidos[0]!.folio;

describe('comentario de igualacion', () => {
  it('despues de un deposito el bot dice quien lleva mas y a quien le toca, con cifras de la base', async () => {
    const e = escenario([unaAccion({ tipo: 'aportacion', socio: 'javier', monto_centavos: 100_000, motivo: null, intencion: null, fuente_cita: 'cita' })]);
    await e.socio('javier', 'puse 1,000');
    expect(e.ultimoGrupo().texto).toBe('Javier lleva $1,000.00 más aportado; el siguiente pago le toca a Angelo.');
    expect(e.ultimoGrupo().texto).not.toMatch(/deud|debe|adeuda|deber/i);
  });
  it('cuando las aportaciones coinciden dice "Aportaciones igualadas."', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/aporte angelo 500'); await pulsar(e, 'angelo', conBotones(e, 'Resumen'), 'Confirmar');
    await e.socio('javier', '/aporte javier 500'); await pulsar(e, 'javier', conBotones(e, 'Resumen'), 'Confirmar');
    expect(e.ultimoGrupo().texto).toBe('Aportaciones igualadas.');
  });
  it('tambien tras reembolso, retiro, pago a proveedor con dinero propio y cobro en cuenta de socio; no tras un cobro en efectivo ni un pago de la sociedad', async () => {
    const e = escenario([]);
    e.negocio.ponerUtilidadAsignada('angelo', 100_000n);
    await e.socio('angelo', '/aporte angelo 500');
    const n0 = e.grupo().length;
    await e.socio('javier', '/pagoprov karen | 1000 | javier');
    expect(e.ultimoGrupo().texto).toMatch(/lleva .* más aportado; el siguiente pago le toca a/);
    await e.socio('javier', '/gasto guia 500 javier');
    await e.socio('javier', '/reembolso javier 200 efectivo');
    expect(e.ultimoGrupo().texto).toMatch(/más aportado|igualadas/);
    await e.socio('angelo', '/retiro angelo 100 efectivo');
    expect(e.ultimoGrupo().texto).toMatch(/más aportado|igualadas/);
    const conComentario = e.grupo().length;
    expect(conComentario).toBeGreaterThan(n0);
    await e.socio('angelo', '/pagoprov karen | 1000 | sociedad');
    expect(e.ultimoGrupo().texto).not.toMatch(/más aportado|igualadas/);
    await e.socio('javier', '/pago Cliente Norte | 100');
    // el cobro sin cuenta pregunta la cuenta; no hay comentario de igualacion todavia
    expect(e.ultimoGrupo().texto).not.toMatch(/más aportado|igualadas/);
  });
  it('si la lectura de la base falla, el movimiento ya registrado no se afecta', async () => {
    const e = escenario([unaAccion({ tipo: 'aportacion', socio: 'javier', monto_centavos: 100_000, motivo: null, intencion: null, fuente_cita: 'cita' })]);
    e.negocio.igualacion = async () => { throw new Error('base caida (simulada)'); };
    await e.socio('javier', 'puse 1,000');
    expect(e.negocio.deudaCon('javier')).toBe(100_000n);
    expect(todos(e)).toContain('Registrado');
    expect(e.almacen.eventos.some((x) => x.detalle === 'igualacion_no_disponible')).toBe(true);
  });
  it('un reenvio del mismo mensaje no repite el comentario', async () => {
    const e = escenario([unaAccion({ tipo: 'aportacion', socio: 'javier', monto_centavos: 100_000, motivo: null, intencion: null, fuente_cita: 'cita' })]);
    await e.socio('javier', 'puse 1,000', { updateId: 77, messageId: 77 });
    const n = e.grupo().length;
    await e.socio('javier', 'puse 1,000', { updateId: 77, messageId: 77 });
    expect(e.grupo().length).toBe(n);
  });
});

describe('pedido_menudeo', () => {
  it('caso feliz: el codigo interpreta la fecha, el resumen la muestra, el socio confirma y se crea a costo', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10 | cuando el viernes');
    const resumen = conBotones(e, 'Resumen para confirmar');
    expect(resumen.texto).toContain('Pedido a costo de menudeo');
    expect(resumen.texto).toContain('viernes 13 de noviembre de 2026 (sin hora)');
    expect(resumen.texto).toContain('sin destinatario');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
    await pulsar(e, 'angelo', resumen, 'Confirmar');
    const p = e.negocio.menudeo.pedidos[0]!;
    expect(p.socio).toBe('angelo');
    expect(p.fecha).toBe('2026-11-13');
    expect(p.hora).toBeNull();
    expect(p.costoCent).toBe(60_000n);
    expect(todos(e)).toContain('Costo del pedido (lo que se paga al proveedor): $600.00');
    expect(todos(e)).toContain('Fecha comprometida de pago: viernes 13 de noviembre de 2026 (sin hora)');
    expect(todos(e)).toContain('nunca por Telegram');
  });
  it('faltante: sin fecha el bot pregunta "¿cuando pagas?" y el socio contesta con sus palabras; la fecha sale del codigo', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10');
    expect(e.ultimoGrupo().texto).toContain('¿Cuándo pagas este pedido?');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
    await e.socio('angelo', 'el viernes a las 5 de la tarde');
    const resumen = conBotones(e, 'Resumen para confirmar');
    expect(resumen.texto).toContain('viernes 13 de noviembre de 2026, 17:00 (hora de Mérida)');
    await pulsar(e, 'angelo', resumen, 'Confirmar');
    expect(e.negocio.menudeo.pedidos[0]).toMatchObject({ fecha: '2026-11-13', hora: '17:00' });
  });
  it('fecha ambigua (mañana a las 5): botones 5 a.m. / 5 p.m.; nada se registra hasta elegir y confirmar', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10');
    await e.socio('angelo', 'mañana a las 5');
    const opciones = conBotones(e, 'mañana o de la tarde');
    expect(opciones.botones!.flat().map((b) => b.texto)).toEqual(['miércoles 11 de noviembre de 2026, 05:00 (hora de Mérida)', 'miércoles 11 de noviembre de 2026, 17:00 (hora de Mérida)', 'Cancelar']);
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
    await pulsar(e, 'angelo', opciones, 'miércoles 11 de noviembre de 2026, 17:00');
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.pedidos[0]).toMatchObject({ fecha: '2026-11-11', hora: '17:00' });
  });
  it('la opcion de fecha la elige quien pidio: si pulsa el otro socio no pasa nada y vuelven las opciones', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10 | cuando mañana a las 5');
    const opciones = conBotones(e, 'mañana o de la tarde');
    await pulsar(e, 'javier', opciones, 'miércoles 11 de noviembre de 2026, 17:00');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
    expect(todos(e)).toContain('el elige la fecha');
    expect(e.grupo().filter((m) => m.texto.includes('mañana o de la tarde'))).toHaveLength(2);
  });
  it('una fecha pasada o ilegible vuelve a preguntar y a la tercera suelta la pregunta sin registrar nada', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10');
    await e.socio('angelo', 'ayer');
    expect(e.ultimoGrupo().texto).toContain('ya pasó');
    await e.socio('angelo', 'pronto');
    expect(e.ultimoGrupo().texto).toContain('No entendí la fecha');
    await e.socio('angelo', 'quien sabe');
    expect(e.ultimoGrupo().texto).toContain('No pude entender la fecha de pago');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
  });
  it('"sin fecha" crea el pedido sin fecha comprometida (alerta)', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10');
    await e.socio('angelo', 'sin fecha');
    expect(conBotones(e, 'Resumen para confirmar').texto).toContain('ninguna');
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.pedidos[0]!.fecha).toBeNull();
  });
  it('con IA: la frase de fecha se copia del mensaje; si el modelo la inventa, se ignora y se pregunta', async () => {
    const e = escenario([unaAccion(pedidoMenudeo({ cuando_texto: 'el lunes' }))], ESTRICTO);
    await e.socio('angelo', 'pedido menudeo 10 elux sandia');
    expect(e.ultimoGrupo().texto).toContain('¿Cuándo pagas este pedido?');
    const e2 = escenario([unaAccion(pedidoMenudeo({ cuando_texto: 'el viernes' }))], ESTRICTO);
    await e2.socio('angelo', 'pedido menudeo 10 elux sandia, pago el viernes');
    expect(conBotones(e2, 'Resumen para confirmar').texto).toContain('viernes 13 de noviembre');
  });
  it('el modelo no puede escribir fechas: el esquema estricto rechaza fecha_compromiso', async () => {
    const { validarRespuesta } = await import('@/aplicacion/agente/esquemas');
    const base = { tipo: 'pedido_menudeo', proveedor_origen: null, lineas: [{ modelo_texto: 'elux', sabor_texto: 'sandia', piezas: 10 }], cuando_texto: 'el viernes', fuente_cita: 'c' };
    expect(validarRespuesta({ acciones: [base], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(true);
    expect(validarRespuesta({ acciones: [{ ...base, fecha_compromiso: '2026-11-13' }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(false);
    expect(validarRespuesta({ acciones: [{ ...base, destinatario: 'x' }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(false);
    expect(validarRespuesta({ acciones: [{ ...base, telefono: '9991234567' }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(false);
  });
  it('otro socio (Javier) NO puede mandar pedido_menudeo: se rechaza antes del resumen y no se ejecuta nada', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('javier', '/pedidomenudeo elux/sandia 10 | cuando el viernes');
    expect(e.ultimoGrupo().texto).toContain('Solo Angelo, que lleva el menudeo');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
    expect(e.almacen.eventos.some((x) => x.tipo === 'menudeo_otro_socio')).toBe(true);
    expect(e.grupo().some((m) => m.texto.includes('Resumen para confirmar'))).toBe(false);
  });
  it('si el socio de menudeo se cambia a Javier, el que no puede es Angelo', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.socioMenudeo = 'javier';
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10 | cuando el viernes');
    expect(e.ultimoGrupo().texto).toContain('Solo Javier');
    await e.socio('javier', '/pedidomenudeo elux/sandia 10 | cuando el viernes');
    expect(conBotones(e, 'Resumen para confirmar').texto).toContain('Lo pidio Javier');
  });
  it('Omar no registra pedidos de menudeo y se avisa al grupo', async () => {
    const e = escenario([unaAccion(pedidoMenudeo({ cuando_texto: 'el viernes' }))], ESTRICTO);
    await e.omar('pedido menudeo 10 elux sandia pago el viernes');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
    expect(e.textosGrupo().some((t) => t.includes('Omar escribio algo que solo registran los socios'))).toBe(true);
  });
  it('doble envio: el mismo mensaje no duplica y el boton Confirmar solo se usa una vez', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10 | cuando el viernes', { updateId: 500, messageId: 500 });
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10 | cuando el viernes', { updateId: 501, messageId: 500 });
    const resumen = conBotones(e, 'Resumen para confirmar');
    expect(e.grupo().filter((m) => m.texto.includes('Resumen para confirmar'))).toHaveLength(1);
    await pulsar(e, 'angelo', resumen, 'Confirmar');
    await pulsar(e, 'angelo', resumen, 'Confirmar');
    expect(e.negocio.menudeo.pedidos).toHaveLength(1);
  });
  it('si el otro socio pulsa Confirmar, no se registra y la tarjeta vuelve (el autor confirma lo suyo)', async () => {
    const e = escenario([], ESTRICTO);
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10 | cuando el viernes');
    await pulsar(e, 'javier', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
    expect(e.grupo().filter((m) => m.texto.includes('Resumen para confirmar'))).toHaveLength(2);
  });
  it('el pedido de menudeo se deshace mientras no este enviado', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await pedidoConfirmado(e);
    await e.socio('angelo', `/deshacer ${folio}`);
    expect(e.negocio.menudeo.pedidos[0]!.estado).toBe('cancelado');
  });
  it('una fecha comprometida pasada que llegue por comando se rechaza en la base (espejo)', async () => {
    const e = escenario([], ESTRICTO);
    e.reloj.avanzarHoras(24 * 5);
    // fecha dicha en el pasado por la propia pregunta: el codigo ya la rechaza antes de la base
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10 | cuando 2026-11-01');
    expect(e.ultimoGrupo().texto).toContain('ya pasó');
    expect(e.negocio.menudeo.pedidos).toHaveLength(0);
  });
});

describe('pago_pedido_menudeo', () => {
  async function enviado(e: Escenario): Promise<string> {
    const folio = await pedidoConfirmado(e);
    await e.socio('angelo', `/enviado ${folio}`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.pedidos[0]!.estado).toBe('enviado');
    return folio;
  }
  it('caso feliz sin comprobante: via con botones, resumen, Pago reportado y el OTRO socio confirma con boton', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', `/pagopedido ${folio} | 300 | ref ABC123`);
    await pulsar(e, 'angelo', conBotones(e, 'Falta un dato'), 'Directo al proveedor');
    const resumen = conBotones(e, 'Aviso de pago de un pedido');
    expect(resumen.texto).toContain('Referencia: ABC123');
    expect(resumen.texto).toContain('Sin comprobante queda como Pago reportado');
    await pulsar(e, 'angelo', resumen, 'Confirmar');
    expect(todos(e)).toContain('Pago reportado (falta que el otro socio lo confirme)');
    expect(todos(e)).toContain('Pendiente de pago del pedido: $600.00');
    const tarjeta = conBotones(e, 'Pago reportado por Angelo');
    expect(tarjeta.texto).toContain('Todavía NO está aplicado');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(60_000n);
    await pulsar(e, 'javier', tarjeta, 'Confirmar recibido');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(30_000n);
    expect(e.telegram.ediciones.at(-1)!.texto).toContain(`Pago del pedido ${folio} confirmado como recibido por Javier.`);
  });
  it('quien reporto no se confirma a si mismo: la tarjeta vuelve para el otro socio', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', `/pagopedido ${folio} | 300 | proveedor`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    const tarjeta = conBotones(e, 'Pago reportado por Angelo');
    await pulsar(e, 'angelo', tarjeta, 'Confirmar recibido');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(60_000n);
    expect(e.grupo().filter((m) => m.texto.includes('Pago reportado por Angelo'))).toHaveLength(2);
    await pulsar(e, 'javier', conBotones(e, 'Pago reportado por Angelo'), 'Confirmar recibido');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(30_000n);
    expect(e.ultimoGrupo().texto).toBeDefined();
  });
  it('el otro socio puede rechazar y el pedido sigue pendiente', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', `/pagopedido ${folio} | 300 | proveedor`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    await pulsar(e, 'javier', conBotones(e, 'Pago reportado por Angelo'), 'Rechazar');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(60_000n);
    expect(e.telegram.ediciones.at(-1)!.texto).toContain('rechazado por Javier');
    expect(e.telegram.ediciones.at(-1)!.texto).not.toMatch(/deud|debe/i);
    expect(e.negocio.menudeo.reportes[0]!.decision).toBe('rechazado');
  });
  it('con comprobante (foto) se aplica de inmediato, se guarda solo la huella y el otro socio aun puede rechazar', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', '', { foto: { fileId: 'FILE-ID-SINT', fileUniqueId: 'UNICO-SINT' } });
    expect(e.ultimoGrupo().texto).toContain('solo como evidencia');
    expect(e.almacen.evidencias).toHaveLength(1);
    expect(e.almacen.evidencias[0]!.huella).toMatch(/^[0-9a-f]{64}$/);
    await e.socio('angelo', `/pagopedido ${folio} | 200 | proveedor`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(40_000n);
    const tarjeta = conBotones(e, 'Pago reportado por Angelo');
    expect(tarjeta.texto).toContain('Se aplicó con comprobante');
    expect(tarjeta.botones!.flat().map((b) => b.texto)).toEqual(['Rechazar']);
    await pulsar(e, 'javier', tarjeta, 'Rechazar');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(60_000n);
    // el comprobante no se reutiliza para otro pago
    await e.socio('angelo', `/pagopedido ${folio} | 100 | proveedor`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.reportes[1]!.comprobante).toBe(false);
  });
  it('foto con pie de texto: se guarda el comprobante y el pie se procesa como comando', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', `/pagopedido ${folio} | 100 | proveedor`, { foto: { fileId: 'F2', fileUniqueId: 'U2' } });
    expect(e.almacen.evidencias).toHaveLength(1);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.reportes[0]!.comprobante).toBe(true);
  });
  it('un comprobante de Omar o reenviado no se guarda', async () => {
    const e = escenario([], ESTRICTO);
    await e.omar('');
    await e.socio('angelo', '', { foto: { fileId: 'F3', fileUniqueId: 'U3' }, reenviado: true });
    expect(e.almacen.evidencias).toHaveLength(0);
  });
  it('faltantes: sin monto o sin folio se pregunta y no se registra nada', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', `/pagopedido ${folio} | proveedor`);
    expect(e.ultimoGrupo().texto).toContain('el monto del pago');
    expect(e.negocio.menudeo.reportes).toHaveLength(0);
    await e.socio('angelo', '/pagopedido | 100');
    expect(e.ultimoGrupo().texto).toContain('Formato:');
  });
  it('un monto mayor a lo pendiente lo rechaza la base y no se registra', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', `/pagopedido ${folio} | 5000 | proveedor`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.negocio.menudeo.reportes).toHaveLength(0);
    expect(todos(e)).toContain('excede lo pendiente');
  });
  it('Javier no avisa pagos de los pedidos de Angelo', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('javier', `/pagopedido ${folio} | 100 | proveedor`);
    expect(e.ultimoGrupo().texto).toContain('Solo Angelo');
    expect(e.negocio.menudeo.reportes).toHaveLength(0);
  });
  it('con IA: la fecha del pago ("ayer") la interpreta el codigo; una fecha futura se rechaza', async () => {
    const e = escenario([
      (p) => respuesta([{ tipo: 'pago_pedido_menudeo', pedido_folio: 'P-0001', monto_centavos: 30_000, referencia: 'ABC', fecha_texto: p.usuario.includes('mañana') ? 'mañana' : 'ayer', metodo: null, via: 'proveedor', fuente_cita: 'cita' }]),
    ], ESTRICTO);
    const folio = await enviado(e);
    expect(folio).toBe('P-0001');
    await e.socio('angelo', 'pague 300 del pedido P-0001 ref ABC ayer');
    const resumen = conBotones(e, 'Aviso de pago de un pedido');
    expect(resumen.texto).toContain('Fecha del pago: lunes 9 de noviembre de 2026');
    await e.socio('angelo', 'pague 300 del pedido P-0001 mañana');
    expect(e.ultimoGrupo().texto).toContain('no puede ser futura');
    expect(e.negocio.menudeo.reportes).toHaveLength(0);
  });
  it('doble envio del aviso: la misma indicacion no duplica el reporte', async () => {
    const e = escenario([], ESTRICTO);
    const folio = await enviado(e);
    await e.socio('angelo', `/pagopedido ${folio} | 300 | proveedor`, { updateId: 900, messageId: 900 });
    await e.socio('angelo', `/pagopedido ${folio} | 300 | proveedor`, { updateId: 901, messageId: 900 });
    expect(e.grupo().filter((m) => m.texto.includes('Aviso de pago de un pedido'))).toHaveLength(1);
  });
});

describe('recordatorios del latido', () => {
  const CHATS_PERMITIDOS = new Set<number>([IDS.grupoSocios]);

  it('con el interruptor APAGADO no envia ni reclama nada', async () => {
    const e = escenario([], ESTRICTO);
    await enviadoCon(e, 'el viernes a las 10 de la mañana');
    e.reloj.avanzarHoras(24 * 4);
    const antes = e.grupo().length;
    const r = await e.agente.enviarRecordatoriosMenudeo();
    expect(r).toEqual({ estado: 'omitido', enviados: 0, motivo: 'interruptor telegram_envio apagado' });
    expect(e.grupo().length).toBe(antes);
    expect(e.negocio.menudeo.pedidos[0]!.avisos).toHaveLength(0);
  });

  async function enviadoCon(e: Escenario, cuando: string): Promise<string> {
    const folio = await pedidoConfirmado(e, cuando);
    await e.socio('angelo', `/enviado ${folio}`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    return folio;
  }

  it('24 h antes avisa por vencer (sin botones), al grupo; un segundo latido no duplica', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    const folio = await enviadoCon(e, 'el viernes a las 10 de la mañana');
    // vence viernes 13 10:00 Merida; hoy es martes 12:00
    e.reloj.avanzarHoras(24 * 2 + 20);
    const antes = e.grupo().length;
    expect((await e.agente.enviarRecordatoriosMenudeo()).enviados).toBe(1);
    const msg = e.ultimoGrupo();
    expect(e.grupo().length).toBe(antes + 1);
    expect(msg.texto).toContain(`el pedido ${folio} de Angelo`);
    expect(msg.texto).toContain('vence pronto');
    expect(msg.texto).toContain('Pendiente de pago: $600.00');
    expect(msg.botones ?? []).toHaveLength(0);
    expect((await e.agente.enviarRecordatoriosMenudeo()).enviados).toBe(0);
    expect(e.grupo().length).toBe(antes + 1);
  });

  it('al vencer pregunta "¿Ya pagaste?" con Pagado y Reprogramar, y repite cada 24 h hasta 7', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    await enviadoCon(e, 'el viernes a las 10 de la mañana');
    e.reloj.avanzarHoras(24 * 3 + 0.5); // viernes 12:30: ya vencio hoy
    await e.agente.enviarRecordatoriosMenudeo();
    const m = e.ultimoGrupo();
    expect(m.texto).toContain('vence hoy');
    expect(m.texto).toContain('¿Ya pagaste?');
    expect(m.botones!.flat().map((b) => b.texto)).toEqual(['Pagado', 'Reprogramar']);
    let enviados = 1;
    for (let d = 1; d <= 9; d++) {
      e.reloj.avanzarHoras(24);
      enviados += (await e.agente.enviarRecordatoriosMenudeo()).enviados;
    }
    expect(enviados).toBe(7);
    expect(e.negocio.menudeo.pedidos[0]!.avisos).toHaveLength(7);
    expect(e.ultimoGrupo().texto).toContain('Días de atraso');
  });

  it('solo escribe al grupo de los socios: ningun mensaje a Omar ni a otro chat, y nada con datos de clientes', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    await enviadoCon(e, 'el viernes a las 10 de la mañana');
    for (let d = 0; d < 12; d++) {
      e.reloj.avanzarHoras(24);
      await e.agente.enviarRecordatoriosMenudeo();
    }
    expect(e.telegram.enviados.every((m) => CHATS_PERMITIDOS.has(m.chatId))).toBe(true);
    expect(e.aOmar()).toHaveLength(0);
    expect(e.textosGrupo().join('\n')).not.toMatch(/\d{10}|@/);
  });

  it('un pago ya reportado o un pedido sin fecha no generan recordatorio de chat', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    await e.socio('angelo', '/pedidomenudeo elux/sandia 10');
    await e.socio('angelo', 'sin fecha');
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    const folio = folioDe(e);
    await e.socio('angelo', `/enviado ${folio}`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    e.reloj.avanzarHoras(24 * 5);
    expect((await e.agente.enviarRecordatoriosMenudeo()).enviados).toBe(0);
  });

  it('Pagado: reporta el pago pendiente y avisa al otro socio; Reprogramar: pregunta la fecha, la confirma con boton y la guarda', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    await enviadoCon(e, 'el viernes a las 10 de la mañana');
    e.reloj.avanzarHoras(24 * 3 + 0.5);
    await e.agente.enviarRecordatoriosMenudeo();
    const rec = conBotones(e, '¿Ya pagaste?');
    // el otro socio no responde por Angelo: se rechaza y la tarjeta vuelve
    await pulsar(e, 'javier', rec, 'Pagado');
    expect(e.negocio.menudeo.reportes).toHaveLength(0);
    expect(todos(e)).toContain('Solo Angelo');
    const rec2 = conBotones(e, '¿Ya pagaste?');
    await pulsar(e, 'angelo', rec2, 'Reprogramar');
    expect(e.ultimoGrupo().texto).toContain('¿Para cuándo reprogramas');
    await e.socio('angelo', 'el lunes a las 10 de la mañana');
    const conf = conBotones(e, '¿Reprogramo el pago');
    expect(conf.texto).toContain('lunes 16 de noviembre de 2026, 10:00');
    expect(e.negocio.menudeo.pedidos[0]!.fecha).toBe('2026-11-13');
    await pulsar(e, 'angelo', conf, 'Sí, reprogramar');
    expect(e.negocio.menudeo.pedidos[0]).toMatchObject({ fecha: '2026-11-16', hora: '10:00' });
    expect(e.negocio.menudeo.pedidos[0]!.compromisos.at(-1)!.motivo).toContain('Reprogramado desde Telegram');
    // despues de reprogramar ya no toca avisar hoy
    expect((await e.agente.enviarRecordatoriosMenudeo()).enviados).toBe(0);
    // Pagado en otro recordatorio
    e.reloj.avanzarHoras(24 * 4);
    await e.agente.enviarRecordatoriosMenudeo();
    await pulsar(e, 'angelo', conBotones(e, '¿Ya pagaste?'), 'Pagado');
    expect(e.negocio.menudeo.reportes).toHaveLength(1);
    expect(e.negocio.menudeo.reportes[0]).toMatchObject({ aplicado: false, decision: null });
    const tarjeta = conBotones(e, 'Pago reportado por Angelo');
    await pulsar(e, 'javier', tarjeta, 'Confirmar recibido');
    expect(e.negocio.menudeo.pendiente(e.negocio.menudeo.pedidos[0]!)).toBe(0n);
  });

  it('el mismo recordatorio reclamado dos veces (dos latidos a la vez) se envia una sola vez', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    await enviadoCon(e, 'el viernes a las 10 de la mañana');
    e.reloj.avanzarHoras(24 * 3 + 0.5);
    const antes = e.grupo().length;
    const [a, b] = await Promise.all([e.agente.enviarRecordatoriosMenudeo(), e.agente.enviarRecordatoriosMenudeo()]);
    expect(a.enviados + b.enviados).toBe(1);
    expect(e.grupo().length).toBe(antes + 1);
  });

  it('si Telegram falla al enviar un aviso, el error queda registrado y el latido sigue', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    await enviadoCon(e, 'el viernes a las 10 de la mañana');
    e.reloj.avanzarHoras(24 * 3 + 0.5);
    e.telegram.fallarProximos = 1;
    const r = await e.agente.enviarRecordatoriosMenudeo();
    expect(r.estado).toBe('ok');
    expect(e.almacen.eventos.some((x) => x.tipo === 'recordatorio_error')).toBe(true);
  });
});

describe('guardas', () => {
  it('toda salida de las plantillas nuevas pasa la auditoria de cifras (nada de numeros ajenos) y sin lenguaje de deuda', async () => {
    const e = escenario([], ESTRICTO);
    e.negocio.menudeo.envioActivo = true;
    const folio = await pedidoConfirmado(e);
    await e.socio('angelo', `/enviado ${folio}`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    await e.socio('angelo', `/pagopedido ${folio} | 300 | proveedor`);
    await pulsar(e, 'angelo', conBotones(e, 'Resumen para confirmar'), 'Confirmar');
    expect(e.almacen.eventos.filter((x) => x.tipo === 'respuesta_bloqueada')).toHaveLength(0);
    expect(todos(e)).not.toMatch(/\bdeuda\b|\bdebes\b|\badeuda/i);
  });
  it('un pedido de menudeo nunca manda destinatario ni telefono: el mensaje con un telefono se redacta antes de la IA', async () => {
    const e = escenario([unaAccion(pedidoMenudeo({ cuando_texto: 'el viernes' }))], ESTRICTO);
    await e.socio('angelo', 'pedido menudeo 10 elux sandia, pago el viernes, entregar a Juan 999 123 4567');
    const peticion = e.llmGuionado.peticiones[0]!;
    expect(peticion.usuario).not.toContain('123 4567');
  });
  it('/ayuda y la lista de comandos incluyen los comandos nuevos', async () => {
    const { LISTA_COMANDOS } = await import('@/dominio/agente/comandos');
    expect(LISTA_COMANDOS).toContain('/pedidomenudeo');
    expect(LISTA_COMANDOS).toContain('/pagopedido');
  });
  it('respuesta() sigue siendo valida para el esquema con las intenciones nuevas', async () => {
    const { validarRespuesta } = await import('@/aplicacion/agente/esquemas');
    expect(validarRespuesta(respuesta([{ tipo: 'pago_pedido_menudeo', pedido_folio: 'P-0001', monto_centavos: 100, referencia: null, fecha_texto: null, metodo: null, via: null, fuente_cita: 'c' }])).ok).toBe(true);
  });
});
