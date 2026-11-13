'use client';

import { useMemo, useState } from 'react';
import { calcularCargo, type Atribucion, type ComandoCargo } from '@/dominio/costos/registro';
import { ErrorCostos } from '@/dominio/costos/errores';
import { microDeTexto, pesosDeExactoE6, ppmDeTexto, textoMicro } from '@/dominio/costos/entrada';
import type { CategoriaCosto } from '@/dominio/costos/tipos';
import type { ServicioVista } from '@/dominio/costos/vista';
import { formatearMoneda } from '@/dominio/formato';
import { useAccion } from '../operacion/usar-accion';

type Modo = 'directa' | 'tasa' | 'participacion' | 'mayor';
const n = (x: bigint | null): number | null => (x === null ? null : Number(x));

/** Captura de un cargo. El monto se calcula con el mismo codigo del dominio y la base lo recalcula y lo rechaza si no coincide. Vista previa del efecto antes de guardar. */
export function FormularioCargo({ servicios, mesInicial, hoy, tcDelDia, servicioInicial }: { servicios: ServicioVista[]; mesInicial: string; hoy: string; servicioInicial?: string; tcDelDia: { fecha: string; tc_micro: number; fuente: string } | null }) {
  const { correr, ocupado, error } = useAccion();
  const [slug, setSlug] = useState(servicios.find((x) => x.slug === servicioInicial && x.activo)?.slug ?? servicios[0]?.slug ?? '');
  const [mes, setMes] = useState(mesInicial);
  const [fecha, setFecha] = useState(hoy);
  const [base, setBase] = useState('');
  const [modo, setModo] = useState<Modo>('directa');
  const [pct, setPct] = useState('');
  const [consumoRtm, setConsumoRtm] = useState('');
  const [consumoTotal, setConsumoTotal] = useState('');
  const [tc, setTc] = useState(tcDelDia ? textoMicro(BigInt(tcDelDia.tc_micro), 4) : '');
  const [sha, setSha] = useState('');
  const [nota, setNota] = useState('');
  const [hecho, setHecho] = useState(false);
  const s = servicios.find((x) => x.slug === slug);

  const calculo = useMemo(() => {
    if (!s) return { error: 'Elige un servicio.' } as const;
    const b = microDeTexto(base);
    if (b === null) return { error: 'Escribe la factura o consumo del proveedor, por ejemplo 75 o 75.50.' } as const;
    let atrib: Atribucion = { tipo: 'directa' };
    if (modo === 'tasa') {
      const p = ppmDeTexto(pct);
      if (p === null) return { error: 'El porcentaje debe estar entre 0 y 100.' } as const;
      atrib = { tipo: 'tasa', ppm: p };
    } else if (modo === 'participacion' || modo === 'mayor') {
      const a = microDeTexto(consumoRtm);
      const t = microDeTexto(consumoTotal);
      if (a === null || t === null || t === 0n) return { error: 'Escribe el consumo de RTM y el consumo total (en la misma unidad).' } as const;
      atrib = modo === 'participacion' ? { tipo: 'participacion', consumoRtm: a, consumoTotal: t } : { tipo: 'mayor', cuotaDocumentoOrigMicro: BigInt(s.cuota_documento_orig_micro ?? 0), consumoRtm: a, consumoTotal: t };
    }
    const tcMicro = s.moneda === 'MXN' ? 1_000_000n : microDeTexto(tc);
    if (tcMicro === null || tcMicro === 0n) return { error: 'Escribe el tipo de cambio de la fecha del cargo.' } as const;
    const cmd: ComandoCargo = {
      claveIdem: 'vista-previa', servicioSlug: s.slug, categoria: s.categoria as CategoriaCosto, mes, fechaNeg: fecha, fase: s.fase, baseOrigMicro: b, moneda: s.moneda, atribucion: atrib,
      pagadoPor: s.pagador_default as 'angelo' | 'javier', cobrable: s.cobrable, etiqueta: modo === 'directa' ? (sha ? 'recibo' : 'capturado') : 'atribuido', evidenciaTipo: sha ? 'recibo' : 'captura', evidenciaSha256: sha || null, nota,
    };
    try {
      return { ok: calcularCargo(cmd, { tcMicro, fecha: tcDelDia?.fecha ?? fecha, fuente: tcDelDia && tcMicro === BigInt(tcDelDia.tc_micro) ? (tcDelDia.fuente as 'manual' | 'banxico_fix') : 'manual' }) } as const;
    } catch (e) {
      return { error: e instanceof ErrorCostos ? e.message : 'No se pudo calcular.' } as const;
    }
  }, [s, base, modo, pct, consumoRtm, consumoTotal, tc, mes, fecha, sha, nota, tcDelDia]);

  const guardar = () => {
    if (!('ok' in calculo) || !calculo.ok || !s) return;
    const c = calculo.ok;
    correr('costos_registrar_cargo', {
      p_servicio: c.servicioSlug, p_mes: c.mes, p_fecha: c.fechaNeg, p_fase: c.fase, p_base_orig_micro: Number(c.baseOrigMicro), p_moneda: c.moneda, p_pct_exacto_ppm: Number(c.pctExactoPpm),
      p_pct_aplicado_ppm: Number(c.pctAplicadoPpm), p_tc_micro: Number(c.tcMicro), p_tc_fecha: c.tcFecha, p_tc_fuente: c.tcFuente, p_exacto_mxn_e6: Number(c.exactoMxnE6),
      p_exacto_puro_mxn_e6: Number(c.exactoPuroMxnE6), p_monto_cent: Number(c.montoCent), p_como_seria_cent: n(c.comoSeriaCent), p_como_deberia_cent: n(c.comoDeberiaCent), p_pagado_por: c.pagadoPor,
      p_cobrable: c.cobrable, p_etiqueta: c.etiqueta, p_estado: c.estado, p_evidencia_tipo: c.evidenciaTipo, p_evidencia_sha256: c.evidenciaSha256, p_nota: c.nota,
    }, () => { setHecho(true); setBase(''); setNota(''); setSha(''); });
  };

  return (
    <form className="rtm-form" data-testid="form-cargo" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
      <div className="rtm-form-fila">
        <label className="rtm-etiqueta-campo">Servicio
          <select className="rtm-campo" value={slug} onChange={(e) => { setSlug(e.target.value); setHecho(false); }} data-testid="cargo-servicio">
            {servicios.filter((x) => x.activo).map((x) => <option key={x.slug} value={x.slug}>{x.nombre}</option>)}
          </select>
        </label>
        <label className="rtm-etiqueta-campo">Mes (AAAA-MM)<input className="rtm-campo rtm-campo-num" value={mes} onChange={(e) => setMes(e.target.value)} /></label>
        <label className="rtm-etiqueta-campo">Fecha del cargo<input className="rtm-campo" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      </div>
      <div className="rtm-form-fila">
        <label className="rtm-etiqueta-campo">Factura o consumo del proveedor ({s?.moneda ?? 'USD'})<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={base} onChange={(e) => { setBase(e.target.value); setHecho(false); }} data-testid="cargo-base" /></label>
        <label className="rtm-etiqueta-campo">Atribución a RTM
          <select className="rtm-campo" value={modo} onChange={(e) => setModo(e.target.value as Modo)} data-testid="cargo-modo">
            <option value="directa">Todo es de RTM</option>
            <option value="tasa">Un porcentaje fijo</option>
            <option value="participacion">Participación por consumo (techo al punto)</option>
            <option value="mayor" disabled={!s?.cuota_documento_orig_micro}>El mayor entre la cuota y el consumo</option>
          </select>
        </label>
        {modo === 'tasa' && <label className="rtm-etiqueta-campo">Porcentaje<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>}
        {(modo === 'participacion' || modo === 'mayor') && (
          <>
            <label className="rtm-etiqueta-campo">Consumo de RTM<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={consumoRtm} onChange={(e) => setConsumoRtm(e.target.value)} data-testid="cargo-consumo-rtm" /></label>
            <label className="rtm-etiqueta-campo">Consumo total<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={consumoTotal} onChange={(e) => setConsumoTotal(e.target.value)} data-testid="cargo-consumo-total" /></label>
          </>
        )}
        {s?.moneda === 'USD' && <label className="rtm-etiqueta-campo">Tipo de cambio (MXN por USD)<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={tc} onChange={(e) => setTc(e.target.value)} data-testid="cargo-tc" /></label>}
      </div>
      <div className="rtm-form-fila">
        <label className="rtm-etiqueta-campo rtm-campo-ancho">Evidencia: sha256 del recibo (opcional; sin ella el cargo queda provisional)<input className="rtm-campo" value={sha} onChange={(e) => setSha(e.target.value.trim().toLowerCase())} /></label>
        <label className="rtm-etiqueta-campo rtm-campo-ancho">Nota<input className="rtm-campo" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      </div>
      <div className="rtm-aviso" role="status" data-testid="cargo-vista-previa">
        <strong>Efecto antes de guardar</strong>
        {'error' in calculo ? <p>{calculo.error}</p> : (
          <p>
            Gasto de la sociedad MXN {formatearMoneda(calculo.ok.montoCent)} (exacto {pesosDeExactoE6(calculo.ok.exactoMxnE6)}, siempre redondeado hacia arriba). Lo pagó {calculo.ok.pagadoPor === 'javier' ? 'Javier' : 'Angelo'} y queda por reembolsarle. Estado: {calculo.ok.estado === 'confirmado' ? 'confirmado' : 'provisional'}.
          </p>
        )}
      </div>
      {error && <p className="rtm-error" role="alert">{error}</p>}
      {hecho && <p role="status" data-testid="cargo-hecho">Cargo registrado.</p>}
      <div className="rtm-acciones-fila"><button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado || 'error' in calculo} data-testid="cargo-guardar">Registrar cargo</button></div>
    </form>
  );
}
