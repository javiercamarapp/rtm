'use client';

import { useState } from 'react';
import type { ResultadoAlta, SolicitudCosto } from '@/aplicacion/catalogo/alta';
import { PROVEEDORES, validarCosto, type CampoCosto } from '@/dominio/catalogo/alta';
import { etiquetaFecha, formatearMoneda, nombreVape } from '@/dominio/formato';
import { Campo, Casilla, EcoResultado } from '@/ui/componentes/campo';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { usarAlta } from '../../alta/usar-alta';

export interface ModeloParaCosto {
  id: number;
  nombre: string;
  /** Costo de lista vigente por proveedor: centavos como texto y fecha de inicio. */
  vigentes: Partial<Record<'Isaac' | 'Karen', { cent: string; desde: string }>>;
}

interface Props {
  modelos: ModeloParaCosto[];
  hoy: string;
  modeloInicial?: number;
  proveedorInicial?: 'Isaac' | 'Karen';
  accion: (clave: string, solicitud: SolicitudCosto) => Promise<ResultadoAlta<CampoCosto>>;
}

/** Fija o cambia el costo de un modelo con Isaac o con Karen, con vigencia, fuente y motivo. Confirma antes de guardar: cambia todos los margenes de ese modelo. */
export function FormularioCosto({ modelos, hoy, modeloInicial, proveedorInicial = 'Isaac', accion }: Props) {
  const { enviar, ocupado, resultado, limpiar } = usarAlta<CampoCosto>();
  const primero = modelos.find((m) => m.id === modeloInicial)?.id ?? modelos[0]?.id ?? 0;
  const [v, setV] = useState({ proveedor: proveedorInicial as string, modeloId: String(primero), costo: '', desde: hoy, fuente: '', motivo: '' });
  const [esLista, setEsLista] = useState(true);
  const [supuesto, setSupuesto] = useState(false);
  const [locales, setLocales] = useState<Partial<Record<CampoCosto, string>>>({});
  const [confirmando, setConfirmando] = useState(false);

  if (modelos.length === 0) return <p className="rtm-nota" data-testid="sin-modelos">El catálogo todavía no tiene modelos: primero se carga el catálogo.</p>;

  const modelo = modelos.find((m) => String(m.id) === v.modeloId) ?? modelos[0]!;
  const vigente = (v.proveedor === 'Isaac' || v.proveedor === 'Karen') ? modelo.vigentes[v.proveedor] ?? null : null;
  const errores = { ...(resultado && !resultado.ok ? resultado.errores : {}), ...locales };
  const reiniciar = () => { setLocales({}); limpiar(); };
  const cambia = (k: keyof typeof v) => (valor: string) => { setV({ ...v, [k]: valor }); reiniciar(); };
  const entrada = { proveedor: v.proveedor, modeloId: modelo.id, costo: v.costo, desde: v.desde, fuente: v.fuente, esLista, motivo: v.motivo, supuesto, costoActualCent: vigente ? BigInt(vigente.cent) : null, vigenteDesde: vigente?.desde ?? null };
  const validado = validarCosto(entrada);

  const alRevisar = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!validado.ok) return setLocales(validado.errores);
    setLocales({});
    setConfirmando(true);
  };
  const guardar = () => {
    setConfirmando(false);
    const { costoActualCent: _a, vigenteDesde: _b, ...solicitud } = entrada;
    enviar((clave) => accion(clave, solicitud), () => setV({ ...v, costo: '', fuente: '', motivo: '' }));
  };

  return (
    <form className="rtm-form" onSubmit={alRevisar} noValidate aria-busy={ocupado || undefined} data-testid="formulario-costo">
      <div className="rtm-form-fila">
        <Campo etiqueta="Proveedor" control="seleccion" requerido valor={v.proveedor} onCambio={cambia('proveedor')} error={errores.proveedor} testid="campo-proveedor" opciones={PROVEEDORES.map((p) => ({ valor: p, texto: p }))} />
        <div className="rtm-campo-ancho">
          <Campo etiqueta="Modelo" control="seleccion" requerido valor={v.modeloId} onCambio={cambia('modeloId')} error={errores.modelo} testid="campo-modelo" opciones={modelos.map((m) => ({ valor: String(m.id), texto: nombreVape(m.nombre) }))} />
        </div>
      </div>
      <p className="rtm-nota" data-testid="costo-vigente">
        {vigente ? `Costo de lista vigente con ${v.proveedor}: ${formatearMoneda(BigInt(vigente.cent))} desde el ${etiquetaFecha(vigente.desde)}. Al guardar, este pasa al historial.` : `${v.proveedor} todavía no tiene costo de lista para este modelo.`}
      </p>
      <div className="rtm-form-fila">
        <Campo etiqueta="Costo nuevo por pieza" control="monto" requerido valor={v.costo} onCambio={cambia('costo')} error={errores.costo} placeholder="95.00" testid="campo-costo" />
        <Campo etiqueta="Vale desde" control="fecha" requerido valor={v.desde} onCambio={cambia('desde')} error={errores.desde} testid="campo-desde" />
      </div>
      <Campo etiqueta="Fuente del dato" requerido valor={v.fuente} onCambio={cambia('fuente')} error={errores.fuente} placeholder='Por ejemplo: lista de Isaac del 11 nov' testid="campo-fuente" />
      <Casilla etiqueta="Es el costo de lista (el normal del proveedor)" marcada={esLista} onCambio={(x) => { setEsLista(x); reiniciar(); }} testid="campo-es-lista" />
      {!esLista && <Campo etiqueta="Motivo (no es costo de lista)" requerido valor={v.motivo} onCambio={cambia('motivo')} error={errores.motivo} placeholder="Por ejemplo: promoción de fin de mes" testid="campo-motivo" />}
      <Casilla etiqueta="Dato de palabra, sin documento (se mostrará como supuesto)" marcada={supuesto} onCambio={(x) => { setSupuesto(x); reiniciar(); }} testid="campo-supuesto" />
      <div className="rtm-acciones-fila">
        <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado} data-testid="revisar-costo">{ocupado ? 'Guardando' : 'Revisar y guardar'}</button>
      </div>
      {resultado?.ok && <EcoResultado tono="ok"><p>{resultado.eco}</p></EcoResultado>}
      {resultado && !resultado.ok && <EcoResultado tono="error">{resultado.mensaje}</EcoResultado>}
      {confirmando && validado.ok && (
        <ConfirmDialog abierto titulo="Confirmar cambio de costo" confirmar="Guardar costo" ocupado={ocupado} onConfirmar={guardar} onCancelar={() => setConfirmando(false)}>
          <dl className="rtm-dl">
            <dt>Proveedor</dt><dd>{validado.valor.proveedor}</dd>
            <dt>Modelo</dt><dd>{modelo.nombre}</dd>
            {vigente && <><dt>Costo actual</dt><dd className="rtm-num">{formatearMoneda(BigInt(vigente.cent))}</dd></>}
            <dt>Costo nuevo</dt><dd className="rtm-num">{formatearMoneda(validado.valor.costoCent)}</dd>
            <dt>Vale desde</dt><dd>{etiquetaFecha(validado.valor.desde)}</dd>
          </dl>
          <p>{validado.valor.esLista ? 'Cambia el costo de lista: los márgenes de este modelo se recalculan en la base.' : 'No es costo de lista: se guarda con su motivo.'}{validado.valor.supuesto ? ' Se marcará como supuesto.' : ''}</p>
        </ConfirmDialog>
      )}
    </form>
  );
}
