import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { datosDeSocio } from '@/composicion/datos';
import { inventarioDeSocio } from '@/composicion/inventario';
import { PALABRA_COBERTURA, TONO_COBERTURA, URGENCIA_COBERTURA, textoDias } from '@/dominio/inventario/cobertura';
import type { EstadoCoberturaCodigo, ModeloInventario, SaborInventario } from '@/dominio/inventario/tipos';
import { etiquetaFechaHora, formatearMoneda, formatearPiezas, marcaMayus, nombreVape } from '@/dominio/formato';
import { BarraAcciones } from '@/ui/componentes/barra-acciones';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { ChipEstado, Pestanas } from '@/ui/componentes/controles';
import { FiltroCatalogo } from '@/ui/componentes/filtro-catalogo';
import { MenuFiltro } from '@/ui/componentes/menu-filtro';
import { ModeloMiniatura } from '@/ui/componentes/modelo';
import { atajosDeMarcas, marcasDeParam } from '@/dominio/catalogo/filtro';
import { BarList } from '@/ui/componentes/datos';
import { DataTable, type Columna } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { CoberturaDias, MapaCalor } from '@/ui/graficas';
import { etiquetaHoy } from '../contexto';
import { Campo, FiltrosUrl } from '../_a2/filtros-url';
import { acumularPorTramo, TRAMOS } from '../_a2/antiguedad';
import { dec, diasEntre, enlace, m, partePct, periodo, pctTexto, pz, pzs, fechaCorta, textoParam, tonoChip, uno, type Params } from '../_a2/util';
import { ExportarInventario } from './exportar-inventario';
import { PanelConcilia } from './concilia';
import '@/ui/estilos/barrido-b.css';

export const metadata: Metadata = { title: 'Inventario' };

const FILTROS: { id: string; etiqueta: string; estados: EstadoCoberturaCodigo[] }[] = [
  { id: 'reponer', etiqueta: 'Por reponer', estados: ['urge', 'brevedad', 'siguiente'] },
  { id: 'sobrestock', etiqueta: 'Sobrestock', estados: ['sobrestock'] },
  { id: 'sin_historia', etiqueta: 'Sin historia', estados: ['sin_historia'] },
  { id: 'sin_movimiento', etiqueta: 'Sin movimiento', estados: ['sin_movimiento'] },
];

type Fila = { clave: string; mod: ModeloInventario; s: SaborInventario | null };

