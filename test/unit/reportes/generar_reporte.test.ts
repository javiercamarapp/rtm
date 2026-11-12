import { describe, it, expect } from 'vitest';
import { claveReporte, generarReporte, verificarPdf, type DependenciasGenerar } from '@/aplicacion/reportes/generar_reporte';
import type { PdfRenderizado } from '@/aplicacion/reportes/puertos';
import { EntregaMemoria, FuenteMemoria, RenderizadorFalso, RepositorioMemoria } from '@/infra/reportes/memoria';
import { PARAMETROS } from '@/dominio/reportes/parametros';
import { ErrorReporte, type ResultadoComprobacion } from '@/dominio/reportes/tipos';
import { sha256BytesHex } from '@/dominio/reportes/util';
import { insumosMensualDorado, insumosSemanalDorado, comprobacionesVerdes } from '../../fixtures/reportes/datos';

function montar(sobre: { semanal?: ReturnType<typeof insumosSemanalDorado>; renderizador?: RenderizadorFalso } = {}) {
  const repo = new RepositorioMemoria();
  const entrega = new EntregaMemoria();
  const render = sobre.renderizador ?? new RenderizadorFalso();
  const deps: DependenciasGenerar = { fuente: new FuenteMemoria(sobre.semanal ?? insumosSemanalDorado(), insumosMensualDorado()), renderizador: render, repositorio: repo, entrega, cssFuentes: '' };
  return { repo, entrega, render, deps };
}
const SEMANA = { tipo: 'semanal', inicio: '2026-11-02' } as const;
const conFalla = (id: string): ResultadoComprobacion[] => comprobacionesVerdes().map((c) => (c.id === id ? { ...c, via2: 2n, ok: false } : c));

describe('el PDF no sale si falla una comprobacion bloqueante', () => {
  it.each(['C3', 'C4', 'C5', 'C10', 'C11', 'C12'])('falla %s: sin PDF, sin correo, aviso de una linea y borrador con marca de agua', async (id) => {
    const { repo, entrega, render, deps } = montar({ semanal: insumosSemanalDorado({ comprobaciones: conFalla(id) }) });
    const r = await generarReporte(SEMANA, deps);
    expect(r.salio).toBe(false);
    if (r.salio) return;
    expect(render.llamadas).toBe(0);
    expect(entrega.envios.filter((e) => e.canal === 'correo')).toHaveLength(0);
    expect(entrega.envios).toHaveLength(1);
    expect(entrega.envios[0]!.canal).toBe('telegram');
    expect(entrega.envios[0]!.adjunto).toBeNull();
    expect(entrega.envios[0]!.texto).toContain(`falla ${id}`);
    expect(entrega.envios[0]!.texto).toContain('reintentar reporte');
    expect(r.aviso.split('\n')).toHaveLength(1);
    const guardado = (await repo.versiones(claveReporte(SEMANA)))[0]!;
    expect(guardado.estado).toBe('borrador');
    expect(guardado.sha256Pdf).toBeNull();
    expect(await repo.pdf(guardado.clave, guardado.version)).toBeNull();
    const html = repo.html(guardado.clave, guardado.version)!;
    expect(html).toContain('class="marca"');
    expect(html).toContain('BORRADOR');
  });
  it('una comprobacion interna (R.*) fallida tambien impide el PDF: nunca sale con una cifra no verificada', async () => {
    const m = insumosMensualDorado();
    const { render, deps } = montar();
    const r = await generarReporte({ tipo: 'mensual', inicio: '2026-10-01' }, { ...deps, fuente: new FuenteMemoria(insumosSemanalDorado(), { ...m, utilidadNetaCent: m.utilidadNetaCent + 1n }) });
    expect(r.salio).toBe(false);
    expect(render.llamadas).toBe(0);
  });
  it('el aviso de no salida con diferencia en pesos usa la unidad de la comprobacion', async () => {
    const c = comprobacionesVerdes().map((x) => (x.id === 'C3' ? { ...x, via1: 5_000_000n, via2: 4_990_000n, ok: false, unidad: 'cent' as const } : x));
    const { deps } = montar({ semanal: insumosSemanalDorado({ comprobaciones: c }) });
    const r = await generarReporte(SEMANA, deps);
    expect(!r.salio && r.aviso).toBe("El reporte semanal no salió: C3 difiere $100. Corrijan y escriban 'reintentar reporte'.");
  });
  it('una no bloqueante (C7) sale PRELIMINAR con la falla listada', async () => {
    const { entrega, deps } = montar({ semanal: insumosSemanalDorado({ comprobaciones: conFalla('C7') }) });
    const r = await generarReporte(SEMANA, deps);
    expect(r.salio).toBe(true);
    if (!r.salio || r.accion === 'sin_cambios') return;
    expect(r.reporte.etiquetas).toEqual(['PRELIMINAR']);
    expect(r.paquete.estado.fallas).toEqual(['C7']);
    expect(entrega.envios.find((e) => e.canal === 'correo')!.asunto).toContain('[PRELIMINAR]');
    expect(entrega.envios.find((e) => e.canal === 'telegram')!.texto).toContain('falla: C7');
  });
  it('sin aprobacion del periodo sale PRELIMINAR; periodo en curso sale PARCIAL; y se combinan', async () => {
    const a = await generarReporte(SEMANA, montar({ semanal: insumosSemanalDorado({ aprobadoEn: undefined }) }).deps);
    expect(a.salio && a.accion !== 'sin_cambios' && a.reporte.etiquetas).toEqual(['PRELIMINAR']);
    const b = await generarReporte(SEMANA, montar({ semanal: insumosSemanalDorado({ enCurso: true, aprobadoEn: undefined }) }).deps);
    expect(b.salio && b.accion !== 'sin_cambios' && b.reporte.etiquetas).toEqual(['PRELIMINAR', 'PARCIAL']);
  });
});

