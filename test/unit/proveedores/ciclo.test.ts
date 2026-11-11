import { describe, it, expect } from 'vitest';
import { decidirLecturaRetenida, ejecutarConfirmacion, ejecutarLecturaHoraria, ejecutarLecturaPromociones, reanudarLectura, verificarRobots } from '@/aplicacion/proveedores/ciclo';
import { presupuestoNuevo, registrarPeticion } from '@/dominio/proveedores/fuente';
import { TOPE_PETICIONES_DIA } from '@/dominio/proveedores/politica';
import { hallarImportes } from '@/dominio/proveedores/privacidad';
import { HORA, MIN, ORIGEN_SECRETO, PRECIO_CENTINELA, COMPARACION_CENTINELA, SOCIOS_TODOS, catalogoJson, copiaConDisponibilidad, entorno, modeloConSabores, respuestaHtml, respuestaJson, volcadoCompleto } from './ayudas';
import type { ModeloSpec } from './ayudas';

const MODELOS: ModeloSpec[] = Array.from({ length: 10 }, (_, i) => ({ ...modeloConSabores(i + 1, `Modelo ${i + 1} 10,000`, 10, 6), handle: `modelo-${i + 1}` }));
const socios = { socios: async () => SOCIOS_TODOS };
/** Todos los sabores con la disponibilidad invertida: 100 % de cambio en una sola lectura. */
const INVERTIDOS: ModeloSpec[] = MODELOS.map((m) => ({ ...m, sabores: m.sabores.map((x) => ({ ...x, disponible: !x.disponible })) }));

describe('carga inicial', () => {
  it('no emite avisos ni eventos, guarda estado y foto diaria, y usa una sola peticion', async () => {
    const w = entorno(MODELOS);
    const r = await ejecutarLecturaHoraria(w.deps);
    expect(r).toMatchObject({ estado: 'inicial', eventos: 0, avisos: 0, peticiones: 1, programarConfirmacionEn: null });
    expect(w.avisos.emitidos).toEqual([]);
    expect(w.repo.eventos.size).toBe(0);
    expect(w.repo.estado.inicializado).toBe(true);
    expect(w.repo.estado.salud.ultimaLecturaOk).not.toBeNull();
    expect(w.repo.fotos.get('2026-11-10')).toHaveLength(100);
    expect(w.lector.peticiones.catalogo).toBe(1);
  });

  it('repetir la misma hora no vuelve a pedir ni a procesar (idempotencia)', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    const otra = await ejecutarLecturaHoraria(w.deps);
    expect(otra).toMatchObject({ estado: 'duplicada' });
    expect(w.lector.peticiones.catalogo).toBe(1);
    expect(w.repo.guardados).toBe(1);
  });
});

describe('cambios: confirmacion a los 10 minutos', () => {
  it('un parpadeo de un sabor no emite aviso: el candidato se cae en la lectura de confirmacion', async () => {
    const w = entorno(MODELOS, { contexto: socios });
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    w.lector.poner(copiaConDisponibilidad(MODELOS, { 1001: false }));
    const r1 = await ejecutarLecturaHoraria(w.deps);
    expect(r1.estado).toBe('ok');
    expect(r1.eventos).toBe(0);
    expect(r1.programarConfirmacionEn).toBe(new Date(w.reloj.ms + 10 * MIN).toISOString());
    w.avanzar(10 * MIN);
    w.lector.poner(MODELOS);
    const r2 = await ejecutarConfirmacion(w.deps);
    expect(r2).toMatchObject({ estado: 'ok', eventos: 0, avisos: 0, programarConfirmacionEn: null });
    expect(w.avisos.emitidos).toEqual([]);
    expect(w.repo.eventos.size).toBe(0);
    expect(w.lector.peticiones.catalogo).toBe(3);
  });

  it('un cambio real se confirma en la lectura de 10 minutos y avisa una sola vez, agrupado', async () => {
    const w = entorno(MODELOS, { contexto: socios });
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    const agotados = copiaConDisponibilidad(MODELOS, { 1001: false, 1002: false });
    w.lector.poner(agotados);
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(10 * MIN);
    const r = await ejecutarConfirmacion(w.deps);
    expect(r).toMatchObject({ estado: 'ok', eventos: 2, avisos: 1 });
    expect(w.avisos.emitidos).toHaveLength(1);
    expect(w.avisos.emitidos[0]).toMatchObject({ codigo: 'P-03', destino: 'inmediato' });
    // la lectura horaria siguiente ya no repite nada
    w.avanzar(50 * MIN);
    const r3 = await ejecutarLecturaHoraria(w.deps);
    expect(r3).toMatchObject({ eventos: 0, avisos: 0 });
    expect(w.avisos.emitidos).toHaveLength(1);
  });

  it('sin candidatos no se gasta una peticion de confirmacion', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(10 * MIN);
    expect(await ejecutarConfirmacion(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'sin_candidatos' });
    expect(w.lector.peticiones.catalogo).toBe(1);
  });

  it('modelo nuevo: se agrega "nuevo, sin costo" y avisa P-01 una sola vez', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    const nuevo = { ...modeloConSabores(11, 'Waka Steel 60,000', 20, 20), handle: 'waka-steel-60000' };
    w.lector.poner([...MODELOS, nuevo]);
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(10 * MIN);
    await ejecutarConfirmacion(w.deps);
    expect(w.avisos.emitidos.map((a) => a.codigo)).toEqual(['P-01']);
    expect(w.repo.estado.modelos['11']).toMatchObject({ nuevoSinCosto: true });
    w.avanzar(HORA);
    await ejecutarLecturaHoraria(w.deps);
    expect(w.avisos.emitidos).toHaveLength(1);
  });
});

