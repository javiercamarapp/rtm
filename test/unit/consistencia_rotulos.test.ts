import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { armarPulso } from '@/dominio/operacion/pulso';

// Una sola definicion por rotulo: 'Valuación del socio' es la valuacion PERSONAL de api.capital_por_mes (Capital por socio). Dropshipping reparte el capital contable por
// participacion y por eso se rotula distinto; el chip de Isaac muestra la posicion completa del Mayor (2110). Si alguien vuelve a usar el mismo rotulo para otra cifra, esta prueba falla.
const leer = (ruta: string) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');

describe('rotulos que no pueden divergir entre pantallas', () => {
  it('Dropshipping utilidad no usa el rotulo "Valuación del socio" para el reparto del capital contable', () => {
    const t = leer('src/app/(socio)/dropshipping/utilidad/page.tsx');
    expect(t).not.toMatch(/Valuaci[oó]n del socio/);
    expect(t).toContain('Parte del capital contable');
  });
  it('el chip de Isaac muestra la deuda de la empresa segun el Mayor (misma fuente que Proveedores), no solo la cuenta corriente', () => {
    const cuenta = { id: 1, saldo_cent: -206809n, posicion_cent: -29440309n, posicion: { posicion_empresa_cent: -29440309n, menudeo_pendiente_cent: 0n }, movimientos: [{}] } as never;
    const chip = armarPulso({ isaac: cuenta, cxc: null, socios: null, existencia: null }).chips[0]!;
    expect(chip.texto).toBe('$294,403.09');
    expect(chip.detalle).toContain('deuda de la empresa');
    expect(chip.cifra).toBe('proveedor:deuda:Isaac');
    const ayuda = leer('src/ui/shell/pulso-chips.ts');
    expect(ayuda).toContain('Deuda de la empresa con Isaac');
    expect(ayuda).toContain('Proveedores');
  });
  it('Capital por socio es la unica pantalla que rotula la valuacion personal del socio', () => {
    const t = leer('src/app/(socio)/dropshipping/utilidad/page.tsx') + leer('src/ui/shell/pulso-chips.ts');
    expect(t).not.toMatch(/Valuaci[oó]n del socio/);
  });
});
