// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, escribir, porTestid, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import type { ModeloTablero } from '@/dominio/proveedores/tablero';
import { BarraLectura } from './barra-lectura';
import { TableroKaren, type PropsTablero } from './tablero-karen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const montajes: Montaje[] = [];
beforeAll(simularDialogo);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); window.history.replaceState(null, '', '/'); });

const sab = (n: string, d: boolean, v = 0) => ({ variante_id: `v-${n}`, sabor: n, disponible: d, inestable: false, sabor_canonico_id: '1', ventas_60d: v, existencia_propia: 2, cambio_en: '2026-11-14T10:00:00Z', cambio_tipo: d ? 'sabor_regreso' : 'sabor_agotado' });
const M = (id: string, o: Partial<ModeloTablero> = {}): ModeloTablero => ({
  producto_id: id, handle: `modelo-${id}`, marca: id === '1' ? 'Marca A' : 'Marca B', titulo: id === '1' ? 'Alfa 8000' : 'Beta', puffs: 8000, estado: 'activo', primera_vez: '2026-11-13T00:00:00Z', nuevo_semana: id === '2', mapeo: 'confirmado',
  canonico_id: '1', canonico_nombre: 'Alfa', sin_sabores: false, nuevo_sin_costo: false, ventas_60d: id === '1' ? 20 : 0, ventas_30d: 0, vendemos: id === '1', existencia_propia: id === '1' ? 3 : 0, cobertura_dias: id === '1' ? 9 : null,
  sabores: [sab('Sandía', true, 10), sab('Mango', false)], eventos: [{ clave: `e${id}`, tipo: 'sabor_regreso', en: '2026-11-14T10:00:00Z', antes: null, despues: 'Sandía', sabor: 'Sandía' }], ...o,
});
const props = (o: Partial<PropsTablero> = {}): PropsTablero => ({
  modelos: [M('1'), M('2')], recomendaciones: [{ producto_id: '1', titulo: 'Alfa 8000', marca: 'Marca A', motivos: ['reponer'], ventas_60d: 20, existencia_propia: 3, cobertura_dias: 9, sabores_sugeridos: ['Sandía'] }],
  eventos: [{ clave: 'g1', tipo: 'modelo_nuevo', en: '2026-11-14T10:00:00Z', antes: null, despues: null, modelo: 'Beta' }], porConfirmar: 1, promociones: [], ahoraIso: '2026-11-14T12:00:00Z', consultaInicial: '', sinLectura: false, fotos: {}, ...o,
});
const render = (p: PropsTablero) => { const m = montar(<TableroKaren {...p} />); montajes.push(m); return m; };
const tarjetas = (m: Montaje) => m.cont.querySelectorAll('[data-testid="rejilla"] > li').length;

describe('TableroKaren', () => {
  it('muestra una tarjeta por modelo, avisos y recomendacion, sin violaciones de axe', async () => {
    const m = render(props());
    expect(tarjetas(m)).toBe(2);
    expect(m.cont.textContent).toContain('Conviene pedir Alfa 8000');
    expect(porTestid(m.cont, 'resumen')!.textContent).toContain('2 de 2 modelos');
    expect(await auditar(m.cont)).toEqual([]);
  });

  it('la busqueda en vivo filtra y deja el estado en la URL', () => {
    const m = render(props());
    escribir(porTestid(m.cont, 'buscar'), 'beta');
    expect(tarjetas(m)).toBe(1);
    expect(window.location.search).toBe('?q=beta');
    expect(porTestid(m.cont, 'resumen')!.textContent).toContain('1 de 2 modelos');
  });

  it('los filtros arrancan desde la URL y se pueden limpiar', async () => {
    const m = render(props({ consultaInicial: 'vendemos=1' }));
    expect(tarjetas(m)).toBe(1);
    await clic(porTestid(m.cont, 'limpiar'));
    expect(tarjetas(m)).toBe(2);
  });

  it('sin resultados muestra estado vacio con salida', () => {
    const m = render(props({ consultaInicial: 'q=zzzz' }));
    expect(porTestid(m.cont, 'vacio-sin-resultados')).not.toBeNull();
    expect(porTestid(m.cont, 'vacio-sin-lecturas')).toBeNull();
  });

  it('sin lecturas: estado vacio elegante y sin violaciones de axe', async () => {
    const m = render(props({ modelos: [], recomendaciones: [], eventos: [], porConfirmar: 0, sinLectura: true }));
    expect(porTestid(m.cont, 'vacio-sin-lecturas')!.textContent).toContain('Todavía no hay lecturas de Karen');
    expect(await auditar(m.cont)).toEqual([]);
  });

  it('abrir un modelo muestra el panel con sabores, ventas y existencia; cerrar lo quita', async () => {
    const m = render(props());
    await clic(porTestid(m.cont, 'modelo-1'));
    const panel = porTestid(m.cont, 'panel-modelo')!;
    expect(panel.hasAttribute('open')).toBe(true);
    expect(panel.textContent).toContain('Sandía');
    expect(panel.textContent).toContain('Agotado');
    expect(panel.textContent).toContain('Vendes 10 pz');
    expect(panel.textContent).toContain('Recomendación');
    expect(window.location.search).toBe('?m=1');
    expect(await auditar(m.cont)).toEqual([]);
    await clic(porTestid(m.cont, 'cerrar-panel'));
    expect(panel.hasAttribute('open')).toBe(false);
  });

  it('la tarjeta sin foto usa marcador con iniciales y con foto muestra la imagen local', () => {
    const sin = render(props());
    expect(sin.cont.querySelector('.rtm-kr-foto[data-sin-foto]')).not.toBeNull();
    const con = render(props({ fotos: { 'modelo-1': '/proveedores/karen/modelo-1.webp' } }));
    expect(con.cont.querySelector('img')!.getAttribute('src')).toBe('/proveedores/karen/modelo-1.webp');
  });
});

describe('BarraLectura', () => {
  const f = { lectura_activa: false, peticiones_hoy: 0, tope_dia: 40, ultimo_intento: null, bloqueada: false, ultima_lectura_ok: null, desactualizado: true };
  it('con el interruptor apagado el boton esta bloqueado con mensaje claro y nunca llama a la accion', async () => {
    const actualizar = vi.fn();
    const m = montar(<BarraLectura frescura={f} ahoraIso="2026-11-14T12:00:00Z" actualizar={actualizar} />);
    montajes.push(m);
    expect((porTestid(m.cont, 'actualizar-ahora') as HTMLButtonElement).disabled).toBe(true);
    expect(porTestid(m.cont, 'nota-actualizar')!.textContent).toContain('apagada');
    expect(m.cont.textContent).toContain('0');
    expect(m.cont.textContent).toContain('de 40');
    expect(actualizar).not.toHaveBeenCalled();
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('encendido llama a la accion y muestra su resultado', async () => {
    const actualizar = vi.fn().mockResolvedValue({ estado: 'bloqueada', motivo: 'tope_diario', mensaje: 'Se alcanzó el tope de 40 peticiones de hoy. Mañana se renueva.' });
    const m = montar(<BarraLectura frescura={{ ...f, lectura_activa: true, desactualizado: false, ultima_lectura_ok: '2026-11-14T09:00:00Z' }} ahoraIso="2026-11-14T12:00:00Z" actualizar={actualizar} />);
    montajes.push(m);
    await clic(porTestid(m.cont, 'actualizar-ahora'));
    await act(async () => { await Promise.resolve(); });
    expect(actualizar).toHaveBeenCalledTimes(1);
    expect(porTestid(m.cont, 'nota-actualizar')!.textContent).toContain('tope de 40');
  });
});
