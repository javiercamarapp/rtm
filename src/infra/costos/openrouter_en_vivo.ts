// Lectura en vivo de la llave de RTM en OpenRouter. Solo lee el uso de ESA llave (nunca el saldo ni el gasto de otros productos). Sin llave o con falla de red devuelve null: la pagina lo dice, nunca inventa una cifra.
import { parsearLlave, type LecturaOpenRouter } from '@/dominio/costos/en_vivo';

export async function leerUsoDeLaLlave(llave: string | undefined, f: typeof fetch = fetch, ahora: () => Date = () => new Date()): Promise<LecturaOpenRouter | null> {
  if (!llave) return null;
  try {
    const r = await f('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!r.ok) return null;
    return parsearLlave(await r.json(), ahora().toISOString());
  } catch {
    return null;
  }
}
