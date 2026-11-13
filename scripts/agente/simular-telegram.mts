// Simulador de webhook contra una base LOCAL: envia updates de Telegram falsos a procesarWebhook (la funcion que llama /api/telegram/webhook)
// con la cabecera del secreto de PRUEBA. El cliente de Telegram es el real pero su fetch es un doble que registra y nunca sale a api.telegram.org;
// el extractor de IA es el simulado determinista. Escribe en la base local (usa una base de desarrollo; nada de nube).
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:64322/postgres npx tsx scripts/agente/simular-telegram.mts scripts/agente/guion-telegram.txt
// OJO: scripts/agente/guion-menudeo.txt NO es para este script: es para scripts/agente/simulador.mts (en memoria, con el reloj manual y los comandos foto, envio y latido).
// Guion: "angelo> texto" escribe en el grupo; "boton javier: Confirmar" pulsa un boton del ultimo mensaje; "# ..." comentario.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { procesarWebhook, type DepsProduccion } from '@/composicion/produccion';
import { LlmHeuristico } from '@/infra/agente/llm_simulado';
import type { FetchLike } from '@/infra/agente/telegram_api';
import type { Sql } from '@/infra/postgres/servidor';

const url = process.env.DATABASE_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  process.stderr.write('DATABASE_URL debe apuntar a una base LOCAL (127.0.0.1 o localhost). No se hace nada.\n');
  process.exit(2);
}
const ruta = process.argv[2];
if (!ruta) {
  process.stderr.write('Uso: npx tsx scripts/agente/simular-telegram.mts <guion>\n');
  process.exit(2);
}

const ID = { angelo: 7_000_001, javier: 7_000_002, omar: 7_000_003, grupo: -100_700 } as const;
const SECRETO = 'secreto-de-prueba-' + 'x'.repeat(16);
const TOKEN = 'T'.repeat(30);
const cliente = new pg.Client({ connectionString: url });
await cliente.connect();
const sql: Sql = async (t, p = []) => (await cliente.query(t, [...p])).rows as never;
for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier'], [ID.omar, 'omar']] as const) await sql('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
await sql("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
await sql("select agente.registrar_chat('privado_omar', $1::bigint)", [ID.omar]);

let idMsg = 5000;
let upd = Date.now() % 1_000_000_000;
let ultimo: { id: number; botones: { texto: string; data: string }[] } = { id: 0, botones: [] };
const fetchFalso: FetchLike = async (_u, init) => {
  const metodo = _u.split('/').pop()!;
  const cuerpo = JSON.parse(init.body) as { text?: string; reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } };
  if (metodo === 'sendMessage') {
    ultimo = { id: ++idMsg, botones: (cuerpo.reply_markup?.inline_keyboard ?? []).flat().map((b) => ({ texto: b.text, data: b.callback_data })) };
    process.stdout.write(`  bot> ${cuerpo.text?.replace(/\n/g, '\n       ')}\n`);
    if (ultimo.botones.length > 0) process.stdout.write(`       [${ultimo.botones.map((b) => b.texto).join('] [')}]\n`);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: idMsg } }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
};
const deps: DepsProduccion = { sql, llm: new LlmHeuristico(), fetchFn: fetchFalso, entorno: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRETO }, configAgente: { limiteMensajesPorMinuto: 0 } };

for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
  const l = linea.trim();
  if (l === '' || l.startsWith('#')) continue;
  const texto = /^(angelo|javier|omar)>\s*(.+)$/.exec(l);
  const boton = /^boton (angelo|javier|omar):\s*(.+)$/.exec(l);
  if (texto) {
    process.stdout.write(`${texto[1]}> ${texto[2]}\n`);
    const quien = texto[1] as 'angelo' | 'javier' | 'omar';
    await procesarWebhook(deps, SECRETO, JSON.stringify({ update_id: ++upd, message: { message_id: ++upd, from: { id: ID[quien] }, chat: quien === 'omar' ? { id: ID.omar, type: 'private' } : { id: ID.grupo, type: 'supergroup' }, date: 1_794_000_000, text: texto[2] } }));
  } else if (boton) {
    const b = ultimo.botones.find((x) => x.texto === boton[2]);
    process.stdout.write(`${boton[1]} pulsa: ${boton[2]}\n`);
    if (!b) { process.stdout.write('  (no hay ese boton en el ultimo mensaje)\n'); continue; }
    const quien = boton[1] as 'angelo' | 'javier' | 'omar';
    await procesarWebhook(deps, SECRETO, JSON.stringify({ update_id: ++upd, callback_query: { id: `cb${upd}`, from: { id: ID[quien] }, message: { message_id: ultimo.id, chat: { id: ID.grupo, type: 'supergroup' } }, data: b.data } }));
  } else process.stdout.write(`  (linea no entendida: ${l})\n`);
}
await cliente.end();
