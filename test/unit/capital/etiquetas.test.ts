import { describe, expect, it } from 'vitest';
import { ESTADO_PROVEEDOR, etiquetaFondos, etiquetaMesCapital, etiquetaSocio, pctBp, textoIgualar } from '@/dominio/capital/etiquetas';

describe('etiquetas de capital (decision del dueno, 13-nov)', () => {
  it('el socio con la sesion ve «retirados por ti»', () => {
    expect(etiquetaFondos('Javier', 'Javier')).toBe('Fondos de la sociedad retirados por ti');
    expect(etiquetaFondos('Angelo', 'Angelo')).toBe('Fondos de la sociedad retirados por ti');
  });
  it('el otro socio ve el nombre de quien los tiene', () => {
    expect(etiquetaFondos('Javier', 'Angelo')).toBe('Fondos de la sociedad retirados por Javier');
    expect(etiquetaFondos('Angelo', 'Javier')).toBe('Fondos de la sociedad retirados por Angelo');
  });
  it('el reporte, que llega a los dos, usa el nombre de cada socio', () => {
    expect(etiquetaFondos('Angelo', null)).toBe('Fondos de la sociedad retirados por Angelo');
    expect(etiquetaFondos('Javier', null)).toBe('Fondos de la sociedad retirados por Javier');
  });
  it('ninguna etiqueta usa lenguaje de deuda', () => {
    const textos = [etiquetaFondos('Javier', 'Javier'), etiquetaFondos('Javier', null), textoIgualar(100n, (c) => `$${c}`), textoIgualar(0n, () => '')];
    for (const t of textos) expect(t).not.toMatch(/deb|adeud|deuda/i);
  });
  it('la diferencia a igualar y el socio con la sesion', () => {
    expect(textoIgualar(0n, () => '')).toBe('Sin diferencia que igualar');
    expect(textoIgualar(112400n, (c) => `$${c}`)).toBe('Para igualar: $112400');
    expect(etiquetaSocio('Javier', 'Javier')).toBe('Javier (tú)');
    expect(etiquetaSocio('Angelo', 'Javier')).toBe('Angelo');
  });
  it('mes y porcentaje en texto; sin base, sin dato', () => {
    expect(etiquetaMesCapital('2026-11')).toBe('noviembre 2026');
    expect(pctBp(5278)).toBe('52.8 %');
    expect(pctBp(null)).toBeNull();
    expect(ESTADO_PROVEEDOR.se_debe).toBe('Se le debe');
    expect(ESTADO_PROVEEDOR.a_favor).toBe('Saldo a favor');
  });
});
