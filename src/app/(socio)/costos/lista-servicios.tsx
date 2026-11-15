import Link from 'next/link';
import { ETIQUETA_CATEGORIA, categoriaDe, ordenarServicios } from '@/dominio/costos/lista-servicios';
import { ETIQUETA_COSTO, pesosDeExactoE6, textoMicro } from '@/dominio/costos/entrada';
import type { ResumenServicio, ServicioVista } from '@/dominio/costos/vista';
import { formatearMoneda } from '@/dominio/formato';
import { LogoServicio } from '@/ui/componentes/logo-servicio';

const dinero = (c: bigint) => formatearMoneda(c);

/** Lista ordenada de servicios: una fila por servicio con columnas alineadas; cada fila es un enlace a la ficha del servicio (teclado y foco nativos).
 *  Orden: categoria (Mantenimiento, Opcional, Construccion) y luego alfabetico. Las cifras vienen de la base (costos_resumen) sin recalcularse aqui. */
export function ListaServicios({ servicios, resumen, mes, incluir }: { servicios: ServicioVista[]; resumen: ResumenServicio[]; mes: string; incluir: boolean }) {
  const concepto = new Map(servicios.map((s) => [s.slug, s.metodo_atribucion]));
  const query = new URLSearchParams({ mes, ...(incluir ? { construccion: '1' } : {}) }).toString();
  return (
    <ul className="rtm-serv-lista" data-testid="costos-servicios">
      <li className="rtm-serv-cab" aria-hidden="true">
        <span />
        <span>Servicio</span>
        <span>Categoría</span>
        <span>Concepto</span>
        <span className="rtm-serv-importe">Atribuido a RTM</span>
        <span>Estado</span>
      </li>
      {ordenarServicios(resumen).map((s) => (
        <li key={s.slug} data-testid={`servicio-${s.slug}`}>
          <Link className="rtm-serv-fila" href={`/costos/${s.slug}?${query}`} aria-label={`${s.servicio}: ver detalle y cargos`}>
            <LogoServicio slug={s.slug} logoSlug={s.logo_slug} nombre={s.servicio} />
            <span className="rtm-serv-nombre">{s.servicio}</span>
            <span className="rtm-serv-cat" data-categoria={categoriaDe(s)}>{ETIQUETA_CATEGORIA[categoriaDe(s)]}</span>
            <span className="rtm-serv-concepto">{concepto.get(s.slug) ?? ''}</span>
            {s.cargos === 0 ? (
              <>
                <span className="rtm-serv-importe">
                  <strong>{(s.usd_sin_tc_micro ?? 0) > 0 ? `USD ${textoMicro(BigInt(s.usd_sin_tc_micro!))}` : '$0.00'}</strong>
                  {(s.acumulado_cent ?? 0n) > 0n && <small>acumulado {dinero(s.acumulado_cent!)}</small>}
                </span>
                <span className="rtm-serv-estado" data-vacio={(s.usd_sin_tc_micro ?? 0) > 0 ? undefined : true}>{(s.usd_sin_tc_micro ?? 0) > 0 ? 'Sin tipo de cambio: falta capturarlo' : 'Sin cargos este mes'}</span>
              </>
            ) : (
              <>
                <span className="rtm-serv-importe">
                  <strong>{dinero(s.redondeado_cent)}</strong>
                  <small>exacto {pesosDeExactoE6(BigInt(s.exacto_e6))}{s.usd_micro ? ` · USD ${textoMicro(BigInt(s.usd_micro))}` : ''}{s.acumulado_cent !== undefined ? ` · acumulado ${dinero(s.acumulado_cent)}` : ''}</small>
                </span>
                <span className="rtm-serv-estado">Aportación de capital · {ETIQUETA_COSTO[s.ultima_etiqueta ?? ''] ?? ''} · {s.ultimo_estado === 'confirmado' ? 'Confirmado' : 'Provisional'}</span>
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
