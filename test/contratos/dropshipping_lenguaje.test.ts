// Lenguaje de los pedidos a costo y de los fondos en poder (decision del dueno, 13-nov): "pendiente de pago" / "pendiente de entregar", nunca "deuda" ni "debe".
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rutaPropiaSegura } from '@/dominio/acceso/ruta_segura';

const PROHIBIDO = /\b(deuda|deudas|debe|deben|adeuda|adeudo)\b/i;
const raiz = process.cwd();
const archivos = (dir: string): string[] => readdirSync(join(raiz, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []));

describe('lenguaje sin deuda en Pedidos menudeo', () => {
  it('ninguna pantalla de Pedidos menudeo usa lenguaje de deuda', () => {
    for (const f of archivos('src/app/(socio)/menudeo')) expect(readFileSync(join(raiz, f), 'utf8'), f).not.toMatch(PROHIBIDO);
  });
  it('el bloque del Inicio dice pendiente de pago y pendiente de entregar', () => {
    const s = readFileSync(join(raiz, 'src/app/(socio)/page.tsx'), 'utf8');
    const bloque = s.slice(s.indexOf('Pedidos pendientes de pago'), s.indexOf('Ventas por semana'));
    expect(bloque).not.toMatch(PROHIBIDO);
    expect(bloque).toContain('Sin pedidos pendientes');
    expect(bloque).toContain('pendientes de entregar');
  });
  it('la tarjeta de aportacion neta de Cuenta de socios no usa lenguaje de deuda', () => {
    const s = readFileSync(join(raiz, 'src/app/(socio)/socios/page.tsx'), 'utf8');
    const bloque = s.slice(s.indexOf('Aportación neta y diferencia a igualar'), s.indexOf('Aportación neta por socio') + 200);
    expect(bloque).not.toMatch(PROHIBIDO);
  });
  it('las rutas nuevas son destinos propios validos del acceso', () => {
    expect(rutaPropiaSegura('/menudeo?socio=Angelo')).toBe(true);
    expect(rutaPropiaSegura('/dropshipping/pedidos')).toBe(true);
  });
});
