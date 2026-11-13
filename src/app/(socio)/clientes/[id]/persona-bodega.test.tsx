// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, porTestid, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import { AltaPersonaBodega } from './persona-bodega';

const refresh = vi.fn();
const ejecutar = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../../operacion/acciones', () => ({ ejecutar: (a: string, args: Record<string, unknown>) => ejecutar(a, args) }));

const montajes: Montaje[] = [];
beforeAll(simularDialogo);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); refresh.mockClear(); ejecutar.mockReset(); });

describe('AltaPersonaBodega', () => {
  it('pide confirmar y manda la accion con el cliente y una clave de idempotencia; sin dueno ni montos', async () => {
    ejecutar.mockResolvedValue({ ok: true, datos: {} });
    const m = montar(<AltaPersonaBodega clienteId={7} nombre="Omar Demo" />);
    montajes.push(m);
    expect(ejecutar).not.toHaveBeenCalled();
    await clic(porTestid(m.cont, 'alta-persona-bodega'));
    expect(m.cont.textContent).toContain('Omar Demo será la persona que presta la bodega');
    await clic(porTestid(m.cont, 'confirmar'));
    expect(ejecutar).toHaveBeenCalledTimes(1);
    const [accion, args] = ejecutar.mock.calls[0]!;
    expect(accion).toBe('registrar_persona_bodega');
    expect(args).toMatchObject({ p_cliente_id: 7 });
    expect(String(args.p_clave_idem)).toMatch(/^web:/);
    expect(refresh).toHaveBeenCalled();
  });

  it('muestra el error de la base y no cierra el dialogo', async () => {
    ejecutar.mockResolvedValue({ ok: false, mensaje: 'ya hay una persona de bodega configurada', codigo: '23505' });
    const m = montar(<AltaPersonaBodega clienteId={7} nombre="Omar Demo" />);
    montajes.push(m);
    await clic(porTestid(m.cont, 'alta-persona-bodega'));
    await clic(porTestid(m.cont, 'confirmar'));
    expect(m.cont.textContent).toContain('ya hay una persona de bodega configurada');
  });
});
