import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { DialogoEnviar } from '../../operacion/dialogo-enviar';
import { BotonAccion } from '../../operacion/dialogo-simple';
import { ORIGEN } from '../../operacion/etiquetas';

export const metadata: Metadata = { title: 'Paquetes por hacer' };

export default async function Pagina() {
  const d = await (await operacionDeSocio()).porHacer();
  const faltan = d.surtido.filter((s) => s.falta > 0);
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Paquetes por hacer · ${etiquetaHoy()}`}
        antes={d.pedidos.length === 0 ? 'No hay' : 'Faltan por empacar y enviar'}
        enfasis={d.pedidos.length === 0 ? 'paquetes' : `${d.pedidos.length} ${d.pedidos.length === 1 ? 'paquete' : 'paquetes'}`}
        contexto="Los despachos los hacen Angelo y Javier; Omar solo presta el lugar. Al marcar enviado se registra la guía y su costo real, se descuenta el inventario y se devenga la renta de bodega."
      />
      {faltan.length > 0 && (
        <p className="rtm-aviso" role="status" data-testid="falta-sabor"><strong>Falta existencia antes de empacar</strong>{faltan.map((f) => <span key={f.sku_id}>{f.modelo} · {f.sabor}: faltan {formatearPiezas(f.falta)}</span>)}</p>
      )}
      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Pedidos por empacar">
        <h2>Pedidos confirmados</h2>
        <DataTable
          etiqueta="Paquetes por hacer"
          clave={(p) => p.id}
          filas={d.pedidos}
          vacio={{ titulo: 'Nada por empacar', texto: 'Cuando confirmes un pedido que sale de la Bodega Omar, aparecerá aquí con su lista de surtido.', accion: <Link className="rtm-boton" href="/pedidos/nuevo">Nuevo pedido</Link> }}
          columnas={[
            { id: 'f', titulo: 'Pedido', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
            { id: 'c', titulo: 'Cliente', celda: (p) => <>{p.cliente}<br /><span className="rtm-nota">{ORIGEN[p.origen]}</span></> },
            { id: 'z', titulo: 'Piezas', numerica: true, celda: (p) => formatearPiezas(p.piezas) },
            { id: 'r', titulo: 'Por modelo y sabor', secundaria: true, celda: (p) => p.renglones.map((r) => `${r.modelo} ${r.sabor} ${r.piezas}`).join(' · ') },
            { id: 'e', titulo: 'Envío cobrado', numerica: true, secundaria: true, celda: (p) => (p.envio_cent > 0n ? formatearMoneda(p.envio_cent) : 'No se cobra') },
            { id: 'h', titulo: 'Antigüedad', secundaria: true, celda: (p) => (p.horas < 1 ? 'Menos de 1 h' : p.horas < 48 ? `${p.horas} h` : `${Math.floor(p.horas / 24)} días`) },
            { id: 's', titulo: 'Estado', celda: (p) => <EstadoTexto tono={p.empacado ? 'ok' : 'atencion'}>{p.empacado ? 'Empacado' : 'Por empacar'}</EstadoTexto> },
            { id: 'a', titulo: 'Acciones', celda: (p) => (
              <span className="rtm-acciones-fila">
                {!p.empacado && <BotonAccion boton="Marcar empacado" accion="marcar_empacado" args={{ p_pedido: p.id }} chico testid={`empacar-${p.id}`} />}
                <DialogoEnviar pedidoId={p.id} folio={p.folio} renglones={p.renglones.map((r) => ({ linea_id: r.linea_id, modelo: r.modelo, sabor: r.sabor, piezas: r.piezas, disponible: r.disponible }))} avisosPendientes={0} chico />
              </span>
            ) },
          ]}
        />
      </section>
      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Lista de surtido">
        <h2>Lista de surtido</h2>
        <DataTable
          etiqueta="Lista de surtido por modelo y sabor"
          clave={(s) => s.sku_id}
          filas={d.surtido}
          vacio={{ titulo: 'Sin piezas por tomar', texto: 'La lista de surtido suma las piezas de todos los paquetes por hacer y las compara con la existencia por sabor.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (s) => s.modelo },
            { id: 's', titulo: 'Sabor', celda: (s) => s.sabor },
            { id: 'p', titulo: 'Tomar', numerica: true, celda: (s) => formatearPiezas(s.piezas) },
            { id: 'e', titulo: 'Existencia', numerica: true, celda: (s) => formatearPiezas(s.existencia) },
            { id: 'f', titulo: 'Alcanza', celda: (s) => (s.falta > 0 ? <EstadoTexto tono="malo">Faltan {formatearPiezas(s.falta)}</EstadoTexto> : <EstadoTexto tono="ok">Sí</EstadoTexto>) },
          ]}
        />
      </section>
      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Enviados recientemente">
        <h2>Enviados en los últimos 14 días</h2>
        <DataTable
          etiqueta="Enviados recientemente"
          clave={(p) => p.id}
          filas={d.enviados_recientes}
          vacio={{ titulo: 'Sin envíos recientes', texto: 'Aquí verás las guías de lo que ya salió.' }}
          columnas={[
            { id: 'f', titulo: 'Pedido', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
            { id: 'c', titulo: 'Cliente', celda: (p) => p.cliente },
            { id: 'd', titulo: 'Enviado', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_envio) },
            { id: 'g', titulo: 'Guía', celda: (p) => (p.guias ?? []).map((g) => `${g.paqueteria} ${g.numero}`).join(', ') || 'Sin guía' },
            { id: 'k', titulo: 'Costo de la guía', numerica: true, secundaria: true, celda: (p) => (p.guias ?? []).map((g) => (g.costo_cent === null ? 'Sin costear' : formatearMoneda(g.costo_cent))).join(', ') },
            { id: 'e', titulo: 'Estado', celda: (p) => <EstadoTexto tono={p.entregado ? 'ok' : 'atencion'}>{p.entregado ? 'Entregado' : 'Enviado'}</EstadoTexto> },
          ]}
        />
      </section>
    </>
  );
}