describe('catalogo vacio, caida anomala y formato nuevo se rechazan y avisan', () => {
  it('catalogo vacio: rechazada, avisa, no genera eventos y no marca nada como descontinuado', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    const antes = structuredClone(w.repo.estado.modelos);
    for (let h = 1; h <= 30; h++) {
      w.avanzar(HORA);
      w.lector.catalogo = [respuestaJson({ products: [] })];
      const r = await ejecutarLecturaHoraria(w.deps);
      expect(r).toMatchObject({ estado: 'rechazada', motivo: 'catalogo_vacio' });
      if (h === 1) expect(r.avisos).toBe(1);
    }
    expect(w.avisos.emitidos.filter((a) => a.codigo === 'P-17')).toHaveLength(2); // incidente + recordatorio, nunca uno por lectura
    expect(w.repo.eventos.size).toBe(0);
    expect(w.repo.estado.modelos).toEqual(antes);
    expect(Object.values(w.repo.estado.modelos).every((m) => m.estado === 'activo' && m.ausencias === 0)).toBe(true);
    expect(w.repo.estado.salud.incidente?.tipo).toBe('vacia');
  });

  it('caida mayor al umbral: se retiene, se avisa P-18 una vez, no se publica ningun evento', async () => {
    const w = entorno(MODELOS, { contexto: socios });
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    w.lector.poner(MODELOS.slice(0, 5)); // 50 % menos de variantes
    const r1 = await ejecutarLecturaHoraria(w.deps);
    expect(r1).toMatchObject({ estado: 'sospechosa', avisos: 1 });
    w.avanzar(10 * MIN);
    const r2 = await ejecutarLecturaHoraria(w.deps);
    expect(r2.estado).toBe('sospechosa');
    expect(w.avisos.emitidos.map((a) => a.codigo)).toEqual(['P-18']);
    expect(Object.values(w.repo.estado.modelos).every((m) => m.estado === 'activo')).toBe(true);
    // el dato publicado no se refresca con una lectura retenida
    expect(w.repo.estado.salud.ultimaLecturaOk).toBe(new Date(w.reloj.ms - HORA - 10 * MIN).toISOString());
  });

  it('"Es real" publica la lectura retenida una vez y resuelve el aviso; "Ignorar" la descarta', async () => {
    const w = entorno(MODELOS, { contexto: socios });
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    w.lector.poner(INVERTIDOS);
    await ejecutarLecturaHoraria(w.deps);
    const real = await decidirLecturaRetenida(w.deps, 'es_real');
    expect(real).toMatchObject({ estado: 'ok' });
    expect(w.repo.estado.retenida).toBeNull();
    expect(w.avisos.resueltos).toContain('P-18|retenida');
    expect(real.eventos).toBeGreaterThan(0);
    expect(await decidirLecturaRetenida(w.deps, 'es_real')).toMatchObject({ estado: 'omitida', motivo: 'sin_lectura_retenida' });

    const w2 = entorno(MODELOS, { contexto: socios });
    await ejecutarLecturaHoraria(w2.deps);
    w2.avanzar(HORA);
    w2.lector.poner(INVERTIDOS);
    await ejecutarLecturaHoraria(w2.deps);
    const ign = await decidirLecturaRetenida(w2.deps, 'ignorar');
    expect(ign.eventos).toBe(0);
    expect(w2.repo.estado.retenida).toBeNull();
    expect(Object.keys(w2.repo.estado.modelos)).toHaveLength(10);
    expect(w2.repo.estado.variantes['1001']!.disponible).toBe(true);
  });

  it('formato nuevo (clave available renombrada): rechazada, un aviso por incidente y se conserva el ultimo estado bueno', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    const roto = JSON.parse(JSON.stringify(catalogoJson(MODELOS))) as { products: { variants: Record<string, unknown>[] }[] };
    for (const p of roto.products) for (const v of p.variants) {
      v['disponible'] = v['available'];
      delete v['available'];
    }
    const antes = structuredClone(w.repo.estado.variantes);
    for (let h = 1; h <= 3; h++) {
      w.avanzar(HORA);
      w.lector.catalogo = [respuestaJson(roto)];
      const r = await ejecutarLecturaHoraria(w.deps);
      expect(r).toMatchObject({ estado: 'rechazada', motivo: 'formato' });
    }
    expect(w.avisos.emitidos.filter((a) => a.codigo === 'P-17')).toHaveLength(1);
    expect(w.repo.estado.variantes).toEqual(antes);
    expect(w.repo.eventos.size).toBe(0);
  });

  it('HTML donde se esperaba JSON y pagina de edad se tratan como formato nuevo y bloqueo', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    w.lector.catalogo = [respuestaHtml('<html><body>hola</body></html>')];
    expect(await ejecutarLecturaHoraria(w.deps)).toMatchObject({ estado: 'rechazada', motivo: 'respuesta_no_json' });
    const w2 = entorno(MODELOS);
    w2.lector.catalogo = [respuestaHtml('<h1>Verificación de edad</h1>')];
    expect(await ejecutarLecturaHoraria(w2.deps)).toMatchObject({ estado: 'bloqueada', motivo: 'pagina_de_edad' });
  });

  it('identificadores duplicados: rechazada', async () => {
    const w = entorno(MODELOS);
    w.lector.catalogo = [respuestaJson({ products: [{ id: 1, title: 'A', variants: [] }, { id: 1, title: 'B', variants: [] }] })];
    expect(await ejecutarLecturaHoraria(w.deps)).toMatchObject({ estado: 'rechazada', motivo: 'duplicados' });
  });
});

