import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsearCatalogo } from '@/dominio/proveedores/catalogo_json';
import { construirAvisos } from '@/dominio/proveedores/avisos';
import { procesarLectura, resolverRetencion } from '@/dominio/proveedores/detector';
import type { ContextoDeteccion, ResultadoProceso } from '@/dominio/proveedores/detector';
import type { ContextoNormalizacion } from '@/dominio/proveedores/normalizador';
import { estadoVacio } from '@/dominio/proveedores/tipos';
import type { EstadoProveedor, EventoCambio, TipoEvento } from '@/dominio/proveedores/tipos';
import { HORA, MIN, SOCIOS_TODOS, catalogoJson, copiaConDisponibilidad, ctxDeteccion, en, modeloConSabores } from './ayudas';
import type { ModeloSpec } from './ayudas';

function leer(modelos: ModeloSpec[]) {
  const r = parsearCatalogo(catalogoJson(modelos));
  if (!r.ok) throw new Error(`fixture invalido: ${r.detalle}`);
  return r.lectura;
}

/** Corre una lectura; `ms` es el instante relativo a las 06:00 de Merida del 10-nov. */
function paso(estado: EstadoProveedor, modelos: ModeloSpec[], ms: number, ctx: ContextoDeteccion = ctxDeteccion()): ResultadoProceso {
  return procesarLectura(estado, { clave: `lectura-${ms}`, en: en(ms), lectura: leer(modelos) }, ctx);
}

function tipos(eventos: EventoCambio[]): TipoEvento[] {
  return eventos.map((e) => e.tipo);
}

const BASE: ModeloSpec[] = [modeloConSabores(1, 'Waka Steel 60,000', 5, 5), modeloConSabores(2, 'Nexa Ultra 40,000', 4, 3)];
/** Un bloque estable grande: evita que quitar o cambiar un modelo parezca una caida anomala del catalogo. */
const RELLENO = modeloConSabores(90, 'Relleno Estable 10,000', 40, 20);
const BASE_R: ModeloSpec[] = [...BASE, RELLENO];

/** Base ya cargada y estable. */
function conBase(modelos: ModeloSpec[] = BASE, ctx?: ContextoDeteccion): EstadoProveedor {
  return paso(estadoVacio(), modelos, 0, ctx).estado;
}

describe('carga inicial silenciosa', () => {
  it('la primera lectura no emite eventos ni avisos, aunque traiga muchos modelos y sabores agotados', () => {
    const r = paso(estadoVacio(), BASE, 0, ctxDeteccion(undefined, SOCIOS_TODOS));
    expect(r.resultado).toBe('inicial');
    expect(r.eventos).toEqual([]);
    expect(construirAvisos(r.eventos, r.colaNueva, en(0))).toEqual({ avisos: [], resueltos: [] });
    expect(r.estado.inicializado).toBe(true);
    expect(Object.keys(r.estado.modelos)).toHaveLength(2);
    expect(Object.keys(r.estado.variantes)).toHaveLength(9);
    expect(r.hayCandidatos).toBe(false);
  });

  it('los modelos de la base no quedan marcados "nuevo, sin costo"', () => {
    const r = paso(estadoVacio(), BASE, 0);
    expect(Object.values(r.estado.modelos).every((m) => !m.nuevoSinCosto)).toBe(true);
  });

  it('propiedad: la primera lectura nunca emite nada, sea cual sea el catalogo', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.boolean(), { minLength: 0, maxLength: 6 }), { minLength: 1, maxLength: 6 }), (disp) => {
        const modelos: ModeloSpec[] = disp.map((ds, i) => ({ id: i + 1, titulo: `Modelo ${i}`, sabores: ds.map((d, j) => ({ id: (i + 1) * 100 + j, nombre: `S${j}`, disponible: d })) }));
        const r = paso(estadoVacio(), modelos, 0);
        expect(r.eventos).toEqual([]);
        expect(r.resultado).toBe('inicial');
      }),
    );
  });
});

