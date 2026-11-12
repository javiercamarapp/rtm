// Lecturas de reportes con la sesion del socio (api.rep_*). El PDF y el HTML se abren con la sesion: no hay enlaces publicos ni adjuntos.
import { crearClienteServidor } from './cliente-servidor';

export interface FilaHistorial {
  clave: string; version: number; folio: string; huella: string; estado: 'publicado' | 'borrador'; etiquetas: string[]; tiene_pdf: boolean; creado_at: string; ultima: boolean; entrega_telegram: boolean; entrega_correo: boolean;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export const historialReportes = () => rpc<FilaHistorial[]>('rep_historial');
export const htmlDeReporte = (clave: string, version: number) => rpc<string | null>('rep_html', { p_clave: clave, p_version: version });
export async function pdfDeReporte(clave: string, version: number): Promise<Uint8Array | null> {
  const b64 = await rpc<string | null>('rep_pdf', { p_clave: clave, p_version: version });
  return b64 ? new Uint8Array(Buffer.from(b64, 'base64')) : null;
}
