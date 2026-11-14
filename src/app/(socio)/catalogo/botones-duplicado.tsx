'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PreguntaDuplicado, ResultadoRespuesta } from '@/dominio/catalogo/duplicados';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { deshacerUnificacionAccion, responderDuplicadoAccion } from './acciones-duplicados';

const clave = () => `web:${crypto.randomUUID()}`;

function textoBloqueo(r: Extract<ResultadoRespuesta, { estado: 'bloqueado' }>): string {
  return `No se pudo unir todavía. ${r.bloqueos.map((b) => `${b.modelo}: ${b.motivos.join(', ')}`).join('; ')}. ${r.ayuda}`;
}

/** Botones "Sí, es lo mismo" (con el nombre canónico elegible) y "No, son distintos". Cada uno confirma con el diálogo propio; el negativo no se vuelve a preguntar. */
export function BotonesDuplicado({ p }: { p: PreguntaDuplicado }) {
  const router = useRouter();
  const [modo, setModo] = useState<'si' | 'no' | null>(null);
  const [canonico, setCanonico] = useState<number>(p.canonico_sugerido);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, empezar] = useTransition();
  const cerrar = () => { setModo(null); setError(null); };
  const confirmar = () =>
    empezar(async () => {
      const r = await responderDuplicadoAccion(clave(), p.id, modo === 'si' ? 'si' : 'no', modo === 'si' && p.se_puede_unir ? canonico : null, modo === 'si' && p.se_puede_unir ? nombre : null);
      if (!r.ok) return setError(r.mensaje);
      if (r.datos.estado === 'bloqueado') return setError(textoBloqueo(r.datos));
      cerrar();
      router.refresh();
    });
  const lado = canonico === p.a.id ? p.a : p.b;
  return (
    <>
      <span className="rtm-a1-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-chico rtm-boton-primario" onClick={() => setModo('si')} data-testid={`duplicado-si-${p.id}`}>
          {p.se_puede_unir ? 'Sí, es lo mismo' : 'Sí, es lo mismo (queda anotado)'}
        </button>
        <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setModo('no')} data-testid={`duplicado-no-${p.id}`}>No, son distintos</button>
      </span>
      {modo && (
        <ConfirmDialog abierto titulo={modo === 'si' ? (p.se_puede_unir ? 'Unir los dos sabores' : 'Anotar que es lo mismo') : 'Son distintos'} confirmar={modo === 'si' ? (p.se_puede_unir ? 'Unir' : 'Anotar') : 'Confirmar'} ocupado={ocupado} onConfirmar={confirmar} onCancelar={cerrar}>
          <p>{p.pregunta}</p>
          {modo === 'si' && p.se_puede_unir && (
            <>
              <fieldset>
                <legend>Nombre que queda</legend>
                {[p.a, p.b].map((x) => (
                  <label key={x.id} className="rtm-a1-nota">
                    <input type="radio" name={`canonico-${p.id}`} checked={canonico === x.id} onChange={() => setCanonico(x.id)} /> {x.nombre} ({x.skus} {x.skus === 1 ? 'modelo' : 'modelos'}, {x.lineas_pedido} {x.lineas_pedido === 1 ? 'renglón vendido' : 'renglones vendidos'})
                  </label>
                ))}
              </fieldset>
              <label>
                Otro nombre (opcional)
                <input className="rtm-campo" value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} placeholder={lado.nombre} aria-label="Nombre final del sabor" />
              </label>
              <p>El otro nombre queda como alias. Las ventas y los movimientos anteriores no se modifican; se pueden deshacer desde esta sección.</p>
            </>
          )}
          {modo === 'si' && !p.se_puede_unir && <p>La unión de modelos y clientes todavía no se ejecuta porque mueve saldos y dinero. Solo se anota tu respuesta.</p>}
          {modo === 'no' && <p>Queda anotado que son distintos y no se vuelve a preguntar.</p>}
          {error && <p role="alert">{error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

export function BotonDeshacerUnificacion({ id, origen, destino }: { id: number; origen: string; destino: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, empezar] = useTransition();
  const confirmar = () =>
    empezar(async () => {
      const r = await deshacerUnificacionAccion(clave(), id);
      if (!r.ok) return setError(r.mensaje);
      setAbierto(false);
      setError(null);
      router.refresh();
    });
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setAbierto(true)} aria-label={`Deshacer la unión de ${origen} con ${destino}`}>Deshacer</button>
      {abierto && (
        <ConfirmDialog abierto titulo="Deshacer la unión" confirmar="Deshacer" ocupado={ocupado} onConfirmar={confirmar} onCancelar={() => { setAbierto(false); setError(null); }}>
          <p>{`"${origen}" vuelve a ser un sabor aparte y la pregunta queda pendiente otra vez.`}</p>
          {error && <p role="alert">{error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