describe('bloqueo de la fuente (403, 429, captcha)', () => {
  it('se detiene, avisa y no vuelve a pedir hasta que un socio reanude', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    w.lector.catalogo = [respuestaJson({}, 403)];
    const r = await ejecutarLecturaHoraria(w.deps);
    expect(r).toMatchObject({ estado: 'bloqueada', motivo: '403', avisos: 1 });
    const pedidas = w.lector.peticiones.catalogo;
    for (let h = 1; h <= 7; h++) {
      w.avanzar(HORA);
      expect(await ejecutarLecturaHoraria(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'fuente_bloqueada' });
    }
    expect(w.lector.peticiones.catalogo).toBe(pedidas);
    expect(w.avisos.emitidos.filter((a) => a.codigo === 'P-17').length).toBe(2); // el incidente y su recordatorio a las 6 horas
    w.lector.poner(MODELOS);
    await reanudarLectura(w.deps);
    w.avanzar(HORA);
    expect(await ejecutarLecturaHoraria(w.deps)).toMatchObject({ estado: 'ok' });
  });

  it('429 y captcha tambien detienen', async () => {
    for (const respuesta of [respuestaJson({}, 429), respuestaHtml('<html>Just a moment, captcha</html>')]) {
      const w = entorno(MODELOS);
      w.lector.catalogo = [respuesta];
      expect((await ejecutarLecturaHoraria(w.deps)).estado).toBe('bloqueada');
      expect(w.repo.estado.salud.bloqueada).toBe(true);
    }
  });
});

