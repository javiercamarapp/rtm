// Estado de cuenta personal del socio (adenda 33): cabecera, ratios, actas y series mensuales. Mismo motor y estilo que las notas y las actas.
import { etiquetaFecha, formatearDecimal, formatearMoneda } from '@/dominio/formato';
import { calcularRatios } from '@/dominio/historial/ratios';
import type { HistorialSocio } from '@/dominio/historial/tipos';
import { Hoja, M, UTIL, nuevoDocumento, pie, sinAzar } from './nota';

const pctBp = (bp: bigint | null) => (bp === null ? 'Sin dato' : `${formatearDecimal(Number(bp) / 100, 1)} %`);
const veces = (x: bigint | null) => (x === null ? 'Sin dato' : `${formatearDecimal(Number(x) / 100, 2)} veces`);

export async function pdfHistorialSocio(h: HistorialSocio): Promise<Uint8Array> {
  return sinAzar(async () => {
    const c = h.cabecera;
    const r = calcularRatios(h);
    const { pdf, f } = await nuevoDocumento(`Estado de cuenta personal de ${h.socio}`, `${h.hoy}T12:00:00Z`);
    const hoja = new Hoja(pdf, f);
    hoja.bajar(14);
    hoja.texto('Estado de cuenta personal', M, 22, { fuente: f.marca });
    hoja.texto('SOLO PARA SOCIOS', M + UTIL, 10, { fuente: f.negrita, derecha: true });
    hoja.bajar(15);
    hoja.texto(`${h.socio} · corte ${etiquetaFecha(h.hasta)}`, M + UTIL, 10, { derecha: true });
    hoja.bajar(10);
    hoja.linea();
    hoja.bajar(20);
    const fila = (t: string, v: string, fuerte = false) => {
      hoja.asegurar(16);
      hoja.texto(t, M, fuerte ? 11 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, ancho: 330 });
      hoja.texto(v, M + 380, fuerte ? 11 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, derecha: true });
      hoja.bajar(14);
    };
    const titulo = (t: string) => { hoja.asegurar(30); hoja.bajar(6); hoja.texto(t, M, 8, { fuente: f.negrita }); hoja.bajar(14); };

    titulo('CABECERA');
    fila('Invertido total (capital aportado: aportaciones y reinversiones)', formatearMoneda(c.invertido_cent), true);
    fila('Retirado total (retiros de utilidad + devolucion de aportaciones)', formatearMoneda(c.retirado_cent));
    fila('Utilidad recibida en actas', formatearMoneda(c.utilidad_asignada_cent));
    fila('Utilidad por distribuir', formatearMoneda(c.utilidad_por_distribuir_cent));
    fila('Valuacion personal (capital aportado + su 50 % de la utilidad - fondos en su poder)', c.valor_cent === null ? 'Sin dato' : formatearMoneda(c.valor_cent), true);
    fila('Aportacion neta (aportado menos fondos en su poder)', formatearMoneda(c.aportacion_neta_cent, { conSigno: true }));
    fila(c.igualados ? 'Aportaciones igualadas' : c.le_toca_aportar ? 'Diferencia a igualar (le toca aportar el siguiente pago)' : 'Diferencia a igualar del otro socio', formatearMoneda(c.diferencia_a_igualar_cent));
    fila('Reembolsos por cobrar', formatearMoneda(c.reembolso_pendiente_cent));
    fila('Fondos de la sociedad en su poder', formatearMoneda(c.fondos_cent));

    titulo('RATIOS');
    fila('ROI', pctBp(r.roi_bp));
    fila('ROI anualizado', pctBp(r.roi_anualizado_bp));
    fila('Multiplo sobre capital', veces(r.multiplo_x100));
    fila('TIR de sus flujos', pctBp(r.tir_bp));
    fila('Payback', r.payback_meses === null ? 'Sin dato' : r.payback_meses === 0 ? 'Ya recuperado' : `${r.payback_meses} meses`);
    fila('Tasa de reinversion', pctBp(r.tasa_reinversion_bp));
    fila('Payout (retirado / utilidad)', pctBp(r.payout_bp));
    fila('Retiro mensual promedio', r.retiro_mensual_cent === null ? 'Sin dato' : formatearMoneda(r.retiro_mensual_cent));
    fila('Margen neto', pctBp(r.margen_neto_bp));
    fila('Utilidad por pieza', r.utilidad_por_pieza_cent === null ? 'Sin dato' : formatearMoneda(r.utilidad_por_pieza_cent));
    fila('Cobertura de caja', veces(r.cobertura_caja_x100));
    fila('Participacion en el capital aportado', pctBp(r.participacion_capital_bp));
    fila('Participacion en la utilidad (fija)', pctBp(r.participacion_utilidad_bp));

    titulo('ACTAS DE CORTE');
    const actas = h.actas.filter((a) => a.tipo === 'periodo' && a.estado === 'cerrado');
    if (actas.length === 0) fila('Sin actas firmadas', '');
    for (const a of actas) fila(`${a.folio} · ${etiquetaFecha(a.periodo_ini)} al ${etiquetaFecha(a.periodo_fin)} · retira ${formatearMoneda(a.retira_cent)} · reinvierte ${formatearMoneda(a.reinvierte_cent)}`, formatearMoneda(a.parte_cent));

    titulo('SU PARTE (50 %) POR MES');
    if (h.meses.length === 0) fila('Sin meses con actividad', '');
    for (const mes of [...h.meses].reverse()) fila(`${mes.ini.slice(0, 7)}${mes.parcial ? ' (en curso)' : ''} · ${mes.pedidos} pedidos`, formatearMoneda(mes.parte_cent, { conSigno: true }));

    hoja.asegurar(40);
    hoja.bajar(8);
    hoja.texto('Cifras calculadas por la base de datos y funciones deterministas; ninguna la calcula la IA. El valor de la participacion es un estimado en libros.', M, 8, { ancho: UTIL });
    pie(f, hoja, `Estado de cuenta ${h.socio} · ${h.hasta}`);
    return pdf.save({ useObjectStreams: false });
  });
}
