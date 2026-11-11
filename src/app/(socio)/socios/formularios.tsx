'use client';

import { FormularioAccion } from '../operacion/formulario-accion';

const SOCIOS = [{ valor: 'Angelo', texto: 'Angelo' }, { valor: 'Javier', texto: 'Javier' }];

/** Capturas de la cuenta de socios por indicación de un socio: se ejecutan directo, con el saldo resultante en pantalla y deshacer. */
export function AccionesSocios() {
  return (
    <>
      <FormularioAccion boton="Registrar aportación" titulo="Aportación de capital de un socio" confirmar="Registrar aportación" accion="registrar_aportacion" primario testid="aportacion"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que aporta', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_concepto', etiqueta: 'Motivo', tipo: 'texto', requerido: true, defecto: 'Capital adicional' },
          { nombre: 'p_clasificacion', etiqueta: 'Qué es', tipo: 'seleccion', opciones: [{ valor: 'capital', texto: 'Capital (se devuelve antes de repartir utilidad)' }, { valor: 'reembolsable', texto: 'Gasto que se reembolsa' }] },
        ]}
        nota="La sociedad se lo devuelve en la cascada de reparto, antes de repartir utilidades." />
      <FormularioAccion boton="Registrar gasto pagado por un socio" titulo="Gasto pagado por un socio" confirmar="Registrar gasto" accion="registrar_gasto_socio" testid="gasto-socio"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que pagó', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_categoria', etiqueta: 'Categoría (envío, guía, servicio del sistema...)', tipo: 'texto', requerido: true },
          { nombre: 'p_naturaleza', etiqueta: 'Naturaleza', tipo: 'seleccion', opciones: [{ valor: 'variable', texto: 'Variable' }, { valor: 'fijo', texto: 'Fijo' }] },
          { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' },
        ]}
        nota="Es gasto de la sociedad; la sociedad le debe el reembolso a quien lo pagó." />
      <FormularioAccion boton="Registrar pago a un socio" titulo="Pago de la sociedad a un socio" confirmar="Registrar pago" accion="registrar_pago_a_socio" testid="pago-a-socio"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que recibe', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_tipo', etiqueta: 'Qué se paga', tipo: 'seleccion', opciones: [{ valor: 'reembolso', texto: 'Reembolso de gastos' }, { valor: 'devolucion_aportacion', texto: 'Devolución de aportación' }, { valor: 'retiro', texto: 'Retiro' }] },
          { nombre: 'p_via', etiqueta: 'Cómo', tipo: 'seleccion', opciones: [{ valor: 'transferencia', texto: 'Transferencia' }, { valor: 'efectivo', texto: 'Efectivo' }] },
        ]} />
      <FormularioAccion boton="Registrar liquidación entre socios" titulo="Liquidación entre socios" confirmar="Registrar liquidación" accion="registrar_liquidacion_entre_socios" testid="liquidacion-socios"
        campos={[
          { nombre: 'p_de', etiqueta: 'Quién paga', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_a', etiqueta: 'Quién recibe', tipo: 'seleccion', opciones: [{ valor: 'Javier', texto: 'Javier' }, { valor: 'Angelo', texto: 'Angelo' }] },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' },
        ]}
        nota="Baja lo que paga el primero a la sociedad y lo que la sociedad le debe al segundo." />
    </>
  );
}
