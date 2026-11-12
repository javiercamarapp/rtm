import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { aperturaDeSocio } from '@/composicion/apertura';
import { pasoPorNumero } from '@/dominio/apertura/pasos';
import type { EstadoApertura, PartidaApertura } from '@/dominio/apertura/tipos';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { Aviso } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { BotonEnsayo, Descartar, FijarCorte, Firmar, QuitarPartida, Resolucion, Reversar } from '../../acciones-sesion';
import { FormularioPartida } from '../../formulario-partida';

export const metadata: Metadata = { title: 'Apertura · paso' };

function detalle(p: PartidaApertura): string {
  return [p.socio, p.cliente, p.proveedor, p.modelo && `${p.modelo} ${p.sabor ?? ''}`.trim(), p.piezas != null && `${formatearPiezas(p.piezas)} pz`, p.costo_unit_cent != null && `a ${formatearMoneda(p.costo_unit_cent)}`, p.fecha_ref && `desde ${etiquetaFecha(p.fecha_ref)}`, p.descripcion]
    .filter(Boolean).join(' · ');
}

function Partidas({ e, categorias, editable }: { e: EstadoApertura; categorias: string[]; editable: boolean }) {
  const filas = e.partidas.filter((p) => categorias.includes(p.categoria));
  const total = filas.reduce((a, p) => a + p.monto_cent, 0n);
  return (
    <DataTable
      etiqueta="Partidas cargadas en este paso"
      densidad="densa" plana pegajosa
      clave={(p) => p.id}
      filas={filas}
      totales={filas.length ? { etiqueta: `Total (${filas.length})`, celdas: { m: formatearMoneda(total) } } : undefined}
      vacio={{ titulo: 'Sin partidas en este paso', texto: 'Agrega la primera con el formulario. Nada se publica hasta que los dos socios firmen.' }}
      columnas={[
        { id: 'c', titulo: 'Concepto', ancho: 'xl', prioridadMovil: 'titulo', celda: (p) => <>{p.nombre}<span className="rtm-celda-sub">{detalle(p)}</span></> },
        { id: 'k', titulo: 'Cuenta', ancho: 's', prioridadMovil: 'normal', celda: (p) => <span className="rtm-mono">{p.cuenta}</span> },
        { id: 's', titulo: 'Sentido', ancho: 's', prioridadMovil: 'normal', celda: (p) => (p.sentido === 'D' ? 'Debe' : 'Haber') },
        { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (p) => formatearMoneda(p.monto_cent) },
        { id: 'a', titulo: 'Acción', ancho: 's', prioridadMovil: 'normal', celda: (p) => (editable ? <QuitarPartida id={p.id} /> : null) },
      ]}
    />
  );
}

