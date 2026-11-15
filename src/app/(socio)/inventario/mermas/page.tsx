import { nombreVape, saborMayus } from '@/dominio/formato';
import type { Metadata } from 'next';
import Link from 'next/link';
import { datosDeSocio } from '@/composicion/datos';
import { BarList, Paginador } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ColumnasPeriodo } from '@/ui/graficas';
import { Campo, FiltrosUrl } from '../../_a2/filtros-url';
import { TIPO_MOV, enlace, enteroParam, fecha, m, mesEtiqueta, periodo, pz, type Params } from '../../_a2/util';

export const metadata: Metadata = { title: 'Mermas y diferencias' };
const PASO = 100;

export default async function Pagina_({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const per = periodo(sp, 90);
  const pagina = Math.max(0, (enteroParam(sp.pag) ?? 1) - 1);
  const r = await (await datosDeSocio()).mermas(per.ini, per.fin, PASO, pagina * PASO);
  const t = r.totales;
  const sd = t.n === 0;
  const maxMod = r.modelos.reduce((a, x) => (x.valor_cent > a ? x.valor_cent : a), 0n);
  const paginas = Math.max(1, Math.ceil(r.total / PASO));
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Inventario · mermas y diferencias" titulo={sd ? 'Sin mermas ni diferencias de conteo' : `${pz(t.merma_piezas + t.faltante_piezas)} piezas perdidas`} descripcion="Mermas y ajustes por conteo físico, por modelo y mes, con su valor a costo, motivo y autor." acciones={<Link className="rtm-boton" href="/inventario/conteo">Conteo físico</Link>} />
      <FiltrosUrl etiquetaAria="Periodo" restablecer="/inventario/mermas" plegable={{ etiqueta: 'Periodo' }}>
        <Campo etiqueta="Periodo"><select name="dias" defaultValue={String(per.dias ?? '90')}><option value="30">30 días</option><option value="90">90 días</option><option value="365">12 meses</option><option value="todo">Todo</option></select></Campo>
      </FiltrosUrl>
      <KpiLinea etiquetaAria="Resumen de mermas" celdas={[
        { id: 'm', etiqueta: 'Mermas', valor: sd ? null : pz(t.merma_piezas), nota: sd ? undefined : m(t.merma_valor_cent), categoria: 3 },
        { id: 'f', etiqueta: 'Faltantes de conteo', valor: sd ? null : pz(t.faltante_piezas), nota: sd ? undefined : m(t.faltante_valor_cent), categoria: 4 },
        { id: 's', etiqueta: 'Sobrantes de conteo', valor: sd ? null : pz(t.sobrante_piezas), nota: sd ? undefined : m(t.sobrante_valor_cent), categoria: 2 },
        { id: 'n', etiqueta: 'Movimientos', valor: sd ? null : String(t.n), categoria: 1, nota: 'Mermas y ajustes del periodo' },
      ]} />
      {!sd && (
        <Rejilla dividir="6-6">
          <Tarjeta>
            {r.meses.length >= 2 ? (
              <ColumnasPeriodo titulo="Piezas perdidas por mes" descripcion={`Mermas y ajustes en ${r.meses.length} meses.`} unidad="Piezas" procedencia="observado" pie="Fuente: libro de movimientos" alto={140}
                datos={r.meses.map((x) => ({ id: x.mes, etiqueta: mesEtiqueta(x.mes), valor: Math.max(0, x.merma_piezas + x.ajuste_piezas), texto: pz(x.merma_piezas + x.ajuste_piezas) ?? '', detalle: `Merma ${pz(x.merma_piezas)} · ajuste ${pz(x.ajuste_piezas)}` }))} />
            ) : r.meses[0] ? (
              <>
                <p className="rtm-a2-nota">Con un solo mes no se dibuja la serie. Este es el mes con movimiento:</p>
                <dl className="rtm-a1-sub">
                  <div><dt>Mes</dt><dd>{mesEtiqueta(r.meses[0].mes)}</dd></div>
                  <div><dt>Mermas</dt><dd>{pz(r.meses[0].merma_piezas)}</dd></div>
                  <div><dt>Ajustes de conteo</dt><dd>{pz(r.meses[0].ajuste_piezas)}</dd></div>
                  <div><dt>Total</dt><dd>{pz(r.meses[0].merma_piezas + r.meses[0].ajuste_piezas)}</dd></div>
                </dl>
              </>
            ) : <p className="rtm-a2-nota">Sin movimientos en el periodo.</p>}
          </Tarjeta>
          <Tarjeta titulo="Valor perdido por modelo" descripcion="A costo promedio">
            <BarList etiquetaAria="Valor perdido por modelo" items={r.modelos.slice(0, 8).map((x) => ({ id: String(x.modelo_id), etiqueta: nombreVape(x.modelo), texto: `${pz(x.piezas)} · ${m(x.valor_cent)}`, pct: maxMod > 0n ? Math.round((Number(x.valor_cent) / Number(maxMod)) * 100) : null }))} mostrarPct={false} />
          </Tarjeta>
        </Rejilla>
      )}
      <Tarjeta plana className="rtm-a2-tabla" titulo="Movimientos" descripcion="Orden: más reciente primero">
        <DataTable
          etiqueta="Mermas y diferencias de conteo" clave={(x) => x.id} filas={r.movimientos} densidad="libro" pegajosa primeraFija plana
          vacio={{ titulo: 'Sin mermas ni ajustes de conteo', texto: 'Aparecen cuando se registra una merma o se cierra un conteo con diferencias.' }}
          columnas={[
            { id: 'f', titulo: 'Fecha', ancho: 's', celda: (x) => fecha(x.fecha_neg) },
            { id: 't', titulo: 'Tipo', ancho: 'm', celda: (x) => TIPO_MOV[x.tipo] ?? x.tipo },
            { id: 'm', titulo: 'Modelo', ancho: 'l', celda: (x) => <Link href={`/inventario/kardex?modelo=${x.modelo_id}&tipo=${x.tipo}`}>{nombreVape(x.modelo)}</Link> },
            { id: 's', titulo: 'Sabor', ancho: 'm', celda: (x) => saborMayus(x.sabor) },
            { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (x) => pz(x.piezas) },
            { id: 'v', titulo: 'Valor', numerica: true, ancho: 'm', celda: (x) => m(x.valor_cent) },
            { id: 'mo', titulo: 'Motivo', ancho: 'l', secundaria: true, celda: (x) => x.motivo ?? '' },
            { id: 'a', titulo: 'Quién', ancho: 'm', secundaria: true, celda: (x) => x.autor ?? 'Sistema' },
            { id: 'e', titulo: 'Evento', ancho: 'm', secundaria: true, celda: (x) => <span className="rtm-mono">{x.evento}</span> },
          ]}
          totales={{ etiqueta: `Totales (${t.n})`, celdas: { p: pz(-(t.merma_piezas + t.faltante_piezas) + t.sobrante_piezas), v: m(-(t.merma_valor_cent + t.faltante_valor_cent) + t.sobrante_valor_cent) } }}
        />
        <div className="rtm-a2-pie-tabla">
          <Paginador mostrados={r.movimientos.length} total={r.total} anterior={pagina > 0 ? enlace('/inventario/mermas', sp, { pag: pagina === 1 ? null : pagina }) : undefined} siguiente={pagina + 1 < paginas ? enlace('/inventario/mermas', sp, { pag: pagina + 2 }) : undefined} />
          <span>Página {pagina + 1} de {paginas}</span>
        </div>
      </Tarjeta>
      <p className="rtm-a2-nota">La base registra solo dos tipos de pérdida: <strong>merma</strong> (incluye fallas y piezas dañadas) y <strong>ajuste de conteo</strong> (faltante si resta, sobrante si suma). No distingue «falla» de «pérdida»: no se inventa esa separación. El valor sale al costo promedio del modelo en la fecha.</p>
    </Pagina>
  );
}
