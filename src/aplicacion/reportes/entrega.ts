// Entrega idempotente: cada canal se marca al enviarse; un reintento solo envia lo que falta (el reintento no duplica envios).
import type { EntregaReportes, ReportePublicado, RepositorioReportes } from './puertos';
import { construirCorreo, construirTelegram } from '@/dominio/reportes/entrega';
import type { Paquete } from '@/dominio/reportes/paquete';

export async function entregaTelegramYCorreo(paquete: Paquete, reporte: ReportePublicado, pdf: Uint8Array, entrega: EntregaReportes, repo: RepositorioReportes): Promise<ReportePublicado> {
  const nombre = `${paquete.periodo.folio}-${reporte.huella}.pdf`;
  let { telegram, correo } = reporte.entregas;
  if (!telegram) {
    await entrega.telegramSocios(construirTelegram(paquete), { nombre, bytes: pdf });
    await repo.marcarEntrega(reporte.clave, reporte.version, 'telegram');
    telegram = true;
  }
  if (!correo) {
    await entrega.correoDuenos(construirCorreo(paquete), `/reportes/${encodeURIComponent(reporte.clave)}/${reporte.version}`);
    await repo.marcarEntrega(reporte.clave, reporte.version, 'correo');
    correo = true;
  }
  return { ...reporte, entregas: { telegram, correo } };
}
