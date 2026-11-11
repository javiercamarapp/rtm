// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { CASOS, CASOS_CON_MARCO } from './pruebas/casos';
import { auditar, fijarModo, montar, sinAtributoDeModo, teclear, type Montaje } from './pruebas/ayudas';
import { BarrasDelta, Cascada, EsqueletoGrafica, LineaProyeccion, MapaCalor, Pareto, Radar, TarjetaInsight, Treemap, Bump, AntiguedadSaldos, Burbujas, CoberturaDias, MarcaProcedencia, Delta, palabraCobertura, type FormaEsqueleto } from './index';
import { EJ_BARRAS, EJ_LINEA, EJ_PARETO, EJ_SPARK } from './ejemplos';
import { Sparkline } from './index';

const css = readFileSync(join(__dirname, '../estilos/graficas.css'), 'utf8');
const montajes: Montaje[] = [];
const abrir = (m: Montaje): Montaje => {
  montajes.push(m);
  return m;
};
afterEach(() => {
  while (montajes.length) montajes.pop()!.desmontar();
  fijarModo(null);
  vi.unstubAllGlobals();
});

const textoDeTabla = (cont: Element): string => cont.querySelector('[role="table"]')?.textContent ?? '';

describe('criterio 1: cero violaciones de axe en cada componente', () => {
  for (const caso of CASOS) {
    it(`${caso.id}: listo con la tabla abierta`, async () => {
      const m = abrir(montar(caso.crear({ tablaAbierta: true })));
      expect(await auditar(m.cont)).toEqual([]);
    });
  }
  for (const caso of CASOS_CON_MARCO) {
    it(`${caso.id}: cargando, error y muestra insuficiente`, async () => {
      for (const extra of [{ estado: 'cargando' as const }, { estado: 'error' as const }, { muestra: { actual: 1, requerida: 4, unidad: 'pedidos' } }]) {
        const m = abrir(montar(caso.crear(extra)));
        expect(await auditar(m.cont)).toEqual([]);
        m.desmontar();
        montajes.pop();
      }
    });
  }
  it('tarjeta de insight, delta y procedencia', async () => {
    const m = abrir(montar(
      <div>
        <TarjetaInsight etiqueta="Piezas" cifra={{ valor: 1524, tipo: 'piezas' }} frase="Subió frente a la semana anterior." delta={{ texto: '+12 %', sentido: 'sube' }} procedencia="observado" severidad="Informa"
          minigrafica={<Sparkline titulo="Piezas" descripcion="Tendencia" etiquetas={EJ_SPARK.etiquetas} valores={EJ_SPARK.valores} textos={EJ_SPARK.textos} />} evidencia={{ href: '/inventario' }} />
        <Delta delta={{ texto: '−4 %', sentido: 'baja' }} />
        <Delta delta={{ texto: '0 %', sentido: 'igual' }} />
        <MarcaProcedencia procedencia="estimado" />
        <MarcaProcedencia procedencia="inferido" />
      </div>,
    ));
    expect(await auditar(m.cont)).toEqual([]);
  });
});

