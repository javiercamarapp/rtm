import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lectorDeSocio } from '@/composicion/catalogo';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { GraficaBarras } from '@/ui/graficas/barras';
import { GraficaLinea } from '@/ui/graficas/linea';
import { etiquetaHoy } from '../../contexto';

export const metadata: Metadata = { title: 'Ficha de cliente' };

const ORIGEN: Record<string, string> = { documento: 'Documento de Angelo', chat: 'Indicación de un socio', lista_javier: 'Lista de Javier' };

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const f = await (await lectorDeSocio()).ficha(n);
  if (!f) notFound();

  const margenIsaac = f.tabulador.flatMap((t) => { const m = t.margenes.find((x) => x.proveedor === 'Isaac'); return m ? [{ modelo: t.modelo, margen: m.margenCent }] : []; });
  const mayor = margenIsaac.reduce<bigint>((a, m) => (m.margen > a ? m.margen : a), 0n);
  // Modelo con mas cambios de precio: su historial se dibuja como linea escalonada.
  const porModelo = new Map<string, typeof f.historial>();
  for (const h of f.historial.filter((x) => !x.externo)) porModelo.set(h.modelo, [...(porModelo.get(h.modelo) ?? []), h]);
  const [modeloLinea, serie] = [...porModelo.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ['', []];
  const puntos = [...serie].sort((a, b) => a.desde.localeCompare(b.desde));

  return (
    <>
      <p className="rtm-migaja"><Link href="/clientes">Clientes</Link> / {f.nombre}</p>
      <EncabezadoPagina
        eyebrow={`Ficha de cliente · ${etiquetaHoy()}`}
        antes="Cliente"
        enfasis={f.nombre}
        contexto={`${f.tabulador.length} modelos con precio vigente. Un precio de una nota no cambia el tabulador: solo cambia cuando un socio lo indica.`}
      />
      <div className="rtm-etiquetas" aria-label="Datos del cliente">
        {f.esBodega && <span className="rtm-etiqueta">Presta la bodega (Omar Yacaman, desactivado hasta M2)</span>}
        {f.alias.map((a) => <span key={a.alias} className="rtm-etiqueta">También: {a.alias}{a.porConfirmar ? ' (por confirmar)' : ''}{a.ambiguo ? ' (ambiguo)' : ''}</span>)}
        {f.destinos.map((d) => <span key={d.etiqueta} className="rtm-etiqueta">Destino: {d.etiqueta}</span>)}
      </div>
      {f.nota && <p className="rtm-nota">{f.nota}</p>}

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Tabulador">
        <h2>Tabulador vigente</h2>
        <DataTable
          etiqueta={`Tabulador de ${f.nombre}`}
          clave={(t) => t.modeloId}
          filas={f.tabulador}
          vacio={{ titulo: 'Sin tabulador', texto: 'Este cliente todavía no tiene precios por modelo.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (t) => <>{t.modelo}{t.estado === 'sin_disponibilidad' && <> <EstadoTexto tono="atencion">sin disponibilidad</EstadoTexto></>}</> },
            { id: 'p', titulo: 'Precio', numerica: true, celda: (t) => formatearMoneda(t.precioCent) },
            { id: 'mi', titulo: 'Margen vs Isaac', numerica: true, celda: (t) => { const m = t.margenes.find((x) => x.proveedor === 'Isaac'); return m ? <CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${f.id}:${t.modeloId}`} comprobacion="cuadra" /> : <SinDato />; } },
            { id: 'mk', titulo: 'Margen vs Karen', numerica: true, celda: (t) => { const m = t.margenes.find((x) => x.proveedor === 'Karen'); return m ? <><CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${f.id}:${t.modeloId}`} comprobacion="cuadra" /> {m.supuesto && <EstadoTexto tono="atencion">supuesto</EstadoTexto>}</> : <SinDato />; } },
            { id: 'd', titulo: 'Desde', secundaria: true, celda: (t) => etiquetaFecha(t.desde) },
            { id: 'o', titulo: 'Origen', secundaria: true, celda: (t) => <>{ORIGEN[t.origen] ?? t.origen}{t.nota && <><br /><span className="rtm-nota">{t.nota}</span></>}</> },
          ]}
        />
      </section>

      {margenIsaac.length >= 2 && (
        <GraficaBarras
          titulo="Margen por pieza contra el costo de Isaac"
          unidad="Margen"
          descripcion={`Margen por modelo de ${margenIsaac.length} modelos; el más alto está resaltado.`}
          datos={margenIsaac.map((m) => ({ etiqueta: m.modelo, valor: Math.max(0, Number(m.margen)), texto: formatearMoneda(m.margen), destacado: m.margen === mayor }))}
        />
      )}
      <GraficaLinea
        titulo={modeloLinea ? `Historial de precio: ${modeloLinea}` : 'Historial de precio'}
        unidad="Precio"
        descripcion={`Precio de ${modeloLinea} a lo largo del tiempo.`}
        puntos={puntos.map((p) => ({ etiqueta: etiquetaFecha(p.desde), valor: Number(p.precioCent), texto: formatearMoneda(p.precioCent) }))}
      />

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Historial de precios">
        <h2>Historial de precios</h2>
        <DataTable
          etiqueta={`Historial de precios de ${f.nombre}`}
          clave={(h) => `${h.modelo}-${h.desde}-${h.precioCent}-${h.externo}`}
          filas={f.historial}
          vacio={{ titulo: 'Sin historial', texto: 'Aún no se ha registrado ningún precio.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (h) => h.modelo },
            { id: 'p', titulo: 'Precio', numerica: true, celda: (h) => formatearMoneda(h.precioCent) },
            { id: 'd', titulo: 'Desde', celda: (h) => etiquetaFecha(h.desde) },
            { id: 'h', titulo: 'Hasta', secundaria: true, celda: (h) => (h.hasta ? etiquetaFecha(h.hasta) : '—') },
            { id: 'e', titulo: 'Estado', celda: (h) => (h.externo ? <EstadoTexto tono="atencion">Solo referencia</EstadoTexto> : h.vigente ? <EstadoTexto tono="ok">Vigente</EstadoTexto> : <EstadoTexto tono="neutro">Reemplazado</EstadoTexto>) },
          ]}
        />
      </section>
    </>
  );
}