describe('confirmacion: nada se notifica hasta verse dos veces', () => {
  it('un parpadeo de un sabor (agotado una lectura, disponible en la siguiente) no emite nada', () => {
    const base = conBase();
    const agotado = copiaConDisponibilidad(BASE, { 1001: false });
    const r1 = paso(base, agotado, HORA);
    expect(r1.eventos).toEqual([]);
    expect(r1.hayCandidatos).toBe(true);
    const r2 = paso(r1.estado, BASE, HORA + 10 * MIN);
    expect(r2.eventos).toEqual([]);
    expect(r2.hayCandidatos).toBe(false);
    expect(Object.keys(r2.estado.candidatos)).toHaveLength(0);
    expect(r2.estado.variantes['1001']!.disponible).toBe(true);
    expect(r2.estado.variantes['1001']!.cambios).toEqual([]);
  });

  it('el mismo cambio visto en la lectura de confirmacion (10 minutos) se confirma una sola vez', () => {
    const base = conBase();
    const agotado = copiaConDisponibilidad(BASE, { 1001: false });
    const r1 = paso(base, agotado, HORA);
    const r2 = paso(r1.estado, agotado, HORA + 10 * MIN);
    expect(tipos(r2.eventos)).toEqual(['sabor_agotado']);
    expect(r2.eventos[0]).toMatchObject({ productoId: '1', varianteId: '1001', antes: 'true', despues: 'false' });
    expect(r2.estado.variantes['1001']!.disponible).toBe(false);
    const r3 = paso(r2.estado, agotado, 2 * HORA);
    expect(r3.eventos).toEqual([]);
  });

  it('procesar de nuevo la MISMA lectura (misma clave) no cuenta como segunda vista', () => {
    const base = conBase();
    const agotado = copiaConDisponibilidad(BASE, { 1001: false });
    const entrada = { clave: 'misma', en: en(HORA), lectura: leer(agotado) };
    const r1 = procesarLectura(base, entrada, ctxDeteccion());
    const r2 = procesarLectura(r1.estado, entrada, ctxDeteccion());
    expect(r2.eventos).toEqual([]);
    expect(r2.estado.candidatos['agotado|1001|false']!.lecturasVistas).toBe(1);
  });

  it('regreso de un sabor agotado', () => {
    const agotado = copiaConDisponibilidad(BASE, { 2004: true });
    // 2004 era el cuarto sabor del modelo 2 (3 de 4 disponibles): regresa
    const base = conBase();
    const r1 = paso(base, agotado, HORA);
    const r2 = paso(r1.estado, agotado, HORA + 10 * MIN);
    expect(tipos(r2.eventos)).toEqual(['sabor_regreso']);
    expect(r2.estado.variantes['2004']!.disponible).toBe(true);
  });

  it('la lectura de confirmacion decide con lo que ve: si cambia a otra cosa, el primer candidato se cae', () => {
    const base = conBase();
    const r1 = paso(base, copiaConDisponibilidad(BASE, { 1001: false }), HORA);
    const r2 = paso(r1.estado, copiaConDisponibilidad(BASE, { 1002: false }), HORA + 10 * MIN);
    expect(r2.eventos).toEqual([]);
    expect(Object.keys(r2.estado.candidatos)).toEqual(['agotado|1002|false']);
  });
});

