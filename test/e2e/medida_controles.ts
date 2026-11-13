// Medicion en el DOM de las barras de controles (filtros, barras de tabla, paginadores y filas de formulario).
// Se evalua dentro de la pagina: no depende de capturas. Dos reglas medibles:
//  1) ningun control se monta sobre otro del mismo contenedor (cajas con interseccion > 1 px en ambos ejes);
//  2) los controles y botones de un mismo renglon miden lo mismo de alto (32 px escritorio, 44 px tactil); los chips y segmentados quedan fuera.
export interface HallazgoControles { contenedor: string; tipo: 'solape' | 'alto' | 'recorte' | 'ancho' | 'fuera'; detalle: string }

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

// Controles RECORTADOS FUERA DE SU CONTENEDOR O DE LA PANTALLA. Cada control (campo, selector, boton, pestana) de las barras debe quedar
// entero dentro del viewport y dentro del ancho visible de cada ancestro que recorta o desplaza en horizontal. Un ancestro que desliza A PROPOSITO
// se declara con data-desliza="ancho maximo" (lleva indicio visible de que hay mas); sin esa marca, lo que sobresale esta oculto sin aviso.
// Ademas la pagina no puede desbordar en horizontal ni el texto de la franja de indicadores quedar truncado con puntos suspensivos.
export const CONTENEDORES_FUERA = `${CONTENEDORES}, .rtm-barra-filtros-v2, .rtm-pestanas, .rtm-pulso, .rtm-pulso-movil`;

export function medirFueraDeContenedor(contenedores: string): HallazgoControles[] {
  const CONTROL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, button, a.rtm-boton, a.rtm-boton-chico, span.rtm-boton, span.rtm-boton-chico, .rtm-pestanas a, .rtm-chip-v2, .rtm-pulso .rtm-chip, .rtm-pulso-movil .rtm-chip';
  const salida: HallazgoControles[] = [];
  const vw = document.documentElement.clientWidth;
  const nombre = (el: Element) => {
    const e = el as HTMLElement;
    const n = e.getAttribute('name') ?? e.getAttribute('aria-label') ?? (e.textContent ?? '').trim().slice(0, 18);
    return `${e.tagName.toLowerCase()}[${n}]`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const vistos = new Set<Element>();
  for (const cont of document.querySelectorAll<HTMLElement>(contenedores)) {
    if (!visible(cont)) continue;
    for (const ctl of cont.querySelectorAll<HTMLElement>(CONTROL)) {
      if (vistos.has(ctl) || !visible(ctl)) continue;
      vistos.add(ctl);
      const r = ctl.getBoundingClientRect();
      // Un ancestro que desliza A PROPOSITO (con indicio) cubre a sus hijos: lo que queda mas alla del borde se alcanza deslizando.
      let desliza = false;
      for (let a = ctl.parentElement; a && a !== document.body; a = a.parentElement) {
        if (a.hasAttribute('data-desliza') && getComputedStyle(a).overflowX !== 'visible' && vw <= Number(a.getAttribute('data-desliza') || 0)) { desliza = true; break; }
      }
      if (desliza) continue;
      if (r.right > vw + 1 || r.left < -1) {
        salida.push({ contenedor: nombre(ctl), tipo: 'fuera', detalle: `fuera de la pantalla: x ${Math.round(r.left)}-${Math.round(r.right)} y el viewport mide ${vw}` });
        continue;
      }
      for (let a = ctl.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (r.left < ar.left - 1 || r.right > ar.right + 1) {
          salida.push({ contenedor: nombre(ctl), tipo: 'fuera', detalle: `recortado por ${a.className.toString().split(/\s+/)[0] || a.tagName.toLowerCase()} (x ${Math.round(ar.left)}-${Math.round(ar.right)}); el control ocupa x ${Math.round(r.left)}-${Math.round(r.right)}` });
          break;
        }
      }
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) salida.push({ contenedor: 'pagina', tipo: 'fuera', detalle: `la pagina desborda en horizontal: ${document.documentElement.scrollWidth} px sobre ${vw}` });
  // Texto truncado con puntos suspensivos en la franja de indicadores o en pildoras/tarjetas moviles: el contenido debe verse completo.
  for (const el of document.querySelectorAll<HTMLElement>('.rtm-kpi-linea *, .rtm-dt-caja[data-tarjeta-movil] .rtm-dt-fila *')) {
    if (!visible(el) || el.children.length > 0 || el.closest('.rtm-dt-cabecera')) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) salida.push({ contenedor: nombre(el), tipo: 'fuera', detalle: `texto truncado: "${(el.textContent ?? '').trim().slice(0, 30)}" necesita ${el.scrollWidth} px y hay ${el.clientWidth} px` });
  }
  // Cifras y botones que se salen de su celda o tarjeta (recortados por overflow:hidden) o cifras partidas en dos renglones.
  for (const caja of document.querySelectorAll<HTMLElement>('.rtm-kpi-celda, .rtm-dt-caja[data-tarjeta-movil] .rtm-dt-fila')) {
    if (!visible(caja) || (caja.classList.contains('rtm-dt-fila') && vw >= 768)) continue;
    const cr = caja.getBoundingClientRect();
    for (const el of caja.querySelectorAll<HTMLElement>('strong, button, a, small, span, .rtm-estado, .rtm-pildora')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (vw < 768 && el.children.length === 0 && (r.right > cr.right + 1 || r.left < cr.left - 1)) salida.push({ contenedor: nombre(el), tipo: 'fuera', detalle: `sale de su tarjeta: x ${Math.round(r.left)}-${Math.round(r.right)} y la tarjeta ocupa ${Math.round(cr.left)}-${Math.round(cr.right)}` });
      // Cada cifra ($1,234.00) se mide por nodo de texto: si sus cajas caen en mas de un renglon, esta partida.
      const camino = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = camino.nextNode(); n; n = camino.nextNode()) {
        const t = (n.textContent ?? '').trim();
        if (!/^[−-]?\$[\d,]+(\.\d+)?$/.test(t)) continue;
        const rango = document.createRange();
        rango.selectNodeContents(n);
        const lineas = new Set([...rango.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / 4))).size;
        if (lineas > 1) salida.push({ contenedor: nombre(el), tipo: 'fuera', detalle: `cifra partida en ${lineas} renglones: ${t}` });
      }
    }
  }
  return salida;
}
