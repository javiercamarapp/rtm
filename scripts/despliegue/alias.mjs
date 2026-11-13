// Logica del paso "publicar bajo el alias" del despliegue (la usa desplegar.mjs). Las funciones puras se prueban en
// test/unit/despliegue_alias.test.ts; publicarConAlias recibe los comandos externos como dependencias para poder simularlos.
//
// Por que existe: `vercel deploy --prebuilt --prod` deja el despliegue READY pero NO mueve el alias de produccion en este
// proyecto (sin Git). Antes el script solo imprimia "alias" y corria el humo contra el alias, es decir contra la version VIEJA.
// Flujo correcto: humo contra la URL unica del despliegue nuevo -> `vercel alias set` -> verificar que el alias sirve lo nuevo
// (inspect + marcador del build en /login) -> humo contra el alias -> si algo falla, restaurar el alias anterior.

const RE_URL_UNICA = /https:\/\/rtm-[a-z0-9]+-[a-z0-9-]+\.vercel\.app/;

/** Host sin protocolo, sin ruta y en minusculas ("https://X.vercel.app/a" -> "x.vercel.app"). */
export function hostDe(url) {
  return String(url ?? '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').toLowerCase();
}

/** URL unica que imprime `vercel deploy` (la linea de produccion va en stderr; la URL sola, en stdout). Prefiere stdout. */
export function extraerUrlDespliegue(stdout, stderr = '') {
  return RE_URL_UNICA.exec(String(stdout ?? ''))?.[0] ?? RE_URL_UNICA.exec(String(stderr ?? ''))?.[0] ?? null;
}

/** Interpreta `vercel inspect <alias o url> --json` (con respaldo al texto). Devuelve { id, host, estado } o null. */
export function parsearInspect(texto) {
  const t = String(texto ?? '');
  const a = t.indexOf('{');
  const z = t.lastIndexOf('}');
  if (a >= 0 && z > a) {
    try {
      const j = JSON.parse(t.slice(a, z + 1));
      const host = hostDe(j.url ?? j.deployment?.url ?? '');
      if (host) return { id: j.id ?? j.uid ?? j.deployment?.id ?? null, host, estado: j.readyState ?? j.state ?? null };
    } catch { /* sigue con el texto */ }
  }
  const url = RE_URL_UNICA.exec(t)?.[0];
  if (!url) return null;
  return { id: /\bdpl_[A-Za-z0-9]+/.exec(t)?.[0] ?? null, host: hostDe(url), estado: /\b(READY|ERROR|BUILDING|QUEUED|CANCELED)\b/.exec(t)?.[1] ?? null };
}

/** Dos descripciones apuntan al mismo despliegue: por id si ambas lo traen; si no, por host. */
export function mismoDespliegue(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return !!a.host && a.host === b.host;
}

