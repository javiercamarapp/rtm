// Paso 2 del encendido del reloj (docs/reloj-base-datos.md): guarda el secreto de las tareas en el Vault de la nube y fija la URL del latido.
// Lo corre el dueno (el valor del secreto no pasa por el chat ni se imprime): lee ~/.bodega-secrets/rtm-tareas-secreto.key (el MISMO valor de TAREAS_SECRETO en Vercel).
//   node scripts/despliegue/reloj-secreto.mjs [--dry-run]
// Idempotente: si ya hay un secreto con ese nombre no lo reemplaza; la URL solo se cambia si es distinta. No enciende nada (reloj_activo, reloj_http y reglas siguen apagados).
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const seco = process.argv.includes('--dry-run');
const URL_LATIDO = 'https://rtm-nu.vercel.app/api/tareas/latido';
const secreto = readFileSync(`${homedir()}/.bodega-secrets/rtm-tareas-secreto.key`, 'utf8').trim();
if (!/^[A-Za-z0-9_\-+/=.]{16,200}$/.test(secreto)) { console.error('El archivo del secreto no tiene el formato esperado.'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'rtm-reloj-'));
chmodSync(dir, 0o700);
const sql = (texto) => {
  const f = join(dir, 'q.sql');
  writeFileSync(f, texto, { mode: 0o600 });
  return execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};
try {
  const hay = /"n":\s*(\d+)/.exec(sql("select count(*)::int as n from vault.secrets where name = 'reloj_tareas_secreto'"))?.[1];
  console.log(`Secreto en el Vault: ${hay === '0' ? 'falta' : 'ya existe'}.`);
  const url = /"v":\s*"([^"]*)"/.exec(sql("select valor #>> '{}' as v from catalogo.config where clave = 'reloj_url_latido' and vigente_hasta is null order by vigente_desde desc limit 1"))?.[1] ?? '';
  console.log(`URL del latido: ${url === URL_LATIDO ? 'ya fijada' : 'por fijar'}.`);
  if (seco) { console.log('--dry-run: no se escribio nada.'); process.exit(0); }
  if (hay === '0') { sql(`select vault.create_secret('${secreto.replace(/'/g, "''")}', 'reloj_tareas_secreto')`); console.log('Secreto guardado en el Vault.'); }
  if (url !== URL_LATIDO) {
    sql(`update catalogo.config set vigente_hasta = current_date where clave = 'reloj_url_latido' and vigente_hasta is null;
         insert into catalogo.config (clave, valor, vigente_desde) values ('reloj_url_latido', to_jsonb('${URL_LATIDO}'::text), current_date);`);
    console.log('URL del latido fijada.');
  }
  console.log('Listo. Nada se encendio.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
