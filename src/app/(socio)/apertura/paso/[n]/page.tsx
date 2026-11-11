import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { aperturaDeSocio } from '@/composicion/apertura';
import { pasoPorNumero } from '@/dominio/apertura/pasos';
import type { EstadoApertura, PartidaApertura } from '@/dominio/apertura/tipos';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { BotonEnsayo, Descartar, FijarCorte, Firmar, QuitarPartida, Resolucion, Reversar } from '../../acciones-sesion';
import { FormularioPartida } from '../../formulario-partida';

export const metadata: Metadata = { title: 'Apertura · paso' };

function detalle(p: PartidaApertura): string {
  return [p.socio, p.cliente, p.proveedor, p.modelo && `${p.modelo} ${p.sabor ?? ''}`.trim(), p.piezas != null && `${formatearPiezas(p.piezas)} pz`, p.costo_unit_cent != null && `a ${formatearMoneda(p.costo_unit_cent)}`, p.fecha_ref && `desde ${etiquetaFecha(p.fecha_ref)}`, p.descripcion]
    .filter(Boolean).join(' · ');
}

function Partidas({ e, categorias, editable }: { e: EstadoApertura; categorias: string[]; editable: boolean }) {
  const filas = e.partidas.filter((p) => categorias.includes(p.categoria));
  return (
    <DataTable
      etiqueta="Partidas cargadas en este paso"
      clave={(p) => p.id}
      filas={filas}
      vacio={{ titulo: 'Sin partidas en este paso', texto: 'Agrega la primera con el formulario. Nada se publica hasta que los dos socios firmen.' }}
      columnas={[
        { id: 'c', titulo: 'Concepto', celda: (p) => <>{p.nombre}<br /><span className="rtm-nota">{detalle(p)}</span></> },
        { id: 'k', titulo: 'Cuenta', secundaria: true, celda: (p) => <span className="rtm-mono">{p.cuenta}</span> },
        { id: 's', titulo: 'Sentido', secundaria: true, celda: (p) => (p.sentido === 'D' ? 'Debe' : 'Haber') },
        { id: 'm', titulo: 'Monto', numerica: true, celda: (p) => formatearMoneda(p.monto_cent) },
        { id: 'a', titulo: '', celda: (p) => (editable ? <QuitarPartida id={p.id} /> : null) },
      ]}
    />
  );
}

