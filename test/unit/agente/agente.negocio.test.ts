import { describe, it, expect } from 'vitest';
import { escenario, pedido, pago, unaAccion, consulta, IDS } from './ayudas';
import { respuesta } from '@/infra/agente/llm_simulado';
import type { Intencion } from '@/dominio/agente/intenciones';

const ocKaren = (lineas: Array<[string, number]>, aplicar = true): Intencion => ({
  tipo: 'orden_compra',
  proveedor_texto: 'Karen',
  lineas: lineas.map(([m, p]) => ({ modelo_texto: m, sabor_texto: null, piezas: p })),
  aplicar_saldo: aplicar,
  fuente_cita: 'cita',
});

describe('adenda 23: cuenta con proveedor y orden de compra (cifras doradas)', () => {
  it('"Angel mando 30,500 a Karen": sube el saldo a favor y baja la cuenta por cobrar del cliente', async () => {
    const e = escenario([
      unaAccion(pedido('Cliente Norte', [['jupiter', 40]])),
      unaAccion({ tipo: 'pago_proveedor', proveedor_texto: 'Karen', monto_centavos: 3_050_000, pagado_por: 'sociedad', cliente_texto: 'Cliente Norte', fuente_cita: 'cita' }),
    ]);
    await e.socio('angelo', 'Cliente Norte 40 jupiter');
    expect(e.negocio.saldoCliente('c1')).toBe(1_000_000n);
    await e.socio('angelo', 'Cliente Norte mando 30,500 a Karen');
    expect(e.negocio.cuentaCon('karen')).toBe(3_050_000n);
    expect(e.negocio.saldoCliente('c1')).toBe(-2_050_000n);
    expect(e.ultimoGrupo().texto).toContain('Cuenta con Karen (a favor): $30,500.00');
  });

  it('saldo a favor de 30,500 con Karen y OC de 22,000 deja 8,500 a favor', async () => {
    const e = escenario([unaAccion(ocKaren([['nexa', 100], ['sopro', 75]]))]);
    e.negocio.ponerSaldoProveedor('karen', 3_050_000n);
    await e.socio('angelo', 'pidele a Karen 100 nexa y 75 sopro');
    const t = e.ultimoGrupo().texto;
    expect(t).toContain('Total de la orden: $22,000.00');
    expect(t).toContain('Saldo a favor aplicado: $22,000.00');
    expect(t).toContain('Cuenta con el proveedor (a favor): $8,500.00');
    expect(e.negocio.cuentaCon('karen')).toBe(850_000n);
  });

  it('OC de 40,000 con saldo de 30,500 deja 9,500 por pagar (cuenta negativa) y Karen queda en borrador', async () => {
    const e = escenario([unaAccion(ocKaren([['nexa', 200], ['sopro', 120], ['jupiter', 0 + 1]]))]);
    e.negocio.ponerSaldoProveedor('karen', 3_050_000n);
    await e.socio('angelo', 'pidele a Karen 200 nexa 120 sopro 1 jupiter');
    // 200 x 130 + 120 x 120 + 1 x 230 = 26,000 + 14,400 + 230 = 40,630
    expect(e.negocio.cuentaCon('karen')).toBe(3_050_000n - 4_063_000n);
    expect(e.ultimoGrupo().texto).toContain('Karen exige pago completo antes de enviar');
    expect(e.ultimoGrupo().texto).toContain('(se debe)');
  });

  it('"Pague 12,000 a Isaac desde mi cuenta": pago de socio al proveedor', async () => {
    const e = escenario([unaAccion({ tipo: 'pago_proveedor', proveedor_texto: 'Isaac', monto_centavos: 1_200_000, pagado_por: 'javier', cliente_texto: null, fuente_cita: 'cita' })]);
    await e.socio('javier', 'pague 12,000 a Isaac desde mi cuenta');
    expect(e.negocio.cuentaCon('isaac')).toBe(1_200_000n);
  });

  it('"Vapemate" es Karen: la OC y los saldos van a la misma cuenta', async () => {
    const e = escenario([unaAccion({ ...ocKaren([['nexa', 10]], false), proveedor_texto: 'Vapemate' } as Intencion), unaAccion(consulta('saldo_proveedor', { sujeto_texto: 'karen' }))]);
    await e.socio('angelo', 'pidele a vapemate 10 nexa');
    await e.socio('angelo', 'saldo con karen 1');
    expect(e.ultimoGrupo().texto).toBe('Cuenta con Karen\n- A favor: $0.00');
  });
});

