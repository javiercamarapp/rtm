// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResultadoAlta } from '@/aplicacion/catalogo/alta';
import type { CampoPrecio } from '@/dominio/catalogo/alta';
import { ExplicarProvider } from '@/ui/componentes/explicar';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, enviar, escribir, porTestid, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import { FormularioPrecio, type ModeloParaPrecio } from './formulario-precio';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const montajes: Montaje[] = [];
beforeAll(simularDialogo);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); refresh.mockClear(); });

const MODELOS: ModeloParaPrecio[] = [
  { id: 7, nombre: 'Elf Bar BC5000', actual: { cent: '15000', desde: '2026-11-05' } },
  { id: 8, nombre: 'Lost Mary 20K', actual: null },
];
const explicar = () => Promise.reject(new Error('no se usa'));
function montarForm(accion = vi.fn(), extra: Partial<React.ComponentProps<typeof FormularioPrecio>> = {}) {
  const x = montar(<ExplicarProvider explicar={explicar}><FormularioPrecio clienteId={3} clienteNombre="Tienda Norte" modelos={MODELOS} hoy="2026-11-11" accion={accion} {...extra} /></ExplicarProvider>);
  montajes.push(x);
  return x.cont;
}
const okRes = (eco: string): ResultadoAlta<CampoPrecio> => ({ ok: true, eco, id: 1, sinCambio: false });

describe('FormularioPrecio', () => {
  it('muestra el precio vigente como cifra explicable y avisa que pasa al historial', () => {
    const cont = montarForm();
    const vigente = porTestid(cont, 'precio-vigente')!;
    expect(vigente.textContent).toContain('$150.00');
    expect(vigente.textContent).toContain('pasa al historial');
    expect(vigente.querySelector('button.rtm-cifra')!.getAttribute('aria-label')).toBe('$150.00. Explicar este número');
  });

  it('modelo sin precio: indica que es el primero y no exige motivo', async () => {
    const accion = vi.fn(async () => okRes('Precio guardado.'));
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-modelo'), '8');
    expect(cont.textContent).toContain('todavía no tiene precio para este modelo');
    escribir(porTestid(cont, 'campo-precio'), '120');
    await enviar(cont.querySelector('form'));
    expect(cont.querySelector('dialog')!.textContent).toContain('primer precio');
  });

  it('cambiar un precio vigente exige motivo, y pide confirmacion con el antes y el despues', async () => {
    const accion = vi.fn(async () => okRes('Precio guardado: Elf Bar BC5000 a $160.00.'));
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-precio'), '160');
    await enviar(cont.querySelector('form'));
    expect(accion).not.toHaveBeenCalled();
    expect(cont.querySelector('dialog')).toBeNull();
    expect(cont.textContent).toMatch(/por qué cambia/);

    escribir(porTestid(cont, 'campo-nota'), 'acordado por chat');
    await enviar(cont.querySelector('form'));
    const dialogo = cont.querySelector('dialog')!;
    expect(dialogo.textContent).toContain('Precio actual');
    expect(dialogo.textContent).toContain('$150.00');
    expect(dialogo.textContent).toContain('$160.00');
    expect(dialogo.textContent).toContain('sube $10.00');
    expect(accion).not.toHaveBeenCalled();
  });

  it('cancelar la confirmacion no guarda; confirmar guarda una vez con clave y repite el resultado', async () => {
    const accion = vi.fn(async () => okRes('Precio guardado: Elf Bar BC5000 a $160.00 por pieza para Tienda Norte.'));
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-precio'), '160');
    escribir(porTestid(cont, 'campo-nota'), 'acordado');
    await enviar(cont.querySelector('form'));
    await clic(Array.from(cont.querySelectorAll('dialog button')).find((b) => b.textContent === 'Cancelar') ?? null);
    expect(accion).not.toHaveBeenCalled();
    await enviar(cont.querySelector('form'));
    await clic(porTestid(cont, 'confirmar'));
    expect(accion).toHaveBeenCalledTimes(1);
    const [clave, solicitud] = accion.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(clave).toMatch(/^web:/);
    expect(solicitud).toEqual({ clienteId: 3, modeloId: 7, precio: '160', desde: '2026-11-11', nota: 'acordado' });
    expect(porTestid(cont, 'eco-resultado')!.textContent).toContain('Precio guardado');
    expect(refresh).toHaveBeenCalled();
    expect((porTestid(cont, 'campo-precio') as HTMLInputElement).value).toBe('');
  });

  it('el error de la base se muestra en el eco y conserva lo capturado', async () => {
    const accion = vi.fn(async () => ({ ok: false, mensaje: 'La vigencia cae antes del último cambio registrado. Elige una fecha posterior.', errores: {} }) satisfies ResultadoAlta<CampoPrecio>);
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-precio'), '160');
    escribir(porTestid(cont, 'campo-nota'), 'acordado');
    await enviar(cont.querySelector('form'));
    await clic(porTestid(cont, 'confirmar'));
    expect(porTestid(cont, 'eco-resultado')!.textContent).toContain('Elige una fecha posterior');
    expect((porTestid(cont, 'campo-precio') as HTMLInputElement).value).toBe('160');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('la vigencia retroactiva se detecta en el navegador antes de molestar a la base', async () => {
    const accion = vi.fn();
    const cont = montarForm(accion);
    escribir(porTestid(cont, 'campo-precio'), '160');
    escribir(porTestid(cont, 'campo-nota'), 'x');
    escribir(porTestid(cont, 'campo-desde'), '2026-11-05');
    await enviar(cont.querySelector('form'));
    expect(cont.textContent).toMatch(/después del último cambio/);
    expect(accion).not.toHaveBeenCalled();
  });

  it('preselecciona el modelo de la fila elegida', () => {
    const cont = montarForm(vi.fn(), { modeloInicial: 8 });
    expect((porTestid(cont, 'campo-modelo') as HTMLSelectElement).value).toBe('8');
  });

  it('estado vacio: sin modelos en el catalogo no ofrece formulario', () => {
    const cont = montarForm(vi.fn(), { modelos: [] });
    expect(porTestid(cont, 'sin-modelos')).not.toBeNull();
    expect(cont.querySelector('form')).toBeNull();
  });

  it('sin violaciones de accesibilidad (axe)', async () => {
    expect(await auditar(montarForm())).toEqual([]);
  });
});
