import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guarda estatica de espacio en blanco muerto y de responsive (iPhone 16 Pro 402x874, plegable cerrado 344x880 y abierto 880x860).
// El navegador real se revisa aparte; aqui se vigila que nadie reintroduzca las causas clasicas.
const DIR = join(process.cwd(), 'src', 'ui', 'estilos');
const archivos = readdirSync(DIR).filter((f) => f.endsWith('.css')).map((f) => [f, readFileSync(join(DIR, f), 'utf8')] as const);
const todo = archivos.map(([, t]) => t).join('\n');
const leer = (f: string) => archivos.find(([n]) => n === f)![1];

describe('css sin espacio muerto', () => {
  it('ninguna regla usa flex-basis ni el atajo flex con una base en px (las columnas se estiran con el contenido)', () => {
    expect(todo).not.toMatch(/flex-basis/);
    expect(todo).not.toMatch(/flex:\s*[\d.]+\s+[\d.]+\s+\d+(px|rem|%)/);
  });
  it('los contenedores de pagina no llevan altura fija: crecen con su contenido', () => {
    for (const sel of ['.rtm-pagina', '.rtm-panel-scroll', '.rtm-vacio', '.rtm-form', '.rtm-bloque', '.rtm-seccion', '.rtm-cargando']) {
      const m = new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\s*\\{[^}]*\\}`).exec(todo);
      if (m) expect(m[0], sel).not.toMatch(/[^-]height:\s*\d+(px|vh|dvh)/);
    }
  });
  it('la unica altura de ventana es la del armazon (100dvh con scroll interno) y el fondo del body', () => {
    const usos = todo.match(/[a-z-]*height:\s*100(d?vh)/g) ?? [];
    // base.css (body), shell.css (armazon de los socios), componentes.css (confirmacion) y omar.css (armazon de la vista de Omar).
    expect(usos.length).toBeLessThanOrEqual(4);
  });
});

describe('responsive', () => {
  it('hay ajustes para el plegable cerrado (<= 380), el telefono (<= 767) y el plegable abierto (768-1100)', () => {
    expect(leer('shell.css')).toMatch(/@media \(max-width: 380px\)/);
    expect(leer('shell.css')).toMatch(/@media \(max-width: 767px\)/);
    expect(leer('shell.css')).toMatch(/@media \(min-width: 768px\) and \(max-width: 1100px\)/);
  });
  it('el pulso se desliza en vez de cortarse y sus chips no se encogen', () => {
    const shell = leer('shell.css');
    expect(shell).toMatch(/\.rtm-pulso \.rtm-chip, \.rtm-pulso-movil \.rtm-chip \{ flex: none; \}/);
    expect(shell).toMatch(/\.rtm-pulso-movil \{[^}]*overflow-x: auto/);
  });
  it('objetivos tactiles de 44 px para chips, campos y botones en pantallas tactiles', () => {
    expect(leer('componentes.css')).toMatch(/@media \(pointer: coarse\) \{[^@]*\.rtm-boton[^@]*min-height: 44px/);
    // El chip llega a 44 px en pantallas tactiles y tambien en anchos de tableta o menos (el pulso movil), donde el puntero puede ser fino.
    expect(leer('shell.css')).toMatch(/@media \(pointer: coarse\)(?:, \(max-width: 1023px\))? \{[^}]*\.rtm-chip \{ height: auto; min-height: 44px; \}/);
  });
  it('los campos de formulario miden 16 px en pantallas angostas (iOS no hace zoom)', () => {
    expect(leer('operacion.css')).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\) \{[^}]*font-size: 16px/);
  });
});
