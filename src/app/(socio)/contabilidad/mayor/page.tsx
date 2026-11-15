import type { Metadata } from 'next';
import { AreaPesos } from '../../_a3/graficas-pesos';
import Link from 'next/link';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { fechaNeg } from '@/dominio/calendario';
import { esFecha } from '@/dominio/contabilidad/rangos';
import { etiquetaFecha } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { BarraFiltros } from '@/ui/componentes/controles';
import { BarList, ListaClaveValor } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';

import { Dos, Estado, Pie, abs, fechaCorta, m, pct, suma } from '../../_a3/util';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Mayor' };

const NOMBRE_TIPO = { A: 'Activo', P: 'Pasivo', K: 'Capital', I: 'Ingresos', C: 'Costos', G: 'Gastos' } as const;

export default async function PaginaMayor({ searchParams }: { searchParams: Promise<{ cuenta?: string; ini?: string; fin?: string }> }) {
  const q = await searchParams;
  const lector = await contabilidadDeSocio();
  const hoy = fechaNeg(new Date());
  const cuenta = q.cuenta && /^\d{4}$/.test(q.cuenta) ? q.cuenta : null;
  const ini = esFecha(q.ini) ? q.ini : null;
  const fin = esFecha(q.fin) ? q.fin : hoy;

  if (!cuenta) {
    const l = await lector.cuentas(hoy);
    const conSaldo = l.cuentas.filter((c) => c.saldo_cent !== 0n || c.debe_cent !== 0n || c.haber_cent !== 0n);
    const debe = suma(l.cuentas.map((c) => c.debe_cent));
    const haber = suma(l.cuentas.map((c) => c.haber_cent));
    const tipos = (Object.keys(NOMBRE_TIPO) as (keyof typeof NOMBRE_TIPO)[]).map((t) => ({ t, saldo: suma(l.cuentas.filter((c) => c.tipo === t).map((c) => c.saldo_cent)), n: l.cuentas.filter((c) => c.tipo === t && c.saldo_cent !== 0n).length }));
    const maxTipo = tipos.reduce((a, x) => (abs(x.saldo) > a ? abs(x.saldo) : a), 0n);
    return (
      <Pagina ancho="tablero">
        <SubnavContabilidad />
        <EncabezadoPagina eyebrow="Contabilidad · mayor" titulo="Cada cuenta con su saldo" descripcion="Saldo en la naturaleza de cada cuenta. Abre una cuenta para ver sus movimientos, con el asiento, el evento y el mensaje que los originó." />
        <KpiLinea
          etiquetaAria="Indicadores del mayor"
          celdas={[
            { id: 'cuentas', etiqueta: 'Cuentas del plan', valor: String(l.cuentas.length), categoria: 1, nota: `${conSaldo.length} con movimientos` },
            { id: 'debe', etiqueta: 'Debe acumulado', valor: conSaldo.length === 0 ? null : m(debe), categoria: 2, nota: `Al ${etiquetaFecha(l.hasta)}` },
            { id: 'haber', etiqueta: 'Haber acumulado', valor: conSaldo.length === 0 ? null : m(haber), categoria: 6, nota: conSaldo.length === 0 ? undefined : <Estado tono={debe === haber ? 'ok' : 'malo'}>{debe === haber ? 'Cuadra con el debe' : 'No cuadra'}</Estado> },
            { id: 'activas', etiqueta: 'Cuentas activas', valor: String(l.cuentas.filter((c) => c.activa).length), categoria: 4, nota: `${l.cuentas.filter((c) => !c.activa).length} inactivas` },
          ]}
        />
        <Tarjeta titulo="Saldo por tipo de cuenta" descripcion="Cada tipo en su naturaleza">
            <BarList columnas={2} etiquetaAria="Saldo por tipo" items={tipos.map((x) => ({ id: x.t, etiqueta: NOMBRE_TIPO[x.t], texto: m(x.saldo), pct: maxTipo > 0n ? pct(abs(x.saldo), maxTipo) : null, nota: `${x.n} con saldo` }))} />
            <Pie>Los tipos no se suman entre sí: cada uno se lee en su naturaleza deudora o acreedora.</Pie>
        </Tarjeta>
        <Tarjeta plana titulo="Plan de cuentas" descripcion="Agrupadas por tipo; el saldo está en la naturaleza de cada cuenta">
            <DataTable
              etiqueta="Cuentas del mayor"
              densidad="libro" plana pegajosa primeraFija
              interactiva={{ busqueda: 'Buscar cuenta', porPagina: 100, exportar: 'mayor-cuentas' }}
              agrupar={{ clave: (c) => NOMBRE_TIPO[c.tipo], cabecera: (k, fs) => ({ titulo: `${k} (${fs.length})`, subtotales: { d: m(suma(fs.map((c) => c.debe_cent))), h: m(suma(fs.map((c) => c.haber_cent))) } }) }}
              clave={(c) => c.codigo}
              filas={l.cuentas}
              totales={{ etiqueta: `Total (${l.cuentas.length})`, celdas: { d: m(debe), h: m(haber) } }}
              vacio={{ titulo: 'Sin cuentas', texto: 'El plan de cuentas aún no está cargado.' }}
              columnas={[
                { id: 'c', titulo: 'Cuenta', ancho: 'xl', celda: (c) => <Link href={`/contabilidad/mayor?cuenta=${c.codigo}`} data-testid={`cuenta-${c.codigo}`}><span className="rtm-mono">{c.codigo}</span> {c.nombre}</Link> },
                { id: 'n', titulo: 'Naturaleza', ancho: 's', secundaria: true, celda: (c) => (c.naturaleza === 'D' ? 'Deudora' : 'Acreedora') },
                { id: 'd', titulo: 'Debe', numerica: true, ancho: 'm', secundaria: true, celda: (c) => m(c.debe_cent) },
                { id: 'h', titulo: 'Haber', numerica: true, ancho: 'm', secundaria: true, celda: (c) => m(c.haber_cent) },
                { id: 's', titulo: 'Saldo', numerica: true, ancho: 'm', celda: (c) => <CifraComprobada texto={m(c.saldo_cent)} cifra={`conta:saldo:${c.codigo}`} comprobacion="cuadra" /> },
              ]}
            />
        </Tarjeta>
      </Pagina>
    );
  }

  const r = await lector.mayor(cuenta, ini, fin);
  const mov = r.movimientos;
  const debe = suma(mov.map((x) => x.debe_cent));
  const haber = suma(mov.map((x) => x.haber_cent));
  const puntos = mov.map((x, i) => ({ id: `${x.asiento_id}-${i}`, etiqueta: fechaCorta(x.fecha_contable), valor: Math.abs(Number(x.saldo_cent)), texto: m(x.saldo_cent), detalle: x.descripcion }));
  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        migaja={{ href: '/contabilidad/mayor', texto: 'Mayor' }}
        eyebrow={`Contabilidad · mayor · cuenta ${r.cuenta.codigo}`}
        titulo={`${r.cuenta.nombre}: ${m(r.saldo_final_cent)}`}
        descripcion={`${r.cuenta.naturaleza === 'D' ? 'Cuenta deudora' : 'Cuenta acreedora'}: ${r.cuenta.nota ?? 'sin nota'}. Saldo al ${etiquetaFecha(fin)}.`}
      />
      <BarraFiltros
        etiquetaAria="Periodo del mayor"
        extras={
          <form action="/contabilidad/mayor" method="get" className="a3-filtros-form" aria-label="Periodo">
            <input type="hidden" name="cuenta" value={r.cuenta.codigo} />
            <input className="rtm-campo" type="date" name="ini" defaultValue={ini ?? ''} aria-label="Desde" />
            <input className="rtm-campo" type="date" name="fin" defaultValue={fin} aria-label="Hasta" />
            <button type="submit" className="rtm-boton">Filtrar</button>
          </form>
        }
      >
        <span className="a3-pie">Del {ini ? etiquetaFecha(ini) : 'inicio'} al {etiquetaFecha(fin)}</span>
      </BarraFiltros>
      <KpiLinea
        etiquetaAria="Indicadores de la cuenta"
        celdas={[
          { id: 'ini', etiqueta: 'Saldo inicial', valor: m(r.saldo_inicial_cent), categoria: 1, nota: ini ? `Al ${etiquetaFecha(ini)}` : 'Desde el inicio del libro' },
          { id: 'debe', etiqueta: 'Debe del periodo', valor: m(debe), categoria: 2, nota: `${mov.filter((x) => x.debe_cent > 0n).length} cargos` },
          { id: 'haber', etiqueta: 'Haber del periodo', valor: m(haber), categoria: 6, nota: `${mov.filter((x) => x.haber_cent > 0n).length} abonos` },
          { id: 'fin', etiqueta: 'Saldo final', valor: <CifraComprobada texto={m(r.saldo_final_cent)} cifra={`conta:saldo:${r.cuenta.codigo}:${fin}`} comprobacion="cuadra" />, categoria: 7, nota: `${mov.length} movimientos` },
        ]}
      />
      <Rejilla dividir="8-4">
        <Tarjeta plana titulo="Movimientos" descripcion="Saldo corrido después de cada asiento">
          <DataTable
            etiqueta={`Movimientos de la cuenta ${r.cuenta.codigo}`}
            densidad="libro" plana pegajosa primeraFija
            interactiva={{ busqueda: 'Buscar asiento o concepto', porPagina: 100, exportar: `mayor-${r.cuenta.codigo}` }}
            clave={(x) => `${x.asiento_id}-${x.debe_cent}-${x.haber_cent}-${x.saldo_cent}`}
            filas={mov}
            totales={{ etiqueta: `Total (${mov.length})`, celdas: { d: m(debe), h: m(haber), s: m(r.saldo_final_cent) } }}
            vacio={{ titulo: 'Sin movimientos', texto: 'Esta cuenta no tiene movimientos en el periodo.' }}
            columnas={[
              { id: 'f', titulo: 'Fecha', ancho: 's', celda: (x) => etiquetaFecha(x.fecha_contable) },
              { id: 'a', titulo: 'Asiento', ancho: 'xl', celda: (x) => <Dos a={<span className="rtm-mono">{x.folio}</span>} b={`${x.descripcion}${x.nota ? `: ${x.nota}` : ''}`} /> },
              { id: 'd', titulo: 'Debe', numerica: true, ancho: 'm', celda: (x) => (x.debe_cent > 0n ? m(x.debe_cent) : '') },
              { id: 'h', titulo: 'Haber', numerica: true, ancho: 'm', celda: (x) => (x.haber_cent > 0n ? m(x.haber_cent) : '') },
              { id: 's', titulo: 'Saldo', numerica: true, ancho: 'm', celda: (x) => m(x.saldo_cent) },
              { id: 'q', titulo: 'Quién', ancho: 'l', secundaria: true, celda: (x) => <Dos a={x.autor ?? x.canal} b={x.mensaje_origen ?? undefined} /> },
            ]}
          />
        </Tarjeta>
        <Tarjeta titulo="Saldo en el tiempo" descripcion="Magnitud del saldo tras cada movimiento">
          {puntos.length >= 2 ? <AreaPesos titulo={`Saldo de la cuenta ${r.cuenta.codigo}`} descripcion={`Saldo de ${r.cuenta.nombre} tras cada uno de ${puntos.length} movimientos.`} procedencia="observado" pie="Fuente: libro de asientos" puntos={puntos} /> : <p className="a3-grafica-vacia"><strong>Pocos movimientos</strong>Con dos o más movimientos se dibuja el saldo.</p>}
                  <ListaClaveValor items={[
            { k: 'Saldo final', v: m(r.saldo_final_cent) },
            { k: 'Movimientos', v: String(mov.length) },
            { k: 'Debe del periodo', v: m(debe) },
            { k: 'Haber del periodo', v: m(haber) },
          ]} />
        
        </Tarjeta>
      </Rejilla>
      <FilaRatios etiqueta="Cuenta" items={[{ etiqueta: 'Tipo', valor: String(r.cuenta.tipo) }, { etiqueta: 'Naturaleza', valor: r.cuenta.naturaleza === 'D' ? 'Deudora' : 'Acreedora' }]} />
    </Pagina>
  );
}
