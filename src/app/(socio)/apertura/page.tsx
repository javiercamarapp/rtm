import type { Metadata } from 'next';
import Link from 'next/link';
import { aperturaDeSocio } from '@/composicion/apertura';
import { PASOS } from '@/dominio/apertura/pasos';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { CrearSesion } from './acciones-sesion';

export const metadata: Metadata = { title: 'Apertura' };

const ESTADO: Record<string, { texto: string; tono: 'ok' | 'atencion' | 'malo' | 'neutro' }> = {
  borrador: { texto: 'Borrador', tono: 'atencion' }, en_firma: { texto: 'En firma', tono: 'atencion' }, firmada: { texto: 'Firmada y publicada', tono: 'ok' }, reversada: { texto: 'Revertida', tono: 'neutro' },
};

export default async function Pagina() {
  const e = await (await aperturaDeSocio()).estado(null);
  const s = e.sesion && e.sesion.estado !== 'reversada' ? e.sesion : null;
  const v = s ? e.validacion : null;
  const hoy = fechaNeg(new Date());
  return (
    <>
      <EncabezadoPagina
        eyebrow="Apertura · saldos iniciales"
        antes="Carga los saldos de"
        enfasis="apertura"
        contexto="Una sola sesión con fecha de corte, diez pasos guiados y la firma de los dos socios. La diferencia contra la identidad contable se queda en la cuenta puente 3990. Aquí no hay datos reales hasta que el dueño los capture."
        acciones={s === null ? <CrearSesion hoy={hoy} /> : undefined}
      />
      {s === null ? (
        <section className="rtm-seccion" aria-label="Sin sesión vigente">
          <h2>Sin sesión vigente</h2>
          <p className="rtm-nota" data-testid="apertura-vacia">
            {e.historial.length === 0 ? 'Todavía no se ha abierto ninguna sesión de apertura.' : 'La última sesión fue revertida; puedes abrir otra.'}
          </p>
        </section>
      ) : (
        <>
          <p className="rtm-nota" data-testid="apertura-estado">
            <EstadoTexto tono={ESTADO[s.estado]!.tono}>{ESTADO[s.estado]!.texto}</EstadoTexto> · corte al {etiquetaFecha(s.fecha_corte)}
            {s.firmada_at && <> · firmada el {etiquetaFechaHora(s.firmada_at)}</>}
            {e.firmas.length > 0 && <> · firmas: {e.firmas.map((f) => f.socio).join(' y ')}</>}
          </p>
          {v && (
            <section className="rtm-seccion" aria-label="Identidad contable">
              <h2>Identidad contable</h2>
              <div className="rtm-identidad" data-testid="identidad">
                <div className="rtm-kpi"><span>Activo</span><strong data-testid="id-activo">{formatearMoneda(v.activo_cent)}</strong></div>
                <div className="rtm-kpi"><span>Pasivo</span><strong data-testid="id-pasivo">{formatearMoneda(v.pasivo_cent)}</strong></div>
                <div className="rtm-kpi"><span>Capital</span><strong data-testid="id-capital">{formatearMoneda(v.capital_cent)}</strong></div>
                <div className="rtm-kpi"><span>Diferencia en la cuenta 3990</span><strong data-testid="id-puente">{formatearMoneda(v.puente_cent)}</strong></div>
              </div>
              {v.alertas.length > 0 && <ul data-testid="alertas">{v.alertas.map((a) => <li key={a}>{a}</li>)}</ul>}
            </section>
          )}
        </>
      )}
      <section className="rtm-seccion" aria-label="Pasos">
        <h2>Los diez pasos</h2>
        <ol className="rtm-pasos" data-testid="lista-pasos">
          {PASOS.map((p) => {
            const dato = v?.pasos.find((x) => x.paso === p.n);
            return (
              <li key={p.n}>
                <span className="rtm-paso-n">{p.n}</span>
                <div>
                  <Link href={`/apertura/paso/${p.n}`}>{p.titulo}</Link>
                  <p>{p.texto}</p>
                </div>
                <span>{dato ? (dato.estado === 'con_datos' ? <EstadoTexto tono="ok">{dato.partidas} partidas · {formatearMoneda(dato.monto_cent)}</EstadoTexto> : <EstadoTexto>Sin partidas</EstadoTexto>) : ''}</span>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="rtm-seccion" aria-label="Historial">
        <h2>Sesiones</h2>
        <DataTable
          etiqueta="Historial de sesiones de apertura"
          clave={(h) => h.id}
          filas={e.historial}
          vacio={{ titulo: 'Sin sesiones', texto: 'Cuando abras la primera aparecerá aquí con su estado.' }}
          columnas={[
            { id: 'f', titulo: 'Corte', celda: (h) => etiquetaFecha(h.fecha_corte) },
            { id: 'e', titulo: 'Estado', celda: (h) => <EstadoTexto tono={ESTADO[h.estado]!.tono}>{ESTADO[h.estado]!.texto}</EstadoTexto> },
            { id: 'm', titulo: 'Motivo de la reversa', secundaria: true, celda: (h) => h.motivo_reversa ?? '' },
          ]}
        />
      </section>
    </>
  );
}
