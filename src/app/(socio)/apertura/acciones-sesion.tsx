'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import type { EnsayoApertura } from '@/dominio/apertura/tipos';
import { formatearMoneda } from '@/dominio/formato';
import { FormularioAccion } from '../operacion/formulario-accion';
import { useAccion } from '../operacion/usar-accion';
import { ensayoAccion } from './acciones';

export function CrearSesion({ hoy }: { hoy: string }) {
  return (
    <FormularioAccion boton="Abrir la apertura" titulo="Abrir una sesión de apertura" confirmar="Abrir sesión" accion="apertura_crear" primario testid="apertura-crear"
      campos={[
        { nombre: 'p_fecha_corte', etiqueta: 'Fecha de corte', tipo: 'fecha', requerido: true, defecto: hoy, ayuda: 'Todo evento posterior a esta fecha es operación normal.' },
        { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' },
      ]}
      nota="Solo puede haber una sesión vigente. No se carga ningún dato hasta que los dos socios firmen." />
  );
}

export function FijarCorte({ sesion, actual }: { sesion: number; actual: string }) {
  return (
    <FormularioAccion boton="Cambiar la fecha de corte" titulo="Fecha de corte" confirmar="Guardar fecha" accion="apertura_fijar_corte" fijos={{ p_sesion: sesion }} testid="apertura-corte"
      campos={[{ nombre: 'p_fecha_corte', etiqueta: 'Fecha de corte', tipo: 'fecha', requerido: true, defecto: actual }]} />
  );
}

export function Resolucion({ sesion, resolucion, justificacion }: { sesion: number; resolucion: 'mantener' | 'capital_50_50'; justificacion: string | null }) {
  return (
    <FormularioAccion boton="Elegir qué hacer con la diferencia" titulo="Resolución de la diferencia" confirmar="Guardar resolución" accion="apertura_resolucion" fijos={{ p_sesion: sesion }} testid="apertura-resolucion"
      campos={[
        { nombre: 'p_resolucion', etiqueta: 'Resolución', tipo: 'seleccion', defecto: resolucion, opciones: [
          { valor: 'mantener', texto: 'Mantenerla en la cuenta puente 3990' },
          { valor: 'capital_50_50', texto: 'Repartirla al capital 50/50 (el centavo impar a Angelo)' },
        ] },
        { nombre: 'p_justificacion', etiqueta: 'Justificación escrita', tipo: 'texto', defecto: justificacion ?? '', ayuda: 'Obligatoria si la diferencia supera el 0.5 % del activo.' },
      ]}
      nota="Los dos socios firman sobre esta resolución. Cambiarla exige que no haya firmas." />
  );
}

export function Firmar({ sesion, yo, yaFirmo }: { sesion: number; yo: string | null; yaFirmo: boolean }) {
  const { correr, ocupado, error } = useAccion();
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      {!yaFirmo && <button type="button" className="rtm-boton rtm-boton-primario" onClick={() => setAbierto(true)} data-testid="apertura-firmar">Firmar como {yo ?? 'socio'}</button>}
      {yaFirmo && (
        <button type="button" className="rtm-boton" disabled={ocupado} onClick={() => correr('apertura_retirar_firma', { p_sesion: sesion })} data-testid="apertura-retirar-firma">Retirar mi firma</button>
      )}
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo="Firmar la apertura" confirmar="Firmar" ocupado={ocupado} onConfirmar={() => correr('apertura_firmar', { p_sesion: sesion }, () => setAbierto(false))} onCancelar={() => setAbierto(false)}>
          <p>Firmas sobre la huella del contenido que ves. Cuando firme el otro socio se publica la apertura: el inventario entra al kárdex y el asiento queda en el libro.</p>
          {error && <p className="rtm-error" role="alert">{error}</p>}
        </ConfirmDialog>
      )}
      {error && !abierto && <p className="rtm-error" role="alert">{error}</p>}
    </>
  );
}

export function Reversar({ sesion }: { sesion: number }) {
  return (
    <FormularioAccion boton="Revertir la apertura" titulo="Revertir la apertura firmada" confirmar="Revertir" accion="apertura_reversar" fijos={{ p_sesion: sesion }} testid="apertura-reversar"
      campos={[{ nombre: 'p_motivo', etiqueta: 'Motivo', tipo: 'texto', requerido: true }]}
      nota="Deshace el asiento y los movimientos de inventario. Falla si ya salió mercancía de esos modelos." />
  );
}

export function QuitarPartida({ id }: { id: number }) {
  const { correr, ocupado, error } = useAccion();
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => correr('apertura_quitar', { p_partida: id })} data-testid={`quitar-${id}`}>Quitar</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </>
  );
}

export function BotonEnsayo({ sesion }: { sesion: number }) {
  const [ocupado, setOcupado] = useState(false);
  const [r, setR] = useState<EnsayoApertura | null>(null);
  const [error, setError] = useState<string | null>(null);
  const correr = async () => {
    setOcupado(true);
    setError(null);
    const x = await ensayoAccion(sesion);
    setOcupado(false);
    if (x.ok) setR(x.ensayo); else setError(x.mensaje);
  };
  return (
    <div className="rtm-resultado-ensayo" data-testid="ensayo">
      <div>
        <button type="button" className="rtm-boton" disabled={ocupado} onClick={correr} data-testid="apertura-ensayo">{ocupado ? 'Ensayando…' : 'Hacer un ensayo (no escribe)'}</button>
      </div>
      <p className="rtm-nota">Publica la apertura de verdad dentro de una transacción de la base, mide las comprobaciones y la deshace. No deja asientos, movimientos, folios ni claves.</p>
      {error && <p className="rtm-error" role="alert">{error}</p>}
      {r && (
        <div data-testid="ensayo-resultado">
          <p>
            Cuenta puente 3990 tras la apertura: <strong>{formatearMoneda(r.puente_3990_cent)}</strong> · comprobaciones bloqueantes en rojo: <strong>{r.bloqueantes_en_rojo}</strong> · cadena de hash {r.cadena_ok ? 'sana' : 'ROTA'}.
          </p>
          <p>Inventario en el libro {formatearMoneda(r.inventario_1310_cent)} contra el kárdex {formatearMoneda(r.inventario_kardex_cent)}.</p>
          {r.comprobaciones_en_rojo.length > 0 && (
            <ul>{r.comprobaciones_en_rojo.map((c) => <li key={c.codigo}>{c.codigo} · {c.nombre}{c.bloqueante ? ' (bloqueante)' : ''}</li>)}</ul>
          )}
          {r.auxiliares_en_rojo.length > 0 && <p className="rtm-error">Hay {r.auxiliares_en_rojo.length} auxiliares que no cuadran contra el libro.</p>}
        </div>
      )}
    </div>
  );
}
