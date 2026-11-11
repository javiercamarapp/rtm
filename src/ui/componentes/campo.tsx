import { useId, type ReactNode } from 'react';

interface Base {
  etiqueta: string;
  /** Mensaje de validacion en palabras; si existe el campo se marca invalido y se anuncia. */
  error?: string | undefined;
  ayuda?: ReactNode;
  requerido?: boolean;
  disabled?: boolean;
  valor: string;
  onCambio: (v: string) => void;
  testid?: string;
}
type Props =
  | (Base & { control?: 'texto' | 'fecha' | 'monto'; placeholder?: string })
  | (Base & { control: 'seleccion'; opciones: { valor: string; texto: string }[] })
  | (Base & { control: 'area'; placeholder?: string });

/** Campo de formulario con etiqueta, ayuda y error asociados (aria-describedby, aria-invalid). El borde cumple 3:1 por el token --rtm-campo-borde. */
export function Campo(props: Props) {
  const id = useId();
  const { etiqueta, error, ayuda, requerido, disabled, valor, onCambio, testid } = props;
  const descripcion = [ayuda ? `${id}-a` : null, error ? `${id}-e` : null].filter(Boolean).join(' ') || undefined;
  const comun = { id, disabled, 'aria-invalid': error ? true : undefined, 'aria-describedby': descripcion, 'aria-required': requerido || undefined, 'data-testid': testid };
  const control = props.control ?? 'texto';
  return (
    <div className="rtm-etiqueta-campo">
      <label htmlFor={id}>{etiqueta}{requerido ? ' *' : ''}</label>
      {control === 'seleccion' && 'opciones' in props ? (
        <select {...comun} className="rtm-campo" value={valor} onChange={(e) => onCambio(e.target.value)}>
          {props.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
      ) : control === 'area' ? (
        <textarea {...comun} className="rtm-campo" value={valor} placeholder={'placeholder' in props ? props.placeholder : undefined} onChange={(e) => onCambio(e.target.value)} />
      ) : (
        <input
          {...comun}
          className={`rtm-campo${control === 'monto' ? ' rtm-campo-num' : ''}`}
          type={control === 'fecha' ? 'date' : 'text'}
          inputMode={control === 'monto' ? 'decimal' : undefined}
          autoComplete="off"
          value={valor}
          placeholder={'placeholder' in props ? props.placeholder : undefined}
          onChange={(e) => onCambio(e.target.value)}
        />
      )}
      {ayuda && <span id={`${id}-a`} className="rtm-nota">{ayuda}</span>}
      {error && <span id={`${id}-e`} className="rtm-error" role="alert">{error}</span>}
    </div>
  );
}

/** Casilla con etiqueta visible. */
export function Casilla({ etiqueta, marcada, onCambio, ayuda, testid }: { etiqueta: string; marcada: boolean; onCambio: (v: boolean) => void; ayuda?: string; testid?: string }) {
  const id = useId();
  return (
    <div className="rtm-casilla">
      <input id={id} type="checkbox" checked={marcada} onChange={(e) => onCambio(e.target.checked)} data-testid={testid} aria-describedby={ayuda ? `${id}-a` : undefined} />
      <label htmlFor={id}>{etiqueta}</label>
      {ayuda && <span id={`${id}-a`} className="rtm-nota">{ayuda}</span>}
    </div>
  );
}

/** Eco del resultado de una escritura: dice en palabras que quedo guardado (o por que no). */
export function EcoResultado({ tono, children }: { tono: 'ok' | 'error' | 'neutro'; children: ReactNode }) {
  return (
    <div className="rtm-eco" data-tono={tono} role={tono === 'error' ? 'alert' : 'status'} data-testid="eco-resultado">
      {children}
    </div>
  );
}
