import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prepararListaParaCliente } from '@/aplicacion/proveedores/lista';
import type { DepsLista } from '@/aplicacion/proveedores/lista';
import { ejecutarLecturaHoraria } from '@/aplicacion/proveedores/ciclo';
import { generarListaDisponibilidad, sinCaladas } from '@/dominio/proveedores/lista_cliente';
import type { EntradaLista, ModeloParaLista } from '@/dominio/proveedores/lista_cliente';
import { formatearMoneda } from '@/dominio/formato';
import { contieneDireccion } from '@/dominio/proveedores/privacidad';
import { HORA, ORIGEN_SECRETO, SOCIOS_TODOS, entorno, en, modeloConSabores } from './ayudas';
import type { ModeloSpec } from './ayudas';

const COSTO_CENTINELA = 13_579n; // el costo de Karen jamas debe aparecer en ninguna lista
const EMOJI = /\p{Extended_Pictographic}/u;

const M = (id: string, marca: string, nombre: string, sabores: [string, boolean][], extra: Partial<ModeloParaLista> = {}): ModeloParaLista => ({
  id,
  marca,
  nombre,
  sabores: sabores.map(([n, d]) => ({ nombre: n, disponible: d })),
  deSocios: false,
  ...extra,
});

const MODELOS: ModeloParaLista[] = [
  M('1', 'Waka', 'Waka Steel 60,000', [['Mango Ice', true], ['Uva', true], ['Fresa', false]], { deSocios: true, precioCliente: 21_000n }),
  M('2', 'Waka', 'Waka Icon 50,000', [['Sandía', true]], { precioCliente: 19_500n }),
  M('3', 'Elf Bar', 'Elf Bar TE6000', [['Menta', true], ['Cola', true]], { deSocios: true }),
  M('4', 'Fifty Bar', 'Fifty Bar 20,000', [['Limón', false]]),
];

const entrada = (extra: Partial<EntradaLista> = {}): EntradaLista => ({ ahora: en(HORA), ultimaLectura: en(0), modelos: MODELOS, ...extra });