describe('criterio 2: con reducir movimiento no hay animacion y el estado final es identico', () => {
  for (const caso of CASOS) {
    it(`${caso.id}: reducido y apagado pintan lo mismo que el modo completo, sin animacion`, () => {
      const completo = abrir(montar(caso.crear(), 'full'));
      const htmlCompleto = completo.html();
      completo.desmontar();
      montajes.pop();
      for (const modo of ['reduced', 'off'] as const) {
        const m = abrir(montar(caso.crear(), modo));
        expect(m.cont.querySelector('[data-anim="on"]')).toBeNull();
        if (caso.id !== 'sparkline') expect(m.cont.querySelector('[data-anim="off"]')).not.toBeNull();
        expect(sinAtributoDeModo(m.html())).toBe(sinAtributoDeModo(htmlCompleto));
        m.desmontar();
        montajes.pop();
      }
      if (caso.id !== 'sparkline') expect(htmlCompleto).toContain('data-anim="on"');
    });
  }

  it('toda animacion de graficas.css solo existe bajo data-anim="on" (o es la anulacion para reducido y apagado)', () => {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const reglas = [...sinComentarios.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)];
    const conAnimacion = reglas.filter(([, , cuerpo]) => /(^|[\s;])animation(-[a-z]+)?\s*:/.test(cuerpo!) || /(^|[\s;])transition\s*:/.test(cuerpo!));
    expect(conAnimacion.length).toBeGreaterThan(0);
    for (const [, selector, cuerpo] of conAnimacion) {
      const gated = /\[data-anim='on'\]/.test(selector!);
      const anula = /data-movimiento='(reduced|off)'/.test(selector!) && /animation:\s*none/.test(cuerpo!);
      expect(gated || anula, `regla sin compuerta: ${selector!.trim()}`).toBe(true);
    }
  });

  it('solo anima transform, opacity y stroke-dashoffset (nunca propiedades de layout)', () => {
    const cuadros = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)];
    expect(cuadros.length).toBeGreaterThanOrEqual(4);
    for (const [, nombre, cuerpo] of cuadros) {
      for (const d of cuerpo!.matchAll(/([a-z-]+)\s*:/g)) expect(['transform', 'opacity', 'stroke-dashoffset'], `${nombre}: ${d[1]}`).toContain(d[1]);
    }
  });

  it('las duraciones respetan los maximos: 600 ms y 900 ms el trazo de linea', () => {
    for (const m of css.matchAll(/animation:\s*[\w-]+\s+(\d+)ms/g)) expect(Number(m[1])).toBeLessThanOrEqual(900);
    for (const m of css.matchAll(/\.rtm-g\[data-anim='on'\] \.rtm-g-(crece-x|crece-y|escala)[^}]*animation:\s*[\w-]+\s+(\d+)ms/g)) expect(Number(m[2])).toBeLessThanOrEqual(600);
  });

  it('el atributo de la pagina manda: cambiar data-movimiento en caliente apaga la animacion', async () => {
    const m = abrir(montar(CASOS[0]!.crear(), 'full'));
    expect(m.cont.querySelector('[data-anim="on"]')).not.toBeNull();
    fijarModo('reduced');
    await act(async () => {
      await Promise.resolve();
    });
    expect(m.cont.querySelector('[data-anim="on"]')).toBeNull();
  });

  it('sin atributo sigue la preferencia del sistema (prefers-reduced-motion)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener: () => undefined, removeEventListener: () => undefined }));
    const m = abrir(montar(CASOS[0]!.crear(), null));
    expect(m.cont.querySelector('[data-anim="on"]')).toBeNull();
    expect(m.cont.querySelector('[data-anim="off"]')).not.toBeNull();
  });

  it('estados de carga, error y muestra insuficiente no se animan', () => {
    for (const extra of [{ estado: 'cargando' as const }, { estado: 'error' as const }, { muestra: { actual: 1, requerida: 4, unidad: 'pedidos' } }]) {
      const m = abrir(montar(CASOS[0]!.crear(extra), 'full'));
      expect(m.cont.querySelector('[data-anim="on"]')).toBeNull();
      m.desmontar();
      montajes.pop();
    }
  });
});

