import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { GraficaBarras } from '@/ui/graficas/barras';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Inventario' };

export default async function Pagina() {
  const ex = await (await lectorDeSocio()).existencia();
  const conDato = ex.modelos.filter((m) => m.piezas !== null);
  const nombre = new Map(ex.modelos.map((m) => [m.modeloId, m.modelo]));
  const mayor = conDato.reduce((a, m) => Math.max(a, m.piezas ?? 0), 0);
  const top = [...conDato].sort((a, b) => (b.piezas ?? 0) - (a.piezas ?? 0)).slice(0, 12);

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Inventario · ${etiquetaHoy()}`}
        antes={conDato.length === 0 ? 'Todavía no hay' : 'Existencias de'}
        enfasis={conDato.length === 0 ? 'existencias' : `${conDato.length} modelos`}
        despues={conDato.length === 0 ? '' : 'en la Bodega Omar'}
        contexto="Existencia por modelo y sabor con costo promedio ponderado. El inventario es de Angelo y Javier; su ubicación es la Bodega Omar. Lo que no tiene movimientos se muestra como “Sin dato”, nunca como cero."
      />

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Existencia por modelo">
        <h2>Por modelo</h2>
        <DataTable
          etiqueta="Existencia por modelo"
          clave={(m) => m.modeloId}
          filas={ex.modelos}
          vacio={{ titulo: 'Sin modelos', texto: 'Primero se carga el catálogo.', accion: <Link className="rtm-boton" href="/catalogo">Ir al catálogo</Link> }}
          columnas={[
            { id: 'marca', titulo: 'Marca', secundaria: true, celda: (m) => m.marca },
            { id: 'm', titulo: 'Modelo', celda: (m) => m.modelo },
            { id: 'e', titulo: 'Existencia', numerica: true, celda: (m) => <CifraComprobada texto={m.piezas === null ? null : formatearPiezas(m.piezas)} cifra={`existencia:modelo:${m.modeloId}`} comprobacion="cuadra" /> },
            { id: 'v', titulo: 'Valor', numerica: true, secundaria: true, celda: (m) => (m.valorCent === null ? <SinDato /> : formatearMoneda(m.valorCent)) },
            { id: 'c', titulo: 'Costo promedio', numerica: true, secundaria: true, celda: (m) => (m.costoPromCent === null ? <SinDato /> : formatearMoneda(m.costoPromCent)) },
            { id: 's', titulo: 'Estado', celda: (m) => m.piezas === null ? <SinDato /> : m.piezas === 0 ? <EstadoTexto tono="malo">Sin existencia</EstadoTexto> : <EstadoTexto tono="ok">Con existencia</EstadoTexto> },
            { id: 'u', titulo: 'Último movimiento', secundaria: true, celda: (m) => (m.ultimoMovimiento ? etiquetaFechaHora(m.ultimoMovimiento) : <SinDato />) },
          ]}
        />
      </section>

      {top.length >= 2 && (
        <GraficaBarras
          titulo="Existencia por modelo (los 12 con más piezas)"
          unidad="Piezas"
          descripcion={`Piezas en la Bodega Omar de ${top.length} modelos; el que más tiene está resaltado.`}
          datos={top.map((m) => ({ etiqueta: m.modelo, valor: m.piezas ?? 0, texto: formatearPiezas(m.piezas ?? 0), destacado: (m.piezas ?? 0) === mayor }))}
        />
      )}

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Existencia por sabor y ubicación">
        <h2>Por sabor y ubicación</h2>
        <DataTable
          etiqueta="Existencia por sabor y ubicación"
          clave={(s) => `${s.skuId}-${s.ubicacionCodigo}`}
          filas={ex.sabores}
          vacio={{ titulo: 'Sin existencias por sabor', texto: 'La existencia sale del libro de movimientos y se llenará con la primera compra recibida y contada. Hasta entonces: Sin dato.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (s) => nombre.get(s.modeloId) ?? '—' },
            { id: 's', titulo: 'Sabor', celda: (s) => s.sabor },
            { id: 'u', titulo: 'Ubicación', celda: (s) => s.ubicacion },
            { id: 'p', titulo: 'Piezas', numerica: true, celda: (s) => formatearPiezas(s.piezas) },
          ]}
        />
      </section>
    </>
  );
}
