// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResultadoAlta } from '@/aplicacion/catalogo/alta';
import type { CampoCliente } from '@/dominio/catalogo/alta';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, enviar, escribir, porTestid, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import { FormularioCliente } from './formulario-cliente';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const montajes: Montaje[] = [];
beforeAll(simularDialogo);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); refresh.mockClear(); });
const m = (el: React.ReactElement) => { const x = montar(el); montajes.push(x); return x; };
const ok = (eco: string, sinCambio = false): ResultadoAlta<CampoCliente> => ({ ok: true, eco, id: 12, sinCambio });

describe('FormularioCliente (alta)', () => {
  it('muestra nombre, tipo y nota; sin campos de dueno, telefono ni direccion', () => {
    const { cont } = m(<FormularioCliente modo="nuevo" accion={vi.fn()} />);
    const texto = cont.textContent!;
    expect(texto).toContain('Nombre del cliente');
    expect(texto).toContain('Tipo');
    expect(texto).toContain('Nota (opcional)');
    expect(texto).not.toMatch(/Dueño|Angelo|Javier|Teléfono|Dirección/);
    expect(porTestid(cont, 'guardar-cliente')!.textContent).toBe('Crear cliente');
  });

  it('valida en el navegador y no llama a la accion con datos malos', async () => {
    const accion = vi.fn();
    const { cont } = m(<FormularioCliente modo="nuevo" accion={accion} />);
    await enviar(cont.querySelector('form'));
    expect(accion).not.toHaveBeenCalled();
    expect(cont.querySelector('[role="alert"]')!.textContent).toMatch(/nombre del cliente/);
    expect(cont.querySelector('[data-testid="campo-nombre"]')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('guarda, repite el resultado con enlace a sus precios, limpia el formulario y refresca', async () => {
    const accion = vi.fn(async () => ok('Cliente creado: Tienda Norte.'));
    const { cont } = m(<FormularioCliente modo="nuevo" accion={accion} />);
    escribir(porTestid(cont, 'campo-nombre'), 'Tienda Norte');
    await enviar(cont.querySelector('form'));
    expect(accion).toHaveBeenCalledTimes(1);
    const [clave, entrada] = accion.mock.calls[0] as unknown as [string, { nombre: string; tipo: string }];
    expect(clave).toMatch(/^web:[0-9a-f-]{8,64}$/);
    expect(entrada).toMatchObject({ nombre: 'Tienda Norte', tipo: 'mayoreo' });
    expect(porTestid(cont, 'eco-resultado')!.textContent).toContain('Cliente creado: Tienda Norte.');
    expect(cont.querySelector('a[href="/clientes/12/precios"]')).not.toBeNull();
    expect((porTestid(cont, 'campo-nombre') as HTMLInputElement).value).toBe('');
    expect(refresh).toHaveBeenCalled();
  });

  it('un fallo conserva lo escrito, muestra el error y reintenta con la MISMA clave', async () => {
    const accion = vi.fn()
      .mockResolvedValueOnce({ ok: false, mensaje: 'Ya existe otro cliente con ese nombre.', errores: {} } satisfies ResultadoAlta<CampoCliente>)
      .mockResolvedValue(ok('Cliente creado: Tienda Norte.'));
    const { cont } = m(<FormularioCliente modo="nuevo" accion={accion} />);
    escribir(porTestid(cont, 'campo-nombre'), 'Tienda Norte');
    await enviar(cont.querySelector('form'));
    expect(porTestid(cont, 'eco-resultado')!.textContent).toContain('Ya existe otro cliente');
    expect((porTestid(cont, 'campo-nombre') as HTMLInputElement).value).toBe('Tienda Norte');
    expect(refresh).not.toHaveBeenCalled();
    await enviar(cont.querySelector('form'));
    expect(accion.mock.calls[0]![0]).toBe(accion.mock.calls[1]![0]);
    escribir(porTestid(cont, 'campo-nombre'), 'Otra Tienda');
    await enviar(cont.querySelector('form'));
    expect(accion.mock.calls[2]![0]).not.toBe(accion.mock.calls[1]![0]);
  });

  it('una excepcion de red se muestra como mensaje, no rompe la pantalla', async () => {
    const accion = vi.fn(async () => { throw new Error('red'); });
    const { cont } = m(<FormularioCliente modo="nuevo" accion={accion} />);
    escribir(porTestid(cont, 'campo-nombre'), 'Tienda Norte');
    await enviar(cont.querySelector('form'));
    expect(porTestid(cont, 'eco-resultado')!.textContent).toMatch(/Revisa tu conexión/);
  });

  it('el error por campo que manda el servidor se pinta junto al campo', async () => {
    const accion = vi.fn(async () => ({ ok: false, mensaje: 'Revisa los campos marcados.', errores: { nota: 'La nota es muy larga.' } }) satisfies ResultadoAlta<CampoCliente>);
    const { cont } = m(<FormularioCliente modo="nuevo" accion={accion} />);
    escribir(porTestid(cont, 'campo-nombre'), 'Tienda Norte');
    await enviar(cont.querySelector('form'));
    expect(cont.textContent).toContain('La nota es muy larga.');
  });

  it('sin violaciones de accesibilidad (axe)', async () => {
    const { cont } = m(<FormularioCliente modo="editar" accion={vi.fn()} inicial={{ nombre: 'Tienda Norte', tipo: 'mayoreo', nota: '', activo: true }} />);
    expect(await auditar(cont)).toEqual([]);
  });
});

describe('FormularioCliente (edicion)', () => {
  const inicial = { nombre: 'Tienda Norte', tipo: 'credito_interno', nota: 'paga a 7 dias', activo: true };
  it('precarga los datos y ofrece la casilla de activo', () => {
    const { cont } = m(<FormularioCliente modo="editar" accion={vi.fn()} inicial={inicial} />);
    expect((porTestid(cont, 'campo-nombre') as HTMLInputElement).value).toBe('Tienda Norte');
    expect((porTestid(cont, 'campo-tipo') as HTMLSelectElement).value).toBe('credito_interno');
    expect(porTestid(cont, 'campo-activo')).not.toBeNull();
    expect(porTestid(cont, 'guardar-cliente')!.textContent).toBe('Guardar cambios');
  });
  it('desactivar pide confirmacion y cancelar no guarda', async () => {
    const accion = vi.fn(async () => ok('Cliente actualizado.'));
    const { cont } = m(<FormularioCliente modo="editar" accion={accion} inicial={inicial} />);
    await clic(porTestid(cont, 'campo-activo'));
    await enviar(cont.querySelector('form'));
    expect(accion).not.toHaveBeenCalled();
    expect(cont.querySelector('dialog')!.textContent).toMatch(/dejará de ofrecerse/);
    await clic(Array.from(cont.querySelectorAll('dialog button')).find((b) => b.textContent === 'Cancelar') ?? null);
    expect(accion).not.toHaveBeenCalled();
  });
  it('desactivar y confirmar guarda con activo=false', async () => {
    const accion = vi.fn(async () => ok('Cliente actualizado.'));
    const { cont } = m(<FormularioCliente modo="editar" accion={accion} inicial={inicial} />);
    await clic(porTestid(cont, 'campo-activo'));
    await enviar(cont.querySelector('form'));
    await clic(porTestid(cont, 'confirmar'));
    expect(accion).toHaveBeenCalledTimes(1);
    expect((accion.mock.calls[0] as unknown as [string, { activo: boolean }])[1].activo).toBe(false);
  });
});
