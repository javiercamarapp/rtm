import { comprobarLiquidacion, estadoPago, pagosRecibidos, rentaAcumulada, rentaPorDia, resumenSemana, saldoAcumulado, tomasDeCuenta, type ResultadoProyeccion } from '@/dominio/omar/cuenta';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { Lectura, LiquidacionOmar, MovimientoCuenta } from '@/dominio/omar/tipos';
import { CifraComprobada } from '../componentes/cifra';
import { DataTable } from '../componentes/data-table';
import { KpiLinea } from '../componentes/kpi';
import { EstadoTexto, SinDato } from '../componentes/estado-texto';
import { TextoLectura } from './bodega';

/** Cifras de la semana en curso: renta devengada, acumulada, pagos recibidos y saldo. Cada una abre "Explicar este número". */
export function CifrasCuenta({ movs, liqs, semanaIni }: { movs: Lectura<MovimientoCuenta[]>; liqs: Lectura<LiquidacionOmar[]>; semanaIni: string }) {
  if (movs.estado !== 'ok') return <TextoLectura lectura={movs} pendiente="Tu cuenta aún no está disponible." />;
  const s = resumenSemana(movs.datos, semanaIni);
  const acum = rentaAcumulada(movs.datos);
  const saldo = liqs.estado === 'ok' ? saldoAcumulado(liqs.datos).saldo_cent : null;
  return (
    <div data-testid="cifras-cuenta">
      <KpiLinea
        etiquetaAria="Cifras de la semana"
        celdas={[
          { id: 'renta', etiqueta: 'Renta devengada de la semana', categoria: 1, valor: <CifraComprobada texto={formatearMoneda(s.renta_cent)} cifra={`omar:renta:${s.semana_ini}`} comprobacion="cuadra" />, nota: `${formatearPiezas(s.renta_piezas)} enviadas · ${etiquetaFecha(s.semana_ini)} al ${etiquetaFecha(s.semana_fin)}` },
          { id: 'acum', etiqueta: 'Renta devengada acumulada', categoria: 2, valor: <CifraComprobada texto={formatearMoneda(acum.cent)} cifra="omar:renta-acumulada" comprobacion="cuadra" />, nota: formatearPiezas(acum.piezas) },
          { id: 'pagos', etiqueta: 'Pagos recibidos esta semana', categoria: 3, valor: <CifraComprobada texto={formatearMoneda(s.recibido_cent)} cifra={`omar:recibido:${s.semana_ini}`} comprobacion="cuadra" /> },
          { id: 'saldo', etiqueta: 'Saldo de tu cuenta', categoria: 6, valor: <CifraComprobada texto={saldo === null ? null : formatearMoneda(saldo, { conSigno: true })} cifra="omar:saldo" comprobacion="cuadra" />, nota: saldo === null ? undefined : saldo > 0n ? 'Los socios te deben' : saldo < 0n ? 'Tú debes a los socios' : 'Saldo cero' },
        ]}
      />
    </div>
  );
}

const MOTIVO: Record<string, string> = {
  sin_tarifa: 'Aún no hay una tarifa de renta por pieza para estimar.',
  sin_paquetes: 'Falta la lectura de paquetes por preparar para estimar la semana.',
  sin_historia: 'Todavía no hay renta ni paquetes pendientes: no se emite estimación.',
};

/** Proyección de lo que se le debería pagar: siempre etiquetada Estimado, con rango. Sin historia, "Sin dato". */
export function BloqueProyeccion({ proyeccion }: { proyeccion: ResultadoProyeccion }) {
  if (proyeccion.tipo === 'sin_dato') {
    return (
      <section className="omar-estimado" aria-label="Proyección de tu pago" data-testid="proyeccion">
        <span className="omar-sello">Estimado</span>
        <p className="omar-cifra-valor"><SinDato /></p>
        <p className="rtm-nota">{MOTIVO[proyeccion.motivo]}</p>
      </section>
    );
  }
  const p = proyeccion.datos;
  return (
    <section className="omar-estimado" aria-label="Proyección de tu pago" data-testid="proyeccion">
      <span className="omar-sello">Estimado</span>
      <p className="omar-cifra-etiqueta">Renta de la semana al corte (rango)</p>
      <p className="omar-cifra-valor" data-testid="rango-renta">{formatearMoneda(p.minimo_cent)} a {formatearMoneda(p.maximo_cent)}</p>
      <p className="rtm-nota">Ya devengado {formatearMoneda(p.devengado_cent)} más {formatearPiezas(p.por_enviar_piezas)} por enviar a {formatearMoneda(p.tarifa_cent)} cada una. Si no se envían todas, queda cerca del piso.</p>
      <p className="omar-cifra-etiqueta">Tus tomas autorizadas de la semana</p>
      <p className="omar-cifra-media">{formatearMoneda(p.tomas_cent)}</p>
      <p className="omar-cifra-etiqueta">Lo que se te debería pagar al corte (neto estimado)</p>
      <p className="omar-cifra-valor" data-testid="neto-estimado">{formatearMoneda(p.neto_estimado_cent, { conSigno: true })}</p>
      <p className="rtm-nota">Con el piso: {formatearMoneda(p.neto_minimo_cent, { conSigno: true })}. Positivo: los socios te pagan. Negativo: tú pagas a los socios. Es una estimación, no un saldo; el cierre del lunes fija la cifra real.</p>
    </section>
  );
}

