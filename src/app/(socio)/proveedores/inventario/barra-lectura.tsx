'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { bloqueoDeActualizar, hace, type FrescuraKaren } from '@/dominio/proveedores/tablero';
import type { ResultadoActualizar } from '@/composicion/proveedores';

export interface FrescuraBarra extends FrescuraKaren { ultima_lectura_ok: string | null; desactualizado: boolean }

/** Estado de la lectura (ultima lectura, peticiones de hoy) y las dos acciones de la cabecera. "Actualizar ahora" se bloquea con mensaje claro. */
export function BarraLectura({ frescura: f, ahoraIso, actualizar }: { frescura: FrescuraBarra; ahoraIso: string; actualizar: () => Promise<ResultadoActualizar> }) {
  const router = useRouter();
  const [ocupado, empezar] = useTransition();
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'atencion'; texto: string } | null>(null);
  const ahora = new Date(ahoraIso);
  const bloqueo = bloqueoDeActualizar(f, ahora);
  const sinLectura = f.ultima_lectura_ok === null;
  const pct = Math.min(100, Math.round((f.peticiones_hoy / Math.max(1, f.tope_dia)) * 100));

  const pulsar = () => empezar(async () => {
    setMensaje(null);
    const r = await actualizar();
    if (r.estado === 'ok') { setMensaje({ tono: 'ok', texto: 'Lectura terminada. Se actualizó la página.' }); router.refresh(); }
    else if (r.estado === 'bloqueada') setMensaje({ tono: 'atencion', texto: r.mensaje });
    else if (r.estado === 'ya_en_curso') setMensaje({ tono: 'atencion', texto: 'Ya hay una lectura en curso. Espera un minuto.' });
    else setMensaje({ tono: 'atencion', texto: 'No se pudo leer en este momento. Intenta más tarde.' });
  });

  return (
    <div className="rtm-kr-barra-lectura" data-testid="estado-fuente" role="group" aria-label="Estado de la lectura">
      <div className="rtm-kr-lectura-datos">
        <span className="rtm-kr-estado" data-estado={f.bloqueada ? 'bloqueada' : sinLectura ? 'apagada' : f.desactualizado ? 'vieja' : 'ok'}>
          <i aria-hidden="true" />
          {f.bloqueada ? 'Bloqueada' : sinLectura ? 'Sin lecturas' : f.desactualizado ? 'Dato desactualizado' : 'Al día'}
        </span>
        {!f.lectura_activa && <span className="rtm-kr-estado" data-estado="apagada"><i aria-hidden="true" />Lectura automática apagada</span>}
        <span>{sinLectura ? 'Todavía no hay una lectura' : <>Última lectura <b>{hace(f.ultima_lectura_ok, ahora)}</b></>}</span>
        <span className="rtm-kr-peticiones" title="Peticiones al sitio de Karen hoy">
          Peticiones hoy <b>{f.peticiones_hoy}</b> de {f.tope_dia}
          <i className="rtm-kr-barra" aria-hidden="true"><svg viewBox="0 0 100 4" preserveAspectRatio="none"><rect className="rtm-kr-barra-r" width={pct} height="4" /></svg></i>
        </span>
      </div>
      <div className="rtm-kr-lectura-acciones">
        <button type="button" className="rtm-boton" onClick={pulsar} disabled={ocupado || bloqueo !== null} aria-describedby="rtm-kr-actualizar-nota" aria-busy={ocupado || undefined} data-testid="actualizar-ahora">
          {ocupado ? 'Leyendo' : 'Actualizar ahora'}
        </button>
        <Link className="rtm-boton rtm-boton-primario" href="/proveedores/compras/nueva?p=Karen" data-testid="oc-karen">Crear orden de compra a Karen</Link>
      </div>
      <p id="rtm-kr-actualizar-nota" className="rtm-kr-nota-lectura" role="status" data-testid="nota-actualizar" data-tono={mensaje?.tono ?? (bloqueo ? 'atencion' : undefined)}>
        {mensaje?.texto ?? bloqueo?.mensaje ?? ''}
      </p>
    </div>
  );
}