describe('modelo nuevo y sabor nuevo', () => {
  const NUEVO = modeloConSabores(3, 'Waka Jupiter 50,000', 3, 3);

  it('modelo nuevo visto en dos lecturas: un evento, se agrega "nuevo, sin costo" y repetir no duplica', () => {
    const base = conBase();
    const conNuevo = [...BASE, NUEVO];
    const r1 = paso(base, conNuevo, HORA);
    expect(r1.eventos).toEqual([]);
    expect(r1.hayCandidatos).toBe(true);
    const r2 = paso(r1.estado, conNuevo, HORA + 10 * MIN);
    expect(tipos(r2.eventos)).toEqual(['modelo_nuevo']);
    expect(r2.eventos[0]!.datos).toMatchObject({ modelo: 'Waka Jupiter 50,000', marca: 'Waka', sabores: 3, disponibles: 3 });
    const m = r2.estado.modelos['3']!;
    expect(m).toMatchObject({ nuevoSinCosto: true, mapeo: 'pendiente', canonicoId: null, puffs: 50000, estado: 'activo' });
    expect(Object.keys(r2.estado.variantes).filter((k) => r2.estado.variantes[k]!.productoId === '3')).toHaveLength(3);
    const r3 = paso(r2.estado, conNuevo, 2 * HORA);
    expect(r3.eventos).toEqual([]);
    // los sabores del modelo nuevo no generan ademas 'sabor_nuevo'
    expect(tipos(r2.eventos)).not.toContain('sabor_nuevo');
  });

  it('un modelo que aparece solo una lectura (error del sitio) no avisa', () => {
    const base = conBase();
    const r1 = paso(base, [...BASE, NUEVO], HORA);
    const r2 = paso(r1.estado, BASE, HORA + 10 * MIN);
    expect(r2.eventos).toEqual([]);
    expect(r2.estado.modelos['3']).toBeUndefined();
  });

  it('un producto sin variantes no puede confirmarse como modelo nuevo', () => {
    const base = conBase();
    const vacio: ModeloSpec = { id: 9, titulo: 'Sin sabores', sabores: [] };
    const r1 = paso(base, [...BASE, vacio], HORA);
    const r2 = paso(r1.estado, [...BASE, vacio], HORA + 10 * MIN);
    expect(r2.eventos).toEqual([]);
  });

  it('un modelo nuevo que ya existe en el catalogo propio no queda "sin costo"', () => {
    const norm: ContextoNormalizacion = { modelos: [{ id: 'canon-jup', nombre: 'Waka Jupiter 50K' }], aliasModelos: [], sabores: [], aliasSabores: [], descartados: [] };
    const ctx = ctxDeteccion(norm);
    const base = conBase(BASE, ctx);
    const r1 = paso(base, [...BASE, NUEVO], HORA, ctx);
    const r2 = paso(r1.estado, [...BASE, NUEVO], HORA + 10 * MIN, ctx);
    expect(r2.estado.modelos['3']).toMatchObject({ nuevoSinCosto: false, mapeo: 'auto', canonicoId: 'canon-jup' });
  });

  it('sabor nuevo en un modelo conocido: dos lecturas y un evento', () => {
    const base = conBase();
    const conSabor: ModeloSpec[] = [{ ...BASE[0]!, sabores: [...BASE[0]!.sabores, { id: 1099, nombre: 'Sandía Hielo', disponible: true }] }, BASE[1]!];
    const r1 = paso(base, conSabor, HORA);
    expect(r1.eventos).toEqual([]);
    const r2 = paso(r1.estado, conSabor, HORA + 10 * MIN);
    expect(tipos(r2.eventos)).toEqual(['sabor_nuevo']);
    expect(r2.estado.variantes['1099']).toMatchObject({ saborOriginal: 'Sandía Hielo', mapeo: 'pendiente', disponible: true });
  });
});

describe('agrupacion de avisos por lectura y por modelo', () => {
  it('tres sabores agotados del mismo modelo: UN aviso agrupado', () => {
    const ctx = ctxDeteccion(undefined, SOCIOS_TODOS);
    const base = conBase(BASE, ctx);
    const agotados = copiaConDisponibilidad(BASE, { 1001: false, 1002: false, 1003: false });
    const r1 = paso(base, agotados, HORA, ctx);
    const r2 = paso(r1.estado, agotados, HORA + 10 * MIN, ctx);
    expect(tipos(r2.eventos)).toEqual(['sabor_agotado', 'sabor_agotado', 'sabor_agotado']);
    const { avisos } = construirAvisos(r2.eventos, r2.colaNueva, en(HORA + 10 * MIN));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ codigo: 'P-03', destino: 'inmediato' });
    expect(avisos[0]!.payload['sabores']).toHaveLength(3);
  });

  it('un sabor agotado que los socios no venden va al resumen, no a Telegram', () => {
    const base = conBase();
    const a = copiaConDisponibilidad(BASE, { 1001: false });
    const r2 = paso(paso(base, a, HORA).estado, a, HORA + 10 * MIN);
    const { avisos } = construirAvisos(r2.eventos, [], en(HORA + 10 * MIN));
    expect(avisos[0]).toMatchObject({ codigo: 'P-03', destino: 'resumen', severidad: 'baja' });
  });

  it('modelo agotado completo: un aviso P-04 y se suprimen los P-03 de sus sabores', () => {
    const ctx = ctxDeteccion(undefined, SOCIOS_TODOS);
    const base = conBase(BASE_R, ctx);
    const todos = copiaConDisponibilidad(BASE_R, { 1001: false, 1002: false, 1003: false, 1004: false, 1005: false });
    const r1 = paso(base, todos, HORA, ctx);
    const r2 = paso(r1.estado, todos, HORA + 10 * MIN, ctx);
    expect(tipos(r2.eventos)).toContain('modelo_agotado');
    expect(r2.estado.modelos['1']!.sinSabores).toBe(true);
    const { avisos } = construirAvisos(r2.eventos, [], en(HORA + 10 * MIN));
    expect(avisos.map((a) => a.codigo)).toEqual(['P-04']);
    expect(avisos[0]).toMatchObject({ destino: 'inmediato' });
    // y cuando regresa un sabor el modelo vuelve a tener sabores
    const vuelve = copiaConDisponibilidad(todos, { 1002: true });
    const r3 = paso(paso(r2.estado, vuelve, 2 * HORA, ctx).estado, vuelve, 2 * HORA + 10 * MIN, ctx);
    expect(r3.estado.modelos['1']!.sinSabores).toBe(false);
    expect(tipos(r3.eventos)).toEqual(['sabor_regreso']);
  });

  it('regresos agrupados por modelo', () => {
    const ctx = ctxDeteccion(undefined, SOCIOS_TODOS);
    const agotado = copiaConDisponibilidad(BASE, { 1001: false, 1002: false });
    let e = conBase(agotado, ctx);
    const r1 = paso(e, BASE, HORA, ctx);
    e = paso(r1.estado, BASE, HORA + 10 * MIN, ctx).estado;
    const reg = paso(paso(conBase(agotado, ctx), BASE, HORA, ctx).estado, BASE, HORA + 10 * MIN, ctx);
    const { avisos } = construirAvisos(reg.eventos, [], en(HORA));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ codigo: 'P-05', destino: 'inmediato' });
    expect(e.variantes['1001']!.disponible).toBe(true);
  });
});

