import type { Metadata } from 'next';
import Link from 'next/link';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { ChipEstado } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { PestanasDs } from '../comun';

export const metadata: Metadata = { title: 'Por cobrar de dropshipping' };

export default async function PaginaPorCobrarDs() {
  const ds = await dropshippingDeSocio();
  const [r, resumen] = await Promise.all([ds.porCobrar(), ds.resumen()]);
  const filas = r.filas;
  const saldo = filas.reduce((a, f) => a + (f.saldo_cliente_cent !== null && f.saldo_cliente_cent > 0n ? f.saldo_cliente_cent : 0n), 0n);
  const intereses = filas.reduce((a, f) => a + (f.interes_cent ?? 0n), 0n);
  const vencidos = filas.filter((f) => f.dias_para_vencer < 0 && (f.saldo_cliente_cent ?? 0n) > 0n);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Dropshipping · Por cobrar · ${etiquetaHoy()}`}
        titulo={filas.length ? `${filas.length} ${filas.length === 1 ? 'venta a crédito' : 'ventas a crédito'} con interés` : 'Sin ventas a crédito todavía'}
        descripcion="Interés semanal simple (10 % de una semana por omisión), calculado por la base. Se liquida normalmente a la semana, por el monto pactado."
      />
      <PestanasDs activa="por-cobrar" sinFolio={resumen.sin_folio_externo} />
      <KpiLinea
        etiquetaAria="Crédito de dropshipping"
        celdas={[
          { id: 'saldo', etiqueta: 'Por cobrar', valor: formatearMoneda(saldo), categoria: 1, nota: 'Saldo de las ventas a crédito enviadas' },
          { id: 'int', etiqueta: 'Intereses pactados', valor: formatearMoneda(intereses), categoria: 2 },
          { id: 'venc', etiqueta: 'Vencidas', valor: String(vencidos.length), categoria: 4, nota: vencidos.length ? 'Pasó la fecha de pago pactada' : 'Ninguna vencida' },
        ]}
      />
      <Tarjeta plana titulo="Ventas a crédito" descripcion={`Hoy es ${etiquetaFecha(r.hoy)}`}>
        <DataTable
          etiqueta="Ventas a crédito"
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar folio o cliente', porPagina: 50, exportar: 'dropshipping-por-cobrar' }}
          clave={(f) => f.pedido_id}
          filas={filas}
          vacio={{ titulo: 'Sin ventas a crédito todavía', texto: 'Al capturar un pedido con la casilla de crédito aparecerá aquí con su interés y su fecha de pago.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', ancho: 'm', prioridadMovil: 'normal', celda: (f) => <Link className="rtm-mono" href={`/dropshipping/pedidos/${f.pedido_id}`}>{f.folio}</Link> },
            { id: 'c', titulo: 'Cliente', ancho: 'xl', prioridadMovil: 'titulo', celda: (f) => f.cliente },
            { id: 'v', titulo: 'Total pactado', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => formatearMoneda(f.venta_cent) },
            { id: 'i', titulo: 'Interés', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => formatearMoneda(f.interes_cent ?? 0n) },
            { id: 't', titulo: 'Condiciones', ancho: 'l', prioridadMovil: 'detalle', celda: (f) => (f.modo_interes === 'fijo' ? 'Monto pactado' : `${((f.tasa_semanal_bp ?? 0) / 100).toFixed(2)} % x ${f.semanas} sem. (${f.modo_interes === 'compuesto' ? 'compuesto' : 'simple'})`) },
            { id: 'fp', titulo: 'Fecha de pago', ancho: 'm', prioridadMovil: 'normal', celda: (f) => (f.fecha_pago_pactada ? etiquetaFecha(f.fecha_pago_pactada) : '') },
            { id: 's', titulo: 'Saldo', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => (f.saldo_cliente_cent === null ? 'Aún no enviado' : formatearMoneda(f.saldo_cliente_cent)) },
            { id: 'e', titulo: 'Estado', ancho: 'm', prioridadMovil: 'normal', celda: (f) => (f.saldo_cliente_cent === null ? <ChipEstado tono="apagado">Por enviar</ChipEstado> : f.saldo_cliente_cent <= 0n ? <ChipEstado tono="ok">Saldado</ChipEstado> : f.dias_para_vencer < 0 ? <ChipEstado tono="malo">{`Vencido hace ${-f.dias_para_vencer} d`}</ChipEstado> : <ChipEstado tono="atencion">{`Vence en ${f.dias_para_vencer} d`}</ChipEstado>) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
