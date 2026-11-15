import { describe, expect, it } from 'vitest';
import { enlaceWhatsApp, mensajeNotaCliente } from '@/dominio/nota/mensaje';

describe('mensajeNotaCliente', () => {
  it('pone el modelo en mayusculas y deja intactas las demas lineas', () => {
    const base = 'Nota Cliente Uno\nWaka Blade 10pz x $243.42 = 2,434.20\nGeek Bar Somax 40pz x $150 = 6,000\nEnvío $300\n\ntotal a saldar 8,734.20';
    expect(mensajeNotaCliente(base)).toBe('Nota Cliente Uno\nWAKA BLADE 10pz x $243.42 = 2,434.20\nGEEK BAR SOMAX 40pz x $150 = 6,000\nEnvío $300\n\ntotal a saldar 8,734.20');
  });
  it('es idempotente', () => {
    const una = mensajeNotaCliente('Waka Blade 10pz x $1 = 10');
    expect(mensajeNotaCliente(una)).toBe(una);
  });
});

describe('enlaceWhatsApp', () => {
  it('no lleva telefono y codifica el mensaje', () => {
    const u = enlaceWhatsApp('Hola\ntotal $1 & más');
    expect(u.startsWith('https://wa.me/?text=')).toBe(true);
    expect(u).not.toMatch(/wa\.me\/\d/);
    expect(decodeURIComponent(u.slice('https://wa.me/?text='.length))).toBe('Hola\ntotal $1 & más');
  });
});
