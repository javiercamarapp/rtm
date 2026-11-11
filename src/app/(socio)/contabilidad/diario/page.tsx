import type { Metadata } from 'next';
import Link from 'next/link';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { esFecha } from '@/dominio/contabilidad/rangos';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SubnavContabilidad } from '../subnav';
import { BotonVerificar } from '../verificar';

export const metadata: Metadata = { title: 'Diario' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string; n?: string }> }) {
  const q = await searchParams;
  const ini = esFecha(q.ini) ? q.ini : null;
  const fin = esFecha(q.fin) ? q.fin : null;
  const limite = Math.min(Math.max(Number(q.n) || 40, 10), 200);
  const d = await (await contabilidadDeSocio()).diario(ini, fin, limite);
  return (
    <>
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · diario"
        antes="Cada evento deja su"
        enfasis="asiento"
        contexto="Partida doble: la suma del debe es igual a la del haber en cada asiento. Nada se edita; corregir es una reversa enlazada. Cada asiento muestra quién lo originó, desde qué canal y con qué mensaje."
      />
      <p className="rtm-nota" data-testid="diario-total">
        {d.total === 0 ? 'Sin asientos todavía.' : `${d.total} asientos${ini || fin ? ' en el periodo' : ''}; se muestran los ${d.asientos.length} más recientes.`}
        {d.total > d.asientos.length && <> <Link href={`/contabilidad/diario?n=${Math.min(limite * 2, 200)}${ini ? `&ini=${ini}` : ''}${fin ? `&fin=${fin}` : ''}`}>Mostrar más</Link></>}
      </p>
      {d.asientos.length === 0 && (
        <DataTable etiqueta="Asientos del diario" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin asientos', texto: 'Cada compra, pedido enviado, pago, gasto o toma de Omar generará su asiento en el momento de guardarse.' }} />
      )}
      {d.asientos.map((a) => (
        <section key={a.id} className="rtm-seccion rtm-asiento" aria-label={`Asiento ${a.folio}`} data-testid={`asiento-${a.folio}`}>
          <h2>
            <span className="rtm-mono">{a.folio}</span> · {a.descripcion}
          </h2>
          <p className="rtm-nota">
            {etiquetaFecha(a.fecha_neg)}
            {a.fecha_contable !== a.fecha_neg && ` · contable ${etiquetaFecha(a.fecha_contable)}`}
            {a.periodo_afectado && ` · ajuste del periodo ${etiquetaFecha(a.periodo_afectado)}`}
            {` · ${a.autor ?? a.canal} · evento ${a.evento}`}
            {a.mensaje_origen && ` · «${a.mensaje_origen}»`}
            {a.reversa_de && ` · reversa de ${a.reversa_de}`}
            {a.reversado_por && ` · reversado por ${a.reversado_por}`}
          </p>
          <DataTable
            etiqueta={`Líneas del asiento ${a.folio}`}
            clave={(l) => l.n}
            filas={a.lineas}
            columnas={[
              { id: 'c', titulo: 'Cuenta', celda: (l) => <><span className="rtm-mono">{l.cuenta}</span> {l.nombre}</> },
              { id: 't', titulo: 'Tercero', secundaria: true, celda: (l) => l.cliente ?? l.proveedor ?? l.socio ?? '' },
              { id: 'd', titulo: 'Debe', numerica: true, celda: (l) => (l.debe_cent > 0n ? formatearMoneda(l.debe_cent) : '') },
              { id: 'h', titulo: 'Haber', numerica: true, celda: (l) => (l.haber_cent > 0n ? formatearMoneda(l.haber_cent) : '') },
            ]}
          />
          <div className="rtm-acciones-fila">
            <EstadoTexto tono="ok">Total {formatearMoneda(a.total_cent)}</EstadoTexto>
            <BotonVerificar asiento={a.id} />
          </div>
          <p className="rtm-nota rtm-mono" aria-label="Huella del asiento">hash {a.hash.slice(0, 16)}…</p>
        </section>
      ))}
    </>
  );
}