describe('descontinuado: 3 lecturas validas y 24 horas', () => {
  const sinSteel = [BASE[1]!, RELLENO];

  it('ausente 2 lecturas y vuelve: cero eventos', () => {
    let e = conBase(BASE_R);
    e = paso(e, sinSteel, HORA).estado;
    expect(e.modelos['1']).toMatchObject({ estado: 'no_visto', ausencias: 1 });
    e = paso(e, sinSteel, 2 * HORA).estado;
    const r = paso(e, BASE_R, 3 * HORA);
    expect(r.eventos).toEqual([]);
    expect(r.estado.modelos['1']).toMatchObject({ estado: 'activo', ausencias: 0, primeraAusencia: null });
  });

  it('3 lecturas pero menos de 24 horas: "no visto" y sin aviso', () => {
    let e = conBase(BASE_R);
    let todos: EventoCambio[] = [];
    for (const h of [1, 2, 3, 4]) {
      const r = paso(e, sinSteel, h * HORA);
      e = r.estado;
      todos = todos.concat(r.eventos);
    }
    expect(todos).toEqual([]);
    expect(e.modelos['1']).toMatchObject({ estado: 'no_visto', ausencias: 4 });
  });

  it('3 lecturas y 24 horas: un solo evento y un solo aviso; despues no se repite', () => {
    let e = conBase(BASE_R);
    const r1 = paso(e, sinSteel, HORA);
    e = paso(r1.estado, sinSteel, 2 * HORA).estado;
    e = paso(e, sinSteel, 12 * HORA).estado;
    const r = paso(e, sinSteel, 25 * HORA);
    expect(tipos(r.eventos)).toEqual(['modelo_descontinuado']);
    expect(r.estado.modelos['1']!.estado).toBe('descontinuado');
    expect(Object.values(r.estado.variantes).filter((v) => v.productoId === '1').every((v) => v.estado === 'descontinuada')).toBe(true);
    const { avisos } = construirAvisos(r.eventos, [], en(25 * HORA));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ codigo: 'P-08', destino: 'inmediato' });
    expect(paso(r.estado, sinSteel, 26 * HORA).eventos).toEqual([]);
  });

  it('si reaparece, regresa a activo y se registra que regreso al catalogo (el aviso P-08 se edita)', () => {
    let e = conBase(BASE_R);
    e = paso(e, sinSteel, HORA).estado;
    e = paso(e, sinSteel, 2 * HORA).estado;
    e = paso(e, sinSteel, 12 * HORA).estado;
    e = paso(e, sinSteel, 25 * HORA).estado;
    const r = paso(e, BASE_R, 26 * HORA);
    expect(tipos(r.eventos)).toEqual(['modelo_regreso_catalogo']);
    expect(r.estado.modelos['1']!.estado).toBe('activo');
    const { avisos } = construirAvisos(r.eventos, [], en(26 * HORA));
    expect(avisos[0]).toMatchObject({ codigo: 'P-08', claveDedupe: 'P-08|1', destino: 'resumen' });
  });

  it('un sabor que desaparece de un modelo que sigue publicado se descontinua con las mismas reglas', () => {
    const sinUno: ModeloSpec[] = [{ ...BASE[0]!, sabores: BASE[0]!.sabores.slice(1) }, BASE[1]!, RELLENO];
    let e = conBase(BASE_R);
    e = paso(e, sinUno, HORA).estado;
    e = paso(e, sinUno, 2 * HORA).estado;
    e = paso(e, sinUno, 12 * HORA).estado;
    expect(e.variantes['1001']!.estado).toBe('no_vista');
    const r = paso(e, sinUno, 25 * HORA);
    expect(tipos(r.eventos)).toEqual(['sabor_descontinuado']);
    expect(r.estado.variantes['1001']!.estado).toBe('descontinuada');
    expect(construirAvisos(r.eventos, [], en(25 * HORA)).avisos).toEqual([]);
  });
});

