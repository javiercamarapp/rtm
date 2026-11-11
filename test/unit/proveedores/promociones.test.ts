import { describe, it, expect } from 'vitest';
import { parsearCatalogo } from '@/dominio/proveedores/catalogo_json';
import { construirAvisos, redactarAviso } from '@/dominio/proveedores/avisos';
import { procesarLectura } from '@/dominio/proveedores/detector';
import { campanasPorLeer, procesarPromociones } from '@/dominio/proveedores/promociones';
import type { EntradaPromociones, ResultadoPromociones } from '@/dominio/proveedores/promociones';
import { parsearPromociones } from '@/dominio/proveedores/promociones_html';
import type { SenalesPromocion } from '@/dominio/proveedores/promociones_html';
import { estadoVacio } from '@/dominio/proveedores/tipos';
import type { EstadoProveedor } from '@/dominio/proveedores/tipos';
import { hallarImportes } from '@/dominio/proveedores/privacidad';
import { HORA, catalogoJson, ctxDeteccion, en, modeloConSabores } from './ayudas';
import type { ModeloSpec } from './ayudas';

const MODELOS: ModeloSpec[] = [
  { ...modeloConSabores(1, 'Elf Bar TE6000', 3, 3), handle: 'elf-bar-te6000' },
  { ...modeloConSabores(2, 'Orion Bar 7,500', 3, 3), handle: 'orion-bar' },
  { ...modeloConSabores(3, 'Bugatti B6000', 3, 3), handle: 'bugatti-b6000' },
  { ...modeloConSabores(4, 'Fifty Bar 20,000', 3, 3), handle: 'fifty-bar' },
  { ...modeloConSabores(5, 'Snowwolf 8,000', 3, 3), handle: 'snowwolf' },
];

function base(): EstadoProveedor {
  const p = parsearCatalogo(catalogoJson(MODELOS));
  if (!p.ok) throw new Error('fixture');
  return procesarLectura(estadoVacio(), { clave: 'base', en: en(0), lectura: p.lectura }, ctxDeteccion()).estado;
}

const tarjeta = (handle: string, pct?: number): string =>
  `<li class="grid__item product-card"><a href="/products/${handle}">x</a>${pct ? `<span>${pct} % de descuento</span>` : ''}</li>`;

function pagina(opts: { pct?: Record<string, number>; campana?: { coleccion: string; inicio?: string; fin?: string } } = {}): SenalesPromocion {
  const handles = MODELOS.map((m) => m.handle!);
  const tarjetas = handles.map((h) => tarjeta(h, opts.pct?.[h])).join('');
  const c = opts.campana;
  const camp = c ? `<section${c.inicio ? ` data-countdown-start="${c.inicio}"` : ''}${c.fin ? ` data-countdown-end="${c.fin}"` : ''}><a href="/collections/${c.coleccion}">c</a></section>` : '';
  return parsearPromociones(`<html><body>${camp}<ul>${tarjetas}</ul></body></html>`);
}

function paso(e: EstadoProveedor, senales: SenalesPromocion, ms: number, alcance: Record<string, string[]> = {}): ResultadoPromociones {
  const entrada: EntradaPromociones = { clave: `promos-${ms}`, en: en(ms), senales, alcanceColecciones: alcance };
  return procesarPromociones(e, entrada);
}

const QUINCE = { 'elf-bar-te6000': 15, 'orion-bar': 15, 'bugatti-b6000': 15 };

