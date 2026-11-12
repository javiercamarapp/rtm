import type { Metadata } from 'next';
import Link from 'next/link';
import { datosDeSocio } from '@/composicion/datos';
import type { EstadoLibro } from '@/dominio/datos/tipos';
import { ChipEstado } from '@/ui/componentes/controles';
import { Paginador } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AreaSerie, ColumnasPeriodo } from '@/ui/graficas';
import { Campo, FiltrosUrl } from '../../_a2/filtros-url';
import { enlace, enteroParam, fecha, fechaParam, m, mesEtiqueta, textoParam, uno, type Params } from '../../_a2/util';

export const metadata: Metadata = { title: 'Libro de ingresos y egresos' };
const PASO = 200;
const ESTADOS: Record<EstadoLibro, { palabra: string; tono: 'atencion' | 'info' | 'ok' }> = { sin_clasificar: { palabra: 'Sin clasificar', tono: 'atencion' }, clasificado: { palabra: 'Clasificado', tono: 'info' }, conciliado: { palabra: 'Conciliado', tono: 'ok' } };
const CATEGORIA: Record<string, string> = { cobro_cliente: 'Cobro de cliente', pago_proveedor: 'Pago a proveedor', aportacion: 'Aportación', retiro: 'Retiro', gasto: 'Gasto', fondos_en_poder_socio: 'Fondos en poder de un socio', transferencia_entre_socios: 'Transferencia entre socios', otro: 'Otro' };
const pesosACent = (v: string | string[] | undefined): bigint | null => { const t = uno(v)?.replace(/[,\s]/g, ''); return t && /^\d+(\.\d{1,2})?$/.test(t) ? BigInt(Math.round(Number(t) * 100)) : null; };