describe('renombrado', () => {
  it('solo cambia mayusculas o espacios: sin evento', () => {
    const base = conBase();
    const r = paso(base, [{ ...BASE[0]!, titulo: 'WAKA  STEEL 60,000' }, BASE[1]!], HORA);
    expect(r.eventos).toEqual([]);
    expect(r.hayCandidatos).toBe(false);
    expect(r.estado.modelos['1']!.titulo).toBe('WAKA  STEEL 60,000');
  });

  it('cambio real de nombre en dos lecturas: evento y el titulo anterior queda como alias', () => {
    const base = conBase();
    const nuevo = [{ ...BASE[0]!, titulo: 'Waka Steel Pro 60,000' }, BASE[1]!];
    const r2 = paso(paso(base, nuevo, HORA).estado, nuevo, HORA + 10 * MIN);
    expect(tipos(r2.eventos)).toEqual(['renombrado']);
    expect(r2.estado.modelos['1']).toMatchObject({ titulo: 'Waka Steel Pro 60,000', aliasTitulos: ['Waka Steel 60,000'] });
    // sin vinculo previo que romper: ningun aviso
    expect(construirAvisos(r2.eventos, r2.colaNueva, en(HORA)).avisos).toEqual([]);
  });

  it('si rompe el vinculo con un modelo del catalogo: se conserva el vinculo por confirmar y avisa P-07 (solo resumen)', () => {
    const norm: ContextoNormalizacion = { modelos: [{ id: 'canon-pulse', nombre: 'Geek Bar Pulse X' }], aliasModelos: [], sabores: [], aliasSabores: [], descartados: [] };
    const ctx = ctxDeteccion(norm);
    const antes: ModeloSpec[] = [modeloConSabores(7, 'Geekbar Pulse X', 3, 3)];
    const base = conBase(antes, ctx);
    expect(base.modelos['7']).toMatchObject({ canonicoId: 'canon-pulse', mapeo: 'auto' });
    const despues = [{ ...antes[0]!, titulo: 'Geekbar Pulse X 15K' }];
    const r2 = paso(paso(base, despues, HORA, ctx).estado, despues, HORA + 10 * MIN, ctx);
    expect(r2.estado.modelos['7']).toMatchObject({ canonicoId: 'canon-pulse', mapeo: 'pendiente' });
    const { avisos } = construirAvisos(r2.eventos, r2.colaNueva, en(HORA));
    expect(avisos.map((a) => a.codigo)).toContain('P-07');
    expect(avisos.find((a) => a.codigo === 'P-07')).toMatchObject({ destino: 'resumen', severidad: 'baja' });
  });

  it('renombrar un sabor actualiza su texto y su mapeo sin avisar', () => {
    const base = conBase();
    const nuevo: ModeloSpec[] = [{ ...BASE[0]!, sabores: BASE[0]!.sabores.map((s) => (s.id === 1001 ? { ...s, nombre: 'Mango Tropical' } : s)) }, BASE[1]!];
    const r2 = paso(paso(base, nuevo, HORA).estado, nuevo, HORA + 10 * MIN);
    expect(tipos(r2.eventos)).toEqual(['renombrado']);
    expect(r2.estado.variantes['1001']).toMatchObject({ saborOriginal: 'Mango Tropical', saborNorm: 'mango tropical' });
    expect(construirAvisos(r2.eventos, [], en(HORA)).avisos).toEqual([]);
  });
});

