'use client';

import { BarraAcciones } from '@/ui/componentes/barra-acciones';
import { PanelEfecto, type FilaEfecto } from '@/ui/componentes/campos-dialogo';
import { FormularioAccion } from '../operacion/formulario-accion';

const SOCIOS = [{ valor: 'Angelo', texto: 'Angelo' }, { valor: 'Javier', texto: 'Javier' }];

/** Cifras de cada socio ya calculadas por la base (api.cuenta_socios_valuacion y la cuenta de socios) y formateadas por la pagina; aqui solo se muestran. */
export interface EfectoSocio { socio: 'Angelo' | 'Javier'; valuacion: string; participacionPct: number | null; reembolsoPendiente: string; fondos: string }
export interface EfectosSocios { socios: EfectoSocio[]; faltan: string; igualados: boolean }

const de = (e: EfectosSocios | undefined, socio: string) => e?.socios.find((x) => x.socio === socio);

function filasValuacion(e: EfectosSocios, activo?: string): FilaEfecto[] {
  return e.socios.map((x) => ({ id: `valuacion-${x.socio}`, etiqueta: `Valuación actual de ${x.socio}`, valor: x.valuacion, ...(x.participacionPct !== null ? { barra: x.participacionPct } : {}), activa: x.socio === activo, atenuada: !!activo && x.socio !== activo }));
}

const VISTAS = [
  { href: '/socios/Angelo/historial', etiqueta: 'Angelo', titulo: 'Historial de Angelo', testid: 'ir-historial-Angelo' },
  { href: '/socios/Javier/historial', etiqueta: 'Javier', titulo: 'Historial de Javier', testid: 'ir-historial-Javier' },
  { href: '/contabilidad/valuacion/historial', etiqueta: 'Valuación', titulo: 'Historial de valuación' },
  { href: '/socios/cascada', etiqueta: 'Cascada', titulo: 'Cascada y actas' },
];

