import { webhookTelegram } from '@/composicion/produccion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Webhook de Telegram. Solo acepta la cabecera X-Telegram-Bot-Api-Secret-Token correcta (si no hay secreto configurado, rechaza todo).
 * Responde 200 pase lo que pase tras validar el secreto: un 5xx haria que Telegram reintente durante horas; el fallo queda en el registro del agente.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await webhookTelegram(req.headers.get('x-telegram-bot-api-secret-token'), await req.text());
  return new Response(null, { status: r.status });
}
