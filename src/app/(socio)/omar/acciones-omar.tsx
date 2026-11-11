'use client';

import { FormularioAccion, BotonAccion } from '../operacion/formulario-accion';

interface Sku { sku_id: number; etiqueta: string }

export function FormularioToma({ skus }: { skus: Sku[] }) {
  return (
    <FormularioAccion boton="Registrar toma de Omar" titulo="Toma de Omar a crédito" confirmar="Registrar toma" accion="registrar_toma_omar" primario testid="nueva-toma"
      transformar={(a) => { const { p_sku_id, ...resto } = a; return { ...resto, p_sku: { sku_id: Number(p_sku_id) } }; }}
      campos={[
        { nombre: 'p_sku_id', etiqueta: 'Modelo y sabor', tipo: 'seleccion', opciones: skus.map((s) => ({ valor: String(s.sku_id), texto: s.etiqueta })) },
        { nombre: 'p_piezas', etiqueta: 'Piezas', tipo: 'entero', requerido: true },
        { nombre: 'p_precio_cent', etiqueta: 'Precio por pieza (vacío = el de su lista)', tipo: 'monto' },
      ]}
      nota="Una toma registrada por un socio se ejecuta directo, a su precio. Si no tiene precio queda como “Falta precio” y no entra al saldo." />
  );
}

export function PagoOmar() {
  return (
    <FormularioAccion boton="Registrar pago a Omar o de Omar" titulo="Pago con Omar" confirmar="Registrar pago" accion="registrar_pago_omar" testid="pago-omar"
      campos={[
        { nombre: 'p_sentido', etiqueta: 'Sentido', tipo: 'seleccion', opciones: [{ valor: 'a_omar', texto: 'Los socios pagan a Omar' }, { valor: 'de_omar', texto: 'Omar paga a los socios' }] },
        { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true },
        { nombre: 'p_socio', etiqueta: 'Socio que paga o recibe', tipo: 'seleccion', opciones: [{ valor: 'Angelo', texto: 'Angelo' }, { valor: 'Javier', texto: 'Javier' }] },
        { nombre: 'p_via', etiqueta: 'Cómo', tipo: 'seleccion', opciones: [{ valor: 'transferencia', texto: 'Transferencia' }, { valor: 'efectivo', texto: 'Efectivo' }] },
      ]} />
  );
}

export function CerrarSemana({ semana, desactivado }: { semana: string; desactivado: boolean }) {
  return <BotonAccion texto="Cerrar liquidación semanal" titulo="Cerrar la liquidación de la semana" confirmarTexto="Cerrar liquidación" accion="cerrar_liquidacion_omar" args={{ p_semana_ini: semana }} desactivado={desactivado} testid="cerrar-omar" />;
}

export function ResolverToma({ id }: { id: number }) {
  return (
    <span className="rtm-acciones-fila">
      <BotonAccion chico primario texto="Autorizar" accion="resolver_toma_omar" args={{ p_toma: id, p_accion: 'autorizar' }} testid={`autorizar-${id}`} />
      <BotonAccion chico texto="Rechazar" accion="resolver_toma_omar" args={{ p_toma: id, p_accion: 'rechazar' }} testid={`rechazar-${id}`} />
    </span>
  );
}

/** Exporta la semana tal como se ve (CSV con comillas): solo texto ya calculado por la base. */
export function ExportarCsv({ nombre, filas }: { nombre: string; filas: string[][] }) {
  const descargar = () => {
    const csv = filas.map((f) => f.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  };
  return <button type="button" className="rtm-boton" onClick={descargar} data-testid="exportar-omar">Exportar la semana (CSV)</button>;
}
