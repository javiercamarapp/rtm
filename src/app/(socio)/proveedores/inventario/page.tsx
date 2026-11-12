import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { proveedoresDeSocio } from '@/composicion/proveedores';
import { etiquetaFechaHora, formatearMoneda } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { Aviso } from '@/ui/componentes/controles';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { CopiarLista } from './copiar-lista';

export const metadata: Metadata = { title: 'Inventario actual de proveedores' };

const EVENTOS: Record<string, string> = {
  modelo_nuevo: 'Modelo nuevo', sabor_nuevo: 'Sabor nuevo', sabor_agotado: 'Sabor agotado', sabor_regreso: 'Regresó un sabor', modelo_agotado: 'Modelo agotado', renombrado: 'Cambió de nombre',
  modelo_descontinuado: 'Modelo descontinuado', sabor_descontinuado: 'Sabor descontinuado', modelo_regreso_catalogo: 'Volvió al catálogo', inestable: 'Sabor inestable', poca_variedad: 'Poca variedad',
  variedad_recuperada: 'Variedad recuperada', promocion_nueva: 'Promoción nueva', promocion_anunciada: 'Promoción anunciada', promocion_por_terminar: 'Promoción por terminar', promocion_terminada: 'Promoción terminada', lectura_retenida: 'Lectura retenida',
};

