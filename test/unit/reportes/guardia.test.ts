import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { exigirTextoVerificado, extraerNumeros, fechasEntre, numerosDeValor, numerosPermitidos, verificarTexto } from '@/dominio/reportes/guardia';
import { armarPaquete } from '@/dominio/reportes/paquete';
import { construirReporte, contextoGuardia, reporteATexto, renderizarVerificado } from '@/dominio/reportes/paginas';
import { construirAvisoNoSale, construirCorreo, construirTelegram } from '@/dominio/reportes/entrega';
import { renderHtml, textoVisibleHtml } from '@/dominio/reportes/html';
import { canonNumero } from '@/dominio/reportes/formato';
import { ErrorReporte } from '@/dominio/reportes/tipos';
import { insumosMensualDorado, insumosSemanalDorado } from '../../fixtures/reportes/datos';

const semanal = armarPaquete(insumosSemanalDorado());
const mensual = armarPaquete(insumosMensualDorado());
const ctx = contextoGuardia(semanal);

/** Cambia un digito de un numero del texto por otro que NO este autorizado; devuelve null si no hay modo. */
function mutar(texto: string, permitidos: Set<string>): string | null {
  for (const m of texto.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const tok = m[0];
    for (let i = 0; i < tok.length; i++) {
      if (!/\d/.test(tok[i]!)) continue;
      for (const d of '0123456789') {
        if (d === tok[i]) continue;
        const nuevo = `${tok.slice(0, i)}${d}${tok.slice(i + 1)}`;
        if (/^0\d/.test(nuevo) || permitidos.has(canonNumero(nuevo))) continue;
        return `${texto.slice(0, m.index!)}${nuevo}${texto.slice((m.index ?? 0) + tok.length)}`;
      }
    }
  }
  return null;
}

