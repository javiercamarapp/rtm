import type { Metadata } from 'next';
import Link from 'next/link';
import { cuentasDeSocio } from '@/composicion/cuentas';
import { etiquetaFechaHora } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AccionesCuenta } from './acciones-cuenta';
import { altaCuentaAccion, estadoCuentaAccion } from './acciones';
import { FormularioAltaCuenta } from './formulario-alta';

export const metadata: Metadata = { title: 'Cuentas' };

export default async function PaginaCuentas() {
  const { tipos, cuentas } = await cuentasDeSocio();
  const activas = cuentas.filter((c) => c.activo).length;
  const sinAcceso = cuentas.filter((c) => c.gestionable && c.activo && !c.accesoCreado).length;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Cuentas de acceso"
        titulo={`${cuentas.length} ${cuentas.length === 1 ? 'cuenta' : 'cuentas'} con acceso por correo`}
        descripcion={`${activas} activas. Cada persona entra con el enlace que se le manda a su correo; el tipo decide lo que ve.`}
        acciones={<Link className="rtm-boton" href="/bodega" data-testid="ver-vista-bodega">Ver la vista de bodega</Link>}
      />
      {sinAcceso > 0 && (
        <p className="rtm-nota" data-testid="aviso-sin-acceso">
          {sinAcceso === 1 ? 'Hay 1 cuenta' : `Hay ${sinAcceso} cuentas`} sin acceso creado todavía. Corre «npm run acceso:cuentas» (en la nube, «npm run acceso:cuentas:nube»): crea el acceso sin mandar correos; después la persona pide su enlace en la pantalla de entrada.
        </p>
      )}
      <Rejilla dividir="4-8" alinear="inicio">
        <Tarjeta titulo="Dar de alta" descripcion="Un correo con su tipo de cuenta">
          <FormularioAltaCuenta tipos={tipos} accion={altaCuentaAccion} />
        </Tarjeta>
        <Tarjeta plana titulo="Cuentas" descripcion="Desactivar no borra: se conserva y se puede reactivar">
          <DataTable
            etiqueta="Cuentas de acceso" densidad="densa" plana clave={(c) => c.correo} filas={cuentas}
            vacio={{ titulo: 'Sin cuentas', texto: 'Las cuentas que des de alta aparecerán aquí.' }}
            columnas={[
              { id: 'c', titulo: 'Correo', ancho: 'l', prioridadMovil: 'titulo', celda: (c) => <>{c.correo}{c.nombre && <span className="rtm-celda-sub">{c.nombre}</span>}</> },
              { id: 't', titulo: 'Tipo', celda: (c) => c.tipo },
              {
                id: 'e', titulo: 'Estado', prioridadMovil: 'principal',
                celda: (c) => (
                  <>
                    <EstadoTexto tono={c.activo ? 'ok' : 'neutro'}>{c.activo ? 'Activa' : 'Desactivada'}</EstadoTexto>
                    <span className="rtm-celda-sub">{c.accesoCreado ? (c.ultimoIngreso ? `Último ingreso ${etiquetaFechaHora(c.ultimoIngreso)}` : 'Sin ingresos aún') : 'Falta crear su acceso'}</span>
                  </>
                ),
              },
              { id: 'a', titulo: 'Acciones', celda: (c) => (c.gestionable ? <AccionesCuenta correo={c.correo} activo={c.activo} accion={estadoCuentaAccion} /> : <span className="rtm-celda-sub">Se administra fuera de la web</span>) },
            ]}
          />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
