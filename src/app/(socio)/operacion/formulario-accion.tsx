'use client';

import { useId, useState, type ReactNode } from 'react';
import { CampoMonto, Segmentado, TarjetasOpcion, type OpcionDialogo } from '@/ui/componentes/campos-dialogo';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { useExito } from '@/ui/componentes/dialogo-enterprise';
import { centavosDeTexto, useAccion } from './usar-accion';

export interface Campo {
  nombre: string;
  etiqueta: string;
  tipo: 'monto' | 'texto' | 'seleccion' | 'fecha' | 'entero';
  opciones?: OpcionDialogo[];
  defecto?: string;
  requerido?: boolean;
  /** Ayuda de una linea bajo el campo. */
  ayuda?: string;
  /** Solo para 'seleccion': 'segmentado' (pocas opciones cortas, con avatar si `avatar`) o 'tarjetas' (opciones con descripcion corta). Sin esto, select nativo. */
  presentacion?: 'segmentado' | 'tarjetas';
  avatar?: boolean;
  /** Titulo de la seccion en la que empieza este campo (los siguientes sin seccion siguen en la misma). */
  seccion?: string;
  /** 'completo': ocupa las dos columnas. Los montos y las tarjetas ya lo hacen por omision. */
  ancho?: 'completo';
  placeholder?: string;
}

interface Props {
  boton: string;
  titulo: string;
  confirmar: string;
  accion: string;
  campos: Campo[];
  fijos?: Record<string, unknown>;
  primario?: boolean;
  chico?: boolean;
  /** 'terciario': boton compacto sin contorno (acciones secundarias de BarraAcciones). */
  variante?: 'boton' | 'terciario';
  /** Texto largo para title y lectores cuando la etiqueta visible es corta. Tambien es el subtitulo si no se da uno. */
  descripcion?: string;
  /** Una linea bajo el titulo del dialogo. */
  subtitulo?: string;
  icono?: ReactNode;
  testid?: string;
  nota?: ReactNode;
  /** Solo desde componentes de cliente: ajusta los argumentos antes de enviarlos (por ejemplo armar un jsonb). */
  transformar?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Aviso informativo que se recalcula con lo que se va escribiendo (no bloquea el envio). */
  avisoVivo?: (valores: Record<string, string>) => ReactNode;
  /** Panel "Asi quedara": se recalcula con lo escrito; solo debe mostrar cifras ya calculadas por la base y texto. */
  efecto?: (valores: Record<string, string>) => ReactNode;
}

interface Grupo { titulo: string | null; campos: Campo[] }

function agrupar(campos: Campo[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const c of campos) {
    const ultimo = grupos[grupos.length - 1];
    if (!ultimo || (c.seccion && c.seccion !== ultimo.titulo)) grupos.push({ titulo: c.seccion ?? null, campos: [c] });
    else ultimo.campos.push(c);
  }
  return grupos;
}

