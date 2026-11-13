import type { Metadata } from 'next';
import '@/ui/estilos/capital.css';
import { capitalDeSocio } from '@/composicion/capital';
import { idCifraCapital } from '@/dominio/capital/explicar';
import { ESTADO_PROVEEDOR, etiquetaFondos, etiquetaMesCapital, etiquetaSocio, pctBp, textoIgualar } from '@/dominio/capital/etiquetas';
import type { CampoCapital, FilaCapitalSocio, PeriodoCapital } from '@/dominio/capital/tipos';
import { formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, EstadoVacio, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { GraficaCapital } from '@/ui/capital/grafica-capital';
import { Campo, FiltrosUrl } from '../../_a2/filtros-url';
import { SubnavContabilidad } from '../subnav';
import { fecha, fechaParam, hoyNeg, type Params } from '../../_a2/util';

export const metadata: Metadata = { title: 'Capital por socio' };

interface FilaTabla { clave: string; mes: string; periodo: PeriodoCapital; f: FilaCapitalSocio }

export default async function PaginaCapital({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const desdeP = fechaParam(sp.desde);
  const hastaP = fechaParam(sp.hasta) ?? hoyNeg();
  const { datos: d, mio } = await capitalDeSocio(desdeP, hastaP);
  const a = d.acumulado;
  const sd = !a.hay_movimientos;
  const m = (c: bigint): string => formatearMoneda(c);
  const id = (mes: string, campo: CampoCapital, sujeto: string) => idCifraCapital({ desde: d.desde, hasta: d.hasta, mes, campo, sujeto });
  const cifra = (c: bigint, mes: string, campo: CampoCapital, sujeto: string, ok?: boolean) => (sd ? <SinDato /> : <CifraComprobada texto={m(c)} cifra={id(mes, campo, sujeto)} comprobacion={ok === undefined ? 'sin_comprobar' : ok ? 'cuadra' : 'no_cuadra'} />);
  const pct = (bp: number | null, mes: string, sujeto: string) => (sd || bp === null ? <SinDato /> : <CifraComprobada texto={pctBp(bp)} cifra={id(mes, 'participacion', sujeto)} />);

  const filasMes: FilaTabla[] = d.meses.flatMap((x) => x.periodo.socios.map((f) => ({ clave: `${x.mes}-${f.socio}`, mes: x.mes, periodo: x.periodo, f })));
  const filasAcum: FilaTabla[] = a.socios.map((f) => ({ clave: `acum-${f.socio}`, mes: 'acum', periodo: a, f }));
  const columnas = () => [
    { id: 's', titulo: 'Socio', ancho: 'm' as const, celda: (x: FilaTabla) => etiquetaSocio(x.f.socio, mio) },
    { id: 'a', titulo: 'Aportaciones de capital', numerica: true, ancho: 'm' as const, celda: (x: FilaTabla) => cifra(x.f.aportaciones_capital_cent, x.mes, 'aportaciones', x.f.socio) },
    { id: 'u', titulo: 'Utilidad generada', numerica: true, ancho: 'm' as const, celda: (x: FilaTabla) => cifra(x.f.utilidad_generada_cent, x.mes, 'utilidad', x.f.socio) },
    { id: 'r', titulo: 'Utilidad reinvertida', numerica: true, ancho: 'm' as const, celda: (x: FilaTabla) => cifra(x.f.utilidad_reinvertida_cent, x.mes, 'reinvertida', x.f.socio) },
    { id: 't', titulo: 'Utilidad retirada', numerica: true, ancho: 'm' as const, celda: (x: FilaTabla) => cifra(x.f.utilidad_retirada_cent, x.mes, 'retirada', x.f.socio) },
    { id: 'p', titulo: '% en libros', numerica: true, ancho: 's' as const, secundaria: true, etiquetaMovil: 'En libros', celda: (x: FilaTabla) => pct(x.f.pct_valuacion_bp, x.mes, x.f.socio) },
    { id: 'q', titulo: '% de aportaciones', numerica: true, ancho: 's' as const, secundaria: true, etiquetaMovil: 'De aportaciones', celda: (x: FilaTabla) => (sd || x.f.pct_capital_bp === null ? <SinDato /> : pctBp(x.f.pct_capital_bp)) },
    { id: 'v', titulo: 'Valuación al cierre', numerica: true, ancho: 'm' as const, celda: (x: FilaTabla) => cifra(x.f.valuacion_cent, x.mes, 'valuacion', x.f.socio) },
  ];
  const subtotales = (mes: string, p: PeriodoCapital) => ({
    a: cifra(p.total.aportaciones_capital_cent, mes, 'aportaciones', 'total'), u: cifra(p.total.utilidad_generada_cent, mes, 'utilidad', 'total'),
    r: cifra(p.total.utilidad_reinvertida_cent, mes, 'reinvertida', 'total'), t: cifra(p.total.utilidad_retirada_cent, mes, 'retirada', 'total'), v: cifra(p.total.valuacion_cent, mes, 'valuacion', 'total'),
  });

  // Grafica: totales de los socios, aportaciones y utilidad acumuladas al cierre de cada mes.
  let apoAcum = 0n; let utilAcum = 0n;
  const puntos = d.meses.map((x) => {
    apoAcum += x.periodo.total.aportaciones_capital_cent; utilAcum += x.periodo.total.utilidad_generada_cent;
    return { id: x.mes, etiqueta: etiquetaMesCapital(x.mes), aportaciones: apoAcum, utilidad: utilAcum, valuacion: x.periodo.total.valuacion_cent };
  });

  const fin = d.meses.at(-1)?.periodo ?? a;
  const fondosFilas = fin.socios.flatMap((f) => f.fondos_detalle.map((r, i) => ({ clave: `${f.socio}-${i}`, socio: f.socio, ...r })));
  const hayFondos = fin.total.fondos_en_poder_cent > 0n;
  const provFilas: { clave: string; concepto: string; detalle: string; monto: bigint; cifra: string }[] = fin.proveedores.flatMap((p) => [
    { clave: p.proveedor, concepto: p.proveedor, detalle: ESTADO_PROVEEDOR[p.estado], monto: p.saldo_sin_clasificar_cent < 0n ? -p.saldo_sin_clasificar_cent : p.saldo_sin_clasificar_cent, cifra: id(d.meses.at(-1)?.mes ?? 'acum', 'prov', p.proveedor) },
    ...(p.por_clasificar_cent > 0n ? [{ clave: `${p.proveedor}-clasif`, concepto: `${p.proveedor} · Por clasificar`, detalle: 'Pagado por un socio, destino sin confirmar', monto: p.por_clasificar_cent, cifra: id(d.meses.at(-1)?.mes ?? 'acum', 'clasif', p.proveedor) }] : []),
  ]);
  const fallan = a.comprobaciones.filter((x) => !x.ok);

  return (
    <>
      <SubnavContabilidad />
      <Pagina ancho="tablero">
        <EncabezadoPagina eyebrow="Contabilidad · capital por socio" titulo={sd ? 'Todavía no hay capital que mostrar' : `Valuación de ${m(a.total.valuacion_cent)}`}
          descripcion="Por mes y por socio: aportaciones de capital, utilidad generada, reinvertida y retirada, fondos de la sociedad en poder de cada socio, valuación y su participación. Cada cifra cuadra contra el Estado de resultados, el Balance y el Libro." />
        <FiltrosUrl etiquetaAria="Periodo" restablecer="/contabilidad/capital">
          <Campo etiqueta="Desde"><input type="date" name="desde" defaultValue={desdeP ?? ''} max={hoyNeg()} /></Campo>
          <Campo etiqueta="Hasta"><input type="date" name="hasta" defaultValue={hastaP} max={hoyNeg()} /></Campo>
        </FiltrosUrl>
        {sd ? (
          <EstadoVacio titulo="Sin movimientos todavía" texto="La tabla aparece con el primer movimiento contable (apertura, aportación o venta). Mientras tanto no se muestran ceros inventados." />
        ) : (
          <>
            <KpiLinea etiquetaAria="Resumen de capital" celdas={[
              { id: 'v', etiqueta: 'Valuación total', valor: cifra(a.total.valuacion_cent, 'acum', 'valuacion', 'total', a.comprobaciones.find((x) => x.id === 'K1')?.ok), categoria: 1, nota: 'Capital contable', testid: 'capital-valuacion' },
              { id: 'c', etiqueta: 'Aportaciones de capital', valor: cifra(a.total.aportaciones_capital_cent, 'acum', 'aportaciones', 'total'), categoria: 2, nota: 'Declaradas en el periodo' },
              { id: 'u', etiqueta: 'Utilidad generada', valor: cifra(a.total.utilidad_generada_cent, 'acum', 'utilidad', 'total', a.comprobaciones.find((x) => x.id === 'K3')?.ok), categoria: 3, nota: '50/50 entre socios' },
              { id: 'r', etiqueta: 'Reinvertida', valor: cifra(a.total.utilidad_reinvertida_cent, 'acum', 'reinvertida', 'total'), categoria: 4, nota: 'Acta y proveedor' },
              { id: 't', etiqueta: 'Retirada', valor: cifra(a.total.utilidad_retirada_cent, 'acum', 'retirada', 'total'), categoria: 5, nota: 'Utilidad sacada' },
              { id: 'f', etiqueta: 'Fondos en poder de socios', valor: cifra(a.total.fondos_en_poder_cent, d.meses.at(-1)?.mes ?? 'acum', 'fondos', 'total'), categoria: 6, nota: 'Al corte' },
            ]} />
            {fallan.length > 0 && <p className="rtm-capital-nota" role="status" data-testid="capital-aviso">{fallan.length} de {a.comprobaciones.length} comprobaciones no cuadran: ábrelas abajo para ver los dos lados.</p>}

            <Rejilla dividir="6-6" alinear="inicio">
              <Tarjeta titulo="Aportaciones, utilidad y valuación" descripcion="Total de los socios al cierre de cada mes">
                <GraficaCapital puntos={puntos} titulo="Aportaciones de capital, utilidad generada y valuación" descripcion={`Tres columnas por mes, ${puntos.length} ${puntos.length === 1 ? 'mes' : 'meses'}: aportaciones de capital acumuladas, utilidad generada acumulada y valuación al cierre.`} pie={`Periodo ${fecha(d.desde)} al ${fecha(d.hasta)} · Fuente: libro contable`} />
              </Tarjeta>
              <Tarjeta titulo="Cómo crece la participación" descripcion="Participación en libros contra participación en aportaciones de capital">
                <DataTable etiqueta="Participación por socio" clave={(x) => x.f.socio} filas={a.socios.map((f) => ({ f }))} densidad="densa" plana
                  columnas={[
                    { id: 's', titulo: 'Socio', celda: (x) => etiquetaSocio(x.f.socio, mio) },
                    { id: 'l', titulo: 'En libros', numerica: true, celda: (x) => pct(x.f.pct_valuacion_bp, 'acum', x.f.socio) },
                    { id: 'c', titulo: 'De aportaciones de capital', numerica: true, celda: (x) => pctBp(x.f.pct_capital_bp) ?? <SinDato /> },
                    { id: 'n', titulo: 'Retenida en el periodo', numerica: true, celda: (x) => m(x.f.utilidad_retenida_cent) },
                  ]} />
                <p className="rtm-capital-nota">Sin retirar y reinvirtiendo, la utilidad retenida sube la participación en libros por encima de la de aportaciones. La utilidad se reparte 50/50; el capital aportado no da más utilidad.</p>
              </Tarjeta>
            </Rejilla>

            <Tarjeta plana className="rtm-a2-tabla" titulo="Por mes y por socio" descripcion="Cada cifra abre «Explicar este número» con su fuente y su comprobación">
              <DataTable etiqueta="Capital por mes y por socio" clave={(x) => x.clave} filas={filasMes} densidad="densa" plana primeraFija columnas={columnas()}
                agrupar={{ clave: (x) => x.mes, cabecera: (mes) => { const p = d.meses.find((x) => x.mes === mes)!.periodo; return { titulo: `${etiquetaMesCapital(mes)}${p.parcial ? ' (parcial)' : ''}`, subtotales: subtotales(mes, p) }; } }}
                vacio={{ titulo: 'Sin meses en el periodo', texto: 'Elige otro rango de fechas.' }} />
            </Tarjeta>
            <Tarjeta plana className="rtm-a2-tabla" titulo="Acumulado del periodo" descripcion={`Del ${fecha(d.desde)} al ${fecha(d.hasta)}`}>
              <DataTable etiqueta="Capital acumulado por socio" clave={(x) => x.clave} filas={filasAcum} densidad="densa" plana primeraFija columnas={columnas()}
                totales={{ etiqueta: 'Total de los socios', celdas: { a: cifra(a.total.aportaciones_capital_cent, 'acum', 'aportaciones', 'total'), u: cifra(a.total.utilidad_generada_cent, 'acum', 'utilidad', 'total'), r: cifra(a.total.utilidad_reinvertida_cent, 'acum', 'reinvertida', 'total'), t: cifra(a.total.utilidad_retirada_cent, 'acum', 'retirada', 'total'), v: cifra(a.total.valuacion_cent, 'acum', 'valuacion', 'total') } }} />
              <p className="rtm-capital-nota">Reinvertida = acta de corte más lo respaldado por utilidad en saldo a favor con proveedores (calculado: lo que excede la utilidad es anticipo, no utilidad{a.anticipo_proveedor_cent > 0n ? `; hoy ${m(a.anticipo_proveedor_cent)}` : ''}).</p>
            </Tarjeta>

            <Rejilla dividir="6-6" alinear="inicio">
              <Tarjeta plana className="rtm-a2-tabla" titulo="Fondos de la sociedad en poder de socios" descripcion={`Al ${fecha(fin.fin)}: cada renglón con su motivo`}>
                {hayFondos ? (
                  <DataTable etiqueta="Fondos de la sociedad en poder de socios" clave={(x) => x.clave} filas={fondosFilas} densidad="densa" plana
                    columnas={[
                      { id: 'q', titulo: 'Quién', ancho: 'xl', truncar: 'l', celda: (x) => etiquetaFondos(x.socio, mio) },
                      { id: 'f', titulo: 'Fecha', ancho: 's', celda: (x) => fecha(x.fecha) },
                      { id: 'm', titulo: 'Motivo', ancho: 'l', truncar: 'l', celda: (x) => <>{x.motivo}{x.cliente ? ` · ${x.cliente}` : ''}</> },
                      { id: 'i', titulo: 'Importe', numerica: true, ancho: 'm', celda: (x) => <CifraComprobada texto={m(x.monto_cent)} cifra={id(fin === a ? 'acum' : d.meses.at(-1)!.mes, 'fondos', x.socio)} /> },
                    ]}
                    totales={{ etiqueta: 'Total en poder de socios', celdas: { i: cifra(fin.total.fondos_en_poder_cent, d.meses.at(-1)?.mes ?? 'acum', 'fondos', 'total') } }} />
                ) : <p className="rtm-capital-nota" data-testid="sin-fondos">Ningún socio tiene fondos de la sociedad en su poder al corte.</p>}
                <DataTable etiqueta="Aportación neta y diferencia a igualar" clave={(x) => x.socio} filas={fin.socios} densidad="densa" plana
                  columnas={[
                    { id: 's', titulo: 'Socio', celda: (x) => etiquetaSocio(x.socio, mio) },
                    { id: 'a', titulo: 'Aportado', numerica: true, celda: (x) => m(x.aportado_cent) },
                    { id: 'f', titulo: 'Fondos en su poder', numerica: true, celda: (x) => m(x.fondos_en_poder_cent) },
                    { id: 'n', titulo: 'Aportación neta', numerica: true, celda: (x) => <CifraComprobada texto={m(x.aportacion_neta_cent)} cifra={id(d.meses.at(-1)?.mes ?? 'acum', 'neta', x.socio)} /> },
                    { id: 'd', titulo: 'Diferencia a igualar', numerica: true, celda: (x) => <><CifraComprobada texto={m(x.diferencia_a_igualar_cent)} cifra={id(d.meses.at(-1)?.mes ?? 'acum', 'igualar', x.socio)} /><span className="rtm-capital-igualar">{textoIgualar(x.diferencia_a_igualar_cent, m)}</span></> },
                  ]} />
                <p className="rtm-capital-nota">Los fondos que un socio tiene en su poder reducen su aportación neta; ambos seguirán aportando por partes iguales, por eso se muestra lo que falta para igualar.</p>
              </Tarjeta>
              <Tarjeta plana className="rtm-a2-tabla" titulo="Proveedores" descripcion={`Cuenta con cada proveedor al ${fecha(fin.fin)}`}>
                <DataTable etiqueta="Cuenta con proveedores" clave={(x) => x.clave} filas={provFilas} densidad="densa" plana
                  vacio={{ titulo: 'Sin movimientos con proveedores', texto: 'Aparecen con la primera compra, pago o cobro redirigido.' }}
                  columnas={[
                    { id: 'p', titulo: 'Proveedor', ancho: 'l', truncar: 'l', celda: (x) => x.concepto },
                    { id: 'd', titulo: 'Situación', ancho: 'l', truncar: 'l', celda: (x) => x.detalle },
                    { id: 'i', titulo: 'Importe', numerica: true, ancho: 'm', celda: (x) => <CifraComprobada texto={m(x.monto)} cifra={x.cifra} /> },
                  ]} />
                <p className="rtm-capital-nota">Lo que un socio pagó a un proveedor sin destino confirmado queda «Por clasificar»: no cuenta como inventario, saldo a favor ni utilidad reinvertida hasta clasificarlo.</p>
              </Tarjeta>
            </Rejilla>

            <Tarjeta titulo="Comprobaciones" descripcion={`Al ${fecha(a.fin)}: cada cifra contra el Estado de resultados, el Balance y el Libro`}>
              <DataTable etiqueta="Comprobaciones de capital" clave={(x) => x.id} filas={a.comprobaciones} densidad="densa" plana
                columnas={[
                  { id: 'i', titulo: 'Identidad', ancho: 'xl', truncar: 'l', celda: (x) => <CifraComprobada texto={`${x.id}: ${x.nombre}`} cifra={id('acum', 'comp', x.id)} comprobacion={x.ok ? 'cuadra' : 'no_cuadra'} /> },
                  { id: 'e', titulo: 'Resultado', ancho: 's', celda: (x) => <EstadoTexto tono={x.ok ? 'ok' : 'malo'}>{x.ok ? 'Cuadra' : 'No cuadra'}</EstadoTexto> },
                ]} />
            </Tarjeta>
          </>
        )}
      </Pagina>
    </>
  );
}
