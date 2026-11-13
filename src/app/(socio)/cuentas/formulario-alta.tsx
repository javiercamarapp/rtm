'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { ResultadoCuentas } from '@/aplicacion/cuentas/cuentas';
import { validarAlta, type CampoAlta, type TipoCuenta } from '@/dominio/cuentas/cuentas';
import { Campo, EcoResultado } from '@/ui/componentes/campo';

type Accion = (clave: string, entrada: { correo: string; tipo: string; nombre: string }) => Promise<ResultadoCuentas<CampoAlta>>;

/** Alta de un correo con su tipo. Solo ofrece los tipos creables desde la web (hoy, bodega). La clave de idempotencia se renueva solo tras un exito. */
export function FormularioAltaCuenta({ tipos, accion }: { tipos: TipoCuenta[]; accion: Accion }) {
  const router = useRouter();
  const creables = tipos.filter((t) => t.creableWeb);
  const [v, setV] = useState({ correo: '', tipo: creables[0]?.rol ?? '', nombre: '' });
  const [locales, setLocales] = useState<Partial<Record<CampoAlta, string>>>({});
  const [resultado, setResultado] = useState<ResultadoCuentas<CampoAlta> | null>(null);
  const [ocupado, empezar] = useTransition();
  const clave = useRef(`web:${crypto.randomUUID()}`);
  const errores = { ...(resultado && !resultado.ok ? resultado.errores : {}), ...locales };
  const cambia = (k: keyof typeof v) => (valor: string) => { setV({ ...v, [k]: valor }); setLocales({}); setResultado(null); };
  const tipo = creables.find((t) => t.rol === v.tipo);

  const alEnviar = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const c = validarAlta(v, creables.map((t) => t.rol));
    if (!c.ok) return setLocales(c.errores);
    setLocales({});
    empezar(async () => {
      let r: ResultadoCuentas<CampoAlta>;
      try {
        r = await accion(clave.current, v);
      } catch {
        r = { ok: false, mensaje: 'No se pudo guardar. Revisa tu conexión e intenta de nuevo; no se duplicará.', errores: {} };
      }
      setResultado(r);
      if (r.ok) {
        clave.current = `web:${crypto.randomUUID()}`;
        setV({ correo: '', tipo: v.tipo, nombre: '' });
        router.refresh();
      }
    });
  };

  return (
    <form className="rtm-form" onSubmit={alEnviar} noValidate aria-busy={ocupado || undefined} data-testid="formulario-cuenta">
      <div className="rtm-form-fila">
        <div className="rtm-campo-ancho"><Campo etiqueta="Correo" requerido valor={v.correo} onCambio={cambia('correo')} error={errores.correo} placeholder="tu@correo.com" testid="campo-correo" ayuda="El texto exacto con el que va a pedir su enlace (Gmail con puntos es otra cuenta)." /></div>
        <Campo etiqueta="Tipo de cuenta" control="seleccion" opciones={creables.map((t) => ({ valor: t.rol, texto: t.etiqueta }))} valor={v.tipo} onCambio={cambia('tipo')} error={errores.tipo} testid="campo-tipo-cuenta" />
      </div>
      <Campo etiqueta="Nombre o turno (opcional)" valor={v.nombre} onCambio={cambia('nombre')} error={errores.nombre} placeholder="Por ejemplo: turno matutino" testid="campo-nombre-cuenta" ayuda={tipo?.descripcion} />
      <div className="rtm-acciones-fila">
        <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado || creables.length === 0} data-testid="crear-cuenta">{ocupado ? 'Guardando' : 'Dar de alta'}</button>
      </div>
      {resultado?.ok && <EcoResultado tono="ok"><p data-testid="eco-cuenta">{resultado.eco}</p></EcoResultado>}
      {resultado && !resultado.ok && <EcoResultado tono="error"><span data-testid="error-cuenta">{resultado.mensaje}</span></EcoResultado>}
    </form>
  );
}
