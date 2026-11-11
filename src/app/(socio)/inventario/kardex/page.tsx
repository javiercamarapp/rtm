import type { Metadata } from 'next';
import Link from 'next/link';
import { inventarioDeSocio } from '@/composicion/inventario';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { GraficaLinea } from '@/ui/graficas/linea';
import { etiquetaHoy } from '../../contexto';

export const metadata: Metadata = { title: 'Kárdex' };

const TIPO: Record<string, string> = {
  entrada_compra: 'Entrada de compra', salida_pedido: 'Salida de pedido', salida_toma_omar: 'Toma de Omar', devolucion: 'Devolución', merma: 'Merma',
  ajuste_conteo: 'Ajuste de conteo', traspaso_puente: 'Traspaso del puente', reversa: 'Reversa',
};
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function Pagina({ searchParams }: { searchParams: Promise<{ modelo?: string; sku?: string; ini?: string; fin?: string }> }) {
  const sp = await searchParams;
  const lector = await inventarioDeSocio();
  const inv = await lector.completo();
  const modelos = inv.modelos.filter((m) => m.piezas !== null).map((m) => ({ id: m.modelo_id, marca: m.marca, nombre: m.modelo }));
  const modeloId = Number(sp.modelo) > 0 ? Number(sp.modelo) : (modelos[0]?.id ?? 0);
  const sku = Number(sp.sku) > 0 ? Number(sp.sku) : null;
  const ini = sp.ini && FECHA.test(sp.ini) ? sp.ini : null;
  const fin = sp.fin && FECHA.test(sp.fin) ? sp.fin : null;
  const k = modeloId > 0 ? await lector.kardex(modeloId, sku, ini, fin, 500) : null;

  if (!k) {
    return (
      <>
        <EncabezadoPagina eyebrow={`Kárdex · ${etiquetaHoy()}`} antes="Todavía no hay" enfasis="movimientos" contexto="El kárdex muestra, por modelo y sabor, cada entrada y salida con su costo promedio. Aparece con la primera compra recibida y contada." />
        <div className="rtm-dt-aviso">
          <strong>Sin movimientos</strong>
          <p>Cuando se reciba una compra, cada movimiento quedará aquí con hora, autor y mensaje original.</p>
          <Link className="rtm-boton" href="/proveedores">Ir a proveedores</Link>
        </div>
      </>
    );
  }
  const ultimo = k.movimientos[k.movimientos.length - 1];
  const cronologico = k.movimientos;
  const puntos = cronologico.map((m) => ({ etiqueta: etiquetaFecha(m.fecha_neg), valor: m.saldo_piezas, texto: `${formatearPiezas(m.saldo_piezas)} pz` }));
  const exportar = new URLSearchParams({ modelo: String(modeloId), ...(sku ? { sku: String(sku) } : {}), ...(ini ? { ini } : {}), ...(fin ? { fin } : {}) });
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Kárdex · ${etiquetaHoy()}`}
        antes="Movimientos de"
        enfasis={k.modelo.nombre}
        despues={k.modelo.marca}
        contexto="Valor y costo promedio por modelo (no dependen del sabor); piezas por modelo y sabor. Una reversa se muestra con trazo discontinuo y enlaza al movimiento que corrige."
        acciones={<a className="rtm-boton" href={`/inventario/kardex/exportar?${exportar}`} data-testid="kardex-exportar">Exportar CSV</a>}
      />
      <form className="rtm-barra-filtros rtm-entra rtm-i-1" method="get" aria-label="Elegir modelo y sabor">
        <label className="rtm-etiqueta-campo">Modelo
          <select className="rtm-campo" name="modelo" defaultValue={String(modeloId)} data-testid="kardex-modelo">
            {modelos.map((m) => <option key={m.id} value={m.id}>{m.marca} · {m.nombre}</option>)}
          </select>
        </label>
        <label className="rtm-etiqueta-campo">Sabor
          <select className="rtm-campo" name="sku" defaultValue={sku ? String(sku) : ''}>
            <option value="">Todos</option>
            {k.sabores.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sabor}</option>)}
          </select>
        </label>
        <label className="rtm-etiqueta-campo">Desde<input className="rtm-campo" type="date" name="ini" defaultValue={ini ?? ''} /></label>
        <label className="rtm-etiqueta-campo">Hasta<input className="rtm-campo" type="date" name="fin" defaultValue={fin ?? ''} /></label>
        <button type="submit" className="rtm-boton">Ver</button>
      </form>

      <p className="rtm-nota" data-testid="kardex-comprobacion">
        Comprobación por dos vías: {k.comprobacion.via1.toLowerCase()} {formatearMoneda(k.comprobacion.via1_valor_cent)}; {k.comprobacion.via2.toLowerCase()} {formatearMoneda(k.comprobacion.via2_valor_cent)}
        {' — '}
        <EstadoTexto tono={k.comprobacion.cuadra ? 'ok' : 'malo'}>{k.comprobacion.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto>
      </p>
      {k.apertura && <p className="rtm-nota">Antes del periodo: {formatearPiezas(k.apertura.piezas)} pz, {formatearMoneda(k.apertura.valor_cent)}{k.apertura.costo_prom_cent === null ? '' : `, costo promedio ${formatearMoneda(k.apertura.costo_prom_cent)}`}.</p>}
      {k.truncado && <p className="rtm-nota">Se muestran los {k.movimientos.length} movimientos más recientes de {k.total}; usa las fechas para acotar o exporta el CSV.</p>}

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Movimientos del kárdex">
        <DataTable
          etiqueta="Kárdex por modelo y sabor"
          clave={(m) => m.id}
          filas={[...k.movimientos].reverse()}
          vacio={{ titulo: 'Sin movimientos en este periodo', texto: 'Cambia las fechas o el sabor.' }}
          columnas={[
            { id: 'h', titulo: 'Fecha y hora', celda: (m) => etiquetaFechaHora(m.hora) },
            { id: 't', titulo: 'Tipo y referencia', celda: (m) => (
              <span className={m.es_reversa ? 'rtm-reversa' : undefined} data-testid={m.es_reversa ? 'kardex-reversa' : undefined}>
                {TIPO[m.tipo] ?? m.tipo}<br /><span className="rtm-nota rtm-mono">{m.referencia}{m.reversa_de ? ` · corrige el movimiento ${m.reversa_de}` : ''}</span>
              </span>
            ) },
            { id: 's', titulo: 'Sabor', secundaria: true, celda: (m) => m.sabor },
            { id: 'e', titulo: 'Entra', numerica: true, celda: (m) => (m.entra_piezas === null ? '' : <>{formatearPiezas(m.entra_piezas)} pz<br /><span className="rtm-nota">{m.entra_unit_cent === null ? '' : `${formatearMoneda(m.entra_unit_cent)} c/u · ${formatearMoneda(m.entra_total_cent ?? 0n)}`}</span></>) },
            { id: 'x', titulo: 'Sale', numerica: true, celda: (m) => (m.sale_piezas === null ? '' : <>{formatearPiezas(m.sale_piezas)} pz<br /><span className="rtm-nota">{m.sale_unit_cent === null ? '' : `${formatearMoneda(m.sale_unit_cent)} c/u · ${formatearMoneda(m.sale_total_cent ?? 0n)}`}</span></>) },
            { id: 'ex', titulo: 'Existencia', numerica: true, celda: (m) => <>{formatearPiezas(m.saldo_piezas)} pz<br /><span className="rtm-nota">{formatearMoneda(m.saldo_valor_cent)}</span></> },
            { id: 'cp', titulo: 'Costo promedio', numerica: true, secundaria: true, celda: (m) => (m.costo_prom_cent === null ? 'Sin existencia' : formatearMoneda(m.costo_prom_cent)) },
            { id: 'q', titulo: 'Quién y mensaje original', secundaria: true, celda: (m) => <>{m.autor ?? 'Sistema'} · {m.canal}{m.mensaje_origen ? <><br /><span className="rtm-nota">“{m.mensaje_origen}”</span></> : null}</> },
          ]}
        />
      </section>
      {puntos.length >= 2 && ultimo && <GraficaLinea titulo="Existencia del modelo (piezas)" puntos={puntos} descripcion={`Existencia del modelo en ${puntos.length} movimientos; ahora ${formatearPiezas(ultimo.saldo_piezas)} piezas.`} unidad="Piezas" />}
    </>
  );
}