describe('criterio 3: cada grafica tiene su tabla alterna con los mismos datos', () => {
  for (const caso of CASOS) {
    it(`${caso.id}: la tabla trae todas las etiquetas y cifras y tantas filas como datos`, () => {
      const m = abrir(montar(caso.crear({ tablaAbierta: true })));
      const tabla = m.cont.querySelector('[role="table"]');
      expect(tabla, 'debe haber tabla').not.toBeNull();
      const texto = textoDeTabla(m.cont);
      for (const e of caso.esperados) expect(texto, `falta "${e}" en la tabla`).toContain(e);
      expect(tabla!.querySelectorAll('[role="row"]').length).toBe(caso.filas + 1);
      expect(tabla!.getAttribute('aria-label')).toMatch(/tabla equivalente/);
      if (caso.id !== 'sparkline') {
        expect(m.cont.querySelector('details.rtm-grafica-tabla summary')?.textContent).toBe('Ver como tabla');
      }
    });
    if (caso.marcas !== null) {
      it(`${caso.id}: cada dato es una marca con etiqueta accesible`, () => {
        const m = abrir(montar(caso.crear()));
        const marcas = [...m.cont.querySelectorAll('[data-marca]')];
        expect(marcas).toHaveLength(caso.marcas!);
        for (const el of marcas) expect((el.getAttribute('aria-label') ?? '').length).toBeGreaterThan(3);
      });
    }
  }
  it('la tabla de barras repite la posicion, el valor y el cambio con palabra', () => {
    const m = abrir(montar(<BarrasDelta titulo="t" descripcion="d" datos={EJ_BARRAS} unidad="Piezas" tablaAbierta />));
    expect(textoDeTabla(m.cont)).toContain('Sube +12 %');
    expect(textoDeTabla(m.cont)).toContain('Baja −4 %');
  });
  it('el pie de corte y fuente se muestra solo cuando hay datos', () => {
    const listo = abrir(montar(CASOS[0]!.crear({ pie: 'Corte: 10 nov 19:12 · Fuente: libro de movimientos' })));
    expect(listo.cont.textContent).toContain('Corte: 10 nov 19:12');
    const cargando = abrir(montar(CASOS[0]!.crear({ pie: 'Corte', estado: 'cargando' })));
    expect(cargando.cont.textContent).not.toContain('Corte');
  });
});

