import { describe, expect, it, vi } from 'vitest';
import { altaCliente, altaCosto, altaPrecio, costoDeSolicitud, edicionCliente, ErrorAltaNegocio, mensajeDeFalla, precioDeSolicitud, type AltaCatalogo } from '@/aplicacion/catalogo/alta';
import type { LectorCatalogo } from '@/aplicacion/catalogo/puertos';
import { describirCambio, esFechaValida, montoPositivo, validarCliente, validarCosto, validarPrecio, type EntradaCosto, type EntradaPrecio } from '@/dominio/catalogo/alta';
import type { ClienteFicha, ModeloCatalogo } from '@/dominio/catalogo/tipos';

const CLAVE = 'web:11111111-2222-3333-4444-555555555555';

function puerto(sobre: Partial<AltaCatalogo> = {}): AltaCatalogo & { llamadas: string[] } {
  const llamadas: string[] = [];
  const base: AltaCatalogo = {
    crearCliente: async (_c, d) => { llamadas.push(`crear:${d.nombre}`); return { clienteId: 9, creado: true }; },
    editarCliente: async (_c, id) => { llamadas.push(`editar:${id}`); return { clienteId: id }; },
    fijarPrecio: async (_c, d) => { llamadas.push(`precio:${d.clienteId}:${d.modeloId}:${d.precioCent}`); return { precioId: 5, sinCambio: false }; },
    fijarCosto: async (_c, d) => { llamadas.push(`costo:${d.proveedor}:${d.modeloId}:${d.costoCent}`); return { costoId: 6, sinCambio: false }; },
    historialCostos: async () => [],
  };
  return Object.assign({ ...base, ...sobre }, { llamadas });
}

const precioBase: EntradaPrecio = { clienteId: 3, modeloId: 7, precio: '150', desde: '2026-11-11', nota: '', precioActualCent: null, vigenteDesde: null };
const costoBase: EntradaCosto = { proveedor: 'Isaac', modeloId: 7, costo: '95', desde: '2026-11-11', fuente: 'lista de Isaac', esLista: true, motivo: '', supuesto: false, costoActualCent: null, vigenteDesde: null };

