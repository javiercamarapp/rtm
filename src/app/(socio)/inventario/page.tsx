import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { inventarioDeSocio } from '@/composicion/inventario';
import { PALABRA_COBERTURA, TONO_COBERTURA, URGENCIA_COBERTURA, textoDias } from '@/dominio/inventario/cobertura';
import type { EstadoCoberturaCodigo, ModeloInventario } from '@/dominio/inventario/tipos';
import { etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { CoberturaDias, MapaCalor } from '@/ui/graficas';
import { etiquetaHoy } from '../contexto';
import { ExportarInventario } from './exportar-inventario';

export const metadata: Metadata = { title: 'Inventario' };

const FILTROS: { id: string; etiqueta: string; estados: EstadoCoberturaCodigo[] }[] = [
  { id: 'reponer', etiqueta: 'Por reponer', estados: ['urge', 'brevedad', 'siguiente'] },
  { id: 'sobrestock', etiqueta: 'Sobrestock', estados: ['sobrestock'] },
  { id: 'sin_historia', etiqueta: 'Sin historia', estados: ['sin_historia'] },
  { id: 'sin_movimiento', etiqueta: 'Sin movimiento', estados: ['sin_movimiento'] },
];

export default async function Pagina({ searchParams }: { searchParams: Promise<{ estado?: string; marca?: string }> }) {
  const sp = await searchParams;
  const [inv, documentos, clientes] = await Promise.all([(await inventarioDeSocio()).completo(), (await inventarioDeSocio()).documentos(), (await lectorDeSocio()).clientes()]);
  const conDato = inv.modelos.filter((m) => m.piezas !== null);
  const filtro = FILTROS.find((f) => f.id === sp.estado) ?? null;
  const marcas = [...new Set(conDato.map((m) => m.marca))];
  const marca = marcas.includes(sp.marca ?? '') ? sp.marca! : null;
  const visibles = conDato
    .filter((m) => (!filtro || (m.estado !== null && filtro.estados.includes(m.estado))) && (!marca || m.marca === marca))
    .sort((a, b) => URGENCIA_COBERTURA[a.estado ?? 'sin_historia'] - URGENCIA_COBERTURA[b.estado ?? 'sin_historia'] || a.modelo.localeCompare(b.modelo, 'es'));
  const enlace = (cambios: Record<string, string>) => {
    const q = new URLSearchParams({ ...(sp.estado ? { estado: sp.estado } : {}), ...(sp.marca ? { marca: sp.marca } : {}), ...cambios });
    for (const [k, v] of [...q.entries()]) if (v === '') q.delete(k);
    return q.size ? `/inventario?${q}` : '/inventario';
  };
  const cuenta = (f: (typeof FILTROS)[number]) => conDato.filter((m) => m.estado !== null && f.estados.includes(m.estado)).length;

  const grafica = [...conDato].sort((a, b) => URGENCIA_COBERTURA[a.estado ?? 'sin_historia'] - URGENCIA_COBERTURA[b.estado ?? 'sin_historia'] || (a.cobertura_dias ?? 1e9) - (b.cobertura_dias ?? 1e9)).slice(0, 12);
  const p = inv.parametros;
  const ltMin = Math.min(...Object.values(p.lt_dias));

  const saboresTop = (() => {
    const t = new Map<string, number>();
    for (const m of conDato) for (const s of m.sabores) t.set(s.sabor, (t.get(s.sabor) ?? 0) + s.piezas);
    return [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s);
  })();
  const calorModelos = [...conDato].filter((m) => m.sabores.length > 0).sort((a, b) => (b.piezas ?? 0) - (a.piezas ?? 0)).slice(0, 10);

  const detalle = (m: ModeloInventario) => `${m.marca} ${m.modelo}`;

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Inventario · ${etiquetaHoy()}`}
        antes={conDato.length === 0 ? 'Todavía no hay' : 'Existencias de'}
        enfasis={conDato.length === 0 ? 'existencias' : `${conDato.length} modelos`}
        despues={conDato.length === 0 ? '' : 'en la Bodega Omar'}
        contexto="Existencia por modelo y sabor con costo promedio ponderado y semáforo de reposición por días de cobertura. El inventario es de Angelo y Javier; su ubicación es la Bodega Omar. Lo que no tiene movimientos se muestra como “Sin dato”, nunca como cero."
        acciones={<ExportarInventario marcas={marcas} modelos={conDato.map((m) => ({ marca: m.marca, modelo: m.modelo }))} clientes={clientes.filter((c) => c.precios > 0 && c.activo).map((c) => ({ id: c.id, nombre: c.nombre }))} />}
      />

      <section className="rtm-kpis rtm-entra rtm-i-1" aria-label="Resumen del inventario">
        <div className="rtm-kpi" data-testid="inv-valor"><span>Valor del inventario</span><strong>{conDato.length === 0 ? <SinDato /> : <CifraComprobada texto={formatearMoneda(inv.totales.valor_cent)} cifra="inventario:valor" comprobacion={inv.comprobacion.valor_modelos_cent === inv.comprobacion.valor_sabores_cent ? 'cuadra' : 'no_cuadra'} />}</strong></div>
        <div className="rtm-kpi" data-testid="inv-piezas"><span>Piezas en la bodega</span><strong>{conDato.length === 0 ? <SinDato /> : formatearPiezas(inv.totales.piezas)}</strong></div>
        <div className="rtm-kpi" data-testid="inv-apartado"><span>Vendidas por recoger</span><strong>{conDato.length === 0 ? <SinDato /> : formatearPiezas(inv.totales.reservado)}</strong></div>
        <div className="rtm-kpi" data-testid="inv-reponer"><span>Modelos por reponer</span><strong>{conDato.length === 0 ? <SinDato /> : cuenta(FILTROS[0]!)}</strong></div>
      </section>

      <div className="rtm-barra-filtros rtm-entra rtm-i-1" aria-label="Filtros del semáforo">
        <Link className="rtm-chip-filtro" href={enlace({ estado: '' })} aria-current={!filtro}>Todos</Link>
        {FILTROS.map((f) => <Link key={f.id} className="rtm-chip-filtro" href={enlace({ estado: f.id })} aria-current={filtro?.id === f.id}>{f.etiqueta} ({cuenta(f)})</Link>)}
        {marcas.length > 1 && marcas.map((m) => <Link key={m} className="rtm-chip-filtro" href={enlace({ marca: marca === m ? '' : m })} aria-current={marca === m}>{m}</Link>)}
      </div>

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Existencia y semáforo por modelo">
        <h2>Por modelo</h2>
        <DataTable
          etiqueta="Existencia y semáforo de reposición por modelo"
          clave={(m) => m.modelo_id}
          filas={visibles}
          vacio={{ titulo: conDato.length === 0 ? 'Sin existencias' : 'Ningún modelo cumple el filtro', texto: conDato.length === 0 ? 'La existencia sale del libro de movimientos y se llenará con la primera compra recibida y contada. Hasta entonces: Sin dato.' : 'Quita el filtro para ver todos los modelos.', accion: conDato.length === 0 ? <Link className="rtm-boton" href="/catalogo">Ir al catálogo</Link> : undefined }}
          columnas={[
            { id: 'marca', titulo: 'Marca', secundaria: true, celda: (m) => m.marca },
            { id: 'm', titulo: 'Modelo', celda: (m) => <Link href={`/inventario/kardex?modelo=${m.modelo_id}`}>{m.modelo}</Link> },
            { id: 'e', titulo: 'Existencia', numerica: true, celda: (m) => <CifraComprobada texto={m.piezas === null ? null : formatearPiezas(m.piezas)} cifra={`existencia:modelo:${m.modelo_id}`} comprobacion="cuadra" /> },
            { id: 'd', titulo: 'Disponible', numerica: true, secundaria: true, celda: (m) => (m.disponible === null ? <SinDato /> : formatearPiezas(m.disponible)) },
            { id: 'c', titulo: 'Cobertura', numerica: true, celda: (m) => (m.cobertura_dias === null ? <SinDato /> : <CifraComprobada texto={textoDias(m.cobertura_dias)} cifra={`cobertura:modelo:${m.modelo_id}`} comprobacion="cuadra" />) },
            { id: 's', titulo: 'Semáforo', celda: (m) => (m.estado === null ? <SinDato /> : <span data-testid={`semaforo-${m.modelo_id}`}><EstadoTexto tono={TONO_COBERTURA[m.estado]}>{PALABRA_COBERTURA[m.estado]}</EstadoTexto></span>) },
            { id: 'cp', titulo: 'Costo promedio', numerica: true, secundaria: true, celda: (m) => (m.costo_prom_cent === null || m.piezas === 0 ? <SinDato /> : formatearMoneda(m.costo_prom_cent)) },
            { id: 'v', titulo: 'Valor', numerica: true, secundaria: true, celda: (m) => (m.valor_cent === null ? <SinDato /> : formatearMoneda(m.valor_cent)) },
            { id: 'u', titulo: 'Último movimiento', secundaria: true, celda: (m) => (m.ultimo_movimiento ? etiquetaFechaHora(m.ultimo_movimiento) : <SinDato />) },
          ]}
        />
        <p className="rtm-nota">Cobertura = disponible entre la demanda diaria de los últimos {p.ventana_dias} días con existencia. Pedir ya si se acaba antes de {ltMin} d (entrega); objetivo {p.objetivo_dias} d; sobrestock arriba de {p.sobrestock_x * p.objetivo_dias} d. Con menos de {p.historia_minima_dias} d de historia solo se informa la existencia.</p>
      </section>

      {grafica.length >= 2 && (
        <CoberturaDias
          titulo="¿A quién le toca reponer primero?"
          descripcion={`Cobertura en días de ${grafica.length} modelos contra el tiempo de entrega y el objetivo; los que se acaban primero van arriba.`}
          pie={`Corte: ${etiquetaFechaHora(inv.corte)} · Fuente: libro de movimientos`}
          filas={grafica.map((m) => ({ id: String(m.modelo_id), etiqueta: m.modelo, dias: m.cobertura_dias, textoDias: textoDias(m.cobertura_dias), estado: m.estado ?? 'sin_historia' }))}
          umbrales={[{ id: 'lt', etiqueta: 'Entrega', dias: ltMin }, { id: 'ciclo', etiqueta: 'Siguiente ciclo', dias: ltMin + p.ciclo_dias }, { id: 'obj', etiqueta: 'Objetivo', dias: p.objetivo_dias }]}
        />
      )}

      {calorModelos.length >= 2 && saboresTop.length >= 2 && (
        <MapaCalor
          titulo="Piezas por modelo y sabor"
          descripcion={`Mapa de calor de ${calorModelos.length} modelos por ${saboresTop.length} sabores; cada celda trae su número exacto y la celda punteada no tiene dato.`}
          pie={`Corte: ${etiquetaFechaHora(inv.corte)} · Fuente: libro de movimientos`}
          filas={calorModelos.map(detalle)}
          columnas={saboresTop}
          unidad="piezas"
          celdas={calorModelos.map((m) => saboresTop.map((s) => { const x = m.sabores.find((z) => z.sabor === s); return x ? { valor: x.piezas, texto: formatearPiezas(x.piezas) } : null; }))}
        />
      )}

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Existencia por sabor">
        <h2>Por sabor</h2>
        <DataTable
          etiqueta="Existencia por modelo y sabor"
          clave={(s) => s.clave}
          filas={visibles.flatMap((m) => m.sabores.map((s) => ({ clave: `${m.modelo_id}-${s.sku_id}`, modelo: m.modelo, s })))}
          vacio={{ titulo: 'Sin existencias por sabor', texto: 'Aparecerán con la primera compra recibida y contada.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (r) => r.modelo },
            { id: 's', titulo: 'Sabor', celda: (r) => r.s.sabor },
            { id: 'p', titulo: 'Piezas', numerica: true, celda: (r) => formatearPiezas(r.s.piezas) },
            { id: 'a', titulo: 'Apartadas', numerica: true, secundaria: true, celda: (r) => formatearPiezas(r.s.reservado) },
            { id: 'd', titulo: 'Disponibles', numerica: true, celda: (r) => formatearPiezas(r.s.disponible) },
            { id: 'v', titulo: 'Valor', numerica: true, secundaria: true, celda: (r) => formatearMoneda(r.s.valor_cent) },
            { id: 'c', titulo: 'Cobertura', numerica: true, secundaria: true, celda: (r) => textoDias(r.s.cobertura_dias) },
            { id: 'e', titulo: 'Semáforo', celda: (r) => (r.s.estado ? <EstadoTexto tono={TONO_COBERTURA[r.s.estado]}>{PALABRA_COBERTURA[r.s.estado]}</EstadoTexto> : <SinDato />) },
          ]}
        />
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Pagadas, facturadas y recibidas">
        <h2>Compras: pagadas, facturadas y recibidas</h2>
        <DataTable
          etiqueta="Tres cantidades de las últimas compras recibidas"
          clave={(c) => c.compra_id}
          filas={inv.compras_recientes}
          vacio={{ titulo: 'Sin compras recibidas', texto: 'Cuando se confirme la recepción de una compra verás aquí sus tres cantidades y el puente de diferencias.' }}
          columnas={[
            { id: 'f', titulo: 'Compra', celda: (c) => <Link className="rtm-mono" href={`/proveedores/compras/${c.compra_id}`}>{c.folio}</Link> },
            { id: 'p', titulo: 'Proveedor', secundaria: true, celda: (c) => c.proveedor },
            { id: 'a', titulo: 'Pagadas', numerica: true, celda: (c) => formatearPiezas(c.pagadas) },
            { id: 'b', titulo: 'Facturadas', numerica: true, celda: (c) => formatearPiezas(c.facturadas) },
            { id: 'r', titulo: 'Recibidas', numerica: true, celda: (c) => (c.recibidas === null ? <SinDato /> : formatearPiezas(c.recibidas)) },
            { id: 'pu', titulo: 'Puente', numerica: true, celda: (c) => (c.puente_piezas === 0 ? 'Sin diferencia' : `${formatearPiezas(c.puente_piezas)} pz · ${formatearMoneda(c.puente_valor_cent)}`) },
            { id: 'fs', titulo: 'Pagado de más (fuera de la sociedad)', numerica: true, secundaria: true, celda: (c) => (c.fuera_sociedad_cent === 0n ? 'Ninguno' : formatearMoneda(c.fuera_sociedad_cent)) },
          ]}
        />
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Documentos exportados">
        <h2>Documentos exportados</h2>
        <DataTable
          etiqueta="PDF del inventario exportados"
          clave={(d) => d.id}
          filas={documentos}
          vacio={{ titulo: 'Sin documentos', texto: 'Cada PDF queda guardado con su folio y huella para reabrirlo idéntico.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (d) => <a className="rtm-mono" href={`/inventario/documento/${d.id}/pdf`} target="_blank" rel="noreferrer">{d.folio}</a> },
            { id: 'v', titulo: 'Versión', celda: (d) => (d.version === 'clientes' ? 'Para clientes' : 'Interna') },
            { id: 'c', titulo: 'Corte', secundaria: true, celda: (d) => etiquetaFechaHora(d.corte) },
            { id: 'h', titulo: 'Huella', secundaria: true, celda: (d) => <span className="rtm-mono">{d.sha256.slice(0, 12)}</span> },
          ]}
        />
      </section>
    </>
  );
}
