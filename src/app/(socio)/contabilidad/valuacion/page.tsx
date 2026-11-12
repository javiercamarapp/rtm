import type { Metadata } from 'next';
import Link from 'next/link';
import { datosDeSocio } from '@/composicion/datos';
import { Cascada } from '@/ui/graficas';
import { BarList, ListaClaveValor } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Campo, FiltrosUrl } from '../../_a2/filtros-url';
import { SubnavContabilidad } from '../subnav';
import { bpTexto, fechaParam, fecha, hoyNeg, m, partePct, pctTexto, type Params } from '../../_a2/util';

export const metadata: Metadata = { title: 'Valuación al detalle' };

interface Renglon { clave: string; grupo: string; concepto: string; detalle: string; importe: bigint }
const GRUPOS_ACTIVO: { id: string; titulo: string; cuentas: string[] }[] = [
  { id: 'fondos', titulo: 'Fondos de la sociedad', cuentas: ['1101', '1102', '1150', '1160'] },
  { id: 'socios', titulo: 'Por cobrar a socios (faltantes de recepción)', cuentas: ['1170', '1180'] },
  { id: 'omar', titulo: 'Cuenta Omar', cuentas: ['1220'] },
  { id: 'otros', titulo: 'Tránsito, puente y otros activos', cuentas: ['1290', '1320', '1330', '1340', '1410'] },
];
const GRUPOS_DEUDA: { id: string; titulo: string; cuentas: string[] }[] = [
  { id: 'prov', titulo: 'Proveedores', cuentas: ['2110', '2120', '2190'] },
  { id: 'socios', titulo: 'Socios (pagos por cuenta de la sociedad)', cuentas: ['2310', '2320'] },
  { id: 'acre', titulo: 'Omar y otros acreedores', cuentas: ['2210', '2220'] },
  { id: 'cli', titulo: 'Clientes (saldos a favor y depósitos)', cuentas: ['2410', '2420'] },
];

