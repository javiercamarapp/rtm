#!/usr/bin/env node
// Vigilante horario de la tienda de Karen. Una pasada = una lectura educada del catalogo publico (la misma que hace la tarea `inventario-proveedores`).
//
//   npx tsx scripts/proveedores/vigilar-karen.mjs --verificar   SOLO LECTURA: lee la tienda, dice que cambiaria (modelos nuevos, disponibilidad, fotos por bajar y por confirmar). No escribe en la base ni en el repo.
//   npx tsx scripts/proveedores/vigilar-karen.mjs --aplicar     escribe por las funciones existentes (proveedores.guardar_estado, emitir_aviso, foto diaria), baja fotos faltantes y registra las dudosas en la cola.
//
// Opciones: --catalogo (registra en el catalogo propio los modelos y sabores nuevos de la tienda, con existencia 0), --env-file=<ruta> (variable INVENTARIO_PROVEEDORES_FUENTE; si no, del entorno), --sin-fotos, --limite-fotos=N (default 12), --forzar (ignora la guarda de 1 pasada por hora).
// Base: RTM_DB_URL (rol servidor o postgres). Nunca se imprime la direccion de la fuente ni la de la base.
//
// Reglas: respeta robots.txt, 1 pasada por hora (guarda), pausa >= 1.1 s entre peticiones, agente de usuario generico sin datos personales, sin sesion ni cookies, tope de 40 peticiones al dia.
// NUNCA lee ni guarda precios (regla del repo: el monitor solo ve modelos, sabores y disponibilidad). NUNCA unifica ni asigna una foto dudosa: va a la cola `proveedores.foto_pendiente`.
// NO envia Telegram: los avisos van solo a la tabla interna de avisos. Si la fuente no responde, el ciclo registra el fallo y el script termina con codigo 0 sin tocar nada mas.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conciliar, cargarAliasWaka } from './conciliar-marcas.mjs';
import { claveFoto, extraerModelos } from './bajar-fotos.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MINUTOS_ENTRE_PASADAS = 55;

