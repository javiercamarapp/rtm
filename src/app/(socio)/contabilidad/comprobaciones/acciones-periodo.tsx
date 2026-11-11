'use client';

import type { PeriodoContable } from '@/dominio/contabilidad/tipos';
import { BotonAccion } from '../../operacion/formulario-accion';

/** Botones de ciclo del periodo: preparar, aprobar, publicar. Cada uno es una accion de la lista cerrada, con clave de idempotencia. */
export function AccionesPeriodo({ p, terminado }: { p: PeriodoContable; terminado: boolean }) {
  if (p.estado === 'abierto')
    return <BotonAccion chico texto="Preparar" accion="conta_preparar_periodo" args={{ p_periodo: p.id }} desactivado={!terminado} testid={`preparar-${p.id}`} titulo="Preparar el periodo" confirmarTexto="Preparar" />;
  if (p.estado === 'preparado')
    return <BotonAccion chico primario texto="Aprobar" accion="conta_aprobar_periodo" args={{ p_periodo: p.id }} desactivado={!terminado} testid={`aprobar-${p.id}`} titulo="Aprobar el periodo" confirmarTexto="Aprobar" />;
  if (p.estado === 'aprobado')
    return (
      <>
        <BotonAccion chico primario texto="Publicar" accion="conta_publicar_periodo" args={{ p_periodo: p.id }} testid={`publicar-${p.id}`} titulo="Publicar el periodo" confirmarTexto="Publicar" />
        <BotonAccion chico texto="Reabrir" accion="conta_reabrir_periodo" args={{ p_periodo: p.id }} motivo="Motivo de la reapertura" titulo="Reabrir el periodo" testid={`reabrir-${p.id}`} />
      </>
    );
  return <BotonAccion chico texto="Reabrir" accion="conta_reabrir_periodo" args={{ p_periodo: p.id }} motivo="Motivo de la reapertura" titulo="Reabrir el periodo" testid={`reabrir-${p.id}`} />;
}
