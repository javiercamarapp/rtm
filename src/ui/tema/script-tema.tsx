// Script BLOQUEANTE en <head>: fija tema, acento y movimiento antes del primer pintado (sin parpadeo).
// Debe ser JS plano autocontenido: se ejecuta antes de que exista React en el cliente.
const CODIGO = `(function(){try{
var d=document.documentElement,g=function(k){try{return localStorage.getItem(k)}catch(e){return null}};
var t=g('rtm-tema');if(t!=='claro'&&t!=='oscuro'){t=matchMedia('(prefers-color-scheme: dark)').matches?'oscuro':'claro'}
d.dataset.tema=t;
var a=g('rtm-acento');d.dataset.acento=(a==='lila'||a==='neutro')?a:'neutro';
var m=g('rtm-movimiento');if(m!=='full'&&m!=='reduced'&&m!=='off'){m=matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full'}
d.dataset.movimiento=m;
}catch(e){}})();`;

export function ScriptTema() {
  return <script dangerouslySetInnerHTML={{ __html: CODIGO }} />;
}
