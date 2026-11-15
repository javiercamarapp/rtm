import type { Metadata } from 'next';
import { costosDeSocio } from '@/composicion/costos';
import { fechaNeg } from '@/dominio/calendario';
import { pesosDeExactoE6, textoMicro, textoPct } from '@/dominio/costos/entrada';
import { formatearMoneda, etiquetaFecha } from '@/dominio/formato';
import { PIE_DE_MARCAS } from '@/dominio/marcas';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { Aviso, Segmentado } from '@/ui/componentes/controles';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { LogoServicio } from '@/ui/componentes/logo-servicio';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { RazonamientoServicios } from './razonamiento-servicios';
import { AnularCargo, FormularioReembolso, FormularioTipoCambio } from './acciones-costos';
import { FormularioCargo } from './formulario-cargo';
import { ListaServicios } from './lista-servicios';
import '@/ui/estilos/costos.css';

export const metadata: Metadata = { title: 'Costos de mantenimiento del sistema' };

const dinero = (c: bigint) => formatearMoneda(c);

export default async function PaginaCostos({ searchParams }: { searchParams: Promise<{ mes?: string; construccion?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.mes ?? '') ? q.mes! : hoy.slice(0, 7);
  const incluir = q.construccion === '1';
  const lector = await costosDeSocio();
  const [resumen, cargos, servicios, tc] = await Promise.all([lector.resumen(mes, incluir), lector.cargos(mes), lector.servicios(), lector.tipoCambio(hoy)]);
  const explicaciones = await Promise.all(cargos.filter((c) => c.reversa_de === null).map((c) => lector.explicar(c.id)));
  const explicar = new Map(explicaciones.map((e) => [e.cargo.id, e]));
  const t = resumen.total;
  const cuenta = resumen.cuenta_javier;
  const href = (m: string, c = incluir) => `/costos?${new URLSearchParams({ mes: m, ...(c ? { construccion: '1' } : {}) })}`;
  const faltan = resumen.al_menos;
  const val = resumen.validacion;
  const aportadoTotal = resumen.aportacion_javier?.total_cent ?? cuenta.aportado_capital_cent ?? 0n;
  const aportaciones = (await lector.aportaciones('javier')).aportaciones;
  const pendientesTc = val?.pendientes_tc ?? [];

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Costos del sistema · ${mes}`}
        titulo="Lo que cuesta mantener el sistema"
        descripcion="Cada cargo mensual lo paga Javier con su tarjeta y se registra, con fecha, como su aportación de capital declarada; a cada servicio solo se le atribuye lo que RTM consume."
        acciones={
          <Segmentado
            etiquetaAria="Opciones del mes"
            tamano="chico"
            opciones={[
              { valor: 'sin', etiqueta: 'Sin construcción', href: href(mes, false), activa: !incluir },
              { valor: 'con', etiqueta: 'Sumar construcción', href: href(mes, true), activa: incluir, testid: 'costos-construccion' },
            ]}
          />
        }
      />
      <div data-testid="costos-resumen">
        <KpiLinea
          etiquetaAria="Resumen del mes"
          celdas={[
            { id: 'operar', etiqueta: `Costo mensual de operar${faltan ? ' (al menos)' : ''}`, valor: <span data-testid="costos-operar">{dinero(resumen.operar.redondeado_cent)}</span>, categoria: 1, nota: `exacto ${pesosDeExactoE6(BigInt(resumen.operar.exacto_e6))}` },
            { id: 'total', etiqueta: `Gasto total del mes${incluir ? ', con construcción' : ''}`, valor: <span data-testid="costos-total">{dinero(t.redondeado_cent)}</span>, categoria: 2, nota: `exacto ${pesosDeExactoE6(BigInt(t.exacto_e6))} · redondeo ${pesosDeExactoE6(BigInt(t.redondeado_cent) * 1_000_000n - BigInt(t.exacto_e6))}` },
            { id: 'opc', etiqueta: 'Claude y Higgsfield (opcionales)', valor: dinero(resumen.opcionales.redondeado_cent), categoria: 4, nota: `construcción: ${dinero(resumen.construccion.redondeado_cent)} (aparte)` },
            { id: 'apo', etiqueta: 'Aportado por Javier por costos (acumulado)', valor: <span data-testid="costos-aportado"><CifraComprobada texto={dinero(aportadoTotal)} cifra="costos:aportacion:total" comprobacion={val?.cuadra === false ? 'no_cuadra' : 'cuadra'} /></span>, categoria: 6, nota: `por reembolsar ${dinero(cuenta.pendiente_cent)} (solo lo no declarado como capital)` },
          ]}
        />
      </div>
      {faltan && <Aviso tono="atencion">Hay datos faltantes: {resumen.faltantes.map((f) => `${f.servicio} (${f.motivo})`).join(', ')}. El total dice "al menos" y el servicio queda en "Sin dato".</Aviso>}
      <p className="rtm-nota">Tipo de cambio de referencia: {tc ? `${textoMicro(BigInt(tc.tc_micro), 4)} del ${etiquetaFecha(tc.fecha)} (${tc.fuente === 'manual' ? 'capturado' : 'Banxico, FIX'})` : 'Sin dato: captúralo abajo antes de registrar un cargo en dólares.'}</p>

      <Tarjeta titulo="Por servicio" descripcion="Lo atribuido a cada servicio este mes. Elige uno para ver sus cargos y registrar uno nuevo.">
        <ListaServicios servicios={servicios} resumen={resumen.servicios} mes={mes} incluir={incluir} />
      </Tarjeta>

      {pendientesTc.length > 0 && <Aviso tono="atencion" titulo="Sin tipo de cambio: falta capturarlo">{pendientesTc.map((p) => `${p.servicio} USD ${textoMicro(BigInt(p.usd_micro))}`).join(' · ')}. Se guardan en dólares y no se convierten; al capturar el tipo de cambio abajo y volver a cargar el mes, nacen como aportación.</Aviso>}
      <Tarjeta titulo="Validación de montos" descripcion="Lo cargado en el mes, lo aportado en el libro de socios y lo asentado en el mayor deben ser la misma cifra">
        <p className="rtm-nota" data-testid="costos-validacion">
          Cargos del mes <CifraComprobada texto={dinero(val?.cargos_cent ?? 0n)} cifra={`costos:aportacion:${mes}`} comprobacion={val ? (val.cuadra ? 'cuadra' : 'no_cuadra') : 'sin_comprobar'} /> · aportación generada {dinero(val?.aportado_cent ?? 0n)} · mayor {dinero(val?.mayor_cent ?? 0n)}:{' '}
          <EstadoTexto tono={val?.cuadra === false ? 'atencion' : 'ok'}>{val?.cuadra === false ? 'no cuadra' : 'cuadra'}</EstadoTexto>
        </p>
      </Tarjeta>
      <Tarjeta titulo="Razonamiento y destino del dinero" descripcion="Por qué se atribuye cada servicio a RTM, cómo se calcula y a dónde llega el dinero">
        <RazonamientoServicios servicios={servicios} />
      </Tarjeta>

      <Tarjeta plana titulo="Cargos" descripcion={`${cargos.length} en el mes`}>
        <DataTable
          plana
          densidad="densa"
          etiqueta="Cargos del mes"
          clave={(c) => c.id}
          filas={cargos}
          vacio={{ titulo: 'Sin cargos del mes', texto: `Todavía no se ha cargado ningún costo de ${mes}, por eso los totales están en cero y no significan que el sistema no cueste. Cárgalos con: node scripts/costos/cargar-mes.mjs --mes ${mes} --aplicar (primero --verificar), o registra uno con el formulario de abajo.` }}
          columnas={[
            { id: 'f', titulo: 'Folio', ancho: 's', prioridadMovil: 'titulo', celda: (c) => <span data-testid={`cargo-folio-${c.id}`}>{c.folio}</span> },
            { id: 's', titulo: 'Servicio', celda: (c) => <LogoServicio slug={c.servicio_slug} logoSlug={c.logo_slug} nombre={c.servicio} conNombre /> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (c) => etiquetaFecha(c.fecha_neg) },
            { id: 'p', titulo: 'Base y porcentaje', secundaria: true, celda: (c) => <>{c.moneda} {textoMicro(BigInt(c.base_orig_micro))} · {textoPct(BigInt(c.pct_aplicado_ppm))} %<br /><span className="rtm-nota">TC {textoMicro(BigInt(c.tc_micro), 4)} ({etiquetaFecha(c.tc_fecha)})</span></> },
            { id: 'x', titulo: 'MXN exacto', numerica: true, secundaria: true, celda: (c) => pesosDeExactoE6(BigInt(c.exacto_mxn_e6)) },
            { id: 'm', titulo: 'MXN', numerica: true, prioridadMovil: 'principal', celda: (c) => <span data-testid={`cargo-monto-${c.id}`}>{dinero(c.monto_cent)}</span> },
            { id: 'e', titulo: 'Estado', celda: (c) => <EstadoTexto tono={c.anulado || c.reversa_de ? 'neutro' : c.estado === 'confirmado' ? 'ok' : 'atencion'}>{c.reversa_de ? 'Reversa' : c.anulado ? 'Anulado' : c.estado === 'confirmado' ? 'Confirmado' : 'Provisional'}</EstadoTexto> },
            { id: 'a', titulo: '', celda: (c) => c.reversa_de || c.anulado ? null : (
              <>
                <details className="rtm-explicar-linea" data-testid={`explicar-${c.id}`}>
                  <summary>Explicar este número</summary>
                  {(() => { const e = explicar.get(c.id); return e ? (
                    <>
                      <p>{e.metodo}</p>
                      <p>{c.moneda} {textoMicro(BigInt(c.base_orig_micro))} × {textoPct(BigInt(c.pct_aplicado_ppm))} % = {c.moneda} {textoMicro(BigInt(e.atribuido_orig_micro))} × tipo de cambio {textoMicro(BigInt(c.tc_micro), 4)} = MXN {pesosDeExactoE6(BigInt(c.exacto_mxn_e6))} → {dinero(c.monto_cent)} (techo al peso).</p>
                      <p>Comprobación por dos vías: {e.comprobacion.via1} {dinero(e.comprobacion.via1_cent)} contra {e.comprobacion.via2} {dinero(e.comprobacion.via2_cent)}: {e.comprobacion.cuadra ? 'cuadra' : 'no cuadra'}. Gasto {c.gasto_folio ?? 'sin gasto (no cobrable)'}.</p>
                    </>
                  ) : null; })()}
                </details>
                <AnularCargo cargoId={c.id} fecha={hoy} />
              </>
            ) },
          ]}
        />
      </Tarjeta>

      <Tarjeta plana titulo="Aportaciones de capital de Javier por costos" descripcion={`${aportaciones.length} registradas, con fecha, servicio, monto y tipo de cambio usado`}>
        <DataTable
          plana
          densidad="densa"
          etiqueta="Aportaciones por costos del sistema"
          clave={(a) => a.folio}
          filas={aportaciones}
          vacio={{ titulo: 'Sin aportaciones todavía', texto: 'Cada cargo del mes aparecerá aquí como aportación de capital de Javier.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', ancho: 's', prioridadMovil: 'titulo', celda: (a) => etiquetaFecha(a.fecha_neg) },
            { id: 's', titulo: 'Servicio', celda: (a) => <LogoServicio slug={a.servicio_slug} logoSlug={a.logo_slug} nombre={a.servicio} conNombre /> },
            { id: 'u', titulo: 'Origen', numerica: true, secundaria: true, celda: (a) => `${a.moneda} ${textoMicro(BigInt(a.base_orig_micro))}` },
            { id: 't', titulo: 'Tipo de cambio', numerica: true, secundaria: true, celda: (a) => `${textoMicro(BigInt(a.tc_micro), 4)} · ${etiquetaFecha(a.tc_fecha)}` },
            { id: 'r', titulo: 'Referencia', secundaria: true, celda: (a) => `${a.folio} · ${a.gasto_folio ?? ''}` },
            { id: 'm', titulo: 'Aportación MXN', numerica: true, prioridadMovil: 'principal', celda: (a) => <CifraComprobada texto={formatearMoneda(a.monto_cent, { conSigno: a.tipo === 'reversa' })} cifra={`costos:aportacion:${a.mes}`} comprobacion={val?.cuadra === false ? 'no_cuadra' : 'cuadra'} /> },
          ]}
        />
      </Tarjeta>

      <Tarjeta plana titulo="Cuenta por reembolsar (solo lo no declarado como capital)" descripcion="Reembolsar reduce lo pendiente y no modifica ningún cargo">
        <DataTable
          plana
          densidad="densa"
          etiqueta="Movimientos de la cuenta de costos"
          clave={(m) => `${m.folio}`}
          filas={cuenta.movimientos}
          vacio={{ titulo: 'Sin movimientos', texto: 'Todavía no hay cargos ni reembolsos.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', ancho: 's', prioridadMovil: 'titulo', celda: (m) => m.folio },
            { id: 'd', titulo: 'Fecha', celda: (m) => etiquetaFecha(m.fecha_neg) },
            { id: 't', titulo: 'Tipo', celda: (m) => (m.tipo === 'cargo' ? 'Cargo' : m.tipo === 'reversa' ? 'Reversa' : 'Reembolso') },
            { id: 'c', titulo: 'Concepto', secundaria: true, celda: (m) => m.concepto },
            { id: 'm', titulo: 'Monto', numerica: true, prioridadMovil: 'principal', celda: (m) => formatearMoneda(m.monto_cent, { conSigno: true }) },
          ]}
        />
        {cuenta.pendiente_cent > 0n ? <FormularioReembolso aSocio="javier" pendienteCent={cuenta.pendiente_cent} hoy={hoy} /> : <p className="rtm-nota" data-testid="cuenta-sin-pendiente">{cuenta.pendiente_cent < 0n ? `Se reembolsó de más ${dinero(-cuenta.pendiente_cent)}: un cargo se anuló después de reembolsarse. Queda como saldo a favor de la sociedad con Javier.` : 'No hay nada pendiente de reembolsar.'}</p>}
      </Tarjeta>

      <Tarjeta titulo="Registrar un cargo">
        <FormularioCargo servicios={servicios} mesInicial={mes} hoy={hoy} tcDelDia={tc} />
      </Tarjeta>
      <Tarjeta titulo="Tipo de cambio">
        <FormularioTipoCambio hoy={hoy} />
      </Tarjeta>
      <p className="rtm-pie-marcas" data-testid="pie-marcas">{PIE_DE_MARCAS}</p>
    </Pagina>
  );
}
