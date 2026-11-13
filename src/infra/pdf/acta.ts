// PDF del ACTA de corte mensual (adenda 33): periodo, utilidad neta, reembolsos pagados, tope por efectivo, parte de cada socio (50/50), cuanto retira y cuanto
// reinvierte cada uno, y las firmas de los dos. Mismo motor y huella estable que la nota: el PDF se genera una vez, se guarda y se adjunta por correo a los socios.
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import type { CierreReparto } from '@/dominio/operacion/tipos';
import { Hoja, M, UTIL, nuevoDocumento, pie, sinAzar } from './nota';

export async function pdfActaCorte(c: CierreReparto): Promise<Uint8Array> {
  return sinAzar(async () => {
    const s = c.snapshot;
    const { pdf, f } = await nuevoDocumento(`Acta de corte ${c.folio}`, c.creado_at);
    const h = new Hoja(pdf, f);
    h.bajar(14);
    h.texto(c.tipo === 'contra' ? 'Contra-acta de corte' : 'Acta de corte', M, 24, { fuente: f.marca });
    h.texto('SOLO PARA SOCIOS', M + UTIL, 10, { fuente: f.negrita, derecha: true });
    h.bajar(15);
    h.texto(c.folio, M + UTIL, 10, { derecha: true });
    h.bajar(10);
    h.linea();
    h.bajar(20);
    h.texto(`Periodo del ${etiquetaFecha(c.periodo_ini)} al ${etiquetaFecha(c.periodo_fin)}`, M, 11, { fuente: f.negrita });
    h.bajar(24);
    const fila = (t: string, v: string, fuerte = false) => {
      h.asegurar(16);
      // Importes a la derecha del renglon (misma esquina que el encabezado); la etiqueta se corta antes de pisarlos.
      h.texto(t, M, fuerte ? 11 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, ancho: UTIL - 118 });
      h.texto(v, M + UTIL, fuerte ? 11 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, derecha: true, ancho: 300 });
      h.bajar(14);
    };
    if (c.tipo === 'contra') {
      fila('Motivo', c.nota ?? '');
      fila('Deshace el acta', String((s as unknown as { corrige?: string }).corrige ?? ''));
    } else {
      fila('Utilidad neta del periodo', formatearMoneda(s.utilidad_cent), true);
      fila('Arrastre del periodo anterior (utilidad no repartida o perdida)', formatearMoneda(s.arrastre_ini_cent, { conSigno: true }));
      fila('Efectivo de la sociedad', formatearMoneda(s.efectivo.total_cent));
      fila('Comprometido (proveedores, dinero de clientes sin aplicar, reserva)', formatearMoneda(-s.efectivo.comprometido_cent));
      fila('Reembolsos pagados a socios', formatearMoneda(s.reembolsos.pagado_cent));
      fila('Utilidad repartida (tope por efectivo)', formatearMoneda(s.repartible_cent), true);
      fila('Pasa al siguiente periodo', formatearMoneda(s.arrastre_fin_cent, { conSigno: true }));
      h.bajar(10);
      h.asegurar(80);
      h.texto('POR SOCIO', M, 8, { fuente: f.negrita });
      h.bajar(14);
      for (const socio of Object.keys(s.por_socio).sort()) {
        const x = s.por_socio[socio as 'Angelo' | 'Javier'];
        const d = c.decisiones[socio] ?? { retira: 0n, reinvierte: 0n };
        h.asegurar(70);
        h.texto(socio, M, 11, { fuente: f.negrita });
        h.bajar(14);
        fila('Reembolso recibido', formatearMoneda(x.paga_reembolso_cent));
        fila('Su parte de la utilidad (50/50 fijo)', formatearMoneda(x.utilidad_cent));
        fila('Retira', formatearMoneda(d.retira));
        fila('Reinvierte (queda como inversion suya)', formatearMoneda(d.reinvierte));
        h.bajar(6);
      }
    }
    h.asegurar(70);
    h.linea();
    h.bajar(16);
    h.texto('FIRMAS', M, 8, { fuente: f.negrita });
    h.bajar(14);
    for (const x of c.firmas) {
      h.texto(`${x.socio} — firmada el ${etiquetaFecha(x.firmado_at.slice(0, 10))}`, M, 10);
      h.bajar(14);
    }
    h.texto('Documento inmutable: una corrección solo se hace con una contra-acta firmada por los dos.', M, 8, { ancho: UTIL });
    pie(f, h, `${c.folio} · acta`);
    return pdf.save({ useObjectStreams: false });
  });
}
