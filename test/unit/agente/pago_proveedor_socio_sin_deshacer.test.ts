// El pago a proveedor de un socio con dinero propio no se deshace por Telegram: el eco no ofrece el boton y lo dice (cierre de BAJO, 19-nov).
import { describe, it, expect } from 'vitest';
import { seDeshaceEnTelegram, AVISO_SIN_DESHACER } from '@/dominio/agente/deshacer';
import { escenario, unaAccion } from './ayudas';

const pp = (pagado_por: 'angelo' | 'sociedad', cliente: string | null) => ({ tipo: 'pago_proveedor' as const, proveedor_texto: 'Karen', monto_centavos: 3_050_000, pagado_por, cliente_texto: cliente, intencion: null, fuente_cita: 'cita' });

describe('seDeshaceEnTelegram', () => {
  it('solo el pago de un socio con dinero propio queda fuera', () => {
    expect(seDeshaceEnTelegram(pp('angelo', null))).toBe(false);
    expect(seDeshaceEnTelegram(pp('sociedad', null))).toBe(true);
    expect(seDeshaceEnTelegram(pp('sociedad', 'Cliente Norte'))).toBe(true);
    expect(seDeshaceEnTelegram({ tipo: 'gasto' })).toBe(true);
  });
});

describe('eco del pago a proveedor', () => {
  it('con dinero propio: sin boton Deshacer y con el aviso', async () => {
    const e = escenario([unaAccion(pp('angelo', null))]);
    await e.socio('angelo', 'pague a Karen 30,500 de mi bolsa');
    const eco = e.grupo().find((m) => m.texto.startsWith('Registrado'))!;
    expect(eco.texto).toContain('Registrado');
    expect(eco.texto).toContain(AVISO_SIN_DESHACER);
    expect(eco.texto).not.toContain('Deshacer disponible');
    expect(eco.botones ?? []).toEqual([]);
  });
  it('de la sociedad: conserva el boton Deshacer', async () => {
    const e = escenario([unaAccion(pp('sociedad', null))]);
    await e.socio('angelo', 'pague a Karen 30,500 de la caja de la sociedad');
    const eco = e.ultimoGrupo();
    expect(eco.texto).toContain('Deshacer disponible');
    expect(eco.botones?.[0]?.[0]?.texto).toBe('Deshacer');
  });
});
