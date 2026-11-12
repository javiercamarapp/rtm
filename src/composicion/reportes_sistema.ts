// Preparacion de un reporte por el sistema (rol servidor). Aparte de produccion.ts a proposito: arrastra Chromium y las fuentes, y solo se carga cuando de verdad se genera un reporte.
import { generarReporte } from '@/aplicacion/reportes/generar_reporte';
import { sumarDias } from '@/dominio/calendario';
import { cargarCssFuentes } from '@/infra/reportes/fuentes_css';
import { EntregaReportesAvisos, FuenteInsumosDb, RepositorioReportesDb } from '@/infra/reportes/postgres';
import { RenderizadorChromium } from '@/infra/reportes/render_pdf_chromium';
import type { DepsProduccion } from './produccion';

export async function generarReporteDeSistema(d: DepsProduccion, tipo: 'semanal' | 'mensual', inicio: string) {
  const [anio, mes] = inicio.split('-').map(Number) as [number, number];
  const fin = tipo === 'semanal' ? sumarDias(inicio, 6) : `${inicio.slice(0, 7)}-${String(new Date(Date.UTC(anio, mes, 0)).getUTCDate()).padStart(2, '0')}`;
  const fecha14 = `${fin.replaceAll('-', '')}235959`;
  const clave = `${tipo}:${inicio}`;
  const renderizador = d.renderizador ? d.renderizador(fecha14) : new RenderizadorChromium({ fecha14 });
  return generarReporte(
    { tipo, inicio },
    { fuente: new FuenteInsumosDb(d.sql), renderizador, repositorio: new RepositorioReportesDb(d.sql), entrega: new EntregaReportesAvisos(d.sql, clave, tipo === 'semanal' ? 'reporte_semanal' : 'reporte_mensual'), cssFuentes: cargarCssFuentes('src/fuentes') },
  );
}

