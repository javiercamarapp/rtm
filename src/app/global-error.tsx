'use client';

import '@/ui/estilos/tokens.css';
import '@/ui/estilos/base.css';
import '@/ui/estilos/componentes.css';
import '@/ui/estilos/shell.css';
import '@/ui/estilos/operacion.css';

/** Ultimo recurso: falla el layout raiz. Sin router (puede no existir): reintentar recarga la pagina completa. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="es">
      <body>
        <main className="rtm-documento" id="contenido">
          <section className="rtm-vacio" role="alert">
            <h2>No se pudo abrir RTM</h2>
            <p>Pasó algo inesperado. No se perdió nada de lo ya guardado. Recarga la página; si sigue igual, avisa a Javier con la referencia.</p>
            {error.digest && <p className="rtm-nota rtm-mono">Referencia: {error.digest}</p>}
            <div className="rtm-acciones-fila">
              <button type="button" className="rtm-boton rtm-boton-primario" onClick={() => window.location.reload()}>Reintentar</button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
