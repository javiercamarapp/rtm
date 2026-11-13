'use client';

import { FormularioAccion } from '../operacion/formulario-accion';

/** Anular un pago de renta registrado por error: pide motivo y confirma en un dialogo. No borra el pago: la base inserta un contra-pago y el saldo vuelve exacto. */
export function AnularPagoRenta({ folio, monto }: { folio: string; monto: string }) {
  return (
    <FormularioAccion
      boton="Anular" titulo={`Anular el pago ${folio} de ${monto}`} confirmar="Anular pago" accion="anular_pago_renta" chico testid={`anular-${folio}`}
      fijos={{ p_folio: folio }}
      campos={[{ nombre: 'p_motivo', etiqueta: 'Motivo (obligatorio)', tipo: 'texto', requerido: true }]}
      nota="El pago original se conserva en el historial y se agrega una reversa con tu motivo. La renta por pagar vuelve a lo que era antes del pago."
    />
  );
}