describe('adenda 21: gastos y aportaciones de socios', () => {
  it('gasto pagado por un socio genera reembolso; la aportacion se devuelve; ambos con eco y saldo', async () => {
    const e = escenario([
      unaAccion({ tipo: 'gasto', gasto: 'envio', monto_centavos: 50_000, pagado_por: 'angelo', descripcion: null, fuente_cita: 'cita' }),
      unaAccion({ tipo: 'aportacion', socio: 'javier', monto_centavos: 100_000, motivo: null, intencion: null, fuente_cita: 'cita' }),
    ]);
    await e.socio('angelo', 'pague 500 de envio');
    expect(e.ultimoGrupo().texto).toContain('Reembolso pendiente a angelo: $500.00');
    await e.socio('javier', 'puse 1,000 mas de capital');
    expect(e.ultimoGrupo().texto).toContain('Por devolver a javier: $1,000.00');
    expect(e.negocio.deudaCon('angelo')).toBe(50_000n);
    expect(e.negocio.deudaCon('javier')).toBe(100_000n);
  });
});

describe('preguntas antes de ejecutar (las decide el servidor)', () => {
  it('precio fuera del tabulador: pregunta con las dos cifras; "Si, continuar" ejecuta UNA vez', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28, null, '$230']]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter a $230');
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('no es el del tabulador');
    expect(q.texto).toContain('Precio dicho: $230.00');
    expect(q.texto).toContain('Precio del tabulador: $250.00');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    await e.pulsar(IDS.javier, IDS.grupoSocios, q, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(1);
    const r = await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0, 0);
    expect(r).toEqual({ estado: 'boton', resultado: 'usado' });
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });

  it('precio igual al del tabulador: no pregunta', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28, null, '$250']]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter a $250');
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });

  it('menos de 20 piezas y existencia insuficiente se preguntan', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 5]])), unaAccion(pedido('Cliente Norte', [['icon', 25]]))]);
    await e.socio('angelo', 'Cliente Norte 5 jupiter');
    expect(e.ultimoGrupo().texto).toContain('menos de 20 piezas');
    await e.socio('angelo', 'Cliente Norte 25 icon');
    expect(e.ultimoGrupo().texto).toContain('No hay existencia suficiente de Waka Icon 50K');
    expect(e.ultimoGrupo().texto).toContain('Disponible: 12 pz');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('monto casi igual a un saldo abierto (digitos transpuestos): pregunta', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['nexa', 51]])), unaAccion(pago('Cliente Norte', 756_000))]);
    await e.socio('angelo', 'Cliente Norte 51 nexa'); // saldo 7,650.00
    await e.socio('angelo', 'pago Cliente Norte 7,560');
    expect(e.ultimoGrupo().texto).toContain('digitos en otro orden');
    expect(e.negocio.saldoCliente('c1')).toBe(765_000n);
  });

  it('cliente sin precio para ese modelo: el servidor rechaza y dice como proceder', async () => {
    const e = escenario([unaAccion(pedido('Omar Ejemplo', [['nexa', 30]]))]);
    await e.socio('angelo', 'Omar Ejemplo 30 nexa');
    expect(e.ultimoGrupo().texto).toContain('no tiene precio para Nexa 50K');
  });

  it('cliente conocido pero indicado como bodega en un pago: no se acepta', async () => {
    const e = escenario([unaAccion(pago('Omar', 100_000))]);
    await e.socio('angelo', 'pago Omar 1,000');
    const q = e.ultimoGrupo();
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0); // Toma de Omar (bodega): un pago no puede ser de la bodega
    expect(e.ultimoGrupo().texto).toContain('no encontre cliente');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });
});