/** Formulario en dialogo para una accion de la lista cerrada: convierte montos a centavos enteros, manda la clave de idempotencia y muestra el error de la base tal cual. */
export function FormularioAccion({ boton, titulo, confirmar, accion, campos, fijos = {}, primario, chico, variante, descripcion, subtitulo, icono, testid, nota, transformar, avisoVivo, efecto }: Props) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const { exito, celebrar } = useExito();
  const base = useId();
  const [abierto, setAbierto] = useState(false);
  const inicial = () => Object.fromEntries(campos.map((c) => [c.nombre, c.defecto ?? (c.tipo === 'seleccion' ? (c.opciones?.[0]?.valor ?? '') : '')]));
  const [valores, setValores] = useState<Record<string, string>>(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const cerrar = () => { setAbierto(false); setErrores({}); limpiarError(); };
  const poner = (nombre: string, v: string) => { setValores((x) => ({ ...x, [nombre]: v })); setErrores((e) => { if (!e[nombre]) return e; const { [nombre]: _quitado, ...resto } = e; return resto; }); };
  const idDe = (c: Campo) => `${base}-${c.nombre}`;

  const validar = (c: Campo, crudo: string): string | null => {
    const v = crudo.trim();
    if (c.requerido && v === '') return `Falta: ${c.etiqueta.toLowerCase()}.`;
    if (c.tipo === 'monto' && v !== '') {
      const cent = centavosDeTexto(v);
      if (cent === null || cent === 0) return `Escribe un monto válido en ${c.etiqueta.toLowerCase()}, por ejemplo 9000 o 9,000.50.`;
    }
    return null;
  };

  const enviar = () => {
    const args: Record<string, unknown> = { ...fijos };
    const nuevos: Record<string, string> = {};
    for (const c of campos) {
      const v = (valores[c.nombre] ?? '').trim();
      const falla = validar(c, v);
      if (falla) { nuevos[c.nombre] = falla; continue; }
      if (c.tipo === 'monto') args[c.nombre] = v === '' ? null : centavosDeTexto(v);
      else if (c.tipo === 'entero') args[c.nombre] = v === '' ? null : Number(v);
      else args[c.nombre] = v === '' ? null : v;
    }
    setErrores(nuevos);
    const primero = campos.find((c) => nuevos[c.nombre]);
    if (primero) {
      requestAnimationFrame(() => document.getElementById(idDe(primero))?.focus());
      return;
    }
    correr(accion, transformar ? transformar(args) : args, () => celebrar(() => { setAbierto(false); setValores(inicial()); setErrores({}); }));
  };

  const sucio = (() => { const i = inicial(); return campos.some((c) => (valores[c.nombre] ?? '') !== (i[c.nombre] ?? '')); })();

  const control = (c: Campo) => {
    const id = idDe(c);
    const falla = errores[c.nombre];
    const descrito = [c.ayuda ? `${id}-a` : null, falla ? `${id}-e` : null].filter(Boolean).join(' ') || undefined;
    const valor = valores[c.nombre] ?? '';
    if (c.tipo === 'seleccion' && c.presentacion === 'tarjetas') return <TarjetasOpcion nombre={id} etiqueta={c.etiqueta} valor={valor} opciones={c.opciones ?? []} onCambio={(v) => poner(c.nombre, v)} testid={`campo-${c.nombre}`} descrito={descrito} />;
    if (c.tipo === 'seleccion' && c.presentacion === 'segmentado') return <Segmentado nombre={id} etiqueta={c.etiqueta} valor={valor} opciones={c.opciones ?? []} avatar={c.avatar} onCambio={(v) => poner(c.nombre, v)} testid={`campo-${c.nombre}`} descrito={descrito} />;
    if (c.tipo === 'seleccion') {
      return (
        <select id={id} className="rtm-campo" value={valor} aria-describedby={descrito} onChange={(e) => poner(c.nombre, e.target.value)} data-testid={`campo-${c.nombre}`}>
          {c.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
      );
    }
    if (c.tipo === 'monto') {
      return <CampoMonto id={id} valor={valor} onCambio={(v) => poner(c.nombre, v)} invalido={!!falla} descrito={descrito} requerido={c.requerido} testid={`campo-${c.nombre}`} alSalir={() => { const f = valor.trim() === '' ? null : validar(c, valor); if (f) setErrores((e) => ({ ...e, [c.nombre]: f })); }} />;
    }
    return (
      <input
        id={id}
        className="rtm-campo"
        type={c.tipo === 'fecha' ? 'date' : 'text'}
        inputMode={c.tipo === 'entero' ? 'numeric' : undefined}
        autoComplete="off"
        placeholder={c.placeholder}
        value={valor}
        aria-invalid={falla ? true : undefined}
        aria-describedby={descrito}
        aria-required={c.requerido || undefined}
        onChange={(e) => poner(c.nombre, e.target.value)}
        data-testid={`campo-${c.nombre}`}
      />
    );
  };

  const campo = (c: Campo) => {
    const id = idDe(c);
    const grupoRadio = c.tipo === 'seleccion' && !!c.presentacion;
    const completo = c.ancho === 'completo' || c.tipo === 'monto' || c.presentacion === 'tarjetas';
    return (
      <div key={c.nombre} className="rtm-hoja-campo" data-ancho={completo ? 'completo' : undefined}>
        {grupoRadio ? <span className="rtm-hoja-etiqueta" aria-hidden="true">{c.etiqueta}{c.requerido && <span className="rtm-hoja-req">*</span>}</span> : <label htmlFor={id}>{c.etiqueta}{c.requerido && <span className="rtm-hoja-req" aria-hidden="true">*</span>}</label>}
        {control(c)}
        {c.ayuda && <span id={`${id}-a`} className="rtm-nota">{c.ayuda}</span>}
        {errores[c.nombre] && <p id={`${id}-e`} className="rtm-hoja-campo-error" role="alert">{errores[c.nombre]}</p>}
      </div>
    );
  };

  const grupos = agrupar(campos);
  const conTitulos = grupos.some((g) => g.titulo);

  return (
    <>
      <button type="button" className={variante === 'terciario' ? 'rtm-boton rtm-boton-terciario' : `rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} title={descripcion} onClick={() => { limpiarError(); setValores(inicial()); setErrores({}); setAbierto(true); }} data-testid={testid}>{boton}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={titulo} subtitulo={subtitulo ?? descripcion} icono={icono} confirmar={confirmar} ocupado={ocupado} exito={exito} sucio={sucio} error={error} onConfirmar={enviar} onCancelar={cerrar} variante="hoja" ancho={efecto ? 'lg' : 'md'} efecto={efecto?.(valores)}>
          {grupos.map((g, i) => {
            const contenido = g.campos.map(campo);
            if (!conTitulos) return contenido;
            return (
              <div key={i} className={`rtm-hoja-seccion rtm-i-${Math.min(i, 6)}`} role="group" aria-label={g.titulo ?? undefined}>
                {g.titulo && <h3 className="rtm-hoja-seccion-titulo" aria-hidden="true">{g.titulo}</h3>}
                {contenido}
              </div>
            );
          })}
          {avisoVivo?.(valores)}
          {nota && <p className="rtm-nota">{nota}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Boton de una sola accion con confirmacion (firmar, anular, cerrar...). */
export function BotonAccion({ texto, accion, args, confirmarTexto, titulo, chico, primario, testid, motivo, desactivado, variante }: {
  texto: string; accion: string; args: Record<string, unknown>; confirmarTexto?: string; titulo?: string; chico?: boolean; primario?: boolean; testid?: string; motivo?: string; desactivado?: boolean; variante?: 'boton' | 'terciario';
}) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const { exito, celebrar } = useExito();
  const [abierto, setAbierto] = useState(false);
  const [m, setM] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    if (motivo && m.trim() === '') return setLocal('Escribe el motivo.');
    setLocal(null);
    correr(accion, { ...args, ...(motivo ? { p_motivo: m.trim() } : {}) }, () => celebrar(() => setAbierto(false)));
  };
  return (
    <>
      <button type="button" className={variante === 'terciario' ? 'rtm-boton rtm-boton-terciario' : `rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} disabled={desactivado} onClick={() => { limpiarError(); setM(''); setAbierto(true); }} data-testid={testid}>{texto}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={titulo ?? texto} confirmar={confirmarTexto ?? texto} ocupado={ocupado} exito={exito} error={local ?? error} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          {motivo && (
            <label className="rtm-etiqueta-campo">{motivo}
              <input className="rtm-campo" value={m} onChange={(e) => setM(e.target.value)} data-testid="campo-motivo" />
            </label>
          )}
          {!motivo && <p>¿Confirmas esta acción? Queda registrada y se puede deshacer con un movimiento contrario.</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
