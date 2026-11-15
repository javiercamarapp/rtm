// Adaptadores del carril frenos: lo que dice la base (duplicado, sobrepago, eco rico, interruptor, lease) se traduce a tipos de TypeScript sin tocar una cifra.
import { describe, it, expect } from 'vitest';
import { AlmacenAgenteDb, NegocioAgenteDb, aEcoRico, preguntaDuplicado, preguntaExceso, preparar } from '@/infra/agente/postgres';
import type { Sql } from '@/infra/postgres/servidor';
import type { AccionResuelta, ContextoEjecucion } from '@/aplicacion/agente/puertos';
import type { Miembro } from '@/dominio/agente/tipos';
import * as F from '@/aplicacion/agente/plantillas_frenos';

const angelo: Miembro = { telegramUserId: 1001, persona: 'angelo', rol: 'socio' };

function sqlFalso(respuestas: Record<string, unknown>) {
  const llamadas: Array<{ fn: string; args: readonly unknown[] }> = [];
  const sql = (async (texto: string, args: readonly unknown[] = []) => {
    const fn = /agente\.(\w+)\(/.exec(texto)![1]!;
    llamadas.push({ fn, args });
    return [{ j: respuestas[fn] }];
  }) as unknown as Sql;
  return { sql, llamadas };
}

const pagoResuelto: AccionResuelta = {
  intencion: { tipo: 'pago', cliente_texto: 'Cliente Norte', monto_centavos: 100_000, cuenta_destino_texto: 'Efectivo', pedido_folio: null, fuente_cita: 'c' },
  resoluciones: { clienteId: '7', proveedorId: null, lineas: [], modeloId: null },
};
const ctx = (extra: Partial<ContextoEjecucion> = {}): ContextoEjecucion => ({ autor: angelo, claveIdem: 'tg:1:0', origen: { updateId: 1, chatId: 1, messageId: 1 }, ahora: new Date(0), confirmado: false, ...extra });

describe('frenos: traduccion de lo que dice la base', () => {
  it('posible_duplicado de la base se vuelve pregunta con el folio previo y los minutos (cifras de SQL)', async () => {
    const { sql } = sqlFalso({ ejecutar: { posible_duplicado: true, folio_previo: 'PG-0001', autor_previo: 'javier', tipo: 'pago_cliente', hace_min: 3, resumen: { cliente: 'Cliente Norte', monto_cent: 100000 } } });
    const r = await new NegocioAgenteDb(sql).ejecutar(pagoResuelto, ctx());
    expect(r).toMatchObject({ tipo: 'pregunta', clave: 'duplicado', motivo: 'posible_duplicado' });
    if (r.tipo === 'pregunta') {
      expect(r.texto).toContain('Javier');
      expect(r.cifras).toContainEqual({ tipo: 'folio', etiqueta: 'Registrado antes', folio: 'PG-0001' });
      expect(r.cifras).toContainEqual({ tipo: 'piezas', etiqueta: 'Minutos desde entonces', piezas: 3 });
    }
  });

  it('pregunta_exceso de la base se vuelve pregunta (no tope) con lo que debe el cliente', () => {
    const r = preguntaExceso({ monto_cent: 85_550_000, debe_cent: 1_180_000, cliente: 'Cliente Norte' });
    expect(r).toMatchObject({ tipo: 'pregunta', clave: 'exceso' });
  });

  it('las respuestas afirmativas del socio viajan a la base como banderas de la indicacion', () => {
    const p = preparar(pagoResuelto, ctx({ permitirDuplicado: true, confirmoExceso: true }), '2026-11-14');
    expect(p?.args).toMatchObject({ permitir_duplicado: true, confirmo_exceso: true });
    expect(preparar(pagoResuelto, ctx(), '2026-11-14')?.args).not.toHaveProperty('permitir_duplicado');
  });

  it('el interruptor apagado (P0463) se responde como solo lectura, no como error inesperado', async () => {
    const sql = (async () => { throw Object.assign(new Error('el agente esta en solo lectura desde 10:00'), { code: 'P0463' }); }) as unknown as Sql;
    const r = await new NegocioAgenteDb(sql).ejecutar(pagoResuelto, ctx());
    expect(r).toMatchObject({ tipo: 'rechazado', codigo: 'solo_lectura' });
  });

  it('eco_rico: cliente, cuenta, pedidos aplicados y saldos pasan a BigInt sin recalcular', () => {
    const e = aEcoRico({ cliente: 'Cliente Norte', cuenta: 'Efectivo', pedidos_aplicados: [{ folio: 'P-0004', monto_cent: 660000 }], saldo_antes_cent: 1180000, saldo_despues_cent: 520000, a_favor_cent: 0 });
    expect(e).toMatchObject({ cliente: 'Cliente Norte', cuenta: 'Efectivo', saldoAntesCent: 1_180_000n, saldoDespuesCent: 520_000n });
    expect(e?.pedidosAplicados).toEqual([{ folio: 'P-0004', montoCent: 660_000n }]);
    const m = F.deshechoConEco('Se deshizo PG-0001', 'X-0001', e, []);
    expect(m.texto).toContain('Aplicado al pedido P-0004: $6,600.00');
    expect(m.registro.auditar(m.texto)).toEqual([]);
  });

  it('el almacen llama a las funciones SQL del interruptor, del lease y de la migracion', async () => {
    const { sql, llamadas } = sqlFalso({
      escritura_estado: { activa: false, desde: '2026-11-16T16:00:00Z', por: 'sistema', motivo: 'anomalia' },
      fijar_escritura: { cambio: true }, revisar_anomalia: { apagado: false }, reclamar_update2: 'reprocesar', terminar_update: null,
      updates_pendientes: [{ update_id: 5, cuerpo: { update_id: 5 }, intentos: 1 }], updates_abandonados: [{ update_id: 6, recibido_at: '2026-11-16T16:00:00Z' }], migrar_chat: { migrado: true },
    });
    const a = new AlmacenAgenteDb(sql);
    expect((await a.escrituraEstado()).activa).toBe(false);
    expect(await a.fijarEscritura(true, angelo, 'x')).toBe(true);
    expect(await a.reclamarUpdate2(5, { update_id: 5 })).toBe('reprocesar');
    await a.terminarUpdate(5, 'terminado');
    expect((await a.updatesPendientes(10))[0]?.updateId).toBe(5);
    expect((await a.updatesAbandonados())[0]?.updateId).toBe(6);
    expect(await a.migrarChat(-1, -2)).toBe(true);
    expect(llamadas.map((l) => l.fn)).toEqual(['escritura_estado', 'fijar_escritura', 'reclamar_update2', 'terminar_update', 'updates_pendientes', 'updates_abandonados', 'migrar_chat']);
    expect(llamadas[1]!.args).toEqual([true, 'angelo', 1001, 'x']);
  });

  it('preguntaDuplicado sin resumen no inventa cifras', () => {
    const r = preguntaDuplicado({ folio_previo: null, autor_previo: 'angelo', tipo: 'gasto', hace_min: 0 });
    expect(r.tipo).toBe('pregunta');
  });
});
