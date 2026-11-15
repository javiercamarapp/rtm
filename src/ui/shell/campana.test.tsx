// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { auditar, montar, teclear, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, porTestid } from '@/ui/graficas/pruebas/formularios';
import type { ListaCampana } from '@/dominio/notificaciones/tipos';
import { Campana } from './campana';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const montajes: Montaje[] = [];
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); });

const lista = (sinLeer: number): ListaCampana => ({
  filtro: 'sin_leer', pagina: 0, hay_mas: false, sin_leer: sinLeer,
  notificaciones: [{ id: 7, titulo: 'Stock bajo', severidad: 'I', leida: false, estado: 'abierta', conteo: 1, creado_at: '2026-11-14T10:00:00Z', entidad_tipo: null, entidad_id: null } as unknown as ListaCampana['notificaciones'][number]],
});

function render() {
  const cargar = vi.fn(async () => lista(1));
  const marcar = vi.fn(async () => undefined);
  const marcarTodas = vi.fn(async () => undefined);
  const m = montar(<Campana noLeidas={1} cargar={cargar} marcar={marcar} marcarTodas={marcarTodas} />, 'off');
  montajes.push(m);
  return { m, cargar, marcar, marcarTodas };
}
const boton = (m: Montaje) => m.cont.querySelector<HTMLButtonElement>('.rtm-campana-boton')!;

describe('Campana (panel de avisos)', () => {
  it('abre, lista avisos y cada boton funciona: pestanas, marcar leido, marcar todo, ver todos', async () => {
    const { m, cargar, marcar, marcarTodas } = render();
    await clic(boton(m));
    expect(porTestid(m.cont, 'campana-panel')).not.toBeNull();
    expect(boton(m).getAttribute('aria-expanded')).toBe('true');
    expect(cargar).toHaveBeenCalledWith('sin_leer');
    expect(porTestid(m.cont, 'campana-item')!.textContent).toContain('Stock bajo');
    await clic(porTestid(m.cont, 'campana-todas'));
    expect(cargar).toHaveBeenCalledWith('todas');
    await clic([...m.cont.querySelectorAll('button')].find((b) => b.textContent === 'Marcar leído')!);
    expect(marcar).toHaveBeenCalledWith(7);
    await clic([...m.cont.querySelectorAll('button')].find((b) => b.textContent === 'Marcar todo como leído')!);
    expect(marcarTodas).toHaveBeenCalled();
    expect(m.cont.querySelector('a[href="/avisos"]')!.textContent).toBe('Ver todos');
    expect(await auditar(m.cont)).toEqual([]);
  });

  it('Escape y clic fuera cierran; Escape devuelve el foco al boton', async () => {
    const { m } = render();
    await clic(boton(m));
    act(() => teclear(document.body, 'Escape'));
    expect(porTestid(m.cont, 'campana-panel')).toBeNull();
    expect(document.activeElement).toBe(boton(m));
    await clic(boton(m));
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(porTestid(m.cont, 'campana-panel')).toBeNull();
  });
});
