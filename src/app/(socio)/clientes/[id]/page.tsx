import type { Metadata } from 'next';
import Link from 'next/link';
import { BarraAcciones } from '@/ui/componentes/barra-acciones';
import { notFound } from 'next/navigation';
import { lectorDeSocio } from '@/composicion/catalogo';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, formatearPiezas, nombreVape } from '@/dominio/formato';
import { aNumero, porcentaje } from '@/dominio/tablero/agregados';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Chip, ChipEstado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { etiquetaOrigen } from './origen';
import { AltaPersonaBodega } from './persona-bodega';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AreaSerie } from '@/ui/graficas';
import '@/ui/estilos/paginas-a1.css';
import { ESTADO_PEDIDO } from '../../operacion/etiquetas';
import { etiquetaHoy } from '../../contexto';

export const metadata: Metadata = { title: 'Ficha de cliente' };

// Etiqueta permitida por la regla del dueno: es un hecho de precio, no un filtro ni una agrupacion por dueno.
const TIPOS: Record<string, string> = { mayoreo: 'Mayoreo', credito_interno: 'Crédito interno', ocasional: 'Ocasional' };

export default async function PaginaCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const op = await operacionDeSocio();
  const lector = await lectorDeSocio();
  const [f, cxc, pedidosTodos, todos] = await Promise.all([lector.ficha(n), op.cxcCliente(n).catch(() => null), op.pedidos().catch(() => null), lector.clientes().catch(() => null)]);
  if (!f) notFound();
  // Se ofrece solo cuando aún no hay persona de bodega: sin ella un pedido no puede marcarse como enviado.
  const ofrecerBodega = !f.esBodega && todos !== null && !todos.some((c) => c.esBodega);

  const pedidos = (pedidosTodos ?? []).filter((p) => p.cliente_id === f.id).sort((a, b) => b.fecha_neg.localeCompare(a.fecha_neg) || b.id - a.id);
  const activos = pedidos.filter((p) => p.estado !== 'anulado' && p.estado !== 'cancelado');
  const enviados = activos.filter((p) => p.estado === 'enviado');
  const compra = enviados.reduce((a, p) => a + p.cobrado_cent, 0n);
  const piezas = enviados.reduce((a, p) => a + p.piezas_surtidas, 0);
  const utilidad = enviados.filter((p) => p.utilidad_cent !== null);
  const utilTot = utilidad.reduce((a, p) => a + (p.utilidad_cent ?? 0n), 0n);

  const margenIsaac = f.tabulador.flatMap((t) => { const m = t.margenes.find((x) => x.proveedor === 'Isaac'); return m ? [{ modelo: t.modelo, margen: m.margenCent, precio: t.precioCent }] : []; });
  const margenKaren = f.tabulador.flatMap((t) => { const m = t.margenes.find((x) => x.proveedor === 'Karen'); return m ? [{ modelo: t.modelo, margen: m.margenCent, supuesto: m.supuesto }] : []; });
  const promMargen = margenIsaac.length ? margenIsaac.reduce((a, m) => a + aNumero(m.margen), 0) / margenIsaac.length : null;
  const maxMargen = margenIsaac.reduce((a, m) => Math.max(a, aNumero(m.margen)), 0);
  const porModelo = new Map<string, typeof f.historial>();
  for (const h of f.historial.filter((x) => !x.externo)) porModelo.set(h.modelo, [...(porModelo.get(h.modelo) ?? []), h]);
  const [modeloLinea, serie] = [...porModelo.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ['', []];
  const puntos = [...serie].sort((a, b) => a.desde.localeCompare(b.desde));
  const saldo = cxc?.saldo_cent ?? null;
  const ultima = activos[0]?.fecha_neg ?? null;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/clientes', texto: 'Volver a clientes' }}
        eyebrow={`Ficha de cliente · ${etiquetaHoy()}`}
        titulo={f.nombre}
        descripcion={`${f.tabulador.length} modelos con precio vigente. Un precio de una nota no cambia el tabulador: solo cambia cuando un socio lo indica.`}
        acciones={<BarraAcciones etiquetaAria="Acciones del cliente" primarias={<><Link className="rtm-boton" href={`/pedidos/nuevo?cliente=${f.id}`}>Nuevo pedido</Link><Link className="rtm-boton rtm-boton-primario" href={`/clientes/${f.id}/precios`} data-testid="editar-precios">Editar precios</Link></>} secundarias={<><Link className="rtm-boton-item" href={`/clientes/${f.id}/editar`}>Editar cliente</Link>{ofrecerBodega && <AltaPersonaBodega clienteId={f.id} nombre={f.nombre} variante="item" />}</>} />}
      />
      <div className="rtm-a1-etiquetas" aria-label="Datos del cliente">
        <Chip>{TIPOS[f.tipo] ?? f.tipo}</Chip>
        {f.esBodega && <Chip tono="info">Presta la bodega (Omar Yacaman, desactivado hasta M2)</Chip>}
        {f.alias.map((a) => <Chip key={a.alias}>{`También: ${a.alias}${a.porConfirmar ? ' (por confirmar)' : ''}${a.ambiguo ? ' (ambiguo)' : ''}`}</Chip>)}
        {f.destinos.map((d) => <Chip key={d.etiqueta}>{`Destino: ${d.etiqueta}`}</Chip>)}
      </div>
      {f.nota && <p className="rtm-a1-nota">{f.nota}</p>}

      <KpiLinea
        etiquetaAria="Cifras del cliente"
        celdas={[
          { id: 'compra', etiqueta: 'Compra acumulada', valor: pedidosTodos ? (enviados.length ? formatearMoneda(compra) : null) : null, categoria: 1, nota: enviados.length ? `${formatearPiezas(piezas)} en ${enviados.length} ${enviados.length === 1 ? 'pedido enviado' : 'pedidos enviados'}` : 'Aún sin pedidos enviados' },
          { id: 'saldo', etiqueta: 'Saldo por cobrar', valor: saldo === null ? null : <CifraComprobada texto={formatearMoneda(saldo)} cifra={`cxc:cliente:${f.id}`} comprobacion="cuadra" />, categoria: 2, nota: cxc && cxc.saldo_favor_cent > 0n ? `Saldo a favor ${formatearMoneda(cxc.saldo_favor_cent)}` : undefined, href: '/cuentas-por-cobrar' },
          { id: 'pedidos', etiqueta: 'Pedidos', valor: pedidosTodos ? String(activos.length) : null, categoria: 6, nota: ultima ? `Último el ${etiquetaFecha(ultima)}` : 'Sin pedidos' },
          { id: 'utilidad', etiqueta: 'Utilidad dejada', valor: utilidad.length ? formatearMoneda(utilTot) : null, categoria: 3, nota: utilidad.length && compra > 0n ? `Margen ${((aNumero(utilTot) / aNumero(compra)) * 100).toFixed(1)} % de lo vendido` : undefined },
          { id: 'margen', etiqueta: 'Margen medio por pieza (Isaac)', valor: promMargen === null ? null : formatearMoneda(BigInt(Math.round(promMargen))), categoria: 5, nota: `${margenIsaac.length} modelos con costo` },
        ]}
      />
      <FilaRatios
        etiqueta="Razones del cliente"
        items={[
          { etiqueta: 'Ticket promedio', valor: enviados.length ? formatearMoneda(compra / BigInt(enviados.length)) : null },
          { etiqueta: 'Piezas por pedido', valor: enviados.length ? String(Math.round(piezas / enviados.length)) : null },
          { etiqueta: 'Pedidos con avisos', valor: pedidosTodos ? String(activos.filter((p) => p.avisos > 0).length) : null },
          { etiqueta: 'Pagos aplicados', valor: cxc ? String(cxc.pagos.filter((p) => !p.anulado).length) : null },
        ]}
      />

      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta titulo={modeloLinea ? `Historial de precio: ${modeloLinea}` : 'Historial de precio'} descripcion="Precio del tabulador a lo largo del tiempo (escalonado)">
          {puntos.length >= 2 ? (
            <AreaSerie
              titulo={`Precio de ${modeloLinea}`} descripcion={`Precio de ${modeloLinea} a lo largo del tiempo, en ${puntos.length} cambios.`} unidad="Precio (pesos)" procedencia="observado"
              puntos={puntos.map((p) => ({ id: p.desde, etiqueta: etiquetaFecha(p.desde).slice(0, -5), valor: aNumero(p.precioCent) / 100, texto: formatearMoneda(p.precioCent) }))}
            />
          ) : <p className="rtm-a1-estado-vacio">Un solo precio registrado: la gráfica necesita al menos dos cambios.</p>}
        </Tarjeta>
        <Tarjeta titulo="Margen por pieza contra Isaac" descripcion="Precio menos costo de Isaac por modelo">
          {margenIsaac.length > 0 ? (
            <BarList etiquetaAria="Margen por modelo" items={margenIsaac.map((m) => ({ id: m.modelo, etiqueta: nombreVape(m.modelo), texto: formatearMoneda(m.margen), pct: maxMargen > 0 ? porcentaje(Math.max(0, aNumero(m.margen)), maxMargen) : null, nota: margenKaren.find((k) => k.modelo === m.modelo) ? `Karen ${formatearMoneda(margenKaren.find((k) => k.modelo === m.modelo)!.margen)}${margenKaren.find((k) => k.modelo === m.modelo)!.supuesto ? ' (supuesto)' : ''}` : undefined }))} />
          ) : <p className="rtm-a1-estado-vacio">Sin costos de Isaac para estos modelos.</p>}
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="Tabulador vigente" descripcion={`${f.tabulador.length} modelos`}>
        <DataTable
          etiqueta={`Tabulador de ${f.nombre}`} densidad="densa" plana primeraFija interactiva={{ busqueda: 'Buscar modelo', exportar: `tabulador-${f.id}` }}
          clave={(t) => t.modeloId} filas={f.tabulador}
          vacio={{ titulo: 'Sin tabulador', texto: 'Este cliente todavía no tiene precios por modelo.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', ancho: 'xl', celda: (t) => <>{nombreVape(t.modelo)}{t.estado === 'sin_disponibilidad' && <> <EstadoTexto tono="atencion">sin disponibilidad</EstadoTexto></>}</> },
            { id: 'p', titulo: 'Precio', numerica: true, ancho: 'm', celda: (t) => formatearMoneda(t.precioCent) },
            { id: 'mi', titulo: 'Margen vs Isaac', numerica: true, ancho: 'm', celda: (t) => { const m = t.margenes.find((x) => x.proveedor === 'Isaac'); return m ? <CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${f.id}:${t.modeloId}`} comprobacion="cuadra" /> : <SinDato />; } },
            { id: 'mk', titulo: 'Margen vs Karen', numerica: true, ancho: 'm', celda: (t) => { const m = t.margenes.find((x) => x.proveedor === 'Karen'); return m ? <><CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${f.id}:${t.modeloId}`} comprobacion="cuadra" /> {m.supuesto && <EstadoTexto tono="atencion">supuesto</EstadoTexto>}</> : <SinDato />; } },
            { id: 'd', titulo: 'Desde', ancho: 'm', secundaria: true, celda: (t) => etiquetaFecha(t.desde) },
            { id: 'o', titulo: 'Origen', ancho: 'l', secundaria: true, celda: (t) => <>{etiquetaOrigen(t.origen)}{t.nota && <><br /><span className="rtm-nota">{t.nota}</span></>}</> },
          ]}
        />
      </Tarjeta>

      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta plana titulo="Pedidos del cliente" descripcion={`${pedidos.length} en el libro`}>
          <DataTable
            etiqueta={`Pedidos de ${f.nombre}`} densidad="densa" plana primeraFija clave={(p) => p.id} filas={pedidos}
            vacio={{ titulo: 'Sin pedidos', texto: 'Este cliente todavía no tiene pedidos.', accion: <Link className="rtm-boton" href={`/pedidos/nuevo?cliente=${f.id}`}>Nuevo pedido</Link> }}
            totales={pedidos.length ? { etiqueta: 'Totales', celdas: { b: formatearMoneda(compra), z: formatearPiezas(pedidos.reduce((a, p) => a + p.piezas_pedidas, 0)) } } : undefined}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'm', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
              { id: 'd', titulo: 'Fecha', ancho: 'm', celda: (p) => etiquetaFecha(p.fecha_neg) },
              { id: 'z', titulo: 'Piezas', numerica: true, ancho: 's', celda: (p) => formatearPiezas(p.piezas_pedidas) },
              { id: 'b', titulo: 'Facturado', numerica: true, ancho: 'm', celda: (p) => (p.estado === 'enviado' ? formatearMoneda(p.cobrado_cent) : <SinDato />) },
              { id: 'e', titulo: 'Estado', ancho: 'm', celda: (p) => <ChipEstado tono={p.estado === 'enviado' ? 'ok' : p.estado === 'anulado' ? 'malo' : p.estado === 'confirmado' ? 'atencion' : 'apagado'}>{ESTADO_PEDIDO[p.estado].texto}</ChipEstado> },
            ]}
          />
        </Tarjeta>
        <Tarjeta plana titulo="Historial de precios" descripcion={`${f.historial.length} registros`}>
          <DataTable
            etiqueta={`Historial de precios de ${f.nombre}`} densidad="densa" plana primeraFija interactiva={{ porPagina: 25 }}
            clave={(h) => `${h.modelo}-${h.desde}-${h.precioCent}-${h.externo}`} filas={f.historial}
            vacio={{ titulo: 'Sin historial', texto: 'Aún no se ha registrado ningún precio.' }}
            columnas={[
              { id: 'm', titulo: 'Modelo', ancho: 'l', celda: (h) => nombreVape(h.modelo) },
              { id: 'p', titulo: 'Precio', numerica: true, ancho: 'm', celda: (h) => formatearMoneda(h.precioCent) },
              { id: 'd', titulo: 'Desde', ancho: 'm', celda: (h) => etiquetaFecha(h.desde) },
              { id: 'h', titulo: 'Hasta', ancho: 'm', secundaria: true, celda: (h) => (h.hasta ? etiquetaFecha(h.hasta) : '—') },
              { id: 'e', titulo: 'Estado', ancho: 'm', celda: (h) => (h.externo ? <EstadoTexto tono="atencion">Solo referencia</EstadoTexto> : h.vigente ? <EstadoTexto tono="ok">Vigente</EstadoTexto> : <EstadoTexto tono="neutro">Reemplazado</EstadoTexto>) },
            ]}
          />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
