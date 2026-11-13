import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVIDENCIA_MAX_BYTES, pendienteTras, seAplicaDeInmediato, TEXTO_ESTADO_PAGO, validarEvidencia } from '@/dominio/dropshipping/evidencia';

describe('evidencia de pago', () => {
  it('acepta PNG, JPEG y PDF de hasta 2 MB', () => {
    for (const t of ['image/png', 'image/jpeg', 'application/pdf']) expect(validarEvidencia(t, 1000)).toBeNull();
    expect(validarEvidencia('image/png', EVIDENCIA_MAX_BYTES)).toBeNull();
  });
  it('rechaza otros tipos, vacios y de mas de 2 MB', () => {
    expect(validarEvidencia('text/plain', 10)).not.toBeNull();
    expect(validarEvidencia('image/gif', 10)).not.toBeNull();
    expect(validarEvidencia('image/png', 0)).not.toBeNull();
    expect(validarEvidencia('application/pdf', EVIDENCIA_MAX_BYTES + 1)).not.toBeNull();
  });
});

describe('politica de confirmacion del pago de un pedido a costo', () => {
  it('con evidencia basta registrar; lo registra el otro socio: tambien', () => {
    expect(seAplicaDeInmediato(true, 'Angelo', 'Angelo')).toBe(true);
    expect(seAplicaDeInmediato(false, 'Javier', 'Angelo')).toBe(true);
  });
  it('sin evidencia reportado por el dueno (Telegram o web) espera al otro socio', () => {
    expect(seAplicaDeInmediato(false, 'Angelo', 'Angelo')).toBe(false);
  });
  it('un pago parcial deja saldo y solo el total cubre el costo', () => {
    expect(pendienteTras(892_900n, 300_000n)).toBe(592_900n);
    expect(pendienteTras(892_900n, 892_900n)).toBe(0n);
    expect(pendienteTras(892_900n, 900_000n)).toBe(0n);
  });
  it('estados con lenguaje de pendiente de pago, sin deuda', () => {
    expect(TEXTO_ESTADO_PAGO.no_pagado).toBe('Pendiente de pago');
    expect(TEXTO_ESTADO_PAGO.pago_reportado).toBe('Pago reportado');
    expect(Object.values(TEXTO_ESTADO_PAGO).join(' ')).not.toMatch(/deuda|debe/i);
  });
});

describe('contrato de Telegram pago_pedido_menudeo', () => {
  const doc = readFileSync(join(process.cwd(), 'docs/dropshipping-telegram-contrato.md'), 'utf8');
  it('documenta la intencion, la funcion y que la evidencia nunca pasa por la IA', () => {
    expect(doc).toContain('pago_pedido_menudeo');
    expect(doc).toContain('operacion.ds_reportar_pago_menudeo');
    expect(doc).toMatch(/NUNCA pasa por la IA/);
    expect(doc).toContain('Pago reportado');
  });
});
