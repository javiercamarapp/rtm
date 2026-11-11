'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { etiquetaFechaHora } from '@/dominio/formato';
import { destinoAviso, type ListaCampana } from '@/dominio/notificaciones/tipos';
import { IconoAviso } from '../iconos';

const SEVERIDAD = { C: 'Crítica', I: 'Importante', F: 'Informativa' } as const;

interface Props {
  noLeidas: number;
  cargar: (filtro: 'todas' | 'sin_leer') => Promise<ListaCampana>;
  marcar: (id: number) => Promise<void>;
  marcarTodas: () => Promise<void>;
}

/** Campana del software: es la fuente de verdad de los avisos (Telegram es solo un espejo). Pestañas Todas y Sin leer. */
export function Campana({ noLeidas, cargar, marcar, marcarTodas }: Props) {
  const [abierta, setAbierta] = useState(false);
  const [pestana, setPestana] = useState<'todas' | 'sin_leer'>('sin_leer');
  const [lista, setLista] = useState<ListaCampana | null>(null);
  const [cuenta, setCuenta] = useState(noLeidas);
  const [error, setError] = useState(false);
  const [ocupado, empezar] = useTransition();
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => setCuenta(noLeidas), [noLeidas]);

  const refrescar = useCallback((filtro: 'todas' | 'sin_leer') => {
    empezar(async () => {
      try {
        const l = await cargar(filtro);
        setLista(l);
        setCuenta(l.sin_leer);
        setError(false);
      } catch {
        setError(true);
      }
    });
  }, [cargar]);

  useEffect(() => {
    if (abierta) refrescar(pestana);
  }, [abierta, pestana, refrescar]);

  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierta(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierta]);

  return (
    <div className="rtm-campana" ref={caja}>
      <button type="button" className="rtm-icono-boton rtm-campana-boton" aria-label={cuenta > 0 ? `Avisos, ${cuenta} sin leer` : 'Avisos, ninguno sin leer'} aria-expanded={abierta} aria-haspopup="dialog" onClick={() => setAbierta((v) => !v)} data-testid="campana">
        <IconoAviso />
        {cuenta > 0 && <span className="rtm-campana-cuenta" data-testid="campana-cuenta">{cuenta > 99 ? '99+' : cuenta}</span>}
      </button>
      {abierta && (
        <div className="rtm-campana-panel" role="dialog" aria-label="Avisos" data-testid="campana-panel">
          <div className="rtm-campana-pestanas" role="tablist" aria-label="Filtro de avisos">
            {(['sin_leer', 'todas'] as const).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={pestana === p} className="rtm-campana-pestana" onClick={() => setPestana(p)} data-testid={`campana-${p}`}>{p === 'todas' ? 'Todas' : `Sin leer${lista && pestana === 'sin_leer' ? '' : ''}`}</button>
            ))}
          </div>
          {error && <p className="rtm-error" role="alert">No se pudieron cargar los avisos.</p>}
          {!error && lista && lista.notificaciones.length === 0 && <p className="rtm-nota rtm-campana-vacia">{pestana === 'sin_leer' ? 'No tienes avisos sin leer.' : 'Todavía no hay avisos.'}</p>}
          <ul className="rtm-campana-lista" aria-busy={ocupado || undefined}>
            {(lista?.notificaciones ?? []).slice(0, 8).map((n) => {
              const d = destinoAviso(n.entidad_tipo, n.entidad_id);
              return (
                <li key={n.id} className="rtm-campana-item" data-leida={n.leida || undefined} data-testid="campana-item">
                  <span className="rtm-campana-sev" data-sev={n.severidad}>{SEVERIDAD[n.severidad]}</span>
                  {d ? <Link href={d} onClick={() => setAbierta(false)}>{n.titulo}</Link> : <span>{n.titulo}</span>}
                  <span className="rtm-nota">{etiquetaFechaHora(n.creado_at)}{n.conteo > 1 ? ` · ${n.conteo} veces` : ''}{n.estado !== 'abierta' ? ` · ${n.estado === 'resuelta' ? 'resuelto' : n.estado}` : ''}{n.telegram_no_salio ? ' · Telegram no salió' : ''}</span>
                  {!n.leida && <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => { void marcar(n.id).then(() => refrescar(pestana)); }}>Marcar leído</button>}
                </li>
              );
            })}
          </ul>
          <div className="rtm-campana-pie">
            <button type="button" className="rtm-boton rtm-boton-chico" disabled={cuenta === 0} onClick={() => { void marcarTodas().then(() => refrescar(pestana)); }}>Marcar todo como leído</button>
            <Link href="/avisos" onClick={() => setAbierta(false)}>Ver todos</Link>
          </div>
        </div>
      )}
    </div>
  );
}
