// La pagina de Costos del sistema con datos simulados del mismo formato que entrega la base (api.costos_*): vacia y con los cargos de una carga mensual.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CargoVista, ResumenMesVista, ServicioVista } from '@/dominio/costos/vista';

const estado = vi.hoisted(() => ({ lector: null as unknown }));
vi.mock('@/composicion/costos', () => ({ costosDeSocio: async () => estado.lector }));
vi.mock('@/app/(socio)/operacion/usar-accion', () => ({
  useAccion: () => ({ correr: async () => undefined, ocupado: false, error: null, aviso: null }),
  centavosDeTexto: () => null,
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: unknown }) => createElement('a', { href: String(href) }, children as never) }));

const servicio = (slug: string, nombre: string, extra: Partial<ServicioVista> = {}): ServicioVista => ({
  id: 1, slug, nombre, categoria: 'nube', fase: 'mantenimiento', ciclo: 'mensual', dia_renovacion: null, moneda: 'USD', metodo_atribucion: 'x', pagador_default: 'javier',
  cobrable: true, opcional: false, activo: true, cuota_documento_orig_micro: null, logo_slug: null, ...extra,
});
const SERVICIOS = [servicio('vercel', 'Vercel', { cuota_documento_orig_micro: 20_000_000 }), servicio('supabase', 'Supabase', { cuota_documento_orig_micro: 25_000_000 })];
const ceros = { redondeado_cent: 0n, exacto_e6: 0 };
const resumenVacio: ResumenMesVista = {
  mes: '2026-11', servicios: [], operar: ceros, opcionales: ceros, construccion: ceros, total: ceros, al_menos: false, faltantes: [], incluye_construccion: false,
  cuenta_javier: { socio: 'javier', cargado_cent: 0n, reembolsado_cent: 0n, pendiente_cent: 0n, movimientos: [] }, tipo_cambio: null,
};
const cargo = (id: number, slug: string, nombre: string, base: number, montoCent: bigint): CargoVista => ({
  id, folio: `K-000${id}`, servicio_slug: slug, servicio: nombre, categoria: 'nube', logo_slug: null, opcional: false, mes: '2026-11', fecha_neg: '2026-11-14', fase: 'mantenimiento', moneda: 'USD',
  base_orig_micro: base, pct_exacto_ppm: 1_000_000, pct_aplicado_ppm: 1_000_000, tc_micro: 20_000_000, tc_fecha: '2026-11-14', tc_fuente: 'manual', exacto_mxn_e6: Number(montoCent) * 1_000_000,
  exacto_puro_mxn_e6: Number(montoCent) * 1_000_000, monto_cent: montoCent, como_seria_cent: montoCent, como_deberia_cent: null, pagado_por: 'javier', cobrable: true, etiqueta: 'proyeccion',
  estado: 'provisional', evidencia_tipo: 'captura', tiene_evidencia: false, nota: '', reversa_de: null, anulado: false, gasto_folio: `G-${id}`,
});

function lector(resumen: ResumenMesVista, cargos: CargoVista[]) {
  return {
    servicios: async () => SERVICIOS,
    resumen: async () => resumen,
    cargos: async () => cargos,
    cuenta: async () => resumen.cuenta_javier,
    tipoCambio: async () => null,
    explicar: async (id: number) => ({
      cargo: cargos.find((c) => c.id === id)!, metodo: 'Cuota del documento', atribuido_orig_micro: 20_000_000,
      comprobacion: { via1: 'Base por porcentaje por tipo de cambio', via1_cent: 40_000n, via2: 'Monto guardado', via2_cent: 40_000n, cuadra: true },
    }),
  };
}

async function html(mes: string) {
  const { default: Pagina } = await import('@/app/(socio)/costos/page');
  return renderToStaticMarkup(await Pagina({ searchParams: Promise.resolve({ mes }) }));
}

describe('pagina de costos del sistema', () => {
  it('sin cargos explica por que esta vacia y como cargarlos', async () => {
    estado.lector = lector(resumenVacio, []);
    const h = await html('2026-11');
    expect(h).toContain('Sin cargos del mes');
    expect(h).toContain('node scripts/costos/cargar-mes.mjs --mes 2026-11 --aplicar');
    expect(h).toContain('no significan que el sistema no cueste');
  });

  it('con la carga mensual muestra los cargos, el total y el aviso de datos faltantes con "al menos"', async () => {
    const cargos = [cargo(1, 'vercel', 'Vercel', 20_000_000, 40_000n), cargo(2, 'supabase', 'Supabase', 25_000_000, 50_000n)];
    const r: ResumenMesVista = {
      ...resumenVacio, operar: { redondeado_cent: 90_000n, exacto_e6: 90_000_000_000 }, total: { redondeado_cent: 90_000n, exacto_e6: 90_000_000_000 }, al_menos: true,
      faltantes: [{ slug: 'openrouter', servicio: 'OpenRouter', motivo: 'sin consumo medido' }],
      cuenta_javier: { ...resumenVacio.cuenta_javier, cargado_cent: 90_000n, pendiente_cent: 90_000n },
    };
    estado.lector = lector(r, cargos);
    const h = await html('2026-11');
    expect(h).not.toContain('Sin cargos del mes');
    expect(h).toContain('K-0001');
    expect(h).toContain('K-0002');
    expect(h).toContain('$900.00');
    expect(h).toContain('(al menos)');
    expect(h).toContain('OpenRouter (sin consumo medido)');
  });
});
