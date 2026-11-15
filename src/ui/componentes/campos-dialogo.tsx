'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Formato de miles para lo que se escribe en un monto ("9000.5" -> "9,000.5"). Solo formato: la validacion y el calculo siguen en SQL. */
export function formatearMontoTexto(crudo: string): string {
  const limpio = crudo.replace(/[^\d.]/g, '');
  const i = limpio.indexOf('.');
  const entero = (i === -1 ? limpio : limpio.slice(0, i)).replace(/^0+(?=\d)/, '');
  const dec = i === -1 ? null : limpio.slice(i + 1).replace(/\./g, '').slice(0, 2);
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec === null ? miles : `${miles || '0'}.${dec}`;
}

const significativos = (t: string) => t.replace(/[^\d.]/g, '').length;

interface PropsMonto {
  id: string;
  valor: string;
  onCambio: (v: string) => void;
  invalido?: boolean;
  descrito?: string | undefined;
  requerido?: boolean;
  testid?: string;
  alSalir?: () => void;
}

/** Campo de monto con prefijo $ y formato de miles mientras se escribe; conserva la posicion del cursor. */
export function CampoMonto({ id, valor, onCambio, invalido, descrito, requerido, testid, alSalir }: PropsMonto) {
  const ref = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || cursor.current === null || document.activeElement !== el) return;
    let n = cursor.current;
    let pos = 0;
    while (pos < valor.length && n > 0) { if (/[\d.]/.test(valor[pos]!)) n--; pos++; }
    el.setSelectionRange(pos, pos);
    cursor.current = null;
  }, [valor]);
  return (
    <span className="rtm-hoja-monto">
      <span className="rtm-hoja-prefijo" aria-hidden="true">$</span>
      <input
        ref={ref}
        id={id}
        className="rtm-campo rtm-campo-num"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={valor}
        aria-invalid={invalido ? true : undefined}
        aria-describedby={descrito}
        aria-required={requerido || undefined}
        data-testid={testid}
        onBlur={alSalir}
        onChange={(e) => {
          const el = e.target;
          cursor.current = significativos(el.value.slice(0, el.selectionStart ?? el.value.length));
          onCambio(formatearMontoTexto(el.value));
        }}
      />
    </span>
  );
}

export interface OpcionDialogo { valor: string; texto: string; descripcion?: string | undefined }

interface PropsGrupo {
  nombre: string;
  etiqueta: string;
  valor: string;
  opciones: OpcionDialogo[];
  onCambio: (v: string) => void;
  testid?: string | undefined;
  descrito?: string | undefined;
}

/** Control segmentado (radio nativo) con avatar de inicial: para elegir un socio u otra opcion corta. */
export function Segmentado({ nombre, etiqueta, valor, opciones, onCambio, testid, descrito, avatar }: PropsGrupo & { avatar?: boolean | undefined }) {
  return (
    <div className="rtm-seg" role="radiogroup" aria-label={etiqueta} aria-describedby={descrito} data-testid={testid}>
      {opciones.map((o) => (
        <label key={o.valor} className="rtm-seg-op">
          <input type="radio" name={nombre} value={o.valor} checked={valor === o.valor} onChange={() => onCambio(o.valor)} data-testid={testid ? `${testid}-${o.valor}` : undefined} />
          {avatar && <span className="rtm-seg-avatar" aria-hidden="true">{o.texto.charAt(0).toUpperCase()}</span>}
          <span>{o.texto}</span>
        </label>
      ))}
    </div>
  );
}

/** Opciones como tarjetas (radio) con descripcion corta, en lugar de un select con parrafo. */
export function TarjetasOpcion({ nombre, etiqueta, valor, opciones, onCambio, testid, descrito }: PropsGrupo) {
  return (
    <div className="rtm-tarjetas" role="radiogroup" aria-label={etiqueta} aria-describedby={descrito} data-testid={testid}>
      {opciones.map((o) => (
        <label key={o.valor} className="rtm-tarjeta-op">
          <input type="radio" name={nombre} value={o.valor} checked={valor === o.valor} onChange={() => onCambio(o.valor)} data-testid={testid ? `${testid}-${o.valor}` : undefined} />
          <span className="rtm-tarjeta-tit">{o.texto}</span>
          {o.descripcion && <span className="rtm-tarjeta-desc">{o.descripcion}</span>}
        </label>
      ))}
    </div>
  );
}

export interface FilaEfecto {
  id: string;
  etiqueta: string;
  /** Texto ya formateado a partir de lo que dice la base. */
  valor: string;
  nota?: string;
  /** Porcentaje 0-100 ya entregado por la base (por ejemplo participacion_bp / 100); solo dibuja la barra. */
  barra?: number | null;
  activa?: boolean;
  atenuada?: boolean;
}

/** Panel "Asi quedara": solo muestra cifras que ya calculo la base y texto explicativo; nunca calcula dinero. */
export function PanelEfecto({ titulo = 'Así quedará', filas, textos, resumen, testid = 'panel-efecto' }: { titulo?: string; filas?: FilaEfecto[]; textos?: ReactNode[]; resumen?: ReactNode; testid?: string }) {
  return (
    <aside className="rtm-efecto" aria-label={titulo} data-testid={testid}>
      <h3 className="rtm-efecto-tit">{titulo}</h3>
      {filas && filas.length > 0 && (
        <ul className="rtm-efecto-lista">
          {filas.map((f) => (
            <li key={f.id} className="rtm-efecto-fila" data-activa={f.activa ? '' : undefined} data-atenuada={f.atenuada ? '' : undefined} data-testid={`efecto-${f.id}`}>
              <span className="rtm-efecto-etq">{f.etiqueta}</span>
              <span className="rtm-efecto-val">{f.valor}</span>
              {f.barra !== undefined && f.barra !== null && (
                <span className="rtm-efecto-barra" aria-hidden="true"><svg viewBox="0 0 100 6" preserveAspectRatio="none"><rect width={Math.max(0, Math.min(100, f.barra))} height="6" /></svg></span>
              )}
              {f.nota && <span className="rtm-efecto-nota">{f.nota}</span>}
            </li>
          ))}
        </ul>
      )}
      {textos?.map((t, i) => <p key={i} className="rtm-efecto-texto">{t}</p>)}
      {resumen && <p className="rtm-efecto-resumen">{resumen}</p>}
    </aside>
  );
}
