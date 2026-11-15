// Decision del dueno (14-nov): un monto escrito con "k" o "mil" (o sin la cifra completa) se REPITE y se pregunta antes de registrar. La IA nunca decide la escala.
import { valoresDeTexto } from './cifras';

/**
 * true si el valor (centavos) solo se explica en el mensaje con un token abreviado ("20k", "20 mil", "1.5 mil") y ningun otro numero claro del mensaje lo explica.
 * Los montos escritos completos ("20,000") nunca disparan la pregunta.
 */
export function esMontoAbreviado(fuente: string, valor: bigint): boolean {
  const t = fuente.toLowerCase();
  const abreviados = [...t.matchAll(/(\d[\d.,]*)\s*(?:k|mil)\b/g)].map((m) => m[0]);
  if (abreviados.length === 0) return false;
  const quitado = abreviados.reduce((acc, a) => acc.replace(a, ' '), t);
  if (valoresDeTexto(quitado).has(valor)) return false;
  return abreviados.some((a) => valoresDeTexto(a).has(valor));
}
