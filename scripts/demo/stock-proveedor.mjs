// Stock de proveedor del demo: estado FICTICIO de "Karen" (disponibilidad por modelo y sabor, con cambios recientes) guardado con la funcion oficial
// proveedores.guardar_estado, la misma que usa el vigilante. No lee ninguna tienda real ni guarda precios (la regla del repo lo prohibe).
import { crearAzar } from './prng.mjs';

const J = JSON.stringify;

/** Funcion pura: arma el estado y los eventos a partir de los ids del catalogo demo. */
/**
 * @param {any} p
 * @returns {any}
 */
export function armarEstadoStock({ modelos, hoy, semilla }) {
  const az = crearAzar(`${semilla}|stock-proveedor`);
  const ahora = `${hoy}T09:00:00Z`;
  const hace = (dias, hora = 9) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86400000 + hora * 3600000).toISOString();
  const estadoModelos = {};
  const variantes = {};
  const eventos = [];
  let nv = 0;
  modelos.forEach((m, i) => {
    const pid = String(910000000000000000n + BigInt(i + 1));
    const esNuevo = i % 11 === 3;
    estadoModelos[pid] = {
      id: pid, handle: m.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-'), titulo: m.nombre, tituloNorm: m.nombre.toLowerCase(), aliasTitulos: [], marca: m.marca, puffs: m.puffs,
      estado: 'activo', primeraVez: esNuevo ? hace(3) : hace(60), ultimaVez: ahora, ausencias: 0, primeraAusencia: null, sinSabores: false, nuevoSinCosto: false,
      mapeo: 'confirmado', canonicoId: String(m.id), gruposCandidatos: [],
    };
    if (esNuevo) eventos.push({ clave: `modelo_nuevo|${pid}|L${i}`, tipo: 'modelo_nuevo', productoId: pid, varianteId: null, lectura: `L${i}`, en: hace(3), antes: null, despues: m.nombre, datos: { modelo: m.nombre } });
    m.skus.forEach((sku, j) => {
      nv += 1;
      const vid = String(920000000000000000n + BigInt(nv));
      const disponible = az.prob(0.78);
      const cambia = az.prob(0.22);
      const cuando = hace(az.entre(0, 6), az.entre(8, 20));
      variantes[vid] = {
        id: vid, productoId: pid, saborOriginal: sku.sabor, saborNorm: sku.sabor.toLowerCase(), disponible, estado: 'activa', ausencias: disponible ? 0 : 1,
        primeraAusencia: disponible ? null : cuando, mapeo: 'confirmado', saborCanonicoId: String(sku.id), cambios: cambia ? [cuando] : [], inestableHasta: null,
        primeraVez: hace(60), ultimaVez: ahora,
      };
      if (cambia) {
        const tipo = disponible ? 'sabor_regreso' : 'sabor_agotado';
        eventos.push({ clave: `${tipo}|${vid}|L${nv}`, tipo, productoId: pid, varianteId: vid, lectura: `L${nv}`, en: cuando, antes: null, despues: sku.sabor, datos: {} });
      } else if (esNuevo && j < 3) {
        eventos.push({ clave: `sabor_nuevo|${vid}|L${nv}`, tipo: 'sabor_nuevo', productoId: pid, varianteId: vid, lectura: `L${nv}`, en: hace(3), antes: null, despues: sku.sabor, datos: { sabor: sku.sabor } });
      }
    });
  });
  const estado = {
    version: 1, inicializado: true, tarjetasPromo: 0, modelos: estadoModelos, variantes, candidatos: {}, retenida: null, promociones: {}, cola: [], historialVariedad: {}, variedad: {},
    salud: { ultimaLecturaOk: ahora, ultimoIntento: ahora, fallosSeguidos: 0, bloqueada: false, incidente: null }, lecturasProcesadas: [`demo|${hoy}|09`],
  };
  return { estado, eventos };
}

export async function cargarStockProveedor(ej) {
  try {
    const filas = (await ej.q(`select m.id, m.nombre_canonico as nombre, ma.nombre as marca, m.puffs, k.id as sku_id, s.nombre_canonico as sabor
      from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id join catalogo.sku k on k.modelo_id = m.id join catalogo.sabor s on s.id = k.sabor_id order by m.id, k.id`)).rows;
    const por = new Map();
    for (const f of filas) {
      if (!por.has(f.id)) por.set(f.id, { id: f.id, nombre: f.nombre, marca: f.marca, puffs: f.puffs, skus: [] });
      por.get(f.id).skus.push({ id: f.sku_id, sabor: f.sabor });
    }
    const { estado, eventos } = armarEstadoStock({ modelos: [...por.values()], hoy: ej.plan.meta.ultimo, semilla: ej.plan.meta.semilla });
    await ej.tx('B', ej.plan.meta.ultimo, () => ej.q('select proveedores.guardar_estado($1::jsonb,$2::jsonb,$3)', [J(estado), J(eventos), 'demo:stock-proveedor']));
    return { mensaje: `${Object.keys(estado.modelos).length} modelos de Karen, ${Object.keys(estado.variantes).length} sabores, ${eventos.length} cambios recientes.` };
  } catch (e) {
    ej.advertencias.push(`stock de proveedor no se cargo: ${String(e.message).split('\n')[0]}`);
    return { mensaje: 'no se cargo (ver advertencias)' };
  }
}