describe('formato de la lista para clientes', () => {
  it('usa el titulo DISPONIBLE <MARCA> (fecha y hora), un bloque por modelo en mayusculas y un sabor por linea', () => {
    const r = generarListaDisponibilidad(entrada({ opciones: { marcas: ['Waka'] } }));
    expect(r.estado).toBe('ok');
    if (r.estado !== 'ok') return;
    expect(r.texto).toBe(['DISPONIBLE WAKA (10 nov 06:00)', '', 'WAKA ICON', 'Sandía', '', 'WAKA STEEL', 'Mango Ice', 'Uva'].join('\n'));
  });

  it('sin emojis y sin caladas por defecto; las caladas son opcionales', () => {
    const sin = generarListaDisponibilidad(entrada());
    const con = generarListaDisponibilidad(entrada({ opciones: { mostrarCaladas: true } }));
    if (sin.estado !== 'ok' || con.estado !== 'ok') throw new Error('fixture');
    expect(sin.texto).not.toMatch(EMOJI);
    expect(sin.texto).not.toMatch(/60,000|50,000/);
    expect(sin.texto).toContain('ELF BAR TE6000');
    expect(con.texto).toContain('WAKA STEEL 60,000');
  });

  it('una seccion por marca con su propio titulo; omite modelos sin sabores disponibles', () => {
    const r = generarListaDisponibilidad(entrada());
    if (r.estado !== 'ok') throw new Error('fixture');
    expect(r.marcas).toEqual(['Elf Bar', 'Waka']);
    expect(r.texto.match(/^DISPONIBLE /gm)).toHaveLength(2);
    expect(r.texto).not.toContain('FIFTY');
    expect(r.texto).not.toContain('Fresa');
  });

  it('filtros por marca, por modelo y "solo lo que los socios venden"', () => {
    const porModelo = generarListaDisponibilidad(entrada({ opciones: { modelos: ['2'] } }));
    const socios = generarListaDisponibilidad(entrada({ opciones: { soloSocios: true } }));
    if (porModelo.estado !== 'ok' || socios.estado !== 'ok') throw new Error('fixture');
    expect(porModelo.texto).toContain('WAKA ICON');
    expect(porModelo.texto).not.toContain('WAKA STEEL');
    expect(socios.texto).not.toContain('WAKA ICON');
    expect(socios.texto).toContain('ELF BAR TE6000');
  });

  it('si dos modelos quedarian con el mismo nombre sin caladas, se conservan para distinguirlos', () => {
    const r = generarListaDisponibilidad(entrada({ modelos: [M('a', 'Nexa', 'Nexa Ultra 40,000', [['A', true]]), M('b', 'Nexa', 'Nexa Ultra 50,000', [['B', true]])] }));
    if (r.estado !== 'ok') throw new Error('fixture');
    expect(r.texto).toContain('NEXA ULTRA 40,000');
    expect(r.texto).toContain('NEXA ULTRA 50,000');
  });

  it('con precios del tabulador del cliente: el precio junto al modelo; sin precio se reporta', () => {
    const r = generarListaDisponibilidad(entrada({ opciones: { marcas: ['Waka', 'Elf Bar'], conPrecios: true } }));
    if (r.estado !== 'ok') throw new Error('fixture');
    expect(r.texto).toContain(`WAKA STEEL - ${formatearMoneda(21_000n)}`);
    expect(r.texto).toContain(`WAKA ICON - ${formatearMoneda(19_500n)}`);
    expect(r.texto).toContain('ELF BAR TE6000\n');
    expect(r.sinPrecio).toEqual(['Elf Bar TE6000']);
    const sinPrecios = generarListaDisponibilidad(entrada());
    if (sinPrecios.estado !== 'ok') throw new Error('fixture');
    expect(sinPrecios.texto).not.toMatch(/\$/);
  });

  it('propiedad: el precio mostrado es exactamente el del tabulador, para cualquier monto', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 99_999_999n }), (cent) => {
        const r = generarListaDisponibilidad(entrada({ modelos: [M('1', 'Waka', 'Waka Steel', [['Uva', true]], { precioCliente: cent })], opciones: { conPrecios: true } }));
        if (r.estado !== 'ok') throw new Error('fixture');
        expect(r.texto).toContain(` - ${formatearMoneda(cent)}`);
      }),
    );
  });

  it('combina existencia propia (ENTREGA INMEDIATA) con la disponibilidad del proveedor (POR PEDIDO), cada renglon etiquetado y sin nombrar al proveedor', () => {
    const r = generarListaDisponibilidad(entrada({ opciones: { marcas: ['Waka'], existenciaPropia: [{ marca: 'Waka', nombre: 'Waka Steel 60,000', sabores: ['Uva', 'Mango'] }, { marca: 'Elf Bar', nombre: 'Elf Bar TE6000', sabores: ['Menta'] }] } }));
    if (r.estado !== 'ok') throw new Error('fixture');
    const i = r.texto.indexOf('ENTREGA INMEDIATA');
    const p = r.texto.indexOf('POR PEDIDO');
    expect(i).toBeGreaterThan(0);
    expect(p).toBeGreaterThan(i);
    expect(r.texto).not.toMatch(/Karen/i);
    expect(r.texto).not.toContain('MENTA');
  });

  it('existencia propia sin sabores, o de otra marca filtrada, no aparece', () => {
    const r = generarListaDisponibilidad(entrada({ opciones: { marcas: ['Waka'], existenciaPropia: [{ marca: 'Waka', nombre: 'Waka X', sabores: [] }, { marca: 'Elf Bar', nombre: 'Elf Bar TE6000', sabores: ['Menta'] }] } }));
    if (r.estado !== 'ok') throw new Error('fixture');
    expect(r.texto).not.toContain('ENTREGA INMEDIATA');
  });

  it('quita duplicados de sabores y los ordena', () => {
    const r = generarListaDisponibilidad(entrada({ modelos: [M('1', 'Waka', 'Waka X', [['uva', true], ['Uva', true], ['Mango', true], ['', true]])] }));
    if (r.estado !== 'ok') throw new Error('fixture');
    expect(r.texto.split('\n').slice(3)).toEqual(['Mango', 'uva']);
  });

  it('sinCaladas conserva un codigo pegado y no deja nombres vacios', () => {
    expect(sinCaladas('Elf Bar TE6000')).toBe('Elf Bar TE6000');
    expect(sinCaladas('Waka Steel 60K')).toBe('Waka Steel');
    expect(sinCaladas('Naked 4,500')).toBe('Naked');
    expect(sinCaladas('50,000')).toBe('50,000');
  });
});

