// Configuracion privada de las integraciones (Telegram, OpenRouter, tareas, fuente del inventario de proveedores). TODO viene de variables de entorno del servidor:
// ningun valor vive en el repo. Si falta algo, la integracion correspondiente no arranca (falla cerrado) y el resto del sistema sigue igual.
import { z } from 'zod';

const esquema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  OPENROUTER_API_KEY: z.string().min(20).optional(),
  TAREAS_SECRETO: z.string().min(16).optional(),
  INVENTARIO_PROVEEDORES_FUENTE: z.string().url().optional(),
  INVENTARIO_PROVEEDORES_CONTACTO: z.string().min(3).optional(),
});

export type ConfigPrivada = z.infer<typeof esquema>;

export function configPrivada(entorno: Record<string, string | undefined> = process.env): ConfigPrivada {
  const limpio = Object.fromEntries(Object.entries(entorno).filter(([k, v]) => k in esquema.shape && typeof v === 'string' && v !== ''));
  const r = esquema.safeParse(limpio);
  if (!r.success) throw new Error(`Configuracion privada invalida (${r.error.issues.map((i) => i.path.join('.')).join(', ')})`);
  return r.data;
}

/** Lista de nombres, sin valores (para el informe y para .env.example). */
export const VARIABLES_PRIVADAS = Object.keys(esquema.shape);
