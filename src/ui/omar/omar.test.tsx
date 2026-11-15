// @vitest-environment jsdom
// Componentes de la vista de Omar: contenido, estados vacios y de "SQL pendiente", accesibilidad (axe) y que nada prohibido llegue a la pantalla.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proyectarSemana } from '@/dominio/omar/cuenta';
import type { Solicitud } from '@/dominio/omar/tipos';
import { ExplicarProvider } from '../componentes/explicar';
import { auditar, montar, type Montaje } from '../graficas/pruebas/ayudas';
import { ArmazonOmar, SECCIONES_OMAR, seccionActiva } from './armazon-omar';
import { ListaDisponible, ListaSolicitudes } from './bodega';
import { BloqueProyeccion, CifrasCuenta, TablaLiquidaciones, TablaPagos, TablaRentaDia, TablaTransacciones } from './cuenta';
import { FormularioSolicitud } from './formulario-solicitud';
import { ListaPaquetes } from './paquetes';
import { CUENTA, DISPONIBLE, LIQUIDACIONES, PAQUETES } from '../../../test/unit/omar/fixtures';

let ruta = '/mi-bodega';
const refrescar = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => ruta, useRouter: () => ({ refresh: refrescar }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const explicar = vi.fn(async () => { throw new Error('no'); });
const envuelto = (el: React.ReactElement) => <ExplicarProvider explicar={explicar}>{el}</ExplicarProvider>;
const ok = <T,>(datos: T) => ({ estado: 'ok' as const, datos });

let m: Montaje | null = null;
afterEach(() => { m?.desmontar(); m = null; refrescar.mockClear(); });

const cambiar = (el: Element, valor: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor);
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
};