describe('fallas de red', () => {
  it('3 fallos seguidos avisan; el mensaje del error de red (que trae la direccion) nunca se guarda ni se muestra', async () => {
    const w = entorno(MODELOS);
    await ejecutarLecturaHoraria(w.deps);
    w.lector.falloRed = true;
    for (let h = 1; h <= 3; h++) {
      w.avanzar(HORA);
      expect(await ejecutarLecturaHoraria(w.deps)).toMatchObject({ estado: 'error' });
    }
    expect(w.avisos.emitidos.map((a) => a.codigo)).toEqual(['P-17']);
    expect(volcadoCompleto(w.repo, w.avisos)).not.toContain('origen-secreto');
    expect(w.repo.estado.salud.fallosSeguidos).toBe(3);
    w.lector.falloRed = false;
    w.avanzar(HORA);
    await ejecutarLecturaHoraria(w.deps);
    expect(w.repo.estado.salud).toMatchObject({ fallosSeguidos: 0, incidente: null });
  });
});

describe('limite de peticiones', () => {
  it('con el presupuesto del catalogo agotado no se pide nada', async () => {
    const w = entorno(MODELOS);
    let p = presupuestoNuevo('2026-11-10');
    for (let i = 0; i < 24; i++) p = registrarPeticion(p, 'catalogo');
    await w.repo.guardarPresupuesto(p);
    expect(await ejecutarLecturaHoraria(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'presupuesto_agotado' });
    expect(w.lector.peticiones.catalogo).toBe(0);
  });

  it('un dia completo con cambios, confirmaciones, promociones y colecciones jamas pasa de 40 peticiones', async () => {
    const w = entorno(MODELOS, { contexto: socios });
    w.reloj.ms = Date.parse('2026-11-10T06:00:00.000Z'); // 00:00 en Merida: un dia de negocio completo
    w.lector.inicio = respuestaHtml('<ul><li class="product-card"><a href="/products/modelo-1">m</a><span>10 % de descuento</span></li></ul><a href="/collections/ofertas">c</a>');
    w.lector.colecciones['ofertas'] = respuestaJson({ products: [{ handle: 'modelo-2' }] });
    // lecturas que cambian cada hora para forzar candidatos y confirmaciones
    let totalMax: number;
    for (let h = 0; h < 24; h++) {
      w.lector.poner(copiaConDisponibilidad(MODELOS, { [1001 + (h % 5)]: h % 2 === 0 }));
      await ejecutarLecturaHoraria(w.deps);
      for (let k = 0; k < 5; k++) {
        w.avanzar(10 * MIN);
        await ejecutarConfirmacion(w.deps);
      }
      if (h % 3 === 0) await ejecutarLecturaPromociones(w.deps);
      w.avanzar(HORA - 50 * MIN);
      totalMax = w.lector.peticiones.catalogo + w.lector.peticiones.inicio + w.lector.peticiones.coleccion + w.lector.peticiones.robots;
      expect(totalMax).toBeLessThanOrEqual(TOPE_PETICIONES_DIA);
    }
    const dia = await w.repo.cargarPresupuesto('2026-11-10');
    expect(dia?.usadas ?? 0).toBeLessThanOrEqual(TOPE_PETICIONES_DIA);
    expect(w.lector.peticiones.catalogo).toBeLessThanOrEqual(30); // 24 horarias + hasta 6 de confirmacion
    expect(w.lector.peticiones.inicio).toBeLessThanOrEqual(8);
    expect(w.lector.peticiones.coleccion).toBeLessThanOrEqual(2);
  });

  it('si la pagina 1 trae 250 productos se pide la pagina 2; productos repetidos entre paginas se rechazan', async () => {
    const muchos = (desde: number, n: number): ModeloSpec[] => Array.from({ length: n }, (_, i) => ({ id: desde + i, titulo: `M ${desde + i}`, sabores: [{ id: (desde + i) * 10, nombre: 'S', disponible: true }] }));
    const w = entorno(MODELOS);
    w.lector.catalogo = [respuestaJson(catalogoJson(muchos(1, 250))), respuestaJson(catalogoJson(muchos(251, 3)))];
    const r = await ejecutarLecturaHoraria(w.deps);
    expect(r).toMatchObject({ estado: 'inicial', peticiones: 2 });
    expect(w.lector.paginasPedidas).toEqual([1, 2]);
    expect(Object.keys(w.repo.estado.modelos)).toHaveLength(253);
    const w2 = entorno(MODELOS);
    w2.lector.catalogo = [respuestaJson(catalogoJson(muchos(1, 250))), respuestaJson(catalogoJson(muchos(250, 3)))];
    expect(await ejecutarLecturaHoraria(w2.deps)).toMatchObject({ estado: 'rechazada', motivo: 'duplicados' });
  });
});