describe('criterio 4: ninguna grafica depende solo del color', () => {
  const firmaCapa = (g: Element): string => g.querySelector('[class~="rtm-g-trama-capa"]')?.getAttribute('fill') ?? 'liso';

  it('burbujas: cada grupo tiene su propia trama y su palabra en etiqueta y leyenda', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'burbujas')!.crear()));
    const porGrupo = new Map<string, string>();
    for (const g of m.cont.querySelectorAll('[data-grupo]')) porGrupo.set(g.getAttribute('data-grupo')!, firmaCapa(g).replace(/^url\(#[^-]+-?/, ''));
    expect(porGrupo.size).toBe(4);
    expect(new Set([...porGrupo.values()]).size).toBe(4);
    const leyenda = m.cont.querySelector('ul[aria-label="Clasificaciones"]')!;
    for (const g of porGrupo.keys()) expect(leyenda.textContent).toContain(g);
    expect(leyenda.querySelectorAll('[class~="rtm-g-trama-capa"]').length).toBe(3);
  });

  it('antiguedad de saldos: cada tramo con su trama y su nombre; el total va escrito', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'antiguedad')!.crear()));
    const tramos = [...m.cont.querySelectorAll('li[data-marca="c2"] [data-tramo]')];
    expect(tramos).toHaveLength(4);
    const firmas = tramos.map((t) => firmaCapa(t).replace(/^url\(#[^-]+-?/, ''));
    expect(new Set(firmas).size).toBe(4);
    const leyenda = m.cont.querySelector('ul[aria-label="Tramos de antigüedad"]')!;
    for (const nombre of ['0 a 7 d', '8 a 14 d', '15 a 30 d', 'Más de 30 d']) expect(leyenda.textContent).toContain(nombre);
    for (const li of m.cont.querySelectorAll('li[data-marca]')) expect(li.getAttribute('aria-label')).toMatch(/Total \$/);
  });

  it('radar: la segunda serie cambia de forma de marcador y de trazo; ambas en la leyenda con palabra', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'radar')!.crear()));
    const marca = m.cont.querySelector('[data-marca="Marca A"]')!;
    const formas = [...marca.querySelectorAll('circle.rtm-g-punto-foco, rect.rtm-g-punto-segunda, polygon')].map((e) => e.tagName.toLowerCase());
    expect(formas).toContain('circle');
    expect(formas).toContain('rect');
    expect(m.cont.querySelector('.rtm-g-radar-2')?.getAttribute('class')).toContain('rtm-g-traza-estimada');
    expect(m.cont.querySelector('ul[aria-label="Series"]')!.textContent).toMatch(/Este cliente.*Promedio/);
  });

  it('bump: cada serie con forma de marcador distinta y su nombre y lugar en los dos extremos', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'bump')!.crear()));
    const firmas = [...m.cont.querySelectorAll('[data-marca]')].map((g) => {
      const mk = g.querySelector('circle, rect, polygon')!;
      return `${mk.tagName}:${mk.getAttribute('points')?.split(' ').length ?? 0}`;
    });
    expect(new Set(firmas).size).toBe(4);
    expect(m.cont.textContent).toContain('1. Cliente 1');
    const aria = m.cont.querySelector('[data-marca="c3"]')!.getAttribute('aria-label')!;
    expect(aria).toMatch(/Baja 1 lugar/);
  });

  it('linea: lo estimado usa rombo (no circulo), trazo discontinuo y la palabra en la etiqueta', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'linea')!.crear()));
    expect(m.cont.querySelector('[data-marca="s9"] polygon')).not.toBeNull();
    expect(m.cont.querySelector('[data-marca="s2"] circle')).not.toBeNull();
    expect(m.cont.querySelector('[data-marca="s9"]')!.getAttribute('aria-label')).toContain('estimado');
    expect(css).toMatch(/\.rtm-g-traza-estimada\s*\{[^}]*stroke-dasharray/);
    expect(m.cont.querySelector('[data-banda="proyeccion"] [class~="rtm-g-banda-trama"]')).not.toBeNull();
    expect(m.cont.querySelector('[data-anotacion="s5"] text')?.textContent).toBe('Mayor caída');
    expect(m.cont.querySelector('[data-anotacion="s5"]')!.querySelector('line')).not.toBeNull();
  });

  it('cascada: los negativos llevan trama y signo escrito; el total dice si cuadra', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'cascada')!.crear()));
    const negativos = m.cont.querySelectorAll('[data-signo="menos"]');
    expect(negativos).toHaveLength(4);
    for (const n of negativos) {
      expect(n.querySelector('[class~="rtm-g-trama-capa"]')).not.toBeNull();
      expect(n.textContent).toContain('−');
    }
    for (const p of m.cont.querySelectorAll('[data-signo="mas"], [data-signo="total"]')) expect(p.querySelector('[class~="rtm-g-trama-capa"]')).toBeNull();
    expect(m.cont.querySelector('[data-marca="util"]')!.getAttribute('aria-label')).toContain('cuadra');
  });

  it('mapa de calor: la celda sin dato es punteada y dice "sin dato"; cada celda trae su numero', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'calor')!.crear()));
    const vacia = m.cont.querySelector('[data-nivel="-1"]')!;
    expect(vacia.getAttribute('aria-label')).toContain('sin dato');
    expect(vacia.querySelector('rect')!.getAttribute('class')).toContain('rtm-g-calor-vacia');
    expect(css).toMatch(/\.rtm-g-calor-vacia\s*\{[^}]*stroke-dasharray/);
    expect(m.cont.querySelector('[data-marca="0-0"]')!.textContent).toBe('48');
  });

  it('cobertura: el estado va en palabra y en un medidor de segmentos; sin historia es barra punteada', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'cobertura')!.crear()));
    const urge = m.cont.querySelector('[data-estado="urge"]')!;
    expect(urge.textContent).toContain(palabraCobertura('urge'));
    expect(urge.querySelectorAll('.rtm-g-segmento-lleno')).toHaveLength(1);
    expect(m.cont.querySelector('[data-estado="excelente"]') ?? m.cont.querySelector('[data-estado="sobrestock"]')).not.toBeNull();
    expect(m.cont.querySelector('[data-estado="sobrestock"]')!.textContent).toContain('+');
    const sinHist = m.cont.querySelector('[data-estado="sin_historia"]')!;
    expect(sinHist.querySelector('.rtm-g-sin-dato')).not.toBeNull();
    expect(sinHist.textContent).toContain('Sin historia (< 28 d)');
    expect(m.cont.querySelector('ul[aria-label="Referencias de la escala"]')!.textContent).toContain('Objetivo: 28 d');
  });

  it('delta: flecha, signo escrito y palabra para lectores', () => {
    const m = abrir(montar(<div><Delta delta={{ texto: '+12 %', sentido: 'sube' }} /><Delta delta={{ texto: '−4 %', sentido: 'baja' }} /><Delta delta={{ texto: '0 %', sentido: 'igual' }} /></div>));
    const t = [...m.cont.querySelectorAll('.rtm-g-delta')].map((e) => e.textContent);
    expect(t).toEqual(['▲+12 %Sube', '▼−4 %Baja', '■0 %Sin cambio']);
    expect(css).not.toMatch(/rtm-g-delta[^{]*\{[^}]*(--rtm-ok|--rtm-bad|--rtm-warn)/);
  });

  it('procedencia: tres marcas con palabra y glifo distinto', () => {
    const firmas = (['observado', 'estimado', 'inferido'] as const).map((p) => {
      const m = abrir(montar(<MarcaProcedencia procedencia={p} />));
      const g = m.cont.querySelector('svg')!.firstElementChild!;
      const r = `${m.cont.textContent}|${g.tagName}|${g.getAttribute('class')}`;
      m.desmontar();
      montajes.pop();
      return r;
    });
    expect(firmas).toEqual(['Observado|circle|rtm-g-proc-lleno', 'Estimado|circle|rtm-g-proc-discontinuo', 'Inferido|polygon|rtm-g-proc-vacio']);
  });

  it('los semaforos (ok, malo, atencion) no se usan en ninguna grafica: solo texto de severidad', () => {
    const permitido = css.split('\n').filter((l) => /--rtm-(ok|bad|warn)/.test(l));
    expect(permitido).toHaveLength(1);
    expect(permitido[0]).toContain("data-severidad='Acción'");
  });

  it('todas las clases rtm-g-* que usan los componentes tienen regla en graficas.css', () => {
    const definidas = new Set([...css.matchAll(/\.(rtm-g[\w-]*)/g)].map((x) => x[1]!));
    const usadas = new Set<string>();
    for (const caso of CASOS) {
      const m = abrir(montar(caso.crear({ tablaAbierta: true })));
      for (const el of m.cont.querySelectorAll('[class]')) for (const c of el.getAttribute('class')!.split(/\s+/)) if (/^rtm-g(-|$)/.test(c)) usadas.add(c);
      m.desmontar();
      montajes.pop();
    }
    const m = abrir(montar(<TarjetaInsight etiqueta="E" cifra={{ valor: 1 }} frase="f" procedencia="observado" severidad="Informa" delta={{ texto: '+1', sentido: 'sube' }} minigrafica={<span />} evidencia={{ href: '/x' }} />));
    for (const el of m.cont.querySelectorAll('[class]')) for (const c of el.getAttribute('class')!.split(/\s+/)) if (/^rtm-g(-|$)/.test(c)) usadas.add(c);
    const faltan = [...usadas].filter((c) => !definidas.has(c));
    expect(faltan).toEqual([]);
  });
});

