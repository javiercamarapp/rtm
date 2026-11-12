import type { Metadata } from 'next';
import { datosDeSocio } from '@/composicion/datos';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AreaSerie, ColumnasPeriodo } from '@/ui/graficas';
import { SubnavContabilidad } from '../subnav';
import { Campo, FiltrosUrl } from '../../_a2/filtros-url';
import { fecha, m, partePct, pctTexto, periodo, semanaEtiqueta, type Params } from '../../_a2/util';

export const metadata: Metadata = { title: 'Caja y liquidez' };

const TIPO = { efectivo: 'Efectivo', banco: 'Banco', socio: 'En poder de un socio' } as const;

export default async function Pagina_({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const per = periodo(sp, 90);
  const c = await (await datosDeSocio()).caja(per.ini, per.fin);
  const sd = !c.con_movimientos;
  const cuentas = c.cuentas.filter((x) => x.activa || x.saldo_cent !== 0n);
  const sumaSaldos = cuentas.reduce((a, x) => a + x.saldo_cent, 0n);
  const cuadra = c.l01_liquidez_cent !== null && sumaSaldos === c.l01_liquidez_cent;
  const efectivo = cuentas.filter((x) => x.tipo === 'efectivo').reduce((a, x) => a + x.saldo_cent, 0n);
  const banco = cuentas.filter((x) => x.tipo === 'banco').reduce((a, x) => a + x.saldo_cent, 0n);
  const socios = cuentas.filter((x) => x.tipo === 'socio').reduce((a, x) => a + x.saldo_cent, 0n);
  const neto = c.totales.entradas_cent - c.totales.salidas_cent;
  const pie = `Periodo ${fecha(c.ini)} al ${fecha(c.fin)} · Fuente: libro contable (cuentas de fondos)`;
  const dias = c.dias.map((d) => ({ id: d.fecha, etiqueta: fecha(d.fecha) ?? '', valor: Number(d.saldo_cent) / 100, texto: m(d.saldo_cent) ?? '' }));
  const semanas = c.semanas;
  return (
    <>
    <SubnavContabilidad />
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Contabilidad · caja y liquidez" titulo={sd ? 'Todavía no hay movimientos de caja' : `Liquidez de ${m(c.l01_liquidez_cent)}`} descripcion="Entradas y salidas de fondos, saldo por lugar o persona y liquidez después del pago semanal al proveedor." />
      <FiltrosUrl etiquetaAria="Periodo" restablecer="/contabilidad/caja">
        <Campo etiqueta="Periodo"><select name="dias" defaultValue={String(per.dias ?? '90')}><option value="30">30 días</option><option value="90">90 días</option><option value="180">180 días</option><option value="365">12 meses</option></select></Campo>
      </FiltrosUrl>
      <KpiLinea etiquetaAria="Resumen de caja" celdas={[
        { id: 'e', etiqueta: 'Entradas del periodo', valor: sd ? null : m(c.totales.entradas_cent), categoria: 2, nota: sd ? undefined : `${c.totales.n} movimientos de fondos` },
        { id: 's', etiqueta: 'Salidas del periodo', valor: sd ? null : m(c.totales.salidas_cent), categoria: 3, nota: sd ? undefined : 'Gastos y pagos' },
        { id: 'n', etiqueta: 'Neto del periodo', valor: sd ? null : m(neto), categoria: 4, nota: 'Entradas menos salidas' },
        { id: 'l', etiqueta: 'Liquidez de la empresa', valor: m(c.l01_liquidez_cent), categoria: 1, nota: 'L01 · fondos al corte', testid: 'caja-liquidez' },
        { id: 'cli', etiqueta: 'Liquidez con clientes', valor: m(c.l02_liquidez_total_cent), categoria: 5, nota: 'Más cuentas por cobrar (L02)' },
        { id: 'p', etiqueta: 'Después del pago semanal', valor: m(c.l04_despues_de_pago_cent), categoria: 6, nota: c.l03_pago_semana_cent === null ? 'Sin pago calculado' : `Pago ${m(c.l03_pago_semana_cent)} (L04)` },
      ]} />
      <Rejilla dividir="4-4-4">
        <Tarjeta>
          {dias.length >= 2 && dias.every((d) => d.valor >= 0) ? <AreaSerie titulo="Liquidez diaria" descripcion={`Saldo de fondos en ${dias.length} días con movimiento.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140} puntos={dias} /> : <p className="rtm-a2-nota">Se dibuja con dos días de movimiento o más y saldos no negativos.</p>}
        </Tarjeta>
        <Tarjeta>
          {semanas.length >= 2 ? <ColumnasPeriodo titulo="Entradas por semana" descripcion={`Entradas de fondos en ${semanas.length} semanas.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140} datos={semanas.map((x) => ({ id: x.semana, etiqueta: semanaEtiqueta(x.semana), valor: Number(x.entradas_cent) / 100, texto: m(x.entradas_cent) ?? '', detalle: `Salidas ${m(x.salidas_cent)}` }))} /> : <p className="rtm-a2-nota">Se dibuja con dos semanas de movimiento o más.</p>}
        </Tarjeta>
        <Tarjeta>
          {semanas.length >= 2 && semanas.some((x) => x.salidas_cent > 0n) ? <ColumnasPeriodo titulo="Salidas por semana" descripcion={`Salidas de fondos en ${semanas.length} semanas.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140} datos={semanas.map((x) => ({ id: x.semana, etiqueta: semanaEtiqueta(x.semana), valor: Number(x.salidas_cent) / 100, texto: m(x.salidas_cent) ?? '' }))} /> : <p className="rtm-a2-nota">Sin salidas de fondos en el periodo, o menos de dos semanas de movimiento: no se dibuja la serie.</p>}
        </Tarjeta>
      </Rejilla>
      <Rejilla dividir="8-4" alinear="inicio">
        <Tarjeta plana className="rtm-a2-tabla" titulo="Por lugar o persona" descripcion="Cada cuenta de fondos con su saldo al corte">
          <DataTable
            etiqueta="Saldo de caja por lugar o persona" clave={(x) => x.codigo} filas={cuentas} densidad="densa" plana
            vacio={{ titulo: 'Sin cuentas de fondos', texto: 'Aparecen con el primer cobro o pago.' }}
            columnas={[
              { id: 'n', titulo: 'Lugar o persona', ancho: 'xl', celda: (x) => x.nombre },
              { id: 't', titulo: 'Tipo', ancho: 'm', celda: (x) => TIPO[x.tipo] },
              { id: 's', titulo: 'Saldo', numerica: true, ancho: 'l', celda: (x) => (sd ? <SinDato /> : m(x.saldo_cent)) },
              { id: 'p', titulo: '% de la liquidez', numerica: true, ancho: 's', celda: (x) => (sd || c.l01_liquidez_cent === null ? <SinDato /> : pctTexto(partePct(x.saldo_cent, c.l01_liquidez_cent)) ?? <SinDato />) },
              { id: 'e', titulo: 'Entradas', numerica: true, ancho: 'm', secundaria: true, celda: (x) => (sd ? <SinDato /> : m(x.entradas_cent)) },
              { id: 'sa', titulo: 'Salidas', numerica: true, ancho: 'm', secundaria: true, celda: (x) => (sd ? <SinDato /> : m(x.salidas_cent)) },
              { id: 'u', titulo: 'Último movimiento', ancho: 'm', secundaria: true, celda: (x) => fecha(x.ultimo) ?? <SinDato /> },
            ]}
            totales={{ etiqueta: 'Liquidez total', celdas: { s: sd ? <SinDato /> : m(sumaSaldos), e: sd ? null : m(c.totales.entradas_cent), sa: sd ? null : m(c.totales.salidas_cent) } }}
          />
          <div className="rtm-a2-pie-tabla"><span>Comprobación: suma por lugar {m(sumaSaldos)} contra liquidez L01 {m(c.l01_liquidez_cent) ?? 'Sin dato'}</span>{sd ? <EstadoTexto tono="neutro">Sin movimientos</EstadoTexto> : <EstadoTexto tono={cuadra ? 'ok' : 'malo'}>{cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto>}</div>
        </Tarjeta>
        <div className="rtm-a2-apilado">
          <Tarjeta titulo="Dónde está el dinero" descripcion="Parte de la liquidez">
            <BarList etiquetaAria="Liquidez por tipo" items={[
              { id: 'ef', etiqueta: 'Efectivo de la sociedad', texto: sd ? 'Sin dato' : m(efectivo) ?? '', pct: sd || c.l01_liquidez_cent === null ? null : partePct(efectivo, c.l01_liquidez_cent) },
              { id: 'ba', etiqueta: 'Banco', texto: cuentas.some((x) => x.tipo === 'banco') ? (m(banco) ?? '') : 'Sin cuenta bancaria', pct: null },
              { id: 'so', etiqueta: 'En poder de socios', texto: sd ? 'Sin dato' : m(socios) ?? '', pct: sd || c.l01_liquidez_cent === null ? null : partePct(socios, c.l01_liquidez_cent) },
            ]} />
          </Tarjeta>
          <Tarjeta titulo="Pago de la semana" descripcion="Liquidez antes y después del pago al proveedor">
            <DataTable etiqueta="Pago semanal contra liquidez" clave={(x) => x.k} plana densidad="densa" filas={[
              { k: 'a', c: 'Liquidez (L01)', v: c.l01_liquidez_cent }, { k: 'b', c: 'Más clientes por cobrar (L02)', v: c.l02_liquidez_total_cent }, { k: 'c', c: 'Pago de la semana (L03)', v: c.l03_pago_semana_cent }, { k: 'd', c: 'Después del pago (L04)', v: c.l04_despues_de_pago_cent },
            ]} columnas={[{ id: 'c', titulo: 'Concepto', celda: (x) => x.c }, { id: 'v', titulo: 'Importe', numerica: true, celda: (x) => m(x.v) ?? <SinDato /> }]} />
          </Tarjeta>
        </div>
      </Rejilla>
      <p className="rtm-a2-nota">Hoy no hay cuentas bancarias de la sociedad: el dinero vive en cajas por persona (cuentas 1150 y 1160) y en el efectivo de la sociedad (1101). El conteo de efectivo por denominación todavía no tiene modelo en la base; no se muestra para no inventarlo. Sin movimientos de fondos todo dice «Sin dato».</p>
    </Pagina>
    </>
  );
}
