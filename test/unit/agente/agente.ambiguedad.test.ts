import { describe, it, expect } from 'vitest';
import { escenario, pedido, pago, toma, unaAccion, consulta, IDS } from './ayudas';

describe('criterio: "Omar" a secas y "Waka 50" siempre preguntan', () => {
  it('Omar a secas en un pedido de un socio: pregunta entre la bodega y el cliente; no ejecuta', async () => {
    const e = escenario([unaAccion(pedido('Omar', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Omar 28 jupiter');
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('¿cual cliente es "Omar"?');
    const opciones = q.botones!.flat().map((b) => b.texto);
    expect(opciones).toContain('Toma de Omar (bodega)');
    expect(opciones).toContain('Omar Ejemplo (cliente)');
    expect(opciones).toContain('Otro');
    expect(opciones).toContain('Cancelar');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.negocio.existenciaDe('m3')).toBe(100);
  });

  it('elegir "cliente" ejecuta el pedido a ese cliente', async () => {
    const e = escenario([unaAccion(pedido('Omar', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Omar 28 jupiter');
    const q = e.ultimoGrupo();
    const fila = q.botones!.findIndex((f) => f[0]!.texto === 'Omar Ejemplo (cliente)');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, fila);
    expect(e.negocio.saldoCliente('c3')).toBe(700_000n);
    expect(e.textosGrupo().at(-1)).toContain('Pedido de Omar Ejemplo');
  });

  it('elegir "bodega" convierte el pedido en TOMA pendiente (no en venta)', async () => {
    const e = escenario([unaAccion(pedido('Omar', [['elux', 3]]))]);
    await e.socio('angelo', 'Omar 3 elux');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0);
    expect(e.ultimoGrupo().texto).toContain('pendiente de autorizacion');
    expect(e.negocio.estadoToma('T-0001')).toBe('pendiente');
    expect(e.negocio.saldoCliente('c3')).toBe(0n);
  });

  it('tambien con el comando sin IA: /pedido Omar | ...', async () => {
    const e = escenario();
    await e.socio('javier', '/pedido Omar | jupiter 28');
    expect(e.ultimoGrupo().texto).toContain('¿cual cliente es "Omar"?');
    expect(e.llmGuionado.llamadas).toBe(0);
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it.each(['Waka 50', 'waka 50k', 'WAKA 50'])('"%s" pregunta cual variante (con las tres opciones)', async (txt) => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [[txt, 28]]))]);
    await e.socio('angelo', `Cliente Norte 28 ${txt}`);
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('¿cual modelo es');
    const opciones = q.botones!.flat().map((b) => b.texto);
    expect(opciones).toEqual(expect.arrayContaining(['Waka Icon 50K', 'Waka Blast 50K', 'Waka Jupiter 50K']));
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('contestar la pregunta resuelve y ejecuta con el modelo elegido', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['waka 50', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 waka 50');
    const q = e.ultimoGrupo();
    const fila = q.botones!.findIndex((f) => f[0]!.texto === 'Waka Blast 50K');
    await e.pulsar(IDS.javier, IDS.grupoSocios, q, fila);
    expect(e.negocio.existenciaDe('m2')).toBe(2);
    expect(e.negocio.existenciaDe('m1')).toBe(12);
    expect(e.textosGrupo().at(-1)).toContain('Registrado P-0001');
    // La tarjeta de la pregunta se edita y sus otras opciones dejan de valer.
    expect(e.telegram.ediciones.at(-1)!.texto).toContain('Elegido: Waka Blast 50K');
    const otra = q.botones!.findIndex((f) => f[0]!.texto === 'Waka Icon 50K');
    const r = await e.pulsar(IDS.angelo, IDS.grupoSocios, q, otra);
    expect(r).toEqual({ estado: 'boton', resultado: 'usado' });
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });

  it('alias compartido entre dos clientes: pregunta', async () => {
    const e = escenario([unaAccion(pago('gemelo', 100_000))]);
    await e.socio('angelo', 'pago gemelo 1,000');
    expect(e.ultimoGrupo().botones!.flat().map((b) => b.texto)).toEqual(expect.arrayContaining(['Gemelo Uno', 'Gemelo Dos']));
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('cliente inexistente: no inventa, ofrece sugerencias y no ejecuta', async () => {
    const e = escenario([unaAccion(pago('Cliente Nrte', 100_000))]);
    await e.socio('angelo', 'pago Cliente Nrte 1,000');
    const t = e.ultimoGrupo();
    expect(t.texto).toContain('no encontre cliente');
    expect(t.botones!.flat().map((b) => b.texto)).toContain('Cliente Norte');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('cliente totalmente desconocido: pide el nombre completo', async () => {
    const e = escenario([unaAccion(pago('Zzzzzzzzz', 100_000))]);
    await e.socio('angelo', 'pago Zzzzzzzzz 1,000');
    expect(e.ultimoGrupo().texto).toContain('Escribe el nombre completo');
  });

  it('sabor sin existencia: pregunta con los sabores EN EXISTENCIA del modelo', async () => {
    const e = escenario([unaAccion(toma([['elux', 2, 'fresa']]))]);
    await e.socio('angelo', 'toma 2 elux fresa');
    const opciones = e.ultimoGrupo().botones!.flat().map((b) => b.texto);
    expect(opciones).toEqual(expect.arrayContaining(['Sandia', 'Mango']));
  });

  it('proveedor: un nombre que no es Isaac, Karen ni Vapemate no es alias y dos proveedores en una orden se preguntan', async () => {
    const e = escenario([
      unaAccion({ tipo: 'pago_proveedor', proveedor_texto: 'Proveedor Ajeno', monto_centavos: 100_000, pagado_por: 'angelo', cliente_texto: null, intencion: null, fuente_cita: 'cita' }),
      unaAccion({ tipo: 'pago_proveedor', proveedor_texto: 'Isaac y Karen', monto_centavos: 100_000, pagado_por: 'angelo', cliente_texto: null, intencion: null, fuente_cita: 'cita' }),
    ]);
    await e.socio('angelo', 'pague 1,000 a Proveedor Ajeno');
    expect(e.ultimoGrupo().texto).toContain('no encontre proveedor');
    await e.socio('angelo', 'pague 1,000 a Isaac y Karen');
    expect(e.ultimoGrupo().botones!.flat().map((b) => b.texto)).toEqual(expect.arrayContaining(['Isaac', 'Karen']));
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('maximo 3 preguntas seguidas: a la cuarta se cancela con aviso', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['waka 50', 28], ['waka 50', 24], ['waka 50', 20], ['waka 50', 22]]))], {});
    await e.socio('angelo', 'Cliente Norte 28 waka 50 24 waka 50 20 waka 50 22 waka 50');
    for (let i = 0; i < 3; i++) {
      const q = e.ultimoGrupo();
      expect(q.botones).toBeDefined();
      await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0);
    }
    expect(e.textosGrupo().at(-1)).toContain('demasiadas preguntas');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('"Otro" pide escribir el nombre y "Cancelar" cancela', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['waka 50', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 waka 50');
    const q = e.ultimoGrupo();
    const ultima = q.botones!.length - 1;
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, ultima, 1); // Cancelar
    expect(e.telegram.ediciones.at(-1)!.texto).toBe('Cancelado.');
    const e2 = escenario([unaAccion(pedido('Cliente Norte', [['waka 50', 28]]))]);
    await e2.socio('angelo', 'Cliente Norte 28 waka 50');
    const q2 = e2.ultimoGrupo();
    await e2.pulsar(IDS.angelo, IDS.grupoSocios, q2, q2.botones!.length - 1, 0); // Otro
    expect(e2.telegram.ediciones.at(-1)!.texto).toContain('Escribe el nombre completo');
  });

  it('una pregunta caduca a las 24 horas', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['waka 50', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 waka 50');
    const q = e.ultimoGrupo();
    e.reloj.avanzarHoras(25);
    expect(await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0)).toEqual({ estado: 'boton', resultado: 'caducado' });
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('consulta con modelo ambiguo tambien pregunta (Waka 50 en inventario)', async () => {
    const e = escenario([unaAccion(consulta('inventario', { modelo_texto: 'waka 50' }))]);
    await e.socio('angelo', 'cuanto hay de waka 50');
    expect(e.ultimoGrupo().texto).toContain('¿cual modelo es');
  });

  it('una consulta con modelo claro responde con cifras del servidor', async () => {
    const e = escenario([unaAccion(consulta('inventario', { modelo_texto: 'jupiter' }))]);
    await e.socio('angelo', 'cuanto hay de jupiter');
    expect(e.ultimoGrupo().texto).toContain('Waka Jupiter 50K: 100 pz');
  });
});
