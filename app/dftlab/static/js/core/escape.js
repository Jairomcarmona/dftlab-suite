// Escape de texto para interpolarlo en HTML de plantilla, tanto en contenido como en atributos delimitados por " o '.
// Sin dependencias ni DOM. Para contenido dinámico, preferir textContent o la API DOM; usar esto solo al construir HTML.
export const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
