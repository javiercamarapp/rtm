import type { Metadata } from 'next';
import Link from 'next/link';
import { aperturaDeSocio } from '@/composicion/apertura';
import { PASOS } from '@/dominio/apertura/pasos';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda } from '@/dominio/formato';
import { Aviso, ChipEstado } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { CrearSesion } from './acciones-sesion';

export const metadata: Metadata = { title: 'Apertura' };

const ESTADO: Record<string, { texto: string; tono: 'ok' | 'atencion' | 'malo' | 'apagado' }> = {
  borrador: { texto: 'Borrador', tono: 'atencion' }, en_firma: { texto: 'En firma', tono: 'atencion' }, firmada: { texto: 'Firmada y publicada', tono: 'ok' }, reversada: { texto: 'Revertida', tono: 'apagado' },
};

export default async function PaginaApertura() {
  const e = await (await aperturaDeSocio()).estado(null);
  const s = e.sesion && e.sesion.estado !== 'reversada' ? e.sesion : null;
  const v = s ? e.validacion : null;
  const hoy = fechaNeg(new Date());
  const conDatos = v ? v.pasos.filter((x) => x.estado === 'con_datos').length : 0;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Apertura · saldos iniciales"
        titulo={s === null ? 'Carga los saldos de apertura' : `Apertura al corte del ${etiquetaFecha(s.fecha_corte)}`}
        descripcion="Una sola sesión con fecha de corte, diez pasos guiados y la firma de los dos socios." ayudaResumen="Cuenta puente" ayuda="La diferencia contra la identidad contable queda en la cuenta puente 3990."
        acciones={s === null ? <CrearSesion hoy={hoy} /> : undefined}
      />
      {s === null ? (
        <Tarjeta titulo="Sin sesión vigente" descripcion="Aquí no hay datos reales hasta que el dueño los capture">
          <p className="rtm-nota" data-testid="apertura-vacia">
            {e.historial.length === 0 ? 'Todavía no se ha abierto ninguna sesión de apertura.' : 'La última sesión fue revertida; puedes abrir otra.'}
          </p>
        </Tarjeta>
      ) : (
        <>
          <p className="rtm-nota" data-testid="apertura-estado">
            <ChipEstado tono={ESTADO[s.estado]!.tono}>{ESTADO[s.estado]!.texto}</ChipEstado> corte al {etiquetaFecha(s.fecha_corte)}
            {s.firmada_at && <> · firmada el {etiquetaFechaHora(s.firmada_at)}</>}
            {e.firmas.length > 0 && <> · firmas: {e.firmas.map((f) => f.socio).join(' y ')}</>}
          </p>
          {v && (
            <>
              <div data-testid="identidad">
                <KpiLinea
                  etiquetaAria="Identidad contable de la apertura"
                  celdas={[
                    { id: 'a', etiqueta: 'Activo', valor: <span data-testid="id-activo">{formatearMoneda(v.activo_cent)}</span>, categoria: 1, nota: 'Lo que la sociedad tiene' },
                    { id: 'p', etiqueta: 'Pasivo', valor: <span data-testid="id-pasivo">{formatearMoneda(v.pasivo_cent)}</span>, categoria: 3, nota: 'Lo que debe' },
                    { id: 'c', etiqueta: 'Capital', valor: <span data-testid="id-capital">{formatearMoneda(v.capital_cent)}</span>, categoria: 2, nota: 'Aportado por los socios' },
                    { id: 'u', etiqueta: 'Diferencia en la cuenta 3990', valor: <span data-testid="id-puente">{formatearMoneda(v.puente_cent)}</span>, categoria: 6, nota: v.puente_cent === 0n ? 'Cuadra' : 'Cuenta puente por explicar' },
                  ]}
                />
              </div>
              {v.alertas.length > 0 && (
                <div data-testid="alertas">
                  {v.alertas.map((a) => <Aviso key={a} tono="atencion">{a}</Aviso>)}
                </div>
              )}
            </>
          )}
        </>
      )}
      <Rejilla dividir="8-4" alinear="inicio">
        <Tarjeta titulo="Los diez pasos" descripcion={v ? `${conDatos} de 10 con partidas` : 'Cada paso carga un grupo de saldos'}>
          <ol className="rtm-pasos-lista" data-testid="lista-pasos">
            {PASOS.map((p) => {
              const dato = v?.pasos.find((x) => x.paso === p.n);
              return (
                <li key={p.n}>
                  <span className="rtm-pasos-lista-n">{p.n}</span>
                  <div className="rtm-pasos-lista-texto">
                    <Link href={`/apertura/paso/${p.n}`}>{p.titulo}</Link>
                    <small>{p.texto}</small>
                  </div>
                  <span className="rtm-pasos-lista-estado">{dato ? (dato.estado === 'con_datos' ? <ChipEstado tono="ok">{dato.partidas} partidas · {formatearMoneda(dato.monto_cent)}</ChipEstado> : <ChipEstado tono="apagado">Sin partidas</ChipEstado>) : ''}</span>
                </li>
              );
            })}
          </ol>
        </Tarjeta>
        <Tarjeta plana titulo="Sesiones" descripcion="Cada apertura queda con su estado">
          <DataTable
            etiqueta="Historial de sesiones de apertura"
            densidad="densa" plana
            clave={(h) => h.id}
            filas={e.historial}
            vacio={{ titulo: 'Sin sesiones', texto: 'Cuando abras la primera aparecerá aquí con su estado.' }}
            columnas={[
              { id: 'f', titulo: 'Corte', ancho: 'm', prioridadMovil: 'titulo', celda: (h) => etiquetaFecha(h.fecha_corte) },
              { id: 'e', titulo: 'Estado', ancho: 'm', prioridadMovil: 'principal', celda: (h) => <ChipEstado tono={ESTADO[h.estado]!.tono}>{ESTADO[h.estado]!.texto}</ChipEstado> },
              { id: 'm', titulo: 'Motivo de la reversa', ancho: 'l', truncar: 'm', prioridadMovil: 'detalle', celda: (h) => h.motivo_reversa ?? '' },
            ]}
          />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
