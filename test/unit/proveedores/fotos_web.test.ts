import { describe, expect, it } from 'vitest';
import { motivoDeRechazo, reemplazarFoto, slugDe } from '../../../scripts/proveedores/fotos-web.mjs';

describe('fotos web: validacion', () => {
  const ok = { tipo: 'image/png', bytes: 50_000, ancho: 800, alto: 1000 };
  it('acepta una foto de producto normal', () => expect(motivoDeRechazo(ok)).toBeNull());
  it('rechaza lo que no es imagen, iconos, miniaturas y banners', () => {
    expect(motivoDeRechazo({ ...ok, tipo: 'text/html' })).toMatch(/tipo/);
    expect(motivoDeRechazo({ ...ok, bytes: 2000 })).toMatch(/pequeno/);
    expect(motivoDeRechazo({ ...ok, ancho: 200, alto: 250 })).toMatch(/lado menor/);
    expect(motivoDeRechazo({ ...ok, ancho: 1800, alto: 400 })).toMatch(/banner/);
  });
  it('slug estable y solo reemplaza fotos nulas', () => {
    expect(slugDe('Nexa Ultra 50K')).toBe('nexa-ultra-50k');
    const t = "  { id: 5, marca: 'A', nombre: 'A 1', foto: null, confianza: 'sin_evidencia' },";
    expect(reemplazarFoto(t, 5, '/modelos/a-1.webp', 'probable')).toContain("foto: '/modelos/a-1.webp', confianza: 'probable'");
    expect(reemplazarFoto(t, 6, '/modelos/x.webp', 'exacto')).toBeNull();
  });
});