export default async function PaginaInventarioProveedores() {
  const [p, catalogo] = await Promise.all([proveedoresDeSocio(), lectorDeSocio()]);
  const clientes = (await catalogo.clientes()).filter((c) => c.activo && !c.esBodega).map((c) => ({ id: c.id, nombre: c.nombre }));
  const f = p.frescura;
  const marcas = [...new Set(p.modelos.map((m) => m.marca))].sort();
  const sinLectura = f.ultima_lectura_ok === null;
  const estadoFuente = f.bloqueada ? 'Bloqueada' : sinLectura ? 'Sin lecturas' : f.desactualizado ? 'Dato desactualizado' : 'Al día';

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/proveedores', texto: 'Proveedores' }}
        eyebrow="Inventario actual de proveedores"
        titulo="Lo que hay en Karen"
        descripcion="Modelos, sabores y disponibilidad, leídos cada hora. Aquí nunca hay precios del proveedor: los costos los da Javier."
        acciones={<Link className="rtm-boton" href="/proveedores/compras/nueva?p=Karen" data-testid="oc-karen">Crear orden de compra a Karen</Link>}
      />

      <div data-testid="estado-fuente" role="status" aria-label="Estado de la lectura">
      <Aviso tono={estadoFuente === 'Al día' ? 'info' : 'atencion'} titulo={`Inventario de Karen: ${estadoFuente}`}>
        <span>
          {sinLectura ? 'Todavía no hay una lectura. ' : `Última lectura ${etiquetaFechaHora(f.ultima_lectura_ok!)} (hace ${f.horas ?? 0} h). `}
          {!f.lectura_activa ? 'La lectura automática está apagada hasta que se active el interruptor. ' : ''}
          {f.desactualizado && !sinLectura ? 'Con más de 3 horas sin lectura la lista para clientes queda bloqueada. ' : ''}
          Peticiones de hoy: {f.peticiones_hoy} de {f.tope_dia}.
        </span>
      </Aviso>
      </div>

      <Tarjeta titulo="Lista para clientes" descripcion="Texto listo para copiar y enviar">
        <CopiarLista marcas={marcas} clientes={clientes} bloqueada={f.desactualizado} />
      </Tarjeta>

      {p.promociones.length > 0 && (
        <Tarjeta titulo="Promociones" descripcion="Informativo: una promoción puede no aplicar a mayoreo">
          <ul className="rtm-avisos">
            {p.promociones.map((x) => (
              <li key={x.clave} className="rtm-aviso"><strong>{x.etiqueta}{x.fin ? ` · hasta ${etiquetaFechaHora(x.fin)}` : ''}</strong><p>{x.modelos.join(', ') || 'Todos los modelos de la campaña'}</p></li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <Tarjeta plana titulo="Inventario de Karen" descripcion={`${p.modelos.length} modelos`}>
        <DataTable
          plana
          densidad="densa"
          etiqueta="Modelos y sabores del proveedor"
          clave={(m) => m.producto_id}
          filas={p.modelos}
          vacio={{ titulo: 'Sin lecturas todavía', texto: 'Cuando se active la lectura horaria, aquí aparecerán los modelos y sabores. Mientras tanto la lista para clientes no está disponible.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', ancho: 'l', prioridadMovil: 'titulo', celda: (m) => <><strong>{m.titulo}</strong><br /><span className="rtm-nota">{m.marca}</span></> },
            { id: 's', titulo: 'Sabores', celda: (m) => {
              const disp = m.sabores.filter((s) => s.disponible).length;
              return (
                <details data-testid={`sabores-${m.producto_id}`}>
                  <summary>{disp} de {m.sabores.length} disponibles</summary>
                  <ul className="rtm-lista-sabores">{m.sabores.map((s) => <li key={s.variante_id} data-agotado={!s.disponible}>{s.sabor}{!s.disponible ? ' (agotado)' : ''}{s.inestable ? ' (inestable)' : ''}</li>)}</ul>
                </details>
              );
            } },
            { id: 'e', titulo: 'Nuestra existencia', numerica: true, secundaria: true, celda: (m) => m.existencia_propia },
            { id: 'c', titulo: 'Costo', secundaria: true, celda: (m) => (m.nuevo_sin_costo || !m.costo_vigente ? <EstadoTexto tono="atencion">Nuevo, sin costo</EstadoTexto> : formatearMoneda(BigInt(m.costo_vigente.costo_cent))) },
            { id: 'a', titulo: '', celda: (m) => (m.nuevo_sin_costo || !m.canonico_nombre ? <span className="rtm-nota">Da el costo y confirma el modelo antes de ordenar</span> : <Link href={`/proveedores/compras/nueva?p=Karen&modelo=${encodeURIComponent(m.canonico_nombre)}&d=${encodeURIComponent(m.sabores.filter((s) => s.disponible).map((s) => s.sabor).join(','))}`} data-testid={`orden-${m.producto_id}`}>Ordenar a Karen</Link>) },
          ]}
        />
      </Tarjeta>

      <div className="rtm-region-pag" aria-label="Por confirmar"><Tarjeta plana titulo="Nombres por confirmar" descripcion={`${p.cola.length} pendientes`}>
        {p.cola.length === 0 ? <p className="rtm-nota">Nada por confirmar.</p> : (
          <DataTable plana densidad="densa" etiqueta="Cola de confirmación" clave={(c) => `${c.tipo}:${c.texto}`} filas={p.cola} columnas={[
            { id: 't', titulo: 'Tipo', celda: (c) => (c.tipo === 'modelo' ? 'Modelo' : 'Sabor') },
            { id: 'x', titulo: 'Nombre del proveedor', celda: (c) => c.texto },
            { id: 'c', titulo: 'Se parece a', secundaria: true, celda: (c) => (c.similitud === null ? 'Sin sugerencia' : `${Math.round(c.similitud * 100)} % de parecido`) },
          ]} />
        )}
      </Tarjeta></div>

      <Tarjeta plana titulo="Cambios recientes" descripcion="Solo se guardan los cambios, no una foto por hora">
        <DataTable plana densidad="densa" etiqueta="Cambios detectados" clave={(e) => e.clave} filas={p.eventos}
          vacio={{ titulo: 'Sin cambios', texto: 'Solo se guardan los cambios, no una foto por hora.' }}
          columnas={[
            { id: 'w', titulo: 'Cuándo', ancho: 'm', prioridadMovil: 'titulo', celda: (e) => etiquetaFechaHora(e.en) },
            { id: 't', titulo: 'Cambio', celda: (e) => EVENTOS[e.tipo] ?? e.tipo },
            { id: 'm', titulo: 'Modelo', secundaria: true, celda: (e) => e.modelo ?? '' },
            { id: 'd', titulo: 'Detalle', secundaria: true, celda: (e) => [e.antes, e.despues].filter(Boolean).join(' → ') },
          ]} />
      </Tarjeta>
    </Pagina>
  );
}
