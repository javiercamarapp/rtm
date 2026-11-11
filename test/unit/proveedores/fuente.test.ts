import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { agenteUsuario, claveDeLectura, frescura, frescuraDe, presupuestoDelDia, presupuestoNuevo, puedePedir, registrarPeticion, robotsPermite } from '@/dominio/proveedores/fuente';
import type { PresupuestoDia, TipoPeticion } from '@/dominio/proveedores/fuente';
import { TOPE_PETICIONES_DIA, TOPE_POR_TIPO } from '@/dominio/proveedores/politica';
import { contieneDireccion, exigirSinImportes, hallarImportes } from '@/dominio/proveedores/privacidad';
import { ErrorProveedor } from '@/dominio/proveedores/errores';
import { recordatorioPendiente, reanudarFuente, registrarExito, registrarFallo, registrarIntento } from '@/dominio/proveedores/salud';
import { construirAvisos, redactarAviso } from '@/dominio/proveedores/avisos';
import { estadoVacio, horasEntre, minutosEntre, sumarMs } from '@/dominio/proveedores/tipos';
import type { CodigoAviso, SolicitudAviso } from '@/dominio/proveedores/tipos';
import { HORA, en } from './ayudas';

describe('presupuesto de peticiones: tope de 40 al dia', () => {
  it('el desglose suma exactamente el tope autorizado', () => {
    expect(Object.values(TOPE_POR_TIPO).reduce((a, b) => a + b, 0)).toBe(TOPE_PETICIONES_DIA);
    expect(TOPE_PETICIONES_DIA).toBe(40);
  });

  it('cada tipo se agota en su limite y el total nunca pasa de 40', () => {
    let p = presupuestoNuevo('2026-11-10');
    for (let i = 0; i < 24; i++) {
      expect(puedePedir(p, 'catalogo')).toBe(true);
      p = registrarPeticion(p, 'catalogo');
    }
    expect(puedePedir(p, 'catalogo')).toBe(false);
    expect(puedePedir(p, 'confirmacion')).toBe(true);
  });

  it('propiedad: sin importar el orden, jamas se consiguen mas de 40 peticiones permitidas', () => {
    const tipos: TipoPeticion[] = ['catalogo', 'confirmacion', 'inicio', 'coleccion', 'robots'];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...tipos), { maxLength: 200 }), (secuencia) => {
        let p: PresupuestoDia = presupuestoNuevo('d');
        let hechas = 0;
        for (const t of secuencia) {
          if (!puedePedir(p, t)) continue;
          p = registrarPeticion(p, t);
          hechas++;
        }
        expect(hechas).toBeLessThanOrEqual(TOPE_PETICIONES_DIA);
        expect(p.usadas).toBe(hechas);
      }),
    );
  });

  it('un dia nuevo empieza en cero', () => {
    const viejo = registrarPeticion(presupuestoNuevo('2026-11-10'), 'catalogo');
    expect(presupuestoDelDia(viejo, '2026-11-11').usadas).toBe(0);
    expect(presupuestoDelDia(viejo, '2026-11-10')).toBe(viejo);
    expect(presupuestoDelDia(null, '2026-11-10').usadas).toBe(0);
  });
});

describe('agente de usuario honesto', () => {
  it('se identifica como lo que es, sin disfrazarse de navegador', () => {
    const ua = agenteUsuario();
    expect(ua).toMatch(/^RTM-InventarioProveedores\/1\.0/);
    expect(ua).not.toMatch(/Mozilla|Chrome|Safari|Googlebot/i);
    expect(agenteUsuario('contacto@example.test')).toContain('contacto: contacto@example.test');
    expect(agenteUsuario('   ')).toBe(ua);
  });
});

