import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { ChipEstado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina as Contenedor, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { fechaNeg } from '@/dominio/calendario';
import { porcentaje } from '@/dominio/tablero/agregados';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { BotonAccion } from '../../operacion/dialogo-simple';
import { ESTADO_COMPRA } from '../../operacion/etiquetas';
import { FormularioGuia } from './formulario-guia';
import { DialogoReportarEntrada } from '../dialogos-incidente';
import { TablaIncidentes } from '../tabla-incidentes';

export const metadata: Metadata = { title: 'Paquetes en trayecto' };

export default async function PaginaEnTrayecto() {
  const lector = await operacionDeSocio();
  const [lista, umbral, inc] = await Promise.all([lector.enTransito(), lector.umbralesPaquetes(), lector.incidentesPaquetes()]);
  const incAbiertos = inc.incidentes.filter((i) => i.sentido === 'entrada' && i.estado === 'abierto').length;
  const demorado = (c: (typeof lista)[number]) => c.dias_en_camino !== null && c.dias_en_camino > (umbral.plazo_dias[c.proveedor] ?? Infinity) + umbral.trayecto_dias_extra;
  const piezas = lista.reduce((a, c) => a + c.piezas_pedidas, 0);
  const porConfirmar = lista.filter((c) => c.estado === 'llego_merida').length;
  const hoy = fechaNeg(new Date());
  const valor = lista.reduce((a, c) => a + c.total_cent, 0n);
  const demorados = lista.filter(demorado).length;
  const llegan = lista.filter((c) => c.llegada_estimada !== null && c.llegada_estimada >= hoy && c.llegada_estimada <= sumarDias(hoy, 1)).length;
  const sinGuia = lista.filter((c) => c.guias.length === 0).length;
  const plazoDe = (c: (typeof lista)[number]) => (umbral.plazo_dias[c.proveedor] ?? 0) + umbral.trayecto_dias_extra;
  const tope = Math.max(1, ...lista.map((c) => Math.max(c.dias_en_camino ?? 0, plazoDe(c))));
  return (
    <Contenedor ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Paquetes en trayecto · ${etiquetaHoy()}`}
        titulo={lista.length === 0 ? 'No hay paquetes en camino' : `Vienen en camino ${lista.length} ${lista.length === 1 ? 'orden' : 'órdenes'}`}
        descripcion={lista.length === 0 ? 'Las órdenes confirmadas a Isaac o Karen aparecen aquí hasta confirmar su recepción.' : `${formatearMoneda(valor)} pagados en camino. Las piezas no cuentan como existencia hasta confirmar la recepción en Mérida, por sabor.`}
      />
      <KpiLinea
        etiquetaAria="Resumen de paquetes en trayecto"
        celdas={[
          { id: 'ordenes', testid: 'pt-ordenes', etiqueta: 'Órdenes en camino', valor: String(lista.length), categoria: 1, nota: `${formatearMoneda(valor)} pagados` },
          { id: 'piezas', testid: 'pt-piezas', etiqueta: 'Piezas en tránsito (no son existencia)', valor: formatearPiezas(piezas), categoria: 5 },
          { id: 'llegaron', testid: 'pt-llegaron', etiqueta: 'Llegaron sin confirmar', valor: String(porConfirmar), categoria: 6, nota: llegan ? `${llegan} llegan hoy o mañana` : undefined },
          { id: 'demorados', testid: 'pt-demorados', etiqueta: 'Demorados', valor: String(demorados), categoria: 4, progreso: lista.length ? { pct: (demorados / lista.length) * 100 } : undefined, nota: demorados ? 'Pasan el plazo más los días de gracia' : 'Todos dentro de plazo' },
        ]}
      />
      <FilaRatios etiqueta="Razones del trayecto" items={[{ etiqueta: 'Sin guía registrada', valor: String(sinGuia) }, { etiqueta: 'Piezas por orden', valor: lista.length ? String(Math.round(piezas / lista.length)) : null }, { etiqueta: 'Costo por pieza', valor: piezas > 0 ? formatearMoneda(valor / BigInt(piezas)) : null }, { etiqueta: 'Días de gracia', valor: `${umbral.trayecto_dias_extra} d` }, { etiqueta: 'Perdidos o dañados por resolver', valor: String(incAbiertos) }]} />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Días en camino contra el plazo" descripcion="La marca es el plazo del proveedor más los días de gracia">
          {lista.length ? (
            <BarList
              etiquetaAria="Días en camino por orden" mostrarPct={false}
              items={[...lista].sort((a, b) => (b.dias_en_camino ?? -1) - (a.dias_en_camino ?? -1)).slice(0, 10).map((c) => ({ id: String(c.id), etiqueta: `${c.folio} · ${c.proveedor}`, href: `/proveedores/compras/${c.id}`, texto: c.dias_en_camino === null ? 'Sin dato' : `${c.dias_en_camino} d`, pct: c.dias_en_camino === null ? null : porcentaje(c.dias_en_camino, tope), umbral: porcentaje(plazoDe(c), tope) ?? undefined, tono: demorado(c) ? ('malo' as const) : undefined, nota: demorado(c) ? 'demorado' : `plazo ${plazoDe(c)} d` }))}
            />
          ) : <p className="rtm-a1-estado-vacio">Nada en camino.</p>}
        </Tarjeta>
        <Tarjeta titulo="Por proveedor" descripcion="Órdenes y piezas en camino">
          {lista.length ? (
            <BarList etiquetaAria="Piezas en camino por proveedor" items={[...new Set(lista.map((c) => c.proveedor))].map((pv) => { const cs = lista.filter((c) => c.proveedor === pv); const pz = cs.reduce((a, c) => a + c.piezas_pedidas, 0); return { id: pv, etiqueta: pv, texto: formatearPiezas(pz), pct: porcentaje(pz, piezas), nota: `${cs.length} ${cs.length === 1 ? 'orden' : 'órdenes'}` }; })} />
          ) : <p className="rtm-a1-estado-vacio">Sin órdenes en camino.</p>}
        </Tarjeta>
      </Rejilla>
      <Tarjeta plana titulo="Órdenes en camino" descripcion={`${lista.length} ${lista.length === 1 ? 'orden' : 'órdenes'}`}>
        <DataTable
          etiqueta="Paquetes en trayecto" densidad="densa" plana pegajosa primeraFija interactiva={{ busqueda: 'Buscar orden o proveedor', exportar: 'paquetes-en-trayecto' }}
          totales={lista.length ? { etiqueta: 'Totales', celdas: { z: formatearPiezas(piezas), t: formatearMoneda(valor) } } : undefined}
          clave={(c) => c.id}
          filas={lista}
          vacio={{ titulo: 'Nada en camino', texto: 'Las órdenes de compra confirmadas a Isaac o Karen aparecen aquí hasta que se confirma su recepción.', accion: <Link className="rtm-boton" href="/proveedores">Ir a proveedores</Link> }}
          columnas={[
            { id: 'f', titulo: 'Orden', celda: (c) => <Link className="rtm-mono" href={`/proveedores/compras/${c.id}`}>{c.folio}</Link> },
            { id: 'p', titulo: 'Proveedor', celda: (c) => c.proveedor },
            { id: 'm', titulo: 'Modelos y sabores', secundaria: true, celda: (c) => c.renglones.map((r) => `${r.modelo} ${r.sabor} ${r.pagadas}`).join(' · ') },
            { id: 'z', titulo: 'Piezas', numerica: true, celda: (c) => formatearPiezas(c.piezas_pedidas) },
            { id: 't', titulo: 'Total pagado', numerica: true, secundaria: true, celda: (c) => formatearMoneda(c.total_cent) },
            { id: 'g', titulo: 'Guías', celda: (c) => (c.guias.length ? c.guias.map((g) => `${g.paqueteria} ${g.numero}`).join(', ') : 'Sin guía') },
            { id: 'e', titulo: 'Envío', secundaria: true, celda: (c) => (c.enviada_fecha ? etiquetaFecha(c.enviada_fecha) : 'Sin enviar') },
            { id: 'l', titulo: 'Llegada estimada', secundaria: true, celda: (c) => (c.llegada_estimada ? etiquetaFecha(c.llegada_estimada) : 'Sin fecha') },
            { id: 'd', titulo: 'Días en camino', numerica: true, celda: (c) => (c.dias_en_camino === null ? 'Sin dato' : demorado(c) ? <EstadoTexto tono="atencion">{c.dias_en_camino} · demorado</EstadoTexto> : c.dias_en_camino) },
            { id: 's', titulo: 'Estado', celda: (c) => <ChipEstado tono={ESTADO_COMPRA[c.estado].tono === 'neutro' ? 'apagado' : (ESTADO_COMPRA[c.estado].tono as 'ok' | 'atencion' | 'malo')}>{ESTADO_COMPRA[c.estado].texto}</ChipEstado> },
            { id: 'a', titulo: 'Acciones', celda: (c) => (
              <span className="rtm-acciones-fila">
                <FormularioGuia compraId={c.id} folio={c.folio} />
                {c.estado !== 'llego_merida' && <BotonAccion boton="Llegó a Mérida" accion="marcar_llego_merida" args={{ p_compra: c.id }} chico testid={`llego-${c.id}`} />}
                <Link className="rtm-boton rtm-boton-chico rtm-boton-primario" href={`/proveedores/compras/${c.id}#recepcion`}>Confirmar recepción</Link>
                <DialogoReportarEntrada compraId={c.id} folio={c.folio} renglones={c.renglones.map((r) => ({ linea_id: r.linea_id, modelo: r.modelo, sabor: r.sabor, facturadas: r.facturadas }))} />
              </span>
            ) },
          ]}
        />
      </Tarjeta>
      <TablaIncidentes incidentes={inc.incidentes} sentido="entrada" testid="inc-entrada" />
    </Contenedor>
  );
}
