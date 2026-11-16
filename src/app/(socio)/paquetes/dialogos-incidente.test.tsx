// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, escribir, porTestid, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import { DialogoReportarEntrada, DialogoReportarSalida, DialogoResolver } from './dialogos-incidente';

const correr = vi.fn();
vi.mock('../operacion/usar-accion', () => ({
  useAccion: () => ({ correr, ocupado: false, error: null, limpiarError: () => undefined }),
  centavosDeTexto: (t: string) => { const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; },
}));
vi.mock('./lineas-salida', () => ({
  lineasSalida: async () => [{ linea_id: 11, sku_id: 5, modelo: 'Jupiter 50K', sabor: 'Mango', surtidas: 20, reportadas: 5 }],
}));

const montajes: Montaje[] = [];
beforeAll(simularDialogo);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); correr.mockClear(); });
const montarEl = (el: React.ReactElement) => { const x = montar(el); montajes.push(x); return x.cont; };
const confirmar = (cont: ParentNode) => clic(porTestid(cont, 'confirmar'));
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('DialogoResolver', () => {
  it('salida con la sociedad: pide que pasa con el cliente y manda la bonificacion con motivo', async () => {
    const cont = montarEl(<DialogoResolver incidente={{ id: 4, folio: 'PQ-0004', sentido: 'salida' }} />);
    await clic(porTestid(cont, 'resolver-4'));
    expect(cont.textContent).toContain('Quién absorbe la pérdida');
    expect(cont.textContent).toContain('La sociedad (pérdida en la utilidad)');
    expect(cont.textContent).not.toContain('El proveedor');
    await confirmar(cont);
    expect(correr).not.toHaveBeenCalled();
    expect(cont.textContent).toContain('Escribe el motivo.');
    escribir(cont.querySelector('textarea[aria-label="Motivo"]'), 'la sociedad absorbe');
    await confirmar(cont);
    expect(correr).toHaveBeenCalledWith('resolver_paquete_incidente', { p_incidente: 4, p_responsable: 'sociedad', p_socio: null, p_accion: 'bonificar', p_motivo: 'la sociedad absorbe', p_guia: null }, expect.any(Function));
  });

  it('salida con reposicion: la guia del reenvio lleva su costo en centavos y quien la pago', async () => {
    const cont = montarEl(<DialogoResolver incidente={{ id: 5, folio: 'PQ-0005', sentido: 'salida' }} />);
    await clic(porTestid(cont, 'resolver-5'));
    escribir(cont.querySelector('select[aria-label="Qué pasa con el cliente"]'), 'reponer');
    escribir(cont.querySelector('input[aria-label="Guía del reenvío"]'), 'G-77');
    escribir(cont.querySelector('input[aria-label="Costo de la guía del reenvío"]'), '90');
    escribir(cont.querySelector('textarea[aria-label="Motivo"]'), 'se repone');
    await confirmar(cont);
    const [accion, args] = correr.mock.calls[0]!;
    expect(accion).toBe('resolver_paquete_incidente');
    expect(args).toMatchObject({ p_accion: 'reponer', p_guia: { paqueteria: 'Paquetería', numero: 'G-77', costo_cent: 9000 } });
  });

  it('el cliente asume: no manda accion ni guia', async () => {
    const cont = montarEl(<DialogoResolver incidente={{ id: 6, folio: 'PQ-0006', sentido: 'salida' }} />);
    await clic(porTestid(cont, 'resolver-6'));
    escribir(cont.querySelector('select[aria-label="Responsable"]'), 'cliente');
    expect(cont.querySelector('select[aria-label="Qué pasa con el cliente"]')).toBeNull();
    escribir(cont.querySelector('textarea[aria-label="Motivo"]'), 'rechazo la entrega');
    await confirmar(cont);
    expect(correr.mock.calls[0]![1]).toMatchObject({ p_responsable: 'cliente', p_accion: null, p_guia: null });
  });

  it('entrada con un socio: ofrece al proveedor, no al cliente, y manda el socio', async () => {
    const cont = montarEl(<DialogoResolver incidente={{ id: 7, folio: 'PQ-0007', sentido: 'entrada' }} />);
    await clic(porTestid(cont, 'resolver-7'));
    expect(cont.textContent).toContain('El proveedor (reclamo)');
    expect(cont.textContent).not.toContain('El cliente');
    escribir(cont.querySelector('select[aria-label="Responsable"]'), 'socio');
    escribir(cont.querySelector('select[aria-label="Socio responsable"]'), 'Javier');
    escribir(cont.querySelector('textarea[aria-label="Motivo"]'), 'lo resuelve Javier');
    await confirmar(cont);
    expect(correr.mock.calls[0]![1]).toMatchObject({ p_incidente: 7, p_responsable: 'socio', p_socio: 'Javier', p_accion: null });
    expect(await auditar(cont)).toEqual([]);
  });
});