describe('robots.txt', () => {
  const ROBOTS = 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart/\nDisallow: /collections/*sort_by*\n\nUser-agent: Otro\nDisallow: /\n';
  it('permite el JSON de productos y respeta las rutas prohibidas', () => {
    expect(robotsPermite(ROBOTS, '/products.json')).toBe(true);
    expect(robotsPermite(ROBOTS, '/admin/x')).toBe(false);
    expect(robotsPermite(ROBOTS, '/collections/a?sort_by=price')).toBe(false);
  });
  it('detecta que prohiben la ruta de lectura', () => {
    expect(robotsPermite('User-agent: *\nDisallow: /products.json\n', '/products.json')).toBe(false);
    expect(robotsPermite('User-agent: *\nDisallow: /\n', '/products.json')).toBe(false);
  });
  it('la regla mas especifica gana; empate favorece Allow', () => {
    expect(robotsPermite('User-agent: *\nDisallow: /products\nAllow: /products.json\n', '/products.json')).toBe(true);
    expect(robotsPermite('User-agent: *\nDisallow: /a\nAllow: /a\n', '/a')).toBe(true);
  });
  it('ignora grupos de otros agentes, comentarios y lineas vacias; soporta $ y comodin', () => {
    expect(robotsPermite('User-agent: Otro\nDisallow: /\n', '/products.json')).toBe(true);
    expect(robotsPermite('# nada\nUser-agent: *\nDisallow: # vacio\n', '/x')).toBe(true);
    expect(robotsPermite('User-agent: *\nDisallow: /*.json$\n', '/products.json')).toBe(false);
    expect(robotsPermite('User-agent: *\nDisallow: /*.json$\n', '/products.json.bak')).toBe(true);
    expect(robotsPermite('linea sin separador\nUser-agent: *\nCrawl-delay: 10\n', '/x')).toBe(true);
  });
  it('varios User-agent seguidos comparten reglas', () => {
    expect(robotsPermite('User-agent: Otro\nUser-agent: *\nDisallow: /p\n', '/p')).toBe(false);
  });
});

describe('claves de lectura', () => {
  it('fecha y hora de Merida (UTC-6)', () => {
    expect(claveDeLectura('2026-11-10T12:00:00.000Z', 'catalogo')).toBe('inventario|2026-11-10|06');
    expect(claveDeLectura('2026-11-10T12:10:00.000Z', 'confirmacion')).toBe('inventario|2026-11-10|0610c');
    expect(claveDeLectura('2026-11-10T12:00:00.000Z', 'promociones')).toBe('promociones|2026-11-10|06');
    // 02:00 UTC del sabado es viernes en Merida
    expect(claveDeLectura('2026-11-14T02:00:00.000Z', 'catalogo')).toBe('inventario|2026-11-13|20');
  });
});

describe('frescura del dato', () => {
  it('mas de 3 horas sin lectura valida: advertencia y bloqueo de la lista', () => {
    expect(frescuraDe(en(0), en(2 * HORA))).toMatchObject({ desactualizado: false, bloqueaLista: false });
    expect(frescuraDe(en(0), en(3 * HORA))).toMatchObject({ desactualizado: false });
    expect(frescuraDe(en(0), en(3 * HORA + 60_000))).toMatchObject({ desactualizado: true, bloqueaLista: true });
    expect(frescuraDe(null, en(0))).toMatchObject({ desactualizado: true, bloqueaLista: true, horasSinLectura: null });
    const e = estadoVacio();
    e.salud.bloqueada = true;
    expect(frescura(e, en(0)).bloqueada).toBe(true);
  });
});

describe('privacidad: ningun importe se persiste', () => {
  it('detecta claves de precio, importes y textos con dinero', () => {
    expect(hallarImportes({ a: { price: '1' } })).toEqual(['a.price']);
    expect(hallarImportes({ compare_at_price: 1, costo: 2, total_cent: 3, monto_cent: 4 })).toHaveLength(4);
    expect(hallarImportes({ lista: ['bien', 'cuesta $120'] })).toEqual(['lista[1] (texto con importe)']);
    expect(hallarImportes('900 MXN')).toEqual(['(raiz) (texto con importe)']);
    expect(hallarImportes(10n)).toEqual(['(raiz) (bigint)']);
    expect(hallarImportes({ limpio: 'Waka Steel 60,000', pct: 15, fin: '2026-11-17T23:59:00Z' })).toEqual([]);
  });
  it('exigirSinImportes lanza un error tipado', () => {
    expect(() => exigirSinImportes({ price: 1 })).toThrow(ErrorProveedor);
    try {
      exigirSinImportes({ price: 1 });
    } catch (e) {
      expect((e as ErrorProveedor).codigo).toBe('importe_en_estado');
    }
    expect(() => exigirSinImportes({ ok: true })).not.toThrow();
  });
  it('contieneDireccion encuentra URLs y el origen configurado', () => {
    expect(contieneDireccion('visita https://algo.example')).toBe(true);
    expect(contieneDireccion('www.sitio')).toBe(true);
    expect(contieneDireccion('tienda.com')).toBe(true);
    expect(contieneDireccion('DISPONIBLE WAKA (10 nov 06:00)')).toBe(false);
    expect(contieneDireccion('texto con origen-x adentro', 'https://origen-x/ruta')).toBe(true);
    expect(contieneDireccion('texto limpio', 'https://origen-x/ruta')).toBe(false);
    expect(contieneDireccion('texto', '')).toBe(false);
  });
});

describe('salud de la fuente e incidentes P-17', () => {
  it('un fallo de red avisa a la tercera lectura fallida seguida, una sola vez, con recordatorio a las 6 horas', () => {
    let e = registrarExito(estadoVacio(), en(0), 'k0');
    const r1 = registrarFallo(e, en(1 * HORA), 'sin_lectura');
    const r2 = registrarFallo(r1.estado, en(2 * HORA), 'sin_lectura');
    expect([r1.avisos.length, r2.avisos.length]).toEqual([0, 0]);
    const r3 = registrarFallo(r2.estado, en(3 * HORA), 'sin_lectura');
    expect(r3.avisos).toHaveLength(1);
    expect(r3.avisos[0]).toMatchObject({ codigo: 'P-17', severidad: 'alta' });
    const r4 = registrarFallo(r3.estado, en(4 * HORA), 'sin_lectura');
    expect(r4.avisos).toEqual([]);
    const r5 = registrarFallo(r4.estado, en(9 * HORA + 1), 'sin_lectura');
    expect(r5.avisos).toHaveLength(1);
    expect(r5.avisos[0]!.payload['recordatorio']).toBe(true);
    const r6 = registrarFallo(r5.estado, en(20 * HORA), 'sin_lectura');
    expect(r6.avisos).toEqual([]);
    e = registrarExito(r6.estado, en(21 * HORA), 'k21');
    expect(e.salud).toMatchObject({ fallosSeguidos: 0, incidente: null, bloqueada: false });
  });

  it('bloqueo, catalogo vacio y formato nuevo avisan de inmediato; el bloqueo detiene la fuente hasta que un socio la reanude', () => {
    for (const causa of ['bloqueada', 'vacia', 'formato'] as const) {
      const r = registrarFallo(estadoVacio(), en(HORA), causa);
      expect(r.avisos).toHaveLength(1);
      expect(r.estado.salud.incidente!.tipo).toBe(causa);
    }
    const b = registrarFallo(estadoVacio(), en(HORA), 'bloqueada');
    expect(b.estado.salud.bloqueada).toBe(true);
    const r = reanudarFuente(b.estado);
    expect(r.salud).toMatchObject({ bloqueada: false, incidente: null, fallosSeguidos: 0 });
  });

  it('registrarIntento solo actualiza el ultimo intento; las claves recordadas se acotan', () => {
    const e = registrarIntento(registrarExito(estadoVacio(), en(0), 'a'), en(HORA));
    expect(e.salud.ultimoIntento).toBe(en(HORA));
    expect(e.salud.ultimaLecturaOk).toBe(en(0));
    let x = estadoVacio();
    for (let i = 0; i < 300; i++) x = registrarExito(x, en(i * 1000), `k${i}`);
    expect(x.lecturasProcesadas).toHaveLength(200);
    expect(x.lecturasProcesadas.at(-1)).toBe('k299');
  });

  it('recordatorioPendiente no hace nada sin incidente', () => {
    expect(recordatorioPendiente(estadoVacio(), en(HORA))).toEqual([]);
  });

  it('utilidades de tiempo', () => {
    expect(sumarMs(en(0), HORA)).toBe(en(HORA));
    expect(horasEntre(en(0), en(3 * HORA))).toBe(3);
    expect(minutosEntre(en(0), en(HORA))).toBe(60);
    expect(() => sumarMs('no-es-fecha', 1)).toThrow(RangeError);
  });
});

describe('redaccion de avisos', () => {
  const EMOJI = /\p{Extended_Pictographic}/u;
  const base = { severidad: 'media', destino: 'inmediato', entidadTipo: 'modelo', entidadId: '1', claveDedupe: 'x', creada: en(0) } as const;
  const casos: [CodigoAviso, SolicitudAviso['payload']][] = [
    ['P-01', { modelo: 'Waka Steel 60,000', disponibles: 20, sabores: 20 }],
    ['P-01', { modelo: 'Waka Steel 60,000', disponibles: 1, sabores: 1 }],
    ['P-02', { modelo: 'Waka Icon 50,000', sabores: ['Sandía Hielo', 'Mango Chamoy'] }],
    ['P-02', { modelo: 'Waka Icon 50,000', sabores: ['Uva'] }],
    ['P-03', { modelo: 'Nexa Ultra 40,000', sabores: ['Blue Razz', 'Menta', 'Uva'] }],
    ['P-03', { modelo: 'Nexa Ultra 40,000', sabores: ['Uva'] }],
    ['P-04', { modelo: 'Waka Icon Slim' }],
    ['P-05', { modelo: 'Waka Burst 36,000', sabores: ['Fresa Kiwi', 'Mango'] }],
    ['P-05', { modelo: 'Waka Burst 36,000', sabores: ['Mango'] }],
    ['P-07', { modeloAnterior: 'Geek Bar Pulse X', modeloNuevo: 'Geekbar Pulse X 15K' }],
    ['P-08', { modelo: 'Elf Bar TE6000', regreso: false }],
    ['P-08', { modelo: 'Elf Bar TE6000', regreso: true }],
    ['P-09', { etiqueta: '15 % en 3 modelos', pct: 15, modelos: ['Bugatti B6000'] }],
    ['P-09', { etiqueta: 'Campaña 3x2', pct: null, modelos: ['Fifty Bar 20,000', 'Snowwolf 8,000'] }],
    ['P-10', { etiqueta: 'Campaña 3x2', modelos: ['Fifty Bar 20,000'], inicio: '2026-11-13T06:00:00.000Z', fin: '2026-11-18T05:59:00.000Z' }],
    ['P-10', { etiqueta: 'Campaña', modelos: ['Fifty Bar 20,000', 'Bot It 8,000'], inicio: null, fin: null }],
    ['P-11', { etiqueta: 'Campaña 3x2', fin: '2026-11-18T05:59:00.000Z' }],
    ['P-11', { etiqueta: 'Campaña 3x2', fin: null }],
    ['P-12', { etiqueta: '15 % en 3 modelos' }],
    ['P-17', { incidente: 'sin_lectura', horas: 4, ultimaLectura: '2026-11-10T18:00:00.000Z' }],
    ['P-17', { incidente: 'bloqueada', horas: null, ultimaLectura: null }],
    ['P-17', { incidente: 'desconocido', horas: null, ultimaLectura: null }],
    ['P-18', { detalle: '62 % de los sabores cambió de estado' }],
    ['P-19', { cantidad: 5 }],
    ['P-19', { cantidad: 1 }],
    ['P-20', { inestables: ['Waka Icon Mango'] }],
    ['P-20', { inestables: ['A', 'B'] }],
    ['V-1', { modelo: 'Waka Icon 50,000', disponibles: 5, base: 12 }],
  ];

  it.each(casos)('%s: texto sobrio, sin emojis, sin direccion de la fuente ni importes', (codigo, payload) => {
    const t = redactarAviso({ ...base, codigo, payload });
    expect(t.length).toBeGreaterThan(10);
    expect(t).not.toMatch(EMOJI);
    expect(contieneDireccion(t)).toBe(false);
    expect(hallarImportes(t)).toEqual([]);
    expect(t).not.toMatch(/undefined|NaN|\[object/);
  });

  it('el aviso de modelo nuevo lleva la frase exacta del flujo "nuevo, sin costo"', () => {
    expect(redactarAviso({ ...base, codigo: 'P-01', payload: { modelo: 'Waka Steel 60,000', disponibles: 20, sabores: 20 } })).toContain('"nuevo, sin costo"');
  });

  it('construirAvisos agrupa los nombres por confirmar en un solo P-19', () => {
    const cola = [
      { tipo: 'sabor' as const, textoOriginal: 'a', textoNorm: 'a', sugerenciaId: null, similitud: null, creada: en(0) },
      { tipo: 'sabor' as const, textoOriginal: 'b', textoNorm: 'b', sugerenciaId: null, similitud: null, creada: en(0) },
    ];
    const { avisos } = construirAvisos([], cola, en(0));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ codigo: 'P-19', destino: 'resumen', payload: { cantidad: 2 } });
  });
});
