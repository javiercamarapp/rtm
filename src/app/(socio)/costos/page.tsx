import type { Metadata } from 'next';
import Link from 'next/link';
import { costosDeSocio } from '@/composicion/costos';
import { fechaNeg } from '@/dominio/calendario';
import { ETIQUETA_COSTO, pesosDeExactoE6, textoMicro, textoPct } from '@/dominio/costos/entrada';
import { formatearMoneda, etiquetaFecha } from '@/dominio/formato';
import { PIE_DE_MARCAS } from '@/dominio/marcas';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { LogoMarca } from '@/ui/marcas/logo-marca';
import { AnularCargo, FormularioReembolso, FormularioTipoCambio } from './acciones-costos';
import { FormularioCargo } from './formulario-cargo';

export const metadata: Metadata = { title: 'Costos de mantenimiento del sistema' };

const dinero = (c: bigint) => `$${formatearMoneda(c).replace('$', '')}`;

export default async function Pagina({ searchParams }: { searchParams: Promise<{ mes?: string; construccion?: string }> }) {
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

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Costos del sistema · ${mes}`}
        antes="Lo que cuesta"
        enfasis="mantener"
        despues="el sistema"
        contexto="Cada cargo es un gasto de la sociedad pagado por Javier y reembolsable. A cada servicio solo se le atribuye lo que RTM consume, con un solo redondeo, siempre hacia arriba."
      />
      <div className="rtm-filtros-estado" role="navigation" aria-label="Opciones del mes">
        <Link href={href(mes, !incluir)} aria-current={incluir ? 'true' : undefined} data-testid="costos-construccion">{incluir ? 'Sin sumar la construcción' : 'Sumar la construcción al total'}</Link>
      </div>

      <section className="rtm-seccion" aria-label="Resumen del mes">
        <dl className="rtm-resumen-costos" data-testid="costos-resumen">
          <div><dt>Costo mensual de operar{faltan ? ' (al menos)' : ''}</dt><dd data-testid="costos-operar">{dinero(resumen.operar.redondeado_cent)}</dd><dt>exacto {pesosDeExactoE6(BigInt(resumen.operar.exacto_e6))}</dt></div>
          <div><dt>Gasto total del mes{incluir ? ', con construcción' : ''}</dt><dd data-testid="costos-total">{dinero(t.redondeado_cent)}</dd><dt>exacto {pesosDeExactoE6(BigInt(t.exacto_e6))} · diferencia por redondeo {pesosDeExactoE6(BigInt(t.redondeado_cent) * 1_000_000n - BigInt(t.exacto_e6))}</dt></div>
          <div><dt>Claude y Higgsfield (opcionales)</dt><dd>{dinero(resumen.opcionales.redondeado_cent)}</dd><dt>construcción: {dinero(resumen.construccion.redondeado_cent)} (aparte)</dt></div>
          <div><dt>Pendiente de reembolsar a Javier</dt><dd data-testid="costos-pendiente">{dinero(cuenta.pendiente_cent)}</dd><dt>cargado {dinero(cuenta.cargado_cent)} · reembolsado {dinero(cuenta.reembolsado_cent)}</dt></div>
        </dl>
        {faltan && <p className="rtm-nota">Hay datos faltantes: {resumen.faltantes.map((f) => `${f.servicio} (${f.motivo})`).join(', ')}. El total dice "al menos" y el servicio queda en "Sin dato".</p>}
        <p className="rtm-nota">Tipo de cambio de referencia: {tc ? `${textoMicro(BigInt(tc.tc_micro), 4)} del ${etiquetaFecha(tc.fecha)} (${tc.fuente === 'manual' ? 'capturado' : 'Banxico, FIX'})` : 'Sin dato: captúralo abajo antes de registrar un cargo en dólares.'}</p>
      </section>

      <section className="rtm-seccion" aria-label="Servicios">
        <h2>Por servicio</h2>
        <ul className="rtm-tarjetas" data-testid="costos-servicios">
          {resumen.servicios.map((s) => (
            <li key={s.slug} className="rtm-tarjeta-costo" data-testid={`servicio-${s.slug}`}>
              <header><LogoMarca slug={s.logo_slug} nombre={s.servicio} alto={22} /><span className="rtm-nota">{s.fase === 'construccion' ? 'Construcción' : s.opcional ? 'Opcional' : 'Mantenimiento'}</span></header>
              <span className="rtm-nota">{s.servicio}</span>
              {s.cargos === 0 ? <span className="rtm-sin-dato">Sin cargos este mes</span> : (
                <>
                  <span className="rtm-cifra-grande">{dinero(s.redondeado_cent)}</span>
                  <span className="rtm-nota">exacto {pesosDeExactoE6(BigInt(s.exacto_e6))}{s.usd_micro ? ` · USD ${textoMicro(BigInt(s.usd_micro))}` : ''}</span>
                  {s.como_seria_cent !== null && s.como_deberia_cent !== null && <span className="rtm-nota">Como sería {dinero(s.como_seria_cent)} · como debería ser {dinero(s.como_deberia_cent)}</span>}
                  <span className="rtm-nota">{ETIQUETA_COSTO[s.ultima_etiqueta ?? ''] ?? ''} · {s.ultimo_estado === 'confirmado' ? 'Confirmado' : 'Provisional'}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rtm-seccion" aria-label="Cargos">
        <h2>Cargos</h2>
        <DataTable
          etiqueta="Cargos del mes"
          clave={(c) => c.id}
          filas={cargos}
          vacio={{ titulo: 'Sin cargos', texto: 'Registra el primer cargo del mes con el formulario de abajo.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (c) => <span data-testid={`cargo-folio-${c.id}`}>{c.folio}</span> },
            { id: 's', titulo: 'Servicio', celda: (c) => <LogoMarca slug={c.logo_slug} nombre={c.servicio} alto={18} /> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (c) => etiquetaFecha(c.fecha_neg) },
            { id: 'p', titulo: 'Base y porcentaje', secundaria: true, celda: (c) => <>{c.moneda} {textoMicro(BigInt(c.base_orig_micro))} · {textoPct(BigInt(c.pct_aplicado_ppm))} %<br /><span className="rtm-nota">TC {textoMicro(BigInt(c.tc_micro), 4)} ({etiquetaFecha(c.tc_fecha)})</span></> },
            { id: 'x', titulo: 'MXN exacto', numerica: true, secundaria: true, celda: (c) => pesosDeExactoE6(BigInt(c.exacto_mxn_e6)) },
            { id: 'm', titulo: 'MXN', numerica: true, celda: (c) => <span data-testid={`cargo-monto-${c.id}`}>{dinero(c.monto_cent)}</span> },
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
      </section>

      <section className="rtm-seccion" aria-label="Cuenta de costos entre socios">
        <h2>Cuenta de costos con Javier</h2>
        <p className="rtm-contexto">Lo que la sociedad le debe a Javier por costos del sistema. Reembolsar reduce lo pendiente y no modifica ningún cargo.</p>
        <DataTable
          etiqueta="Movimientos de la cuenta de costos"
          clave={(m) => `${m.folio}`}
          filas={cuenta.movimientos}
          vacio={{ titulo: 'Sin movimientos', texto: 'Todavía no hay cargos ni reembolsos.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (m) => m.folio },
            { id: 'd', titulo: 'Fecha', celda: (m) => etiquetaFecha(m.fecha_neg) },
            { id: 't', titulo: 'Tipo', celda: (m) => (m.tipo === 'cargo' ? 'Cargo' : m.tipo === 'reversa' ? 'Reversa' : 'Reembolso') },
            { id: 'c', titulo: 'Concepto', secundaria: true, celda: (m) => m.concepto },
            { id: 'm', titulo: 'Monto', numerica: true, celda: (m) => formatearMoneda(m.monto_cent, { conSigno: true }) },
          ]}
        />
        {cuenta.pendiente_cent > 0n ? <FormularioReembolso aSocio="javier" pendienteCent={cuenta.pendiente_cent} hoy={hoy} /> : <p className="rtm-nota" data-testid="cuenta-sin-pendiente">{cuenta.pendiente_cent < 0n ? `Se reembolsó de más ${dinero(-cuenta.pendiente_cent)}: un cargo se anuló después de reembolsarse. Queda como saldo a favor de la sociedad con Javier.` : 'No hay nada pendiente de reembolsar.'}</p>}
      </section>

      <section className="rtm-seccion" aria-label="Registrar un cargo">
        <h2>Registrar un cargo</h2>
        <FormularioCargo servicios={servicios} mesInicial={mes} hoy={hoy} tcDelDia={tc} />
      </section>
      <section className="rtm-seccion" aria-label="Tipo de cambio">
        <h2>Tipo de cambio</h2>
        <FormularioTipoCambio hoy={hoy} />
      </section>
      <p className="rtm-pie-marcas" data-testid="pie-marcas">{PIE_DE_MARCAS}</p>
    </>
  );
}
