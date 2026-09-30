// ================================================================
// Gera o GOOGLE_REFRESH_TOKEN para a Gmail API.
//
// Uso:
//   1) Coloque GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e EMAIL_FROM no
//      backend/.env  (o script usa a porta que estiver em PORT, ou 3333)
//   2) node gerar-refresh-token.js
//   3) Abra a URL que aparecer, aprove o acesso, e o script imprime o
//      REFRESH_TOKEN já pronto para colar no .env.
//
// O passo do "code" do Google é o que exige o script abrir um servidor
// local (redirect de loopback). É o jeito suportado hoje: o antigo
// "oob" foi descontinuado pelo Google.
//
// Só funciona uma vez: o refresh token é de longa duração e precisa ser
// revogado em https://myaccount.google.com/permissions se vazar.
// ================================================================
require('dotenv').config();
const http = require('http');
const { URL } = require('url');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const EMAIL_FROM = process.env.EMAIL_FROM;

// Porta fixa, e NÃO a PORT do .env: essa é a do backend (3000) e as duas
// não podem ficar na mesma máquina ao mesmo tempo. O Google aceita
// loopback em qualquer porta para um cliente do tipo "Desktop app".
const PORTA = 3333;
const SCOPES = 'https://www.googleapis.com/auth/gmail.send';

const faltando = [];
if (!CLIENT_ID) faltando.push('GOOGLE_CLIENT_ID');
if (!CLIENT_SECRET) faltando.push('GOOGLE_CLIENT_SECRET');
if (!EMAIL_FROM) faltando.push('EMAIL_FROM');

if (faltando.length) {
  console.error('\nFaltam estas variáveis no backend/.env: ' + faltando.join(', '));
  console.error('\nRode de dentro da pasta backend:\n  cd backend && node gerar-refresh-token.js\n');
  process.exit(1);
}

const redirectUri = `http://localhost:${PORTA}/oauth2callback`;
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: SCOPES,
  access_type: 'offline',   // <- é isto que faz o Google devolver o refresh token
  prompt: 'consent',        // <- e isto força a devolver mesmo se jáacessou antes
  state: 'opensound'
}).toString();

console.log('\n====================================================');
console.log(' 1) Abra esta URL no navegador e aprove o acesso');
console.log('====================================================\n');
console.log(authUrl);
console.log('\n O navegador vai abrir esta página e falhar (normal):');
console.log('   ' + redirectUri);
console.log(' Isso é esperado. Volte para o terminal.\n');
console.log(' Se a tela abrir sozinha, o passo 1 já valeu.\n');

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404); res.end('caminho errado');
    return;
  }

  const codigo = url.searchParams.get('code');
  const erro = url.searchParams.get('error');

  if (erro || !codigo) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Falhou</h1><p>Você recusou o acesso (ou o Google recusou). Feche e rode de novo.</p>');
    console.error('\n Falhou: ' + (erro || 'sem código na URL'));
    servidor.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Pode fechar esta aba</h1><p>O token saiu no terminal.</p>');

  // Troca o código por um token de longa duração.
  fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  })
    .then(async (r) => {
      const corpo = await r.json();
      if (!corpo.refresh_token) {
        throw new Error(
          'O Google não devolveu refresh_token. É o caso de já ter aprovado antes ' +
          'com as mesmas credenciais: em https://myaccount.google.com/permissions ' +
          'revogue o acesso e rode o script de novo.'
        );
      }
      console.log('\n====================================================');
      console.log(' 2) cole esta linha no backend/.env');
      console.log('====================================================\n');
      console.log('GOOGLE_REFRESH_TOKEN=' + corpo.refresh_token);
      console.log('\n (o refresh token não expira; revogue em');
      console.log('  https://myaccount.google.com/permissions se vazar)\n');
      servidor.close();
      process.exit(0);
    })
    .catch((e) => { console.error('\n Falhou: ' + e.message); servidor.close(); process.exit(1); });
});

servidor.listen(PORTA, () => {
  console.log(' Esperando o Google devolver o código na porta ' + PORTA + '...');
});

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('\n A porta ' + PORTA + ' já está em uso (o script usa 3333 de propósito,');
    console.error(' para não brigar com o backend na ' + process.env.PORT + ').');
    console.error(' Feche o que estiver nela e rode de novo.\n');
  } else {
    console.error('\n Falhou: ' + e.message);
  }
  process.exit(1);
});