/** Capturas de la cuenta de socios por indicación de un socio: se ejecutan directo, con el saldo resultante en pantalla y deshacer. */
export function AccionesSocios({ efectos }: { efectos?: EfectosSocios }) {
  return (
    <BarraAcciones
      etiquetaAria="Acciones de la cuenta de socios"
      vistas={VISTAS}
      primarias={
      <FormularioAccion boton="Depósito" descripcion="Registrar depósito de un socio" subtitulo="Dinero que un socio pone en la caja de la sociedad" titulo="Dinero que un socio deposita" confirmar="Registrar aportación" accion="registrar_aportacion" primario testid="aportacion"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que aporta', tipo: 'seleccion', opciones: SOCIOS, presentacion: 'segmentado', avatar: true, seccion: 'Quién y cuánto' },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_concepto', etiqueta: 'Motivo', tipo: 'texto', requerido: true, ancho: 'completo', seccion: 'Motivo e intención', ayuda: 'Para qué se deposita, en pocas palabras.' },
          { nombre: 'p_intencion', etiqueta: 'Intención (obligatoria)', tipo: 'seleccion', requerido: true, presentacion: 'tarjetas', opciones: [
            { valor: 'reembolso', texto: 'Reembolso', descripcion: 'La sociedad se lo debe y se lo regresa pronto.' },
            { valor: 'capital', texto: 'Capital', descripcion: 'Se mete más dinero para invertir.' },
          ] },
        ]}
        efecto={efectos ? (v) => {
          const capital = v.p_intencion === 'capital';
          return <PanelEfecto
            filas={filasValuacion(efectos, v.p_socio)}
            textos={['La barra de cada socio es su participación, tal como la reporta la base.', capital ? 'Se registra como capital del socio, que forma parte de su valuación. Se devuelve solo con un retiro de capital acordado por los dos.' : 'Se registra como reembolso: cuenta por pagar al socio, que la sociedad le regresa. No se cuenta como capital.']}
            resumen={efectos.igualados ? 'Hoy las valuaciones están igualadas.' : `Hoy: ${efectos.faltan}.`} />;
        } : undefined}
        nota="Solo es capital si el socio lo declara. Todo lo demás es cuenta por pagar al socio. Entra a la caja de la empresa; el capital se devuelve solo con un retiro de capital acordado por los dos." />
      }
      secundarias={
        <>
      <FormularioAccion boton="Gasto" descripcion="Registrar gasto pagado por un socio" subtitulo="Gasto de la sociedad pagado con dinero de un socio" variante="terciario" titulo="Gasto pagado por un socio" confirmar="Registrar gasto" accion="registrar_gasto_socio" testid="gasto-socio"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que pagó', tipo: 'seleccion', opciones: SOCIOS, presentacion: 'segmentado', avatar: true, seccion: 'Quién y cuánto' },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_categoria', etiqueta: 'Categoría', tipo: 'texto', requerido: true, ayuda: 'Envío, guía, servicio del sistema...', seccion: 'Detalle' },
          { nombre: 'p_naturaleza', etiqueta: 'Naturaleza', tipo: 'seleccion', presentacion: 'segmentado', opciones: [{ valor: 'variable', texto: 'Variable' }, { valor: 'fijo', texto: 'Fijo' }] },
          { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto', ancho: 'completo' },
        ]}
        efecto={efectos ? (v) => {
          const x = de(efectos, v.p_socio ?? '');
          return <PanelEfecto
            filas={x ? [{ id: 'reembolso-pendiente', etiqueta: `Reembolso pendiente de ${x.socio} hoy`, valor: x.reembolsoPendiente }] : []}
            textos={['El gasto se registra una sola vez como gasto de la sociedad, y la sociedad le debe el reembolso a quien lo pagó.']} />;
        } : undefined}
        nota="Es gasto de la sociedad; la sociedad le debe el reembolso a quien lo pagó." />
      <FormularioAccion boton="Pago" descripcion="Registrar pago a un socio" subtitulo="Dinero que la sociedad entrega a un socio" variante="terciario" titulo="Pago de la sociedad a un socio" confirmar="Registrar pago" accion="registrar_pago_a_socio" testid="pago-a-socio"
        campos={[
          { nombre: 'p_socio', etiqueta: 'Socio que recibe', tipo: 'seleccion', opciones: SOCIOS, presentacion: 'segmentado', avatar: true, seccion: 'Quién y cuánto' },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_tipo', etiqueta: 'Qué se paga', tipo: 'seleccion', presentacion: 'segmentado', opciones: [{ valor: 'reembolso', texto: 'Reembolso de gastos' }, { valor: 'retiro', texto: 'Retiro de utilidad ya asignada' }], seccion: 'Detalle' },
          { nombre: 'p_via', etiqueta: 'Cómo', tipo: 'seleccion', presentacion: 'segmentado', opciones: [{ valor: 'transferencia', texto: 'Transferencia' }, { valor: 'efectivo', texto: 'Efectivo' }] },
        ]}
        efecto={efectos ? (v) => {
          const x = de(efectos, v.p_socio ?? '');
          return <PanelEfecto
            filas={x ? [{ id: 'reembolso-pendiente', etiqueta: `Reembolso pendiente de ${x.socio}`, valor: x.reembolsoPendiente, activa: v.p_tipo === 'reembolso' }, { id: 'valuacion', etiqueta: `Valuación actual de ${x.socio}`, valor: x.valuacion, activa: v.p_tipo === 'retiro' }] : []}
            textos={[v.p_tipo === 'retiro' ? 'Un retiro de utilidad ya asignada baja la valuación del socio.' : 'Un reembolso salda lo que la sociedad le debe al socio por gastos o dinero propio.']} />;
        } : undefined} />
      <FormularioAccion boton="Liquidación" descripcion="Registrar liquidación entre socios" subtitulo="Pago de un socio a otro para saldar cuentas" variante="terciario" titulo="Liquidación entre socios" confirmar="Registrar liquidación" accion="registrar_liquidacion_entre_socios" testid="liquidacion-socios"
        campos={[
          { nombre: 'p_de', etiqueta: 'Quién paga', tipo: 'seleccion', opciones: SOCIOS, presentacion: 'segmentado', avatar: true, seccion: 'Quién y cuánto' },
          { nombre: 'p_a', etiqueta: 'Quién recibe', tipo: 'seleccion', opciones: [{ valor: 'Javier', texto: 'Javier' }, { valor: 'Angelo', texto: 'Angelo' }], presentacion: 'segmentado', avatar: true },
          { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
          { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto', ancho: 'completo' },
        ]}
        efecto={efectos ? (v) => <PanelEfecto filas={filasValuacion(efectos)} textos={['Baja lo que paga el primero a la sociedad y lo que la sociedad le debe al segundo.']} resumen={v.p_de && v.p_de === v.p_a ? 'Quien paga y quien recibe son el mismo socio.' : undefined} /> : undefined}
        nota="Baja lo que paga el primero a la sociedad y lo que la sociedad le debe al segundo." />
        </>
      }
    />
  );
}