export default async function PaginaInventario({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const vista = ['compras', 'documentos', 'sin-movimientos'].includes(uno(sp.vista) ?? '') ? (uno(sp.vista) as string) : 'existencias';
  const per = periodo(sp, 30);
  const [inv, documentos, clientes, detalle, concilia] = await Promise.all([
    (await inventarioDeSocio()).completo(), (await inventarioDeSocio()).documentos(), (await lectorDeSocio()).clientes(), (await datosDeSocio()).detalleInventario(per.ini, per.fin), (await inventarioDeSocio()).concilia(),
  ]);
  const conDato = inv.modelos.filter((x) => x.piezas !== null);
  const sinMovimientos = inv.modelos.filter((x) => x.piezas === null);
  const filtro = FILTROS.find((f) => f.id === sp.estado) ?? null;
  const marcas = [...new Set(conDato.map((x) => x.marca))];
  const elegidas = marcasDeParam(sp.marca).filter((x) => marcas.includes(x));
  const soloCero = uno(sp.solo) === 'cero';
  const soloApartado = uno(sp.solo) === 'apartado';
  const q = textoParam(sp.q)?.toLowerCase() ?? null;
  const base = '/inventario';
  const hoy = inv.hoy;

  const detMod = new Map(detalle.modelos.map((d) => [d.modelo_id, d]));
  const detSku = new Map(detalle.sabores.map((d) => [d.sku_id, d]));
  const visibles = conDato
    .filter((x) => (!filtro || (x.estado !== null && filtro.estados.includes(x.estado))) && (elegidas.length === 0 || elegidas.includes(x.marca)) && (!soloCero || (x.piezas ?? 0) <= 0) && (!soloApartado || (x.reservado ?? 0) > 0)
      && (!q || `${x.marca} ${x.modelo} ${x.sabores.map((s) => s.sabor).join(' ')}`.toLowerCase().includes(q)))
    .sort((a, b) => URGENCIA_COBERTURA[a.estado ?? 'sin_historia'] - URGENCIA_COBERTURA[b.estado ?? 'sin_historia'] || Number((b.valor_cent ?? 0n) - (a.valor_cent ?? 0n)) || a.modelo.localeCompare(b.modelo, 'es'));
  const cuenta = (f: (typeof FILTROS)[number]) => conDato.filter((x) => x.estado !== null && f.estados.includes(x.estado)).length;
  const porReponer = cuenta(FILTROS[0]!);
  const agotados = conDato.filter((x) => (x.piezas ?? 0) <= 0).length;
  const p = inv.parametros;
  const ltMin = Math.min(...Object.values(p.lt_dias));

  const rot = (ini: number | null | undefined, act: number, sal: number): string | null => {
    const media = ((ini ?? 0) + act) / 2;
    return media > 0 ? dec(sal / media, 2) : null;
  };
  const ant = (u: string | null | undefined) => (u ? diasEntre(u, hoy) : null);
  const totalValor = inv.totales.valor_cent;

  const filas: Fila[] = visibles.flatMap((x): Fila[] => (x.sabores.length ? x.sabores.map((s) => ({ clave: `${x.modelo_id}-${s.sku_id}`, mod: x, s })) : [{ clave: `${x.modelo_id}-0`, mod: x, s: null }]));
  const suma = visibles.reduce((a, x) => ({ piezas: a.piezas + (x.piezas ?? 0), res: a.res + (x.reservado ?? 0), disp: a.disp + (x.disponible ?? 0), valor: a.valor + (x.valor_cent ?? 0n), ent: a.ent + (detMod.get(x.modelo_id)?.entradas ?? 0), sal: a.sal + (detMod.get(x.modelo_id)?.salidas ?? 0) }), { piezas: 0, res: 0, disp: 0, valor: 0n, ent: 0, sal: 0 });

  const semaforo = (e: EstadoCoberturaCodigo | null, id: string) => (e === null ? <SinDato /> : <span data-testid={`semaforo-${id}`}><ChipEstado tono={tonoChip(TONO_COBERTURA[e])}>{PALABRA_COBERTURA[e]}</ChipEstado></span>);

  const columnas: Columna<Fila>[] = [
    { id: 'mo', titulo: 'Modelo › sabor', prioridadMovil: 'titulo', ancho: 'l', celda: (f) => (f.s ? f.s.sabor : 'Sin sabores registrados') },
    { id: 'p', titulo: 'Piezas', prioridadMovil: 'principal', numerica: true, ancho: 's', resaltar: (f) => ((f.s ? f.s.piezas : f.mod.piezas ?? 0) === 0 ? 'cero' : (f.s ? f.s.piezas : f.mod.piezas ?? 0) < 0 ? 'negativo' : null), celda: (f) => (f.s ? pzs(f.s.piezas) : pzs(f.mod.piezas)) },
    { id: 'a', titulo: 'Apart.', etiquetaMovil: 'Apartadas', prioridadMovil: 'normal', numerica: true, ancho: 's', celda: (f) => (f.s ? pzs(f.s.reservado) : pzs(f.mod.reservado)) },
    { id: 'd', titulo: 'Disp.', etiquetaMovil: 'Disponibles', prioridadMovil: 'normal', numerica: true, ancho: 's', celda: (f) => (f.s ? pzs(f.s.disponible) : pzs(f.mod.disponible)) },
    { id: 'cu', titulo: 'Costo', prioridadMovil: 'oculta', numerica: true, ancho: 'm', celda: (f) => (f.mod.costo_prom_cent === null || (f.mod.piezas ?? 0) === 0 ? <SinDato /> : m(f.mod.costo_prom_cent)) },
    { id: 'v', titulo: 'Valor total', prioridadMovil: 'normal', numerica: true, ancho: 'l', celda: (f) => (f.s ? m(f.s.valor_cent) : (m(f.mod.valor_cent) ?? <SinDato />)) },
    { id: 'pc', titulo: '% del total', prioridadMovil: 'oculta', numerica: true, ancho: 's', celda: (f) => pctTexto(partePct((f.s ? f.s.valor_cent : f.mod.valor_cent) ?? 0n, totalValor)) ?? <SinDato /> },
    { id: 'c', titulo: 'Cobertura', prioridadMovil: 'normal', numerica: true, ancho: 's', celda: (f) => (f.s ? (f.s.cobertura_dias === null ? <SinDato /> : textoDias(f.s.cobertura_dias)) : (f.mod.cobertura_dias === null ? <SinDato /> : <CifraComprobada texto={textoDias(f.mod.cobertura_dias)} cifra={`cobertura:modelo:${f.mod.modelo_id}`} comprobacion="cuadra" />)) },
    { id: 's', titulo: 'Semáforo', prioridadMovil: 'normal', ancho: 'm', celda: (f) => semaforo(f.s ? f.s.estado : f.mod.estado, f.s ? `${f.mod.modelo_id}-${f.s.sku_id}` : String(f.mod.modelo_id)) },
    { id: 'en', titulo: 'Entr.', etiquetaMovil: 'Entradas', prioridadMovil: 'oculta', numerica: true, ancho: 's', secundaria: true, celda: (f) => pzs((f.s ? detSku.get(f.s.sku_id) : detMod.get(f.mod.modelo_id))?.entradas ?? 0) },
    { id: 'sa', titulo: 'Sal.', etiquetaMovil: 'Salidas', prioridadMovil: 'oculta', numerica: true, ancho: 's', secundaria: true, celda: (f) => pzs((f.s ? detSku.get(f.s.sku_id) : detMod.get(f.mod.modelo_id))?.salidas ?? 0) },
    { id: 'ro', titulo: 'Rot.', etiquetaMovil: 'Rotación', prioridadMovil: 'oculta', numerica: true, ancho: 's', secundaria: true, celda: (f) => { const d = f.s ? detSku.get(f.s.sku_id) : detMod.get(f.mod.modelo_id); return rot(d?.piezas_inicial, f.s ? f.s.piezas : f.mod.piezas ?? 0, d?.salidas ?? 0) ?? <SinDato />; } },
    { id: 'an', titulo: 'Antig.', etiquetaMovil: 'Antigüedad', prioridadMovil: 'oculta', numerica: true, ancho: 's', secundaria: true, celda: (f) => { const a = ant((f.s ? detSku.get(f.s.sku_id) : detMod.get(f.mod.modelo_id))?.ultima_entrada); return a === null ? <SinDato /> : `${a} d`; } },
    { id: 'u', titulo: 'Último mov.', prioridadMovil: 'oculta', ancho: 'm', secundaria: true, celda: (f) => (f.mod.ultimo_movimiento ? (fechaCorta(f.mod.ultimo_movimiento.slice(0, 10)) ?? '') : <SinDato />) },
  ];

  const grafica = [...conDato].sort((a, b) => URGENCIA_COBERTURA[a.estado ?? 'sin_historia'] - URGENCIA_COBERTURA[b.estado ?? 'sin_historia'] || (a.cobertura_dias ?? 1e9) - (b.cobertura_dias ?? 1e9)).slice(0, 10);
  const saboresTop = (() => { const t = new Map<string, number>(); for (const x of conDato) for (const s of x.sabores) t.set(s.sabor, (t.get(s.sabor) ?? 0) + s.piezas); return [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s); })();
  const calorModelos = [...conDato].filter((x) => x.sabores.length > 0).sort((a, b) => (b.piezas ?? 0) - (a.piezas ?? 0)).slice(0, 8);
  const porMarca = marcas.map((mc) => ({ mc, v: conDato.filter((x) => x.marca === mc).reduce((a, x) => a + (x.valor_cent ?? 0n), 0n), pz: conDato.filter((x) => x.marca === mc).reduce((a, x) => a + (x.piezas ?? 0), 0) })).sort((a, b) => Number(b.v - a.v));
  const todosSabores = conDato.flatMap((x) => x.sabores.map((s) => ({ dias: ant(detSku.get(s.sku_id)?.ultima_entrada), piezas: s.piezas, valor: s.valor_cent })));
  const tramos = acumularPorTramo(todosSabores);
  const covMedia = (() => { const v = conDato.map((x) => x.cobertura_dias).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
  const entP = detalle.modelos.reduce((a, d) => a + d.entradas, 0);
  const salP = detalle.modelos.reduce((a, d) => a + d.salidas, 0);
  const merP = detalle.modelos.reduce((a, d) => a + d.mermas, 0);
  const rotGlobal = inv.totales.piezas > 0 ? dec(salP / ((detalle.modelos.reduce((a, d) => a + (d.piezas_inicial ?? 0), 0) + inv.totales.piezas) / 2 || 1), 2) : null;
  const opcionesMarca = marcas.map((mc) => ({ nombre: mc, cuenta: conDato.filter((x) => x.marca === mc).length }));
  // Atajos: las marcas con mas valor de inventario (maximo 5).
  const atajos = atajosDeMarcas(new Map(porMarca.map((x) => [x.mc, Number(x.v)])));
  const sd = conDato.length === 0;
  const pie = `Corte: ${etiquetaFechaHora(inv.corte)} · Fuente: libro de movimientos`;

  const chipLink = (cambios: Record<string, string | null>) => enlace(base, sp, { ...cambios, vista: null });
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Inventario · ${etiquetaHoy()}`}
        titulo={sd ? 'Todavía no hay existencias' : `${formatearPiezas(inv.totales.piezas)} en la bodega`}
        descripcion="Existencia por modelo y sabor a costo promedio, con semáforo de reposición. El inventario es de los socios; su ubicación es la Bodega Omar."
        acciones={<BarraAcciones etiquetaAria="Acciones del inventario" primarias={<><a className="rtm-boton" href="/inventario/csv" data-testid="inventario-csv" title="Descargar el inventario en CSV">CSV</a><ExportarInventario marcas={marcas} modelos={conDato.map((x) => ({ marca: x.marca, modelo: x.modelo }))} clientes={clientes.filter((c) => c.precios > 0 && c.activo).map((c) => ({ id: c.id, nombre: c.nombre }))} /></>} />}
      />
      <KpiLinea etiquetaAria="Resumen del inventario" celdas={[
        { id: 'valor', etiqueta: 'Valor del inventario', testid: 'inv-valor', categoria: 1, valor: sd ? null : <CifraComprobada texto={formatearMoneda(inv.totales.valor_cent)} cifra="inventario:valor" comprobacion={inv.comprobacion.valor_modelos_cent === inv.comprobacion.valor_sabores_cent ? 'cuadra' : 'no_cuadra'} />, nota: sd ? undefined : 'A costo promedio' },
        { id: 'piezas', etiqueta: 'Piezas en la bodega', testid: 'inv-piezas', categoria: 2, valor: sd ? null : formatearPiezas(inv.totales.piezas), nota: sd ? undefined : `${inv.totales.modelos_con_existencia} modelos con existencia` },
        { id: 'apartado', etiqueta: 'Vendidas por recoger', testid: 'inv-apartado', categoria: 3, valor: sd ? null : formatearPiezas(inv.totales.reservado), progreso: sd || inv.totales.piezas <= 0 ? undefined : { pct: (inv.totales.reservado / inv.totales.piezas) * 100 }, nota: sd ? undefined : 'Parte de las piezas' },
        { id: 'disponible', etiqueta: 'Disponibles', categoria: 4, valor: sd ? null : formatearPiezas(conDato.reduce((a, x) => a + (x.disponible ?? 0), 0)), nota: sd ? undefined : 'Suma de los modelos' },
        { id: 'cero', etiqueta: 'Modelos en cero', categoria: 5, valor: sd ? null : String(agotados), href: sd ? undefined : enlace(base, sp, { solo: 'cero', vista: null }), nota: sd ? undefined : 'Agotados o negativos' },
        { id: 'reponer', etiqueta: 'Modelos por reponer', testid: 'inv-reponer', categoria: 6, valor: sd ? null : String(porReponer), nota: sd ? undefined : `Entrega ${ltMin} d, objetivo ${p.objetivo_dias} d` },
      ]} />
      {!sd && (
        <FilaRatios etiqueta="Razones del periodo" items={[
          { etiqueta: `Entradas (${dec(diasEntre(detalle.ini, detalle.fin) + 1, 0)} d)`, valor: pz(entP) }, { etiqueta: 'Salidas', valor: pz(salP) }, { etiqueta: 'Rotación', valor: rotGlobal === null ? null : `${rotGlobal} veces` },
          { etiqueta: 'Mermas', valor: pz(merP) }, { etiqueta: 'Cobertura media', valor: covMedia === null ? null : textoDias(covMedia) }, { etiqueta: 'Sin movimiento', valor: String(cuenta(FILTROS[3]!)) },
        ]} />
      )}

      {!sd && (
        <details className="rtm-bb-plegable" data-testid="inv-mas-razones">
          <summary>Semáforo de reposición y valor</summary>
        <FilaRatios etiqueta="Semáforo de reposición" items={(['urge', 'brevedad', 'siguiente', 'buena', 'excelente', 'sobrestock', 'sin_movimiento', 'sin_historia'] as EstadoCoberturaCodigo[]).map((e) => ({ etiqueta: PALABRA_COBERTURA[e], valor: String(conDato.filter((x) => x.estado === e).length) }))} />
        <FilaRatios etiqueta="Valor y disponibilidad" items={[
          { etiqueta: 'Valor medio por pieza', valor: inv.totales.piezas > 0 ? formatearMoneda(inv.totales.valor_cent / BigInt(Math.max(inv.totales.piezas, 1))) : null },
          { etiqueta: 'Disponibles de las piezas', valor: inv.totales.piezas > 0 ? `${dec((conDato.reduce((a, x) => a + (x.disponible ?? 0), 0) / inv.totales.piezas) * 100, 1)} %` : null },
          { etiqueta: 'Marcas con existencia', valor: String(marcas.length) },
          { etiqueta: 'Marca con más valor', valor: porMarca[0] ? `${porMarca[0].mc} · ${pctTexto(partePct(porMarca[0].v, totalValor)) ?? ''}` : null },
        ]} />
        </details>
      )}

      {vista === 'existencias' && (
        <>
          {grafica.length >= 2 && (
            <Rejilla dividir="8-4">
              <CoberturaDias
                titulo="¿A quién le toca reponer primero?"
                descripcion={`Cobertura en días de ${grafica.length} modelos contra el tiempo de entrega y el objetivo; los que se acaban primero van arriba.`}
                pie={pie}
                filas={grafica.map((x) => ({ id: String(x.modelo_id), etiqueta: nombreVape(x.modelo), dias: x.cobertura_dias, textoDias: textoDias(x.cobertura_dias), estado: x.estado ?? 'sin_historia' }))}
                umbrales={[{ id: 'lt', etiqueta: 'Entrega', dias: ltMin }, { id: 'ciclo', etiqueta: 'Siguiente ciclo', dias: ltMin + p.ciclo_dias }, { id: 'obj', etiqueta: 'Objetivo', dias: p.objetivo_dias }]}
              />
              <div className="rtm-a2-apilado">
                <Tarjeta titulo="Valor por marca" descripcion="Parte del valor del inventario">
                  <BarList etiquetaAria="Valor por marca" items={porMarca.map((x, i) => ({ id: x.mc, etiqueta: x.mc, texto: `${m(x.v)} · ${pz(x.pz)}`, pct: partePct(x.v, totalValor), href: undefined, nota: i === 0 ? undefined : undefined }))} />
                </Tarjeta>
                <Tarjeta titulo="Antigüedad por última entrada" descripcion="Piezas por tramo de días">
                  <BarList etiquetaAria="Antigüedad del inventario" items={[...TRAMOS.map((t) => ({ id: t.id, etiqueta: t.etiqueta, texto: `${pz(tramos.tramos.get(t.id)!.piezas)} · ${m(tramos.tramos.get(t.id)!.valor)}`, pct: partePct(tramos.tramos.get(t.id)!.piezas, inv.totales.piezas) })), ...(tramos.sinDato.sabores ? [{ id: 'sd', etiqueta: 'Sin entrada registrada', texto: pz(tramos.sinDato.piezas) ?? '', pct: null }] : [])]} />
                </Tarjeta>
              </div>
            </Rejilla>
          )}
        </>
      )}
      <Pestanas etiquetaAria="Vistas del inventario" items={[
        { id: 'existencias', etiqueta: 'Existencias', href: enlace(base, sp, { vista: null }), activa: vista === 'existencias', contador: conDato.length },
        { id: 'compras', etiqueta: 'Compras', href: enlace(base, sp, { vista: 'compras' }), activa: vista === 'compras', contador: inv.compras_recientes.length },
        { id: 'documentos', etiqueta: 'Documentos', href: enlace(base, sp, { vista: 'documentos' }), activa: vista === 'documentos', contador: documentos.length },
        { id: 'sin-movimientos', etiqueta: 'Sin movimientos', href: enlace(base, sp, { vista: 'sin-movimientos' }), activa: vista === 'sin-movimientos', contador: sinMovimientos.length },
      ]} />

      {vista === 'existencias' && (
        <>
          <FiltroCatalogo etiquetaAria="Buscar y filtrar por marca" placeholder="Buscar modelo, marca o sabor" marcas={opcionesMarca} atajos={atajos} />
          <div className="rtm-ba-barra-filtros">
            <MenuFiltro nombre="Estado" testid="filtro-estado" opciones={[
              { href: chipLink({ estado: null, solo: null }), etiqueta: 'Todos', activa: !filtro && !soloCero && !soloApartado },
              ...FILTROS.map((f) => ({ href: chipLink({ estado: f.id, solo: null }), etiqueta: `${f.etiqueta} (${cuenta(f)})`, activa: filtro?.id === f.id })),
              { href: chipLink({ solo: 'cero', estado: null }), etiqueta: `Cero o negativa (${agotados})`, activa: soloCero },
              { href: chipLink({ solo: 'apartado', estado: null }), etiqueta: 'Con apartado', activa: soloApartado },
            ]} />
            <FiltrosUrl etiquetaAria="Filtros del inventario" restablecer={base} plegable={{ etiqueta: 'Periodo', activos: per.dias ? 1 : 0 }}>
              <Campo etiqueta="Periodo"><select name="dias" defaultValue={String(per.dias ?? 'todo')}><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></Campo>
              {elegidas.length > 0 && <input type="hidden" name="marca" value={elegidas.join(',')} />}
              {q && <input type="hidden" name="q" value={q} />}
              {filtro && <input type="hidden" name="estado" value={filtro.id} />}
              {soloCero && <input type="hidden" name="solo" value="cero" />}
              {soloApartado && <input type="hidden" name="solo" value="apartado" />}
            </FiltrosUrl>
          </div>

          <Tarjeta plana className="rtm-a2-tabla" titulo="Existencias por modelo y sabor" descripcion={`${visibles.length} modelos · abre un modelo para ver sus sabores`}>
            <DataTable
              etiqueta="Existencia y semáforo de reposición por modelo y sabor"
              clave={(f) => f.clave}
              filas={filas}
              densidad="densa" pegajosa primeraFija plana
              vacio={{ titulo: sd ? 'Sin existencias' : 'Ningún modelo cumple el filtro', texto: sd ? 'La existencia sale del libro de movimientos y se llenará con la primera compra recibida y contada. Hasta entonces: Sin dato.' : 'Quita el filtro para ver todos los modelos.', accion: sd ? <Link className="rtm-boton" href="/catalogo">Ir al catálogo</Link> : undefined }}
              columnas={columnas}
              agrupar={{
                clave: (f) => String(f.mod.modelo_id),
                cerradosPorDefecto: visibles.length > 12,
                cabecera: (_k, fs) => {
                  const x = fs[0]!.mod;
                  const d = detMod.get(x.modelo_id);
                  return {
                    titulo: <span className="rtm-a2-nowrap rtm-modelo-tarjeta" data-tam="xs"><ModeloMiniatura modelo={x.modelo} marca={x.marca} tam="xs" /><span><Link href={`/inventario/kardex?modelo=${x.modelo_id}`}>{nombreVape(x.modelo)}</Link><span className="rtm-a2-nota"> · {marcaMayus(x.marca)} · {x.sabores.length} sabores</span></span></span>,
                    subtotales: {
                      p: <CifraComprobada texto={x.piezas === null ? null : formatearPiezas(x.piezas)} cifra={`existencia:modelo:${x.modelo_id}`} comprobacion="cuadra" />,
                      a: pzs(x.reservado), d: pzs(x.disponible), cu: x.costo_prom_cent === null || (x.piezas ?? 0) === 0 ? <SinDato /> : m(x.costo_prom_cent), v: m(x.valor_cent) ?? <SinDato />,
                      pc: pctTexto(partePct(x.valor_cent ?? 0n, totalValor)) ?? <SinDato />, en: pzs(d?.entradas ?? 0), sa: pzs(d?.salidas ?? 0), ro: rot(d?.piezas_inicial, x.piezas ?? 0, d?.salidas ?? 0) ?? <SinDato />,
                      c: x.cobertura_dias === null ? <SinDato /> : <CifraComprobada texto={textoDias(x.cobertura_dias)} cifra={`cobertura:modelo:${x.modelo_id}`} comprobacion="cuadra" />,
                      s: semaforo(x.estado, String(x.modelo_id)), an: ant(d?.ultima_entrada) === null ? <SinDato /> : `${ant(d?.ultima_entrada)} d`, u: x.ultimo_movimiento ? (fechaCorta(x.ultimo_movimiento.slice(0, 10)) ?? '') : <SinDato />,
                    },
                  };
                },
              }}
              totales={{ etiqueta: `Totales del filtro (${visibles.length} modelos)`, celdas: { p: pz(suma.piezas), a: pz(suma.res), d: pz(suma.disp), v: m(suma.valor), pc: pctTexto(partePct(suma.valor, totalValor)), en: pz(suma.ent), sa: pz(suma.sal) } }}
            />
          </Tarjeta>
          {calorModelos.length >= 2 && saboresTop.length >= 2 && (
            <MapaCalor
              titulo="Piezas por modelo y sabor"
              descripcion={`Mapa de calor de ${calorModelos.length} modelos por ${saboresTop.length} sabores; cada celda trae su número exacto y la celda punteada no tiene dato.`}
              pie={pie}
              filas={calorModelos.map((x) => x.modelo)}
              columnas={saboresTop}
              unidad="piezas"
              celdas={calorModelos.map((x) => saboresTop.map((s) => { const z = x.sabores.find((w) => w.sabor === s); return z ? { valor: z.piezas, texto: formatearPiezas(z.piezas) } : null; }))}
            />
          )}

          <p className="rtm-a2-nota">Cobertura = disponible entre la demanda diaria de los últimos {p.ventana_dias} días con existencia. Pedir ya si se acaba antes de {ltMin} d (entrega); objetivo {p.objetivo_dias} d; sobrestock arriba de {p.sobrestock_x * p.objetivo_dias} d. El valor del sabor es a costo del modelo. Rotación = salidas entre la existencia media del periodo. Antigüedad = días desde la última entrada de compra (costo promedio, no por lotes). Comprobación: Σ sabores = Σ modelos ({formatearMoneda(inv.comprobacion.valor_sabores_cent)} contra {formatearMoneda(inv.comprobacion.valor_modelos_cent)}). Un modelo sin movimientos dice «Sin dato», nunca cero.</p>
        </>
      )}

      {vista === 'compras' && (
        <Tarjeta plana className="rtm-a2-tabla" titulo="Compras: pagadas, facturadas y recibidas">
          <DataTable
            etiqueta="Tres cantidades de las últimas compras recibidas" clave={(c) => c.compra_id} filas={inv.compras_recientes} densidad="densa" plana
            vacio={{ titulo: 'Sin compras recibidas', texto: 'Cuando se confirme la recepción de una compra verás aquí sus tres cantidades y el puente de diferencias.' }}
            columnas={[
              { id: 'f', titulo: 'Compra', prioridadMovil: 'titulo', celda: (c) => <Link className="rtm-mono" href={`/proveedores/compras/${c.compra_id}`}>{c.folio}</Link> },
              { id: 'p', titulo: 'Proveedor', prioridadMovil: 'oculta', secundaria: true, celda: (c) => c.proveedor },
              { id: 'a', titulo: 'Pagadas', prioridadMovil: 'normal', numerica: true, celda: (c) => formatearPiezas(c.pagadas) },
              { id: 'b', titulo: 'Facturadas', prioridadMovil: 'normal', numerica: true, celda: (c) => formatearPiezas(c.facturadas) },
              { id: 'r', titulo: 'Recibidas', prioridadMovil: 'principal', numerica: true, celda: (c) => (c.recibidas === null ? <SinDato /> : formatearPiezas(c.recibidas)) },
              { id: 'pu', titulo: 'Puente', prioridadMovil: 'normal', numerica: true, celda: (c) => (c.puente_piezas === 0 ? 'Sin diferencia' : `${formatearPiezas(c.puente_piezas)} · ${formatearMoneda(c.puente_valor_cent)}`) },
              { id: 'fs', titulo: 'Pagado de más (fuera de la sociedad)', prioridadMovil: 'oculta', numerica: true, secundaria: true, celda: (c) => (c.fuera_sociedad_cent === 0n ? 'Ninguno' : formatearMoneda(c.fuera_sociedad_cent)) },
            ]}
          />
        </Tarjeta>
      )}
      {vista === 'documentos' && (
        <Tarjeta plana className="rtm-a2-tabla" titulo="Documentos exportados">
          <DataTable
            etiqueta="PDF del inventario exportados" clave={(d) => d.id} filas={documentos} densidad="densa" plana
            vacio={{ titulo: 'Sin documentos', texto: 'Cada PDF queda guardado con su folio y huella para reabrirlo idéntico.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', celda: (d) => <a className="rtm-mono" href={`/inventario/documento/${d.id}/pdf`} target="_blank" rel="noreferrer">{d.folio}</a> },
              { id: 'v', titulo: 'Versión', celda: (d) => (d.version === 'clientes' ? 'Para clientes' : 'Interna') },
              { id: 'c', titulo: 'Corte', secundaria: true, celda: (d) => etiquetaFechaHora(d.corte) },
              { id: 'h', titulo: 'Huella', secundaria: true, celda: (d) => <span className="rtm-mono">{d.sha256.slice(0, 12)}</span> },
            ]}
          />
        </Tarjeta>
      )}
      {vista === 'sin-movimientos' && (
        <Tarjeta plana className="rtm-a2-tabla" titulo="Sin movimientos registrados" descripcion="Un modelo sin movimientos dice «Sin dato», nunca cero">
          <DataTable
            etiqueta="Modelos del catálogo sin movimientos" clave={(x) => x.modelo_id} filas={sinMovimientos} densidad="densa" plana
            vacio={{ titulo: 'Todos los modelos tienen movimientos', texto: 'No hay modelos del catálogo sin historia en el libro.' }}
            columnas={[
              { id: 'marca', titulo: 'Marca', secundaria: true, celda: (x) => marcaMayus(x.marca) },
              { id: 'm', titulo: 'Modelo', celda: (x) => <span className="rtm-modelo-tarjeta" data-tam="xs"><ModeloMiniatura modelo={x.modelo} marca={x.marca} tam="xs" /><strong>{nombreVape(x.modelo)}</strong></span> },
              { id: 'e', titulo: 'Existencia', numerica: true, celda: () => <SinDato /> },
              { id: 's', titulo: 'Semáforo', celda: () => <SinDato /> },
            ]}
          />
        </Tarjeta>
      )}
      <PanelConcilia c={concilia} />
    </Pagina>
  );
}