export default async function PaginaPaso({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const paso = /^\d+$/.test(n) ? pasoPorNumero(Number(n)) : null;
  if (!paso) notFound();
  const lector = await aperturaDeSocio();
  const e = await lector.estado(null);
  const s = e.sesion && e.sesion.estado !== 'reversada' ? e.sesion : null;
  const editable = s?.estado === 'borrador';
  const v = s ? e.validacion : null;
  const encabezado = (
    <EncabezadoPagina eyebrow={`Apertura · paso ${paso.n} de 10`} titulo={`${paso.n}. ${paso.titulo}`} descripcion={paso.texto} migaja={{ href: '/apertura', texto: 'Resumen de la apertura' }} />
  );
  if (!s) {
    return (
      <Pagina ancho="normal">
        {encabezado}
        <Tarjeta><p className="rtm-nota" data-testid="sin-sesion">Primero abre una sesión de apertura en el <Link href="/apertura">resumen</Link>.</p></Tarjeta>
      </Pagina>
    );
  }
  const catalogos = paso.categorias.length > 0 || paso.n === 2 ? await lector.catalogos() : null;
  const navegacion = (
    <div className="rtm-acciones-fila">
      {paso.n > 1 && <Link className="rtm-boton" href={`/apertura/paso/${paso.n - 1}`}>Paso anterior</Link>}
      {paso.n < 10 && <Link className="rtm-boton rtm-boton-primario" href={`/apertura/paso/${paso.n + 1}`} data-testid="paso-siguiente">Siguiente paso</Link>}
    </div>
  );

  if (paso.n === 1) {
    return (
      <Pagina ancho="formulario">
        {encabezado}
        <Tarjeta titulo="Fecha de corte" descripcion="La apertura se publica con esta fecha">
          <p data-testid="corte">Fecha de corte: <strong>{etiquetaFecha(s.fecha_corte)}</strong></p>
          {s.nota && <p className="rtm-nota">{s.nota}</p>}
          {editable ? <FijarCorte sesion={s.id} actual={s.fecha_corte} /> : <p className="rtm-nota">La sesión está en firma o firmada: no se cambia la fecha.</p>}
        </Tarjeta>
        {navegacion}
      </Pagina>
    );
  }
  if (paso.n === 2 && catalogos) {
    const skus = catalogos.modelos.reduce((a, m) => a + m.sabores.length, 0);
    return (
      <Pagina ancho="normal">
        {encabezado}
        <div data-testid="catalogo-conteo">
          <KpiLinea
            etiquetaAria="Catálogo disponible"
            celdas={[
              { id: 'm', etiqueta: 'Modelos', valor: String(catalogos.modelos.length), categoria: 1 },
              { id: 's', etiqueta: 'Modelo y sabor', valor: String(skus), categoria: 2 },
              { id: 'c', etiqueta: 'Clientes', valor: String(catalogos.clientes.length), categoria: 4 },
              { id: 'p', etiqueta: 'Proveedores', valor: String(catalogos.proveedores.length), categoria: 3 },
            ]}
          />
        </div>
        <Aviso tono="info">Si falta un modelo, sabor o cliente, agrégalo primero en Catálogo y Clientes; la apertura solo usa lo que ya existe, una vez.</Aviso>
        {navegacion}
      </Pagina>
    );
  }
  if (paso.categorias.length > 0 && catalogos) {
    const categorias = e.categorias.filter((c) => paso.categorias.includes(c.codigo));
    const dato = v?.pasos.find((x) => x.paso === paso.n);
    return (
      <Pagina ancho="tablero">
        {encabezado}
        {dato && (
          <KpiLinea
            etiquetaAria="Total del paso"
            celdas={[
              { id: 't', etiqueta: 'Total de este paso', testid: 'total-paso', valor: formatearMoneda(dato.monto_cent), categoria: 1, nota: `${dato.partidas} partidas` },
              { id: 'p', etiqueta: 'Partidas', valor: String(dato.partidas), categoria: 2 },
              { id: 'e', etiqueta: 'Estado del paso', valor: dato.estado === 'con_datos' ? 'Con datos' : 'Sin partidas', categoria: dato.estado === 'con_datos' ? 3 : 6 },
            ]}
          />
        )}
        <Tarjeta plana titulo="Partidas cargadas" descripcion="Nada se publica hasta que los dos socios firmen">
          <Partidas e={e} categorias={paso.categorias} editable={editable} />
        </Tarjeta>
        {editable ? (
          <Tarjeta titulo="Agregar una partida">
            <div className="rtm-acciones-fila">
              {categorias.map((c) => <FormularioPartida key={c.codigo} sesion={s.id} categoria={c} catalogos={catalogos} />)}
            </div>
          </Tarjeta>
        ) : (
          <Aviso tono="atencion">La sesión está en firma o firmada. Para editar, retira tu firma en el paso 10.</Aviso>
        )}
        {navegacion}
      </Pagina>
    );
  }
  if (paso.n === 9 && v) {
    const previa = await lector.vistaPrevia(s.id);
    return (
      <Pagina ancho="tablero">
        {encabezado}
        <KpiLinea
          etiquetaAria="Identidad contable"
          celdas={[
            { id: 'a', etiqueta: 'Activo', valor: formatearMoneda(v.activo_cent), categoria: 1 },
            { id: 'p', etiqueta: 'Pasivo', valor: formatearMoneda(v.pasivo_cent), categoria: 3 },
            { id: 'c', etiqueta: 'Capital', valor: formatearMoneda(v.capital_cent), categoria: 2 },
            { id: 'u', etiqueta: 'Diferencia (cuenta 3990)', testid: 'puente', valor: <span data-testid="puente">{formatearMoneda(v.puente_cent)}</span>, categoria: 6, nota: v.puente_cent === 0n ? 'Cuadra' : 'En la cuenta puente' },
          ]}
        />
        <Tarjeta titulo="Identidad y resolución">
          <p className="rtm-nota" data-testid="identidad-texto">
            Activo menos pasivo menos capital es la diferencia: {formatearMoneda(v.puente_cent)}. {v.puente_cent === 0n ? 'La apertura cuadra sin diferencia.' : 'Queda en la cuenta puente 3990 hasta que los dos socios firmen una resolución.'}
          </p>
          {v.alertas.map((a) => <Aviso key={a} tono="atencion">{a}</Aviso>)}
          <p className="rtm-nota">Resolución actual: <strong>{v.resolucion === 'mantener' ? 'mantener la diferencia en la cuenta 3990' : 'repartirla al capital 50/50'}</strong>{v.exige_justificacion ? ' · exige justificación escrita' : ''}.</p>
          {editable && <Resolucion sesion={s.id} resolucion={s.resolucion} justificacion={s.justificacion} />}
        </Tarjeta>
        <Tarjeta plana titulo="Vista previa del asiento (no escribe)">
          <DataTable
            etiqueta="Efecto de la apertura en cada cuenta"
            densidad="densa" plana pegajosa primeraFija
            clave={(x) => x.cuenta}
            filas={previa.efecto}
            totales={previa.efecto.length ? { etiqueta: 'Debe y haber', celdas: { p: `${formatearMoneda(previa.debe_cent)} / ${formatearMoneda(previa.haber_cent)}` } } : undefined}
            vacio={{ titulo: 'Sin efecto', texto: 'Agrega partidas para ver el asiento.' }}
            columnas={[
              { id: 'c', titulo: 'Cuenta', ancho: 'xl', prioridadMovil: 'titulo', celda: (x) => <><span className="rtm-mono">{x.cuenta}</span> {x.nombre}</> },
              { id: 'a', titulo: 'Antes', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (x) => formatearMoneda(x.antes_cent) },
              { id: 'p', titulo: 'Apertura', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (x) => formatearMoneda(x.apertura_cent) },
              { id: 'd', titulo: 'Después', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (x) => formatearMoneda(x.despues_cent) },
            ]}
          />
          <p className="rtm-nota rtm-nota-tarjeta" data-testid="previa-cuadra">Debe {formatearMoneda(previa.debe_cent)} · haber {formatearMoneda(previa.haber_cent)} · {previa.cuadra ? 'el asiento cuadra' : 'EL ASIENTO NO CUADRA'}.</p>
        </Tarjeta>
        <Tarjeta titulo="Ensayo sobre una copia" descripcion="Prueba la publicación sin escribir en el libro real">
          {v.listo_para_firma ? <BotonEnsayo sesion={s.id} /> : <p className="rtm-nota">El ensayo se habilita cuando la sesión está lista para firma.</p>}
        </Tarjeta>
        {navegacion}
      </Pagina>
    );
  }
  // Paso 10: firma
  const firmas = e.firmas;
  const yaFirmo = firmas.some((f) => f.socio === e.yo);
  return (
    <Pagina ancho="formulario">
      {encabezado}
      <Tarjeta plana titulo="Firmas de los socios" descripcion="Firman Angelo y Javier, cada uno desde su sesión; la segunda firma publica">
        <div className="rtm-importador-nota"><p className="rtm-nota" data-testid="huella">Huella del contenido: <span className="rtm-mono">{(s.hash_firmado ?? v?.huella ?? '').slice(0, 24)}…</span></p></div>
        <DataTable
          etiqueta="Firmas de los socios"
          densidad="densa" plana
          clave={(f) => f.socio}
          filas={firmas}
          vacio={{ titulo: 'Sin firmas', texto: 'Firman Angelo y Javier, cada uno desde su sesión. La segunda firma publica.' }}
          columnas={[
            { id: 's', titulo: 'Socio', ancho: 'm', prioridadMovil: 'titulo', celda: (f) => f.socio },
            { id: 'h', titulo: 'Firmó', ancho: 'l', prioridadMovil: 'normal', celda: (f) => etiquetaFechaHora(f.firmada_at) },
            { id: 'x', titulo: 'Huella', ancho: 'm', prioridadMovil: 'normal', celda: (f) => <span className="rtm-mono">{f.hash.slice(0, 16)}…</span> },
          ]}
        />
      </Tarjeta>
      <Tarjeta titulo="Estado de la firma">
        <p className="rtm-nota" data-testid="estado-firma"><EstadoTexto tono={s.estado === 'firmada' ? 'ok' : 'atencion'}>{s.estado === 'firmada' ? 'Publicada' : s.estado === 'en_firma' ? `Falta la firma de ${firmas.length === 1 ? (firmas[0]!.socio === 'Angelo' ? 'Javier' : 'Angelo') : 'ambos socios'}` : 'Sin firmas'}</EstadoTexto></p>
        <div className="rtm-acciones-fila">
          {s.estado !== 'firmada' && v?.listo_para_firma && <Firmar sesion={s.id} yo={e.yo} yaFirmo={yaFirmo} />}
          {s.estado !== 'firmada' && v && !v.listo_para_firma && <span className="rtm-nota" data-testid="no-lista">No se puede firmar todavía: {v.alertas.join(' ')}</span>}
          {s.estado === 'firmada' && <Reversar sesion={s.id} />}
          {s.estado !== 'firmada' && <Descartar sesion={s.id} />}
        </div>
      </Tarjeta>
      {navegacion}
    </Pagina>
  );
}
