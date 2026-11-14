// Adaptador de la pantalla Cuentas contra Supabase: usa la sesion del socio y SOLO api.cuentas_lista / api.cuenta_alta / api.cuenta_cambiar_estado.
import { ErrorCuentas, type PuertoCuentas } from '@/aplicacion/cuentas/cuentas';
import { parsearCuentas } from '@/dominio/cuentas/cuentas';
import { crearClienteServidor } from './cliente-servidor';

export function cuentasSupabase(): PuertoCuentas {
  return {
    async listar() {
      const sb = await crearClienteServidor();
      const { data, error } = await sb.rpc('cuentas_lista');
      if (error) throw new ErrorCuentas(error.message, error.code ?? null);
      return parsearCuentas(data);
    },
    async alta(clave, e) {
      const sb = await crearClienteServidor();
      const { data, error } = await sb.rpc('cuenta_alta', { p_clave_idem: clave, p_correo: e.correo, p_tipo: e.tipo, p_nombre: e.nombre === '' ? null : e.nombre });
      if (error) throw new ErrorCuentas(error.message, error.code ?? null);
      const r = (data ?? {}) as Record<string, unknown>;
      const estado = r.estado === 'sin_cambio' || r.estado === 'desactivada' ? r.estado : 'creada';
      return { estado, accesoCreado: r.acceso_creado === true };
    },
    async cambiarEstado(clave, correo, activo, motivo) {
      const sb = await crearClienteServidor();
      const { data, error } = await sb.rpc('cuenta_cambiar_estado', { p_clave_idem: clave, p_correo: correo, p_activo: activo, p_motivo: motivo });
      if (error) throw new ErrorCuentas(error.message, error.code ?? null);
      const r = (data ?? {}) as Record<string, unknown>;
      const estado = r.estado === 'reactivada' || r.estado === 'desactivada' ? r.estado : 'sin_cambio';
      return { estado };
    },
  };
}