export default async function Pagina({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const paso = /^\d+$/.test(n) ? pasoPorNumero(Number(n)) : null;
  if (!paso) notFound();
  const lector = await aperturaDeSocio();
  const e = await lector.estado(null);
  const s = e.sesion && e.sesion.estado !== 'reversada' ? e.sesion : null;
  const editable = s?.estado === 'borrador';
  const v = s ? e.validacion : null;
  const encabezado = (
    <EncabezadoPagina eyebrow={`Apertura · paso ${paso.n} de 10`} antes="" enfasis={paso.titulo} contexto={paso.texto} />
  );
  if (!s) {
    return (
      <>
        {encabezado}
        <section className="rtm-seccion"><p className="rtm-nota" data-testid="sin-sesion">Primero abre una sesión de apertura en el <Link href="/apertura">resumen</Link>.</p></section>
      </>
    );
  }
  const catalogos = paso.categorias.length > 0 || paso.n === 2 ? await lector.catalogos() : null;
  const navegacion = (
    <p className="rtm-acciones-fila">
      {paso.n > 1 && <Link className="rtm-boton" href={`/apertura/paso/${paso.n - 1}`}>Paso anterior</Link>}
      {paso.n < 10 && <Link className="rtm-boton rtm-boton-primario" href={`/apertura/paso/${paso.n + 1}`} data-testid="paso-siguiente">Siguiente paso</Link>}
    </p>
  );

  if (paso.n === 1) {
    return (
      <>
        {encabezado}
        <section className="rtm-seccion" aria-label="Fecha de corte">
          <p data-testid="corte">Fecha de corte: <strong>{etiquetaFecha(s.fecha_corte)}</strong></p>
          {s.nota && <p className="rtm-nota">{s.nota}</p>}
          {editable ? <FijarCorte sesion={s.id} actual={s.fecha_corte} /> : <p className="rtm-nota">La sesión está en firma o firmada: no se cambia la fecha.</p>}
        </section>
        {navegacion}
      </>
    );
  }
  if (paso.n === 2 && catalogos) {
    const skus = catalogos.modelos.reduce((a, m) => a + m.sabores.length, 0);
    return (
      <>
        {encabezado}
        <section className="rtm-seccion" aria-label="Catálogo disponible">
          <div className="rtm-kpis" data-testid="catalogo-conteo">
            <div className="rtm-kpi"><span>Modelos</span><strong>{catalogos.modelos.length}</strong></div>
            <div className="rtm-kpi"><span>Modelo y sabor</span><strong>{skus}</strong></div>
            <div className="rtm-kpi"><span>Clientes</span><strong>{catalogos.clientes.length}</strong></div>
            <div className="rtm-kpi"><span>Proveedores</span><strong>{catalogos.proveedores.length}</strong></div>
          </div>
          <p className="rtm-nota">Si falta un modelo, sabor o cliente, agrégalo primero en Catálogo y Clientes; la apertura solo usa lo que ya existe, una vez.</p>
        </section>
        {navegacion}
      </>
    );
  }
  if (paso.categorias.length > 0 && catalogos) {
    const categorias = e.categorias.filter((c) => paso.categorias.includes(c.codigo));
    const dato = v?.pasos.find((x) => x.paso === paso.n);
    return (
      <>
        {encabezado}
        {dato && <p className="rtm-nota" data-testid="total-paso">Total de este paso: <strong>{formatearMoneda(dato.monto_cent)}</strong> en {dato.partidas} partidas.</p>}
        <Partidas e={e} categorias={paso.categorias} editable={editable} />
        {editable ? (
          <div className="rtm-acciones-fila">
            {categorias.map((c) => <FormularioPartida key={c.codigo} sesion={s.id} categoria={c} catalogos={catalogos} />)}
          </div>
        ) : (
          <p className="rtm-nota">La sesión está en firma o firmada. Para editar, retira tu firma en el paso 10.</p>
        )}
        {navegacion}
      </>
    );
  }
  if (paso.n === 9 && v) {
    const previa = await lector.vistaPrevia(s.id);
    return (
      <>
        {encabezado}
        <section className="rtm-seccion" aria-label="Identidad contable">
          <div className="rtm-identidad">
            <div className="rtm-kpi"><span>Activo</span><strong>{formatearMoneda(v.activo_cent)}</strong></div>
            <div className="rtm-kpi"><span>Pasivo</span><strong>{formatearMoneda(v.pasivo_cent)}</strong></div>
            <div className="rtm-kpi"><span>Capital</span><strong>{formatearMoneda(v.capital_cent)}</strong></div>
            <div className="rtm-kpi"><span>Diferencia (cuenta 3990)</span><strong data-testid="puente">{formatearMoneda(v.puente_cent)}</strong></div>
          </div>
          <p className="rtm-nota" data-testid="identidad-texto">
            Activo menos pasivo menos capital es la diferencia: {formatearMoneda(v.puente_cent)}. {v.puente_cent === 0n ? 'La apertura cuadra sin diferencia.' : 'Queda en la cuenta puente 3990 hasta que los dos socios firmen una resolución.'}
          </p>
          {v.alertas.length > 0 && <ul>{v.alertas.map((a) => <li key={a}>{a}</li>)}</ul>}
          <p className="rtm-nota">Resolución actual: <strong>{v.resolucion === 'mantener' ? 'mantener la diferencia en la cuenta 3990' : 'repartirla al capital 50/50'}</strong>{v.exige_justificacion ? ' · exige justificación escrita' : ''}.</p>
          {editable && <Resolucion sesion={s.id} resolucion={s.resolucion} justificacion={s.justificacion} />}
        </section>
        <section className="rtm-seccion" aria-label="Vista previa">
          <h2>Vista previa del asiento (no escribe)</h2>
          <DataTable
            etiqueta="Efecto de la apertura en cada cuenta"
            clave={(x) => x.cuenta}
            filas={previa.efecto}
            vacio={{ titulo: 'Sin efecto', texto: 'Agrega partidas para ver el asiento.' }}
            columnas={[
              { id: 'c', titulo: 'Cuenta', celda: (x) => <><span className="rtm-mono">{x.cuenta}</span> {x.nombre}</> },
              { id: 'a', titulo: 'Antes', numerica: true, secundaria: true, celda: (x) => formatearMoneda(x.antes_cent) },
              { id: 'p', titulo: 'Apertura', numerica: true, celda: (x) => formatearMoneda(x.apertura_cent) },
              { id: 'd', titulo: 'Después', numerica: true, celda: (x) => formatearMoneda(x.despues_cent) },
            ]}
          />
          <p className="rtm-nota" data-testid="previa-cuadra">Debe {formatearMoneda(previa.debe_cent)} · haber {formatearMoneda(previa.haber_cent)} · {previa.cuadra ? 'el asiento cuadra' : 'EL ASIENTO NO CUADRA'}.</p>
        </section>
        <section className="rtm-seccion" aria-label="Ensayo">
          <h2>Ensayo sobre una copia</h2>
          {v.listo_para_firma ? <BotonEnsayo sesion={s.id} /> : <p className="rtm-nota">El ensayo se habilita cuando la sesión está lista para firma.</p>}
        </section>
        {navegacion}
      </>
    );
  }
  // Paso 10: firma
  const firmas = e.firmas;
  const yaFirmo = firmas.some((f) => f.socio === e.yo);
  return (
    <>
      {encabezado}
      <section className="rtm-seccion" aria-label="Firmas">
        <p className="rtm-nota" data-testid="huella">Huella del contenido: <span className="rtm-mono">{(s.hash_firmado ?? v?.huella ?? '').slice(0, 24)}…</span></p>
        <DataTable
          etiqueta="Firmas de los socios"
          clave={(f) => f.socio}
          filas={firmas}
          vacio={{ titulo: 'Sin firmas', texto: 'Firman Angelo y Javier, cada uno desde su sesión. La segunda firma publica.' }}
          columnas={[
            { id: 's', titulo: 'Socio', celda: (f) => f.socio },
            { id: 'h', titulo: 'Firmó', celda: (f) => etiquetaFechaHora(f.firmada_at) },
            { id: 'x', titulo: 'Huella', secundaria: true, celda: (f) => <span className="rtm-mono">{f.hash.slice(0, 16)}…</span> },
          ]}
        />
        <p data-testid="estado-firma"><EstadoTexto tono={s.estado === 'firmada' ? 'ok' : 'atencion'}>{s.estado === 'firmada' ? 'Publicada' : s.estado === 'en_firma' ? `Falta la firma de ${firmas.length === 1 ? (firmas[0]!.socio === 'Angelo' ? 'Javier' : 'Angelo') : 'ambos socios'}` : 'Sin firmas'}</EstadoTexto></p>
        <p className="rtm-acciones-fila">
          {s.estado !== 'firmada' && v?.listo_para_firma && <Firmar sesion={s.id} yo={e.yo} yaFirmo={yaFirmo} />}
          {s.estado !== 'firmada' && v && !v.listo_para_firma && <span className="rtm-nota" data-testid="no-lista">No se puede firmar todavía: {v.alertas.join(' ')}</span>}
          {s.estado === 'firmada' && <Reversar sesion={s.id} />}
          {s.estado !== 'firmada' && <Descartar sesion={s.id} />}
        </p>
      </section>
      {navegacion}
    </>
  );
}
