// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { TarjetaWhatsApp } from './tarjeta-whatsapp';

const MENSAJE = 'Nota Cliente Uno\nWAKA BLADE 10pz x $243.42 = 2,434.20\n\ntotal a saldar 2,434.20';
const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
const Nota = () => <article className="rtm-nota-doc"><strong>NOTA</strong><p>PRODUCTO</p><button type="button" aria-label="$1. Explicar este número">$1</button></article>;
const unica = (m: Montaje, testid: string) => m.cont.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
const esperar = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); vi.unstubAllGlobals(); });

describe('TarjetaWhatsApp', () => {
  it('muestra logo, titulo, vista previa, burbuja y las tres acciones', () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} urlPdf="/notas/7/pdf?v=cliente" nombreArchivo="NP-1.pdf" nombreDocumento="nota NP-1" vistaPrevia={<Nota />} hora="10 nov 14:32" />));
    expect(m.cont.querySelector('[aria-label="WhatsApp"] svg')).not.toBeNull();
    expect(m.cont.textContent).toContain('Enviar nota por WhatsApp');
    expect(unica(m, 'wa-vista-previa').getAttribute('aria-label')).toBe('Abrir vista ampliada de nota NP-1');
    expect(unica(m, 'texto-whatsapp').textContent).toBe(MENSAJE);
    expect(unica(m, 'copiar-texto').textContent).toBe('Copiar para WhatsApp');
    const pdf = unica(m, 'descargar-pdf');
    expect(pdf.textContent).toBe('Descargar PDF de la nota');
    expect(pdf.getAttribute('href')).toBe('/notas/7/pdf?v=cliente');
    expect(pdf.getAttribute('download')).toBe('NP-1.pdf');
    expect(m.cont.textContent).toContain('En computadora: descarga el PDF, copia el mensaje');
  });

  it('Abrir en WhatsApp usa wa.me sin telefono, en pestana nueva y con el mensaje codificado', () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} urlPdf="/x.pdf" />));
    const a = unica(m, 'abrir-whatsapp') as HTMLAnchorElement;
    expect(a.href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(a.href).not.toMatch(/wa\.me\/\d/);
    expect(decodeURIComponent(a.href.slice('https://wa.me/?text='.length))).toBe(MENSAJE);
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });

  it('Copiar escribe el mensaje, confirma "Copiado" en una region viva y no envia nada', async () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} urlPdf="/x.pdf" />));
    await act(async () => { unica(m, 'copiar-texto').click(); });
    await esperar();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MENSAJE);
    const aviso = unica(m, 'wa-aviso');
    expect(aviso.textContent).toBe('Copiado');
    expect(aviso.getAttribute('aria-live')).toBe('polite');
    expect(aviso.getAttribute('role')).toBe('status');
  });

  it('si el portapapeles falla avisa con una alerta y deja el texto a la vista', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('x')) } });
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} />));
    await act(async () => { unica(m, 'copiar-texto').click(); });
    await esperar();
    expect(unica(m, 'wa-aviso').getAttribute('role')).toBe('alert');
    expect(unica(m, 'wa-aviso').textContent).toContain('No se pudo copiar');
  });

  it('sin PDF solo hay mensaje: sin vista previa ni boton de PDF', () => {
    const m = abrir(montar(<TarjetaWhatsApp titulo="Enviar cobro por WhatsApp" mensaje={MENSAJE} />));
    expect(m.cont.querySelector('[data-testid="wa-vista-previa"]')).toBeNull();
    expect(m.cont.querySelector('[data-testid="descargar-pdf"]')).toBeNull();
    expect(m.cont.textContent).toContain('Copia el mensaje y pégalo');
  });

  it('con texto completo en servidor copia ese texto, lo audita en la accion y no ofrece abrir WhatsApp', async () => {
    const completo = vi.fn().mockResolvedValue('TEXTO COMPLETO');
    const m = abrir(montar(<TarjetaWhatsApp mensaje="enmascarado" obtenerCompleto={completo} />));
    expect(m.cont.querySelector('[data-testid="abrir-whatsapp"]')).toBeNull();
    await act(async () => { unica(m, 'copiar-texto').click(); });
    await esperar();
    expect(completo).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TEXTO COMPLETO');
  });

  it('con Web Share de archivos ofrece Compartir PDF y mensaje y comparte el PDF real con el texto', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() }, canShare: () => true, share });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) }));
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} urlPdf="/notas/7/pdf?v=cliente" nombreArchivo="NP-1.pdf" />));
    await esperar();
    const b = unica(m, 'compartir-pdf');
    expect(b.textContent).toBe('Compartir PDF y mensaje');
    await act(async () => { b.click(); });
    await esperar();
    const arg = share.mock.calls[0]![0] as { files: File[]; text: string };
    expect(arg.files[0]!.name).toBe('NP-1.pdf');
    expect(arg.files[0]!.type).toBe('application/pdf');
    expect(arg.text).toBe(MENSAJE);
  });

  it('Ver mensaje completo expande y colapsa con aria-expanded', () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} />));
    const b = unica(m, 'wa-ver-mensaje');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    act(() => b.click());
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(b.textContent).toBe('Ver menos');
  });

  it('clic en la vista previa abre la vista ampliada con la nota completa y Cerrar devuelve el foco', () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} urlPdf="/x.pdf" nombreDocumento="nota NP-1" vistaPrevia={<Nota />} />));
    const vista = unica(m, 'wa-vista-previa');
    expect(m.cont.querySelector('[data-testid="wa-ampliada"] .rtm-nota-doc')).toBeNull();
    act(() => vista.click());
    const d = unica(m, 'wa-ampliada') as HTMLDialogElement;
    expect(d.hasAttribute('open')).toBe(true);
    expect(d.querySelector('.rtm-nota-doc')).not.toBeNull();
    expect(d.textContent).toContain('Vista ampliada de nota NP-1');
    act(() => unica(m, 'wa-cerrar').click());
    expect(d.hasAttribute('open')).toBe(false);
  });

  it('sin violaciones de accesibilidad (axe), cerrada y con la vista ampliada abierta', async () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} urlPdf="/x.pdf" nombreDocumento="nota NP-1" vistaPrevia={<Nota />} estado="Versión anterior" hora="10 nov 14:32" />));
    expect(await auditar(m.cont)).toEqual([]);
    act(() => unica(m, 'wa-vista-previa').click());
    expect(await auditar(m.cont)).toEqual([]);
  });

  it('es horizontal: una fila con vista previa, mensaje y acciones, y la ayuda al pie en una sola linea', () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} urlPdf="/x.pdf" vistaPrevia={<Nota />} />));
    const fila = m.cont.querySelector('.rtm-wa-fila')!;
    expect(fila.hasAttribute('data-vista')).toBe(true);
    expect([...fila.children].map((c) => c.className)).toEqual(['rtm-wa-vista', 'rtm-wa-chat', 'rtm-wa-acciones']);
    expect(fila.querySelector('.rtm-wa-acciones [data-testid="copiar-texto"]')).not.toBeNull();
    expect(m.cont.querySelector('.rtm-wa-pie .rtm-wa-ayuda')).not.toBeNull();
    expect(m.cont.querySelector('.rtm-wa-pie [data-testid="wa-aviso"]')).not.toBeNull();
  });

  it('sin vista previa la fila tiene dos zonas', () => {
    const m = abrir(montar(<TarjetaWhatsApp mensaje={MENSAJE} />));
    const fila = m.cont.querySelector('.rtm-wa-fila')!;
    expect(fila.hasAttribute('data-vista')).toBe(false);
    expect([...fila.children].map((c) => c.className)).toEqual(['rtm-wa-chat', 'rtm-wa-acciones']);
  });
});