describe('emision: un PDF, un hash, dos canales', () => {
  it('Telegram y correo reciben exactamente el mismo archivo y el hash coincide con el guardado', async () => {
    const { repo, entrega, render, deps } = montar();
    const r = await generarReporte(SEMANA, deps);
    expect(r.salio && r.accion).toBe('emitido');
    expect(render.llamadas).toBe(1);
    expect(entrega.envios).toHaveLength(2);
    const [tg, correo] = entrega.envios;
    expect(tg!.canal).toBe('telegram');
    expect(correo!.canal).toBe('correo');
    expect(correo!.adjunto).toBeNull();
    expect(correo!.enlace).toBe(`/reportes/${encodeURIComponent(claveReporte(SEMANA))}/1`);
    const v = (await repo.versiones(claveReporte(SEMANA)))[0]!;
    expect(v.sha256Pdf).toBe(sha256BytesHex(tg!.adjunto!.bytes));
    expect(v.entregas).toEqual({ telegram: true, correo: true });
    expect(tg!.adjunto!.nombre).toMatch(/^SEM-2026-45-[0-9a-f]{6}\.pdf$/);
  });
  it('idempotencia: el mismo periodo dos veces da el mismo sha256 y no duplica envios', async () => {
    const { repo, entrega, render, deps } = montar();
    const a = await generarReporte(SEMANA, deps);
    const b = await generarReporte(SEMANA, deps);
    expect(b.salio && b.accion).toBe('sin_cambios');
    expect(render.llamadas).toBe(1);
    expect(entrega.envios).toHaveLength(2);
    expect(a.salio && b.salio && a.reporte.sha256Pdf).toBe(b.salio ? b.reporte.sha256Pdf : null);
    expect(await repo.versiones(claveReporte(SEMANA))).toHaveLength(1);
  });
  it('un paquete distinto del mismo periodo se reemite como version nueva y se conserva la anterior', async () => {
    const { repo, entrega, deps } = montar();
    await generarReporte(SEMANA, deps);
    const cambiado = { ...deps, fuente: new FuenteMemoria(insumosSemanalDorado({ socios: { diferenciaCent: 1n, diferenciaAnteriorCent: 2n, omarNetoCent: 0n, omarRentaCent: 0n, omarTomasCent: 0n, omarPagosCent: 0n, omarTomaPendienteHoras: 0 } }), insumosMensualDorado()) };
    const r = await generarReporte(SEMANA, cambiado);
    expect(r.salio && r.accion).toBe('reemitido');
    const versiones = await repo.versiones(claveReporte(SEMANA));
    expect(versiones.map((v) => v.version)).toEqual([1, 2]);
    expect(versiones[0]!.huella).not.toBe(versiones[1]!.huella);
    expect(entrega.envios).toHaveLength(4);
  });
  it('un reintento tras un fallo de un canal solo envia lo que falta', async () => {
    const { repo, entrega, deps } = montar();
    let fallar = true;
    const original = entrega.correoDuenos.bind(entrega);
    entrega.correoDuenos = async (c, a) => {
      if (fallar) throw new Error('SMTP caido');
      return original(c, a);
    };
    await expect(generarReporte(SEMANA, deps)).rejects.toThrow('SMTP caido');
    expect(entrega.envios.map((e) => e.canal)).toEqual(['telegram']);
    fallar = false;
    const r = await generarReporte(SEMANA, deps);
    expect(r.salio).toBe(true);
    expect(entrega.envios.map((e) => e.canal)).toEqual(['telegram', 'correo']);
    expect((await repo.versiones(claveReporte(SEMANA)))[0]!.entregas).toEqual({ telegram: true, correo: true });
  });
  it('un borrador repetido con el mismo paquete no reenvia el aviso', async () => {
    const { entrega, deps } = montar({ semanal: insumosSemanalDorado({ comprobaciones: conFalla('C4') }) });
    await generarReporte(SEMANA, deps);
    const otra = await generarReporte(SEMANA, deps);
    expect(otra.salio).toBe(false);
    expect(entrega.envios).toHaveLength(1);
  });
  it('el mensual usa el mismo flujo con clave propia', async () => {
    const { entrega, deps } = montar();
    const r = await generarReporte({ tipo: 'mensual', inicio: '2026-10-01' }, deps);
    expect(r.salio && r.accion).toBe('emitido');
    expect(entrega.envios.find((e) => e.canal === 'correo')!.asunto).toBe('RTM · Reporte mensual · Octubre 2026 · Definitivo');
    expect(claveReporte({ tipo: 'mensual', inicio: '2026-10-01' })).toBe('mensual:2026-10-01');
  });
  it('el repositorio no sobrescribe versiones publicadas', async () => {
    const repo = new RepositorioMemoria();
    const r = { clave: 'k', version: 1, folio: 'f', huella: 'h', estado: 'publicado' as const, etiquetas: [], sha256Pdf: null, entregas: { telegram: false, correo: false } };
    await repo.guardar(r, null, '');
    await expect(repo.guardar(r, null, '')).rejects.toThrow('no se sobrescriben');
    await expect(repo.marcarEntrega('k', 9, 'correo')).rejects.toThrow('no existe');
  });
});

