'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ResultadoAlta } from '@/aplicacion/catalogo/alta';
import { ETIQUETA_TIPO, TIPOS_CLIENTE, validarCliente, type CampoCliente, type EntradaCliente } from '@/dominio/catalogo/alta';
import { Campo, Casilla, EcoResultado } from '@/ui/componentes/campo';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { usarAlta } from '../alta/usar-alta';

type Accion = (clave: string, entrada: EntradaCliente & { activo: boolean }) => Promise<ResultadoAlta<CampoCliente>>;

interface Props {
  modo: 'nuevo' | 'editar';
  accion: Accion;
  inicial?: { nombre: string; tipo: string; nota: string; activo: boolean };
}

const OPCIONES = TIPOS_CLIENTE.map((t) => ({ valor: t, texto: ETIQUETA_TIPO[t] }));

/** Alta y edicion de un cliente: solo nombre, tipo y nota (sin telefonos ni direcciones). Desactivar pide confirmacion. */
export function FormularioCliente({ modo, accion, inicial }: Props) {
  const { enviar, ocupado, resultado, limpiar } = usarAlta<CampoCliente>();
  const [v, setV] = useState({ nombre: inicial?.nombre ?? '', tipo: inicial?.tipo ?? 'mayoreo', nota: inicial?.nota ?? '', activo: inicial?.activo ?? true });
  const [locales, setLocales] = useState<Partial<Record<CampoCliente, string>>>({});
  const [confirmando, setConfirmando] = useState(false);

  const errores = { ...(resultado && !resultado.ok ? resultado.errores : {}), ...locales };
  const cambia = <K extends keyof typeof v>(k: K) => (valor: (typeof v)[K]) => { setV({ ...v, [k]: valor }); setLocales({}); limpiar(); };

  const guardar = () => {
    setConfirmando(false);
    enviar((clave) => accion(clave, v), (r) => { if (modo === 'nuevo' && r.eco.startsWith('Cliente creado')) setV({ nombre: '', tipo: v.tipo, nota: '', activo: true }); });
  };
  const alEnviar = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const c = validarCliente(v);
    if (!c.ok) return setLocales(c.errores);
    setLocales({});
    if (modo === 'editar' && inicial?.activo && !v.activo) return setConfirmando(true);
    guardar();
  };

  return (
    <form className="rtm-form" onSubmit={alEnviar} noValidate aria-busy={ocupado || undefined} data-testid="formulario-cliente">
      <div className="rtm-form-fila">
        <div className="rtm-campo-ancho"><Campo etiqueta="Nombre del cliente" requerido valor={v.nombre} onCambio={cambia('nombre')} error={errores.nombre} placeholder="Como lo llaman en la bodega" testid="campo-nombre" ayuda="Solo el nombre: sin teléfonos ni direcciones." /></div>
        <Campo etiqueta="Tipo" control="seleccion" opciones={OPCIONES} valor={v.tipo} onCambio={cambia('tipo')} error={errores.tipo} testid="campo-tipo" />
      </div>
      <Campo etiqueta="Nota (opcional)" control="area" valor={v.nota} onCambio={cambia('nota')} error={errores.nota} placeholder="Por ejemplo: paga a 7 días" testid="campo-nota" />
      {modo === 'editar' && <Casilla etiqueta="Cliente activo" marcada={v.activo} onCambio={cambia('activo')} ayuda="Un cliente inactivo no se ofrece en pedidos nuevos; su historial y sus precios se conservan." testid="campo-activo" />}
      <div className="rtm-acciones-fila">
        <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado} data-testid="guardar-cliente">{ocupado ? 'Guardando' : modo === 'nuevo' ? 'Crear cliente' : 'Guardar cambios'}</button>
        <Link className="rtm-boton" href="/clientes">Volver a clientes</Link>
      </div>
      {resultado?.ok && (
        <EcoResultado tono="ok">
          <p>{resultado.eco}</p>
          {modo === 'nuevo' && !resultado.sinCambio && <p><Link href={`/clientes/${resultado.id}/precios`}>Cargar sus precios</Link> · <Link href={`/clientes/${resultado.id}`}>Ver su ficha</Link></p>}
          {modo === 'nuevo' && resultado.sinCambio && <p><Link href={`/clientes/${resultado.id}`}>Ver su ficha</Link></p>}
        </EcoResultado>
      )}
      {resultado && !resultado.ok && <EcoResultado tono="error">{resultado.mensaje}</EcoResultado>}
      {confirmando && (
        <ConfirmDialog abierto titulo="Desactivar cliente" confirmar="Desactivar" ocupado={ocupado} onConfirmar={guardar} onCancelar={() => setConfirmando(false)}>
          <p>{v.nombre} dejará de ofrecerse en pedidos nuevos. Su historial, sus precios y sus saldos se conservan, y puedes volver a activarlo cuando quieras.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