describe('promocion de porcentaje', () => {
  it('se confirma en dos lecturas separadas al menos 1 hora: una promocion y un aviso P-09', () => {
    let e = base();
    const r1 = paso(e, pagina({ pct: QUINCE }), 0);
    expect(r1.eventos).toEqual([]);
    expect(r1.estado.promociones['porcentaje|15']).toMatchObject({ estado: 'candidata', pct: 15, tipo: 'porcentaje' });
    e = r1.estado;
    const r2 = paso(e, pagina({ pct: QUINCE }), 3 * HORA);
    expect(r2.eventos.map((x) => x.tipo)).toEqual(['promocion_nueva']);
    expect(r2.estado.promociones['porcentaje|15']).toMatchObject({ estado: 'activa', etiqueta: '15 % en 3 modelos', alcance: ['1', '2', '3'] });
    const { avisos } = construirAvisos(r2.eventos, [], en(3 * HORA));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ codigo: 'P-09', destino: 'inmediato' });
    const texto = redactarAviso(avisos[0]!);
    expect(texto).toContain('15 % de descuento anunciado en Elf Bar TE6000, Orion Bar 7,500 y Bugatti B6000');
    expect(texto).toContain('No cambia ningún costo.');
    expect(texto).toContain('Confirma con Karen si aplica a mayoreo');
    // repetir no duplica
    expect(paso(r2.estado, pagina({ pct: QUINCE }), 6 * HORA).eventos).toEqual([]);
  });

  it('dos vistas separadas por menos de 1 hora no la confirman', () => {
    const r1 = paso(base(), pagina({ pct: QUINCE }), 0);
    const r2 = paso(r1.estado, pagina({ pct: QUINCE }), 20 * 60_000);
    expect(r2.eventos).toEqual([]);
    expect(r2.estado.promociones['porcentaje|15']!.estado).toBe('candidata');
    expect(r2.estado.promociones['porcentaje|15']!.primeraVista).toBe(en(0));
  });

  it('el precio de comparacion del JSON no genera ninguna promocion: solo cuenta la insignia de la pagina', () => {
    const sinInsignia = paso(paso(base(), pagina(), 0).estado, pagina(), 3 * HORA);
    expect(sinInsignia.eventos).toEqual([]);
    expect(Object.keys(sinInsignia.estado.promociones)).toEqual([]);
  });

  it('una promocion vista una sola vez desaparece sin avisar', () => {
    const r1 = paso(base(), pagina({ pct: QUINCE }), 0);
    const r2 = paso(r1.estado, pagina(), 3 * HORA);
    expect(r2.eventos).toEqual([]);
    expect(r2.estado.promociones).toEqual({});
  });

  it('ausente en 2 lecturas de promociones: un aviso P-12 y se resuelve el P-09', () => {
    let e = paso(paso(base(), pagina({ pct: QUINCE }), 0).estado, pagina({ pct: QUINCE }), 3 * HORA).estado;
    const r1 = paso(e, pagina(), 6 * HORA);
    expect(r1.eventos).toEqual([]);
    expect(r1.estado.promociones['porcentaje|15']!.lecturasAusente).toBe(1);
    e = r1.estado;
    const r2 = paso(e, pagina(), 9 * HORA);
    expect(r2.eventos.map((x) => x.tipo)).toEqual(['promocion_terminada']);
    const c = construirAvisos(r2.eventos, [], en(9 * HORA));
    expect(c.avisos[0]).toMatchObject({ codigo: 'P-12', severidad: 'baja', destino: 'resumen' });
    expect(c.resueltos).toEqual(['P-09|porcentaje|15']);
    // y no se vuelve a terminar
    expect(paso(r2.estado, pagina(), 12 * HORA).eventos).toEqual([]);
  });

  it('una plantilla con menos de la mitad de las tarjetas se descarta y no cuenta como ausencia', () => {
    const e = paso(paso(base(), pagina({ pct: QUINCE }), 0).estado, pagina({ pct: QUINCE }), 3 * HORA).estado;
    expect(e.tarjetasPromo).toBe(5);
    const rota = parsearPromociones('<html>pagina rota</html>');
    const r = paso(e, rota, 6 * HORA);
    expect(r.descartada).toBe(true);
    expect(r.estado).toBe(e);
    const siguiente = paso(r.estado, pagina({ pct: QUINCE }), 9 * HORA);
    expect(siguiente.estado.promociones['porcentaje|15']).toMatchObject({ estado: 'activa', lecturasAusente: 0 });
  });

  it('los handles que no conocemos se ignoran', () => {
    const s = parsearPromociones(tarjeta('modelo-que-no-existe', 20));
    const r = paso(paso(base(), s, 0).estado, s, 3 * HORA);
    expect(r.eventos).toEqual([]);
  });
});

