import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { BotonAccion } from '../../operacion/dialogo-simple';
import { ESTADO_COMPRA } from '../../operacion/etiquetas';
import { FormularioGuia } from './formulario-guia';

export const metadata: Metadata = { title: 'Paquetes en trayecto' };

export default async function Pagina() {
  const lista = await (await operacionDeSocio()).enTransito();
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Paquetes en trayecto · ${etiquetaHoy()}`}
        antes={lista.length === 0 ? 'No hay' : 'Vienen en camino'}
        enfasis={lista.length === 0 ? 'paquetes' : `${lista.length} ${lista.length === 1 ? 'orden' : 'órdenes'}`}
        contexto="El dinero se descuenta al confirmar la orden, pero las piezas no cuentan como existencia hasta que un socio confirma la recepción en Mérida, por sabor."
      />
      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Órdenes en camino">
        <DataTable
          etiqueta="Paquetes en trayecto"
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
            { id: 'd', titulo: 'Días en camino', numerica: true, secundaria: true, celda: (c) => (c.dias_en_camino === null ? 'Sin dato' : c.dias_en_camino) },
            { id: 's', titulo: 'Estado', celda: (c) => <EstadoTexto tono={ESTADO_COMPRA[c.estado].tono}>{ESTADO_COMPRA[c.estado].texto}</EstadoTexto> },
            { id: 'a', titulo: 'Acciones', celda: (c) => (
              <span className="rtm-acciones-fila">
                <FormularioGuia compraId={c.id} folio={c.folio} />
                {c.estado !== 'llego_merida' && <BotonAccion boton="Llegó a Mérida" accion="marcar_llego_merida" args={{ p_compra: c.id }} chico testid={`llego-${c.id}`} />}
                <Link className="rtm-boton rtm-boton-chico rtm-boton-primario" href={`/proveedores/compras/${c.id}#recepcion`}>Confirmar recepción</Link>
              </span>
            ) },
          ]}
        />
      </section>
    </>
  );
}
