import type { Metadata } from 'next';
import Link from 'next/link';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { esFecha } from '@/dominio/contabilidad/rangos';
import { etiquetaFecha } from '@/dominio/formato';
import { BarraFiltros, Chip } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Estado, Pie, m, pct, suma } from '../../_a3/util';
import { SubnavContabilidad } from '../subnav';
import { BotonVerificar } from '../verificar';

export const metadata: Metadata = { title: 'Diario' };

export default async function PaginaDiario({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string; n?: string }> }) {
  const q = await searchParams;
  const ini = esFecha(q.ini) ? q.ini : null;
  const fin = esFecha(q.fin) ? q.fin : null;
  const limite = Math.min(Math.max(Number(q.n) || 20, 10), 200);
  const d = await (await contabilidadDeSocio()).diario(ini, fin, limite);
  const enlace = (n: number) => `/contabilidad/diario?n=${n}${ini ? `&ini=${ini}` : ''}${fin ? `&fin=${fin}` : ''}`;
  const lineas = d.asientos.flatMap((a) => a.lineas);
  const debe = suma(lineas.map((l) => l.debe_cent));
  const haber = suma(lineas.map((l) => l.haber_cent));
  const porOrigen = new Map<string, number>();
  for (const a of d.asientos) porOrigen.set(a.origen_tipo, (porOrigen.get(a.origen_tipo) ?? 0) + 1);
  const origenes = [...porOrigen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const reversas = d.asientos.filter((a) => a.reversa_de || a.reversado_por).length;
  const manuales = d.asientos.filter((a) => a.es_manual).length;

  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · diario"
        titulo="Cada evento deja su asiento"
        descripcion="Partida doble: el debe es igual al haber en cada asiento. Nada se edita; corregir es una reversa enlazada."
      />
      <BarraFiltros
        etiquetaAria="Filtros del diario"
        extras={
          <form action="/contabilidad/diario" method="get" className="a3-filtros-form" aria-label="Periodo del diario">
            <input className="rtm-campo" type="date" name="ini" defaultValue={ini ?? ''} aria-label="Desde" />
            <input className="rtm-campo" type="date" name="fin" defaultValue={fin ?? ''} aria-label="Hasta" />
            <input type="hidden" name="n" value={limite} />
            <button type="submit" className="rtm-boton">Filtrar</button>
          </form>
        }
      >
        {[20, 50, 100, 200].map((n) => <Chip key={n} href={enlace(n)} activo={limite === n}>{n} asientos</Chip>)}
      </BarraFiltros>

      <KpiLinea
        etiquetaAria="Indicadores del diario"
        celdas={[
          { id: 'total', etiqueta: 'Asientos en el periodo', valor: String(d.total), categoria: 1, ayuda: 'Se muestran los asientos más recientes; el total del libro no cambia.', nota: <span data-testid="diario-total">{d.total === 0 ? 'Sin asientos todavía.' : `Últimos ${d.asientos.length}${ini || fin ? ' del periodo' : ''}`}</span> },
          { id: 'debe', etiqueta: 'Debe mostrado', valor: d.total === 0 ? null : m(debe), categoria: 2, nota: `${lineas.length} líneas` },
          { id: 'haber', etiqueta: 'Haber mostrado', valor: d.total === 0 ? null : m(haber), categoria: 6, nota: d.total === 0 ? undefined : <Estado tono={debe === haber ? 'ok' : 'malo'}>{debe === haber ? 'Cuadra con el debe' : 'No cuadra'}</Estado> },
          { id: 'rev', etiqueta: 'Reversas', valor: d.total === 0 ? null : String(reversas), categoria: 4, nota: `${manuales} asientos manuales` },
        ]}
      />
      <FilaRatios etiqueta="Alcance" items={[{ etiqueta: 'Mostrados / total', valor: d.total === 0 ? null : `${d.asientos.length} / ${d.total}` }, { etiqueta: 'Periodo', valor: ini || fin ? `${ini ? etiquetaFecha(ini) : 'inicio'} a ${fin ? etiquetaFecha(fin) : 'hoy'}` : 'Todo el libro' }]} />

      {d.asientos.length === 0 ? (
        <DataTable etiqueta="Asientos del diario" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin asientos', texto: 'Cada compra, pedido enviado, pago, gasto o toma de Omar generará su asiento en el momento de guardarse.' }} />
      ) : (
        <Rejilla dividir="8-4" alinear="inicio">
          <div className="a3-pila">
            {d.asientos.map((a) => (
              <div key={a.id} data-testid={`asiento-${a.folio}`}>
                <Tarjeta
                  plana
                  titulo={`${a.folio} · ${a.descripcion}`}
                  descripcion={`${etiquetaFecha(a.fecha_neg)}${a.fecha_contable !== a.fecha_neg ? ` · contable ${etiquetaFecha(a.fecha_contable)}` : ''}${a.periodo_afectado ? ` · ajuste del periodo ${etiquetaFecha(a.periodo_afectado)}` : ''} · ${a.autor ?? a.canal} · evento ${a.evento}${a.mensaje_origen ? ` · «${a.mensaje_origen}»` : ''}${a.reversa_de ? ` · reversa de ${a.reversa_de}` : ''}${a.reversado_por ? ` · reversado por ${a.reversado_por}` : ''}`}
                  acciones={<><Estado tono="ok">Total {m(a.total_cent)}</Estado><BotonVerificar asiento={a.id} /></>}
                >
                  <div className="a3-diario-lineas">
                  <DataTable
                    etiqueta={`Líneas del asiento ${a.folio}`}
                    densidad="libro" plana
                    clave={(l) => l.n}
                    filas={a.lineas}
                    totales={{ etiqueta: 'Suma', celdas: { d: m(suma(a.lineas.map((l) => l.debe_cent))), h: m(suma(a.lineas.map((l) => l.haber_cent))) } }}
                    columnas={[
                      { id: 'c', titulo: 'Cuenta', prioridadMovil: 'titulo', ancho: 'xl', celda: (l) => <><span className="rtm-mono">{l.cuenta}</span> {l.nombre}</> },
                      { id: 't', titulo: 'Tercero', prioridadMovil: 'normal', ancho: 'l', secundaria: true, celda: (l) => l.cliente ?? l.proveedor ?? l.socio ?? '' },
                      { id: 'd', titulo: 'Debe', prioridadMovil: 'principal', numerica: true, ancho: 'm', celda: (l) => (l.debe_cent > 0n ? m(l.debe_cent) : '') },
                      { id: 'h', titulo: 'Haber', prioridadMovil: 'normal', numerica: true, ancho: 'm', celda: (l) => (l.haber_cent > 0n ? m(l.haber_cent) : '') },
                    ]}
                  />
                  </div>
                  <div className="a3-pie-tarjeta"><p className="a3-pie rtm-mono" aria-label="Huella del asiento">hash {a.hash.slice(0, 16)}…</p></div>
                </Tarjeta>
              </div>
            ))}
            {d.total > d.asientos.length && <p className="a3-pie"><Link href={enlace(Math.min(limite < 50 ? 50 : limite * 2, 200))}>Mostrar más asientos</Link></p>}
          </div>
          <Tarjeta titulo="Qué origina los asientos" descripcion="Cuenta de los asientos mostrados por origen">
            <BarList etiquetaAria="Asientos por origen" items={origenes.map(([k, n]) => ({ id: k, etiqueta: k.replaceAll('_', ' '), texto: String(n), pct: pct(BigInt(n), BigInt(d.asientos.length)) }))} />
            <Pie>Cada asiento muestra quién lo originó, desde qué canal y con qué mensaje.</Pie>
          </Tarjeta>
        </Rejilla>
      )}
    </Pagina>
  );
}