export default async function Pagina_({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const estado = (['sin_clasificar', 'clasificado', 'conciliado'] as const).find((e) => e === uno(sp.estado)) ?? null;
  const orden = uno(sp.orden) === 'desc' ? 'desc' : 'asc';
  const pagina = Math.max(0, (enteroParam(sp.pag) ?? 1) - 1);
  const filtro = { ini: fechaParam(sp.ini), fin: fechaParam(sp.fin), estado, q: textoParam(sp.q), minCent: pesosACent(sp.min), maxCent: pesosACent(sp.max), cuenta: textoParam(sp.cuenta), limite: PASO, desplazamiento: pagina * PASO, orden } as const;
  const datos = await datosDeSocio();
  const l = await datos.libro(filtro);
  const t = l.totales;
  const sd = l.total === 0 && !filtro.ini && !filtro.fin && !filtro.estado && !filtro.q && l.excluidos === 0;
  const paginas = Math.max(1, Math.ceil(l.total / PASO));
  const base = '/movimientos/libro';
  const nSin = l.estados.find((e) => e.estado === 'sin_clasificar')?.n ?? 0;
  const nCla = l.estados.find((e) => e.estado === 'clasificado')?.n ?? 0;
  const meses = l.meses;
  const mesDe = new Map(meses.map((x) => [x.mes.slice(0, 7), x]));
  const exportar = new URLSearchParams(Object.entries({ ini: filtro.ini, fin: filtro.fin, estado, q: filtro.q, min: uno(sp.min), max: uno(sp.max), cuenta: filtro.cuenta, orden }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
  const pie = 'Fuente: libro de movimientos (sin duplicados ni descartados)';
  const neg = (c: bigint) => <span className={c < 0n ? 'rtm-a2-num-neg' : undefined}>{m(c)}</span>;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Movimientos · libro" titulo={sd ? 'Todavía no hay movimientos en el libro' : `${l.total} renglones, saldo de ${m(t.saldo_final_cent)}`} descripcion="Todos los ingresos y egresos en una sola tabla con saldo corrido, totales del filtro completo y paginación en servidor." acciones={<><Link className="rtm-boton" href="/movimientos">Bandeja</Link><a className="rtm-boton" href={`${base}/exportar${exportar.size ? `?${exportar}` : ''}`} data-testid="libro-exportar">Exportar CSV</a></>} />
      <FiltrosUrl etiquetaAria="Filtros del libro" restablecer={base}>
        <Campo etiqueta="Desde"><input type="date" name="ini" defaultValue={filtro.ini ?? ''} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" name="fin" defaultValue={filtro.fin ?? ''} /></Campo>
        <Campo etiqueta="Estado"><select name="estado" defaultValue={estado ?? ''}><option value="">Todos</option>{(Object.keys(ESTADOS) as EstadoLibro[]).map((e) => <option key={e} value={e}>{ESTADOS[e].palabra}</option>)}</select></Campo>
        <Campo etiqueta="Cuenta"><select name="cuenta" defaultValue={filtro.cuenta ?? ''}><option value="">Todas</option>{l.cuentas.map((c) => <option key={c} value={c}>{c}</option>)}</select></Campo>
        <Campo etiqueta="Monto mínimo"><input type="number" name="min" min="0" step="0.01" defaultValue={uno(sp.min) ?? ''} data-noauto="" /></Campo>
        <Campo etiqueta="Monto máximo"><input type="number" name="max" min="0" step="0.01" defaultValue={uno(sp.max) ?? ''} data-noauto="" /></Campo>
        <Campo etiqueta="Buscar concepto"><input type="search" name="q" placeholder="Texto del concepto" defaultValue={filtro.q ?? ''} data-noauto="" /></Campo>
        {orden === 'desc' && <input type="hidden" name="orden" value="desc" />}
      </FiltrosUrl>
      <KpiLinea etiquetaAria="Resumen del libro" celdas={[
        { id: 'c', etiqueta: 'Cargos (+)', valor: sd ? null : m(t.cargos_cent), categoria: 2, nota: 'Dinero que entró' },
        { id: 'a', etiqueta: 'Abonos (−)', valor: sd ? null : m(t.abonos_cent), categoria: 3, nota: 'Dinero que salió' },
        { id: 'n', etiqueta: 'Neto del filtro', valor: sd ? null : m(t.neto_cent), categoria: 4, nota: 'Cargos menos abonos' },
        { id: 's', etiqueta: 'Saldo final', valor: sd ? null : m(t.saldo_final_cent), categoria: 1, nota: filtro.ini ? `Inicial ${m(t.saldo_inicial_cent)}` : 'Desde el primer renglón', testid: 'libro-saldo' },
        { id: 'sc', etiqueta: 'Sin clasificar', valor: sd ? null : String(nSin), categoria: 5, href: '/movimientos', nota: 'Por revisar' },
        { id: 'sk', etiqueta: 'Sin conciliar', valor: sd ? null : String(nSin + nCla), categoria: 6, nota: 'Sin clasificar y clasificados' },
      ]} />
      {meses.length >= 2 && (
        <Rejilla dividir="4-4-4">
          <Tarjeta><ColumnasPeriodo titulo="Cargos por mes" descripcion={`Cargos del libro en ${meses.length} meses.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140} datos={meses.map((x) => ({ id: x.mes, etiqueta: mesEtiqueta(x.mes), valor: Number(x.cargos_cent) / 100, texto: m(x.cargos_cent) ?? '' }))} /></Tarjeta>
          <Tarjeta><ColumnasPeriodo titulo="Abonos por mes" descripcion={`Abonos del libro en ${meses.length} meses.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140} datos={meses.map((x) => ({ id: x.mes, etiqueta: mesEtiqueta(x.mes), valor: Number(x.abonos_cent) / 100, texto: m(x.abonos_cent) ?? '' }))} /></Tarjeta>
          <Tarjeta>{meses.every((x) => x.saldo_cent >= 0n) ? <AreaSerie titulo="Saldo al cierre de cada mes" descripcion={`Saldo del libro al cierre de ${meses.length} meses.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140} puntos={meses.map((x) => ({ id: x.mes, etiqueta: mesEtiqueta(x.mes), valor: Number(x.saldo_cent) / 100, texto: m(x.saldo_cent) ?? '' }))} /> : <p className="rtm-a2-nota">Hay meses con saldo negativo: la tabla trae los números.</p>}</Tarjeta>
        </Rejilla>
      )}
      <Tarjeta plana className="rtm-a2-tabla" titulo="Libro" descripcion={`${l.total} renglones del filtro · ${orden === 'asc' ? 'cronológico' : 'más reciente primero'}`}>
        <DataTable
          etiqueta="Libro de ingresos y egresos con saldo corrido" clave={(x) => x.id} filas={l.movimientos} densidad="libro" pegajosa primeraFija plana
          vacio={{ titulo: sd ? 'Sin movimientos en el libro' : 'Ningún renglón cumple el filtro', texto: sd ? 'Pega o sube movimientos en «Pegar o subir».' : 'Quita algún filtro o amplía el rango de fechas.', accion: sd ? <Link className="rtm-boton" href="/movimientos/importar">Pegar o subir</Link> : undefined }}
          columnas={[
            { id: 'f', titulo: 'Fecha', ancho: 's', celda: (x) => fecha(x.fecha_neg) },
            { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (x) => (x.concepto ? <span className="rtm-a2-mono-mensaje" title={x.concepto}>{x.concepto}</span> : <SinDato />) },
            { id: 'k', titulo: 'Categoría', ancho: 'm', secundaria: true, celda: (x) => (x.categoria ? CATEGORIA[x.categoria] ?? x.categoria : <SinDato />) },
            { id: 'cu', titulo: 'Cuenta', ancho: 'l', secundaria: true, celda: (x) => x.cuenta ?? <SinDato /> },
            { id: 'ct', titulo: 'Contraparte', ancho: 'm', secundaria: true, celda: (x) => x.contraparte ?? <SinDato /> },
            { id: 'fo', titulo: 'Folio', ancho: 's', secundaria: true, celda: (x) => (x.folio ? <span className="rtm-mono">{x.folio}</span> : '') },
            { id: 'ca', titulo: '(+) Cargos', numerica: true, ancho: 'm', celda: (x) => (x.cargo_cent === null ? '' : m(x.cargo_cent)) },
            { id: 'ab', titulo: '(−) Abonos', numerica: true, ancho: 'm', celda: (x) => (x.abono_cent === null ? '' : m(x.abono_cent)) },
            { id: 'sa', titulo: '(=) Saldo', numerica: true, ancho: 'l', celda: (x) => neg(x.saldo_cent) },
            { id: 'e', titulo: 'Estado', ancho: 'm', celda: (x) => <ChipEstado tono={ESTADOS[x.estado].tono}>{ESTADOS[x.estado].palabra}</ChipEstado> },
            { id: 'o', titulo: 'Origen', ancho: 'm', secundaria: true, celda: (x) => x.origen ?? '' },
          ]}
          agrupar={{ clave: (x) => x.fecha_neg.slice(0, 7), cabecera: (k) => { const mes = mesDe.get(k); return { titulo: mesEtiqueta(`${k}-01`), subtotales: { c: `${mes?.n ?? 0} renglones`, ca: mes ? m(mes.cargos_cent) : null, ab: mes ? m(mes.abonos_cent) : null, sa: mes ? neg(mes.saldo_cent) : null } }; } }}
          totales={{ etiqueta: `Totales del filtro (${t.n})`, celdas: { ca: m(t.cargos_cent), ab: m(t.abonos_cent), sa: neg(t.saldo_final_cent) } }}
        />
        <div className="rtm-a2-pie-tabla">
          <Paginador mostrados={l.movimientos.length} total={l.total} anterior={pagina > 0 ? enlace(base, sp, { pag: pagina === 1 ? null : pagina }) : undefined} siguiente={pagina + 1 < paginas ? enlace(base, sp, { pag: pagina + 2 }) : undefined} />
          <span>Página {pagina + 1} de {paginas} · {PASO} renglones por página · totales del filtro completo · <Link href={enlace(base, sp, { orden: orden === 'asc' ? 'desc' : null, pag: null })}>{orden === 'asc' ? 'Ver lo más reciente primero' : 'Ver en orden cronológico'}</Link></span>
        </div>
      </Tarjeta>
      <p className="rtm-a2-nota">El saldo corrido suma toda la historia vigente hasta cada renglón, aunque un filtro esconda renglones; los {l.excluidos} duplicados o descartados no entran al saldo. La categoría sale de la clasificación del renglón: sin clasificar dice «Sin dato», no se adivina del texto. Para clasificar o conciliar un renglón usa la <Link href="/movimientos">bandeja</Link>.</p>
    </Pagina>
  );
}