describe('guardia de numeros: ningun numero fuera del paquete pasa', () => {
  it('numeros del paquete pasan en cualquiera de sus formatos', () => {
    expect(verificarTexto('La utilidad fue $40,422 y vendimos $463,900 en 2,310 pz a $17.50 por pieza (8.7 %).', ctx).ok).toBe(true);
    expect(verificarTexto('Por cobrar $183,400, 22 % con más de treinta días, cobertura 1.3.', ctx).ok).toBe(true);
  });
  it('un numero fuera del paquete se rechaza con el detalle', () => {
    const r = verificarTexto('La utilidad fue $40,423.', ctx);
    expect(r.ok).toBe(false);
    expect(r.violaciones[0]).toContain('$40,423');
    expect(verificarTexto('Vendimos 2,311 pz.', ctx).ok).toBe(false);
    expect(verificarTexto('Subió 63 % contra el promedio.', ctx).ok).toBe(false);
    expect(verificarTexto('Sin digitos aqui.', ctx).ok).toBe(true);
  });
  it('propiedad: cualquier entero que el paquete no autoriza es rechazado', () => {
    const permitidos = numerosPermitidos(ctx);
    fc.assert(
      fc.property(fc.integer({ min: 100_000_000, max: 999_999_999 }), (n) => {
        fc.pre(!permitidos.has(String(n)));
        expect(verificarTexto(`El total fue ${n}.`, ctx).ok).toBe(false);
        expect(verificarTexto(`El total fue $${n.toLocaleString('en-US')}.`, ctx).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
  it('fechas: las del periodo pasan, las ajenas no', () => {
    expect(verificarTexto('Reporte del 2 al 8 de noviembre de 2026, corte 9 nov 05:59.', ctx).ok).toBe(true);
    const r = verificarTexto('Reporte del 2 a 20 de noviembre de 2026.', ctx);
    expect(r.ok).toBe(false);
    expect(r.violaciones[0]).toContain('fecha fuera del periodo');
    expect(verificarTexto('Reporte de 2025.', ctx).ok).toBe(false);
  });
  it('nombres propios con digitos, folios, huellas, ids y numeracion de lista no cuentan como numeros sueltos', () => {
    expect(verificarTexto('Nexa 50K se acaba pronto.', ctx).ok).toBe(true);
    expect(verificarTexto('Fasta Kit 40K y Geek Bar 2GO 50K.', ctx).ok).toBe(true);
    expect(verificarTexto(`SEM-2026-45 · p. 3/7 · huella ${semanal.huella} · C14 en verde · R.CIFRAS`, ctx).ok).toBe(true);
    expect(verificarTexto('SEM-2026-46', ctx).ok).toBe(false);
    expect(verificarTexto('huella ffffff', ctx).ok).toBe(false);
    expect(verificarTexto('corte 9 nov 05:58 Mérida', ctx).ok).toBe(false);
    expect(verificarTexto('1. Primer hallazgo\n2. Segundo hallazgo', ctx).ok).toBe(true);
    expect(verificarTexto('Costo de Nexa 51K', ctx).ok).toBe(false);
  });
  it('exigirTextoVerificado lanza GUARDIA_NUMEROS con las violaciones', () => {
    expect(() => exigirTextoVerificado('Total $1,234,567', ctx)).toThrow(ErrorReporte);
    try {
      exigirTextoVerificado('Total $1,234,567', ctx);
    } catch (e) {
      expect((e as ErrorReporte).codigo).toBe('GUARDIA_NUMEROS');
      expect((e as ErrorReporte).detalle.length).toBe(1);
    }
    expect(() => exigirTextoVerificado('Total $40,422', ctx)).not.toThrow();
  });
  it('extraerNumeros y fechasEntre', () => {
    expect(extraerNumeros('$1,234.50 y −8.7 % y 2,310 pz')).toEqual(['$1,234.50', '−8.7 %', '2,310 pz']);
    expect(fechasEntre('2026-11-02', '2026-11-04')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(() => verificarTexto('x', { ...ctx, fechas: ['no-es-fecha'] })).toThrow(ErrorReporte);
    expect(numerosDeValor(2.5)).toEqual([]);
    expect(numerosDeValor(-4_042_200n)).toContain('40422');
  });
});

describe('prueba de mutacion: un digito cambiado se rechaza', () => {
  const textosSemanal = (() => {
    const r = construirReporte(semanal);
    const t: string[] = [];
    for (const p of r.paginas) t.push(p.titular, p.implicacion, p.siguiente, p.procedencia, ...p.hallazgos, ...p.acciones, ...(p.heroe ? [p.heroe.valor] : []), ...p.apoyo.map((a) => `${a.valor} ${a.comparacion}`));
    t.push(construirTelegram(semanal), construirCorreo(semanal).cuerpo, construirCorreo(semanal).asunto);
    return t.filter((x) => /\d/.test(x));
  })();
  it('en cada texto de la semana (paginas, Telegram y correo) mutar un digito lo hace fallar', () => {
    const permitidos = numerosPermitidos(ctx);
    let mutados = 0;
    for (const t of textosSemanal) {
      expect(verificarTexto(t, ctx).ok, `el original debe pasar: ${t}`).toBe(true);
      const m = mutar(t, permitidos);
      if (m === null) continue;
      mutados += 1;
      expect(verificarTexto(m, ctx).ok, `la mutacion debe fallar: ${m}`).toBe(false);
    }
    expect(mutados).toBeGreaterThan(20);
  });
  it('lo mismo con los textos del mes', () => {
    const c = contextoGuardia(mensual);
    const permitidos = numerosPermitidos(c);
    const r = construirReporte(mensual);
    let mutados = 0;
    for (const p of r.paginas) for (const t of [p.titular, p.procedencia, ...p.hallazgos, ...p.acciones].filter((x) => /\d/.test(x))) {
      expect(verificarTexto(t, c).ok, t).toBe(true);
      const m = mutar(t, permitidos);
      if (m) {
        mutados += 1;
        expect(verificarTexto(m, c).ok, m).toBe(false);
      }
    }
    expect(mutados).toBeGreaterThan(8);
  });
});

describe('todo numero del documento pertenece al paquete', () => {
  it('el texto visible del HTML semanal (sin anexo de parametros) pasa la guardia', () => {
    const html = renderHtml(construirReporte(semanal), { cssFuentes: '' });
    const sinAnexo = html.slice(0, html.indexOf('id="anexo"'));
    const r = verificarTexto(textoVisibleHtml(sinAnexo), ctx);
    expect(r.violaciones).toEqual([]);
  });
  it('el texto visible del HTML mensual (sin anexo) pasa la guardia', () => {
    const html = renderHtml(construirReporte(mensual), { cssFuentes: '' });
    const sinAnexo = html.slice(0, html.indexOf('id="anexo"'));
    const r = verificarTexto(textoVisibleHtml(sinAnexo), contextoGuardia(mensual));
    expect(r.violaciones).toEqual([]);
  });
  it('un digito alterado en el HTML renderizado se detecta', () => {
    const html = renderHtml(construirReporte(semanal), { cssFuentes: '' });
    const alterado = html.replace('$40,422', '$40,423');
    const sinAnexo = alterado.slice(0, alterado.indexOf('id="anexo"'));
    expect(verificarTexto(textoVisibleHtml(sinAnexo), ctx).ok).toBe(false);
  });
  it('las salidas de entrega pasan la guardia por construccion y el aviso de no salida tambien', () => {
    expect(() => renderizarVerificado(semanal, 'Ventas {{cifra:ventas}}')).not.toThrow();
    expect(() => renderizarVerificado(semanal, 'Ventas $1,234,567')).toThrow(ErrorReporte);
    const c = armarPaquete(insumosSemanalDorado({ comprobaciones: [{ id: 'C3', nombre: 'Balanza', via1: 100_000n, via2: 90_000n, ok: false, unidad: 'cent' }] }));
    expect(construirAvisoNoSale(c)).toBe("El reporte semanal no salió: C3 difiere $100. Corrijan y escriban 'reintentar reporte'.");
    expect(reporteATexto(construirReporte(semanal))).toContain('Página 1 de 7');
  });
});
