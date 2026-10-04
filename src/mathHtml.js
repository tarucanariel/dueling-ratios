/* =========================================================
   Shared by the Practice Test and Ratio Dash's Practice Test questions:
   turns question text into safe HTML with each "3/4" drawn as a stacked
   fraction (styled by .pt-frac in style.css).
   ========================================================= */

export function escapeHtml(text){
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function mathHtml(text){
  return escapeHtml(text).replace(/(\d+)\/(\d+)/g, '<span class="pt-frac"><span>$1</span><span>$2</span></span>');
}
