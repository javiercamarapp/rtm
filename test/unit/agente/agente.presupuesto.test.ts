import { LISTA_COMANDOS } from '@/dominio/agente/comandos';
import { describe, it, expect } from 'vitest';
import { escenario, pedido, pago, unaAccion, IDS } from './ayudas';
import { TOPE_MES_MICRO, estadoInicial } from '@/dominio/agente/presupuesto';
import { fechaNeg } from '@/dominio/calendario';
import { INICIO_SIMULADO } from '@/composicion/agente';
import { LlmGuionado } from '@/infra/agente/llm_simulado';
import { crearAgenteEnMemoria } from '@/composicion/agente';
import { updateTexto } from '@/infra/agente/updates';
import { AlmacenPresupuestoMemoria } from '@/infra/agente/memoria';

const HOY = fechaNeg(new Date(INICIO_SIMULADO));

describe('criterio: el presupuesto se reserva antes de cada llamada y corta al tope', () => {
  it('la reserva ya existe cuando el modelo recibe la peticion, y se liquida con el costo real', async () => {
    let comprometidoDuranteLaLlamada = -1n;
    const hRef: { h?: ReturnType<typeof crearAgenteEnMemoria> } = {};
    const llm2 = new LlmGuionado([
      () => {
        comprometidoDuranteLaLlamada = hRef.h!.presupuesto.snapshot()?.diaMicro ?? 0n;
        return unaAccion(pedido('Cliente Norte', [['jupiter', 28]]));
      },
    ], 200n);
    const h2 = crearAgenteEnMemoria({ llm: llm2 });
    hRef.h = h2;
    await h2.agente.procesarUpdate(updateTexto(h2.contador, { de: IDS.angelo, chat: IDS.grupoSocios, texto: 'Cliente Norte 28 jupiter' }));
    expect(comprometidoDuranteLaLlamada).toBeGreaterThan(200n); // peor caso reservado ANTES de llamar
    expect(h2.presupuesto.snapshot()!.diaMicro).toBe(200n); // despues: el costo real
    expect(h2.presupuesto.snapshot()!.mesMicro).toBe(200n);
  });

  it('corta al tope: al agotarse el rol de texto ya no hay mas llamadas y entra el modo sin IA con aviso unico', async () => {
    // Cada llamada cuesta US$0.30; el rol de texto tiene US$0.55 al dia.
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 20]]))], { costoMicroUsd: 300_000n });
    await e.socio('angelo', 'Cliente Norte 20 jupiter');
    await e.socio('angelo', 'Cliente Norte 21 jupiter');
    expect(e.llmGuionado.llamadas).toBe(2);
    const r = await e.socio('angelo', 'Cliente Norte 22 jupiter');
    expect(r).toEqual({ estado: 'sin_ia' });
    expect(e.llmGuionado.llamadas).toBe(2); // la tercera NO llamo al modelo
    expect(e.textosGrupo().filter((t) => t.startsWith('Modo sin IA activo'))).toHaveLength(1);
    expect((await e.almacen.modoSinIa()).motivo).toBe('tope_presupuesto');
    // Mensajes siguientes: sin IA y sin repetir el aviso.
    await e.socio('angelo', 'Cliente Norte 23 jupiter');
    expect(e.llmGuionado.llamadas).toBe(2);
    expect(e.textosGrupo().filter((t) => t.startsWith('Modo sin IA activo'))).toHaveLength(1);
    expect(e.presupuesto.snapshot()!.diaMicro).toBeLessThanOrEqual(1_000_000n);
  });

  it('la alerta del 80 % del dia llega una sola vez al grupo', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 20]]))], { costoMicroUsd: 270_000n });
    await e.socio('angelo', 'Cliente Norte 20 jupiter'); // 270k
    await e.socio('angelo', 'Cliente Norte 21 jupiter'); // 540k
    expect(e.textosGrupo().some((t) => t.startsWith('Alerta'))).toBe(false);
    await e.socio('angelo', 'Cliente Norte 22 jupiter'); // 810k: cruza el 80 %
    expect(e.textosGrupo().filter((t) => t.startsWith('Alerta'))).toEqual(['Alerta: el gasto de IA del dia llego al 80 % del tope.']);
    await e.socio('angelo', 'Cliente Norte 23 jupiter'); // ya no hay presupuesto de texto: modo sin IA, sin otra alerta
    expect(e.textosGrupo().filter((t) => t.startsWith('Alerta'))).toHaveLength(1);
  });

  it('el tope mensual de US$30 tambien corta', async () => {
    const casiLleno = { ...estadoInicial(HOY), mesMicro: TOPE_MES_MICRO - 100n };
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 20]]))], { presupuestoInicial: casiLleno });
    const r = await e.socio('angelo', 'Cliente Norte 20 jupiter');
    expect(r).toEqual({ estado: 'sin_ia' });
    expect(e.llmGuionado.llamadas).toBe(0);
  });

  it('una reparacion tambien reserva y liquida (maximo 2 reservas por mensaje)', async () => {
    const invalida = { acciones: [], sospecha_inyeccion: false };
    const e = escenario([invalida, invalida], { costoMicroUsd: 1_000n });
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    expect(e.presupuesto.snapshot()!.diaMicro).toBe(2_000n);
  });

  it('reserva idempotente por clave y liquidacion/liberacion repetidas no descuadran', async () => {
    const p = new AlmacenPresupuestoMemoria();
    expect((await p.reservar({ clave: 'a', rol: 'texto', microUsd: 500n, fechaNeg: HOY })).ok).toBe(true);
    expect(await p.reservar({ clave: 'a', rol: 'texto', microUsd: 500n, fechaNeg: HOY })).toEqual({ ok: true, avisos: [] });
    await p.liquidar('a', 300n);
    await p.liquidar('a', 900n); // segunda liquidacion: sin efecto
    await p.liberar('a'); // ya liquidada: sin efecto
    await p.liberar('no-existe');
    await p.liquidar('no-existe', 1n);
    expect(p.snapshot()!.diaMicro).toBe(300n);
    await p.reservar({ clave: 'b', rol: 'texto', microUsd: 400n, fechaNeg: HOY });
    await p.liberar('b');
    expect(p.snapshot()!.diaMicro).toBe(300n);
  });
});

