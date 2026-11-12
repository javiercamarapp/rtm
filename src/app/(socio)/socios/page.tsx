import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSocio } from '@/composicion/acceso';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';
import { BotonAccion } from '../operacion/formulario-accion';
import { AccionesSocios } from './formularios';

export const metadata: Metadata = { title: 'Cuenta de socios' };

export default async function Pagina() {
  const { perfil } = await exigirSocio();
  const c = await (await operacionDeSocio()).cuentaSocios();
  const mio = perfil.socio_nombre === 'Angelo' || perfil.socio_nombre === 'Javier' ? perfil.socio_nombre : null;
  const d = c.javier_debe_a_angelo_cent;
  const parejo = d === 0n;
  const quien = d > 0n ? 'Javier debe a Angelo' : 'Angelo debe a Javier';
  const abs = d < 0n ? -d : d;
  const total = c.angelo.aportado_cent + c.javier.aportado_cent;
  const ancho = total > 0n ? Math.min(50, Number((abs * 100n) / (c.costo_cent > 0n ? c.costo_cent : total))) : 0;

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Cuenta de socios · ${etiquetaHoy()}`}
        antes={parejo ? 'La cuenta entre socios está' : `${quien}`}
        enfasis={parejo ? 'pareja' : formatearMoneda(abs)}
        contexto="Lo que puso cada uno contra la mitad del costo de la sociedad, calculado por dos vías. La empresa paga primero: gastos y capital se devuelven antes de repartir la utilidad 50/50."
        acciones={<AccionesSocios />}
      />

      <section className="rtm-bloque rtm-entra rtm-i-1" aria-label="Diferencia entre socios">
        <p className="rtm-nota">Diferencia por la compra (+ Javier debe a Angelo, − Angelo debe a Javier)</p>
        <p className="rtm-hero-cifra" data-testid="diferencia-socios"><CifraComprobada texto={formatearMoneda(d, { conSigno: true })} cifra="socios:diferencia" comprobacion={c.cuadra ? 'cuadra' : 'no_cuadra'} /></p>
        <div className="rtm-divergente" role="img" aria-label={parejo ? 'Cuenta pareja, cero al centro' : `${quien}: ${formatearMoneda(abs)}`}>
          {!parejo && (
            <svg className="rtm-divergente-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <pattern id="rtm-rayas" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" className="rtm-rayas-fondo" /><rect width="2" height="4" className="rtm-rayas-trazo" /></pattern>
              </defs>
              <rect x={d > 0n ? 50 : 50 - ancho} y="0" width={ancho} height="10" className={d > 0n ? 'rtm-divergente-der' : 'rtm-divergente-izq'} />
            </svg>
          )}
        </div>
        <div className="rtm-divergente-pie"><span>Angelo debe a Javier</span><span>0</span><span>Javier debe a Angelo</span></div>
        <p><EstadoTexto tono={c.cuadra ? 'ok' : 'atencion'}>{c.cuadra ? 'Cuadra por las dos vías' : 'No cuadra: parte del costo no lo pusieron los socios'}</EstadoTexto></p>
      </section>

      <div className="rtm-kpis rtm-entra rtm-i-2">
        <div className="rtm-kpi"><span>Costo de la compra</span><strong>{formatearMoneda(c.costo_cent)}</strong></div>
        <div className="rtm-kpi"><span>Mitad que toca a cada uno</span><strong>{formatearMoneda(c.mitad_cent)}</strong></div>
        <div className="rtm-kpi"><span>Puso Angelo</span><strong>{formatearMoneda(c.angelo.aportado_cent)}</strong></div>
        <div className="rtm-kpi"><span>Puso Javier</span><strong>{formatearMoneda(c.javier.aportado_cent)}</strong></div>
      </div>
      <p className="rtm-nota">Vía 1: lo que puso Angelo menos la mitad del costo = {formatearMoneda(c.via1_cent, { conSigno: true })}. Vía 2: (lo que puso Angelo − lo que puso Javier) ÷ 2 = {formatearMoneda(c.via2_cent, { conSigno: true })}.
        {c.financiado_por_sociedad_cent !== 0n ? ` Parte del costo, ${formatearMoneda(c.financiado_por_sociedad_cent)}, no la pusieron los socios.` : ''}</p>

      {c.partidas_fuera_sociedad.length > 0 && (
        <section className="rtm-seccion" aria-label="Fuera de la sociedad">
          <h2>Fuera de la sociedad (aparte)</h2>
          <DataTable etiqueta="Partidas fuera de la sociedad" clave={(p) => `${p.socio}-${p.concepto}`} filas={c.partidas_fuera_sociedad}
            columnas={[
              { id: 's', titulo: 'Socio', celda: (p) => p.socio }, { id: 'c', titulo: 'Concepto', celda: (p) => p.concepto },
              { id: 'm', titulo: 'Monto', numerica: true, celda: (p) => formatearMoneda(p.monto_cent) }, { id: 'e', titulo: 'Estado', secundaria: true, celda: (p) => p.estado.replaceAll('_', ' ') },
            ]} />
          <p className="rtm-nota">No entra al balance de la sociedad ni se mezcla con lo que un socio debe por un faltante.</p>
        </section>
      )}

      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Posición de cada socio">
        <h2>Cada socio con la sociedad</h2>
        <DataTable
          etiqueta="Posición de cada socio"
          clave={(s) => s.socio}
          filas={c.socios}
          columnas={[
            { id: 's', titulo: 'Socio', celda: (s) => <Link href={`/socios/${s.socio}`} data-testid={`estado-${s.socio}`}>{s.socio}</Link> },
            { id: 'n', titulo: 'Posición neta', numerica: true, celda: (s) => <><CifraComprobada texto={formatearMoneda(s.neto_cent, { conSigno: true })} cifra={`socio:neto:${s.socio}`} comprobacion="cuadra" /><span className="rtm-celda-sub">{s.neto_cent > 0n ? 'La sociedad le debe' : s.neto_cent < 0n ? 'Él debe' : 'En paz'}</span></> },
            { id: 'r', titulo: 'Reembolsos pendientes', numerica: true, secundaria: true, celda: (s) => formatearMoneda(s.reembolso_pendiente_cent) },
            { id: 'k', titulo: 'Capital por devolver', numerica: true, secundaria: true, celda: (s) => formatearMoneda(s.capital_pendiente_cent) },
            { id: 'f', titulo: 'Fondos de la sociedad en su poder', numerica: true, celda: (s) => <><CifraComprobada texto={formatearMoneda(s.fondos_cent)} cifra={`socio:fondos:${s.socio}`} comprobacion="cuadra" />{s.alerta_fondos && <span className="rtm-celda-sub"><EstadoTexto tono="atencion">Lleva {s.dias_fondos} días sin entregar</EstadoTexto></span>}</> },
          ]}
        />
        <div className="rtm-acciones-fila">{mio && <Link className="rtm-boton" href={`/socios/${mio}`} data-testid="ir-mi-desglose">Mi desglose ({mio})</Link>}<Link className="rtm-boton" href="/socios/cascada" data-testid="ir-cascada">Cascada de reparto</Link></div>
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Libro de movimientos entre socios">
        <h2>Libro de movimientos</h2>
        <DataTable
          etiqueta="Movimientos de la cuenta de socios"
          clave={(m) => `${m.tipo}-${m.id}`}
          filas={c.movimientos}
          vacio={{ titulo: 'Sin movimientos', texto: 'Aportaciones, gastos pagados por un socio, pagos y liquidaciones aparecerán aquí, cada uno con su eco y su deshacer.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', celda: (m) => etiquetaFecha(m.fecha_neg) },
            { id: 's', titulo: 'Socio', celda: (m) => m.socio },
            { id: 'c', titulo: 'Concepto', celda: (m) => <>{m.concepto}{m.deshecho ? ' (deshecho)' : ''}</> },
            { id: 'm', titulo: 'Monto', numerica: true, celda: (m) => formatearMoneda(m.monto_cent, { conSigno: true }) },
            { id: 'q', titulo: 'Quién', secundaria: true, celda: (m) => <>{m.autor ?? m.canal}<br /><span className="rtm-nota rtm-mono">{m.evento}</span>{m.mensaje_origen && <><br /><span className="rtm-nota">{m.mensaje_origen}</span></>}</> },
            { id: 'x', titulo: '', celda: (m) => (m.deshacible ? <BotonAccion chico texto="Deshacer" accion="anular_movimiento_socio" args={{ p_tipo: m.tipo, p_id: m.id }} motivo="Motivo" titulo="Deshacer captura" /> : null) },
          ]}
        />
      </section>
    </>
  );
}