export function TablaRentaDia({ movs, semanaIni }: { movs: MovimientoCuenta[]; semanaIni: string }) {
  return (
    <DataTable plana densidad="densa" etiqueta="Renta devengada por día" clave={(d) => d.fecha} filas={rentaPorDia(movs, semanaIni)}
      vacio={{ titulo: 'Sin renta esta semana', texto: 'La renta se devenga cuando una pieza sale de tu bodega.' }}
      columnas={[
        { id: 'f', titulo: 'Día', prioridadMovil: 'titulo', celda: (d) => <>{etiquetaFecha(d.fecha)}{d.ajuste && <span className="rtm-celda-sub">incluye un ajuste</span>}</> },
        { id: 'p', titulo: 'Piezas', numerica: true, celda: (d) => formatearPiezas(d.piezas) },
        { id: 'i', titulo: 'Renta', numerica: true, prioridadMovil: 'principal', celda: (d) => formatearMoneda(d.importe) },
      ]} />
  );
}

export function TablaTransacciones({ movs }: { movs: MovimientoCuenta[] }) {
  return (
    <DataTable plana densidad="densa" etiqueta="Tus transacciones" clave={(m) => m.referencia} filas={tomasDeCuenta(movs).slice(0, 15)}
      vacio={{ titulo: 'Sin transacciones', texto: 'Las piezas que tomas, ya autorizadas, aparecen aquí.' }}
      columnas={[
        { id: 'r', titulo: 'Toma', prioridadMovil: 'titulo', celda: (m) => <span className="rtm-mono">{m.referencia}</span> },
        { id: 'f', titulo: 'Fecha', secundaria: true, celda: (m) => etiquetaFecha(m.fecha) },
        { id: 'p', titulo: 'Pieza', celda: (m) => `${m.modelo ?? ''}` },
        { id: 'n', titulo: 'Piezas', numerica: true, celda: (m) => formatearPiezas(m.piezas ?? 0) },
        { id: 'i', titulo: 'Importe', numerica: true, prioridadMovil: 'principal', celda: (m) => formatearMoneda(-m.importe) },
      ]} />
  );
}

export function TablaPagos({ movs }: { movs: MovimientoCuenta[] }) {
  return (
    <DataTable plana densidad="densa" etiqueta="Historial de pagos" clave={(m) => m.referencia} filas={pagosRecibidos(movs).slice(0, 20)}
      vacio={{ titulo: 'Sin pagos', texto: 'Aún no hay pagos registrados en tu cuenta.' }}
      columnas={[
        { id: 'r', titulo: 'Pago', prioridadMovil: 'titulo', celda: (m) => <span className="rtm-mono">{m.referencia}</span> },
        { id: 'f', titulo: 'Fecha', celda: (m) => etiquetaFecha(m.fecha) },
        { id: 's', titulo: 'Sentido', secundaria: true, celda: (m) => (m.importe > 0n ? 'Recibido' : 'Pagado por ti') },
        { id: 'i', titulo: 'Monto', numerica: true, prioridadMovil: 'principal', celda: (m) => formatearMoneda(m.importe > 0n ? m.importe : -m.importe) },
      ]} />
  );
}

const PAGO: Record<string, { texto: string; tono: 'ok' | 'atencion' | 'neutro' }> = {
  pagada: { texto: 'Pagada', tono: 'ok' },
  parcial: { texto: 'Pago parcial', tono: 'atencion' },
  pendiente: { texto: 'Pago pendiente', tono: 'atencion' },
  sin_saldo: { texto: 'Sin saldo', tono: 'neutro' },
};

/** Liquidación semanal con su comprobación (renta − tomas = neto) y el estado del pago. */
export function TablaLiquidaciones({ lectura }: { lectura: Lectura<LiquidacionOmar[]> }) {
  if (lectura.estado !== 'ok') return <TextoLectura lectura={lectura} pendiente="Tus liquidaciones aparecerán aquí cuando los socios habiliten esta lectura." />;
  return (
    <DataTable plana densidad="densa" etiqueta="Liquidaciones semanales" clave={(l) => l.folio} filas={lectura.datos}
      vacio={{ titulo: 'Sin liquidaciones', texto: 'La semana se cierra el lunes siguiente, con corte el lunes.' }}
      columnas={[
        { id: 'f', titulo: 'Semana', ancho: 'l', prioridadMovil: 'titulo', celda: (l) => <>{etiquetaFecha(l.semana_ini)} al {etiquetaFecha(l.semana_fin)}<span className="rtm-celda-sub rtm-mono">{l.folio}</span></> },
        { id: 'r', titulo: 'Renta', numerica: true, secundaria: true, celda: (l) => formatearMoneda(l.renta_cent) },
        { id: 't', titulo: 'Tomas', numerica: true, secundaria: true, celda: (l) => formatearMoneda(-l.tomas_cent) },
        { id: 'n', titulo: 'Neto', numerica: true, prioridadMovil: 'principal', celda: (l) => formatearMoneda(l.neto_cent, { conSigno: true }) },
        { id: 'c', titulo: 'Comprobación', secundaria: true, celda: (l) => <EstadoTexto tono={comprobarLiquidacion(l).cuadra ? 'ok' : 'malo'}>{comprobarLiquidacion(l).cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto> },
        { id: 'e', titulo: 'Estado', celda: (l) => { const e = estadoPago(l); const p = PAGO[e.estado]!; return <><EstadoTexto tono={p.tono}>{p.texto}</EstadoTexto>{e.falta_cent > 0n && <span className="rtm-celda-sub">Falta {formatearMoneda(e.falta_cent)}</span>}</>; } },
      ]} />
  );
}
