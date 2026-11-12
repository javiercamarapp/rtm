import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { proveedoresDeSocio } from '@/composicion/proveedores';
import { etiquetaFechaHora, formatearMoneda } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { CopiarLista } from './copiar-lista';

export const metadata: Metadata = { title: 'Inventario actual de proveedores' };

const EVENTOS: Record<string, string> = {
  modelo_nuevo: 'Modelo nuevo', sabor_nuevo: 'Sabor nuevo', sabor_agotado: 'Sabor agotado', sabor_regreso: 'Regresó un sabor', modelo_agotado: 'Modelo agotado', renombrado: 'Cambió de nombre',
  modelo_descontinuado: 'Modelo descontinuado', sabor_descontinuado: 'Sabor descontinuado', modelo_regreso_catalogo: 'Volvió al catálogo', inestable: 'Sabor inestable', poca_variedad: 'Poca variedad',
  variedad_recuperada: 'Variedad recuperada', promocion_nueva: 'Promoción nueva', promocion_anunciada: 'Promoción anunciada', promocion_por_terminar: 'Promoción por terminar', promocion_terminada: 'Promoción terminada', lectura_retenida: 'Lectura retenida',
};

export default async function Pagina() {
  const [p, catalogo] = await Promise.all([proveedoresDeSocio(), lectorDeSocio()]);
  const clientes = (await catalogo.clientes()).filter((c) => c.activo && !c.esBodega).map((c) => ({ id: c.id, nombre: c.nombre }));
  const f = p.frescura;
  const marcas = [...new Set(p.modelos.map((m) => m.marca))].sort();
  const sinLectura = f.ultima_lectura_ok === null;
  const estadoFuente = f.bloqueada ? 'Bloqueada' : sinLectura ? 'Sin lecturas' : f.desactualizado ? 'Dato desactualizado' : 'Al día';

  return (
    <>
      <p className="rtm-migaja"><Link href="/proveedores">Proveedores</Link> / Inventario actual de proveedores</p>
      <EncabezadoPagina
        eyebrow="Inventario actual de proveedores"
        antes="Lo que hay en"
        enfasis="Karen"
        contexto="Modelos, sabores y disponibilidad, leídos cada hora. Aquí nunca hay precios del proveedor: los costos los da Javier."
        acciones={<Link className="rtm-boton" href="/proveedores/compras/nueva?p=Karen" data-testid="oc-karen">Crear orden de compra a Karen</Link>}
      />

      <section className="rtm-aviso" role="status" data-testid="estado-fuente" aria-label="Estado de la lectura">
        <strong>Inventario de Karen: <EstadoTexto tono={estadoFuente === 'Al día' ? 'ok' : 'atencion'}>{estadoFuente}</EstadoTexto></strong>
        <p>
          {sinLectura ? 'Todavía no hay una lectura. ' : `Última lectura ${etiquetaFechaHora(f.ultima_lectura_ok!)} (hace ${f.horas ?? 0} h). `}
          {!f.lectura_activa ? 'La lectura automática está apagada hasta que se active el interruptor. ' : ''}
          {f.desactualizado && !sinLectura ? 'Con más de 3 horas sin lectura la lista para clientes queda bloqueada. ' : ''}
          Peticiones de hoy: {f.peticiones_hoy} de {f.tope_dia}.
        </p>
      </section>

      <section className="rtm-seccion" aria-label="Lista para clientes">
        <h2>Lista para clientes</h2>
        <CopiarLista marcas={marcas} clientes={clientes} bloqueada={f.desactualizado} />
      </section>

      {p.promociones.length > 0 && (
        <section className="rtm-seccion" aria-label="Promociones">
          <h2>Promociones</h2>
          <p className="rtm-contexto">Solo la bandera, el tipo, el porcentaje, los modelos y las fechas. Es informativo: una promoción puede no aplicar a mayoreo.</p>
          <ul className="rtm-avisos">
            {p.promociones.map((x) => (
              <li key={x.clave} className="rtm-aviso"><strong>{x.etiqueta}{x.fin ? ` · hasta ${etiquetaFechaHora(x.fin)}` : ''}</strong><p>{x.modelos.join(', ') || 'Todos los modelos de la campaña'}</p></li>
            ))}
          </ul>
        </section>
      )}

      <section className="rtm-seccion" aria-label="Modelos">
        <h2>Inventario de Karen</h2>
        <DataTable
          etiqueta="Modelos y sabores del proveedor"
          clave={(m) => m.producto_id}
          filas={p.modelos}
          vacio={{ titulo: 'Sin lecturas todavía', texto: 'Cuando se active la lectura horaria, aquí aparecerán los modelos y sabores. Mientras tanto la lista para clientes no está disponible.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (m) => <><strong>{m.titulo}</strong><br /><span className="rtm-nota">{m.marca}</span></> },
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
      </section>

      <section className="rtm-seccion" aria-label="Por confirmar">
        <h2>Nombres por confirmar</h2>
        {p.cola.length === 0 ? <p className="rtm-nota">Nada por confirmar.</p> : (
          <DataTable etiqueta="Cola de confirmación" clave={(c) => `${c.tipo}:${c.texto}`} filas={p.cola} columnas={[
            { id: 't', titulo: 'Tipo', celda: (c) => (c.tipo === 'modelo' ? 'Modelo' : 'Sabor') },
            { id: 'x', titulo: 'Nombre del proveedor', celda: (c) => c.texto },
            { id: 'c', titulo: 'Se parece a', secundaria: true, celda: (c) => (c.similitud === null ? 'Sin sugerencia' : `${Math.round(c.similitud * 100)} % de parecido`) },
          ]} />
        )}
      </section>

      <section className="rtm-seccion" aria-label="Cambios recientes">
        <h2>Cambios recientes</h2>
        <DataTable etiqueta="Cambios detectados" clave={(e) => e.clave} filas={p.eventos}
          vacio={{ titulo: 'Sin cambios', texto: 'Solo se guardan los cambios, no una foto por hora.' }}
          columnas={[
            { id: 'w', titulo: 'Cuándo', celda: (e) => etiquetaFechaHora(e.en) },
            { id: 't', titulo: 'Cambio', celda: (e) => EVENTOS[e.tipo] ?? e.tipo },
            { id: 'm', titulo: 'Modelo', secundaria: true, celda: (e) => e.modelo ?? '' },
            { id: 'd', titulo: 'Detalle', secundaria: true, celda: (e) => [e.antes, e.despues].filter(Boolean).join(' → ') },
          ]} />
      </section>
    </>
  );
}
