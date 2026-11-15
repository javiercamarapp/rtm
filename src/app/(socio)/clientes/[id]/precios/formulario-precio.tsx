'use client';

import { useState } from 'react';
import type { ResultadoAlta, SolicitudPrecio } from '@/aplicacion/catalogo/alta';
import { describirCambio, validarPrecio, type CampoPrecio } from '@/dominio/catalogo/alta';
import { etiquetaFecha, formatearMoneda, nombreVape } from '@/dominio/formato';
import { Campo, EcoResultado } from '@/ui/componentes/campo';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { usarAlta } from '../../../alta/usar-alta';

export interface ModeloParaPrecio {
  id: number;
  nombre: string;
  /** Precio vigente del cliente en este modelo: centavos como texto (los bigint no viajan a los componentes de cliente). */
  actual: { cent: string; desde: string } | null;
}

interface Props {
  clienteId: number;
  clienteNombre: string;
  modelos: ModeloParaPrecio[];
  /** Fecha de negocio de hoy, AAAA-MM-DD. */
  hoy: string;
  /** Modelo preseleccionado (por ejemplo, el de la fila que se quiere editar). */
  modeloInicial?: number;
  accion: (clave: string, solicitud: SolicitudPrecio) => Promise<ResultadoAlta<CampoPrecio>>;
}

/** Fija o cambia el precio de un modelo para un cliente. Siempre confirma antes de guardar y avisa que el anterior pasa al historial. */
export function FormularioPrecio({ clienteId, clienteNombre, modelos, hoy, modeloInicial, accion }: Props) {
  const { enviar, ocupado, resultado, limpiar } = usarAlta<CampoPrecio>();
  const primero = modelos.find((m) => m.id === modeloInicial)?.id ?? modelos[0]?.id ?? 0;
  const [v, setV] = useState({ modeloId: String(primero), precio: '', desde: hoy, nota: '' });
  const [locales, setLocales] = useState<Partial<Record<CampoPrecio, string>>>({});
  const [confirmando, setConfirmando] = useState(false);

  if (modelos.length === 0) {
    return <p className="rtm-nota" data-testid="sin-modelos">El catálogo todavía no tiene modelos: primero se carga el catálogo.</p>;
  }

  const modelo = modelos.find((m) => String(m.id) === v.modeloId) ?? modelos[0]!;
  const actualCent = modelo.actual ? BigInt(modelo.actual.cent) : null;
  const errores = { ...(resultado && !resultado.ok ? resultado.errores : {}), ...locales };
  const cambia = (k: keyof typeof v) => (valor: string) => { setV({ ...v, [k]: valor }); setLocales({}); limpiar(); };
  const entrada = { clienteId, modeloId: modelo.id, precio: v.precio, desde: v.desde, nota: v.nota, precioActualCent: actualCent, vigenteDesde: modelo.actual?.desde ?? null };
  const validado = validarPrecio(entrada);

  const alRevisar = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!validado.ok) return setLocales(validado.errores);
    setLocales({});
    setConfirmando(true);
  };
  const guardar = () => {
    setConfirmando(false);
    enviar((clave) => accion(clave, { clienteId, modeloId: modelo.id, precio: v.precio, desde: v.desde, nota: v.nota }), () => setV({ ...v, precio: '', nota: '' }));
  };
  const cambio = validado.ok ? describirCambio(actualCent, validado.valor.precioCent) : null;

  return (
    <form className="rtm-form" onSubmit={alRevisar} noValidate aria-busy={ocupado || undefined} data-testid="formulario-precio">
      <div className="rtm-form-fila">
        <div className="rtm-campo-ancho">
          <Campo etiqueta="Modelo" control="seleccion" requerido valor={v.modeloId} onCambio={cambia('modeloId')} error={errores.modelo} testid="campo-modelo"
            opciones={modelos.map((m) => ({ valor: String(m.id), texto: m.actual ? `${nombreVape(m.nombre)} · ${formatearMoneda(BigInt(m.actual.cent))}` : `${nombreVape(m.nombre)} · sin precio` }))} />
        </div>
        <Campo etiqueta="Precio nuevo por pieza" control="monto" requerido valor={v.precio} onCambio={cambia('precio')} error={errores.precio} placeholder="150.00" testid="campo-precio" />
        <Campo etiqueta="Vale desde" control="fecha" requerido valor={v.desde} onCambio={cambia('desde')} error={errores.desde} testid="campo-desde" />
      </div>
      {modelo.actual ? (
        <p className="rtm-nota" data-testid="precio-vigente">
          Precio vigente: <CifraComprobada texto={formatearMoneda(BigInt(modelo.actual.cent))} cifra={`margen:${clienteId}:${modelo.id}`} comprobacion="cuadra" /> desde el {etiquetaFecha(modelo.actual.desde)}. Al guardar, este pasa al historial.
        </p>
      ) : (
        <p className="rtm-nota">Este cliente todavía no tiene precio para este modelo.</p>
      )}
      <Campo etiqueta={modelo.actual ? 'Motivo del cambio' : 'Nota (opcional)'} control="area" requerido={!!modelo.actual} valor={v.nota} onCambio={cambia('nota')} error={errores.nota} placeholder="Por ejemplo: acordado por chat el 11 nov" testid="campo-nota" />
      <div className="rtm-acciones-fila">
        <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado} data-testid="revisar-precio">{ocupado ? 'Guardando' : 'Revisar y guardar'}</button>
      </div>
      {resultado?.ok && <EcoResultado tono="ok"><p>{resultado.eco}</p></EcoResultado>}
      {resultado && !resultado.ok && <EcoResultado tono="error">{resultado.mensaje}</EcoResultado>}
      {confirmando && validado.ok && cambio && (
        <ConfirmDialog abierto titulo="Confirmar cambio de precio" confirmar="Guardar precio" ocupado={ocupado} onConfirmar={guardar} onCancelar={() => setConfirmando(false)}>
          <dl className="rtm-dl">
            <dt>Cliente</dt><dd>{clienteNombre}</dd>
            <dt>Modelo</dt><dd>{nombreVape(modelo.nombre)}</dd>
            {cambio.tipo !== 'nuevo' && <><dt>Precio actual</dt><dd className="rtm-num">{formatearMoneda(cambio.actualCent)}</dd></>}
            <dt>Precio nuevo</dt><dd className="rtm-num">{formatearMoneda(cambio.nuevoCent)}</dd>
            <dt>Vale desde</dt><dd>{etiquetaFecha(validado.valor.desde)}</dd>
          </dl>
          {cambio.tipo === 'sube' && <p>El precio sube {formatearMoneda(cambio.diferenciaCent)} por pieza.</p>}
          {cambio.tipo === 'baja' && <p>El precio baja {formatearMoneda(cambio.diferenciaCent)} por pieza.</p>}
          {cambio.tipo === 'nuevo' && <p>Es el primer precio de este cliente para este modelo.</p>}
          <p>Las notas ya emitidas no cambian. El margen con el nuevo precio lo calcula la base al guardar y queda explicable en la ficha.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
