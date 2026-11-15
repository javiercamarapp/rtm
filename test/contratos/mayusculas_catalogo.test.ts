// Contrato de presentacion (decision del dueno, 14-nov): marcas, modelos y sabores se MUESTRAN siempre en MAYUSCULAS.
// Heuristica por grep sobre las rutas conocidas: un componente que pinta el nombre de un modelo, sabor o marca como hijo JSX, como celda de tabla o como etiqueta de grafica
// sin pasar por el formateador (src/dominio/formato/nombres.ts) o por la clase rtm-may-* FALLA. Es presentacion: no toca nombre_canonico ni la busqueda.
// Excepcion puntual: una linea con el comentario `may-ok` (por ejemplo un nombre que ya viene en mayusculas del servidor).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}
const tsx = archivos(join(RAIZ, 'src')).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx') && !f.includes(`${join('src', 'ui', 'galeria')}`) && !f.includes('pruebas'));

const PROP = '(?:modelo|sabor|marca)';
const RUTA = '[A-Za-z_]\\w*(?:\\??\\.[A-Za-z_]\\w*|\\[[^\\]]+\\])*?';
const CRUDOS: { nombre: string; re: RegExp }[] = [
  { nombre: 'hijo JSX {x.modelo|sabor|marca}', re: new RegExp(`(?<![=$\\w])\\{${RUTA}\\.${PROP}\\}`) },
  { nombre: 'celda: (x) => x.modelo|sabor|marca', re: new RegExp(`celda: \\(\\w+\\) => ${RUTA}\\.${PROP}\\s*[,})]`) },
  { nombre: 'etiqueta: x.modelo|sabor|marca', re: new RegExp(`etiqueta: ${RUTA}\\.${PROP}\\s*[,}]`) },
  { nombre: 'plantilla ${x.modelo|sabor|marca}', re: new RegExp(`\\$\\{${RUTA}\\.${PROP}\\}`) },
];
// Las plantillas que son identidad (llaves, claves, busqueda, rutas) no se muestran: se excluyen por contexto.
const IDENTIDAD = /key=|clave=|clave:|value=|href|testid|toLowerCase|normalizar\(|\.includes\(|\.set\(|\.get\(|\.has\(|===|!==|\.find\(|\.some\(|localeCompare|new Set|new Map|sabores\[|\.indexOf\(|\bid=|name=|may-ok/;

describe('mayusculas de marcas, modelos y sabores en la interfaz', () => {
  it('ningun componente pinta un modelo, sabor o marca sin pasar por el formateador', () => {
    const fallas: string[] = [];
    for (const f of tsx) {
      readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
        if (IDENTIDAD.test(linea)) return;
        for (const c of CRUDOS) if (c.re.test(linea)) fallas.push(`${relative(RAIZ, f)}:${i + 1} (${c.nombre}) ${linea.trim().slice(0, 120)}`);
      });
    }
    expect(fallas, `Pasa el nombre por nombreVape, marcaMayus o saborMayus (src/dominio/formato):\n${fallas.join('\n')}`).toEqual([]);
  });

  it('los componentes compartidos de modelo y marca aplican el formateador o la clase de presentacion', () => {
    const modelo = readFileSync(join(RAIZ, 'src/ui/componentes/modelo.tsx'), 'utf8');
    expect(modelo).toMatch(/nombreVape\(modelo\)/);
    expect(modelo).toMatch(/marcaMayus\(marca\)/);
    const filtro = readFileSync(join(RAIZ, 'src/ui/componentes/filtro-catalogo.tsx'), 'utf8');
    expect(filtro.match(/rtm-may-marca/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // lista de marcas y chips seleccionados
  });

  it('la hoja de mayusculas existe, usa uppercase y se carga en el layout', () => {
    const css = readFileSync(join(RAIZ, 'src/ui/estilos/mayusculas.css'), 'utf8');
    for (const c of ['.rtm-may', '.rtm-may-modelo', '.rtm-may-sabor', '.rtm-may-marca']) expect(css).toContain(c);
    expect(css).toMatch(/text-transform:\s*uppercase/);
    expect(readFileSync(join(RAIZ, 'src/app/layout.tsx'), 'utf8')).toContain("@/ui/estilos/mayusculas.css");
  });

  it('el texto que sale a PDF, CSV, bot y reportes usa el formateador', () => {
    const debe: [string, RegExp][] = [
      ['src/infra/pdf/nota.ts', /nombreVape\(g\.modelo\)/],
      ['src/infra/pdf/inventario.ts', /saborMayus\(sa\.sabor\)/],
      ['src/infra/pdf/devolucion.ts', /nombreVape\(l\.modelo\)/],
      ['src/dominio/inventario/csv.ts', /saborMayus\(m\.sabor\)/],
      ['src/dominio/datos/csv.ts', /nombreVape\(m\.modelo\)/],
      ['src/app/(socio)/inventario/csv/route.ts', /marcaMayus\(x\.marca\)/],
      ['src/dominio/nota/texto.ts', /nombreVape\(x\.modelo\)/],
      ['src/aplicacion/agente/plantillas.ts', /nombreVape\(d\.lineas\[0\]/],
      ['src/infra/reportes/insumos_json.ts', /nombreVape\(txt\(j\.modelo\)\)/],
    ];
    for (const [ruta, re] of debe) expect(readFileSync(join(RAIZ, ruta), 'utf8'), ruta).toMatch(re);
  });
});
