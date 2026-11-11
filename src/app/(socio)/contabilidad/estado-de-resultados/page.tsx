import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { fechaNeg } from '@/dominio/calendario';
import { rangoDeConsulta } from '@/dominio/contabilidad/rangos';
import type { EstadoResultados } from '@/dominio/contabilidad/tipos';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SelectorRango } from '../selector-rango';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Estado de resultados' };

function lineasDe(e: EstadoResultados, tipo: string, codigos?: string[]) {
  return e.lineas.filter((l) => l.tipo === tipo && (!codigos || codigos.includes(l.codigo)) && l.monto_cent !== 0n);
}

export default async function Pagina({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const { ini, fin } = rangoDeConsulta(hoy, q.ini, q.fin);
  const e = await (await contabilidadDeSocio()).estadoResultados(ini, fin);
  const dato = e.con_movimientos;
  const cifra = (c: bigint, nivel?: 'bruta' | 'contribucion' | 'neta') =>
    dato ? <CifraComprobada texto={formatearMoneda(c)} cifra={nivel ? `conta:utilidad:${ini}:${fin}:${nivel}` : `conta:utilidad:${ini}:${fin}:neta`} comprobacion={e.comprobacion.cuadra ? 'cuadra' : 'no_cuadra'} /> : <SinDato />;
  const fila = (clave: string, nombre: string, valor: bigint, fuerte = false) => ({ clave, nombre, valor, fuerte });
  const ingresos = [
    ...lineasDe(e, 'I', ['4110', '4120', '4130']).map((l) => fila(l.codigo, `${l.codigo} ${l.nombre}`, l.monto_cent)),
    fila('dev', '4220 Devoluciones sobre ventas', -e.devoluciones_cent),
    fila('desc', '4210 Descuentos y bonificaciones', -e.descuentos_cent),
    fila('vn', 'VENTAS NETAS', e.ventas_netas_cent, true),
    fila('env', '4300 Envío cobrado a clientes', e.envio_cent),
    fila('ion', 'INGRESOS OPERATIVOS NETOS', e.ingresos_operativos_cent, true),
  ];
  const costos = [...lineasDe(e, 'C').map((l) => fila(l.codigo, `${l.codigo} ${l.nombre}`, l.monto_cent)), fila('cv', 'COSTO DE VENTAS', -e.costo_ventas_cent, true)];
  const variables = lineasDe(e, 'G', ['6110', '6120', '6130', '6140']).map((l) => fila(l.codigo, `${l.codigo} ${l.nombre}`, -l.monto_cent));
  const fijos = lineasDe(e, 'G', ['6210', '6220', '6230', '6240', '6250', '6290']).map((l) => fila(l.codigo, `${l.codigo} ${l.nombre}`, -l.monto_cent));
  const bloque = (titulo: string, filas: ReturnType<typeof fila>[], pie?: React.ReactNode) => (
    <section className="rtm-seccion" aria-label={titulo}>
      <h2>{titulo}</h2>
      <DataTable
        etiqueta={titulo}
        clave={(f) => f.clave}
        filas={filas}
        vacio={{ titulo: 'Sin movimientos', texto: 'No hay renglones con importe en este periodo.' }}
        columnas={[
          { id: 'n', titulo: 'Renglón', celda: (f) => (f.fuerte ? <strong>{f.nombre}</strong> : f.nombre) },
          { id: 'm', titulo: 'Importe', numerica: true, celda: (f) => (f.fuerte ? <strong>{formatearMoneda(f.valor)}</strong> : formatearMoneda(f.valor)) },
        ]}
      />
      {pie}
    </section>
  );
  return (
    <>
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · estado de resultados"
        antes="La utilidad neta del periodo es"
        enfasis={dato ? formatearMoneda(e.utilidad_neta_cent) : 'sin dato'}
        contexto="Tres niveles de utilidad: bruta, de contribución y neta. Utilidad no es caja: el reparto de efectivo sigue la cascada. Los ajustes que llegan tarde se registran en el periodo abierto y se muestran aparte."
      />
      <SelectorRango base="/contabilidad/estado-de-resultados" hoy={hoy} ini={ini} fin={fin} />
      {!dato ? (
        <DataTable etiqueta="Estado de resultados" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin dato en este periodo', texto: 'Aún no hay asientos con fecha dentro del periodo elegido. Cuando haya ventas, costos y gastos aparecerán aquí.' }} />
      ) : (
        <>
          <div className="rtm-kpis rtm-entra rtm-i-1">
            <div className="rtm-kpi" data-testid="utilidad-bruta"><span>Utilidad bruta</span><strong>{cifra(e.utilidad_bruta_cent, 'bruta')}</strong></div>
            <div className="rtm-kpi" data-testid="utilidad-contribucion"><span>Utilidad de contribución</span><strong>{cifra(e.utilidad_contribucion_cent, 'contribucion')}</strong></div>
            <div className="rtm-kpi" data-testid="utilidad-neta"><span>Utilidad neta</span><strong>{cifra(e.utilidad_neta_cent, 'neta')}</strong></div>
            <div className="rtm-kpi"><span>Piezas vendidas</span><strong>{formatearPiezas(e.piezas_vendidas)}</strong></div>
          </div>
          {bloque('Ventas e ingresos', ingresos)}
          {bloque('Costo de ventas', costos, <p className="rtm-nota">Utilidad bruta: {formatearMoneda(e.utilidad_bruta_cent)}</p>)}
          {bloque('Gastos variables de venta', variables, <p className="rtm-nota">Utilidad de contribución: {formatearMoneda(e.utilidad_contribucion_cent)}</p>)}
          {bloque('Gastos fijos del sistema y administración', fijos)}
          {bloque('Otros', [fila('otros', 'Recargos por crédito, cambiarios, incobrables y redondeo', e.otros_cent), fila('neta', 'UTILIDAD NETA (antes de reparto)', e.utilidad_neta_cent, true)])}
          <section className="rtm-seccion" aria-label="Reparto">
            <h2>Reparto 50/50 antes de la cascada</h2>
            <p className="rtm-nota">Angelo {formatearMoneda(e.angelo_cent)} · Javier {formatearMoneda(e.javier_cent)}. El residuo de un centavo se asigna siempre a Angelo. Ajustes de periodos anteriores en este periodo: {formatearMoneda(e.ajustes_periodos_anteriores_cent)}.</p>
          </section>
          <p className="rtm-nota">
            <EstadoTexto tono={e.comprobacion.cuadra ? 'ok' : 'malo'}>{e.comprobacion.cuadra ? 'Cuadra por las dos vías' : 'No cuadra'}</EstadoTexto>
            {' '}Vía 1: suma de los niveles {formatearMoneda(e.comprobacion.via1_cent)}. Vía 2: suma directa de las cuentas 4 a 7 {formatearMoneda(e.comprobacion.via2_cent)}.
            {' '}Fuente: libro de asientos, corte {hoy}.
          </p>
        </>
      )}
    </>
  );
}
