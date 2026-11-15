import { describe, expect, it } from 'vitest';
import { aMarkdown, cargarAliasWaka, compacta, conciliar, lineaDe, puffsDe } from '../../../scripts/proveedores/conciliar-marcas.mjs';
import { asignarEnTabla, decidirFoto, fotosFaltantes, leerFuente, pasadaReciente } from '../../../scripts/proveedores/vigilar-karen.mjs';

// Datos ficticios: nada de ventas, clientes ni tiendas reales.
const catalogo = [
  { id: 1, marca: 'Marca Uno', n: 'Marca Uno Alfa 40K', al: [] },
  { id: 2, marca: 'Marca Uno', n: 'Marca Uno Beta 30K', al: [] },
  { id: 3, marca: 'Waka', n: 'Waka 60K', al: [] },
  { id: 4, marca: 'Waka', n: 'Waka Blade 33K', al: [] },
  { id: 5, marca: 'Sin marca', n: 'Gamma', al: [] },
  { id: 6, marca: 'Otra Marca', n: 'Otra Marca Zeta 10K', al: [] },
];
const prod = (title: string, vendor: string, disp = 1) => ({ handle: compacta(title), title, vendor, variants: [{ available: disp > 0 }, { available: false }] });
const alias = new Map<string, number | null>([['steel', 60]]);
const propuestas = new Map<number, string>([[5, 'Marca Dos']]);

describe('nombres y puffs', () => {
  it('lee puffs de 50,000 y 40K y quita la marca aunque venga partida', () => {
    expect(puffsDe('Marca 50,000')).toBe(50);
    expect(puffsDe('Alfa 40K')).toBe(40);
    expect(puffsDe('Sin cifra')).toBeNull();
    expect(lineaDe('Elf Bar BC Pro 40,000', 'Elfbar')).toEqual(['bc', 'pro']);
  });
});

describe('conciliacion (solo lectura, nunca unifica)', () => {
  it('separa coinciden, alias del diccionario, dudosos, solo tienda y solo catalogo', () => {
    const r = conciliar([prod('Marca Uno Alfa 40,000', 'Marca Uno'), prod('Waka Steel 60,000', 'WAKA'), prod('Marca Uno Gamma 30,000', 'Marca Uno'), prod('Nueva Cosa 5,000', 'Marca Nueva'), prod('Marca Dos Gamma 8,000', 'Marca Dos')], catalogo, alias, propuestas);
    expect(r.coinciden.map((c: { m: { id: number } }) => c.m.id)).toEqual([1]);
    expect(r.alias.map((c: { m: { id: number }; via: string }) => [c.m.id, c.via.includes('diccionario')])).toEqual([[3, true]]);
    expect(r.dudosos.length).toBe(2); // Gamma de Marca Uno (mismos puffs que Beta) y Gamma de Marca Dos (sin puffs en el catalogo)
    expect(r.soloTienda.map((s: { marcaConocida: boolean }) => s.marcaConocida)).toEqual([false]);
    expect(r.soloCatalogo.map((m: { id: number }) => m.id).sort()).toEqual([4, 6]);
    expect(aMarkdown(r, '2026-11-14')).not.toMatch(/https?:/);
  });
  it('el diccionario Waka del repo trae los 13 alias y 80K para Optimus queda por confirmar', () => {
    const mapa = cargarAliasWaka(new URL('../../../scripts/catalogo/alias-waka.json', import.meta.url));
    expect(mapa.get('steel')).toBe(60);
    expect(mapa.get('optimus')).toBe(80);
    expect(mapa.size).toBe(13);
  });
});

describe('foto de un modelo nuevo: asigna solo lo exacto, lo dudoso va a la cola', () => {
  const sinFoto = () => false;
  it('exacto sin foto previa -> asignar', () => {
    expect(decidirFoto(prod('Marca Uno Alfa 40,000', 'Marca Uno'), catalogo, alias, propuestas, sinFoto)).toEqual({ accion: 'asignar', modeloId: 1, confianza: 'exacto' });
  });
  it('exacto pero el modelo ya tiene foto -> no la pisa', () => {
    expect(decidirFoto(prod('Marca Uno Alfa 40,000', 'Marca Uno'), catalogo, alias, propuestas, (id: number) => id === 1).accion).toBe('ya_tiene');
  });
  it('mismos puffs con otra linea -> por confirmar, nunca asignada', () => {
    const d = decidirFoto(prod('Marca Uno Gamma 30,000', 'Marca Uno'), catalogo, alias, propuestas, sinFoto);
    expect(d.accion).toBe('por_confirmar');
  });
  it('marca desconocida -> por confirmar como modelo nuevo', () => {
    expect(decidirFoto(prod('Nueva Cosa 5,000', 'Marca Nueva'), catalogo, alias, propuestas, sinFoto)).toMatchObject({ accion: 'por_confirmar', motivo: 'marca_distinta' });
  });
  it('asignarEnTabla solo toca la fila de ese id y solo si estaba sin foto', () => {
    const t = "  { id: 7, marca: 'A', nombre: 'A 1', foto: null, confianza: 'sin_evidencia' },\n  { id: 8, marca: 'B', nombre: 'B 1', foto: '/x.webp', confianza: 'exacto' },\n";
    expect(asignarEnTabla(t, 7, '/proveedores/karen/a.webp')).toContain("{ id: 7, marca: 'A', nombre: 'A 1', foto: '/proveedores/karen/a.webp', confianza: 'exacto' }");
    expect(asignarEnTabla(t, 8, '/y.webp')).toBeNull();
    expect(asignarEnTabla(t, 9, '/y.webp')).toBeNull();
  });
});

describe('guardas del vigilante', () => {
  it('una pasada por hora', () => {
    const ahora = new Date('2026-11-14T12:00:00Z');
    expect(pasadaReciente({ ultimoIntento: '2026-11-14T11:30:00Z' }, ahora)).toBe(true);
    expect(pasadaReciente({ ultimoIntento: '2026-11-14T10:59:00Z' }, ahora)).toBe(false);
    expect(pasadaReciente({ ultimoIntento: null, ultimaLecturaOk: null }, ahora)).toBe(false);
  });
  it('fotos faltantes: solo los modelos sin archivo', () => {
    expect(fotosFaltantes([{ clave: 'a' }, { clave: 'b' }], ['a'])).toEqual([{ clave: 'b' }]);
  });
  it('lee la fuente del entorno y nunca devuelve algo vacio', () => {
    expect(leerFuente(undefined, { INVENTARIO_PROVEEDORES_FUENTE: ' https://x.test ' })).toBe('https://x.test');
    expect(leerFuente(undefined, {})).toBeNull();
  });
});