export default async function Pagina_({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const hasta = fechaParam(sp.hasta) ?? hoyNeg();
  const datos = await datosDeSocio();
  const [d, serie] = await Promise.all([datos.valuacionDetalle(hasta), datos.valuacionSerie(null, hasta, 'mes')]);
  const v = d.valuacion;
  const sd = !v.con_movimientos;
  const ctas = new Map(d.cuentas.map((c) => [c.codigo, c]));
  const saldo = (c: string) => ctas.get(c)?.saldo_cent ?? 0n;

  // Activo: inventario por marca, fondos, cuentas por cobrar por cliente, socios, Omar, otros y saldos a favor con proveedores (reclasificados como activo, igual que la valuacion).
  const activo: Renglon[] = [];
  const sumaMarcas = d.inventario_por_marca.reduce((a, x) => a + x.valor_cent, 0n);
  for (const x of d.inventario_por_marca) activo.push({ clave: `inv-${x.marca}`, grupo: 'Inventario a costo', concepto: x.marca, detalle: `${x.modelos} ${x.modelos === 1 ? 'modelo' : 'modelos'} · ${x.piezas} piezas`, importe: x.valor_cent });
  if (sumaMarcas !== saldo('1310')) activo.push({ clave: 'inv-dif', grupo: 'Inventario a costo', concepto: 'Diferencia contra la cuenta 1310', detalle: 'El libro contable y el kárdex no coinciden', importe: saldo('1310') - sumaMarcas });
  if (d.inventario_por_marca.length === 0 && saldo('1310') !== 0n) activo.push({ clave: 'inv-1310', grupo: 'Inventario a costo', concepto: 'Inventario en bodega (1310)', detalle: 'Sin detalle por marca', importe: saldo('1310') });
  for (const g of GRUPOS_ACTIVO) for (const c of g.cuentas) { const x = ctas.get(c); if (x && (x.saldo_cent !== 0n || (x.activa && g.id === 'fondos'))) activo.push({ clave: c, grupo: g.titulo, concepto: x.nombre, detalle: `Cuenta ${c}`, importe: x.saldo_cent }); }
  const sumaCli = d.clientes.reduce((a, x) => a + x.saldo_cent, 0n);
  for (const x of d.clientes) activo.push({ clave: `cli-${x.cliente_id}`, grupo: 'Cuentas por cobrar a clientes', concepto: x.cliente, detalle: x.ultimo ? `Último movimiento ${fecha(x.ultimo)}` : 'Cuenta 1210', importe: x.saldo_cent });
  if (sumaCli !== saldo('1210')) activo.push({ clave: 'cli-dif', grupo: 'Cuentas por cobrar a clientes', concepto: 'Sin cliente asignado (1210)', detalle: 'Diferencia contra la cuenta 1210', importe: saldo('1210') - sumaCli });
  for (const c of ['2110', '2120']) { const x = ctas.get(c); if (x && x.saldo_cent < 0n) activo.push({ clave: `fav-${c}`, grupo: 'Saldos a favor con proveedores', concepto: x.nombre, detalle: 'Saldo deudor reclasificado como activo', importe: -x.saldo_cent }); }
  const deudas: Renglon[] = [];
  for (const g of GRUPOS_DEUDA) for (const c of g.cuentas) { const x = ctas.get(c); if (x && x.saldo_cent > 0n) deudas.push({ clave: c, grupo: g.titulo, concepto: x.nombre, detalle: `Cuenta ${c}`, importe: x.saldo_cent }); }
  const totA = activo.reduce((a, x) => a + x.importe, 0n);
  const totD = deudas.reduce((a, x) => a + x.importe, 0n);
  const cuadraA = totA === v.v01_valuacion_cent;
  const cuadraD = totD === v.v02_deudas_cent;

  const filaAcum = (rows: Renglon[]) => (g: string) => rows.filter((x) => x.grupo === g).reduce((a, x) => a + x.importe, 0n);
  const col = (total: bigint) => [
    { id: 'c', titulo: 'Concepto', ancho: 'l' as const, truncar: 'm' as const, celda: (x: Renglon) => x.concepto },
    { id: 'd', titulo: 'Detalle', ancho: 'm' as const, truncar: 's' as const, secundaria: true, celda: (x: Renglon) => x.detalle },
    { id: 'i', titulo: 'Importe', numerica: true, ancho: 'm' as const, celda: (x: Renglon) => (sd ? <SinDato /> : m(x.importe)) },
    { id: 'p', titulo: '% del total', numerica: true, ancho: 's' as const, celda: (x: Renglon) => (sd ? <SinDato /> : pctTexto(partePct(x.importe, total)) ?? <SinDato />) },
  ];

  const ultimo = serie.filas[serie.filas.length - 1];
  const previo = serie.filas.length >= 2 ? serie.filas[serie.filas.length - 2] : null;
  const crec = ultimo?.crecimiento_bp ?? null;
  const gruposActivo = [...new Set(activo.map((x) => x.grupo))];
  const gruposDeuda = [...new Set(deudas.map((x) => x.grupo))];

  return (
    <>
    <SubnavContabilidad />
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow={`Contabilidad · valuación al ${fecha(hasta)}`} titulo={sd ? 'Todavía no hay valuación' : `Valuación de ${m(v.v01_valuacion_cent)}`} descripcion="Qué hay en cada renglón del activo y de las deudas, y cómo se llega a la utilidad. Cada total cuadra contra la valuación contable." acciones={<Link className="rtm-boton" href={`/contabilidad/valuacion/historial`}>Historial mensual</Link>} />
      <FiltrosUrl etiquetaAria="Fecha de corte" restablecer="/contabilidad/valuacion">
        <Campo etiqueta="Fecha de corte"><input type="date" name="hasta" defaultValue={hasta} max={hoyNeg()} /></Campo>
      </FiltrosUrl>
      <KpiLinea etiquetaAria="Valuación" celdas={[
        { id: 'v', etiqueta: 'Valuación', valor: sd ? null : m(v.v01_valuacion_cent), categoria: 1, nota: 'Activo a costo', testid: 'val-valuacion' },
        { id: 'd', etiqueta: 'Deudas', valor: sd ? null : m(v.v02_deudas_cent), categoria: 2, nota: 'Proveedores, socios y otros' },
        { id: 'f', etiqueta: 'Diferencia', valor: sd ? null : m(v.v03_diferencia_cent), categoria: 3, nota: 'Valuación menos deudas' },
        { id: 'u', etiqueta: 'Utilidad de la empresa', valor: sd ? null : m(v.v04_utilidad_empresa_cent), categoria: 4, nota: 'Diferencia menos capital y retenidas' },
        { id: 'k', etiqueta: 'Capital aportado neto', valor: sd ? null : m(v.v06_capital_aportado_cent), categoria: 5, nota: 'Aportaciones menos retiros' },
        { id: 'c', etiqueta: 'Crecimiento del mes', valor: bpTexto(crec), categoria: 6, nota: previo ? `Contra el corte del ${fecha(previo.corte)}` : 'Sin corte anterior' },
      ]} />

        <Tarjeta titulo="Comprobaciones" descripcion="Identidades de la valuación">
            <ListaClaveValor columnas={2} items={[
              { k: 'I-1 valuación menos deudas = capital por cuentas', v: <EstadoTexto tono={v.identidades.i1.cuadra ? 'ok' : 'malo'}>{v.identidades.i1.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto> },
              { k: 'I-2 utilidad = diferencia − capital − retenidas', v: <EstadoTexto tono={v.identidades.i2.cuadra ? 'ok' : 'malo'}>{v.identidades.i2.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto> },
              { k: 'Activo por renglones = valuación', v: <EstadoTexto tono={cuadraA ? 'ok' : 'malo'}>{cuadraA ? 'Cuadra' : 'No cuadra'}</EstadoTexto> },
              { k: 'Deudas por renglones = deudas', v: <EstadoTexto tono={cuadraD ? 'ok' : 'malo'}>{cuadraD ? 'Cuadra' : 'No cuadra'}</EstadoTexto> },
            ]} />
        </Tarjeta>
      <Rejilla dividir="6-6">
        <Tarjeta titulo="De la valuación a la utilidad" descripcion="Cascada hasta la utilidad">
          {sd ? <p className="rtm-a2-nota">Sin asientos: la cascada aparece con el primer movimiento.</p> : (
              <Cascada titulo="De la valuación a la utilidad" descripcion="Valuación menos deudas, menos capital aportado neto y utilidades retenidas igual a la utilidad de la empresa." unidad="Pesos" procedencia="observado" pie={`Corte: ${fecha(hasta)}`}
                pasos={[
                  { id: 'v', etiqueta: 'Valuación', valor: Number(v.v01_valuacion_cent), tipo: 'inicio', texto: m(v.v01_valuacion_cent) ?? '' },
                  { id: 'd', etiqueta: 'Deudas', valor: -Number(v.v02_deudas_cent), tipo: 'delta', texto: `−${m(v.v02_deudas_cent)}` },
                  { id: 'f', etiqueta: 'Diferencia', valor: Number(v.v03_diferencia_cent), tipo: 'total', texto: m(v.v03_diferencia_cent) ?? '' },
                  { id: 'k', etiqueta: 'Capital neto', valor: -Number(v.v06_capital_aportado_cent), tipo: 'delta', texto: `−${m(v.v06_capital_aportado_cent)}` },
                  { id: 'r', etiqueta: 'Retenidas', valor: -Number(v.v05_utilidades_retenidas_cent), tipo: 'delta', texto: `−${m(v.v05_utilidades_retenidas_cent)}` },
                  { id: 'u', etiqueta: 'Utilidad', valor: Number(v.v04_utilidad_empresa_cent), tipo: 'total', texto: m(v.v04_utilidad_empresa_cent) ?? '' },
                ]} />
            )}
          </Tarjeta>
        <Tarjeta plana className="rtm-a2-tabla" titulo="Deudas" descripcion="Lo que la sociedad debe al corte">
          <DataTable
            etiqueta="Deudas por renglón" clave={(x) => x.clave} filas={deudas} densidad="densa" plana primeraFija
            vacio={{ titulo: 'Sin deudas registradas', texto: 'Aparecen con la primera compra a proveedor o pago de un socio.' }}
            columnas={col(v.v02_deudas_cent)}
            agrupar={{ clave: (x) => x.grupo, cabecera: (g) => ({ titulo: g, subtotales: { i: sd ? <SinDato /> : m(filaAcum(deudas)(g)), p: sd ? <SinDato /> : pctTexto(partePct(filaAcum(deudas)(g), v.v02_deudas_cent)) ?? <SinDato /> } }) }}
            totales={{ etiqueta: 'Total de deudas', celdas: { i: sd ? <SinDato /> : m(totD), p: sd ? null : '100 %' } }}
          />
          <div className="rtm-a2-pie-tabla"><span>Comprobación: renglones {m(totD)} contra deudas {m(v.v02_deudas_cent)}</span><EstadoTexto tono={cuadraD ? 'ok' : 'malo'}>{cuadraD ? 'Cuadra' : 'No cuadra'}</EstadoTexto></div>
        </Tarjeta>
      </Rejilla>
      <Tarjeta titulo="Activo por grupo" descripcion="Parte de la valuación">
          <BarList columnas={2} etiquetaAria="Activo por grupo" items={gruposActivo.map((g) => ({ id: g, etiqueta: g, texto: m(filaAcum(activo)(g)) ?? '', pct: sd ? null : partePct(filaAcum(activo)(g), v.v01_valuacion_cent) }))} />
          {gruposDeuda.length > 0 && <BarList columnas={2} etiquetaAria="Deudas por grupo" items={gruposDeuda.map((g) => ({ id: g, etiqueta: g, texto: m(filaAcum(deudas)(g)) ?? '', pct: sd ? null : partePct(filaAcum(deudas)(g), v.v02_deudas_cent) }))} />}
      </Tarjeta>
      <Tarjeta plana className="rtm-a2-tabla" titulo="Activo a costo" descripcion="Cada renglón con su parte del total">
          <DataTable
            etiqueta="Activo a costo por renglón" clave={(x) => x.clave} filas={activo} densidad="densa" plana primeraFija
            vacio={{ titulo: 'Sin activo registrado', texto: 'Aparece con el primer asiento contable.' }}
            columnas={col(v.v01_valuacion_cent)}
            agrupar={{ clave: (x) => x.grupo, cerradosPorDefecto: false, cabecera: (g) => ({ titulo: g, subtotales: { i: sd ? <SinDato /> : m(filaAcum(activo)(g)), p: sd ? <SinDato /> : pctTexto(partePct(filaAcum(activo)(g), v.v01_valuacion_cent)) ?? <SinDato /> } }) }}
            totales={{ etiqueta: 'Total del activo', celdas: { i: sd ? <SinDato /> : m(totA), p: sd ? null : '100 %' } }}
          />
          <div className="rtm-a2-pie-tabla"><span>Comprobación: renglones {m(totA)} contra valuación {m(v.v01_valuacion_cent)}</span><EstadoTexto tono={cuadraA ? 'ok' : 'malo'}>{cuadraA ? 'Cuadra' : 'No cuadra'}</EstadoTexto></div>
      </Tarjeta>
      <p className="rtm-a2-nota">Las utilidades retenidas son capital, no deuda. El inventario sale al costo promedio del kárdex a la fecha de corte; los renglones de clientes salen del auxiliar de cuentas por cobrar. Un saldo deudor con un proveedor se muestra como activo (saldo a favor), igual que en la valuación contable. Con una sola definición de cuentas por cobrar y una sola utilidad: las diferencias con la hoja de Excel están en el informe de paridad.</p>
    </Pagina>
    </>
  );
}