describe('modo sin IA', () => {
  it('/sinia lo activa con aviso unico y la lista de comandos', async () => {
    const e = escenario();
    await e.socio('angelo', '/sinia');
    await e.socio('angelo', '/sinia');
    const avisos = e.textosGrupo().filter((t) => t.startsWith('Modo sin IA activo'));
    expect(avisos).toEqual([`Modo sin IA activo. Uso: ${LISTA_COMANDOS}`]);
  });

  it('/conia lo desactiva y el texto libre vuelve a usar el modelo', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', '/sinia');
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    expect(e.llmGuionado.llamadas).toBe(0);
    await e.socio('angelo', '/conia');
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    expect(e.llmGuionado.llamadas).toBe(1);
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
});

describe('criterio: el modo sin IA responde a los comandos', () => {
  it('con IA apagada responden /pedido /pago /gasto /compra /stock /saldo /resumen /pendientes /deshacer, todos sin llamar al modelo', async () => {
    const e = escenario();
    await e.socio('angelo', '/sinia');

    await e.socio('angelo', '/pedido Cliente Norte | jupiter 28 | 24 nexa | envio 150');
    expect(e.ultimoGrupo().texto).toContain('Registrado P-0001 por Angelo');
    expect(e.ultimoGrupo().texto).toContain('Total: $10,750.00');
    expect(e.negocio.saldoCliente('c1')).toBe(1_075_000n);

    await e.socio('javier', '/pago Cliente Norte | 5000');
    expect(e.ultimoGrupo().texto).toContain('Saldo de Cliente Norte: $5,750.00');

    await e.socio('angelo', '/gasto guia 500 angelo');
    expect(e.ultimoGrupo().texto).toContain('Reembolso pendiente a angelo: $500.00');

    await e.socio('angelo', '/aporte javier 1000 mas de capital');
    expect(e.negocio.deudaCon('javier')).toBe(100_000n);

    await e.socio('angelo', '/compra karen | nexa 100');
    expect(e.negocio.cuentaCon('karen')).toBe(-1_300_000n);

    await e.socio('angelo', '/stock jupiter');
    expect(e.ultimoGrupo().texto).toBe('Existencia\n- Waka Jupiter 50K: 72 pz');

    await e.socio('angelo', '/saldo Cliente Norte');
    expect(e.ultimoGrupo().texto).toBe('Saldo del cliente\n- Saldo abierto: $5,750.00');

    await e.socio('angelo', '/saldo karen');
    expect(e.ultimoGrupo().texto).toContain('Se debe: −$13,000.00');

    await e.socio('angelo', '/pendientes');
    expect(e.ultimoGrupo().texto).toBe('Pendientes\n- Tomas por autorizar: 0 pz');

    await e.socio('angelo', '/ayuda');
    expect(e.ultimoGrupo().texto).toContain('Comandos: /pedido');

    await e.socio('angelo', '/deshacer');
    expect(e.ultimoGrupo().texto).toContain('Deshecho con el contramovimiento');

    expect(e.llmGuionado.llamadas).toBe(0);
  });

  it('un comando mal escrito devuelve el formato de uso, sin ejecutar', async () => {
    const e = escenario();
    await e.socio('angelo', '/pago Cliente Norte');
    expect(e.ultimoGrupo().texto).toBe('Formato: /pago Cliente | 7000');
    await e.socio('angelo', '/borrartodo');
    expect(e.ultimoGrupo().texto).toContain('Formato: /pedido, /pago');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('cuando el tope se agota, los comandos siguen funcionando', async () => {
    const casiLleno = { ...estadoInicial(HOY), mesMicro: TOPE_MES_MICRO };
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000))], { presupuestoInicial: casiLleno });
    await e.socio('angelo', 'pago Cliente Norte 1,000');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    await e.socio('angelo', '/pago Cliente Norte | 1000');
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.llmGuionado.llamadas).toBe(0);
  });

  it('un comando con ambiguedad tambien pregunta con botones (sin IA)', async () => {
    const e = escenario();
    await e.socio('angelo', '/sinia');
    await e.socio('angelo', '/pedido Cliente Norte | waka 50 28');
    expect(e.ultimoGrupo().texto).toContain('¿cual modelo es');
    const q = e.ultimoGrupo();
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, q.botones!.findIndex((f) => f[0]!.texto === 'Waka Jupiter 50K'));
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
});
