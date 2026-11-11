// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResultadoAlta } from '@/aplicacion/catalogo/alta';
import type { CampoCosto } from '@/dominio/catalogo/alta';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, enviar, escribir, porTestid, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import { FormularioCosto, type ModeloParaCosto } from './formulario-costo';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const montajes: Montaje[] = [];
beforeAll(simularDialogo);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); refresh.mockClear(); });

const MODELOS: ModeloParaCosto[] = [
  { id: 7, nombre: 'Elf Bar BC5000', vigentes: { Isaac: { cent: '9500', desde: '2026-11-01' } } },
  { id: 8, nombre: 'Lost Mary 20K', vigentes: {} },
];
function montarForm(accion = vi.fn(), extra: Partial<React.ComponentProps<typeof FormularioCosto>> = {}) {
  const x = montar(<FormularioCosto modelos={MODELOS} hoy="2026-11-11" accion={accion} {...extra} />);
  montajes.push(x);
  return x.cont;
}
const okRes = (eco: string): ResultadoAlta<CampoCosto> => ({ ok: true, eco, id: 1, sinCambio: false });

describe('FormularioCosto', () => {
  it('muestra el costo de lista vigente del proveedor elegido y cambia al cambiar de proveedor', () => {
    const cont = montarForm();
    expect(porTestid(cont, 'costo-vigente')!.textContent).toContain('$95.00 desde el 1 nov 2026');
    escribir(porTestid(cont, 'campo-proveedor'), 'Karen');
    expect(porTestid(cont, 'costo-vigente')!.textContent).toContain('Karen todavía no tiene costo de lista');
  });

  it('exige fuente y, si no es de lista, el motivo; el campo de motivo aparece solo entonces', async () => {
    const accion = vi.fn();
    const cont = montarForm(accion);
    expect(porTestid(cont, 'campo-motivo')).toBeNull();
    escribir(porTestid(cont, 'campo-costo'), '97');
    await enviar(cont.querySelector('form'));
    expect(cont.textContent).toMatch(/de dónde sale el costo/);
    await clic(porTestid(cont, 'campo-es-lista'));
    expect(porTestid(cont, 'campo-motivo')).not.toBeNull();
    escribir(porTestid(cont, 'campo-fuente'), 'lista de Isaac');
    await enviar(cont.querySelector('form'));
    expect(cont.textContent).toMatch(/escribe el motivo/);
    expect(accion).not.toHaveBeenCalled();
  });

  it('confirma antes de guardar, manda la solicitud limpia y repite el resultado', async () => {
    const accion = vi.fn(async () => okRes('Costo guardado: Elf Bar BC5000 a $97.00 por pieza con Isaac.'));
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-costo'), '97');
    escribir(porTestid(cont, 'campo-fuente'), 'lista de Isaac del 11 nov');
    await enviar(cont.querySelector('form'));
    expect(accion).not.toHaveBeenCalled();
    const d = cont.querySelector('dialog')!;
    expect(d.textContent).toContain('Costo actual');
    expect(d.textContent).toContain('$97.00');
    await clic(porTestid(cont, 'confirmar'));
    const [clave, s] = accion.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(clave).toMatch(/^web:/);
    expect(s).toEqual({ proveedor: 'Isaac', modeloId: 7, costo: '97', desde: '2026-11-11', fuente: 'lista de Isaac del 11 nov', esLista: true, motivo: '', supuesto: false });
    expect(porTestid(cont, 'eco-resultado')!.textContent).toContain('Costo guardado');
    expect(refresh).toHaveBeenCalled();
  });

  it('no deja repetir el costo de lista vigente ni empezar el mismo dia', async () => {
    const accion = vi.fn();
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-costo'), '95');
    escribir(porTestid(cont, 'campo-fuente'), 'x');
    await enviar(cont.querySelector('form'));
    expect(cont.textContent).toMatch(/mismo costo/);
    escribir(porTestid(cont, 'campo-costo'), '96');
    escribir(porTestid(cont, 'campo-desde'), '2026-11-01');
    await enviar(cont.querySelector('form'));
    expect(cont.textContent).toMatch(/después del último cambio/);
    expect(accion).not.toHaveBeenCalled();
  });

  it('funcion SQL no instalada: el eco lo explica y no pierde lo capturado', async () => {
    const accion = vi.fn(async () => ({ ok: false, mensaje: 'Esta función todavía no está instalada en la base (ver docs/pendiente-sql-alta.md).', errores: {} }) satisfies ResultadoAlta<CampoCosto>);
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-costo'), '97');
    escribir(porTestid(cont, 'campo-fuente'), 'lista');
    await enviar(cont.querySelector('form'));
    await clic(porTestid(cont, 'confirmar'));
    expect(porTestid(cont, 'eco-resultado')!.textContent).toContain('pendiente-sql-alta');
    expect((porTestid(cont, 'campo-costo') as HTMLInputElement).value).toBe('97');
  });

  it('estado vacio sin modelos', () => {
    const cont = montarForm(vi.fn(), { modelos: [] });
    expect(porTestid(cont, 'sin-modelos')).not.toBeNull();
  });

  it('sin violaciones de accesibilidad (axe)', async () => {
    expect(await auditar(montarForm())).toEqual([]);
  });
});
