import { describe, expect, it } from 'vitest';
import {
  avisosDeTablero, bloqueoDeActualizar, conteoPorMarca, consultaDeFiltros, estadoDisponibilidad, filtrarYOrdenar, FILTROS_INICIALES, hace, leerFiltros, normalizarBusqueda,
  type ModeloTablero, type Recomendacion,
} from '@/dominio/proveedores/tablero';
import { claveFoto, fotoDeModelo } from '@/config/fotos_karen';

const sabor = (n: string, d: boolean, v = 0, e = 0) => ({ variante_id: `v-${n}`, sabor: n, disponible: d, inestable: false, sabor_canonico_id: '1', ventas_60d: v, existencia_propia: e, cambio_en: null, cambio_tipo: null });
const modelo = (o: Partial<ModeloTablero> & { producto_id: string }): ModeloTablero => ({
  handle: `h-${o.producto_id}`, marca: 'Marca A', titulo: 'Modelo 8000', puffs: 8000, estado: 'activo', primera_vez: '2026-11-01T00:00:00Z', nuevo_semana: false, mapeo: 'confirmado', canonico_id: '1', canonico_nombre: 'Modelo',
  sin_sabores: false, nuevo_sin_costo: false, ventas_60d: 0, ventas_30d: 0, vendemos: false, existencia_propia: 0, cobertura_dias: null, sabores: [sabor('Sandía', true)], eventos: [], ...o,
});
const A = modelo({ producto_id: '1', titulo: 'Alfa 8000', vendemos: true, ventas_60d: 30, existencia_propia: 5, cobertura_dias: 10, sabores: [sabor('Sandía', true, 20, 3), sabor('Mango', false)] });
const B = modelo({ producto_id: '2', marca: 'Marca B', titulo: 'Beta', nuevo_semana: true, primera_vez: '2026-11-13T00:00:00Z', sabores: [sabor('Uva', false), sabor('Menta', false)] });
const C = modelo({ producto_id: '3', marca: 'Marca B', titulo: 'Gamma', canonico_id: null, sabores: [] , sin_sabores: true });
const TODOS = [C, B, A];

describe('filtros en la URL', () => {
  it('ida y vuelta y valores raros vuelven al inicial', () => {
    const f = { ...FILTROS_INICIALES, q: 'sandia', marcas: ['Marca A', 'Marca B'], disp: 'con' as const, vendemos: true, existencia: 'sin' as const, orden: 'vendidos' as const, modelo: '123' };
    expect(leerFiltros(new URLSearchParams(consultaDeFiltros(f)))).toEqual(f);
    expect(consultaDeFiltros(FILTROS_INICIALES)).toBe('');
    const raro = leerFiltros(new URLSearchParams('disp=x&exi=y&orden=z&m=abc&marca=||&vendemos=2'));
    expect(raro).toEqual(FILTROS_INICIALES);
  });
});

describe('busqueda y filtros', () => {
  it('la busqueda ignora acentos y mayusculas y mira marca, modelo y sabor', () => {
    expect(normalizarBusqueda('  SANDÍA  ')).toBe('sandia');
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, q: 'sandia' }).map((m) => m.producto_id)).toEqual(['1']);
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, q: 'marca b' }).map((m) => m.producto_id)).toEqual(['2', '3']);
  });
  it('disponibilidad, vendemos, nuevos y existencia', () => {
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, disp: 'con' }).map((m) => m.producto_id)).toEqual(['1']);
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, disp: 'agotados' }).map((m) => m.producto_id)).toEqual(['2']);
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, vendemos: true }).map((m) => m.producto_id)).toEqual(['1']);
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, nuevos: true }).map((m) => m.producto_id)).toEqual(['2']);
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, existencia: 'con' }).map((m) => m.producto_id)).toEqual(['1']);
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, existencia: 'sin' }).map((m) => m.producto_id)).toEqual(['2', '3']);
  });
  it('el conteo por marca ignora el filtro de marca pero respeta los demas', () => {
    expect(conteoPorMarca(TODOS, FILTROS_INICIALES)).toEqual([{ marca: 'Marca A', n: 1 }, { marca: 'Marca B', n: 2 }]);
    expect(conteoPorMarca(TODOS, { ...FILTROS_INICIALES, marcas: ['Marca A'], vendemos: true })).toEqual([{ marca: 'Marca A', n: 1 }, { marca: 'Marca B', n: 0 }]);
  });
  it('orden: vendidos, cobertura (sin ventas al final) y recientes', () => {
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, orden: 'vendidos' })[0]!.producto_id).toBe('1');
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, orden: 'cobertura' })[0]!.producto_id).toBe('1');
    expect(filtrarYOrdenar(TODOS, { ...FILTROS_INICIALES, orden: 'recientes' })[0]!.producto_id).toBe('2');
  });
  it('estado de disponibilidad', () => {
    expect(estadoDisponibilidad(A)).toBe('disponible');
    expect(estadoDisponibilidad(B)).toBe('agotado');
    expect(estadoDisponibilidad(C)).toBe('sin_dato');
    expect(estadoDisponibilidad(modelo({ producto_id: '9', sabores: [sabor('a', true), sabor('b', false), sabor('c', false), sabor('d', false)] }))).toBe('poca');
  });
});