describe('sabores inestables (parpadeo sostenido)', () => {
  it('3 cambios confirmados en 24 horas marcan inestable 48 horas y silencian los avisos individuales', () => {
    const ctx = ctxDeteccion(undefined, SOCIOS_TODOS);
    const fuera = copiaConDisponibilidad(BASE, { 1001: false });
    let e = conBase(BASE, ctx);
    const eventos: EventoCambio[] = [];
    const ciclo = [fuera, BASE, fuera];
    ciclo.forEach((m, i) => {
      const t = (i + 1) * 2 * HORA;
      let r = paso(e, m, t, ctx);
      r = paso(r.estado, m, t + 10 * MIN, ctx);
      eventos.push(...r.eventos);
      e = r.estado;
    });
    expect(tipos(eventos)).toEqual(['sabor_agotado', 'sabor_regreso', 'inestable', 'sabor_agotado']);
    expect(e.variantes['1001']!.inestableHasta).not.toBeNull();
    const ultimo = eventos.filter((x) => x.tipo === 'sabor_agotado')[1]!;
    expect(ultimo.datos['inestable']).toBe(true);
    const { avisos } = construirAvisos([ultimo, eventos.find((x) => x.tipo === 'inestable')!], [], en(6 * HORA));
    expect(avisos.map((a) => a.codigo)).toEqual(['P-20']);
    expect(avisos[0]!.destino).toBe('resumen');
  });

  it('los cambios espaciados mas de 24 horas no cuentan como inestables', () => {
    const fuera = copiaConDisponibilidad(BASE, { 1001: false });
    let e = conBase();
    const eventos: EventoCambio[] = [];
    [fuera, BASE, fuera, BASE].forEach((m, i) => {
      const t = (i + 1) * 30 * HORA;
      let r = paso(e, m, t);
      r = paso(r.estado, m, t + 10 * MIN);
      eventos.push(...r.eventos);
      e = r.estado;
    });
    expect(tipos(eventos)).not.toContain('inestable');
    expect(e.variantes['1001']!.inestableHasta).toBeNull();
  });
});

describe('caida anomala: la lectura se retiene', () => {
  const grande = Array.from({ length: 10 }, (_, i) => modeloConSabores(i + 1, `Modelo ${i + 1}`, 10, 4));

  it('si el total de variantes cae mas de 30 %, no hay eventos y se avisa (P-18)', () => {
    const base = conBase(grande);
    const caida = grande.slice(0, 6); // 40 % menos
    const r = paso(base, caida, HORA);
    expect(r.resultado).toBe('sospechosa');
    expect(tipos(r.eventos)).toEqual(['lectura_retenida']);
    expect(r.estado.retenida).toMatchObject({ veces: 1 });
    expect(Object.keys(r.estado.modelos)).toHaveLength(10);
    expect(Object.values(r.estado.modelos).every((m) => m.estado === 'activo')).toBe(true);
    const { avisos } = construirAvisos(r.eventos, [], en(HORA));
    expect(avisos).toEqual([expect.objectContaining({ codigo: 'P-18', severidad: 'alta', destino: 'inmediato' })]);
  });

  it('una caida de exactamente 30 % NO es anomala (el umbral es "mayor que")', () => {
    const base = conBase(grande);
    const r = paso(base, grande.slice(0, 7), HORA);
    expect(r.resultado).toBe('ok');
  });

  it('si mas de 50 % de los sabores cambia de disponibilidad en una lectura, se retiene', () => {
    const base = conBase(grande);
    const invertidos = grande.map((m) => ({ ...m, sabores: m.sabores.map((s, i) => ({ ...s, disponible: i >= 4 })) })); // 4 de 10 estaban disponibles: ahora 6 de 10, 100 % distinto
    const r = paso(base, invertidos, HORA);
    expect(r.resultado).toBe('sospechosa');
    expect(r.estado.retenida!.razon).toMatch(/cambio de estado/);
  });

  it('la segunda lectura sospechosa no repite el aviso; una lectura normal descarta la retencion', () => {
    const base = conBase(grande);
    const r1 = paso(base, grande.slice(0, 5), HORA);
    const r2 = paso(r1.estado, grande.slice(0, 5), HORA + 10 * MIN);
    expect(r2.eventos).toEqual([]);
    expect(r2.estado.retenida!.veces).toBe(2);
    const r3 = paso(r2.estado, grande, 2 * HORA);
    expect(r3.resultado).toBe('ok');
    expect(r3.estado.retenida).toBeNull();
    expect(r3.eventos).toEqual([]);
  });

  it('"Es real" publica una vez y "Ignorar" descarta', () => {
    const base = conBase(grande);
    const mitad = grande.map((m) => ({ ...m, sabores: m.sabores.map((s, i) => ({ ...s, disponible: i >= 4 })) }));
    const ret = paso(base, mitad, HORA).estado;
    const real = resolverRetencion(ret, 'es_real', en(HORA + MIN), ctxDeteccion());
    expect(real.estado.retenida).toBeNull();
    expect(tipos(real.eventos).filter((t) => t === 'sabor_agotado').length).toBe(40);
    const otra = resolverRetencion(real.estado, 'es_real', en(HORA + 2 * MIN), ctxDeteccion());
    expect(otra.eventos).toEqual([]);
    const ignorada = resolverRetencion(ret, 'ignorar', en(HORA + MIN), ctxDeteccion());
    expect(ignorada.eventos).toEqual([]);
    expect(ignorada.estado.retenida).toBeNull();
    expect(ignorada.estado.variantes['1001']!.disponible).toBe(true);
  });
});