describe('ningun precio ni importe se persiste; la direccion de origen no aparece en nada', () => {
  it('tras un dia de lecturas con precios, precios de comparacion, promociones y fallos, el volcado completo esta limpio', async () => {
    const w = entorno(MODELOS, { contexto: socios });
    w.lector.inicio = respuestaHtml('<ul><li class="product-card"><a href="/products/modelo-1">m</a><span>15 % de descuento</span></li></ul><p>Antes $1,999 ahora $999 MXN</p>');
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(HORA);
    w.lector.poner(copiaConDisponibilidad(MODELOS, { 1001: false, 2001: false }));
    await ejecutarLecturaHoraria(w.deps);
    w.avanzar(10 * MIN);
    await ejecutarConfirmacion(w.deps);
    await ejecutarLecturaPromociones(w.deps);
    w.avanzar(3 * HORA);
    await ejecutarLecturaPromociones(w.deps);
    w.lector.falloRed = true;
    for (let i = 0; i < 4; i++) {
      w.avanzar(HORA);
      await ejecutarLecturaHoraria(w.deps);
    }
    const volcado = volcadoCompleto(w.repo, w.avisos);
    expect(volcado.length).toBeGreaterThan(5000);
    expect(volcado).not.toContain(String(PRECIO_CENTINELA));
    expect(volcado).not.toContain(String(COMPARACION_CENTINELA));
    expect(volcado).not.toMatch(/price|compare_at|body_html|mercadotecnia|\$999|1,999/i);
    expect(volcado).not.toContain('origen-secreto');
    expect(volcado).not.toContain(ORIGEN_SECRETO);
    expect(hallarImportes(w.repo.estado)).toEqual([]);
    expect(hallarImportes([...w.repo.eventos.values()])).toEqual([]);
    expect(hallarImportes(w.avisos.emitidos)).toEqual([]);
    expect(w.repo.estado.promociones['porcentaje|15']).toBeDefined();
  });

  it('si algun dia el estado llevara un importe, guardar lo rechaza antes de escribir', async () => {
    const w = entorno(MODELOS);
    w.repo.guardarEstado = async () => {
      throw new Error('no deberia escribir');
    };
    // forzamos la guarda: el estado "vigente" cargado trae una clave de precio
    const original = w.repo.cargarEstado.bind(w.repo);
    w.repo.cargarEstado = async () => ({ ...(await original()), precio: 1 }) as never;
    await expect(ejecutarLecturaHoraria(w.deps)).rejects.toMatchObject({ codigo: 'importe_en_estado' });
  });
});

