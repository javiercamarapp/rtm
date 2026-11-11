// Ayudas de las pruebas contra el Supabase local. Solo local: usan las llaves de `supabase status` (no se versionan ni se imprimen).
// Todos los correos son ficticios (@example.test).
import { execFileSync } from 'node:child_process';
import pg from 'pg';

export interface EstadoSupabase {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  MAILPIT_URL: string;
}

let cache: EstadoSupabase | null = null;
export function estado(): EstadoSupabase {
  if (!cache) {
    cache = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as EstadoSupabase;
  }
  return cache;
}

export async function conDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: estado().DB_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const DOMINIO = '@example.test';
let contador = 0;
export function correoUnico(prefijo: string): string {
  contador += 1;
  return `${prefijo}.${Date.now().toString(36)}${contador}${DOMINIO}`;
}

/** IP falsa distinta por prueba: el limite por IP no debe contaminar a las demas pruebas. */
export function ipFalsa(): string {
  return `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
}

export async function altaUsuario(opts: { correo: string; rol?: 'socio' | 'omar'; socio?: 'Angelo' | 'Javier'; activo?: boolean }): Promise<string> {
  const rol = opts.rol ?? 'socio';
  const socio = rol === 'socio' ? (opts.socio ?? 'Angelo') : null;
  const activo = opts.activo ?? true;
  await conDb((c) => c.query('insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ($1,$2,$3,$4) on conflict (correo) do nothing', [opts.correo, rol, socio, activo]));
  const e = estado();
  const r = await fetch(`${e.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: opts.correo, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`alta de usuario fallo: ${r.status}`);
  const u = (await r.json()) as { id: string };
  return u.id;
}

export async function contarUsuariosAuth(): Promise<number> {
  return conDb(async (c) => Number((await c.query('select count(*)::int as n from auth.users')).rows[0].n));
}

interface ResumenCorreo { ID: string; To: { Address: string }[]; Subject: string }

export async function limpiarBuzon(): Promise<void> {
  await fetch(`${estado().MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

export async function mensajesPara(correo: string): Promise<ResumenCorreo[]> {
  const r = await fetch(`${estado().MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${correo}`)}`);
  const j = (await r.json()) as { messages?: ResumenCorreo[] };
  return j.messages ?? [];
}

export async function esperarMensajes(correo: string, cuantos: number, msMax = 15_000): Promise<ResumenCorreo[]> {
  const fin = Date.now() + msMax;
  for (;;) {
    const m = await mensajesPara(correo);
    if (m.length >= cuantos || Date.now() > fin) return m;
    await new Promise((res) => setTimeout(res, 250));
  }
}

/** Enlace de verificacion del correo mas reciente (o del indice dado, 0 = el mas reciente). */
export async function enlaceDe(correo: string, indice = 0): Promise<string> {
  const msgs = await mensajesPara(correo);
  const m = msgs[indice];
  if (!m) throw new Error('sin mensaje para el correo de prueba');
  const r = await fetch(`${estado().MAILPIT_URL}/api/v1/message/${m.ID}`);
  const j = (await r.json()) as { Text?: string; HTML?: string };
  const cuerpo = `${j.Text ?? ''}\n${j.HTML ?? ''}`.replace(/&amp;/g, '&');
  const hit = /https?:\/\/[^\s"'<>)]*\/auth\/v1\/verify[^\s"'<>)]*/.exec(cuerpo);
  if (!hit) throw new Error('el correo no trae enlace de verificacion');
  return hit[0];
}
