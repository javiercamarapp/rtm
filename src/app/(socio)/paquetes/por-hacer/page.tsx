import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, formatearPiezas, nombreVape, saborMayus } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { ModelosSabores } from '@/ui/componentes/modelos-sabores';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { Aviso, ChipEstado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina as Contenedor, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { porcentaje } from '@/dominio/tablero/agregados';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { DialogoEnviar } from '../../operacion/dialogo-enviar';
import { BotonAccion } from '../../operacion/dialogo-simple';
import { ORIGEN } from '../../operacion/etiquetas';
import { DialogoReportarSalida } from '../dialogos-incidente';
import { TablaIncidentes } from '../tabla-incidentes';

export const metadata: Metadata = { title: 'Paquetes por hacer' };

export default async function PaginaPorHacer() {
  const lector = await operacionDeSocio();
  const [d, umbral, inc] = await Promise.all([lector.porHacer(), lector.umbralesPaquetes(), lector.incidentesPaquetes()]);
  const incAbiertos = inc.incidentes.filter((i) => i.sentido === 'salida' && i.estado === 'abierto').length;
  const faltan = d.surtido.filter((s) => s.falta > 0);
  const porEmpacar = d.pedidos.filter((p) => !p.empacado).length;
  const atrasados = d.pedidos.filter((p) => p.horas >= umbral.horas_sin_empacar).length;
  const piezasPorTomar = d.surtido.reduce((a, s) => a + s.piezas, 0);
  const piezasTotal = d.pedidos.reduce((a, p) => a + p.piezas, 0);
  const enviosCobrados = d.pedidos.reduce((a, p) => a + p.envio_cent, 0n);
  const masViejo = d.pedidos.reduce((a, p) => Math.max(a, p.horas), 0);
  const tope = Math.max(umbral.horas_sin_empacar * 2, masViejo, 1);
  const textoHoras = (h: number) => (h < 1 ? 'Menos de 1 h' : h < 48 ? `${h} h` : `${Math.floor(h / 24)} días`);
  return (
    <Contenedor ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Paquetes por hacer · ${etiquetaHoy()}`}
        titulo={d.pedidos.length === 0 ? 'No hay paquetes por hacer' : `Faltan por empacar y enviar ${d.pedidos.length} ${d.pedidos.length === 1 ? 'paquete' : 'paquetes'}`}
        descripcion={d.pedidos.length === 0 ? 'Cuando confirmes un pedido que sale de la bodega, aparecerá aquí con su lista de surtido.' : `${formatearPiezas(piezasTotal)} por tomar · el más antiguo lleva ${textoHoras(masViejo)}. Al marcar enviado se registra la guía y su costo real, se descuenta el inventario y se devenga la renta.`}
      />
      <KpiLinea
        etiquetaAria="Resumen de paquetes por hacer"
        celdas={[
          { id: 'por-empacar', testid: 'ph-por-empacar', etiqueta: 'Por empacar', valor: String(porEmpacar), categoria: 6, nota: `${d.pedidos.length} confirmados en total` },
          { id: 'empacados', testid: 'ph-empacados', etiqueta: 'Empacados sin enviar', valor: String(d.pedidos.length - porEmpacar), categoria: 3, nota: 'Falta marcar enviado con su guía' },
          { id: 'piezas', testid: 'ph-piezas', etiqueta: 'Piezas por tomar', valor: formatearPiezas(piezasPorTomar), categoria: 1, nota: `${d.surtido.length} modelos y sabores` },
          { id: 'atrasados', testid: 'ph-atrasados', etiqueta: `Con más de ${umbral.horas_sin_empacar} h`, valor: String(atrasados), categoria: 4, progreso: d.pedidos.length ? { pct: (atrasados / d.pedidos.length) * 100 } : undefined, nota: atrasados ? 'Superan el umbral sin empacar' : 'Ninguno rebasa el umbral' },
        ]}
      />
      <FilaRatios etiqueta="Razones de los paquetes" items={[{ etiqueta: 'Envíos cobrados', valor: d.pedidos.length ? formatearMoneda(enviosCobrados) : null }, { etiqueta: 'Piezas por paquete', valor: d.pedidos.length ? String(Math.round(piezasTotal / d.pedidos.length)) : null }, { etiqueta: 'Modelos que no alcanzan', valor: String(faltan.length) }, { etiqueta: 'Enviados en 14 días', valor: String(d.enviados_recientes.length) }, { etiqueta: 'Perdidos o dañados por resolver', valor: String(incAbiertos) }]} />
      {faltan.length > 0 && (
        <Aviso tono="atencion" titulo="Falta existencia antes de empacar.">
          <span data-testid="falta-sabor">{faltan.map((f) => `${f.modelo} · ${f.sabor}: faltan ${formatearPiezas(f.falta)}`).join(' · ')}</span>
        </Aviso>
      )}

      <Rejilla dividir="8-4" alinear="inicio">
        <Tarjeta titulo="Tiempo sin enviar" descripcion={`Horas desde la confirmación contra el umbral de ${umbral.horas_sin_empacar} h`}>
          {d.pedidos.length ? (
            <BarList
              etiquetaAria="Antigüedad de los paquetes por hacer" mostrarPct={false}
              items={[...d.pedidos].sort((a, b) => b.horas - a.horas).slice(0, 10).map((p) => ({ id: String(p.id), etiqueta: `${p.folio} · ${p.cliente}`, href: `/pedidos/${p.id}`, texto: textoHoras(p.horas), pct: porcentaje(p.horas, tope), umbral: porcentaje(umbral.horas_sin_empacar, tope) ?? undefined, tono: p.horas >= umbral.horas_sin_empacar ? ('malo' as const) : undefined, nota: p.empacado ? 'empacado' : 'por empacar' }))}
            />
          ) : <p className="rtm-a1-estado-vacio">Nada por empacar.</p>}
        </Tarjeta>
        <Tarjeta titulo="Alcanza la existencia" descripcion="Lo que hay que tomar contra lo que hay">
          {d.surtido.length ? (
            <BarList etiquetaAria="Surtido contra existencia" items={d.surtido.slice(0, 8).map((s) => ({ id: String(s.sku_id), etiqueta: `${nombreVape(s.modelo)} · ${saborMayus(s.sabor)}`, texto: `${s.piezas} de ${s.existencia}`, pct: s.existencia > 0 ? porcentaje(Math.min(s.piezas, s.existencia), s.existencia) : 100, tono: s.falta > 0 ? ('malo' as const) : undefined, nota: s.falta > 0 ? `faltan ${s.falta}` : undefined }))} />
          ) : <p className="rtm-a1-estado-vacio">Sin piezas por tomar.</p>}
        </Tarjeta>
      </Rejilla>
      <Tarjeta plana titulo="Pedidos confirmados" descripcion={`${d.pedidos.length} por empacar y enviar`}>
        <DataTable
          etiqueta="Paquetes por hacer" densidad="densa" plana pegajosa primeraFija interactiva={{ busqueda: 'Buscar pedido o cliente', exportar: 'paquetes-por-hacer' }}
          totales={d.pedidos.length ? { etiqueta: 'Totales', celdas: { z: formatearPiezas(piezasTotal), e: formatearMoneda(enviosCobrados) } } : undefined}
          clave={(p) => p.id}
          filas={d.pedidos}
          vacio={{ titulo: 'Nada por empacar', texto: 'Cuando confirmes un pedido que sale de la Bodega Omar, aparecerá aquí con su lista de surtido.', accion: <Link className="rtm-boton" href="/pedidos/nuevo">Nuevo pedido</Link> }}
          columnas={[
            { id: 'f', titulo: 'Pedido', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
            { id: 'c', titulo: 'Cliente', celda: (p) => <>{p.cliente}<br /><span className="rtm-nota">{ORIGEN[p.origen]}{p.paqueteria ? ` · ${p.paqueteria}` : ''}</span></> },
            { id: 'z', titulo: 'Piezas', numerica: true, celda: (p) => formatearPiezas(p.piezas) },
            { id: 'r', titulo: 'Por modelo y sabor', secundaria: true, ancho: 'xl', celda: (p) => <ModelosSabores variante="celda" testid={`ms-${p.id}`} renglones={p.renglones.map((r) => ({ modelo: r.modelo, sabor: r.sabor, piezas: r.piezas }))} /> },
            { id: 'e', titulo: 'Envío cobrado', numerica: true, secundaria: true, celda: (p) => (p.envio_cent > 0n ? formatearMoneda(p.envio_cent) : 'No se cobra') },
            { id: 'g', titulo: 'Guía', secundaria: true, celda: () => 'Pendiente' },
            { id: 'h', titulo: 'Antigüedad', celda: (p) => {
              const t = p.horas < 1 ? 'Menos de 1 h' : p.horas < 48 ? `${p.horas} h` : `${Math.floor(p.horas / 24)} días`;
              return p.horas >= umbral.horas_sin_empacar ? <EstadoTexto tono="atencion">{t}</EstadoTexto> : t;
            } },
            { id: 's', titulo: 'Estado', celda: (p) => <ChipEstado tono={p.empacado ? 'ok' : 'atencion'}>{p.empacado ? 'Empacado' : 'Por empacar'}</ChipEstado> },
            { id: 'a', titulo: 'Acciones', celda: (p) => (
              <span className="rtm-acciones-fila">
                {!p.empacado && <BotonAccion boton="Marcar empacado" accion="marcar_empacado" args={{ p_pedido: p.id }} chico testid={`empacar-${p.id}`} />}
                <DialogoEnviar pedidoId={p.id} folio={p.folio} renglones={p.renglones.map((r) => ({ linea_id: r.linea_id, modelo: r.modelo, sabor: r.sabor, piezas: r.piezas, disponible: r.disponible }))} avisosPendientes={0} chico />
              </span>
            ) },
          ]}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Lista de surtido" descripcion={`${d.surtido.length} modelos y sabores`}>
        <DataTable
          etiqueta="Lista de surtido por modelo y sabor" densidad="densa" plana primeraFija
          totales={d.surtido.length ? { etiqueta: 'Totales', celdas: { p: formatearPiezas(d.surtido.reduce((a, x) => a + x.piezas, 0)), e: formatearPiezas(d.surtido.reduce((a, x) => a + x.existencia, 0)) } } : undefined}
          clave={(s) => s.sku_id}
          filas={d.surtido}
          vacio={{ titulo: 'Sin piezas por tomar', texto: 'La lista de surtido suma las piezas de todos los paquetes por hacer y las compara con la existencia por sabor.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (s) => nombreVape(s.modelo) },
            { id: 's', titulo: 'Sabor', celda: (s) => saborMayus(s.sabor) },
            { id: 'p', titulo: 'Tomar', numerica: true, celda: (s) => formatearPiezas(s.piezas) },
            { id: 'e', titulo: 'Existencia', numerica: true, celda: (s) => formatearPiezas(s.existencia) },
            { id: 'f', titulo: 'Alcanza', celda: (s) => (s.falta > 0 ? <EstadoTexto tono="malo">Faltan {formatearPiezas(s.falta)}</EstadoTexto> : <EstadoTexto tono="ok">Sí</EstadoTexto>) },
          ]}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Enviados en los últimos 14 días" descripcion={`${d.enviados_recientes.length} envíos`}>
        <DataTable
          etiqueta="Enviados recientemente" densidad="densa" plana primeraFija
          clave={(p) => p.id}
          filas={d.enviados_recientes}
          vacio={{ titulo: 'Sin envíos recientes', texto: 'Aquí verás las guías de lo que ya salió.' }}
          columnas={[
            { id: 'f', titulo: 'Pedido', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
            { id: 'c', titulo: 'Cliente', celda: (p) => p.cliente },
            { id: 'd', titulo: 'Enviado', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_envio) },
            { id: 'g', titulo: 'Guía', celda: (p) => (p.guias ?? []).map((g) => `${g.paqueteria} ${g.numero}`).join(', ') || 'Sin guía' },
            { id: 'k', titulo: 'Costo de la guía', numerica: true, secundaria: true, celda: (p) => (p.guias ?? []).map((g) => (g.costo_cent === null ? 'Sin costear' : formatearMoneda(g.costo_cent))).join(', ') },
            { id: 'e', titulo: 'Estado', celda: (p) => {
              const abierto = inc.incidentes.find((i) => i.pedido_id === p.id && i.estado === 'abierto');
              if (abierto) return <EstadoTexto tono="malo">{abierto.tipo === 'perdido' ? 'Perdido' : 'Dañado'} · por resolver</EstadoTexto>;
              return <EstadoTexto tono={p.entregado ? 'ok' : 'atencion'}>{p.entregado ? 'Entregado' : 'Enviado'}</EstadoTexto>;
            } },
            { id: 'a', titulo: 'Acciones', celda: (p) => <DialogoReportarSalida pedidoId={p.id} folio={p.folio} /> },
          ]}
        />
      </Tarjeta>
      <TablaIncidentes incidentes={inc.incidentes} sentido="salida" testid="inc-salida" />
    </Contenedor>
  );
}
