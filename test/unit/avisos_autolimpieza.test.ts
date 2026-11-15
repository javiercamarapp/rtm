import { describe, expect, it } from 'vitest';
import { filtroDeAvisos, motivoResuelto } from '@/dominio/notificaciones/vigencia';
import { informe, parsearArgs } from '../../scripts/notificaciones/formato.mjs';

describe('autolimpieza de avisos: dominio', () => {
  it('la pestana por omision es solo lo vigente', () => {
    expect(filtroDeAvisos(undefined)).toBe('todas');
    expect(filtroDeAvisos('raro')).toBe('todas');
    expect(filtroDeAvisos('sin_leer')).toBe('sin_leer');
    expect(filtroDeAvisos('resueltos')).toBe('resueltos');
  });
  it('el motivo de un cerrado sale de la base y, si falta, se dice con palabras llanas', () => {
    expect(motivoResuelto('resuelta', 'resuelto solo: la causa desaparecio (el pago ya se identifico)')).toBe('Resuelto solo: la causa desaparecio (el pago ya se identifico)');
    expect(motivoResuelto('caducada', null)).toBe('Caduco por antiguedad');
    expect(motivoResuelto('descartada', undefined)).toBe('Descartado por una persona');
    expect(motivoResuelto('resuelta', '')).toBe('Resuelto');
  });
});

describe('autolimpieza de avisos: script resolver-vigentes', () => {
  it('por omision solo verifica y no admite los dos modos a la vez', () => {
    expect(parsearArgs([])).toEqual({ aplicar: false });
    expect(parsearArgs(['--verificar'])).toEqual({ aplicar: false });
    expect(parsearArgs(['--aplicar'])).toEqual({ aplicar: true });
    expect(parsearArgs(['--aplicar', '--verificar']).error).toBeDefined();
    expect(parsearArgs(['--borrar']).error).toContain('--borrar');
  });
  const res = {
    aplicado: false, resueltos: 1, retirados: 1, reabiertos: 0,
    detalle: [
      { id: 7, codigo: 'conteo_con_diferencia', titulo: 'Conteo cerrado con 3 diferencias', accion: 'resolver', motivo: 'resuelto solo: la causa desaparecio (un conteo posterior las confirmo)', ref: 'conteo:9' },
      { id: 8, codigo: 'paquete_enviado_con_guia', titulo: 'Paquete enviado: P-0001', accion: 'retirar', motivo: 'retirado: informativo con mas de 7 dias', ref: null },
    ],
  };
  it('en verificacion usa condicional y cuenta lo que haria', () => {
    const l = informe(res);
    expect(l[0]).toContain('Se resolveria: #7');
    expect(l[0]).toContain('ref conteo:9');
    expect(l[1]).toContain('Se retiraria: #8');
    expect(l.at(-1)).toBe('Solo lectura: 1 por resolver, 1 informativos por retirar, 0 por reabrir.');
  });
  it('al aplicar usa el pasado', () => {
    const l = informe({ ...res, aplicado: true });
    expect(l[0]).toContain('Resuelto: #7');
    expect(l.at(-1)).toMatch(/^Aplicado:/);
  });
});
