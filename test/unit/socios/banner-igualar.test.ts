import { describe, expect, it } from 'vitest';
import { centavosABigint } from '@/dominio/operacion/json';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { fraseBannerAgente, textoAntiguedad, vistaBanner, type BannerIgualacion } from '@/dominio/socios/banner-igualar';
import { respuestaValuacionAgente, type VistaValuacionAgente } from '@/dominio/socios/valuacion';

const f = (c: bigint) => formatearMoneda(c);
const vacio = { dias_fondos: null, desde: null, entregado_cent: 0n, entrega_total_cent: 0n, progreso_bp: null, entregas: [] };

// Cifras del dueno (14-nov): Javier 154,832.30, Angelo 106,910.39; falta 47,921.91 = 35,475.00 de fondos + 12,446.91 de aportacion.
const banner = (over: Partial<BannerIgualacion> = {}): BannerIgualacion => ({
  activo: true, igualados: false, exacto: false, tolerancia_cent: 1n, faltan_cent: 4792191n, mayor: 'Javier', menor: 'Angelo', neteo_cent: 0n, cuadra: true, regla: '',
  por_socio: {
    Angelo: { ...vacio, entregar_cent: 3547500n, aportar_cent: 1244691n, dias_fondos: 4, desde: '2026-11-10' },
    Javier: { ...vacio, entregar_cent: 0n, aportar_cent: 0n },
  },
  ...over,
});

describe('vistaBanner', () => {
  it('socio por debajo: accion con dos partidas y enlaces al flujo que pide la intencion', () => {
    const v = vistaBanner(banner(), 'Angelo', f, etiquetaFecha)!;
    expect(v.variante).toBe('repone');
    expect(v.rol).toBe('alert');
    expect(v.rotulo).toBe('Acción requerida');
    expect(v.titulo).toBe('Debes reponer $47,921.91 para igualar valuación');
    expect(v.partidas.map((p) => [p.id, p.monto])).toEqual([['entregar', '$35,475.00'], ['aportar', '$12,446.91']]);
    expect(v.partidas[0]!.texto).toBe('Entregar a la sociedad los fondos recibidos en tu cuenta personal');
    expect(v.partidas[0]!.href).toBe('/cuentas-por-cobrar?vista=socios');
    expect(v.partidas[1]!.href).toBe('/socios');
    expect(v.antiguedad).toBe('Fondos en tu poder desde hace 4 días (10 nov 2026)');
  });
  it('el otro socio: informativo, sin accion y con el desglose en el titulo', () => {
    const v = vistaBanner(banner(), 'Javier', f, etiquetaFecha)!;
    expect(v.variante).toBe('informa');
    expect(v.rol).toBe('status');
    expect(v.rotulo).toBe('Para tu información');
    expect(v.titulo).toBe('Angelo debe reponer $47,921.91 para igualar valuación (entregar $35,475.00 y aportar $12,446.91)');
    expect(v.partidas[0]!.texto).toContain('la cuenta personal de Angelo');
  });
  it('sin aportacion: solo la partida de entrega (B solo si existe diferencia no explicada por fondos)', () => {
    const b = banner({ faltan_cent: 3547500n, por_socio: { Angelo: { ...vacio, entregar_cent: 3547500n, aportar_cent: 0n, dias_fondos: 1, desde: '2026-11-13' } } });
    const v = vistaBanner(b, 'Angelo', f, etiquetaFecha)!;
    expect(v.partidas.map((p) => p.id)).toEqual(['entregar']);
    expect(v.antiguedad).toContain('desde hace 1 día ');
  });
  it('sin fondos: solo aportar, sin antiguedad', () => {
    const b = banner({ faltan_cent: 1244691n, por_socio: { Angelo: { ...vacio, entregar_cent: 0n, aportar_cent: 1244691n } } });
    const v = vistaBanner(b, 'Angelo', f, etiquetaFecha)!;
    expect(v.partidas.map((p) => p.id)).toEqual(['aportar']);
    expect(v.antiguedad).toBeNull();
  });
  it('entregas parciales y barra de avance salen de lo que entrego la base', () => {
    const b = banner({ por_socio: { Angelo: { ...vacio, entregar_cent: 2547500n, aportar_cent: 1244691n, dias_fondos: 5, desde: '2026-11-09', entregado_cent: 1000000n, entrega_total_cent: 3547500n, progreso_bp: 2819, entregas: [{ fecha: '2026-11-12', monto_cent: 1000000n }] } } });
    const v = vistaBanner(b, 'Angelo', f, etiquetaFecha)!;
    expect(v.progreso).toEqual({ pct: 28.19, texto: 'Entregado $10,000.00 de $35,475.00' });
    expect(v.entregas).toEqual([{ texto: '12 nov 2026', monto: '$10,000.00' }]);
  });
  it('dos socios con fondos: se anuncia el neteo y no se suman partidas en el cliente', () => {
    const v = vistaBanner(banner({ neteo_cent: 500000n }), 'Angelo', f, etiquetaFecha)!;
    expect(v.neteo).toBe('Javier también tiene $5,000.00 de la sociedad por entregar. Las dos entregas se netean: la regla es igualar valuaciones, no cada partida.');
  });
  it('igualados (tolerancia de un centavo) o sin dato: no hay banner', () => {
    expect(vistaBanner(banner({ activo: false, igualados: true, faltan_cent: 1n, exacto: false }), 'Angelo', f, etiquetaFecha)).toBeNull();
    expect(vistaBanner(banner({ activo: false, igualados: true, faltan_cent: 0n, exacto: true, mayor: null, menor: null }), 'Javier', f, etiquetaFecha)).toBeNull();
    expect(vistaBanner(null, 'Javier', f, etiquetaFecha)).toBeNull();
    expect(vistaBanner(undefined, 'Javier', f, etiquetaFecha)).toBeNull();
  });
  it('socio sin nombre conocido ve la variante informativa', () => {
    expect(vistaBanner(banner(), null, f, etiquetaFecha)!.variante).toBe('informa');
  });
  it('la explicacion dice que la entrega no es capital y que la aportacion solo lo es si se declara', () => {
    const v = vistaBanner(banner(), 'Angelo', f, etiquetaFecha)!;
    expect(v.explicacion).toMatch(/no es aportación de capital/);
    expect(v.explicacion).toMatch(/únicamente si lo declaras/);
  });
});