describe('campana con fechas', () => {
  const INICIO = '2026-11-13T00:00:00-06:00'; // 13-nov 06:00 UTC
  const FIN = '2026-11-17T23:59:00-06:00'; // 18-nov 05:59 UTC
  const camp = { coleccion: 'buen-fin-3x2', inicio: INICIO, fin: FIN };
  const alcance = { 'buen-fin-3x2': ['fifty-bar', 'snowwolf'] };
  const D = 24 * HORA;

  it('se pide leer la coleccion solo si es nueva o cambiaron sus fechas', () => {
    const e = base();
    const s = pagina({ campana: camp });
    expect(campanasPorLeer(e, s).map((c) => c.coleccion)).toEqual(['buen-fin-3x2']);
    const e2 = paso(paso(e, s, 0, alcance).estado, s, 3 * HORA, alcance).estado;
    expect(campanasPorLeer(e2, s)).toEqual([]);
    expect(campanasPorLeer(e2, pagina({ campana: { ...camp, fin: '2026-11-19T23:59:00-06:00' } })).map((c) => c.coleccion)).toEqual(['buen-fin-3x2']);
  });

  it('con inicio futuro queda "anunciada" (P-10, solo resumen) y guarda tipo, modelos y fechas, nada mas', () => {
    const s = pagina({ campana: camp });
    const r = paso(paso(base(), s, 0, alcance).estado, s, 3 * HORA, alcance);
    expect(r.eventos.map((x) => x.tipo)).toEqual(['promocion_anunciada']);
    const p = r.estado.promociones['campana|buen-fin-3x2']!;
    expect(p).toMatchObject({ estado: 'anunciada', tipo: 'multicompra', pct: null, etiqueta: 'Campaña 3x2', alcance: ['4', '5'], coleccion: 'buen-fin-3x2' });
    expect(p.inicio).toBe('2026-11-13T06:00:00.000Z');
    expect(p.fin).toBe('2026-11-18T05:59:00.000Z');
    const { avisos } = construirAvisos(r.eventos, [], en(3 * HORA));
    expect(avisos[0]).toMatchObject({ codigo: 'P-10', destino: 'resumen' });
    const t = redactarAviso(avisos[0]!);
    expect(t).toContain('Campaña 3x2');
    expect(t).toContain('Fifty Bar 20,000 y Snowwolf 8,000');
    expect(hallarImportes(r.estado.promociones)).toEqual([]);
  });

  it('al llegar la fecha de inicio pasa a activa; 24 horas antes del fin avisa "por terminar" una sola vez; vence 1 hora despues del fin', () => {
    const s = pagina({ campana: camp });
    let e = paso(paso(base(), s, 0, alcance).estado, s, 3 * HORA, alcance).estado;
    // 13-nov 12:00 UTC = 3 dias despues de T0 (10-nov 12:00 UTC)
    let r = paso(e, s, 3 * D);
    expect(r.estado.promociones['campana|buen-fin-3x2']!.estado).toBe('activa');
    e = r.estado;
    // 17-nov 05:59 UTC es 24 h antes del fin; a las 17-nov 12:00 UTC faltan ~18 h
    r = paso(e, s, 7 * D);
    expect(r.eventos.map((x) => x.tipo)).toEqual(['promocion_por_terminar']);
    expect(construirAvisos(r.eventos, [], en(7 * D)).avisos[0]).toMatchObject({ codigo: 'P-11', payload: { condicion: 'existencia_propia_baja' } });
    e = r.estado;
    expect(paso(e, s, 7 * D + 3 * HORA).eventos).toEqual([]);
    // fin vencido mas 1 hora: 18-nov 05:59 UTC + 1 h = 06:59; 18-nov 08:00 UTC = 7 dias + 20 h
    r = paso(e, s, 7 * D + 20 * HORA);
    expect(r.eventos.map((x) => x.tipo)).toEqual(['promocion_terminada']);
  });

  it('una coleccion generica sin fechas cuyos modelos ya tienen insignia de porcentaje no es otra promocion', () => {
    const s = pagina({ pct: QUINCE, campana: { coleccion: 'descuentos' } });
    const al = { descuentos: ['elf-bar-te6000', 'orion-bar', 'bugatti-b6000'] };
    const r = paso(paso(base(), s, 0, al).estado, s, 3 * HORA, al);
    expect(Object.keys(r.estado.promociones)).toEqual(['porcentaje|15']);
  });

  it('una campana sin modelos conocidos en su coleccion se ignora', () => {
    const s = pagina({ campana: camp });
    const r = paso(base(), s, 0, { 'buen-fin-3x2': ['no-existe'] });
    expect(r.estado.promociones).toEqual({});
  });

  it('una promocion terminada que vuelve a aparecer nace como nueva', () => {
    let e = paso(paso(base(), pagina({ pct: QUINCE }), 0).estado, pagina({ pct: QUINCE }), 3 * HORA).estado;
    e = paso(paso(e, pagina(), 6 * HORA).estado, pagina(), 9 * HORA).estado;
    expect(e.promociones['porcentaje|15']!.estado).toBe('terminada');
    const r = paso(e, pagina({ pct: QUINCE }), 12 * HORA);
    expect(r.estado.promociones['porcentaje|15']!.estado).toBe('candidata');
  });

  it('las promociones terminadas hace mas de 30 dias se limpian', () => {
    let e = paso(paso(base(), pagina({ pct: QUINCE }), 0).estado, pagina({ pct: QUINCE }), 3 * HORA).estado;
    e = paso(paso(e, pagina(), 6 * HORA).estado, pagina(), 9 * HORA).estado;
    const r = paso(e, pagina(), 40 * D);
    expect(r.estado.promociones).toEqual({});
  });
});

describe('las promociones nunca guardan importes', () => {
  it('el estado de promociones no contiene claves ni textos de dinero', () => {
    const html = `<ul>${tarjeta('elf-bar-te6000', 15)}</ul><p>Antes $1,999 ahora $999 MXN, oferta imperdible</p>`;
    const s = parsearPromociones(html);
    const r = paso(paso(base(), s, 0).estado, s, 3 * HORA);
    expect(hallarImportes(r.estado)).toEqual([]);
    expect(JSON.stringify(r.estado.promociones)).not.toMatch(/imperdible|1,999|999/);
  });
});
