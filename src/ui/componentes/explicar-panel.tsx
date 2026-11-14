'use client';

// Contenido del panel "Explicar este numero": encabezado compacto y secciones colapsables con indice. Solo pinta lo que armarVista entrego (sin secciones vacias).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ordenarDetalle, paginar, csvDeDetalle, nombreArchivoCsv, POR_PAGINA, type ClaveOrden, type Sentido } from '@/dominio/explicar/tabla';
import { descripcionSerie, TITULOS, type FilaDetalle, type IdSeccion, type Modo, type Vista } from '@/dominio/explicar/vista';
import { AreaSerie, Cascada, BarrasDelta } from '@/ui/graficas';
import { GraficaLinea } from '@/ui/graficas/linea';

const ABIERTAS_AL_INICIO: readonly IdSeccion[] = ['definicion', 'origen', 'visual', 'comprobacion', 'detalle', 'supuestos'];

const Chevron = ({ abierta }: { abierta: boolean }) => (
  <svg className="xp-chevron" data-abierta={abierta} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function IconoCerrar() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

/** Encabezado: cifra grande, nombre, definicion en una linea, periodo o corte y estado en palabra. */
export function EncabezadoCifra({ vista, idTitulo }: { vista: Vista; idTitulo: string }) {
  return (
    <div className="xp-cifra-bloque">
      <div className="xp-meta">
        <span className="xp-estado" data-estado={vista.estado.clave} data-testid="explicar-estado">{vista.estado.texto}</span>
        {vista.periodo && <span className="xp-periodo">{vista.periodo}</span>}
        {vista.corte && <span className="xp-periodo">Corte {vista.corte}</span>}
      </div>
      <p className="xp-cifra rtm-num" data-testid="explicar-cifra">{vista.valorTexto ?? <span className="xp-sin-dato">Sin dato</span>}</p>
      <h2 id={idTitulo} className="xp-titulo">{vista.titulo}</h2>
      {vista.definicion && <p className="xp-definicion-corta">{vista.definicion}</p>}
    </div>
  );
}

function Seccion({ id, abierta, alternar, children, cuenta }: { id: IdSeccion; abierta: boolean; alternar: (id: IdSeccion) => void; children: ReactNode; cuenta?: number }) {
  return (
    <section className="xp-seccion" id={`xp-${id}`} data-abierta={abierta} aria-labelledby={`xp-${id}-t`}>
      <h3 className="xp-seccion-t" id={`xp-${id}-t`}>
        <button type="button" className="xp-seccion-b" aria-expanded={abierta} aria-controls={`xp-${id}-c`} onClick={() => alternar(id)}>
          <span>{TITULOS[id]}</span>
          {cuenta !== undefined && <span className="xp-cuenta">{cuenta}</span>}
          <Chevron abierta={abierta} />
        </button>
      </h3>
      <div className="xp-seccion-c" id={`xp-${id}-c`} hidden={!abierta}>{children}</div>
    </section>
  );
}

function Enlace({ href, texto }: { href: string; texto: string }) {
  return <a className="xp-enlace" href={href}>{texto}<span aria-hidden="true"> →</span></a>;
}

function TablaPartidas({ vista, modo }: { vista: Vista; modo: Modo }) {
  void modo;
  return (
    <div className="xp-tabla" role="table" aria-label="Partidas que forman la cifra">
      <div className="xp-fila xp-cab" role="row"><span role="columnheader">Partida</span><span role="columnheader" className="xp-der">Monto</span></div>
      {vista.partidas.map((p) => (
        <div key={p.id} className="xp-fila" role="row">
          <span role="cell" className="xp-celda-concepto">{p.concepto}<small className="xp-sub">{p.origen}{p.enlace && <> · <Enlace href={p.enlace.href} texto={p.enlace.texto} /></>}</small></span>
          <span role="cell" className="xp-der rtm-num xp-monto" data-negativo={p.monto < 0 || undefined}>{p.montoTexto}</span>
        </div>
      ))}
    </div>
  );
}

function TablaMargenes({ vista }: { vista: Vista }) {
  return (
    <div className="xp-tabla xp-tabla-margen" role="table" aria-label="Margen por proveedor">
      <div className="xp-fila xp-cab" role="row"><span role="columnheader">Proveedor</span><span role="columnheader" className="xp-der">Costo</span><span role="columnheader" className="xp-der">Margen</span><span role="columnheader">Cuadra</span></div>
      {vista.margenes.map((c) => (
        <div key={c.proveedor} className="xp-fila" role="row">
          <span role="cell" className="xp-celda-concepto">{c.proveedor}{c.supuesto && <span className="xp-etiqueta" data-tono="atencion">supuesto</span>}<small className="xp-sub">{c.fuente} · desde {c.desde}</small></span>
          <span role="cell" className="xp-der rtm-num">{c.costoTexto}</span>
          <span role="cell" className="xp-der rtm-num">{c.margenTexto}</span>
          <span role="cell"><span className="xp-etiqueta" data-tono={c.cuadra ? 'ok' : 'malo'}>{c.cuadra ? 'Sí' : 'No'}</span></span>
        </div>
      ))}
    </div>
  );
}

function VisualCifra({ vista }: { vista: Vista }) {
  const v = vista.visual;
  if (!v) return null;
  if (v.tipo === 'cascada') {
    return <Cascada titulo={v.titulo} descripcion={`De ${v.pasos.length - 1} partidas a ${vista.valorTexto ?? 'la cifra'}`} unidad={v.unidad} pasos={v.pasos} procedencia="observado" pie="Los importes son los de la base; el puente solo los acomoda." />;
  }
  if (v.tipo === 'barras') {
    return (<>
      <BarrasDelta titulo={v.titulo} descripcion={`Las ${v.datos.length} partidas mayores`} unidad={v.unidad} datos={v.datos} procedencia="observado" />
      {v.nota && <p className="xp-nota">{v.nota}</p>}
    </>);
  }
  return <TendenciaCifra titulo={v.titulo} puntos={v.puntos} unidad={v.unidad} conNegativos={v.conNegativos} />;
}

function TendenciaCifra({ titulo, puntos, unidad, conNegativos }: { titulo: string; puntos: Vista['serie']; unidad: string; conNegativos: boolean }) {
  if (conNegativos) return <GraficaLinea titulo={titulo} descripcion={descripcionSerie(puntos)} unidad={unidad} puntos={puntos.map((p) => ({ etiqueta: p.etiqueta, valor: p.valor, texto: p.texto }))} />;
  return <AreaSerie titulo={titulo} descripcion={descripcionSerie(puntos)} unidad={unidad} puntos={puntos} procedencia="observado" />;
}

function TablaSerie({ vista }: { vista: Vista }) {
  const ultimos = vista.serie.slice(-12).reverse();
  return (
    <div className="xp-tabla" role="table" aria-label="Valor por periodo">
      <div className="xp-fila xp-cab" role="row"><span role="columnheader">Periodo</span><span role="columnheader" className="xp-der">Valor</span></div>
      {ultimos.map((p) => <div key={p.id} className="xp-fila" role="row"><span role="cell">{p.etiqueta}</span><span role="cell" className="xp-der rtm-num">{p.texto}</span></div>)}
    </div>
  );
}

const ENCABEZADOS: { clave: ClaveOrden; titulo: string; der?: boolean }[] = [
  { clave: 'fecha', titulo: 'Fecha' }, { clave: 'concepto', titulo: 'Concepto' }, { clave: 'monto', titulo: 'Monto', der: true },
];

function descargar(nombre: string, contenido: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function TablaDetalle({ filas, cifra }: { filas: FilaDetalle[]; cifra: string }) {
  const [orden, setOrden] = useState<{ clave: ClaveOrden; sentido: Sentido }>({ clave: 'fecha', sentido: 'desc' });
  const [pagina, setPagina] = useState(0);
  const ordenadas = ordenarDetalle(filas, orden.clave, orden.sentido);
  const p = paginar(ordenadas, pagina, POR_PAGINA);
  const hayFolios = filas.some((f) => f.folio);
  const alternar = (clave: ClaveOrden) => { setOrden((o) => ({ clave, sentido: o.clave === clave && o.sentido === 'asc' ? 'desc' : 'asc' })); setPagina(0); };
  return (
    <>
      <div className="xp-barra-tabla">
        <span className="xp-nota" role="status">{filas.length} {filas.length === 1 ? 'movimiento' : 'movimientos'}{p.paginas > 1 ? ` · página ${p.pagina + 1} de ${p.paginas}` : ''}</span>
        <button type="button" className="xp-boton" onClick={() => descargar(nombreArchivoCsv(cifra), csvDeDetalle(ordenadas))}>Exportar CSV</button>
      </div>
      <div className="xp-tabla xp-tabla-detalle" role="table" aria-label="Movimientos que forman la cifra" data-con-saldo={filas.some((f) => f.saldoTexto !== null) || undefined}>
        <div className="xp-fila xp-cab" role="row">
          {ENCABEZADOS.map((h) => (
            <span key={h.clave} role="columnheader" className={h.der ? 'xp-der' : undefined} aria-sort={orden.clave === h.clave ? (orden.sentido === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" className="xp-orden" onClick={() => alternar(h.clave)}>{h.titulo}<span aria-hidden="true">{orden.clave === h.clave ? (orden.sentido === 'asc' ? ' ↑' : ' ↓') : ''}</span></button>
            </span>
          ))}
          <span role="columnheader" className="xp-der xp-col-saldo">Saldo</span>
        </div>
        {p.filas.map((f) => (
          <div key={f.id} className="xp-fila" role="row">
            <span role="cell" className="xp-fecha">{f.fechaTexto}</span>
            <span role="cell" className="xp-celda-concepto">{f.concepto}<small className="xp-sub">{hayFolios && f.folio && <span className="rtm-mono">{f.folio}</span>}{f.folio && ' · '}{f.origen}{f.nota && <> · {f.nota}</>}</small></span>
            <span role="cell" className="xp-der rtm-num xp-monto" data-negativo={f.monto < 0 || undefined}>{f.montoTexto}</span>
            <span role="cell" className="xp-der rtm-num xp-col-saldo">{f.saldoTexto ?? ''}</span>
          </div>
        ))}
      </div>
      {p.paginas > 1 && (
        <nav className="xp-paginas" aria-label="Páginas del detalle">
          <button type="button" className="xp-boton" disabled={p.pagina === 0} onClick={() => setPagina(p.pagina - 1)}>Anterior</button>
          <span className="xp-nota" aria-hidden="true">{p.pagina + 1} / {p.paginas}</span>
          <button type="button" className="xp-boton" disabled={p.pagina >= p.paginas - 1} onClick={() => setPagina(p.pagina + 1)}>Siguiente</button>
        </nav>
      )}
    </>
  );
}

/** Cuerpo del panel: indice corto de secciones y secciones colapsables. */
export function CuerpoCifra({ vista, modo }: { vista: Vista; modo: Modo }) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<IdSeccion>>(() => new Set(ABIERTAS_AL_INICIO.filter((s) => vista.secciones.includes(s))));
  const raiz = useRef<HTMLDivElement>(null);
  const alternar = useCallback((id: IdSeccion) => setAbiertas((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const ir = useCallback((id: IdSeccion) => {
    setAbiertas((a) => new Set(a).add(id));
    requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`#xp-${id}`)?.scrollIntoView?.({ block: 'start' }));
  }, []);
  useEffect(() => { raiz.current?.scrollTo?.({ top: 0 }); }, [vista.cifra]);
  const s = (id: IdSeccion) => vista.secciones.includes(id);
  const ab = (id: IdSeccion) => abiertas.has(id);
  return (
    <div className="xp-cuerpo" ref={raiz} data-testid="explicar-cuerpo">
      {vista.secciones.length > 2 && (
        <nav className="xp-indice" aria-label="Secciones de esta explicación">
          {vista.secciones.map((id) => <button key={id} type="button" className="xp-chip" onClick={() => ir(id)}>{TITULOS[id]}</button>)}
        </nav>
      )}
      {s('definicion') && (
        <Seccion id="definicion" abierta={ab('definicion')} alternar={alternar}>
          {vista.definicion && <p className="xp-texto">{vista.definicion}</p>}
          {vista.formula && (<>
            <p className="xp-texto">{vista.formula.palabras}</p>
            <p className="xp-formula" data-testid="explicar-formula"><code>{vista.formula.simbolos}</code></p>
          </>)}
        </Seccion>
      )}
      {s('origen') && (
        <Seccion id="origen" abierta={ab('origen')} alternar={alternar} cuenta={vista.partidas.length || undefined}>
          {vista.fuenteTexto && <p className="xp-texto" data-testid="explicar-fuente">{vista.fuenteTexto}</p>}
          {vista.resumenOrigen && <p className="xp-texto">{vista.resumenOrigen}</p>}
          {vista.precioTexto && <p className="xp-texto">Precio del tabulador {vista.precioTexto}. Margen = precio − costo.</p>}
          {vista.margenes.length > 0 && <TablaMargenes vista={vista} />}
          {vista.partidas.length > 0 && <TablaPartidas vista={vista} modo={modo} />}
          {vista.fuenteEnlace && <p className="xp-pie-seccion"><Enlace href={vista.fuenteEnlace.href} texto={vista.fuenteEnlace.texto} /></p>}
        </Seccion>
      )}
      {s('visual') && <Seccion id="visual" abierta={ab('visual')} alternar={alternar}><div className="xp-grafica"><VisualCifra vista={vista} /></div></Seccion>}
      {s('comprobacion') && vista.comprobacion && (
        <Seccion id="comprobacion" abierta={ab('comprobacion')} alternar={alternar}>
          <dl className="xp-vias">
            <div><dt>Vía 1</dt><dd><span>{vista.comprobacion.via1}</span><strong className="rtm-num">{vista.comprobacion.via1Texto}</strong></dd></div>
            <div><dt>Vía 2</dt><dd><span>{vista.comprobacion.via2}</span><strong className="rtm-num">{vista.comprobacion.via2Texto}</strong></dd></div>
          </dl>
          <p className="xp-semaforo" data-estado={vista.comprobacion.cuadra ? 'cuadra' : 'no_cuadra'} role="status">
            <span className="xp-punto" aria-hidden="true" />{vista.comprobacion.cuadra ? 'Cuadra' : 'No cuadra'}
            {vista.comprobacion.diferenciaTexto !== null && <span className="xp-diferencia"> · Diferencia {vista.comprobacion.diferenciaTexto}</span>}
          </p>
        </Seccion>
      )}
      {s('detalle') && <Seccion id="detalle" abierta={ab('detalle')} alternar={alternar} cuenta={vista.detalle.length}><TablaDetalle filas={vista.detalle} cifra={vista.cifra} /></Seccion>}
      {s('supuestos') && (
        <Seccion id="supuestos" abierta={ab('supuestos')} alternar={alternar}>
          <ul className="xp-lista">{vista.supuestos.map((t) => <li key={t}>{t}</li>)}</ul>
        </Seccion>
      )}
      {s('historial') && (
        <Seccion id="historial" abierta={ab('historial')} alternar={alternar}>
          {vista.visual?.tipo !== 'tendencia' && <div className="xp-grafica"><TendenciaCifra titulo="Cómo ha cambiado" puntos={vista.serie} unidad={vista.unidad === 'pz' ? 'Piezas' : 'Saldo'} conNegativos={vista.serie.some((p) => p.valor < 0)} /></div>}
          <TablaSerie vista={vista} />
        </Seccion>
      )}
      {s('cuentas') && (
        <Seccion id="cuentas" abierta={ab('cuentas')} alternar={alternar} cuenta={vista.cuentas.length}>
          <div className="xp-tabla" role="table" aria-label="Cuentas del libro">
            <div className="xp-fila xp-cab" role="row"><span role="columnheader">Cuenta</span><span role="columnheader" className="xp-der">Saldo</span></div>
            {vista.cuentas.map((c) => (
              <div key={c.codigo} className="xp-fila" role="row">
                <span role="cell" className="xp-celda-concepto"><span className="rtm-mono">{c.codigo}</span> {c.nombre}{c.enlace && <small className="xp-sub"><Enlace href={c.enlace.href} texto={c.enlace.texto} /></small>}</span>
                <span role="cell" className="xp-der rtm-num">{c.saldoTexto ?? ''}</span>
              </div>
            ))}
          </div>
        </Seccion>
      )}
      {s('glosario') && (
        <Seccion id="glosario" abierta={ab('glosario')} alternar={alternar}>
          <dl className="xp-glosario">{vista.glosario.map((t) => <div key={t.termino}><dt>{t.termino}</dt><dd>{t.definicion}</dd></div>)}</dl>
        </Seccion>
      )}
      {vista.secciones.length === 0 && <p className="xp-vacio">Esta cifra no trae más detalle desde la base. Su valor está arriba.</p>}
    </div>
  );
}
