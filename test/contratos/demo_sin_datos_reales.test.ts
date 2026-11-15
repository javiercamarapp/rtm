// Contrato: el conjunto demo es 100 % ficticio. Nada de telefonos, correos ni nombres reales; nada de secretos; el demo no puede apuntar a produccion.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generarDemo } from '../../scripts/demo/generador.mjs';
import { USUARIOS } from '../../scripts/demo/datos-base.mjs';
import { PROYECTOS_PRODUCCION } from '../../scripts/demo/guardas.mjs';

const plan = generarDemo({ hoy: '2026-11-15' });
const DIR = join(process.cwd(), 'scripts/demo');
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
// Fragmentos de nombres de clientes REALES, guardados solo como huella (el nombre no vive en el repo).
const HUELLAS_REALES = new Set(['fer vazquez', 'happy spot', 'vazquez', 'happy'].map(sha));

const texto = JSON.stringify(plan);

describe('demo: el generador no contiene datos reales', () => {
  it('todo correo es @example.test', () => {
    const correos = texto.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? [];
    expect(correos.length).toBeGreaterThan(0);
    for (const c of correos) expect(c.toLowerCase().endsWith('@example.test'), c).toBe(true);
    for (const u of USUARIOS) expect(u.correo.endsWith('@example.test')).toBe(true);
  });
  it('todo telefono usa el rango ficticio 555 010', () => {
    const sinIds = texto.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '').replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\d+\.\d+(?:e-?\d+)?/g, '');
    const tels = sinIds.match(/\+?\d[\d ()-]{7,}\d/g) ?? [];
    expect(tels.length).toBeGreaterThan(0);
    for (const t of tels) expect(/555 010 \d{4}/.test(t), t).toBe(true);
    expect(sinIds.match(/\d{10,}/g) ?? [], 'ninguna secuencia de 10 o mas digitos').toEqual([]);
  });
  it('todo cliente lleva la palabra Demo y ninguno coincide con la lista de clientes reales', () => {
    for (const c of plan.clientes as { nombre: string; nota: string }[]) {
      expect(/\bDemo\b/.test(c.nombre), c.nombre).toBe(true);
      for (const parte of [norm(c.nombre), ...norm(c.nombre).split(' ')]) expect(HUELLAS_REALES.has(sha(parte)), 'nombre real').toBe(false);
    }
  });
  it('los socios y personas del demo son Socio Demo A, Socio Demo B y Omar Demo', () => {
    expect(USUARIOS.map((u: { nombre: string }) => u.nombre)).toEqual(['Socio Demo A', 'Socio Demo B', 'Omar Demo', 'Bodega Demo']);
  });
  it('las guias de paqueteria son ficticias (DEMO-)', () => {
    const guias = plan.ops.filter((o: { guia?: string }) => o.guia).map((o: { guia: string }) => o.guia);
    expect(guias.length).toBeGreaterThan(20);
    for (const g of guias) expect(g.startsWith('DEMO-'), g).toBe(true);
  });
  it('no hay destinatarios con datos personales ni llaves', () => {
    expect(texto).not.toMatch(/destinatario|calle|colonia|llave|password|contrasena|secret|eyJ/i);
  });
});

describe('demo: el codigo del demo no guarda secretos ni datos reales', () => {
  const archivos = readdirSync(DIR).filter((f) => f.endsWith('.mjs'));
  it('ningun archivo trae llaves, contrasenas ni telefonos', () => {
    for (const f of archivos) {
      const t = readFileSync(join(DIR, f), 'utf8');
      expect(t, f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
      expect(t, f).not.toMatch(/sk_(live|test)_|service_role\s*[:=]\s*['"][A-Za-z0-9]/i);
      expect(t, f).not.toMatch(/postgres(ql)?:\/\/[^'"\s:]+:(?!\$|x@|\{)[^'"\s@]{6,}@/);
    }
  });
  it('la referencia de produccion solo aparece como lista de rechazo en guardas.mjs', () => {
    for (const f of archivos) {
      const t = readFileSync(join(DIR, f), 'utf8');
      for (const p of PROYECTOS_PRODUCCION) expect(t.includes(p), f).toBe(f === 'guardas.mjs');
    }
  });
  it('el generador es puro: sin reloj ni azar del sistema, sin red ni archivos', () => {
    for (const f of ['generador.mjs', 'prng.mjs', 'datos-base.mjs']) {
      const t = readFileSync(join(DIR, f), 'utf8');
      expect(t, f).not.toMatch(/Math\.random|Date\.now|new Date\(\)|process\.env|node:fs|fetch\(|child_process/);
    }
  });
  it('el ejecutor solo escribe con funciones oficiales: ningun insert a tablas de negocio', () => {
    const t = readFileSync(join(DIR, 'ejecutor.mjs'), 'utf8');
    const inserts = [...t.matchAll(/insert into ([a-z_.]+)/gi)].map((m) => m[1]);
    expect(inserts.sort()).toEqual(['auth.users', 'seguridad.correo_permitido']);
  });
});
