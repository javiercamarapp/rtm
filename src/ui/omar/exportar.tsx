'use client';

/** Exporta tu cuenta tal como la ves (CSV con comillas): solo texto ya calculado. */
export function ExportarCuenta({ nombre, filas }: { nombre: string; filas: string[][] }) {
  const descargar = () => {
    const csv = filas.map((f) => f.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  };
  return <button type="button" className="rtm-boton" onClick={descargar} data-testid="exportar-cuenta">Exportar mi cuenta (CSV)</button>;
}