describe('avisos', () => {
  const ahora = new Date('2026-11-14T12:00:00Z');
  const reco = (o: Partial<Recomendacion>): Recomendacion => ({ producto_id: '1', titulo: 'Alfa 8000', marca: 'Marca A', motivos: ['reponer'], ventas_60d: 30, existencia_propia: 5, cobertura_dias: 10, sabores_sugeridos: ['Sandía'], ...o });
  it('recomendacion de compra con cifras de la base y sin dinero', () => {
    const [a] = avisosDeTablero({ recomendaciones: [reco({})], eventos: [], porConfirmar: 0 }, ahora);
    expect(a!.tono).toBe('accion');
    expect(a!.titulo).toContain('Conviene pedir Alfa 8000');
    expect(a!.detalle).toContain('30 piezas');
    expect(a!.detalle).toContain('10 días');
    expect(a!.detalle).not.toMatch(/\$|precio|costo/i);
  });
  it('agrupa eventos de los ultimos 3 dias y suma los nombres por confirmar', () => {
    const ev = (tipo: string, en: string, modelo: string) => ({ clave: `${tipo}${modelo}`, tipo, en, antes: null, despues: null, modelo });
    const r = avisosDeTablero({ recomendaciones: [], eventos: [ev('modelo_nuevo', '2026-11-14T10:00:00Z', 'A'), ev('modelo_nuevo', '2026-11-13T10:00:00Z', 'B'), ev('sabor_agotado', '2026-11-01T10:00:00Z', 'C')], porConfirmar: 2 }, ahora);
    expect(r.map((x) => x.titulo)).toEqual(['2 modelos nuevos en los últimos 3 días', '2 nombres por confirmar']);
  });
  it('sin nada no hay avisos', () => {
    expect(avisosDeTablero({ recomendaciones: [], eventos: [], porConfirmar: 0 }, ahora)).toEqual([]);
  });
});

describe('actualizar ahora', () => {
  const ahora = new Date('2026-11-14T12:00:00Z');
  const base = { lectura_activa: true, peticiones_hoy: 3, tope_dia: 40, ultimo_intento: '2026-11-14T09:00:00Z', bloqueada: false };
  it('interruptor apagado bloquea con mensaje claro', () => {
    expect(bloqueoDeActualizar({ ...base, lectura_activa: false }, ahora)).toMatchObject({ motivo: 'interruptor_apagado' });
  });
  it('tope de 40 al dia, bloqueo del sitio y enfriamiento', () => {
    expect(bloqueoDeActualizar({ ...base, peticiones_hoy: 40 }, ahora)).toMatchObject({ motivo: 'tope_diario' });
    expect(bloqueoDeActualizar({ ...base, bloqueada: true }, ahora)).toMatchObject({ motivo: 'bloqueada' });
    expect(bloqueoDeActualizar({ ...base, ultimo_intento: '2026-11-14T11:55:00Z' }, ahora)).toMatchObject({ motivo: 'enfriamiento' });
  });
  it('encendido, con cupo y sin lectura reciente se puede', () => {
    expect(bloqueoDeActualizar(base, ahora)).toBeNull();
    expect(bloqueoDeActualizar({ ...base, ultimo_intento: null }, ahora)).toBeNull();
  });
});

describe('hace y fotos', () => {
  it('tiempos relativos', () => {
    const n = new Date('2026-11-14T12:00:00Z');
    expect(hace('2026-11-14T11:30:00Z', n)).toBe('hace 30 min');
    expect(hace('2026-11-14T09:00:00Z', n)).toBe('hace 3 h');
    expect(hace('2026-11-12T12:00:00Z', n)).toBe('hace 2 días');
    expect(hace(null, n)).toBe('sin dato');
  });
  it('el mapa de fotos se consulta por clave normalizada y sin entrada no hay foto', () => {
    expect(claveFoto('Elf-Bar_BC5000 ')).toBe('elf-bar-bc5000');
    expect(fotoDeModelo('Elf-Bar-BC5000', { 'elf-bar-bc5000': '/proveedores/karen/elf-bar-bc5000.webp' })).toBe('/proveedores/karen/elf-bar-bc5000.webp');
    expect(fotoDeModelo('desconocido', {})).toBeNull();
  });
});