describe('textoAntiguedad', () => {
  it('formas', () => {
    expect(textoAntiguedad(null)).toBeNull();
    expect(textoAntiguedad(0)).toBe('desde hoy');
    expect(textoAntiguedad(1)).toBe('desde hace 1 día');
    expect(textoAntiguedad(12)).toBe('desde hace 12 días');
  });
});

describe('lectura de datos (jsonb de la base a bigint)', () => {
  it('convierte todas las claves *_cent del banner, incluidas las de las entregas, y deja dias y bp como numeros', () => {
    const crudo = { banner: { activo: true, igualados: false, exacto: false, tolerancia_cent: 1, faltan_cent: 4792191, mayor: 'Javier', menor: 'Angelo', neteo_cent: 0, cuadra: true, regla: '',
      por_socio: { Angelo: { entregar_cent: 3547500, aportar_cent: 1244691, dias_fondos: 4, desde: '2026-11-10', entregado_cent: 0, entrega_total_cent: 3547500, progreso_bp: null, entregas: [{ fecha: '2026-11-12', monto_cent: 100 }] } } } };
    const c = centavosABigint<{ banner: BannerIgualacion }>(crudo);
    expect(c.banner.faltan_cent).toBe(4792191n);
    expect(c.banner.por_socio.Angelo!.entregar_cent).toBe(3547500n);
    expect(c.banner.por_socio.Angelo!.entregas[0]!.monto_cent).toBe(100n);
    expect(c.banner.por_socio.Angelo!.dias_fondos).toBe(4);
    expect(vistaBanner(c.banner, 'Angelo', f, etiquetaFecha)!.faltanTexto).toBe('$47,921.91');
  });
});

describe('frase del bot de Telegram', () => {
  it('misma cifra que el banner, para quien debe y para el otro, sin emojis', () => {
    expect(fraseBannerAgente(banner(), 'Angelo', f)).toBe('Debes reponer $47,921.91 para igualar valuación (entregar $35,475.00 y aportar $12,446.91); los fondos están en tu cuenta personal desde hace 4 días');
    expect(fraseBannerAgente(banner(), 'Javier', f)).toBe('Angelo debe reponer $47,921.91 para igualar valuación (entregar $35,475.00 y aportar $12,446.91); los fondos están en su cuenta personal desde hace 4 días');
    expect(fraseBannerAgente(banner(), 'Javier', f)).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(fraseBannerAgente(banner({ activo: false, igualados: true }), 'Javier', f)).toBe('Valuaciones igualadas');
    expect(fraseBannerAgente(undefined, 'Javier', f)).toBeNull();
  });
  it('respuestaValuacionAgente agrega la frase solo cuando hay diferencia', () => {
    const v: VistaValuacionAgente = {
      socios: [{ socio: 'Angelo', valuacion_cent: 10691039n, fondos_en_poder_cent: 3547500n, capital_aportado_cent: 10571500n }, { socio: 'Javier', valuacion_cent: 15483230n, fondos_en_poder_cent: 0n, capital_aportado_cent: 11816191n }],
      igualacion: { igualados: false, faltan_cent: 4792191n, mayor: 'Javier', menor: 'Angelo', componentes: [], suma_componentes_cent: 4792191n,
        por_socio: { Angelo: { entregar_cent: 3547500n, valuacion_tras_entregar_cent: 14238539n, aportar_cent: 1244691n }, Javier: { entregar_cent: 0n, valuacion_tras_entregar_cent: 15483230n, aportar_cent: 0n } },
        diferencia_libro_cent: 4792191n, coincide_con_libro: true, regla: '' },
      banner: banner(), retiros_desiguales: false, diferencia_retiros_cent: 0n, retiro_mas: null,
    };
    const r = respuestaValuacionAgente(v, 'Angelo', f)!;
    expect(r.textos.find((t) => t.etiqueta === 'Igualar valuación')!.texto).toContain('Debes reponer $47,921.91');
    const sin = respuestaValuacionAgente({ ...v, banner: undefined }, 'Angelo', f)!;
    expect(sin.textos.some((t) => t.etiqueta === 'Igualar valuación')).toBe(false);
  });
});
