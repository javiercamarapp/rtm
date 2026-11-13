// Medicion en el DOM de las barras de controles (filtros, barras de tabla, paginadores y filas de formulario).
// Se evalua dentro de la pagina: no depende de capturas. Dos reglas medibles:
//  1) ningun control se monta sobre otro del mismo contenedor (cajas con interseccion > 1 px en ambos ejes);
//  2) los controles y botones de un mismo renglon miden lo mismo de alto (32 px escritorio, 44 px tactil); los chips y segmentados quedan fuera.
export interface HallazgoControles { contenedor: string; tipo: 'solape' | 'alto' | 'recorte' | 'ancho'; detalle: string }

export const CONTENEDORES = '.rtm-filtros-linea, .rtm-a2-filtros, .a3-filtros-form, .rtm-a1-buscar, .rtm-dt-barra, .rtm-paginador, .rtm-form-fila, .rtm-acciones-fila';

export function medirControles(contenedores: string): HallazgoControles[] {
  const CONTROL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, button, a.rtm-boton, a.rtm-boton-chico, span.rtm-boton, span.rtm-boton-chico';
  const salida: HallazgoControles[] = [];
  const nombre = (el: Element) => {
    const e = el as HTMLElement;
    const n = e.getAttribute('name') ?? e.getAttribute('aria-label') ?? (e.textContent ?? '').trim().slice(0, 18);
    return `${e.tagName.toLowerCase()}${n ? `[${n}]` : ''}`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  for (const cont of document.querySelectorAll<HTMLElement>(contenedores)) {
    if (!visible(cont)) continue;
    const etiqueta = `${cont.className.toString().split(/\s+/)[0]}@${(cont.closest('section,article,[aria-label]')?.getAttribute('aria-label') ?? cont.getAttribute('aria-label') ?? '').slice(0, 30)}`;
    const ctls = [...cont.querySelectorAll<HTMLElement>(CONTROL)].filter(visible).filter((e) => !e.closest('.rtm-chip-v2, .rtm-chip-filtro, .rtm-seg, .rtm-segmentado, [role=tab]'));
    const cajas = ctls.map((e) => ({ e, r: e.getBoundingClientRect() }));
    for (let i = 0; i < cajas.length; i++) {
      for (let j = i + 1; j < cajas.length; j++) {
        const a = cajas[i]!, b = cajas[j]!;
        if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 1 && oy > 1) salida.push({ contenedor: etiqueta, tipo: 'solape', detalle: `${nombre(a.e)} (x ${Math.round(a.r.left)}-${Math.round(a.r.right)}) pisa a ${nombre(b.e)} (x ${Math.round(b.r.left)}-${Math.round(b.r.right)}) por ${Math.round(ox)} px` });
      }
    }
    // Renglones: controles cuyo rango vertical se traslapa en mas de la mitad del menor.
    const renglones: typeof cajas[] = [];
    for (const c of [...cajas].sort((x, y) => x.r.top - y.r.top)) {
      const ren = renglones.find((rg) => rg.some((o) => Math.min(o.r.bottom, c.r.bottom) - Math.max(o.r.top, c.r.top) > Math.min(o.r.height, c.r.height) / 2));
      if (ren) ren.push(c); else renglones.push([c]);
    }
    for (const rg of renglones) {
      // Un textarea no es un control de una linea: su alto propio no cuenta.
      const alturas = rg.filter((c) => c.e.tagName !== 'TEXTAREA').map((c) => ({ n: nombre(c.e), h: Math.round(c.r.height) }));
      const distintos = new Set(alturas.map((a) => a.h));
      if (distintos.size > 1) salida.push({ contenedor: etiqueta, tipo: 'alto', detalle: alturas.map((a) => `${a.n}=${a.h}`).join(', ') });
    }
  }
  return salida;
}

// Recorte de texto dentro de los campos: el valor elegido de un selector y el marcador de un campo vacio deben caber enteros.
// Se mide con el mismo tipo de letra del campo (canvas) contra el ancho interior (sin relleno ni flecha del selector).
export function medirRecortes(): HallazgoControles[] {
  const salida: HallazgoControles[] = [];
  const lienzo = document.createElement('canvas').getContext('2d');
  if (!lienzo) return salida;
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]), select')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
    const texto = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.textContent?.trim() ?? '') : (el.value || el.placeholder || '');
    if (!texto) continue;
    const cs = getComputedStyle(el);
    lienzo.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const interior = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    const necesario = lienzo.measureText(texto).width;
    if (necesario > interior + 0.5) {
      const nombre = el.getAttribute('name') ?? el.getAttribute('aria-label') ?? el.id ?? '';
      salida.push({ contenedor: `${el.tagName.toLowerCase()}[${nombre}]`, tipo: 'recorte', detalle: ` "${texto.slice(0, 40)}" necesita ${Math.ceil(necesario)} px y el campo ofrece ${Math.floor(interior)} px (ancho ${Math.round(r.width)})` });
    }
    if (r.width > 760 && el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'search') salida.push({ contenedor: `input[${el.getAttribute('name') ?? ''}]`, tipo: 'ancho', detalle: `ancho desmedido: ${Math.round(r.width)} px` });
  }
  return salida;
}