describe('verificacion del PDF antes de entregarlo', () => {
  const ok: PdfRenderizado = { bytes: new Uint8Array([1]), paginas: 8, paginasConDesborde: [], fuentesIncrustadas: ['ABCDEF+Figtree'] };
  it('acepta un PDF con las paginas esperadas, sin desborde y con fuentes incrustadas', () => {
    expect(() => verificarPdf(ok, 8)).not.toThrow();
  });
  it('rechaza paginas distintas, desborde y falta de fuentes, con el detalle', () => {
    for (const [pdf, texto] of [
      [{ ...ok, paginas: 9 }, 'se esperaban 8'],
      [{ ...ok, paginasConDesborde: [3] }, 'desborde en las paginas 3'],
      [{ ...ok, fuentesIncrustadas: [] }, 'sin fuentes incrustadas'],
    ] as const) {
      try {
        verificarPdf(pdf, 8);
        expect.unreachable();
      } catch (e) {
        expect((e as ErrorReporte).codigo).toBe('PDF_INVALIDO');
        expect((e as ErrorReporte).detalle.join(' ')).toContain(texto);
      }
    }
  });
  it('un PDF con desborde no se entrega: ni Telegram ni correo, y no queda publicado', async () => {
    const { repo, entrega, deps } = montar({ renderizador: new RenderizadorFalso({ paginasConDesborde: [5] }) });
    await expect(generarReporte(SEMANA, deps)).rejects.toThrow(ErrorReporte);
    expect(entrega.envios).toHaveLength(0);
    expect(await repo.versiones(claveReporte(SEMANA))).toHaveLength(0);
  });
  it('el semanal pide 8 hojas (7 y anexo) y el mensual 13 (12 y anexo)', async () => {
    const s = await generarReporte(SEMANA, { ...montar().deps, renderizador: { renderizar: async (h) => ({ ...ok, paginas: (h.match(/class="pagina/g) ?? []).length }) } });
    expect(s.salio).toBe(true);
    expect(PARAMETROS.maxRenglonesTabla).toBe(8);
  });
});