describe('armazon de Omar', () => {
  it('tres secciones propias y ningun enlace a paginas de socios', async () => {
    m = montar(<ArmazonOmar accionSalir={async () => {}}><p>hola</p></ArmazonOmar>);
    const hrefs = [...m.cont.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h !== '/mi-bodega' || true).every((h) => h!.startsWith('/mi-bodega'))).toBe(true);
    expect(SECCIONES_OMAR.map((s) => s.etiqueta)).toEqual(['Mi bodega', 'Mi cuenta', 'Paquetes', 'Pago renta']);
    expect(m.cont.textContent).not.toMatch(/Dueño|Angelo|Javier|Proveedores|Clientes|Cuenta de socios/);
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('la seccion activa es la mas especifica', () => {
    expect(seccionActiva('/mi-bodega')).toBe(0);
    expect(seccionActiva('/mi-bodega/cuenta')).toBe(1);
    expect(seccionActiva('/mi-bodega/paquetes')).toBe(2);
    expect(seccionActiva('/mi-bodega/pago-renta')).toBe(3);
    expect(seccionActiva('/otra')).toBe(-1);
  });
  it('marca aria-current en la seccion de la ruta', () => {
    ruta = '/mi-bodega/cuenta';
    m = montar(<ArmazonOmar accionSalir={async () => {}}>x</ArmazonOmar>);
    expect(m.cont.querySelector('[aria-current="page"]')?.textContent).toBe('Mi cuenta');
    ruta = '/mi-bodega';
  });
});

describe('disponible', () => {
  it('lista modelo, sabor y piezas; sin precios, costos ni totales', async () => {
    m = montar(<ListaDisponible lectura={ok(DISPONIBLE)} />);
    expect(m.cont.textContent).toContain('ELUX LEGEND 3.5K');
    expect(m.cont.textContent).toContain('12 pz');
    expect(m.cont.textContent).not.toMatch(/\$|costo|margen|precio|total/i);
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('el buscador filtra y muestra estado vacio sin coincidencias', () => {
    m = montar(<ListaDisponible lectura={ok(DISPONIBLE)} />);
    cambiar(m.cont.querySelector('input')!, 'mango');
    expect(m.cont.textContent).toContain('WAKA BLAST 50K');
    expect(m.cont.textContent).not.toContain('Elux');
    cambiar(m.cont.querySelector('input')!, 'zzz');
    expect(m.cont.textContent).toContain('Sin coincidencias');
  });
  it('bodega vacia y error de lectura', () => {
    m = montar(<ListaDisponible lectura={ok([])} />);
    expect(m.cont.textContent).toContain('Bodega vacía');
    m.desmontar();
    m = montar(<ListaDisponible lectura={{ estado: 'error' }} />);
    expect(m.cont.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('solicitudes', () => {
  const base: Solicitud = { folio: 'T-0001', modelo: 'Elux Legend 3.5K', sabor: 'Sandía', piezas: 3, estado: 'pendiente', solicitada_at: '2026-11-10T18:00:00.000Z', caduca_at: '2026-11-13T18:00:00.000Z', resuelta_at: null };
  const ahora = '2026-11-11T18:00:00.000Z';
  it('muestra los cuatro estados en palabra y el tiempo restante de la pendiente', () => {
    const lista = [
      base,
      { ...base, folio: 'T-0002', estado: 'autorizada' as const },
      { ...base, folio: 'T-0003', estado: 'rechazada' as const },
      { ...base, folio: 'T-0004', estado: 'pendiente' as const, caduca_at: '2026-11-10T20:00:00.000Z' },
    ];
    m = montar(<ListaSolicitudes lectura={ok(lista)} ahoraIso={ahora} />);
    const t = m.cont.textContent!;
    for (const palabra of ['Pendiente', 'Autorizada', 'Rechazada', 'Caducada']) expect(t).toContain(palabra);
    expect(t).toContain('caduca en 48 h');
  });
  it('sin funcion en la base dice que aun no esta habilitada, sin inventar una lista vacia', () => {
    m = montar(<ListaSolicitudes lectura={{ estado: 'pendiente_sql' }} ahoraIso={ahora} />);
    expect(m.cont.querySelector('[data-testid="lectura-pendiente"]')).not.toBeNull();
  });
});

describe('cuenta', () => {
  const sem = '2026-11-09';
  it('cifras con Explicar este numero: renta, acumulada, pagos y saldo', async () => {
    m = montar(envuelto(<CifrasCuenta movs={ok(CUENTA)} liqs={ok(LIQUIDACIONES)} semanaIni={sem} />));
    const botones = [...m.cont.querySelectorAll('button.rtm-cifra')];
    expect(botones).toHaveLength(4);
    expect(botones.every((b) => /Explicar este número/.test(b.getAttribute('aria-label')!))).toBe(true);
    expect(m.cont.textContent).toContain('$40.00');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('sin liquidaciones el saldo es Sin dato, no cero', () => {
    m = montar(envuelto(<CifrasCuenta movs={ok(CUENTA)} liqs={{ estado: 'pendiente_sql' }} semanaIni={sem} />));
    expect(m.cont.textContent).toContain('Sin dato');
  });
  it('la proyeccion siempre dice Estimado y muestra rango y neto', () => {
    const p = proyectarSemana({ movs: CUENTA, paquetes: PAQUETES, cfg: { renta_por_pieza_cent: 200n }, hoy: '2026-11-11' });
    m = montar(<BloqueProyeccion proyeccion={p} />);
    const t = m.cont.textContent!;
    expect(t).toContain('Estimado');
    expect(m.cont.querySelector('[data-testid="rango-renta"]')?.textContent).toBe('$40.00 a $60.00');
    expect(t).toContain('−$390.00');
  });
  it('sin historia o sin paquetes la proyeccion es Sin dato con su motivo', () => {
    m = montar(<BloqueProyeccion proyeccion={{ tipo: 'sin_dato', motivo: 'sin_paquetes' }} />);
    expect(m.cont.textContent).toContain('Estimado');
    expect(m.cont.textContent).toContain('Sin dato');
    expect(m.cont.textContent).toContain('paquetes por preparar');
  });
  it('renta por dia, transacciones y pagos: sin folios de pedido ni clientes', async () => {
    m = montar(<><TablaRentaDia movs={CUENTA} semanaIni={sem} /><TablaTransacciones movs={CUENTA} /><TablaPagos movs={CUENTA} /></>);
    const t = m.cont.textContent!;
    expect(t).toContain('incluye un ajuste');
    expect(t).toContain('T-0001');
    expect(t).toContain('PO-0001');
    expect(t).not.toMatch(/P-01\d\d/);
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('liquidacion: comprobacion y estado de pago', async () => {
    m = montar(<TablaLiquidaciones lectura={ok(LIQUIDACIONES)} />);
    expect(m.cont.textContent).toContain('Cuadra');
    expect(m.cont.textContent).toContain('Pago pendiente');
    expect(m.cont.textContent).toContain('Falta $20.00');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('liquidaciones sin la funcion de la base: aviso, no tabla vacia', () => {
    m = montar(<TablaLiquidaciones lectura={{ estado: 'pendiente_sql' }} />);
    expect(m.cont.querySelector('[data-testid="lectura-pendiente"]')).not.toBeNull();
  });
});

describe('paquetes', () => {
  it('separa por preparar y por recibir, sin cliente ni proveedor', async () => {
    m = montar(<ListaPaquetes lectura={ok(PAQUETES)} />);
    expect(m.cont.querySelectorAll('[data-testid="paquete-salida"]')).toHaveLength(2);
    expect(m.cont.querySelectorAll('[data-testid="paquete-entrada"]')).toHaveLength(1);
    expect(m.cont.textContent).toContain('Por empacar');
    expect(m.cont.textContent).toContain('Llegada estimada');
    expect(m.cont.textContent).not.toMatch(/cliente|proveedor|Karen|Isaac|Castores|\$/i);
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('vacios y SQL pendiente', () => {
    m = montar(<ListaPaquetes lectura={ok([])} />);
    expect(m.cont.textContent).toContain('No hay paquetes pendientes de preparar');
    m.desmontar();
    m = montar(<ListaPaquetes lectura={{ estado: 'pendiente_sql' }} />);
    expect(m.cont.querySelector('[data-testid="lectura-pendiente"]')).not.toBeNull();
  });
});

describe('formulario de solicitud', () => {
  const enviarOk = () => vi.fn(async (e: { clave: string }) => ({ ok: true as const, folio: 'T-0009', estado: 'pendiente' as const, caduca_at: '', repetido: false, _k: e.clave }));

  it('elige modelo, sabor y cantidad; el maximo respeta el tope y la existencia', async () => {
    m = montar(<FormularioSolicitud disponible={DISPONIBLE} tope={15} caducaHoras={72} enviar={enviarOk()} />);
    const cant = m.cont.querySelector('input[type="number"]') as HTMLInputElement;
    expect(cant.max).toBe('12');
    const [modelo, sabor] = m.cont.querySelectorAll('select');
    cambiar(modelo!, 'Waka Blast 50K');
    expect((m.cont.querySelectorAll('select')[1] as HTMLSelectElement).value).toBe('Mango');
    expect((m.cont.querySelector('input[type="number"]') as HTMLInputElement).max).toBe('15');
    expect(sabor).toBeDefined();
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('envia con una clave web:<uuid> y muestra la confirmacion', async () => {
    const enviar = enviarOk();
    m = montar(<FormularioSolicitud disponible={DISPONIBLE} tope={15} caducaHoras={72} enviar={enviar} />);
    cambiar(m.cont.querySelector('input[type="number"]')!, '4');
    await act(async () => { (m!.cont.querySelector('form') as HTMLFormElement).requestSubmit(); });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0]![0]).toMatchObject({ modelo: 'Elux Legend 3.5K', sabor: 'Sandía', piezas: 4 });
    expect(enviar.mock.calls[0]![0].clave).toMatch(/^web:[0-9a-f-]{36}$/);
    expect(m.cont.querySelector('[data-testid="solicitud-ok"]')?.textContent).toContain('T-0009');
    expect(refrescar).toHaveBeenCalled();
  });
  it('un reintento tras un error conserva la misma clave; tras un exito, la renueva', async () => {
    const claves: string[] = [];
    let n = 0;
    const enviar = vi.fn(async (e: { clave: string }) => {
      claves.push(e.clave);
      return n++ === 0 ? { ok: false as const, motivo: 'sin_cola' as const, mensaje: 'No se pudo enviar la solicitud. Intenta de nuevo.' } : { ok: true as const, folio: 'T-0010', estado: 'pendiente' as const, caduca_at: '', repetido: false };
    });
    m = montar(<FormularioSolicitud disponible={DISPONIBLE} tope={15} caducaHoras={72} enviar={enviar} />);
    const enviarForm = async () => { await act(async () => { (m!.cont.querySelector('form') as HTMLFormElement).requestSubmit(); }); };
    await enviarForm();
    expect(m.cont.querySelector('[data-testid="solicitud-error"]')?.textContent).toContain('No se pudo enviar');
    await enviarForm();
    await enviarForm();
    expect(claves[0]).toBe(claves[1]);
    expect(claves[2]).not.toBe(claves[1]);
  });
  it('no permite enviar cantidades fuera de rango', () => {
    m = montar(<FormularioSolicitud disponible={DISPONIBLE} tope={15} caducaHoras={72} enviar={enviarOk()} />);
    const boton = m.cont.querySelector('[data-testid="enviar-solicitud"]') as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    cambiar(m.cont.querySelector('input[type="number"]')!, '13');
    expect(boton.disabled).toBe(true);
    cambiar(m.cont.querySelector('input[type="number"]')!, '0');
    expect(boton.disabled).toBe(true);
    cambiar(m.cont.querySelector('input[type="number"]')!, '2.5');
    expect(boton.disabled).toBe(true);
  });
  it('bodega vacia: no hay formulario', () => {
    m = montar(<FormularioSolicitud disponible={[]} tope={15} caducaHoras={72} enviar={enviarOk()} />);
    expect(m.cont.querySelector('form')).toBeNull();
    expect(m.cont.querySelector('[data-testid="sin-piezas"]')).not.toBeNull();
  });
});
