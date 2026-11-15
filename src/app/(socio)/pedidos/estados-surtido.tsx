import Link from 'next/link';
import type { FechaNeg } from '@/dominio/calendario';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { EstadoPedido, PedidoResumen } from '@/dominio/operacion/tipos';
import { aNumero, porcentaje } from '@/dominio/tablero/agregados';
import { ChipEstado } from '@/ui/componentes/controles';
import { Composicion, type GrupoComposicion } from '@/ui/componentes/composicion';
import { BarList, ListaClaveValor } from '@/ui/componentes/datos';
import { SinDato } from '@/ui/componentes/estado-texto';
import { Tarjeta } from '@/ui/componentes/pagina';
import { ESTADO_PEDIDO } from '../operacion/etiquetas';
import { PROVEEDORES } from './desglose';

const TONO: Record<EstadoPedido, 'ok' | 'atencion' | 'malo' | 'apagado'> = { borrador: 'apagado', confirmado: 'atencion', enviado: 'ok', cancelado: 'apagado', anulado: 'malo' };
const CLIENTES_VISIBLES = 5;
const ULTIMOS_VISIBLES = 4;
const DIA_MS = 86_400_000;

const dias = (desde: FechaNeg, hasta: FechaNeg) => Math.max(0, Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS));
const pedidosTexto = (n: number) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`;

/** Lo que la tarjeta muestra, calculado solo con filas que la pagina ya trae (sin cifras nuevas). */
export function resumenEstados(todos: readonly PedidoResumen[], filas: readonly PedidoResumen[], hoy: FechaNeg) {
  const cuenta = (e: EstadoPedido) => todos.filter((p) => p.estado === e).length;
  const activos = todos.filter((p) => p.estado !== 'anulado' && p.estado !== 'cancelado');
  const surtidas = activos.reduce((a, p) => a + p.piezas_surtidas, 0);
  const porSurtir = todos.filter((p) => p.estado === 'confirmado' || p.estado === 'borrador').reduce((a, p) => a + Math.max(0, p.piezas_pedidas - p.piezas_surtidas), 0);
  const enviados = filas.filter((p) => p.estado === 'enviado');
  const facturado = enviados.reduce((a, p) => a + p.cobrado_cent, 0n);
  const porCliente = new Map<number, { id: number; nombre: string; total: bigint; n: number }>();
  for (const p of enviados) {
    const c = porCliente.get(p.cliente_id) ?? { id: p.cliente_id, nombre: p.cliente, total: 0n, n: 0 };
    c.total += p.cobrado_cent; c.n += 1;
    porCliente.set(p.cliente_id, c);
  }
  const clientes = [...porCliente.values()].sort((a, b) => (a.total === b.total ? a.nombre.localeCompare(b.nombre) : a.total > b.total ? -1 : 1));
  const ultimos = [...filas].sort((a, b) => (a.fecha_neg === b.fecha_neg ? b.id - a.id : a.fecha_neg < b.fecha_neg ? 1 : -1));
  const porEnviar = filas.filter((p) => p.estado === 'confirmado').sort((a, b) => (a.fecha_neg < b.fecha_neg ? -1 : a.fecha_neg > b.fecha_neg ? 1 : a.id - b.id));
  const masAntiguo = porEnviar[0] ? { folio: porEnviar[0].folio, id: porEnviar[0].id, dias: dias(porEnviar[0].fecha_neg, hoy) } : null;
  const origenes = Object.entries(PROVEEDORES).map(([clave, v]) => ({ clave, texto: v.texto, n: todos.filter((p) => v.origenes.includes(p.origen)).length }));
  return {
    estados: { borrador: cuenta('borrador'), confirmado: cuenta('confirmado'), enviado: cuenta('enviado'), anuladoOCancelado: cuenta('anulado') + cuenta('cancelado') },
    surtidas, porSurtir, enviados: enviados.length, facturado, clientes, ultimos, masAntiguo, origenes,
  };
}

/** Tarjeta derecha de Pedidos: estados, surtido y origen apilados, top de clientes, ultimos pedidos y razones. Sin espacio vacio. */
export function TarjetaEstadosSurtido({ todos, filas, hoy }: { todos: readonly PedidoResumen[]; filas: readonly PedidoResumen[]; hoy: FechaNeg }) {
  const r = resumenEstados(todos, filas, hoy);
  const grupos: GrupoComposicion[] = [
    { id: 'estado', titulo: 'Por estado', segmentos: [
      { id: 'enviado', etiqueta: 'Enviados', valor: r.estados.enviado, texto: String(r.estados.enviado) },
      { id: 'confirmado', etiqueta: 'Por enviar', valor: r.estados.confirmado, texto: String(r.estados.confirmado) },
      { id: 'borrador', etiqueta: 'Borradores', valor: r.estados.borrador, texto: String(r.estados.borrador) },
      { id: 'anulado', etiqueta: 'Anulados', valor: r.estados.anuladoOCancelado, texto: String(r.estados.anuladoOCancelado) },
    ] },
    { id: 'surtido', titulo: 'Surtido de piezas', segmentos: [
      { id: 'surtidas', etiqueta: 'Surtidas', valor: r.surtidas, texto: formatearPiezas(r.surtidas) },
      { id: 'porsurtir', etiqueta: 'Por surtir', valor: r.porSurtir, texto: formatearPiezas(r.porSurtir) },
    ] },
    { id: 'origen', titulo: 'Origen del pedido', segmentos: r.origenes.map((o) => ({ id: o.clave, etiqueta: o.texto, valor: o.n, texto: String(o.n) })) },
  ];
  const piezasPedidas = r.surtidas + r.porSurtir;
  const ticket = r.enviados ? r.facturado / BigInt(r.enviados) : null;
  const utilidad = filas.filter((p) => p.estado === 'enviado' && p.utilidad_cent !== null);
  const utilidadTot = utilidad.length ? utilidad.reduce((a, p) => a + (p.utilidad_cent ?? 0n), 0n) : null;
  const margen = utilidadTot !== null && r.facturado > 0n ? `${((aNumero(utilidadTot) / aNumero(r.facturado)) * 100).toFixed(1)} %` : null;
  const topClientes = r.clientes.slice(0, CLIENTES_VISIBLES);
  const totalFact = aNumero(r.facturado);
  const ultimos = r.ultimos.slice(0, ULTIMOS_VISIBLES);

  return (
    <Tarjeta titulo="Estados y surtido" descripcion="Estados, surtido y origen del libro completo; clientes y últimos pedidos según el filtro">
      <Composicion etiquetaAria="Estados, surtido y origen de los pedidos" grupos={grupos} />
      <div className="rtm-a1-cuerpo">
        <p className="rtm-a1-subtitulo">Clientes con más facturado</p>
        {topClientes.length === 0 ? <p className="rtm-a1-estado-vacio">Sin dato</p> : (
          <BarList etiquetaAria="Clientes con más facturado" items={topClientes.map((c) => ({ id: String(c.id), etiqueta: c.nombre, nota: pedidosTexto(c.n), texto: formatearMoneda(c.total), pct: porcentaje(aNumero(c.total), totalFact), href: `/clientes/${c.id}` }))} />
        )}
      </div>
      <div className="rtm-a1-cuerpo">
        <p className="rtm-a1-subtitulo">Últimos pedidos</p>
        {ultimos.length === 0 ? <p className="rtm-a1-estado-vacio">Sin dato</p> : (
          <ul className="rtm-a1-ultimos" aria-label="Últimos pedidos del filtro">
            {ultimos.map((p) => (
              <li key={p.id}>
                <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link>
                <span className="rtm-a1-ultimos-cliente">{p.cliente}</span>
                <span className="rtm-a1-ultimos-total">{p.estado === 'enviado' ? formatearMoneda(p.cobrado_cent) : <SinDato />}</span>
                <ChipEstado tono={TONO[p.estado]}>{ESTADO_PEDIDO[p.estado].texto}</ChipEstado>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ListaClaveValor columnas={2} items={[
        { k: 'Ticket promedio', v: ticket === null ? <SinDato /> : formatearMoneda(ticket) },
        { k: 'Margen sobre lo facturado', v: margen ?? <SinDato /> },
        { k: 'Surtido de lo pedido', v: piezasPedidas > 0 ? `${((r.surtidas / piezasPedidas) * 100).toFixed(0)} %` : <SinDato /> },
        { k: 'Por enviar más antiguo', v: r.masAntiguo ? <><Link className="rtm-mono" href={`/pedidos/${r.masAntiguo.id}`}>{r.masAntiguo.folio}</Link> · {r.masAntiguo.dias} {r.masAntiguo.dias === 1 ? 'día' : 'días'}</> : <SinDato /> },
      ]} />
    </Tarjeta>
  );
}