describe('lectura de promociones (HTML cada 3 horas)', () => {
  const INICIO = '<ul><li class="grid__item product-card"><a href="/products/modelo-1">m</a><span>15 % de descuento</span></li><li class="grid__item product-card"><a href="/products/modelo-2">m</a><span>15 % de descuento</span></li></ul>';
  const CAMPANA = '<section data-countdown-start="2026-11-20T00:00:00-06:00" data-countdown-end="2026-11-24T23:59:00-06:00"><a href="/collections/buen-fin-3x2">c</a></section>';

  it('desactivadas por interruptor: no se pide nada', async () => {
    const w = entorno(MODELOS, { promociones: false });
    w.lector.inicio = respuestaHtml(INICIO);
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'promociones_desactivadas' });
    expect(w.lector.peticiones.inicio).toBe(0);
  });

  it('sin carga inicial del catalogo no se leen promociones', async () => {
    const w = entorno(MODELOS);
    w.lector.inicio = respuestaHtml(INICIO);
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'sin_carga_inicial' });
  });

  it('promocion nueva: avisa P-09 una sola vez en dos lecturas; la campana lee su coleccion una vez', async () => {
    const w = entorno(MODELOS);
    w.lector.inicio = respuestaHtml(`${CAMPANA}${INICIO}`);
    w.lector.colecciones['buen-fin-3x2'] = respuestaJson({ products: [{ handle: 'modelo-3' }, { handle: 'modelo-4' }] });
    await ejecutarLecturaHoraria(w.deps);
    const r1 = await ejecutarLecturaPromociones(w.deps);
    expect(r1).toMatchObject({ estado: 'ok', eventos: 0, peticiones: 2 });
    w.avanzar(3 * HORA);
    const r2 = await ejecutarLecturaPromociones(w.deps);
    expect(r2.estado).toBe('ok');
    expect(w.avisos.emitidos.map((a) => a.codigo).sort()).toEqual(['P-09', 'P-10']);
    expect(w.lector.peticiones.coleccion).toBe(1);
    expect(w.lector.peticiones.inicio).toBe(2);
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'duplicada' });
    const p = w.repo.estado.promociones['campana|buen-fin-3x2']!;
    expect(p).toMatchObject({ estado: 'anunciada', alcance: ['3', '4'] });
  });

  it('plantilla rota: se descarta; bloqueo en el inicio detiene la fuente; red caida no cambia el estado', async () => {
    const w = entorno(MODELOS);
    w.lector.inicio = respuestaHtml(INICIO);
    await ejecutarLecturaHoraria(w.deps);
    await ejecutarLecturaPromociones(w.deps);
    w.avanzar(3 * HORA);
    w.lector.inicio = respuestaHtml('<html>vacio</html>');
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'rechazada', motivo: 'plantilla_con_menos_tarjetas' });
    w.avanzar(3 * HORA);
    w.lector.inicio = respuestaHtml('error', 500);
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'error', motivo: 'http' });
    w.avanzar(3 * HORA);
    w.lector.falloRed = true;
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'error' });
    w.lector.falloRed = false;
    w.avanzar(3 * HORA);
    w.lector.inicio = respuestaHtml('<html>captcha</html>', 429);
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'bloqueada', motivo: '429' });
    expect(w.repo.estado.salud.bloqueada).toBe(true);
    w.avanzar(3 * HORA);
    expect(await ejecutarLecturaPromociones(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'fuente_bloqueada' });
  });

  it('una coleccion que falla o responde mal no rompe la lectura', async () => {
    const w = entorno(MODELOS);
    w.lector.inicio = respuestaHtml(`${CAMPANA}${INICIO}`);
    await ejecutarLecturaHoraria(w.deps);
    expect((await ejecutarLecturaPromociones(w.deps)).estado).toBe('ok'); // sin coleccion simulada: la lectura lanza y se ignora
    w.avanzar(3 * HORA);
    w.lector.colecciones['buen-fin-3x2'] = respuestaHtml('no es json');
    expect((await ejecutarLecturaPromociones(w.deps)).estado).toBe('ok');
    w.avanzar(3 * HORA);
    w.lector.colecciones['buen-fin-3x2'] = respuestaJson({ cosa: 1 });
    expect((await ejecutarLecturaPromociones(w.deps)).estado).toBe('ok');
  });
});

describe('robots.txt', () => {
  it('si prohiben la ruta de lectura, el flujo se detiene y avisa; si no, no pasa nada', async () => {
    const w = entorno(MODELOS);
    expect(await verificarRobots(w.deps)).toMatchObject({ estado: 'ok', peticiones: 1 });
    expect(w.repo.estado.salud.bloqueada).toBe(false);
    w.lector.robots = { estado: 200, tipoContenido: 'text/plain', cuerpo: 'User-agent: *\nDisallow: /products.json\n' };
    const w2 = entorno(MODELOS);
    w2.lector.robots = w.lector.robots;
    expect(await verificarRobots(w2.deps)).toMatchObject({ estado: 'bloqueada', motivo: 'robots_prohibe', avisos: 1 });
    expect(w2.repo.estado.salud.bloqueada).toBe(true);
    expect(await ejecutarLecturaHoraria(w2.deps)).toMatchObject({ estado: 'omitida' });
  });
  it('robots no disponible o con falla de red no bloquea; el presupuesto de robots es de 1 al dia', async () => {
    const w = entorno(MODELOS);
    w.lector.robots = { estado: 404, tipoContenido: 'text/plain', cuerpo: '' };
    expect(await verificarRobots(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'robots_no_disponible' });
    expect(await verificarRobots(w.deps)).toMatchObject({ estado: 'omitida', motivo: 'presupuesto_agotado' });
    const w2 = entorno(MODELOS);
    w2.lector.leerRobots = async () => {
      throw new Error('red');
    };
    expect(await verificarRobots(w2.deps)).toMatchObject({ estado: 'error' });
  });
});