describe('poca variedad (V-1) derivada', () => {
  const socios = ctxDeteccion(undefined, SOCIOS_TODOS);
  const doce = [modeloConSabores(1, 'Waka Icon 50,000', 12, 12), RELLENO];

  it('de 12 a 5 sabores sostenido en 2 lecturas: un aviso; no hay "quedan N piezas"', () => {
    let e = conBase(doce, socios);
    const cinco = [modeloConSabores(1, 'Waka Icon 50,000', 12, 5), RELLENO];
    e = paso(e, cinco, HORA, socios).estado;
    const r2 = paso(e, cinco, HORA + 10 * MIN, socios);
    const r3 = paso(r2.estado, cinco, 2 * HORA, socios);
    const todos = [...r2.eventos, ...r3.eventos].filter((x) => x.tipo === 'poca_variedad');
    expect(todos).toHaveLength(1);
    const { avisos } = construirAvisos(todos, [], en(2 * HORA));
    expect(avisos[0]).toMatchObject({ codigo: 'V-1', destino: 'inmediato' });
    expect(JSON.stringify(avisos)).not.toMatch(/piezas/);
  });

  it('un solo cruce momentaneo no avisa, y no aplica a modelos que los socios no venden', () => {
    let e = conBase(doce, socios);
    const cinco = [modeloConSabores(1, 'Waka Icon 50,000', 12, 5), RELLENO];
    e = paso(e, cinco, HORA, socios).estado;
    const r = paso(e, doce, HORA + 10 * MIN, socios);
    expect(r.eventos.filter((x) => x.tipo === 'poca_variedad')).toEqual([]);
    const sinSocios = conBase(doce);
    const a = paso(paso(sinSocios, cinco, HORA).estado, cinco, HORA + 10 * MIN);
    expect(a.eventos.filter((x) => x.tipo === 'poca_variedad')).toEqual([]);
  });

  it('sube a 8 sostenido: se resuelve solo; se rearma 24 horas despues', () => {
    const cinco = [modeloConSabores(1, 'Waka Icon 50,000', 12, 5), RELLENO];
    const ocho = [modeloConSabores(1, 'Waka Icon 50,000', 12, 8), RELLENO];
    let e = conBase(doce, socios);
    let t = HORA;
    for (const m of [cinco, cinco, cinco]) e = paso(e, m, (t += 10 * MIN), socios).estado;
    expect(e.variedad['1']!.activa).toBe(true);
    const evs: EventoCambio[] = [];
    for (const m of [ocho, ocho, ocho]) {
      const r = paso(e, m, (t += 10 * MIN), socios);
      evs.push(...r.eventos);
      e = r.estado;
    }
    expect(tipos(evs.filter((x) => x.tipo === 'variedad_recuperada'))).toEqual(['variedad_recuperada']);
    expect(construirAvisos(evs, [], en(t)).resueltos).toEqual(['V-1|1']);
    expect(e.variedad['1']!.activa).toBe(false);
    // baja otra vez dentro de las 24 horas: no se rearma
    const antes: EventoCambio[] = [];
    for (const m of [cinco, cinco, cinco]) {
      const r = paso(e, m, (t += 10 * MIN), socios);
      antes.push(...r.eventos);
      e = r.estado;
    }
    expect(antes.filter((x) => x.tipo === 'poca_variedad')).toEqual([]);
    // pasadas 24 horas, ya avisa
    const despues: EventoCambio[] = [];
    t += 25 * HORA;
    for (const m of [cinco, cinco, cinco]) {
      const r = paso(e, m, (t += 10 * MIN), socios);
      despues.push(...r.eventos);
      e = r.estado;
    }
    expect(despues.filter((x) => x.tipo === 'poca_variedad')).toHaveLength(1);
  });

  it('modelo sin ningun sabor no es poca variedad (eso es "modelo agotado")', () => {
    const cero = [modeloConSabores(1, 'Waka Icon 50,000', 12, 0), RELLENO];
    let e = conBase(doce, socios);
    e = paso(e, cero, HORA, socios).estado;
    const r = paso(e, cero, HORA + 10 * MIN, socios);
    expect(tipos(r.eventos)).toContain('modelo_agotado');
    expect(tipos(r.eventos)).not.toContain('poca_variedad');
  });
});