/** Marcador unico del build: los assets estaticos que referencia /login (el nombre lleva el hash del contenido). */
export function extraerMarcador(html) {
  const rutas = new Set([...String(html ?? '').matchAll(/\/_next\/static\/[^"'\s\\)]+\.(?:js|css)/g)].map((m) => m[0]));
  return [...rutas].sort();
}

/** Mismo build solo si hay assets y el conjunto es identico. */
export function mismoMarcador(a, b) {
  return a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Decide que hacer tras un fallo posterior al alias.
 *  - aliasActual: lo que devuelve inspect del alias ahora (null si no se pudo consultar).
 *  - previo: el despliegue al que apuntaba el alias antes (null si no se conocia).
 * 'ninguna'  : el alias sigue en el previo, no hay nada que restaurar.
 * 'restaurar': el alias esta (o puede estar) en otro despliegue y hay previo al cual volver.
 * 'imposible': hay que restaurar pero no se sabe a que; retirar a mano.
 */
export function decidirRollback({ previo, aliasActual }) {
  if (previo && aliasActual && mismoDespliegue(aliasActual, previo)) return 'ninguna';
  return previo ? 'restaurar' : 'imposible';
}

const OPCIONES_CON_VALOR = new Set(['--solo-alias']);
export const OPCIONES = new Set(['--probar', '--completo', '--si-hay-cambios', '--permitir-sucio', '--incluir-todo', '--permitir-destructivas', '--con-correo-real', '--solo-alias', '--dry-run', '--permitir-sin-previo']);

/** Separa banderas y valores; rechaza banderas desconocidas (un typo no debe terminar en un despliegue real). */
export function leerArgumentos(argv) {
  const banderas = new Set();
  /** @type {Record<string, string>} */
  const valores = {};
  const errores = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { errores.push(`argumento inesperado: ${a}`); continue; }
    if (!OPCIONES.has(a)) { errores.push(`opcion desconocida: ${a}`); continue; }
    banderas.add(a);
    if (OPCIONES_CON_VALOR.has(a)) {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) errores.push(`${a} requiere un valor`); else { valores[a] = v; i++; }
    }
  }
  if (valores['--solo-alias'] && !RE_URL_UNICA.test(valores['--solo-alias'])) errores.push('--solo-alias requiere la URL unica del despliegue (https://rtm-xxxx-equipo.vercel.app)');
  return { banderas, valores, errores };
}

/** Plan en texto para --dry-run (no ejecuta nada). */
export function planDeDespliegue({ banderas, valores, urlProd, scope }) {
  const alias = hostDe(urlProd);
  const soloAlias = valores['--solo-alias'];
  const paso = (...l) => l;
  const publicacion = (nueva) => paso(
    `Registrar el despliegue al que apunta hoy ${alias} (vercel inspect ${alias} --json); si no se puede, abortar (salvo --permitir-sin-previo)`,
    `Pruebas de humo contra la URL unica ${nueva} (sin tocar el alias)`,
    `vercel alias set ${nueva} ${alias} --scope ${scope}`,
    `Verificar que ${alias} sirve el despliegue nuevo (inspect + marcador del build en /login) y repetir el humo contra ${alias}`,
    'Si algo falla despues del alias: vercel alias set <despliegue anterior> y salir con error',
    'Registrar en ~/.bodega-backups/despliegues.log la URL anterior y la nueva del alias',
  );
  const lineas = [`PLAN (--dry-run: no se ejecuta nada, no se escribe el registro)`];
  if (soloAlias) {
    lineas.push('Modo --solo-alias: sin compuerta, sin migraciones, sin build ni deploy.', ...publicacion(soloAlias));
  } else {
    lineas.push(
      'Rechazar arbol sucio (salvo --permitir-sucio) y exigir carpeta ligada a Vercel y Supabase',
      'Compuerta local: typecheck, lint, guardas, secretos, pruebas' + (banderas.has('--completo') ? ', verificar (completo)' : ''),
      'Comparar migraciones locales con la nube; abortar si la nube tiene extras o si una pendiente es destructiva o concede privilegios' + (banderas.has('--permitir-destructivas') ? ' (--permitir-destructivas ACTIVA: no abortaria)' : ''),
    );
    if (banderas.has('--probar')) lineas.push('--probar: termina aqui (no respalda, no aplica, no despliega)');
    else {
      lineas.push(
        'Respaldo cifrado previo y vercel/supabase db push de las migraciones pendientes (solo si las hay)' + (banderas.has('--incluir-todo') ? ' con --include-all' : ''),
        `Registrar el alias actual ${alias} (para restaurarlo)`,
        `vercel pull + vercel build --prod --scope ${scope} (build LOCAL, 0 builds de Vercel)`,
        `vercel deploy --prebuilt --prod --scope ${scope} -> URL unica`,
        ...publicacion('<URL unica del despliegue nuevo>').slice(1),
      );
    }
  }
  return lineas;
}

/**
 * Publica `nuevo` (URL unica) bajo `urlProd` con verificacion y restauracion.
 * deps: { run(cmd, args) -> {status, stdout, stderr}, pedirPagina(url) -> {status, html},
 *         humo(url) -> boolean, dormir(ms) -> Promise, log(texto) }
 * Devuelve { ok, etapa, detalle, previo, restaurado } (restaurado: true/false/null si no hizo falta).
 */
export async function publicarConAlias({ nuevo, urlProd, scope, previo, run, pedirPagina, humo, dormir, log, intentos = 5, esperaMs = 3000 }) {
  const alias = hostDe(urlProd);
  const hostNuevo = hostDe(nuevo);
  const consultar = (destino) => parsearInspect(run('vercel', ['inspect', destino, '--json', '--scope', scope]).stdout);
  const resultado = (ok, etapa, detalle, restaurado = null) => ({ ok, etapa, detalle, previo: previo?.host ?? null, restaurado });

  // 1. La URL unica debe servir /login (si esta protegida por Vercel o no responde, el humo no dice nada util).
  let pagNueva;
  try { pagNueva = await pedirPagina(`https://${hostNuevo}/login`); } catch (e) { return resultado(false, 'url-unica', `no responde la URL unica ${hostNuevo}: ${e?.message ?? e}`); }
  if (pagNueva.status !== 200) return resultado(false, 'url-unica', `la URL unica ${hostNuevo} respondio ${pagNueva.status} en /login (proteccion de despliegues de Vercel o despliegue no listo); el alias NO se toco`);
  const marcadorNuevo = extraerMarcador(pagNueva.html);
  if (!marcadorNuevo.length) return resultado(false, 'url-unica', `la URL unica ${hostNuevo} no trae assets de Next en /login; el alias NO se toco`);

  // 2. Humo contra la URL unica.
  log(`Humo contra la URL unica ${hostNuevo}`);
  if (!(await humo(`https://${hostNuevo}`))) return resultado(false, 'humo-url-unica', `el humo fallo contra la URL unica ${hostNuevo}; el alias NO se toco`);

  // 3. Asignar el alias.
  const infoNuevo = consultar(hostNuevo) ?? { id: null, host: hostNuevo, estado: null };
  log(`Alias: ${alias} <- ${hostNuevo}${previo ? ` (antes: ${previo.host})` : ' (sin alias previo conocido)'}`);
  const set = run('vercel', ['alias', 'set', hostNuevo, alias, '--scope', scope]);

  const restaurar = async (motivo) => {
    const decision = decidirRollback({ previo, aliasActual: consultar(alias) });
    if (decision === 'ninguna') return resultado(false, 'alias', `${motivo}; el alias sigue en ${previo?.host}, no hizo falta restaurar`, null);
    if (decision === 'imposible') return resultado(false, 'alias', `${motivo}; NO hay despliegue anterior conocido: retirar o corregir ${alias} a mano`, false);
    const rb = run('vercel', ['alias', 'set', previo.host, alias, '--scope', scope]);
    const tras = rb.status === 0 ? consultar(alias) : null;
    const bien = !!tras && mismoDespliegue(tras, previo);
    return resultado(false, 'alias', bien ? `${motivo}; alias restaurado a ${previo.host}` : `${motivo}; RESTAURACION FALLO, ejecutar a mano: vercel alias set ${previo.host} ${alias} --scope ${scope}`, bien);
  };

  if (set.status !== 0) return restaurar(`vercel alias set fallo (${String(set.stderr ?? '').trim().slice(-160)})`);

  // 4. Verificar que el alias sirve el despliegue nuevo (la propagacion puede tardar unos segundos).
  let motivo = 'el alias no sirve el despliegue nuevo';
  let servido = false;
  for (let i = 0; i < intentos && !servido; i++) {
    if (i > 0) await dormir(esperaMs);
    const actual = consultar(alias);
    let marcadorAlias = [];
    try { const p = await pedirPagina(`https://${alias}/login`); marcadorAlias = p.status === 200 ? extraerMarcador(p.html) : []; } catch { /* reintenta */ }
    const apunta = mismoDespliegue(actual, infoNuevo);
    const igual = mismoMarcador(marcadorAlias, marcadorNuevo);
    servido = apunta && igual;
    if (!servido) motivo = `${alias} no sirve el despliegue nuevo (inspect ${apunta ? 'coincide' : `apunta a ${actual?.host ?? 'desconocido'}`}; marcador del build ${igual ? 'coincide' : 'distinto o sin respuesta'})`;
  }
  if (!servido) return restaurar(motivo);

  // 5. Humo contra el alias.
  log(`Humo contra el alias ${alias}`);
  if (!(await humo(`https://${alias}`))) return restaurar(`el humo fallo contra el alias ${alias}`);

  return resultado(true, 'listo', `alias ${alias}: ${previo?.host ?? 'sin previo'} -> ${hostNuevo}`);
}
