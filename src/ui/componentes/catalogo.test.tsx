// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { Galeria } from '@/ui/galeria/galeria';
import { DataTable } from './data-table';
import { BarList } from './datos';
import { KpiLinea } from './kpi';
import { EscalaSalud } from '../graficas';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => {
  while (montajes.length) montajes.pop()!.desmontar();
  fijarModo(null);
});

describe('galeria de componentes', () => {
  it('no tiene violaciones de axe (contraste lo mide el navegador)', async () => {
    const m = abrir(montar(<Galeria />, 'reduced'));
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('sin estilos en linea en el arbol de React (salvo posicion del tooltip, fuera del arbol)', () => {
    const m = abrir(montar(<Galeria />, 'reduced'));
    expect(m.cont.querySelectorAll('[style]:not(.rtm-g-tip)').length).toBe(0);
  });
});

describe('KpiLinea', () => {
  it('una celda sin dato dice "Sin dato" y no dibuja visuales ni delta', () => {
    const m = abrir(montar(<KpiLinea etiquetaAria="k" celdas={[{ id: 'a', etiqueta: 'A', valor: null, delta: { texto: '+1 %', sentido: 'sube' }, progreso: { pct: 50 } }]} />));
    expect(m.cont.textContent).toContain('Sin dato');
    expect(m.cont.querySelector('svg')).toBeNull();
    expect(m.cont.textContent).not.toContain('+1 %');
  });
  it('con menos de 2 puntos no hay sparkline; con 2 o mas si', () => {
    const base = { id: 'a', etiqueta: 'A', valor: '10' };
    const una = abrir(montar(<KpiLinea etiquetaAria="k" celdas={[{ ...base, spark: { etiquetas: ['x'], valores: [1], textos: ['1'] } }]} />));
    expect(una.cont.querySelector('.rtm-g-spark')).toBeNull();
    const dos = abrir(montar(<KpiLinea etiquetaAria="k" celdas={[{ ...base, spark: { etiquetas: ['x', 'y'], valores: [1, 2], textos: ['1', '2'] } }]} />));
    expect(dos.cont.querySelector('.rtm-g-spark')).not.toBeNull();
  });
  it('la celda con href es enlace', () => {
    const m = abrir(montar(<KpiLinea etiquetaAria="k" celdas={[{ id: 'a', etiqueta: 'A', valor: '1', href: '/x' }]} />));
    expect(m.cont.querySelector('a[href="/x"]')).not.toBeNull();
  });
});

describe('BarList y EscalaSalud', () => {
  it('pct nulo = pista rayada con raya, nunca 0 %', () => {
    const m = abrir(montar(<BarList etiquetaAria="b" items={[{ id: '1', etiqueta: 'A', texto: 'Sin dato', pct: null }, { id: '2', etiqueta: 'B', texto: '$1', pct: 40 }]} />));
    expect(m.cont.querySelector('[data-sin-dato]')).not.toBeNull();
    expect(m.cont.textContent).toContain('—');
    expect(m.cont.textContent).toContain('40 %');
  });
  it('la escala de salud lleva palabra y no usa degradados', () => {
    const m = abrir(montar(<EscalaSalud etiquetaAria="s" pct={62} texto="Atención" />));
    expect(m.cont.textContent).toContain('Atención');
    expect(m.html()).not.toContain('linearGradient');
  });
});

describe('DataTable v2', () => {
  const filas = [
    { id: 'a1', g: 'A', n: 'Alfa uno', v: 5 },
    { id: 'a2', g: 'A', n: 'Alfa dos', v: 0 },
    { id: 'b1', g: 'B', n: 'Beta uno', v: -3 },
  ];
  const tabla = (extra = {}) => (
    <DataTable
      etiqueta="t"
      filas={filas}
      clave={(f) => f.id}
      agrupar={{ clave: (f) => f.g, cabecera: (k) => ({ titulo: `Grupo ${k}` }) }}
      totales={{ etiqueta: 'Totales', celdas: { v: '2' } }}
      interactiva={{ busqueda: 'Buscar', porPagina: 25, exportar: 'x' }}
      columnas={[{ id: 'n', titulo: 'Nombre', celda: (f) => f.n }, { id: 'v', titulo: 'Valor', numerica: true, celda: (f) => String(f.v), resaltar: (f) => (f.v < 0 ? 'negativo' : f.v === 0 ? 'cero' : null) }]}
      {...extra}
    />
  );
  it('resalta cero y negativo con palabra, y pinta pie de totales y grupos', () => {
    const m = abrir(montar(tabla()));
    expect(m.cont.textContent).toContain('Agotado');
    expect(m.cont.textContent).toContain('Negativa');
    expect(m.cont.querySelector('.rtm-dt-pie')?.textContent).toContain('Totales');
    expect(m.cont.querySelectorAll('[data-grupo-cab]')).toHaveLength(2);
  });
  it('cabecera con aria-sort ausente pero roles de tabla completos y sin violaciones de axe', async () => {
    const m = abrir(montar(tabla()));
    expect(m.cont.querySelector('[role="table"]')).not.toBeNull();
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('la busqueda oculta lo que no coincide y el boton del grupo lo colapsa', () => {
    const m = abrir(montar(tabla()));
    const entrada = m.cont.querySelector<HTMLInputElement>('input[type=search]')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(entrada, 'beta');
      entrada.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const visibles = () => [...m.cont.querySelectorAll<HTMLElement>('.rtm-dt-cuerpo [data-fila]')].filter((f) => !f.hidden).map((f) => f.textContent);
    expect(visibles().join(' ')).toContain('Beta uno');
    expect(visibles().join(' ')).not.toContain('Alfa');
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(entrada, '');
      entrada.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const boton = m.cont.querySelector<HTMLButtonElement>('[data-grupo-cab="A"] button')!;
    act(() => boton.click());
    const hijosA = [...m.cont.querySelectorAll<HTMLElement>('[data-en-grupo="A"]')];
    expect(hijosA.every((h) => h.hidden)).toBe(true);
    expect(boton.getAttribute('aria-expanded')).toBe('false');
  });
  it('estado vacio con pestanas sigue mostrando las pestanas', () => {
    const m = abrir(montar(<DataTable etiqueta="t" filas={[]} clave={() => 1} columnas={[{ id: 'a', titulo: 'A', celda: () => '' }]} pestanas={{ etiquetaAria: 'p', items: [{ id: 'x', etiqueta: 'Todos', href: '#', activa: true, contador: 0 }] }} />));
    expect(m.cont.textContent).toContain('Todos');
    expect(m.cont.textContent).toContain('Sin datos');
  });
});

describe('DataTable etapa 3', () => {
  const filas = [{ id: 'a', n: 'Nombre muy largo de ejemplo', v: 5 }];
  it('prioridadMovil activa la tarjeta-fila y etiqueta cada celda', () => {
    const m = abrir(montar(<DataTable etiqueta="t" filas={filas} clave={(f) => f.id}
      columnas={[{ id: 'n', titulo: 'Nombre', prioridadMovil: 'titulo', celda: (f) => f.n }, { id: 'v', titulo: 'Valor', numerica: true, prioridadMovil: 'principal', etiquetaMovil: 'Existencia', celda: (f) => String(f.v) }]} />));
    expect(m.cont.querySelector('.rtm-dt-caja')?.hasAttribute('data-tarjeta-movil')).toBe(true);
    const celdas = [...m.cont.querySelectorAll('.rtm-dt-cuerpo [role=cell]')];
    expect(celdas.map((c) => c.getAttribute('data-mov'))).toEqual(['titulo', 'principal']);
    expect(celdas[1]!.getAttribute('data-label')).toBe('Existencia');
  });
  it('sin prioridadMovil la tabla no cambia a tarjetas', () => {
    const m = abrir(montar(<DataTable etiqueta="t" filas={filas} clave={(f) => f.id} columnas={[{ id: 'n', titulo: 'Nombre', celda: (f) => f.n }]} />));
    expect(m.cont.querySelector('.rtm-dt-caja')?.hasAttribute('data-tarjeta-movil')).toBe(false);
  });
  it('truncar recorta con title y conserva el texto completo', () => {
    const m = abrir(montar(<DataTable etiqueta="t" filas={filas} clave={(f) => f.id} columnas={[{ id: 'n', titulo: 'Nombre', truncar: 's', celda: (f) => f.n }]} />));
    const t = m.cont.querySelector<HTMLElement>('.rtm-dt-trunc')!;
    expect(t.getAttribute('title')).toBe('Nombre muy largo de ejemplo');
    expect(t.getAttribute('data-trunc')).toBe('s');
  });
  it('la envoltura lleva el indicador de scroll horizontal (sin desborde no pinta botones)', () => {
    const m = abrir(montar(<DataTable etiqueta="t" filas={filas} clave={(f) => f.id} columnas={[{ id: 'n', titulo: 'Nombre', celda: (f) => f.n }]} />));
    expect(m.cont.querySelector('.rtm-dt-env .rtm-dt-indicador')).not.toBeNull();
    expect(m.cont.querySelector('.rtm-dt-mas')).toBeNull();
  });
});

describe('BarList y LineaTiempo en dos columnas', () => {
  it('data-columnas llega al DOM', () => {
    const m = abrir(montar(<BarList columnas={2} etiquetaAria="b" items={[{ id: '1', etiqueta: 'A', texto: '$1', pct: 10 }]} />));
    expect(m.cont.querySelector('.rtm-barlist')?.getAttribute('data-columnas')).toBe('2');
  });
});