describe('propiedades del detector', () => {
  const lecturaArb = fc.array(fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }), { minLength: 2, maxLength: 5 });
  const aModelos = (disp: boolean[][]): ModeloSpec[] =>
    [...disp.map((ds, i) => ({ id: i + 1, titulo: `Modelo ${i + 1}`, sabores: ds.map((d, j) => ({ id: (i + 1) * 100 + j + 1, nombre: `Sabor ${j}`, disponible: d })) })), RELLENO];

  it('una lectura identica repetida no genera eventos nunca', () => {
    fc.assert(
      fc.property(lecturaArb, fc.integer({ min: 1, max: 6 }), (disp, veces) => {
        const modelos = aModelos(disp);
        let e = paso(estadoVacio(), modelos, 0).estado;
        for (let i = 1; i <= veces; i++) {
          const r = paso(e, modelos, i * HORA);
          expect(r.eventos).toEqual([]);
          e = r.estado;
        }
      }),
    );
  });

  it('convergencia: dos lecturas iguales dejan el estado vigente igual a lo publicado, y ningun evento se repite', () => {
    fc.assert(
      fc.property(lecturaArb, lecturaArb, (a, b) => {
        // mismo catalogo de ids, distinta disponibilidad
        const bb = a.map((ds, i) => ds.map((d, j) => b[i]?.[j] ?? d));
        const A = aModelos(a);
        const B = aModelos(bb);
        let e = paso(estadoVacio(), A, 0).estado;
        const claves = new Set<string>();
        for (const [i, m] of [B, B, B].entries()) {
          const r = paso(e, m, (i + 1) * HORA);
          for (const ev of r.eventos) {
            expect(claves.has(ev.clave)).toBe(false);
            claves.add(ev.clave);
          }
          e = r.estado;
        }
        for (const m of B) for (const s of m.sabores) expect(e.variantes[String(s.id)]!.disponible).toBe(s.disponible);
      }),
    );
  });

  it('un cambio de una sola lectura que se revierte nunca emite ni deja candidatos', () => {
    fc.assert(
      fc.property(lecturaArb, fc.nat(), (disp, sel) => {
        const A = aModelos(disp);
        const planos = A.flatMap((m) => m.sabores);
        const elegido = planos[sel % planos.length]!;
        const B = copiaConDisponibilidad(A, { [elegido.id]: !elegido.disponible });
        let e = paso(estadoVacio(), A, 0).estado;
        const r1 = paso(e, B, HORA);
        e = r1.estado;
        const r2 = paso(e, A, 2 * HORA);
        expect(r1.eventos).toEqual([]);
        expect(r2.eventos).toEqual([]);
        expect(Object.keys(r2.estado.candidatos)).toEqual([]);
      }),
    );
  });
});
