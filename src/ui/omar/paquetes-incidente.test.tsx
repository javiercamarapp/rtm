// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsearPaquetes } from '@/dominio/omar/lectura';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { ListaPaquetes } from './paquetes';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
let m: Montaje | null = null;
afterEach(() => { m?.desmontar(); m = null; });

const FILA = { consecutivo: 1, tipo: 'entrada', estado: 'incidente', horas: null, llegada_estimada: '2026-11-20', renglones: [{ modelo: 'Karen A', sabor: 'Mango', piezas: 50 }] };

describe('vista de Omar con un paquete perdido o danado', () => {
  it('la lectura acepta el estado incidente y no lo degrada a por empacar', () => {
    expect(parsearPaquetes([FILA])[0]!.estado).toBe('incidente');
  });
  it('se ve como reportado, sin llegada estimada, dinero, proveedor ni cliente', async () => {
    m = montar(<ListaPaquetes lectura={{ estado: 'ok', datos: parsearPaquetes([FILA]) }} />);
    expect(m.cont.textContent).toContain('Reportado perdido o dañado');
    expect(m.cont.textContent).not.toContain('Llegada estimada');
    expect(m.cont.textContent).not.toMatch(/cliente|proveedor|Karen \(|Isaac|\$/i);
    expect(await auditar(m.cont)).toEqual([]);
  });
});