/** Variable privada: del entorno o de un archivo (`--env-file`). Nunca se imprime. */
export function leerFuente(archivo, entorno = process.env) {
  if (!archivo) return entorno.INVENTARIO_PROVEEDORES_FUENTE?.trim() || null;
  const m = readFileSync(archivo, 'utf8').split(/\r?\n/).map((l) => l.match(/^INVENTARIO_PROVEEDORES_FUENTE=(.*)$/)).find(Boolean);
  return m?.[1]?.trim().replace(/^["']|["']$/g, '') || null;
}

/** Guarda de 1 pasada por hora: true si ya hubo un intento hace menos de 55 minutos. */
export function pasadaReciente(salud, ahora = new Date()) {
  const ultimo = salud?.ultimoIntento ?? salud?.ultimaLecturaOk ?? null;
  if (!ultimo) return false;
  return (ahora.getTime() - new Date(ultimo).getTime()) / 60_000 < MINUTOS_ENTRE_PASADAS;
}

/** Fotos que faltan: modelos de la tienda sin archivo en la carpeta. */
export function fotosFaltantes(modelos, existentes) {
  const tiene = new Set(existentes);
  return modelos.filter((m) => !tiene.has(m.clave));
}

/**
 * Decide que hacer con la foto de un modelo de la tienda frente al catalogo propio. NUNCA asigna lo dudoso.
 * 'asignar' solo si hay UN candidato exacto (misma marca, linea y puffs) o uno por alias del diccionario sin otros candidatos; el modelo del catalogo no debe tener ya foto.
 */
export function decidirFoto(producto, catalogo, aliasWaka, propuestas, fotoDe) {
  const r = conciliar([producto], catalogo, aliasWaka, propuestas);
  if (r.coinciden.length === 1) {
    const m = r.coinciden[0].m;
    return fotoDe(m.id) ? { accion: 'ya_tiene', modeloId: m.id } : { accion: 'asignar', modeloId: m.id, confianza: 'exacto' };
  }
  if (r.alias.length === 1 && !(r.alias[0].extra?.length) && !fotoDe(r.alias[0].m.id)) return { accion: 'por_confirmar', motivo: 'solo_linea', candidatos: [r.alias[0].m.id] };
  if (r.dudosos.length === 1) return { accion: 'por_confirmar', motivo: r.dudosos[0].candidatos.length > 1 ? 'varios_candidatos' : 'solo_linea', candidatos: r.dudosos[0].candidatos.map((m) => m.id) };
  if (r.alias.length === 1) return { accion: 'por_confirmar', motivo: 'varios_candidatos', candidatos: [r.alias[0].m, ...(r.alias[0].extra ?? [])].map((m) => m.id) };
  if (r.soloTienda.length === 1) return { accion: 'por_confirmar', motivo: r.soloTienda[0].marcaConocida ? 'sin_coincidencia' : 'marca_distinta', candidatos: [] };
  return { accion: 'ninguna' };
}

/** Pone la foto en una fila de src/dominio/catalogo/fotos-modelos.ts: solo cambia `foto: null` y la confianza de ESE id. Devuelve el texto nuevo o null si no hay nada que cambiar. */
export function asignarEnTabla(texto, id, ruta) {
  const re = new RegExp(`(\\{ id: ${Number(id)}, [^}]*?foto: )null(, confianza: )'sin_evidencia'( \\})`);
  return re.test(texto) ? texto.replace(re, `$1'${ruta}'$2'exacto'$3`) : null;
}

function argumentos(av) {
  const v = (n) => av.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return { aplicar: av.includes('--aplicar'), verificar: av.includes('--verificar'), envFile: v('env-file'), sinFotos: av.includes('--sin-fotos'), catalogo: av.includes('--catalogo'), limiteFotos: Number(v('limite-fotos') ?? 12), forzar: av.includes('--forzar') };
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  if (a.aplicar === a.verificar) { console.error('Uso: vigilar-karen.mjs --verificar | --aplicar [--env-file=ruta] [--catalogo] [--sin-fotos] [--limite-fotos=N] [--forzar]'); return 2; }
  const fuente = leerFuente(a.envFile);
  if (!fuente) { console.error('Falta la variable privada INVENTARIO_PROVEEDORES_FUENTE (entorno o --env-file). No se hizo ninguna peticion.'); return 2; }
  if (!process.env.RTM_DB_URL) { console.error('Falta RTM_DB_URL (rol servidor). No se hizo ninguna peticion.'); return 2; }

  const { default: pg } = await import('pg');
  const { crearLectorHttp } = await import('../../src/infra/proveedores/lector_http.ts');
  const { ejecutarLecturaHoraria } = await import('../../src/aplicacion/proveedores/ciclo.ts');
  const { RepositorioProveedorDb, ContextoNegocioDb, AvisosDb } = await import('../../src/infra/proveedores/postgres.ts');
  const { llamadaProveedoresServidor } = await import('../../src/infra/postgres/proveedores.ts');
  const { robotsPermite, RUTAS_DE_LECTURA, presupuestoDelDia, registrarPeticion } = await import('../../src/dominio/proveedores/fuente.ts');
  const { fechaNeg } = await import('../../src/dominio/calendario.ts');

  const cliente = new pg.Client({ connectionString: process.env.RTM_DB_URL });
  await cliente.connect();
  const sql = async (texto, params = []) => (await cliente.query(texto, [...params])).rows;
  const db = llamadaProveedoresServidor(sql);
  const real = new RepositorioProveedorDb(db);
  const contexto = new ContextoNegocioDb(db);
  const modo = a.aplicar ? 'APLICAR' : 'VERIFICAR (solo lectura)';
  console.log(`Vigilante de Karen: modo ${modo}.`);

  try {
    const estado0 = await real.cargarEstado();
    if (a.aplicar && !a.forzar && pasadaReciente(estado0.salud)) { console.log('Ya hubo una pasada hace menos de 55 minutos: no se hace nada (usa --forzar para saltar la guarda).'); return 0; }
    const interruptor = (await sql("select coalesce((select activo from seguridad.interruptor where clave = 'lectura_proveedores'), false) as activo"))[0].activo;
    if (a.aplicar && !interruptor) { console.log('El interruptor lectura_proveedores esta apagado: no se lee ni se escribe. Enciendelo desde la base (ver docs/stock-proveedores.md).'); return 0; }

    const lectorBase = crearLectorHttp({ base: fuente, ...(process.env.INVENTARIO_PROVEEDORES_CONTACTO ? { contacto: process.env.INVENTARIO_PROVEEDORES_CONTACTO } : {}) });
    const paginas = [];
    const lector = { ...lectorBase, leerCatalogo: async (p) => { const r = await lectorBase.leerCatalogo(p); paginas.push(r); return r; } };

    // robots.txt: antes de leer el catalogo. Cuenta como una peticion del tope del dia.
    const robots = await lector.leerRobots();
    if (robots.estado === 200 && RUTAS_DE_LECTURA.some((ruta) => !robotsPermite(robots.cuerpo, ruta))) { console.log('robots.txt no permite leer el catalogo: no se lee nada.'); return 0; }
    const ahora = new Date();
    if (a.aplicar) await real.guardarPresupuesto(registrarPeticion(presupuestoDelDia(await real.cargarPresupuesto(fechaNeg(ahora)), fechaNeg(ahora)), 'robots'));

    // En --verificar el repositorio y los avisos son de papel: se lee el estado real pero nada se escribe.
    const capturados = { eventos: [], avisos: [], estado: null };
    const repoVerificar = {
      cargarEstado: () => real.cargarEstado(),
      guardarEstado: async (estado, eventos) => { capturados.estado = estado; capturados.eventos.push(...eventos); },
      cargarPresupuesto: async () => null,
      guardarPresupuesto: async () => {},
      guardarFotoDiaria: async () => {},
    };
    const avisosVerificar = { emitir: async (x) => { capturados.avisos.push(x); }, resolver: async () => {} };
    const deps = { lector, repo: a.aplicar ? real : repoVerificar, contexto, avisos: a.aplicar ? new AvisosDb(db) : avisosVerificar, reloj: () => new Date(), promocionesActivas: false };

    const r = await ejecutarLecturaHoraria(deps);
    console.log(`Lectura: ${r.estado}${r.motivo ? ` (${r.motivo})` : ''}; eventos ${r.eventos}; avisos ${r.avisos}; peticiones ${r.peticiones + 1}.`);
    if (!a.aplicar) {
      const porTipo = {};
      for (const e of capturados.eventos) porTipo[e.tipo] = (porTipo[e.tipo] ?? 0) + 1;
      if (r.estado === 'inicial' && capturados.estado) console.log(`Carga inicial: se registrarian ${Object.keys(capturados.estado.modelos ?? {}).length} modelos y ${Object.keys(capturados.estado.variantes ?? {}).length} sabores como linea base (sin avisos).`);
      console.log('Cambiaria:', Object.keys(porTipo).length ? JSON.stringify(porTipo) : 'nada nuevo');
      for (const av of capturados.avisos.slice(0, 15)) console.log(`  aviso interno: ${av.codigo}`);
    }
    if (!['ok', 'inicial'].includes(r.estado)) return 0;

    // Fotos: reusa la lectura del catalogo que ya se hizo (sin otra peticion) y baja solo las que faltan.
    const productos = paginas.flatMap((p) => { try { return JSON.parse(p.cuerpo).products ?? []; } catch { return []; } });

    // Catalogo propio: todo modelo y sabor de la tienda (disponible o agotado) queda registrado con existencia 0; lo dudoso se reporta y NO se toca. Sin peticiones extra.
    if (a.catalogo && productos.length) {
      try {
        const { ejecutar, imprimir, leerReglas } = await import('./cargar-catalogo-proveedor.mjs');
        const { itemsDeTienda } = await import('./plan-catalogo.mjs');
        imprimir(await ejecutar({ url: process.env.RTM_DB_URL, fuente: 'karen', items: itemsDeTienda(productos), aplicar: a.aplicar, ...leerReglas() }), a.aplicar);
      } catch (e) {
        console.error(`Catalogo: no se registro (${String(e instanceof Error ? e.message : e).split('\n')[0]}). La lectura de la tienda ya quedo guardada.`);
      }
    }
    if (a.sinFotos) return 0;

    const modelos = extraerModelos({ products: productos });
    const dirFotos = join(RAIZ, 'public', 'proveedores', 'karen');
    const existentes = readdirSync(dirFotos).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5));
    const faltan = fotosFaltantes(modelos, existentes);
    console.log(`Fotos: ${modelos.length - faltan.length} de ${modelos.length} modelos ya tienen foto; faltan ${faltan.length}.`);

    const catalogo = await db('catalogo_para_fotos');
    const aliasWaka = cargarAliasWaka(join(RAIZ, 'scripts', 'catalogo', 'alias-waka.json'));
    const propuestas = new Map(JSON.parse(readFileSync(join(RAIZ, 'scripts', 'catalogo', 'marcas-modelos.json'), 'utf8')).modelos.map((m) => [m.id, m.marca]));
    const tablaRuta = join(RAIZ, 'src', 'dominio', 'catalogo', 'fotos-modelos.ts');
    let tabla = readFileSync(tablaRuta, 'utf8');
    const conFoto = (id) => new RegExp(`\\{ id: ${Number(id)}, [^}]*?foto: '`).test(tabla);

    let bajadas = [];
    if (a.aplicar && faltan.length) {
      const { ejecutar } = await import('./bajar-fotos.mjs');
      const { default: sharp } = await import('sharp');
      const out = await ejecutar({ base: fuente, sharp, dirFotos, archivoMapa: join(RAIZ, 'src', 'config', 'fotos_karen.ts'), limite: a.limiteFotos, modelosPrecargados: modelos, log: (m) => console.log(`  ${m}`) });
      bajadas = out.nuevas ?? [];
    }
    const porDecidir = a.aplicar ? modelos.filter((m) => bajadas.includes(m.clave)) : faltan;
    const crudoPorClave = new Map(productos.map((p) => [claveFoto(p.handle), p]));
    for (const m of porDecidir) {
      const p = crudoPorClave.get(m.clave);
      const d = decidirFoto({ handle: p.handle, title: p.title, vendor: p.vendor, variants: [] }, catalogo, aliasWaka, propuestas, conFoto);
      const archivo = `/proveedores/karen/${m.clave}.webp`;
      if (d.accion === 'asignar') {
        console.log(`  foto ${m.clave}: ${a.aplicar ? 'asignada' : 'se asignaria'} al modelo ${d.modeloId} (exacto)`);
        if (a.aplicar) { const t = asignarEnTabla(tabla, d.modeloId, archivo); if (t) tabla = t; }
      } else if (d.accion === 'por_confirmar') {
        console.log(`  foto ${m.clave}: POR CONFIRMAR (${d.motivo}${d.candidatos.length ? `; candidatos ${d.candidatos.join(', ')}` : ''})`);
        if (a.aplicar) await db('registrar_foto_pendiente', { p_clave: m.clave, p_titulo: m.titulo, p_marca: p.vendor ?? '', p_archivo: archivo, p_candidatos: d.candidatos, p_motivo: d.motivo });
      }
    }
    if (a.aplicar && tabla !== readFileSync(tablaRuta, 'utf8')) writeFileSync(tablaRuta, tabla);
    return 0;
  } catch (e) {
    console.error(`El vigilante termino con error controlado: ${String(e instanceof Error ? e.message : e).replace(/https?:\/\/\S+/g, '[direccion]')}`);
    return 1;
  } finally {
    await cliente.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await principal());