describe('la lista se bloquea con el dato viejo', () => {
  it('sin lectura o con mas de 3 horas: no hay texto, hay advertencia', () => {
    const viejo = generarListaDisponibilidad(entrada({ ahora: en(5 * HORA) }));
    expect(viejo).toMatchObject({ estado: 'bloqueada', motivo: 'dato_desactualizado' });
    if (viejo.estado === 'bloqueada') expect(viejo.advertencia).toContain('5 horas');
    const nunca = generarListaDisponibilidad(entrada({ ultimaLectura: null }));
    expect(nunca).toMatchObject({ estado: 'bloqueada', motivo: 'sin_lectura' });
    expect(generarListaDisponibilidad(entrada({ ahora: en(3 * HORA) })).estado).toBe('ok');
  });
});

describe('la lista nunca lleva la direccion de origen', () => {
  it('si algun texto pareciera una direccion, se rechaza en lugar de enviarse', () => {
    expect(() => generarListaDisponibilidad(entrada({ modelos: [M('1', 'Waka', 'Waka X', [['visita tienda.com', true]])] }))).toThrow();
    expect(() => generarListaDisponibilidad(entrada({ modelos: [M('1', 'Waka', 'Waka X', [['origen-privado', true]])], origenPrivado: 'https://origen-privado/' }))).toThrow();
  });
});

describe('caso de uso de punta a punta: la lista no contiene costos ni la direccion de origen', () => {
  const SPEC: ModeloSpec[] = [modeloConSabores(1, 'Waka Steel 60,000', 4, 3), modeloConSabores(2, 'Elf Bar TE6000', 3, 3)];

  async function armar() {
    const w = entorno(SPEC, { contexto: { socios: async () => SOCIOS_TODOS, normalizacion: async () => ({ modelos: [{ id: 'canon-steel', nombre: 'Waka Steel 60K' }], aliasModelos: [], sabores: [], aliasSabores: [], descartados: [] }) } });
    await ejecutarLecturaHoraria(w.deps);
    // tabulador del cliente y costos de Karen: el costo existe en el mundo, pero la lista solo puede pedir el precio
    const tabulador = { 'canon-steel': { precio: 21_000n, costo: COSTO_CENTINELA } };
    const deps: DepsLista = {
      repo: w.repo,
      contexto: w.deps.contexto,
      reloj: () => new Date(w.reloj.ms + HORA),
      origenPrivado: ORIGEN_SECRETO,
      datos: {
        precioDeTabulador: async (_c, modeloId) => tabulador[modeloId as keyof typeof tabulador]?.precio ?? null,
        existenciaPropia: async () => [{ marca: 'Waka', nombre: 'Waka Steel 60,000', sabores: ['Mango'] }],
      },
    };
    return { w, deps };
  }

  it('arma la lista con precios del cliente y sin costos, sin direccion, sin emojis', async () => {
    const { deps } = await armar();
    const r = await prepararListaParaCliente(deps, { clienteId: 'cliente-1', opciones: { conPrecios: true }, combinarExistenciaPropia: true });
    expect(r.estado).toBe('ok');
    if (r.estado !== 'ok') return;
    expect(r.texto).toContain('DISPONIBLE WAKA (10 nov 06:00)');
    expect(r.texto).toContain(formatearMoneda(21_000n));
    expect(r.texto).not.toContain(formatearMoneda(COSTO_CENTINELA));
    expect(r.texto).not.toContain(String(COSTO_CENTINELA));
    expect(r.texto).not.toContain('135.79');
    expect(contieneDireccion(r.texto, ORIGEN_SECRETO)).toBe(false);
    expect(r.texto).not.toMatch(/origen-secreto|https?:|Karen|\bcosto\b|utilidad/i);
    expect(r.texto).not.toMatch(EMOJI);
  });

  it('sin la opcion de precios, no aparece ningun importe', async () => {
    const { deps } = await armar();
    const r = await prepararListaParaCliente(deps, {});
    if (r.estado !== 'ok') throw new Error('fixture');
    expect(r.texto).not.toMatch(/\$|\d+\.\d{2}/);
  });

  it('con el dato viejo, el caso de uso devuelve el bloqueo', async () => {
    const { deps } = await armar();
    const r = await prepararListaParaCliente({ ...deps, reloj: () => new Date(Date.parse(en(0)) + 6 * HORA) });
    expect(r.estado).toBe('bloqueada');
  });

  it('un modelo no activo en el proveedor no se lista', async () => {
    const { w, deps } = await armar();
    w.repo.estado.modelos['2']!.estado = 'no_visto';
    const r = await prepararListaParaCliente(deps);
    if (r.estado !== 'ok') throw new Error('fixture');
    expect(r.texto).not.toContain('TE6000');
  });
});
