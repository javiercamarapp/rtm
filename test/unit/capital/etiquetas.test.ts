import { describe, expect, it } from 'vitest';
import { ESTADO_PROVEEDOR, NOTA_IGUALACION, etiquetaFondos, etiquetaMesCapital, etiquetaSocio, pctBp, textoIgualar, textoReinversion, textoTurno } from '@/dominio/capital/etiquetas';

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

  it('turno de aportar: el de menos aportacion neta, o Igualados', () => {
    const f = (c: bigint) => `$${c}`;
    expect(textoTurno('Javier', 4792191n, f)).toBe('Le toca aportar el siguiente pago: Javier por $4792191');
    expect(textoTurno(null, 0n, f)).toBe('Igualados');
    expect(textoTurno('Angelo', 0n, f)).toBe('Igualados');
    expect(textoTurno('Javier', 1n, f)).not.toMatch(/deb|adeud|deuda/i);
  });
  it('la nota dice que aportar mas no da mas participacion y que la diferencia no es deuda', () => {
    expect(NOTA_IGUALACION).not.toMatch(/50 ?\/ ?50|50 ?%/);
    expect(NOTA_IGUALACION).toContain('no da más participación');
    expect(NOTA_IGUALACION).toContain('no es una deuda ni un reembolso a favor del otro');
  });
  it('reinversion del mes: igual para los dos o alerta informativa', () => {
    const f = (c: bigint) => `$${c}`;
    expect(textoReinversion(0n, 0n, f)).toBeNull();
    expect(textoReinversion(500000n, 500000n, f)).toEqual({ igual: true, texto: 'Reinvertido este mes: igual para los dos' });
    const r = textoReinversion(500000n, 200000n, f)!;
    expect(r.igual).toBe(false);
    expect(r.texto).toContain('Angelo $500000');
    expect(r.texto).toContain('Javier $200000');
  });
});
