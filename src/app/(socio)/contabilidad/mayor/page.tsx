import type { Metadata } from 'next';
import Link from 'next/link';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { fechaNeg } from '@/dominio/calendario';
import { esFecha } from '@/dominio/contabilidad/rangos';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Mayor' };

const NOMBRE_TIPO = { A: 'Activo', P: 'Pasivo', K: 'Capital', I: 'Ingresos', C: 'Costos', G: 'Gastos' } as const;

export default async function Pagina({ searchParams }: { searchParams: Promise<{ cuenta?: string; ini?: string; fin?: string }> }) {
  const q = await searchParams;
  const lector = await contabilidadDeSocio();
  const hoy = fechaNeg(new Date());
  const cuenta = q.cuenta && /^\d{4}$/.test(q.cuenta) ? q.cuenta : null;
  const ini = esFecha(q.ini) ? q.ini : null;
  const fin = esFecha(q.fin) ? q.fin : hoy;

  if (!cuenta) {
    const l = await lector.cuentas(hoy);
    return (
      <>
        <SubnavContabilidad />
        <EncabezadoPagina eyebrow="Contabilidad · mayor" antes="Cada cuenta con su" enfasis="saldo" contexto="Saldo en la naturaleza de cada cuenta. Abre una cuenta para ver sus movimientos uno por uno, con el asiento, el evento y el mensaje que los originó." />
        <DataTable
          etiqueta="Cuentas del mayor"
          clave={(c) => c.codigo}
          filas={l.cuentas}
          vacio={{ titulo: 'Sin cuentas', texto: 'El plan de cuentas aún no está cargado.' }}
          columnas={[
            { id: 'c', titulo: 'Cuenta', celda: (c) => <Link href={`/contabilidad/mayor?cuenta=${c.codigo}`} data-testid={`cuenta-${c.codigo}`}><span className="rtm-mono">{c.codigo}</span> {c.nombre}</Link> },
            { id: 't', titulo: 'Tipo', secundaria: true, celda: (c) => NOMBRE_TIPO[c.tipo] },
            { id: 'd', titulo: 'Debe', numerica: true, secundaria: true, celda: (c) => formatearMoneda(c.debe_cent) },
            { id: 'h', titulo: 'Haber', numerica: true, secundaria: true, celda: (c) => formatearMoneda(c.haber_cent) },
            { id: 's', titulo: 'Saldo', numerica: true, celda: (c) => <CifraComprobada texto={formatearMoneda(c.saldo_cent)} cifra={`conta:saldo:${c.codigo}`} comprobacion="cuadra" /> },
          ]}
        />
      </>
    );
  }

  const m = await lector.mayor(cuenta, ini, fin);
  return (
    <>
      <SubnavContabilidad />
      <p className="rtm-migaja"><Link href="/contabilidad/mayor">Mayor</Link> / {m.cuenta.codigo}</p>
      <EncabezadoPagina
        eyebrow={`Contabilidad · mayor · cuenta ${m.cuenta.codigo}`}
        antes={m.cuenta.nombre}
        enfasis={formatearMoneda(m.saldo_final_cent)}
        contexto={`${m.cuenta.naturaleza === 'D' ? 'Cuenta deudora' : 'Cuenta acreedora'}: ${m.cuenta.nota ?? 'sin nota'}. Saldo al ${etiquetaFecha(fin)}.`}
      />
      <p className="rtm-nota">Saldo inicial {formatearMoneda(m.saldo_inicial_cent)}. Saldo final <CifraComprobada texto={formatearMoneda(m.saldo_final_cent)} cifra={`conta:saldo:${m.cuenta.codigo}:${fin}`} comprobacion="cuadra" />.</p>
      <DataTable
        etiqueta={`Movimientos de la cuenta ${m.cuenta.codigo}`}
        clave={(x) => `${x.asiento_id}-${x.debe_cent}-${x.haber_cent}-${x.saldo_cent}`}
        filas={m.movimientos}
        vacio={{ titulo: 'Sin movimientos', texto: 'Esta cuenta no tiene movimientos en el periodo.' }}
        columnas={[
          { id: 'f', titulo: 'Fecha', celda: (x) => etiquetaFecha(x.fecha_contable) },
          { id: 'a', titulo: 'Asiento', celda: (x) => <><span className="rtm-mono">{x.folio}</span><br /><span className="rtm-nota">{x.descripcion}{x.nota ? `: ${x.nota}` : ''}</span></> },
          { id: 'd', titulo: 'Debe', numerica: true, celda: (x) => (x.debe_cent > 0n ? formatearMoneda(x.debe_cent) : '') },
          { id: 'h', titulo: 'Haber', numerica: true, celda: (x) => (x.haber_cent > 0n ? formatearMoneda(x.haber_cent) : '') },
          { id: 's', titulo: 'Saldo', numerica: true, celda: (x) => formatearMoneda(x.saldo_cent) },
          { id: 'q', titulo: 'Quién', secundaria: true, celda: (x) => <>{x.autor ?? x.canal}{x.mensaje_origen && <><br /><span className="rtm-nota">{x.mensaje_origen}</span></>}</> },
        ]}
      />
    </>
  );
}
