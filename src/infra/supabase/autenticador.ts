import type { Autenticador, EstadoSesion, Perfil } from '@/aplicacion/acceso/puertos';
import { crearClienteServidor } from './cliente-servidor';

function esPerfil(v: unknown): v is Perfil {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (p.rol === 'socio' || p.rol === 'omar') && typeof p.activo === 'boolean';
}

export function autenticadorSupabase(): Autenticador {
  return {
    async enviarEnlace(correo, redirectTo) {
      const sb = await crearClienteServidor();
      const { error } = await sb.auth.signInWithOtp({
        email: correo,
        options: {
          emailRedirectTo: redirectTo,
          // Nadie se da de alta solo: las cuentas las crea el script local de alta. Sin esto Supabase crearia el usuario de cualquier correo.
          shouldCreateUser: false,
        },
      });
      return { error: error ? { code: error.code, message: error.message, status: error.status } : null };
    },

    async canjearCodigo(code) {
      const sb = await crearClienteServidor();
      const { error } = await sb.auth.exchangeCodeForSession(code);
      return { error: error ? { code: error.code, message: error.message, status: error.status } : null };
    },

    async canjearTokenHash(tokenHash, tipo) {
      const sb = await crearClienteServidor();
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
      return { error: error ? { code: error.code, message: error.message, status: error.status } : null };
    },

    async sesion(): Promise<EstadoSesion> {
      const sb = await crearClienteServidor();
      // getUser valida el token contra Auth; getSession solo leeria la cookie.
      const { data, error } = await sb.auth.getUser();
      if (error || !data.user) return { autenticado: false };
      const { data: perfil } = await sb.rpc('mi_sesion');
      return { autenticado: true, perfil: esPerfil(perfil) ? perfil : null };
    },

    async cerrarSesion() {
      const sb = await crearClienteServidor();
      await sb.auth.signOut();
    },
  };
}