describe('contraste de las marcas contra los tokens (3:1 minimo)', () => {
  const tokens = readFileSync(join(__dirname, '../estilos/tokens.css'), 'utf8');
  const bloque = (selector: string): Record<string, string> => {
    const cuerpo = new RegExp(`${selector.replace(/[[\]'.]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(tokens)![1]!;
    return Object.fromEntries([...cuerpo.matchAll(/(--rtm-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1]!, x[2]!]));
  };
  const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const contraste = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };
  const claro = { ...bloque(':root'), };
  const oscuro = { ...claro, ...bloque(":root[data-tema='oscuro']") };
  for (const [nombre, t] of [['claro', claro], ['oscuro', oscuro]] as const) {
    it(`tema ${nombre}: los 8 matices de datos y la linea fuerte superan 3:1 sobre la superficie`, () => {
      const marcas = ['--rtm-d-lila', '--rtm-d-verde-azulado', '--rtm-d-ocre', '--rtm-d-azul-marino', '--rtm-d-terracota', '--rtm-d-malva', '--rtm-d-gris', '--rtm-line-strong', '--rtm-ink'];
      for (const k of marcas) {
        const hex = t[k];
        expect(hex, k).toBeDefined();
        expect(contraste(hex!, t['--rtm-surface']!), `${k} en ${nombre}`).toBeGreaterThanOrEqual(3);
      }
    });
    it(`tema ${nombre}: el texto de etiquetas (ink-3) supera 4.5:1`, () => {
      expect(contraste(t['--rtm-ink-3']!, t['--rtm-surface']!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('teclado', () => {
  it('una sola parada de Tab; las flechas, Inicio y Fin recorren las marcas y mueven el foco', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'pareto')!.crear()));
    const marcas = [...m.cont.querySelectorAll<SVGElement>('[data-marca]')];
    expect(marcas.map((x) => x.getAttribute('tabindex'))).toEqual(['0', ...Array(marcas.length - 1).fill('-1')]);
    act(() => marcas[0]!.focus());
    teclear(marcas[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(marcas[1]);
    expect(marcas[1]!.getAttribute('tabindex')).toBe('0');
    expect(marcas[0]!.getAttribute('tabindex')).toBe('-1');
    teclear(marcas[1]!, 'End');
    expect(document.activeElement).toBe(marcas[marcas.length - 1]);
    teclear(marcas[marcas.length - 1]!, 'Home');
    expect(document.activeElement).toBe(marcas[0]);
    teclear(marcas[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(marcas[0]);
    teclear(marcas[0]!, 'x');
    expect(document.activeElement).toBe(marcas[0]);
  });
  it('el mapa de calor se recorre por filas con arriba y abajo', () => {
    const m = abrir(montar(CASOS.find((c) => c.id === 'calor')!.crear()));
    const marcas = [...m.cont.querySelectorAll<SVGElement>('[data-marca]')];
    act(() => marcas[0]!.focus());
    teclear(marcas[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(marcas[5]);
    teclear(marcas[5]!, 'ArrowUp');
    expect(document.activeElement).toBe(marcas[0]);
  });
  it('las filas de barras (lista) tambien se recorren con flechas', () => {
    const m = abrir(montar(CASOS[0]!.crear()));
    const filas = [...m.cont.querySelectorAll<HTMLElement>('li[data-marca]')];
    act(() => filas[0]!.focus());
    teclear(filas[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(filas[1]);
  });
  it('si cambia la cantidad de marcas el indice itinerante se acota', () => {
    const m = abrir(montar(<BarrasDelta titulo="t" descripcion="d" datos={EJ_BARRAS} unidad="Piezas" />));
    const filas = [...m.cont.querySelectorAll<HTMLElement>('li[data-marca]')];
    act(() => filas[4]!.focus());
    teclear(filas[4]!, 'End');
    expect(filas[4]!.getAttribute('tabindex')).toBe('0');
  });
});

describe('estados', () => {
  for (const caso of CASOS_CON_MARCO) {
    it(`${caso.id}: cargando muestra el esqueleto de su forma y nada de datos`, () => {
      const m = abrir(montar(caso.crear({ estado: 'cargando' })));
      const fig = m.cont.querySelector('figure')!;
      expect(fig.getAttribute('aria-busy')).toBe('true');
      expect(fig.querySelector(`svg.rtm-g-esqueleto[data-forma="${caso.forma}"]`)).not.toBeNull();
      expect(fig.querySelector('[data-marca]')).toBeNull();
      expect(fig.querySelector('[role="status"]')?.textContent).toBe('Cargando gráfica');
      expect(fig.querySelector('[role="table"]')).toBeNull();
    });
  }
  it('cada forma de esqueleto se dibuja con elementos propios', () => {
    const formas: FormaEsqueleto[] = ['barras', 'linea', 'cascada', 'pareto', 'calor', 'burbujas', 'treemap', 'radar', 'bump', 'apilada', 'cobertura', 'sparkline'];
    for (const f of formas) {
      const m = abrir(montar(<EsqueletoGrafica forma={f} />));
      expect(m.cont.querySelector('svg')!.children.length, f).toBeGreaterThan(0);
      m.desmontar();
      montajes.pop();
    }
  });
  it('error: aviso con alerta y mensaje; no inventa datos', () => {
    const m = abrir(montar(<LineaProyeccion titulo="t" descripcion="d" puntos={[EJ_LINEA[0]!]} unidad="Piezas" />));
    expect(m.cont.querySelector('[role="alert"]')!.textContent).toContain('Hace falta más de un punto');
    expect(m.cont.querySelector('[data-marca]')).toBeNull();
  });
  it('muestra insuficiente: estado vacio honesto con las cifras', () => {
    const m = abrir(montar(CASOS[3]!.crear({ muestra: { actual: 2, requerida: 4, unidad: 'pedidos' } })));
    expect(m.cont.textContent).toContain('Pocos datos para hablar de esto');
    expect(m.cont.textContent).toContain('Hay 2 pedidos y hacen falta 4');
    expect(m.cont.querySelector('svg')).toBeNull();
    const ok = abrir(montar(CASOS[3]!.crear({ muestra: { actual: 4, requerida: 4, unidad: 'pedidos' } })));
    expect(ok.cont.querySelector('[data-marca]')).not.toBeNull();
  });
  it('errores de datos: ejes de mas, series de mas, longitudes distintas, negativos', () => {
    const casos = [
      <Radar key="r1" titulo="t" descripcion="d" ejes={Array.from({ length: 9 }, (_, i) => `E${i}`)} series={[{ id: 'a', etiqueta: 'A', valores: Array(9).fill(1), textos: Array(9).fill('1') }]} />,
      <Radar key="r2" titulo="t" descripcion="d" ejes={['a', 'b']} series={[{ id: 'a', etiqueta: 'A', valores: [1, 2], textos: ['1', '2'] }]} />,
      <Radar key="r3" titulo="t" descripcion="d" ejes={['a', 'b', 'c']} series={[]} />,
      <Radar key="r4" titulo="t" descripcion="d" ejes={['a', 'b', 'c']} series={[1, 2, 3].map((n) => ({ id: `${n}`, etiqueta: `${n}`, valores: [1, 1, 1], textos: ['1', '1', '1'] }))} />,
      <Radar key="r5" titulo="t" descripcion="d" ejes={['a', 'b', 'c']} series={[{ id: 'a', etiqueta: 'A', valores: [1, 2], textos: ['1', '2'] }]} />,
      <BarrasDelta key="b1" titulo="t" descripcion="d" datos={[{ id: 'a', etiqueta: 'A', valor: -1, texto: '-1' }]} unidad="u" />,
      <Pareto key="p1" titulo="t" descripcion="d" datos={[]} unidad="u" sustantivo="x" />,
      <Cascada key="c1" titulo="t" descripcion="d" pasos={[]} unidad="u" />,
      <Treemap key="t1" titulo="t" descripcion="d" nodos={[{ id: 'a', etiqueta: 'A', valor: 0, texto: '0' }]} unidad="u" />,
      <MapaCalor key="m1" titulo="t" descripcion="d" filas={['a']} columnas={['x', 'y']} celdas={[[{ valor: 1, texto: '1' }]]} unidad="u" />,
      <MapaCalor key="m2" titulo="t" descripcion="d" filas={[]} columnas={[]} celdas={[]} unidad="u" />,
      <Bump key="u1" titulo="t" descripcion="d" periodos={['a']} series={[{ id: 'a', etiqueta: 'A', posiciones: [1] }]} />,
      <Bump key="u2" titulo="t" descripcion="d" periodos={['a', 'b']} series={[]} />,
      <Bump key="u3" titulo="t" descripcion="d" periodos={['a', 'b']} series={[{ id: 'a', etiqueta: 'A', posiciones: [1] }]} />,
      <Burbujas key="x1" titulo="t" descripcion="d" puntos={[]} ejeX="x" ejeY="y" ejeTamano="t" grupos={[]} />,
      <AntiguedadSaldos key="a1" titulo="t" descripcion="d" filas={[]} />,
      <AntiguedadSaldos key="a2" titulo="t" descripcion="d" filas={[{ id: 'a', etiqueta: 'A', valores: [1], textos: ['1'], total: '1' }]} />,
      <CoberturaDias key="k1" titulo="t" descripcion="d" filas={[]} umbrales={[]} />,
      <Sparkline key="s1" titulo="t" descripcion="d" etiquetas={['a']} valores={[1]} textos={['1']} />,
    ];
    for (const el of casos) {
      const m = abrir(montar(el));
      const hayAviso = m.cont.querySelector('[role="alert"]') !== null || m.cont.querySelector('.rtm-g-spark-vacio') !== null;
      expect(hayAviso, String(el.key)).toBe(true);
      m.desmontar();
      montajes.pop();
    }
  });
});

describe('tarjeta de insight', () => {
  it('muestra etiqueta, cifra final para lectores, flecha de cambio, procedencia y severidad en texto', () => {
    const m = abrir(montar(<TarjetaInsight etiqueta="Piezas de la semana" cifra={{ valor: 1524, tipo: 'piezas', unidad: 'esta semana' }} frase="Subió." delta={{ texto: '+12 %', sentido: 'sube' }} procedencia="inferido" severidad="Atención" evidencia={{ href: '/inventario', texto: 'Ver kárdex' }} />));
    expect(m.cont.querySelector('.rtm-solo-lectores')!.textContent).toBe('1,524 pz');
    expect(m.cont.querySelector('.rtm-g-delta')!.textContent).toContain('▲');
    expect(m.cont.querySelector('.rtm-g-procedencia')!.textContent).toBe('Inferido');
    expect(m.cont.querySelector('.rtm-g-severidad')!.textContent).toBe('Atención');
    expect(m.cont.querySelector('a')!.textContent).toBe('Ver kárdex');
    expect(m.cont.querySelector('article')!.getAttribute('data-anim')).toBe('on');
  });
  it('con movimiento reducido no entra con animacion', () => {
    const m = abrir(montar(<TarjetaInsight etiqueta="E" cifra={{ valor: 5 }} frase="f" procedencia="observado" severidad="Informa" />, 'reduced'));
    expect(m.cont.querySelector('article')!.getAttribute('class')).toBe('rtm-g-insight');
    expect(m.cont.querySelector('article')!.getAttribute('data-anim')).toBe('off');
  });
});

describe('integridad de los datos', () => {
  it('el ranking se ordena de mayor a menor salvo que se pida el orden dado', () => {
    const desorden = [...EJ_BARRAS].reverse();
    const a = abrir(montar(<BarrasDelta titulo="t" descripcion="d" datos={desorden} unidad="u" />));
    expect([...a.cont.querySelectorAll('li[data-marca]')].map((e) => e.getAttribute('data-marca'))).toEqual(['a', 'b', 'c', 'd', 'e']);
    const b = abrir(montar(<BarrasDelta titulo="t" descripcion="d" datos={desorden} unidad="u" ordenar={false} />));
    expect([...b.cont.querySelectorAll('li[data-marca]')].map((e) => e.getAttribute('data-marca'))).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
  it('el Pareto dice cuantos concentran el umbral con palabras', () => {
    const m = abrir(montar(<Pareto titulo="t" descripcion="d" datos={EJ_PARETO} unidad="u" sustantivo="clientes" />));
    expect(m.cont.querySelector('.rtm-g-lectura')!.textContent).toMatch(/^Los 3 primeros clientes concentran \d+ % del total\.$/);
  });
});
