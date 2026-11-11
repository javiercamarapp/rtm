import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { fechaNeg } from '@/dominio/calendario';
import { esFecha } from '@/dominio/contabilidad/rangos';
import type { RenglonBalance } from '@/dominio/contabilidad/tipos';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Balance general' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ hasta?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const hasta = esFecha(q.hasta) ? q.hasta : hoy;
  const b = await (await contabilidadDeSocio()).balance(hasta);
  const seccion = (titulo: string, filas: RenglonBalance[], total: bigint, prueba: string) => (
    <section className="rtm-seccion rtm-entra rtm-i-2" aria-label={titulo} data-testid={prueba}>
      <h2>{titulo}</h2>
      <DataTable
        etiqueta={titulo}
        clave={(f) => f.codigo}
        filas={filas}
        vacio={{ titulo: 'Sin saldos', texto: 'Ninguna cuenta de esta sección tiene saldo todavía.' }}
        columnas={[
          { id: 'n', titulo: 'Cuenta', celda: (f) => <><span className="rtm-mono">{f.codigo}</span> {f.nombre}</> },
          { id: 'm', titulo: 'Importe', numerica: true, celda: (f) => (/^\d{4}$/.test(f.codigo) ? <CifraComprobada texto={formatearMoneda(f.monto_cent)} cifra={`conta:saldo:${f.codigo}:${hasta}`} comprobacion="cuadra" /> : formatearMoneda(f.monto_cent)) },
        ]}
      />
      <p className="rtm-nota"><strong>Total {titulo.toLowerCase()}: {formatearMoneda(total)}</strong></p>
    </section>
  );
  return (
    <>
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow={`Contabilidad · balance general al ${etiquetaFecha(hasta)}`}
        antes="Activo igual a pasivo más capital:"
        enfasis={b.con_movimientos ? (b.cuadra ? 'cuadra' : 'no cuadra') : 'sin dato'}
        contexto="Inventario a costo. Los saldos a favor con un proveedor se presentan en el activo, cada proveedor por separado. Capital contable: aportaciones, retiros, utilidades por distribuir y resultado."
      />
      {!b.con_movimientos ? (
        <DataTable etiqueta="Balance general" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin dato', texto: 'Aún no hay asientos al corte elegido. El balance aparecerá con el primer movimiento.' }} />
      ) : (
        <>
          {seccion('Activo', b.activo, b.total_activo_cent, 'balance-activo')}
          {seccion('Pasivo', b.pasivo, b.total_pasivo_cent, 'balance-pasivo')}
          {seccion('Capital', b.capital, b.total_capital_cent, 'balance-capital')}
          <p className="rtm-nota" data-testid="balance-comprobacion">
            <EstadoTexto tono={b.cuadra ? 'ok' : 'malo'}>{b.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto>{' '}
            Activo {formatearMoneda(b.total_activo_cent)} contra pasivo más capital {formatearMoneda(b.total_pasivo_cent + b.total_capital_cent)}. Diferencia {formatearMoneda(b.diferencia_cent)}.
          </p>
        </>
      )}
      {b.fuera_de_libros.length > 0 && (
        <section className="rtm-seccion" aria-label="Memorando fuera de libros">
          <h2>Memorando fuera de libros</h2>
          <DataTable
            etiqueta="Partidas fuera de la sociedad"
            clave={(p) => `${p.socio}-${p.concepto}`}
            filas={b.fuera_de_libros}
            columnas={[
              { id: 's', titulo: 'Socio', celda: (p) => p.socio },
              { id: 'c', titulo: 'Concepto', celda: (p) => p.concepto },
              { id: 'e', titulo: 'Estado', secundaria: true, celda: (p) => p.estado.replaceAll('_', ' ') },
              { id: 'm', titulo: 'Monto', numerica: true, celda: (p) => formatearMoneda(p.monto_cent) },
            ]}
          />
          <p className="rtm-nota">No forman parte del balance de la sociedad.</p>
        </section>
      )}
    </>
  );
}
