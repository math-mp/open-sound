// URL do backend (única fonte de verdade para todas as páginas).
// Em desenvolvimento (localhost / 127.0.0.1 / arquivo aberto direto) usa o back local.
// Em produção usa a URL do backend no Render: TROQUE a linha abaixo pela sua.
const API_URL = (function () {
  const host = window.location.hostname;
  const ehLocal = host === '' || host === 'localhost' || host === '127.0.0.1';
  return ehLocal ? 'http://localhost:3000' : 'https://SEU-BACKEND.onrender.com';
})();
