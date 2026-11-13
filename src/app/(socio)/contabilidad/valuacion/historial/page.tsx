import type { Metadata } from 'next';
import Link from 'next/link';
import { datosDeSocio } from '@/composicion/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AreaSerie } from '@/ui/graficas';
import { SubnavContabilidad } from '../../subnav';
import { valuacionDeSocios } from '@/composicion/valuacion-socios';
import { SerieValuacion } from '../../../socios/valuacion';
import { Campo, FiltrosUrl } from '../../../_a2/filtros-url';
import { bpTexto, fecha, fechaParam, hoyNeg, m, mesEtiqueta, semanaEtiqueta, textoParam, type Params } from '../../../_a2/util';

export const metadata: Metadata = { title: 'Historial de valuación' };

export default async function Pagina_({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const paso = textoParam(sp.paso) === 'semana' ? 'semana' : 'mes';
  const desde = fechaParam(sp.desde); const hasta = fechaParam(sp.hasta);
  const [s, vs] = await Promise.all([(await datosDeSocio()).valuacionSerie(desde, hasta, paso), valuacionDeSocios(hasta).catch(() => null)]);
  const filas = s.filas;
  const conDato = filas.filter((f) => f.con_movimientos);
  const sd = conDato.length === 0;
  const ult = filas[filas.length - 1];
  const crecimientos = filas.filter((f) => f.crecimiento_bp !== null);
  const mejor = [...crecimientos].sort((a, b) => b.crecimiento_bp! - a.crecimiento_bp!)[0] ?? null;
  const etiqueta = (f: string) => (paso === 'mes' ? mesEtiqueta(f) : semanaEtiqueta(f));
  const puntos = (campo: 'valuacion_cent' | 'diferencia_cent' | 'utilidad_cent') => filas.map((f) => ({ id: f.corte, etiqueta: etiqueta(f.corte), valor: Number(f[campo]) / 100, texto: m(f[campo]) ?? '', parcial: f.parcial }));
  const noNeg = (campo: 'valuacion_cent' | 'diferencia_cent' | 'utilidad_cent') => filas.every((f) => f[campo] >= 0n);
  const pie = `Cortes ${paso === 'mes' ? 'mensuales' : 'semanales'} del ${fecha(s.desde)} al ${fecha(s.hasta)} · Fuente: libro contable`;
  const neg = (c: bigint | null) => (c === null ? <SinDato /> : <span className={c < 0n ? 'rtm-a2-num-neg' : undefined}>{m(c)}</span>);
  return (
    <>
    <SubnavContabilidad />
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Contabilidad · historial de valuación" titulo={sd ? 'Todavía no hay historial de valuación' : `${filas.length} cortes ${paso === 'mes' ? 'mensuales' : 'semanales'}`} descripcion="Valuación al cierre de cada periodo, su cambio, el crecimiento y la utilidad. Cada corte usa la misma función que la valuación." acciones={<Link className="rtm-boton" href="/contabilidad/valuacion">Valuación al detalle</Link>} />
      <FiltrosUrl etiquetaAria="Periodo del historial" restablecer="/contabilidad/valuacion/historial">
        <Campo etiqueta="Corte"><select name="paso" defaultValue={paso}><option value="mes">Mensual</option><option value="semana">Semanal</option></select></Campo>
        <Campo etiqueta="Desde"><input type="date" name="desde" defaultValue={desde ?? ''} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" name="hasta" defaultValue={hasta ?? ''} max={hoyNeg()} /></Campo>
      </FiltrosUrl>
      <KpiLinea etiquetaAria="Resumen del historial" celdas={[
        { id: 'v', etiqueta: 'Valuación actual', valor: sd || !ult ? null : m(ult.valuacion_cent), categoria: 1, nota: ult ? `Corte ${fecha(ult.corte)}` : undefined },
        { id: 'c', etiqueta: 'Cambio del último periodo', valor: ult?.cambio_cent == null ? null : m(ult.cambio_cent), categoria: 2, nota: bpTexto(ult?.crecimiento_bp) ?? 'Sin periodo anterior' },
        { id: 'u', etiqueta: 'Utilidad de la empresa', valor: sd || !ult ? null : m(ult.utilidad_cent), categoria: 3, nota: 'Acumulada al corte' },
        { id: 'm', etiqueta: 'Mejor crecimiento', valor: mejor ? bpTexto(mejor.crecimiento_bp) : null, categoria: 4, nota: mejor ? `Corte ${fecha(mejor.corte)}` : undefined },
      ]} />
      {vs && vs.cuenta.hay_movimientos && <div data-testid="valuacion-socios-serie"><SerieValuacion c={vs.cuenta} yo={vs.yo} /></div>}
      <Rejilla dividir="6-6">
        <Tarjeta>
          {filas.length >= 2 && noNeg('valuacion_cent') ? <AreaSerie titulo="Valuación por corte" descripcion={`Valuación al cierre de ${filas.length} cortes.`} unidad="Pesos" procedencia="observado" pie={pie} alto={150} puntos={puntos('valuacion_cent')} />
            : <p className="rtm-a2-nota">Con menos de dos cortes, o con valores negativos, no se dibuja la serie: la tabla trae todos los números.</p>}
        </Tarjeta>
        <Tarjeta>
          {filas.length >= 2 && noNeg('diferencia_cent') ? <AreaSerie titulo="Diferencia por corte" descripcion={`Valuación menos deudas al cierre de ${filas.length} cortes.`} unidad="Pesos" procedencia="observado" pie={pie} alto={150} puntos={puntos('diferencia_cent')} />
            : <p className="rtm-a2-nota">Con menos de dos cortes, o con valores negativos, no se dibuja la serie: la tabla trae todos los números.</p>}
        </Tarjeta>
      </Rejilla>
      <Tarjeta plana className="rtm-a2-tabla" titulo="Por corte" descripcion="Orden: más reciente primero">
        <DataTable
          etiqueta="Historial de valuación" clave={(f) => f.corte} filas={[...filas].reverse()} densidad="densa" pegajosa primeraFija plana
          vacio={{ titulo: 'Sin cortes', texto: 'El historial aparece con el primer asiento contable.' }}
          columnas={[
            { id: 'c', titulo: 'Corte', ancho: 'l', celda: (f) => <>{fecha(f.corte)}{f.parcial ? <span className="rtm-a2-nota"> · parcial</span> : null}</> },
            { id: 'i', titulo: 'Valuación inicial', numerica: true, ancho: 'l', celda: (f) => (f.con_movimientos ? (f.inicial_cent === null ? <SinDato /> : m(f.inicial_cent)) : <SinDato />) },
            { id: 'v', titulo: 'Valuación final', numerica: true, ancho: 'l', celda: (f) => (f.con_movimientos ? m(f.valuacion_cent) : <SinDato />) },
            { id: 'd', titulo: 'Cambio', numerica: true, ancho: 'm', celda: (f) => neg(f.cambio_cent) },
            { id: 'g', titulo: '% de crecimiento', numerica: true, ancho: 'm', celda: (f) => bpTexto(f.crecimiento_bp) ?? <SinDato /> },
            { id: 'u', titulo: 'Utilidad de la empresa', numerica: true, ancho: 'l', celda: (f) => (f.con_movimientos ? neg(f.utilidad_cent) : <SinDato />) },
            { id: 'de', titulo: 'Deudas', numerica: true, ancho: 'l', secundaria: true, celda: (f) => (f.con_movimientos ? m(f.deudas_cent) : <SinDato />) },
            { id: 'df', titulo: 'Diferencia', numerica: true, ancho: 'l', secundaria: true, celda: (f) => (f.con_movimientos ? neg(f.diferencia_cent) : <SinDato />) },
          ]}
        />
      </Tarjeta>
      <p className="rtm-a2-nota">Cada corte es la valuación contable a esa fecha; el crecimiento es la variación de la valuación contra el corte anterior y queda en «Sin dato» si el corte anterior no tiene valuación positiva. El último corte puede ser parcial (el periodo sigue en curso). La utilidad es la de la empresa acumulada: no se mezcla con valuaciones de otro concepto.</p>
    </Pagina>
    </>
  );
}