describe('deshacer: contramovimiento con ventana de 10 minutos', () => {
  it('un toque dentro de la ventana y sin dependencias revierte existencias y saldo, y deja un contramovimiento enlazado', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    const eco = e.ultimoGrupo();
    e.reloj.avanzarMin(3);
    await e.pulsar(IDS.javier, IDS.grupoSocios, eco, 0);
    expect(e.negocio.existenciaDe('m3')).toBe(100);
    expect(e.negocio.saldoCliente('c1')).toBe(0n);
    expect(e.ultimoGrupo().texto).toContain('Deshecho con el contramovimiento X-0001');
    expect(e.ultimoGrupo().texto).toContain('Contramovimiento de P-0001');
    expect(e.negocio.aplicaciones).toEqual(['pedido:P-0001', 'contra_pedido:X-0001']);
  });

  it('fuera de la ventana (11 min): pide indicacion expresa y solo entonces deshace', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    const eco = e.ultimoGrupo();
    // el boton caduca a los 10 min: se usa /deshacer
    e.reloj.avanzarMin(11);
    expect(await e.pulsar(IDS.angelo, IDS.grupoSocios, eco, 0)).toEqual({ estado: 'boton', resultado: 'caducado' });
    await e.socio('angelo', '/deshacer');
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('Pasaron mas de 10 minutos desde P-0001');
    expect(e.negocio.existenciaDe('m3')).toBe(72);
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0, 0);
    expect(e.negocio.existenciaDe('m3')).toBe(100);
  });

  it('con dependencias (un pago aplicado despues): las muestra y pide indicacion expresa', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]])), unaAccion(pago('Cliente Norte', 300_000))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    const eco = e.ultimoGrupo();
    await e.socio('angelo', 'pago Cliente Norte 3,000');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, eco, 0);
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('El folio P-0001 tiene dependencias:');
    expect(q.texto).toContain('Pago aplicado despues: PG-0001');
    expect(e.negocio.existenciaDe('m3')).toBe(72); // todavia no se deshizo
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0, 1); // Cancelar
    expect(e.negocio.existenciaDe('m3')).toBe(72);
  });

  it('/deshacer sin nada que deshacer, y deshacer un folio ya deshecho, no hacen nada', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', '/deshacer');
    expect(e.ultimoGrupo().texto).toBe('No encontre que deshacer.');
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    await e.socio('angelo', '/deshacer P-0001');
    await e.socio('angelo', '/deshacer P-0001');
    expect(e.negocio.existenciaDe('m3')).toBe(100);
    expect(e.negocio.aplicaciones.filter((a) => a.startsWith('contra_'))).toHaveLength(1);
    expect(e.ultimoGrupo().texto).toBe('No encontre que deshacer.');
  });

  it('el servidor rechaza deshacer un folio inexistente o ya deshecho', async () => {
    const e = escenario();
    const autor = { telegramUserId: IDS.angelo, persona: 'angelo' as const, rol: 'socio' as const };
    expect(await e.negocio.deshacer({ folio: 'P-9999', autor, claveIdem: 'k1' })).toMatchObject({ tipo: 'rechazado', codigo: 'no_existe' });
    await e.socio('angelo', '/pedido Cliente Norte | jupiter 28');
    const a = await e.negocio.deshacer({ folio: 'P-0001', autor, claveIdem: 'k2' });
    expect(a.tipo).toBe('deshecho');
    expect(await e.negocio.deshacer({ folio: 'P-0001', autor, claveIdem: 'k3' })).toMatchObject({ tipo: 'rechazado', codigo: 'ya_deshecho' });
    const repetido = await e.negocio.deshacer({ folio: 'P-0001', autor, claveIdem: 'k2' });
    expect(repetido).toMatchObject({ tipo: 'deshecho', repetido: true });
  });

  it('deshacer pagos, gastos, aportaciones, compras, ordenes y pagos a proveedor restituye el estado', async () => {
    const e = escenario();
    const antes = () => [e.negocio.saldoCliente('c1'), e.negocio.deudaCon('angelo'), e.negocio.deudaCon('javier'), e.negocio.cuentaCon('karen'), e.negocio.cuentaCon('isaac'), e.negocio.existenciaDe('m8')];
    const inicial = antes();
    for (const cmd of ['/pago Cliente Norte | 1000', '/gasto uber 120 javier', '/aporte angelo 500', '/compra karen | nexa 10', '/oc karen | nexa 10 | saldo', '/pagoprov isaac | 700 | angelo']) {
      await e.socio('angelo', cmd);
      await e.socio('angelo', '/deshacer');
    }
    expect(antes()).toEqual(inicial);
  });
});

describe('consultas', () => {
  it('saldo de socios, precio del cliente, pendientes y consulta aun no disponible', async () => {
    const e = escenario([
      unaAccion(consulta('saldo', { sujeto_texto: 'socios' })),
      unaAccion(consulta('precio', { sujeto_texto: 'Cliente Sur', modelo_texto: 'jupiter' })),
      unaAccion(consulta('resumen', { periodo: 'hoy' })),
      unaAccion(consulta('saldo', { sujeto_texto: 'Cliente Norte' })),
    ]);
    await e.socio('angelo', 'saldo de socios 1');
    expect(e.ultimoGrupo().texto).toContain('Por devolver a Angelo: $0.00');
    await e.socio('angelo', 'precio jupiter Cliente Sur 1');
    expect(e.ultimoGrupo().texto).toBe('Precio de Cliente Sur\n- Waka Jupiter 50K: $240.00');
    await e.socio('angelo', 'resumen de hoy 1');
    expect(e.ultimoGrupo().texto).toContain('no disponible todavia');
    await e.socio('angelo', 'saldo de Cliente Norte 1');
    expect(e.ultimoGrupo().texto).toBe('Saldo del cliente\n- Saldo abierto: $0.00');
  });

  it('la consulta de ayuda no usa el servidor y no lleva numeros', async () => {
    const e = escenario([unaAccion(consulta('ayuda'))]);
    await e.socio('angelo', 'que puedes hacer?');
    expect(e.ultimoGrupo().texto).toContain('Comandos: /pedido');
  });

  it('el modelo piensa en hacerlo mal: un tipo de intencion de escritura no ejecutable se rechaza sin tocar nada', async () => {
    const e = escenario();
    const r = await e.negocio.ejecutar({ intencion: respuesta([{ tipo: 'ninguna' }]).acciones[0]!, resoluciones: { clienteId: null, proveedorId: null, lineas: [], modeloId: null } }, { autor: { telegramUserId: 1, persona: 'angelo', rol: 'socio' }, claveIdem: 'z', origen: { updateId: 1, chatId: 1, messageId: 1 }, ahora: e.reloj.ahora(), confirmado: false });
    expect(r).toMatchObject({ tipo: 'rechazado', codigo: 'intencion_no_ejecutable' });
  });
});
