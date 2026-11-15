import { leerCuerpoAcotado, webhookTelegram } from '@/composicion/produccion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** El modelo puede tardar (hasta dos intentos de 25 s) y un lote se procesa por partes: 60 s, declarado (antes dependia del valor por omision de la plataforma). */
export const maxDuration = 60;

/**
 * Webhook de Telegram. Solo acepta la cabecera X-Telegram-Bot-Api-Secret-Token correcta (si no hay secreto configurado, rechaza todo).
 * El secreto se valida ANTES de leer el cuerpo y el cuerpo se lee con tope (Content-Length y bytes reales). Responde 200 cuando el update quedo registrado (reclamo con lease en la base); si el registro falla responde 500 y Telegram reintenta con el mismo update_id, seguro porque el reclamo es idempotente.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await webhookTelegram(req.headers.get('x-telegram-bot-api-secret-token'), () => leerCuerpoAcotado(req));
  return new Response(null, { status: r.status });
}
