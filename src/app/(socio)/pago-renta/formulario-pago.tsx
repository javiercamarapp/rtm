'use client';

import { Aviso } from '@/ui/componentes/controles';
import { formatearMoneda } from '@/dominio/formato';
import { FormularioAccion } from '../operacion/formulario-accion';
import { centavosDeTexto } from '../operacion/usar-accion';

/** Registrar un pago de renta a Omar. Solo socio (la base lo vuelve a validar). Un monto mayor que lo que se debe exige confirmar el anticipo. */
export function RegistrarPagoRenta({ porPagarCent }: { porPagarCent: number }) {
  return (
    <FormularioAccion
      boton="Registrar pago de renta" titulo="Pago de renta a Omar" confirmar="Registrar pago" accion="registrar_pago_renta" primario testid="pago-renta"
      transformar={(a) => ({ ...a, p_confirmo_exceso: a['p_confirmo_exceso'] === 'si' })}
      avisoVivo={(v) => {
        const c = centavosDeTexto(v['p_monto_cent'] ?? '');
        if (c === null || c <= porPagarCent) return null;
        const exceso = BigInt(c - Math.max(porPagarCent, 0));
        return v['p_confirmo_exceso'] === 'si'
          ? <Aviso tono="info" titulo="Anticipo.">Se registra el pago y quedan {formatearMoneda(exceso)} a favor de Omar.</Aviso>
          : <Aviso tono="atencion" titulo="Es más de lo que se debe.">Se deben {formatearMoneda(BigInt(Math.max(porPagarCent, 0)))}. Para registrar el exceso de {formatearMoneda(exceso)} elige “Sí, es un anticipo”.</Aviso>;
      }}
      campos={[
        { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
        { nombre: 'p_socio', etiqueta: 'Quién paga', tipo: 'seleccion', defecto: '', opciones: [{ valor: '', texto: 'Yo (mi sesión)' }, { valor: 'Angelo', texto: 'Angelo' }, { valor: 'Javier', texto: 'Javier' }] },
        { nombre: 'p_via', etiqueta: 'Cómo', tipo: 'seleccion', opciones: [{ valor: 'transferencia', texto: 'Transferencia' }, { valor: 'efectivo', texto: 'Efectivo' }] },
        { nombre: 'p_fecha', etiqueta: 'Fecha del pago (vacío = hoy)', tipo: 'fecha' },
        { nombre: 'p_comprobante', etiqueta: 'Referencia del comprobante (opcional)', tipo: 'texto' },
        { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' },
        { nombre: 'p_confirmo_exceso', etiqueta: '¿Es un anticipo mayor que lo que se debe?', tipo: 'seleccion', defecto: 'no', opciones: [{ valor: 'no', texto: 'No' }, { valor: 'si', texto: 'Sí, es un anticipo' }] },
      ]}
      nota="El pago baja la cuenta de renta por pagar a Omar y queda en el libro de socios como reembolso (nunca como capital)."
    />
  );
}
