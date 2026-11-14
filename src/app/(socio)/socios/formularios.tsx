'use client';

import { BarraAcciones } from '@/ui/componentes/barra-acciones';
import { FormularioAccion } from '../operacion/formulario-accion';

const SOCIOS = [{ valor: 'Angelo', texto: 'Angelo' }, { valor: 'Javier', texto: 'Javier' }];

const VISTAS = [
  { href: '/socios/Angelo/historial', etiqueta: 'Angelo', titulo: 'Historial de Angelo', testid: 'ir-historial-Angelo' },
  { href: '/socios/Javier/historial', etiqueta: 'Javier', titulo: 'Historial de Javier', testid: 'ir-historial-Javier' },
  { href: '/contabilidad/valuacion/historial', etiqueta: 'Valuación', titulo: 'Historial de valuación' },
  { href: '/socios/cascada', etiqueta: 'Cascada', titulo: 'Cascada y actas' },
];

/** Capturas de la cuenta de socios por indicación de un socio: se ejecutan directo, con el saldo resultante en pantalla y deshacer. */
export function AccionesSocios() {
  return (
    <BarraAcciones
      etiquetaAria="Acciones de la cuenta de socios"
      vistas={VISTAS}
      primarias={
      <FormularioAccion boton="Registrar depósito" descripcion="Registrar depósito de un socio" titulo="Dinero que un socio deposita" confirmar="Registrar aportación" accion="registrar_aportacion" primario testid="aportacion"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que aporta', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_concepto', etiqueta: 'Motivo', tipo: 'texto', requerido: true },
          { nombre: 'p_intencion', etiqueta: 'Intención (obligatoria)', tipo: 'seleccion', requerido: true, opciones: [{ valor: 'reembolso', texto: 'Reembolso: la sociedad se lo debe y se lo regresa pronto' }, { valor: 'capital', texto: 'Capital: metemos más lana para invertir' }] },
        ]}
        nota="Solo es capital si el socio lo declara. Todo lo demás es cuenta por pagar al socio. Entra a la caja de la empresa; el capital se devuelve solo con un retiro de capital acordado por los dos." />
      }
      secundarias={
        <>
      <FormularioAccion boton="Registrar gasto" descripcion="Registrar gasto pagado por un socio" variante="item" titulo="Gasto pagado por un socio" confirmar="Registrar gasto" accion="registrar_gasto_socio" testid="gasto-socio"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que pagó', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_categoria', etiqueta: 'Categoría (envío, guía, servicio del sistema...)', tipo: 'texto', requerido: true },
          { nombre: 'p_naturaleza', etiqueta: 'Naturaleza', tipo: 'seleccion', opciones: [{ valor: 'variable', texto: 'Variable' }, { valor: 'fijo', texto: 'Fijo' }] },
          { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' },
        ]}
        nota="Es gasto de la sociedad; la sociedad le debe el reembolso a quien lo pagó." />
      <FormularioAccion boton="Registrar pago" descripcion="Registrar pago a un socio" variante="item" titulo="Pago de la sociedad a un socio" confirmar="Registrar pago" accion="registrar_pago_a_socio" testid="pago-a-socio"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que recibe', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_tipo', etiqueta: 'Qué se paga', tipo: 'seleccion', opciones: [{ valor: 'reembolso', texto: 'Reembolso de gastos' }, { valor: 'retiro', texto: 'Retiro de utilidad ya asignada' }] },
          { nombre: 'p_via', etiqueta: 'Cómo', tipo: 'seleccion', opciones: [{ valor: 'transferencia', texto: 'Transferencia' }, { valor: 'efectivo', texto: 'Efectivo' }] },
        ]} />
      <FormularioAccion boton="Registrar liquidación" descripcion="Registrar liquidación entre socios" variante="item" titulo="Liquidación entre socios" confirmar="Registrar liquidación" accion="registrar_liquidacion_entre_socios" testid="liquidacion-socios"
        campos={[
          { nombre: 'p_de', etiqueta: 'Quién paga', tipo: 'seleccion', opciones: SOCIOS },
          { nombre: 'p_a', etiqueta: 'Quién recibe', tipo: 'seleccion', opciones: [{ valor: 'Javier', texto: 'Javier' }, { valor: 'Angelo', texto: 'Angelo' }] },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' },
        ]}
        nota="Baja lo que paga el primero a la sociedad y lo que la sociedad le debe al segundo." />
        </>
      }
    />
  );
}