describe('validacion de clientes', () => {
  it('acepta un nombre limpio y normaliza espacios; nota vacia = null', () => {
    const r = validarCliente({ nombre: '  Tienda   La Esquina ', tipo: 'mayoreo', nota: '' });
    expect(r).toEqual({ ok: true, valor: { nombre: 'Tienda La Esquina', tipo: 'mayoreo', nota: null } });
  });
  it('rechaza nombre corto, largo, tipo invalido y telefonos en nombre o nota', () => {
    const r = validarCliente({ nombre: 'A', tipo: 'otro', nota: '999 123 4567 llamar' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(['nombre', 'nota', 'tipo']);
    const t = validarCliente({ nombre: '9991234567', tipo: 'mayoreo', nota: '' });
    expect(t.ok).toBe(false);
    expect(validarCliente({ nombre: 'x'.repeat(81), tipo: 'mayoreo', nota: '' }).ok).toBe(false);
  });
});

describe('validacion de precios', () => {
  it('primer precio: no exige nota; convierte a centavos exactos', () => {
    const r = validarPrecio({ ...precioBase, precio: '149.50' });
    expect(r.ok && r.valor.precioCent).toBe(14950n);
    expect(r.ok && r.valor.origen).toBe('chat');
  });
  it('montos invalidos: vacio, cero, negativo, tres decimales, texto y por encima del tope', () => {
    for (const p of ['', '0', '-5', '1.234', 'cien', '100000.01']) {
      const r = validarPrecio({ ...precioBase, precio: p });
      expect(r.ok, p).toBe(false);
      if (!r.ok) expect(r.errores.precio, p).toBeTruthy();
    }
    expect(montoPositivo('1,234.50')).toBe(123450n);
  });
  it('cambio de un precio vigente exige motivo, fecha posterior y un valor distinto', () => {
    const base = { ...precioBase, precioActualCent: 15000n, vigenteDesde: '2026-11-01' };
    const sinMotivo = validarPrecio({ ...base, precio: '160' });
    expect(!sinMotivo.ok && sinMotivo.errores.nota).toMatch(/por qué/);
    const retro = validarPrecio({ ...base, precio: '160', nota: 'x', desde: '2026-11-01' });
    expect(!retro.ok && retro.errores.desde).toMatch(/después del último cambio/);
    const igual = validarPrecio({ ...base, precio: '150.00', nota: 'x' });
    expect(!igual.ok && igual.errores.precio).toMatch(/mismo precio/);
    expect(validarPrecio({ ...base, precio: '160', nota: 'acordado' }).ok).toBe(true);
  });
  it('fechas imposibles no pasan', () => {
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('2026-11-11')).toBe(true);
    expect(esFechaValida('11/11/2026')).toBe(false);
  });
  it('describirCambio compara sin inventar margenes', () => {
    expect(describirCambio(null, 100n)).toEqual({ tipo: 'nuevo', nuevoCent: 100n });
    expect(describirCambio(100n, 150n)).toMatchObject({ tipo: 'sube', diferenciaCent: 50n });
    expect(describirCambio(150n, 100n)).toMatchObject({ tipo: 'baja', diferenciaCent: 50n });
  });
});

describe('validacion de costos', () => {
  it('acepta costo de lista con fuente', () => {
    const r = validarCosto(costoBase);
    expect(r.ok && r.valor).toMatchObject({ proveedor: 'Isaac', costoCent: 9500n, esLista: true, motivo: null });
  });
  it('exige proveedor valido, fuente y, si no es de lista, motivo', () => {
    const r = validarCosto({ ...costoBase, proveedor: 'Otto', fuente: ' ', esLista: false, motivo: '' });
    expect(!r.ok && Object.keys(r.errores).sort()).toEqual(['fuente', 'motivo', 'proveedor']);
  });
  it('no permite vigencia retroactiva ni repetir el costo de lista vigente', () => {
    const base = { ...costoBase, costoActualCent: 9500n, vigenteDesde: '2026-11-10' };
    const retro = validarCosto({ ...base, costo: '96', desde: '2026-11-10' });
    expect(!retro.ok && retro.errores.desde).toBeTruthy();
    const igual = validarCosto({ ...base, costo: '95' });
    expect(!igual.ok && igual.errores.costo).toMatch(/mismo costo/);
  });
});

describe('casos de uso con puerto simulado', () => {
  it('crear cliente: valida antes de llamar al puerto y hace eco', async () => {
    const p = puerto();
    const mal = await altaCliente(p, CLAVE, { nombre: '', tipo: 'mayoreo', nota: '' });
    expect(mal.ok).toBe(false);
    expect(p.llamadas).toEqual([]);
    const bien = await altaCliente(p, CLAVE, { nombre: 'Tienda Norte', tipo: 'mayoreo', nota: '' });
    expect(bien).toMatchObject({ ok: true, id: 9, sinCambio: false, eco: 'Cliente creado: Tienda Norte.' });
    expect(p.llamadas).toEqual(['crear:Tienda Norte']);
  });
  it('crear cliente repetido: lo dice y no lo duplica', async () => {
    const p = puerto({ crearCliente: async () => ({ clienteId: 4, creado: false }) });
    const r = await altaCliente(p, CLAVE, { nombre: 'Tienda Norte', tipo: 'mayoreo', nota: '' });
    expect(r).toMatchObject({ ok: true, sinCambio: true });
    expect(r.ok && r.eco).toMatch(/no se duplicó/);
  });
  it('rechaza claves de idempotencia mal formadas sin tocar la base', async () => {
    const p = puerto();
    const r = await altaCliente(p, 'x', { nombre: 'Tienda Norte', tipo: 'mayoreo', nota: '' });
    expect(r.ok).toBe(false);
    expect(p.llamadas).toEqual([]);
  });
  it('funcion SQL no instalada: mensaje claro, no error tecnico', async () => {
    const p = puerto({ crearCliente: async () => { throw new ErrorAltaNegocio('Esta función todavía no está instalada en la base (ver docs/pendiente-sql-alta.md).', 'NO_INSTALADA'); } });
    const r = await altaCliente(p, CLAVE, { nombre: 'Tienda Norte', tipo: 'mayoreo', nota: '' });
    expect(!r.ok && r.mensaje).toMatch(/pendiente-sql-alta/);
  });
  it('errores de la base se traducen; lo desconocido no filtra texto tecnico', () => {
    expect(mensajeDeFalla(new ErrorAltaNegocio('vigencia retroactiva', 'P0422'))).toMatch(/vigencia/);
    expect(mensajeDeFalla(new ErrorAltaNegocio('duplicate key value violates unique constraint x', '23505'))).toBe('Ya existe otro cliente con ese nombre.');
    expect(mensajeDeFalla(new Error('ECONNRESET 10.0.0.1'))).toBe('No se pudo guardar. Intenta de nuevo.');
  });
  it('editar cliente desactivado lo dice en el eco', async () => {
    const r = await edicionCliente(puerto(), CLAVE, 4, { nombre: 'Tienda Norte', tipo: 'mayoreo', nota: '', activo: false });
    expect(r.ok && r.eco).toMatch(/inactivo/);
    expect((await edicionCliente(puerto(), CLAVE, 0, { nombre: 'Tienda Norte', tipo: 'mayoreo', nota: '', activo: true })).ok).toBe(false);
  });
  it('precio: guarda y repite lo guardado con fecha y nombres; sin cambio lo dice', async () => {
    const r = await altaPrecio(puerto(), CLAVE, precioBase, { cliente: 'Tienda Norte', modelo: 'Elf Bar BC5000' });
    expect(r.ok && r.eco).toBe('Precio guardado: Elf Bar BC5000 a $150.00 por pieza para Tienda Norte, desde el 11 nov 2026. El anterior queda en el historial.');
    const s = await altaPrecio(puerto({ fijarPrecio: async () => ({ precioId: 5, sinCambio: true }) }), CLAVE, precioBase, { cliente: 'Tienda Norte', modelo: 'Elf Bar BC5000' });
    expect(s.ok && s.eco).toMatch(/^Sin cambio/);
  });
  it('costo: guarda y marca supuesto en el eco; P0422 se explica', async () => {
    const r = await altaCosto(puerto(), CLAVE, { ...costoBase, supuesto: true }, 'Elf Bar BC5000');
    expect(r.ok && r.eco).toMatch(/\$95\.00 por pieza con Isaac, desde el 11 nov 2026 \(supuesto\)/);
    const f = await altaCosto(puerto({ fijarCosto: async () => { throw new ErrorAltaNegocio('vigencia retroactiva', 'P0422'); } }), CLAVE, costoBase, 'Elf Bar BC5000');
    expect(!f.ok && f.mensaje).toMatch(/posterior/);
  });
});

describe('solicitudes: el servidor recalcula el estado actual', () => {
  const modelo = { id: 7, marca: 'Elf Bar', nombre: 'BC5000', costos: [{ proveedor: 'Isaac', costoCent: 9500n, desde: '2026-11-01', supuesto: false, esLista: true, motivo: null, fuente: 'lista' }] } as unknown as ModeloCatalogo;
  const ficha = { id: 3, nombre: 'Tienda Norte', tabulador: [{ modeloId: 7, modelo: 'BC5000', precioCent: 15000n, desde: '2026-11-05' }] } as unknown as ClienteFicha;
  const lector = { ficha: vi.fn(async (id: number) => (id === 3 ? ficha : null)), modelos: vi.fn(async () => [modelo]) } as unknown as Pick<LectorCatalogo, 'ficha' | 'modelos'>;

  it('precio: usa el vigente de la base (no el del navegador) para exigir motivo y fecha posterior', async () => {
    const p = puerto();
    const sinMotivo = await precioDeSolicitud(lector, p, CLAVE, { clienteId: 3, modeloId: 7, precio: '160', desde: '2026-11-11', nota: '' });
    expect(!sinMotivo.ok && sinMotivo.errores.nota).toBeTruthy();
    const retro = await precioDeSolicitud(lector, p, CLAVE, { clienteId: 3, modeloId: 7, precio: '160', desde: '2026-11-05', nota: 'x' });
    expect(!retro.ok && retro.errores.desde).toBeTruthy();
    const ok = await precioDeSolicitud(lector, p, CLAVE, { clienteId: 3, modeloId: 7, precio: '160', desde: '2026-11-11', nota: 'acordado' });
    expect(ok.ok && ok.eco).toMatch(/Elf Bar BC5000 a \$160\.00/);
    expect(p.llamadas).toEqual(['precio:3:7:16000']);
  });
  it('precio: cliente o modelo inexistente o lectura caida no llegan a la base', async () => {
    const p = puerto();
    expect((await precioDeSolicitud(lector, p, CLAVE, { clienteId: 99, modeloId: 7, precio: '160', desde: '2026-11-11', nota: '' })).ok).toBe(false);
    const caido = { ficha: async () => { throw new Error('boom'); }, modelos: async () => [] } as unknown as Pick<LectorCatalogo, 'ficha' | 'modelos'>;
    const r = await precioDeSolicitud(caido, p, CLAVE, { clienteId: 3, modeloId: 7, precio: '160', desde: '2026-11-11', nota: '' });
    expect(!r.ok && r.mensaje).toMatch(/No se pudo leer/);
    expect(p.llamadas).toEqual([]);
  });
  it('costo: compara contra el costo de lista vigente de la base', async () => {
    const p = puerto();
    const igual = await costoDeSolicitud(lector, p, CLAVE, { proveedor: 'Isaac', modeloId: 7, costo: '95', desde: '2026-11-11', fuente: 'lista', esLista: true, motivo: '', supuesto: false });
    expect(!igual.ok && igual.errores.costo).toMatch(/mismo costo/);
    const ok = await costoDeSolicitud(lector, p, CLAVE, { proveedor: 'Karen', modeloId: 7, costo: '97', desde: '2026-11-11', fuente: 'Karen por chat', esLista: true, motivo: '', supuesto: true });
    expect(ok.ok).toBe(true);
    expect(p.llamadas).toEqual(['costo:Karen:7:9700']);
  });
});