describe('DialogoReportarSalida', () => {
  it('lee los renglones surtidos, limita a lo no reportado y manda sabor y piezas', async () => {
    const cont = montarEl(<DialogoReportarSalida pedidoId={9} folio="P-0009" />);
    await clic(porTestid(cont, 'reportar-salida-9'));
    await esperar(); await esperar();
    expect(cont.textContent).toContain('JUPITER 50K · MANGO (salieron 20 pz, ya reportadas 5 pz)');
    escribir(cont.querySelector('input[aria-label="Piezas afectadas de Jupiter 50K Mango"]'), '16');
    escribir(cont.querySelector('textarea[aria-label="Detalle del incidente"]'), 'se perdio');
    await confirmar(cont);
    expect(correr).not.toHaveBeenCalled();
    expect(cont.textContent).toContain('enteros entre 1 y lo que aún no se ha reportado');
    escribir(cont.querySelector('input[aria-label="Piezas afectadas de Jupiter 50K Mango"]'), '15');
    await confirmar(cont);
    expect(correr).toHaveBeenCalledWith('reportar_paquete_salida', { p_pedido: 9, p_tipo: 'perdido', p_detalle: 'se perdio', p_lineas: [{ linea_id: 11, sku_id: 5, piezas: 15 }] }, expect.any(Function));
  });
});

describe('DialogoReportarEntrada', () => {
  const renglones = [{ linea_id: 21, modelo: 'Karen A', sabor: 'Mango', facturadas: 50 }];
  it('perdido: confirma la recepcion con cero piezas sanas', async () => {
    const cont = montarEl(<DialogoReportarEntrada compraId={3} folio="C-0003" renglones={renglones} />);
    await clic(porTestid(cont, 'reportar-entrada-3'));
    escribir(cont.querySelector('textarea[aria-label="Detalle del incidente"]'), 'la paqueteria perdio la caja');
    await confirmar(cont);
    expect(correr).toHaveBeenCalledWith('reportar_paquete_entrada', { p_compra: 3, p_tipo: 'perdido', p_detalle: 'la paqueteria perdio la caja', p_recibido: [] }, expect.any(Function));
  });
  it('danado: pide las piezas sanas por sabor y rechaza si todo llego sano', async () => {
    const cont = montarEl(<DialogoReportarEntrada compraId={3} folio="C-0003" renglones={renglones} />);
    await clic(porTestid(cont, 'reportar-entrada-3'));
    escribir(cont.querySelector('select[aria-label="Tipo de incidente"]'), 'danado');
    escribir(cont.querySelector('textarea[aria-label="Detalle del incidente"]'), 'mojadas');
    escribir(cont.querySelector('input[aria-label="Sanas de Karen A Mango"]'), '50');
    await confirmar(cont);
    expect(correr).not.toHaveBeenCalled();
    expect(cont.textContent).toContain('no hay incidente');
    escribir(cont.querySelector('input[aria-label="Sanas de Karen A Mango"]'), '40');
    await confirmar(cont);
    expect(correr.mock.calls[0]![1]).toMatchObject({ p_tipo: 'danado', p_recibido: [{ linea_id: 21, sabor: 'Mango', piezas: 40 }] });
  });
});
