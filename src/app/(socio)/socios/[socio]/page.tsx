import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSocio } from '@/composicion/acceso';
import { operacionDeSocio } from '@/composicion/operacion';
import { desglosarSocio } from '@/dominio/operacion/desglose_socio';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { BotonAccion } from '../../operacion/formulario-accion';
import { DesgloseSocio } from '../desglose';

export const metadata: Metadata = { title: 'Estado de cuenta del socio' };

export default async function Pagina({ params }: { params: Promise<{ socio: string }> }) {
  const { socio } = await params;
  if (socio !== 'Angelo' && socio !== 'Javier') notFound();
  const otro = socio === 'Angelo' ? 'Javier' : 'Angelo';
  const { perfil } = await exigirSocio();
  const lector = await operacionDeSocio();
  const [e, eOtro] = await Promise.all([lector.socioCuenta(socio), lector.socioCuenta(otro)]);
  const d = desglosarSocio(e);
  const suma = e.neto_cent + eOtro.neto_cent;
  const palabra = e.neto_cent > 0n ? 'La sociedad le debe' : e.neto_cent < 0n ? 'Debe a la sociedad' : 'En paz';

  return (
    <>
      <p className="rtm-migaja"><Link href="/socios">Cuenta de socios</Link> / {socio}</p>
      <EncabezadoPagina
        eyebrow={`Estado de cuenta · ${etiquetaHoy()}`}
        antes="Estado de cuenta de"
        enfasis={socio}
        contexto="Aportaciones, gastos pagados, reembolsos, retiros, fondos de la sociedad en su poder y utilidad asignada. Cada movimiento se puede explicar y deshacer."
      />
      <section className="rtm-bloque rtm-entra rtm-i-1" aria-label="Posición neta">
        <p className="rtm-nota">Posición neta con la sociedad</p>
        <p className="rtm-hero-cifra" data-testid="neto-socio"><CifraComprobada texto={formatearMoneda(e.neto_cent, { conSigno: true })} cifra={`socio:neto:${socio}`} comprobacion="cuadra" /></p>
        <p><EstadoTexto tono={e.neto_cent === 0n ? 'ok' : 'atencion'}>{palabra}</EstadoTexto></p>
        {e.dias_fondos !== null && <p className="rtm-nota">El dinero de la sociedad en su poder lleva {e.dias_fondos} días.</p>}
      </section>
      <nav className="rtm-barra-filtros" aria-label="Ver la cuenta de">
        {(['Angelo', 'Javier'] as const).map((n) => (
          <Link key={n} className="rtm-chip-filtro" href={`/socios/${n}`} aria-current={n === socio} data-testid={`ver-${n}`}>{n === perfil.socio_nombre ? `Mi cuenta (${n})` : `Cuenta de ${n}`}</Link>
        ))}
      </nav>
      <div className="rtm-entra rtm-i-2"><DesgloseSocio d={d} /></div>
      <p className="rtm-nota" data-testid="suma-cuentas">
        Suma de las posiciones de {socio} y {otro}: {formatearMoneda(suma, { conSigno: true })}. Es lo que la sociedad les debe a los dos y debe igualar sus activos netos.
        El gasto pagado por un socio se descuenta una sola vez de la utilidad; el reembolso solo liquida la deuda de la sociedad con él.
      </p>
      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Movimientos del socio">
        <h2>Movimientos</h2>
        <DataTable
          etiqueta={`Movimientos de ${socio}`}
          clave={(m) => `${m.tipo}-${m.id}`}
          filas={e.movimientos}
          vacio={{ titulo: 'Sin movimientos', texto: 'Todavía no hay aportaciones, gastos ni fondos a nombre de este socio.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', celda: (m) => etiquetaFecha(m.fecha_neg) },
            { id: 'c', titulo: 'Concepto', celda: (m) => <>{m.concepto}<span className="rtm-celda-sub">{m.tipo === 'aportacion' ? 'Aportación o gasto pagado' : m.tipo === 'libro' ? 'Cuenta con la sociedad' : m.tipo === 'apertura' ? 'Saldo de apertura firmado por los dos socios' : 'Dinero de la sociedad en su poder'}</span></> },
            { id: 'm', titulo: 'Efecto', numerica: true, celda: (m) => formatearMoneda(m.efecto_cent, { conSigno: true }) },
            { id: 's', titulo: 'Posición', numerica: true, secundaria: true, celda: (m) => formatearMoneda(m.saldo_cent, { conSigno: true }) },
            { id: 'q', titulo: 'Quién', secundaria: true, celda: (m) => <>{m.autor ?? m.canal}<br /><span className="rtm-nota rtm-mono">{m.evento}</span>{m.mensaje_origen && <><br /><span className="rtm-nota">{m.mensaje_origen}</span></>}</> },
            { id: 'x', titulo: '', celda: (m) => (m.deshacible && m.tipo !== 'deuda' ? <BotonAccion chico texto="Deshacer" accion="anular_movimiento_socio" args={{ p_tipo: m.tipo, p_id: m.id }} motivo="Motivo" titulo="Deshacer captura" /> : null) },
          ]}
        />
      </section>
    </>
  );
}
