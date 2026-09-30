// ============================================================
// TEMA CLARO / ESCURO (salvo no localStorage e sincronizado com backend)
// ============================================================
const btnTema = document.getElementById('btn-tema');
const API_BASE = 'http://localhost:3000';
const CHAVE_SESSAO = 'tokenSessao';

// O sessao.js entra sem `defer` no <head> e define window.OS. Se ele
// não vier (404, cache velho, aberto direto do disco), esta versão sem
// cache evita que o arquivo inteiro abafe aqui e leve junto os modais,
// o upload, os favoritos e a criação de playlist.
if (!window.OS) {
  window.OS = {
    IDADE_MAXIMA_CACHE: 0,
    perfilCacheado: () => null,
    revalidar: () => Promise.resolve(null),
    aoEntrar: () => Promise.resolve(null),
    aoTrocarAvatar: () => {},
    invalidar: () => {},
    limparCache: () => {},
    pintarTodos: () => {},
    aplicarTema: (tema) => {
      if (tema === 'light') document.documentElement.dataset.theme = 'light';
      else delete document.documentElement.dataset.theme;
    }
  };
}

function obterTokenSessao() {
  return localStorage.getItem(CHAVE_SESSAO);
}

function estaLogado() {
  return !!obterTokenSessao();
}

// Token rejeitado, logout em outra aba ou revalidação que tomou 401:
// em todos esses casos a navbar precisa voltar ao estado de visitante
// no mesmo instante. Passar por aqui (e não só pela classe `hidden`)
// é o que mantém o atributo data-sessao do <html> em sincronia.
function encerrarSessaoLocal() {
  localStorage.removeItem(CHAVE_SESSAO);
  if (window.OS) OS.limparCache();
  atualizarUIAutenticacao();
}

document.addEventListener('opensound:sessao-invalida', encerrarSessaoLocal);

async function fetchComAutenticacao(url, opcoes = {}) {
  const token = obterTokenSessao();
  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };

  const resposta = await fetch(url, { ...opcoes, headers });

  if (resposta.status === 401) {
    encerrarSessaoLocal();
    alert('Sua sessão expirou. Faça login novamente.');
  }

  return resposta;
}

function aplicarTema(tema) {
  // Quem decide as cores é o theme.css; o atributo no <html> e o
  // localStorage são centralizados no sessao.js (que já aplicou o
  // tema salvo antes do primeiro paint, no <head>).
  OS.aplicarTema(tema);
  if (btnTema) btnTema.textContent = tema === 'light' ? '🌙' : '☀️';
}

// O botão da navbar acompanha o tema de qualquer origem (clique aqui,
// troca em outra aba ou revalidação do perfil) sem duplicar regra.
document.addEventListener('opensound:tema', (evento) => {
  if (btnTema && evento.detail) btnTema.textContent = evento.detail.tema === 'light' ? '🌙' : '☀️';
});

async function salvarTemaNoBackend(tema) {
  if (!estaLogado()) return;
  try {
    await fetchComAutenticacao(`${API_BASE}/api/perfil/tema`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tema })
    });
  } catch (erro) {
    console.error('Erro ao salvar tema no backend:', erro);
  }
}

if (btnTema) {
  btnTema.addEventListener('click', async () => {
    const novoTema = temaAtual() === 'light' ? 'dark' : 'light';
    aplicarTema(novoTema);
    await salvarTemaNoBackend(novoTema);
  });
}

function temaAtual() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// === ELEMENTOS DO DOM ===
const modal = document.getElementById('modal-registro');
const btnFechar = document.getElementById('btn-fechar');
const formRegistro = document.getElementById('form-registro');
const etapaRegistro = document.getElementById('etapa-registro');
const etapa2fa = document.getElementById('etapa-2fa');
const btnRegister = document.getElementById('btn-register');
const btnSubmitRegistro = formRegistro ? formRegistro.querySelector('button[type="submit"]') : null;

const inputSenha = document.getElementById('input-senha');
const btnToggleSenha = document.getElementById('btn-toggle-senha');

// === CONTADOR DO NOME DE USUÁRIO ===

const campoNomeUsuarioCadastro = document.getElementById('registro-nome-usuario');
const contadorUsuario = document.querySelector('.contador-usuario');

if (campoNomeUsuarioCadastro && contadorUsuario) {
  const atualizarContadorUsuario = () => {
    contadorUsuario.textContent =
      `${campoNomeUsuarioCadastro.value.length} / 28`;
  };

  campoNomeUsuarioCadastro.addEventListener(
    'input',
    atualizarContadorUsuario
  );

  atualizarContadorUsuario();
}

// Elementos das Regras de Senha
const regraTam = document.getElementById('regra-tam');
const regraMai = document.getElementById('regra-mai');
const regraMin = document.getElementById('regra-min');
const regraNum = document.getElementById('regra-num');
const regraEsp = document.getElementById('regra-esp');

// Elementos da Etapa 2FA (Grade OTP e Máscara)
const btnConfirmar2FA = document.getElementById('btn-confirmar-2fa');
const btnReenviar2FA = document.getElementById('btn-reenviar-2fa');
const mensagemTimer = document.getElementById('mensagem-timer');
const inputsOTP = document.querySelectorAll('.input-otp');
const spanEmailMascarado = document.getElementById('email-mascarado');

// Elementos do Modal/Etapa de Login
const modalLogin = document.getElementById('modal-login');
const btnFecharLogin = document.getElementById('btn-fechar-login');
const formLogin = document.getElementById('form-login');
const btnEntrar = document.getElementById('btn-entrar');
const btnSair = document.getElementById('btn-sair');
const btnPerfilAvatar = document.getElementById('btn-perfil-avatar');
const linkSairDropdown = document.getElementById('link-sair-dropdown');

// Elementos do Modal de Upload e do Container Universal de Músicas
const modalUpload = document.getElementById('modal-upload');
const btnFecharUpload = document.getElementById('btn-fechar-upload');
const formUpload = document.getElementById('form-upload');
const btnUpload = document.getElementById('btn-upload');
const listaMusicas = document.getElementById('lista-musicas');
const listaArtistas = document.getElementById('lista-artistas');
// Declarado aqui, e não junto das funções da seção: carregarDescobrirMusicas()
// roda na carga inicial (mais abaixo) e um const declarado depois ficaria
// inacessível — "Cannot access before initialization".
const listaDescobrir = document.getElementById('lista-descobrir');

// Elementos do Modal de Cadastro de Artista
const modalArtista = document.getElementById('modal-artista');
const btnFecharArtista = document.getElementById('btn-fechar-artista');
const formArtista = document.getElementById('form-artista');

// Regex de Validação
const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/;

let emailUsuarioAtual = '';
let tempoRestante = 60;
let intervaloTimer = null;
let idVerificacaoAtual = '';

// === FUNÇÃO PARA MASCARAR E-MAIL ===
function mascararEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [usuario, dominio] = email.split('@');
  if (usuario.length <= 2) {
    return `${usuario[0]}***@${dominio}`;
  }
  return `${usuario.slice(0, 2)}***${usuario.slice(-1)}@${dominio}`;
}

// === CONTROLE E NAVEGAÇÃO DOS INPUTS OTP (6 DÍGITOS) ===
inputsOTP.forEach((input, index) => {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value && index < inputsOTP.length - 1) {
      inputsOTP[index + 1].focus();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      inputsOTP[index - 1].focus();
    }
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const dadosColados = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    if (dadosColados) {
      dadosColados.split('').forEach((char, i) => {
        if (inputsOTP[i]) inputsOTP[i].value = char;
      });
      const proximoVazio = Array.from(inputsOTP).find(inp => !inp.value);
      if (proximoVazio) {
        proximoVazio.focus();
      } else if (inputsOTP.length > 0) {
        inputsOTP[inputsOTP.length - 1].focus();
      }
    }
  });
});

// === MENU HAMBURGUER ===
const btnHamburguer = document.getElementById('btn-hamburguer');
const dropdownHamburguer = document.getElementById('dropdown-hamburguer');

if (btnHamburguer && dropdownHamburguer) {
  btnHamburguer.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownHamburguer.classList.toggle('hidden');
  });

  // Fecha o dropdown se o usuário clicar em qualquer outro lugar da página.
  document.addEventListener('click', (e) => {
    if (!dropdownHamburguer.classList.contains('hidden') && !dropdownHamburguer.contains(e.target)) {
      dropdownHamburguer.classList.add('hidden');
    }
  });
}

// === CONTROLE DO MODAL ===
if (btnRegister && modal) {
  btnRegister.addEventListener('click', () => modal.classList.remove('hidden'));
}

if (btnFechar && modal) {
  btnFechar.addEventListener('click', () => modal.classList.add('hidden'));
}

// === MOSTRAR / OCULTAR SENHA ===
if (btnToggleSenha && inputSenha) {
  btnToggleSenha.addEventListener('click', () => {
    const tipoAtual = inputSenha.getAttribute('type');
    if (tipoAtual === 'password') {
      inputSenha.setAttribute('type', 'text');
      btnToggleSenha.textContent = '👁️';
    } else {
      inputSenha.setAttribute('type', 'password');
      btnToggleSenha.textContent = '👁️';
    }
  });
}

// === LISTA DE REQUISITOS EM TEMPO REAL ===
function atualizarRegra(elemento, estaValido, texto) {
  if (!elemento) return;
  if (estaValido) {
    elemento.classList.add('valido');
    elemento.textContent = `✔ ${texto}`;
  } else {
    elemento.classList.remove('valido');
    elemento.textContent = `❌ ${texto}`;
  }
}

if (inputSenha) {
  inputSenha.addEventListener('input', () => {
    const valor = inputSenha.value || '';
    atualizarRegra(regraTam, valor.length >= 8, 'Mínimo de 8 caracteres');
    atualizarRegra(regraMai, /[A-Z]/.test(valor), 'Ao menos 1 letra maiúscula');
    atualizarRegra(regraMin, /[a-z]/.test(valor), 'Ao menos 1 letra minúscula');
    atualizarRegra(regraNum, /[0-9]/.test(valor), 'Ao menos 1 número');
    atualizarRegra(regraEsp, /[@()!%*?&#]/.test(valor), 'Ao menos 1 caractere especial (@$!%*?&#)');
  });
}

// === SUBMIT DO REGISTRO ===
if (formRegistro) {
  formRegistro.addEventListener('submit', async (event) => {
    event.preventDefault();

      const aceiteTermos = formRegistro.querySelector(
      '.aceite-termos input[type="checkbox"]'
      );

    if (!aceiteTermos || !aceiteTermos.checked) {
      aceiteTermos?.focus();
      alert('Você precisa aceitar os Termos de Uso para criar sua conta.');
      return;
    }

    if (btnSubmitRegistro && btnSubmitRegistro.disabled) return;

    const campoNomeUsuario = document.getElementById('registro-nome-usuario');
    const campoEmail = formRegistro.querySelector('input[type="email"]');
    const campoSenha = document.getElementById('input-senha');

    const nomeUsuario = campoNomeUsuario ? campoNomeUsuario.value.trim() : '';
    const email = campoEmail ? campoEmail.value.trim() : '';
    const password = campoSenha ? campoSenha.value.trim() : '';

    if (!nomeUsuario) {
      alert('Digite um nome de usuário.');
      return;
    }

    if (!regexEmail.test(email)) {
      alert('Insira um formato de e-mail válido (exemplo: usuario@email.com).');
      return;
    }

    if (!regexSenha.test(password)) {
      alert('A senha precisa ter no mínimo 8 caracteres, com pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo especial (@$!%*?&#).');
      return;
    }

    if (btnSubmitRegistro) {
      btnSubmitRegistro.disabled = true;
      btnSubmitRegistro.textContent = 'Enviando...';
    }

    try {
      const resposta = await fetch('http://localhost:3000/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, nomeUsuario })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        emailUsuarioAtual = email;
        idVerificacaoAtual = dados.idVerificacao;

        if (spanEmailMascarado) spanEmailMascarado.textContent = mascararEmail(email);
        if (etapaRegistro) etapaRegistro.classList.add('hidden');
        if (etapa2fa) etapa2fa.classList.remove('hidden');

        inputsOTP.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTP[0]?.focus(), 100);

        iniciarTimer2FA();
      } else {
        if (dados.codigo === 'EMAIL_JA_CADASTRADO') {
          alert(dados.mensagem);
          if (modal) modal.classList.add('hidden');
          if (modalLogin) {
            modalLogin.classList.remove('hidden');
            const campoLoginEmail = document.getElementById('login-email');
            if (campoLoginEmail) campoLoginEmail.value = email;
          }
        } else {
          alert(dados.mensagem || 'Erro ao processar o registro.');
        }
      }

    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitRegistro) {
        btnSubmitRegistro.disabled = false;
        btnSubmitRegistro.textContent = 'Enviar';
      }
    }
  });
}

// === VALIDAÇÃO DO 2FA ===
if (btnConfirmar2FA) {
  btnConfirmar2FA.addEventListener('click', async () => {
    let codigoDigitado = '';
    inputsOTP.forEach(inp => codigoDigitado += inp.value.trim());

    if (codigoDigitado.length < 6) {
      alert('Por favor, digite os 6 dígitos do código.');
      return;
    }

    try {
      const resposta = await fetch('http://localhost:3000/api/validar-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigoDigitado,
          idVerificacao: idVerificacaoAtual
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Conta validada com sucesso!');
        if (modal) modal.classList.add('hidden');
        if (formRegistro) formRegistro.reset();

        inputsOTP.forEach(inp => inp.value = '');

        if (etapa2fa) etapa2fa.classList.add('hidden');
        if (etapaRegistro) etapaRegistro.classList.remove('hidden');
        if (intervaloTimer) clearInterval(intervaloTimer);
      } else {
        alert(dados.mensagem || 'Código incorreto ou expirado.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Não foi possível conectar ao servidor.');
    }
  });
}

// === TIMER E REENVIO DO 2FA ===
function iniciarTimer2FA() {
  tempoRestante = 60;
  if (btnReenviar2FA) btnReenviar2FA.disabled = true;
  if (mensagemTimer) mensagemTimer.textContent = `Aguarde ${tempoRestante}s para solicitar um novo código.`;

  if (intervaloTimer) clearInterval(intervaloTimer);

  intervaloTimer = setInterval(() => {
    tempoRestante--;

    if (tempoRestante <= 0) {
      clearInterval(intervaloTimer);
      if (btnReenviar2FA) btnReenviar2FA.disabled = false;
      if (mensagemTimer) mensagemTimer.textContent = '';
    } else {
      if (mensagemTimer) mensagemTimer.textContent = `Aguarde ${tempoRestante}s para solicitar um novo código.`;
    }
  }, 1000);
}

if (btnReenviar2FA) {
  btnReenviar2FA.addEventListener('click', async () => {
    if (tempoRestante > 0) return;

    btnReenviar2FA.disabled = true;
    if (mensagemTimer) mensagemTimer.textContent = 'Enviando novo código...';

    try {
      const resposta = await fetch('http://localhost:3000/api/reenviar-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idVerificacao: idVerificacaoAtual })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        inputsOTP.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTP[0]?.focus(), 100);

        iniciarTimer2FA();
      } else {
        btnReenviar2FA.disabled = false;
        if (mensagemTimer) mensagemTimer.textContent = dados.mensagem;
      }
    } catch (erro) {
      btnReenviar2FA.disabled = false;
      if (mensagemTimer) mensagemTimer.textContent = 'Erro ao conectar ao servidor.';
    }
  });
}

// ============================================================
// LOGIN / SESSÃO
// ============================================================

function atualizarUIAutenticacao() {
  const logado = estaLogado();

  if (btnEntrar) btnEntrar.classList.toggle('hidden', logado);
  if (btnRegister) btnRegister.classList.toggle('hidden', logado);
  if (btnPerfilAvatar) btnPerfilAvatar.classList.toggle('hidden', !logado);
  if (linkSairDropdown) linkSairDropdown.classList.toggle('hidden', !logado);
}

if (btnEntrar && modalLogin) {
  btnEntrar.addEventListener('click', () => modalLogin.classList.remove('hidden'));
}

if (btnFecharLogin && modalLogin) {
  btnFecharLogin.addEventListener('click', () => modalLogin.classList.add('hidden'));
}

if (formLogin) {
  formLogin.addEventListener('submit', async (event) => {
    event.preventDefault();

    const campoEmail = document.getElementById('login-email');
    const campoSenha = document.getElementById('login-senha');
    const campoLembrar = document.getElementById('login-lembrar');

    const email = campoEmail ? campoEmail.value.trim() : '';
    const password = campoSenha ? campoSenha.value.trim() : '';
    const lembrarDeMim = campoLembrar ? campoLembrar.checked : false;

    const btnSubmitLogin = formLogin.querySelector('button[type="submit"]');
    if (btnSubmitLogin) {
      btnSubmitLogin.disabled = true;
      btnSubmitLogin.textContent = 'Entrando...';
    }

    try {
      const resposta = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, lembrarDeMim })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        localStorage.setItem(CHAVE_SESSAO, dados.tokenSessao);
        atualizarUIAutenticacao();

        carregarFavoritos();
        // Traz tema/avatar/nome do banco em UM request só. O que já
        // estava em cache (pintado antes do paint) aparece na hora.
        OS.aoEntrar();

        if (modalLogin) modalLogin.classList.add('hidden');
        formLogin.reset();
      } else {
        if (dados.codigo === 'EMAIL_NAO_CADASTRADO') {
          alert(dados.mensagem);
          if (modalLogin) modalLogin.classList.add('hidden');
          if (modal) {
            modal.classList.remove('hidden');
            if (etapaRegistro) etapaRegistro.classList.remove('hidden');
            if (etapa2fa) etapa2fa.classList.add('hidden');
            const campoRegistroEmail = formRegistro ? formRegistro.querySelector('input[type="email"]') : null;
            if (campoRegistroEmail) campoRegistroEmail.value = email;
          }
        } else {
          alert(dados.mensagem || 'Não foi possível fazer login.');
        }
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitLogin) {
        btnSubmitLogin.disabled = false;
        btnSubmitLogin.textContent = 'Entrar';
      }
    }
  });
}

if (btnSair) {
  btnSair.addEventListener('click', () => {
    const confirmou = confirm('Você realmente deseja deslogar da sua conta?');
    if (!confirmou) return;

    localStorage.removeItem(CHAVE_SESSAO);
    OS.limparCache();
    atualizarUIAutenticacao();
    limparFavoritosLocais();
    alert('Você foi deslogado.');
  });
}

if (linkSairDropdown) {
  linkSairDropdown.addEventListener('click', (e) => {
    e.preventDefault();
    const confirmou = confirm('Você realmente deseja deslogar da sua conta?');
    if (!confirmou) return;

    localStorage.removeItem(CHAVE_SESSAO);
    OS.limparCache();
    atualizarUIAutenticacao();
    limparFavoritosLocais();
    alert('Você foi deslogado.');
  });
}

if (btnPerfilAvatar) {
  btnPerfilAvatar.addEventListener('click', () => {
    window.location.href = 'perfil.html';
  });
}

// Estado inicial da navbar ao carregar a página. Avatar, nome e tema
// já foram pintados pelo sessao.js antes do paint; aqui só validamos
// com o servidor (um único GET /api/perfil, compartilhado).
atualizarUIAutenticacao();
if (estaLogado()) OS.revalidar();

// ============================================================
// AVATAR / NOME / TEMA DA NAVBAR
// ============================================================
// Não busca mais nada aqui: quem resolve é o sessao.js, que pinta o
// avatar e o nome a partir do cache local (antes do paint) e revalida
// em segundo plano. O que sobrou da implementação antiga
// (carregarAvatarPerfil / carregarTemaDoBackend) foram removidos
// porque disparavam um GET /api/perfil duplicado a cada carregamento.

// ============================================================
// MODAL DE LOGIN — MELHORIAS (olho, links, toggle modais)
// ============================================================

// Elementos do modal de login
const btnToggleLoginSenha = document.getElementById('btn-toggle-login-senha');
const inputLoginSenha = document.getElementById('login-senha');
const linkEsqueciSenha = document.getElementById('link-esqueci-senha');
const linkIrRegistro = document.getElementById('link-ir-registro');

// Elementos do modal "esqueci minha senha"
const modalEsqueciSenha = document.getElementById('modal-esqueci-senha');
const btnFecharEsqueci = document.getElementById('btn-fechar-esqueci');
const formEsqueciSenha = document.getElementById('form-esqueci-senha');
const etapaEsqueci = document.getElementById('etapa-esqueci');
const etapaEsqueci2fa = document.getElementById('etapa-esqueci-2fa');
const etapaEsqueciNovaSenha = document.getElementById('etapa-esqueci-nova-senha');
const esqueciEmailMascarado = document.getElementById('esqueci-email-mascarado');
const inputsOTPEsqueci = document.querySelectorAll('#modal-esqueci-senha .input-otp');
const btnConfirmarEsqueci = document.getElementById('btn-confirmar-esqueci');
const btnReenviarEsqueci = document.getElementById('btn-reenviar-esqueci');
const esqueciMensagemTimer = document.getElementById('esqueci-mensagem-timer');
const formEsqueciNovaSenha = document.getElementById('form-esqueci-nova-senha');
const esqueciNovaSenha = document.getElementById('esqueci-nova-senha');
const esqueciConfirmaSenha = document.getElementById('esqueci-confirma-senha');
const btnToggleEsqueciSenha = document.getElementById('btn-toggle-esqueci-senha');
const btnToggleEsqueciConfirma = document.getElementById('btn-toggle-esqueci-confirma');

// Regras de senha — etapa nova senha
const esqueciRegraTam = document.getElementById('esqueci-regra-tam');
const esqueciRegraMai = document.getElementById('esqueci-regra-mai');
const esqueciRegraMin = document.getElementById('esqueci-regra-min');
const esqueciRegraNum = document.getElementById('esqueci-regra-num');
const esqueciRegraEsp = document.getElementById('esqueci-regra-esp');

// Links de voltar
const linkVoltarLogin = document.getElementById('link-voltar-login');
const linkVoltarLogin2 = document.getElementById('link-voltar-login-2');
const linkVoltarLogin3 = document.getElementById('link-voltar-login-3');

// Estado do fluxo esqueci senha
let esqueciEmailAtual = '';
let esqueciTempoRestante = 60;
let esqueciIntervaloTimer = null;
let esqueciIdVerificacao = '';

// === OLHO NA SENHA — LOGIN ===
if (btnToggleLoginSenha && inputLoginSenha) {
  btnToggleLoginSenha.addEventListener('click', () => {
    const tipoAtual = inputLoginSenha.getAttribute('type');
    if (tipoAtual === 'password') {
      inputLoginSenha.setAttribute('type', 'text');
    } else {
      inputLoginSenha.setAttribute('type', 'password');
    }
  });
}

// === LINK "ESQUECI MINHA SENHA" — ABRE MODAL ESQUECI, FECHA LOGIN ===
if (linkEsqueciSenha) {
  linkEsqueciSenha.addEventListener('click', (e) => {
    e.preventDefault();
    if (modalLogin) modalLogin.classList.add('hidden');
    if (modalEsqueciSenha) {
      modalEsqueciSenha.classList.remove('hidden');
      resetarFluxoEsqueci();
    }
  });
}

// === LINK "CADASTRE-SE" — ABRE MODAL REGISTRO, FECHA LOGIN ===
if (linkIrRegistro) {
  linkIrRegistro.addEventListener('click', (e) => {
    e.preventDefault();
    if (modalLogin) modalLogin.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
    if (etapaRegistro) etapaRegistro.classList.remove('hidden');
    if (etapa2fa) etapa2fa.classList.add('hidden');
  });
}

// === LINKS VOLTAR PARA LOGIN ===
function voltarParaLogin() {
  if (modalEsqueciSenha) modalEsqueciSenha.classList.add('hidden');
  if (modalLogin) modalLogin.classList.remove('hidden');
  resetarFluxoEsqueci();
}

if (linkVoltarLogin) linkVoltarLogin.addEventListener('click', (e) => { e.preventDefault(); voltarParaLogin(); });
if (linkVoltarLogin2) linkVoltarLogin2.addEventListener('click', (e) => { e.preventDefault(); voltarParaLogin(); });
if (linkVoltarLogin3) linkVoltarLogin3.addEventListener('click', (e) => { e.preventDefault(); voltarParaLogin(); });

// === FECHAR MODAL ESQUECI ===
if (btnFecharEsqueci && modalEsqueciSenha) {
  btnFecharEsqueci.addEventListener('click', () => {
    modalEsqueciSenha.classList.add('hidden');
    resetarFluxoEsqueci();
  });
}

// === RESETAR FLUXO ESQUECI SENHA ===
function resetarFluxoEsqueci() {
  if (etapaEsqueci) etapaEsqueci.classList.remove('hidden');
  if (etapaEsqueci2fa) etapaEsqueci2fa.classList.add('hidden');
  if (etapaEsqueciNovaSenha) etapaEsqueciNovaSenha.classList.add('hidden');
  if (formEsqueciSenha) formEsqueciSenha.reset();
  if (formEsqueciNovaSenha) formEsqueciNovaSenha.reset();
  inputsOTPEsqueci.forEach(inp => inp.value = '');
  if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = '';
  if (btnReenviarEsqueci) btnReenviarEsqueci.disabled = true;
  if (esqueciIntervaloTimer) clearInterval(esqueciIntervaloTimer);
  esqueciEmailAtual = '';
  esqueciIdVerificacao = '';
}

// === NAVEGAÇÃO OTP — ESQUECI SENHA ===
inputsOTPEsqueci.forEach((input, index) => {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value && index < inputsOTPEsqueci.length - 1) {
      inputsOTPEsqueci[index + 1].focus();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      inputsOTPEsqueci[index - 1].focus();
    }
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const dadosColados = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    if (dadosColados) {
      dadosColados.split('').forEach((char, i) => {
        if (inputsOTPEsqueci[i]) inputsOTPEsqueci[i].value = char;
      });
      const proximoVazio = Array.from(inputsOTPEsqueci).find(inp => !inp.value);
      if (proximoVazio) proximoVazio.focus();
      else if (inputsOTPEsqueci.length > 0) inputsOTPEsqueci[inputsOTPEsqueci.length - 1].focus();
    }
  });
});

// === REGRAS DE SENHA TEMPO REAL — ETAPA NOVA SENHA ===
function atualizarRegraEsqueci(elemento, estaValido, texto) {
  if (!elemento) return;
  if (estaValido) {
    elemento.classList.add('valido');
    elemento.textContent = `✔ ${texto}`;
  } else {
    elemento.classList.remove('valido');
    elemento.textContent = `❌ ${texto}`;
  }
}

if (esqueciNovaSenha) {
  esqueciNovaSenha.addEventListener('input', () => {
    const valor = esqueciNovaSenha.value || '';
    atualizarRegraEsqueci(esqueciRegraTam, valor.length >= 8, 'Mínimo de 8 caracteres');
    atualizarRegraEsqueci(esqueciRegraMai, /[A-Z]/.test(valor), 'Ao menos 1 letra maiúscula');
    atualizarRegraEsqueci(esqueciRegraMin, /[a-z]/.test(valor), 'Ao menos 1 letra minúscula');
    atualizarRegraEsqueci(esqueciRegraNum, /[0-9]/.test(valor), 'Ao menos 1 número');
    atualizarRegraEsqueci(esqueciRegraEsp, /[@()!%*?&#]/.test(valor), 'Ao menos 1 caractere especial (@$!%*?&#)');
  });
}

// === OLHO NA SENHA — ESQUECI SENHA (nova senha e confirma) ===
function configurarOlhoSenha(btnToggle, inputSenha) {
  if (btnToggle && inputSenha) {
    btnToggle.addEventListener('click', () => {
      const tipoAtual = inputSenha.getAttribute('type');
      if (tipoAtual === 'password') {
        inputSenha.setAttribute('type', 'text');
      } else {
        inputSenha.setAttribute('type', 'password');
      }
    });
  }
}

configurarOlhoSenha(btnToggleEsqueciSenha, esqueciNovaSenha);
configurarOlhoSenha(btnToggleEsqueciConfirma, esqueciConfirmaSenha);

// === ETAPA 1: SOLICITAR CÓDIGO (EMAIL) ===
if (formEsqueciSenha) {
  formEsqueciSenha.addEventListener('submit', async (event) => {
    event.preventDefault();

    const campoEmail = document.getElementById('esqueci-email');
    const email = campoEmail ? campoEmail.value.trim() : '';

    if (!regexEmail.test(email)) {
      alert('Insira um e-mail válido.');
      return;
    }

    const btnSubmit = formEsqueciSenha.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Enviando...';
    }

    try {
      // TODO: Endpoint não existe ainda no backend — implementar POST /api/auth/esqueci-senha
      const resposta = await fetch('http://localhost:3000/api/auth/esqueci-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        esqueciEmailAtual = email;
        esqueciIdVerificacao = dados.idVerificacao;

        if (esqueciEmailMascarado) esqueciEmailMascarado.textContent = mascararEmail(email);
        if (etapaEsqueci) etapaEsqueci.classList.add('hidden');
        if (etapaEsqueci2fa) etapaEsqueci2fa.classList.remove('hidden');

        inputsOTPEsqueci.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTPEsqueci[0]?.focus(), 100);

        iniciarTimerEsqueci();
      } else {
        alert(dados.mensagem || 'Não foi possível enviar o código.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      const btnSubmit = formEsqueciSenha.querySelector('button[type="submit"]');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Enviar código';
      }
    }
  });
}

// === TIMER REENVIO — ESQUECI SENHA ===
function iniciarTimerEsqueci() {
  esqueciTempoRestante = 60;
  if (btnReenviarEsqueci) btnReenviarEsqueci.disabled = true;
  if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = `Aguarde ${esqueciTempoRestante}s para solicitar um novo código.`;

  if (esqueciIntervaloTimer) clearInterval(esqueciIntervaloTimer);

  esqueciIntervaloTimer = setInterval(() => {
    esqueciTempoRestante--;

    if (esqueciTempoRestante <= 0) {
      clearInterval(esqueciIntervaloTimer);
      if (btnReenviarEsqueci) btnReenviarEsqueci.disabled = false;
      if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = '';
    } else {
      if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = `Aguarde ${esqueciTempoRestante}s para solicitar um novo código.`;
    }
  }, 1000);
}

// === REENVIAR CÓDIGO — ESQUECI SENHA ===
if (btnReenviarEsqueci) {
  btnReenviarEsqueci.addEventListener('click', async () => {
    if (esqueciTempoRestante > 0) return;

    btnReenviarEsqueci.disabled = true;
    if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = 'Enviando novo código...';

    try {
      // TODO: Endpoint não existe ainda — implementar POST /api/auth/reenviar-esqueci
      const resposta = await fetch('http://localhost:3000/api/auth/reenviar-esqueci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idVerificacao: esqueciIdVerificacao })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        inputsOTPEsqueci.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTPEsqueci[0]?.focus(), 100);
        iniciarTimerEsqueci();
      } else {
        btnReenviarEsqueci.disabled = false;
        if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = dados.mensagem;
      }
    } catch (erro) {
      btnReenviarEsqueci.disabled = false;
      if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = 'Erro ao conectar ao servidor.';
    }
  });
}

// === ETAPA 2: CONFIRMAR CÓDIGO 2FA ===
if (btnConfirmarEsqueci) {
  btnConfirmarEsqueci.addEventListener('click', async () => {
    let codigoDigitado = '';
    inputsOTPEsqueci.forEach(inp => codigoDigitado += inp.value.trim());

    if (codigoDigitado.length < 6) {
      alert('Por favor, digite os 6 dígitos do código.');
      return;
    }

    try {
      // TODO: Endpoint não existe ainda — implementar POST /api/auth/validar-esqueci
      const resposta = await fetch('http://localhost:3000/api/auth/validar-esqueci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigoDigitado, idVerificacao: esqueciIdVerificacao })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        if (etapaEsqueci2fa) etapaEsqueci2fa.classList.add('hidden');
        if (etapaEsqueciNovaSenha) etapaEsqueciNovaSenha.classList.remove('hidden');
        if (esqueciIntervaloTimer) clearInterval(esqueciIntervaloTimer);
      } else {
        alert(dados.mensagem || 'Código incorreto ou expirado.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Não foi possível conectar ao servidor.');
    }
  });
}

// === ETAPA 3: NOVA SENHA ===
if (formEsqueciNovaSenha) {
  formEsqueciNovaSenha.addEventListener('submit', async (event) => {
    event.preventDefault();

    const novaSenha = esqueciNovaSenha ? esqueciNovaSenha.value.trim() : '';
    const confirmaSenha = esqueciConfirmaSenha ? esqueciConfirmaSenha.value.trim() : '';

    if (novaSenha !== confirmaSenha) {
      alert('As senhas não conferem.');
      return;
    }

    if (!regexSenha.test(novaSenha)) {
      alert('A senha precisa ter no mínimo 8 caracteres, com pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo especial (@$!%*?&#).');
      return;
    }

    const btnSubmit = formEsqueciNovaSenha.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Salvando...';
    }

    try {
      // TODO: Endpoint não existe ainda — implementar POST /api/auth/confirmar-esqueci
      const resposta = await fetch('http://localhost:3000/api/auth/confirmar-esqueci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novaSenha, idVerificacao: esqueciIdVerificacao })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Senha alterada com sucesso! Faça login com a nova senha.');
        if (modalEsqueciSenha) modalEsqueciSenha.classList.add('hidden');
        if (modalLogin) modalLogin.classList.remove('hidden');
        resetarFluxoEsqueci();
      } else {
        alert(dados.mensagem || 'Não foi possível alterar a senha.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      const btnSubmit = formEsqueciNovaSenha.querySelector('button[type="submit"]');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Salvar nova senha';
      }
    }
  });
}

// ============================================================
// CONTAINER UNIVERSAL DE MÚSICAS (carregar + renderizar cards)
// ============================================================

function formatarReproducoes(quantidade) {
  const numero = Number(quantidade);
  if (!Number.isFinite(numero)) return '0 reproduções';
  return `${numero} ${numero === 1 ? 'reprodução' : 'reproduções'}`;
}

// ============================================================
// FAVORITOS + ADICIONAR À PLAYLIST
// ============================================================
// Moraram aqui até os botões da barra do player (o coração e o "＋")
// existirem só na home. Agora ficam no favoritos.js, que todas as
// páginas carregam: pintarCoracao(), atualizarTodosCoracoes(),
// alternarFavorito(), abrirModalAddPlaylist(), criarBotaoIcone(),
// carregarFavoritos() e limparFavoritosLocais() vêm de lá.

// --- Botão "Minha Biblioteca" da navbar (a página chega na Parte 4) ---
const btnBiblioteca = document.getElementById('btn-biblioteca');
if (btnBiblioteca) {
  btnBiblioteca.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para acessar sua biblioteca.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    window.location.href = 'biblioteca.html';
  });
}

// Elementos da busca + do título da seção de músicas. Declarados aqui
// (antes do carrossel) porque carregarMusicas()/carregarMusicasMaisTocadas()
// já mexem no título, e um const declarado depois ficaria inacessível
// ("Cannot access before initialization") quando elas rodam.
const formBusca = document.querySelector('.nav-center form');
const campoBusca = formBusca ? formBusca.querySelector('input[name="q"]') : null;
const tituloSecaoMusicas = document.querySelector('.secao-titulo.aba-musicas');

// ============================================================
// CARROSSEL "MÚSICAS MAIS TOCADAS"
// ============================================================
// O carrossel é o mesmo: quem muda é só a origem dos dados.
// carregarMusicasMaisTocadas() (ranking) alimenta musicasAtuais e cai no
// catálogo geral se ainda não houver nenhuma reprodução — assim a home
// nunca fica vazia num banco novo, e a busca e o botão "inicio" seguem
// funcionando igual.
let musicasAtuais = [];
let indiceMscAtual = 0;

// Monta o card de destaque (música atualmente em foco no carrossel).
function criarDestaqueMusica(musica) {
  const div = document.createElement('div');
  div.className = 'msc-destaque';

  const capa = document.createElement('img');
  capa.className = 'msc-capa-img';
  capa.src = musica.url_capa || '';
  capa.alt = `Capa de ${musica.titulo}`;

  const info = document.createElement('div');
  info.className = 'msc-info';

  const nome = document.createElement('p');
  nome.className = 'msc-nome';
  nome.textContent = musica.titulo;

  const artista = document.createElement('p');
  artista.className = 'msc-artista';
  artista.textContent = musica.artista;

  const btnPlay = document.createElement('button');
  btnPlay.type = 'button';
  btnPlay.className = 'btn-play';
  btnPlay.textContent = '▶ Tocar';

  // Mesmo comportamento do botão de play do card antigo: exige login e
  // usa a mesma função tocarMusica() que já toca o áudio de verdade.
  btnPlay.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para tocar as músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    tocarMusica(musica, btnPlay);
  });

  // Botão de favoritar: agora fica ao lado do "Tocar" (mesmo estilo/cor),
  // não mais sobre a capa. A lógica (coração cheio/vazio, fetch de
  // favoritar/desfavoritar) continua a mesma de sempre.
  const btnFavoritar = criarBotaoIcone('btn-favoritar-destaque', '♡', 'Favoritar');
  btnFavoritar.dataset.musicaId = musica.id;
  pintarCoracao(btnFavoritar, idsFavoritos.has(Number(musica.id)));
  btnFavoritar.addEventListener('click', () => alternarFavorito(musica));

  const botoesInfo = document.createElement('div');
  botoesInfo.className = 'msc-info-botoes';
  botoesInfo.appendChild(btnPlay);
  botoesInfo.appendChild(btnFavoritar);

  info.appendChild(nome);
  info.appendChild(artista);
  info.appendChild(botoesInfo);

    // A capa agora vai dentro de um wrapper (mesmas medidas, 185px) pra que
  // o botão de adicionar à playlist possa ficar ancorado nela.
  const capaWrapper = document.createElement('div');
  capaWrapper.className = 'msc-capa-wrapper';
  capaWrapper.appendChild(capa);

  const acoes = document.createElement('div');
  acoes.className = 'msc-acoes-capa';

  const btnAddPlaylist = criarBotaoIcone('', '＋', 'Adicionar à playlist');
  btnAddPlaylist.addEventListener('click', () => abrirModalAddPlaylist(musica));

  // "Tocar depois": joga no fim da fila sem tirar o que está tocando.
  const btnFila = criarBotaoIcone('btn-enfileirar-destaque', '⇥', 'Tocar depois');
  btnFila.dataset.musicaId = musica.id;
  btnFila.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para usar a fila.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    adicionarAFila(musica);
  });

  acoes.appendChild(btnFavoritar);
  acoes.appendChild(btnAddPlaylist);
  acoes.appendChild(btnFila);
  capaWrapper.appendChild(acoes);

  div.appendChild(capaWrapper);   // <- substitui o antigo div.appendChild(capa);

  div.appendChild(info);

  return div;
}

// Monta uma mini-capa clicável (já vistas à esquerda / próximas à
// direita). Clicar nela só troca o foco do carrossel — não toca a música.
function criarMiniCapa(musica, indiceReal, classeExtra) {
  const img = document.createElement('img');
  img.className = classeExtra;
  img.src = musica.url_capa || '';
  img.alt = `Capa de ${musica.titulo || ''}`.trim();
  img.addEventListener('click', () => focarMusica(indiceReal));
  return img;
}

// Quantas "próximas" mostrar, dependendo de quão longe o usuário já
// avançou. Perto do início (destaque ainda à esquerda) há mais espaço
// sobrando, então mostramos mais; depois de 3 posições, quando o destaque
// já estabilizou, mantemos só 3 (o mínimo ideal do plano).
function quantidadeProximasAlvo(indice) {
  if (indice === 0) return 6;
  if (indice <= 2) return 5;
  return 4;
}

// Renderiza o destaque + as mini-capas dentro de #lista-musicas, com base
// em indiceMscAtual.
function renderCarrosselMusicas(lista) {
  if (!listaMusicas || !Array.isArray(lista) || lista.length === 0) return;

  if (indiceMscAtual < 0) indiceMscAtual = 0;
  if (indiceMscAtual > lista.length - 1) indiceMscAtual = lista.length - 1;

  listaMusicas.innerHTML = '';

  const anteriores = document.createElement('div');
  anteriores.className = 'msc-anteriores';

  const inicioAnteriores = Math.max(0, indiceMscAtual - 3);

  lista.slice(inicioAnteriores, indiceMscAtual).forEach((musica, i) => {
    const indiceReal = inicioAnteriores + i;
    anteriores.appendChild(criarMiniCapa(musica, indiceReal, 'msc-mini'));
  });

  listaMusicas.appendChild(anteriores);

  listaMusicas.appendChild(criarDestaqueMusica(lista[indiceMscAtual]));

  const proximas = document.createElement('div');
  proximas.className = 'msc-carrossel';

  const alvoProximas = quantidadeProximasAlvo(indiceMscAtual);
  const disponiveis = lista.length - indiceMscAtual - 1;
  const qtdProximas = Math.min(alvoProximas, disponiveis);

  for (let i = 0; i < qtdProximas; i++) {
    const indiceReal = indiceMscAtual + 1 + i;
    proximas.appendChild(criarMiniCapa(lista[indiceReal], indiceReal, 'msc-carrossel-item'));
  }

  listaMusicas.appendChild(proximas);
}

// Troca a música em foco do carrossel. Primeiro dispara a animação de
// saída (capa encolhe, vinil fecha, texto some) nos elementos atuais,
// espera ela terminar, e só então troca o conteúdo — que entra com a
// animação normal (capa cresce, vinil abre, texto some com fade-in).
let carrosselAnimando = false;

function focarMusica(novoIndice) {
  if (!listaMusicas) {
    indiceMscAtual = novoIndice;
    renderCarrosselMusicas(musicasAtuais);
    return;
  }

  if (carrosselAnimando) {
    // Troca já em andamento: aplica direto, sem empilhar animações.
    indiceMscAtual = novoIndice;
    renderCarrosselMusicas(musicasAtuais);
    return;
  }

  carrosselAnimando = true;
  listaMusicas.classList.add('saindo');

  setTimeout(() => {
    indiceMscAtual = novoIndice;
    renderCarrosselMusicas(musicasAtuais);
    listaMusicas.classList.remove('saindo');
    carrosselAnimando = false;
  }, 160);
}

// Setas de navegação: avançam/voltam uma música por vez, dando a volta
// (loop infinito) ao chegar numa ponta da lista.
const btnMscSetaEsq = document.getElementById('msc-seta-esq');
const btnMscSetaDir = document.getElementById('msc-seta-dir');

if (btnMscSetaEsq) {
  btnMscSetaEsq.addEventListener('click', () => {
    if (!musicasAtuais.length) return;
    const novoIndice = indiceMscAtual > 0 ? indiceMscAtual - 1 : musicasAtuais.length - 1;
    focarMusica(novoIndice);
  });
}

if (btnMscSetaDir) {
  btnMscSetaDir.addEventListener('click', () => {
    if (!musicasAtuais.length) return;
    const novoIndice = indiceMscAtual < musicasAtuais.length - 1 ? indiceMscAtual + 1 : 0;
    focarMusica(novoIndice);
  });
}

async function carregarMusicas() {
  if (!listaMusicas) return;

  if (tituloSecaoMusicas) tituloSecaoMusicas.textContent = 'Todas as músicas';

  try {
    const resposta = await fetch('http://localhost:3000/api/musicas');
    const dados = await resposta.json();

    if (!resposta.ok) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = dados.mensagem || 'Não foi possível carregar as músicas.';
      listaMusicas.appendChild(mensagem);
      return;
    }

    if (!dados.musicas || dados.musicas.length === 0) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = 'Nenhuma música enviada ainda. Seja o primeiro a fazer upload!';
      listaMusicas.appendChild(mensagem);
      return;
    }

    musicasAtuais = dados.musicas;
    indiceMscAtual = 0;
    renderCarrosselMusicas(musicasAtuais);

  } catch (erro) {
    console.error('Erro ao carregar músicas:', erro);
    listaMusicas.innerHTML = '';
    const mensagem = document.createElement('p');
    mensagem.className = 'mensagem-lista';
    mensagem.textContent = 'Erro de conexão ao carregar as músicas.';
    listaMusicas.appendChild(mensagem);
  }
}

// Ranking geral (não é mensal: não existe histórico de data por play).
// Se o endpoint falhar OU vier vazio, mostra o catálogo geral — nunca
// deixa a seção principal da home quebrada por causa do ranking.
async function carregarMusicasMaisTocadas() {
  if (!listaMusicas) return;

  if (tituloSecaoMusicas) tituloSecaoMusicas.textContent = 'Músicas mais tocadas';

  try {
    const resposta = await fetch('http://localhost:3000/api/musicas/mais-tocadas');
    const dados = await resposta.json();

    if (!resposta.ok || !dados.musicas || dados.musicas.length === 0) {
      await carregarMusicas();
      return;
    }

    musicasAtuais = dados.musicas;
    indiceMscAtual = 0;
    renderCarrosselMusicas(musicasAtuais);

  } catch (erro) {
    console.error('Erro ao carregar as músicas mais tocadas:', erro);
    await carregarMusicas();
  }
}

// Carga inicial da home: as duas requisições de ranking, uma vez só.
// Os favoritos NÃO entram aqui: quem carrega é o favoritos.js, que roda
// em todas as páginas — o carrossel só pinta o coração com o que ele
// já trouxer.
carregarMusicasMaisTocadas();
carregarArtistasMaisOuvidos();
carregarDescobrirMusicas();

// ============================================================
// BUSCA INLINE (mesma página — não navega, pra não matar o áudio tocando)
//
// A busca acha duas coisas: músicas (viram o carrossel, como sempre) e
// pessoas (viram uma faixa de resultados com link para o perfil). As duas
// requisições são independentes: uma falhar não esconde a outra.
// ============================================================

const elBuscaPessoas = document.getElementById('busca-pessoas');
const elBuscaPessoasLista = document.getElementById('busca-pessoas-lista');

function esconderResultadosDePessoas() {
  if (elBuscaPessoas) elBuscaPessoas.classList.add('hidden');
}

function renderizarPessoas(pessoas) {
  if (!elBuscaPessoas || !elBuscaPessoasLista) return;

  elBuscaPessoasLista.innerHTML = '';
  if (!pessoas || pessoas.length === 0) { esconderResultadosDePessoas(); return; }

  pessoas.forEach((pessoa) => {
    const item = document.createElement('li');
    item.className = 'busca-pessoa';

    const link = document.createElement('a');
    link.className = 'busca-pessoa-link';
    link.href = 'perfil.html?u=' + encodeURIComponent(pessoa.nome_usuario);
    link.title = `Ver o perfil de @${pessoa.nome_usuario}`;

    // Avatar pela mesma pintura da navbar: cai no avatar-padrao e nas
    // iniciais quando a pessoa não tem foto.
    const caixa = document.createElement('span');
    caixa.className = 'os-avatar os-avatar-sm';
    const iniciais = document.createElement('span');
    iniciais.className = 'os-avatar-iniciais';
    const img = document.createElement('img');
    img.className = 'os-avatar-img';
    img.src = pessoa.avatar_url || '';
    img.alt = '';
    img.loading = 'lazy';
    caixa.appendChild(iniciais);
    caixa.appendChild(img);
    if (window.OS && typeof OS.pintarCaixa === 'function') {
      OS.pintarCaixa(caixa, pessoa.avatar_url || null, pessoa.nome);
    }

    const nome = document.createElement('span');
    nome.className = 'busca-pessoa-nome';
    nome.textContent = pessoa.nome;

    const arroba = document.createElement('span');
    arroba.className = 'busca-pessoa-arroba';
    arroba.textContent = `@${pessoa.nome_usuario}`;

    link.appendChild(caixa);
    link.appendChild(nome);
    link.appendChild(arroba);
    item.appendChild(link);
    elBuscaPessoasLista.appendChild(item);
  });

  elBuscaPessoas.classList.remove('hidden');
}

async function buscarPessoas(termo) {
  // O servidor exige ao menos 2 letras; nem vale a pena pedir.
  if (!termo || termo.trim().length < 2) { esconderResultadosDePessoas(); return; }
  try {
    const resposta = await fetch(`http://localhost:3000/api/perfil/buscar?q=${encodeURIComponent(termo.trim())}`);
    if (!resposta.ok) { esconderResultadosDePessoas(); return; }
    const dados = await resposta.json();
    renderizarPessoas(dados.pessoas);
  } catch (erro) {
    console.error('Erro ao buscar perfis:', erro);
    esconderResultadosDePessoas();
  }
}

if (formBusca) {
  formBusca.addEventListener('submit', async (event) => {
    event.preventDefault(); // intercepta — sem isso ele navegaria pro action do form
    const termo = campoBusca ? campoBusca.value.trim() : '';
    if (!termo) return;
    // As duas buscas saem juntas; a faixa de pessoas esconde sozinha se
    // não houver ninguém com aquele @ ou nome.
    buscarPessoas(termo);
    executarBusca(termo);
  });
}

async function executarBusca(termo) {
  if (!listaMusicas) return;

  if (tituloSecaoMusicas) tituloSecaoMusicas.textContent = `Resultados para "${termo}"`;
  listaMusicas.innerHTML = '';
  const carregando = document.createElement('p');
  carregando.className = 'mensagem-lista';
  carregando.textContent = 'Buscando...';
  listaMusicas.appendChild(carregando);

  try {
    const resposta = await fetch(`http://localhost:3000/api/musicas/buscar?q=${encodeURIComponent(termo)}`);
    const dados = await resposta.json();

    if (!resposta.ok) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = dados.mensagem || 'Não foi possível buscar as músicas.';
      listaMusicas.appendChild(mensagem);
      return;
    }

    if (!dados.musicas || dados.musicas.length === 0) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = `Nenhuma música encontrada para "${termo}".`;
      listaMusicas.appendChild(mensagem);
      return;
    }

    // Reaproveita o mesmo carrossel do catálogo principal — só troca os
    // dados; a forma de renderizar (destaque + setas) continua igual.
    musicasAtuais = dados.musicas;
    indiceMscAtual = 0;
    renderCarrosselMusicas(musicasAtuais);

  } catch (erro) {
    console.error('Erro ao buscar músicas:', erro);
    listaMusicas.innerHTML = '';
    const mensagem = document.createElement('p');
    mensagem.className = 'mensagem-lista';
    mensagem.textContent = 'Erro de conexão ao buscar músicas.';
    listaMusicas.appendChild(mensagem);
  }
}

// ============================================================
// RANKING DE ARTISTAS MAIS OUVIDOS
// ============================================================

// Iniciais pro quadradinho do artista. Evita depender de foto/asset
// externo: o projeto ainda não tem imagem de artista cadastrada, e puxar
// uma capa aleatória da música enganaria (o ranking é por conta, não por
// música).
function iniciaisArtista(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Formata só o número (600.959), sem o texto "reproduções". O rótulo fica
// em um <span> separado pra o CSS poder mostrar ou esconder por estado.
function formatarNumeroBR(quantidade) {
  const numero = Number(quantidade);
  if (!Number.isFinite(numero)) return '0';
  return numero.toLocaleString('pt-BR');
}

function criarItemArtista(artista, posicao) {
  const item = document.createElement('div');
  // Do 4º em diante o card fica compacto (definido no CSS).
  item.className = posicao > 3 ? 'artista-item artista-item--compacto' : 'artista-item';

  const numero = document.createElement('span');
  numero.className = 'artista-posicao';
  numero.textContent = `${posicao}º`;

  // Card que agrupa avatar + informações (o número fica fora, à esquerda).
  const card = document.createElement('div');
  card.className = 'artista-card';

  // Foto real quando o artista tem avatar enviado (o endpoint devolve
  // avatar_url). Sem foto, continua o fallback de iniciais que já existia
  // aqui — nenhum caminho inventa imagem.
  let avatar;
  if (artista.avatar_url) {
    avatar = document.createElement('img');
    avatar.className = 'artista-avatar';
    avatar.src = artista.avatar_url;
    avatar.alt = `Foto de ${artista.artista || 'artista'}`;
    avatar.loading = 'lazy';
  } else {
    avatar = document.createElement('span');
    avatar.className = 'artista-avatar';
    avatar.textContent = iniciaisArtista(artista.artista);
  }

  const info = document.createElement('div');
  info.className = 'artista-info';

  // O nome do artista abre o perfil público dele. A rota aceita @ ou id;
  // aqui o endpoint já devolve o @, que é o identificador "de verdade".
  const nome = document.createElement('p');
  nome.className = 'artista-nome';
  if (artista.nome_usuario && window.OS && typeof OS.linkPerfil === 'function') {
    nome.appendChild(OS.linkPerfil({
      identificador: artista.nome_usuario,
      texto: artista.artista || 'Artista sem nome',
      descricao: `Ver o perfil de ${artista.artista}`
    }));
  } else {
    nome.textContent = artista.artista || 'Artista sem nome';
  }
  nome.title = nome.textContent;

  info.appendChild(nome);

  // Informação secundária real: quantidade de músicas do artista.
  const totalMusicas = Number(artista.musicas);
  if (Number.isFinite(totalMusicas)) {
    const detalhe = document.createElement('p');
    detalhe.className = 'artista-detalhe';
    detalhe.textContent = `${totalMusicas} ${totalMusicas === 1 ? 'música' : 'músicas'}`;
    info.appendChild(detalhe);
  }

  const reproducoes = document.createElement('p');
  reproducoes.className = 'artista-reproducoes';

  const valor = document.createElement('span');
  valor.className = 'artista-reproducoes-valor';
  valor.textContent = formatarNumeroBR(artista.reproducoes);

  const rotulo = document.createElement('span');
  rotulo.className = 'artista-reproducoes-rotulo';
  rotulo.textContent = Number(artista.reproducoes) === 1 ? 'Reprodução' : 'Reproduções';

  reproducoes.appendChild(valor);
  reproducoes.appendChild(rotulo);
  info.appendChild(reproducoes);

  card.appendChild(avatar);
  card.appendChild(info);

  item.appendChild(numero);
  item.appendChild(card);

  return item;
}

function mostrarMensagemArtistas(mensagem) {
  if (!listaArtistas) return;
  listaArtistas.innerHTML = '';
  const paragrafo = document.createElement('p');
  paragrafo.className = 'mensagem-lista';
  paragrafo.textContent = mensagem;
  listaArtistas.appendChild(paragrafo);
}

async function carregarArtistasMaisOuvidos() {
  if (!listaArtistas) return;

  try {
    const resposta = await fetch('http://localhost:3000/api/artistas/mais-ouvidos');
    const dados = await resposta.json();

    if (!resposta.ok) {
      mostrarMensagemArtistas(dados.mensagem || 'Não foi possível carregar os artistas.');
      return;
    }

    if (!dados.artistas || dados.artistas.length === 0) {
      mostrarMensagemArtistas('Comece a ouvir músicas para gerar o ranking.');
      return;
    }

    listaArtistas.innerHTML = '';
    dados.artistas.forEach((artista, indice) => {
      listaArtistas.appendChild(criarItemArtista(artista, indice + 1));
    });

  } catch (erro) {
    console.error('Erro ao carregar os artistas mais ouvidos:', erro);
    mostrarMensagemArtistas('Erro de conexão ao carregar os artistas.');
  }
}

// ============================================================
// "DESCUBRA NOVAS MÚSICAS"
// ============================================================
// Lista as músicas mais recém-enviadas. Os dados vêm do catálogo geral
// (GET /api/musicas), que já vem ordenado por criado_em DESC.
// O #lista-descobrir é lido lá em cima, junto dos outros elementos do DOM.

function mostrarMensagemDescobrir(mensagem, estado) {
  if (!listaDescobrir) return;
  listaDescobrir.innerHTML = '';
  listaDescobrir.dataset.estado = estado;
  const item = document.createElement('li');
  item.className = 'mensagem-lista';
  item.textContent = mensagem;
  listaDescobrir.appendChild(item);
}

// mm:ss. Sem valor (null/NaN) vira '--:--' — nunca um tempo chutado.
function formatarDuracao(segundos) {
  if (segundos === null || Number.isNaN(Number(segundos))) return '--:--';
  const min = Math.floor(segundos / 60);
  const seg = Math.floor(segundos % 60).toString().padStart(2, '0');
  return `${min}:${seg}`;
}

// Duração real, lida do metadata do próprio arquivo pelo navegador. Não
// existe coluna de duração no banco, e não é preciso criar uma: o
// HTMLAudioElement sabe quanto tempo o áudio dura sem baixar ele inteiro.
// Arquivo indisponível/CORS bloqueado resolve null e a célula fica '--:--'.
function obterDuracaoReal(urlAudio) {
  return new Promise((resolve) => {
    if (!urlAudio) return resolve(null);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
    audio.addEventListener('error', () => resolve(null));
    audio.src = urlAudio;
  });
}

function criarItemDescobrir(musica) {
  const item = document.createElement('li');
  item.className = 'descobrir-item';

  // Capa real quando existe. Sem capa, o mesmo quadradinho com 🎵 que o
  // resto do projeto já usa (minhas-musicas.js / biblioteca.js) — não há
  // imagem de placeholder genérica no repositório para apontar.
  if (musica.url_capa) {
    const capa = document.createElement('img');
    capa.className = 'descobrir-capa';
    capa.src = musica.url_capa;
    capa.alt = `Capa de ${musica.titulo || ''}`.trim();
    capa.loading = 'lazy';
    item.appendChild(capa);
  } else {
    const capaVazia = document.createElement('span');
    capaVazia.className = 'descobrir-capa descobrir-capa-vazia';
    capaVazia.textContent = '🎵';
    item.appendChild(capaVazia);
  }

  const info = document.createElement('div');
  info.className = 'descobrir-info';

  const titulo = document.createElement('span');
  titulo.className = 'descobrir-titulo';
  titulo.textContent = musica.titulo || 'Música sem título';

  const artista = document.createElement('span');
  artista.className = 'descobrir-artista';
  artista.textContent = musica.artista || 'Artista desconhecido';

  info.append(titulo, artista);

  const duracao = document.createElement('span');
  duracao.className = 'descobrir-duracao';
  duracao.textContent = '--:--';
  // Preenche depois, sem travar a lista inteira esperando cada áudio.
  obterDuracaoReal(musica.url_audio).then((segundos) => {
    duracao.textContent = formatarDuracao(segundos);
  });

  item.append(info, duracao);

  // Tocar pelo player global: mesma função e mesma guarda de login que o
  // carrossel usa. O botão que receive o rótulo é o da barra do player,
  // então aqui não há segundo estado de áudio.
  item.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para tocar as músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    tocarMusica(musica);
  });

  return item;
}

async function carregarDescobrirMusicas() {
  if (!listaDescobrir) return;

  try {
    const resposta = await fetch('http://localhost:3000/api/musicas');
    if (!resposta.ok) throw new Error('Falha ao buscar músicas.');
    const { musicas } = await resposta.json();

    if (!musicas || musicas.length === 0) {
      mostrarMensagemDescobrir('Não há músicas disponíveis no momento.', 'vazio');
      return;
    }

    listaDescobrir.innerHTML = '';
    listaDescobrir.dataset.estado = 'pronto';
    musicas.forEach((musica) => {
      listaDescobrir.appendChild(criarItemDescobrir(musica));
    });

  } catch (erro) {
    console.error('Erro ao carregar as músicas:', erro);
    mostrarMensagemDescobrir('Não foi possível carregar as músicas.', 'erro');
  }
}

// "inicio" limpa a busca e volta pro estado inicial da home, que agora é o
// ranking de mais tocadas (com queda pro catálogo geral se ainda não houver
// reproduções — o mesmo fallback de quando a home abre).
const btnInicio = document.getElementById('btn-inicio');
if (btnInicio) {
  btnInicio.addEventListener('click', () => {
    if (campoBusca) campoBusca.value = '';
    // A faixa de pessoas é resultado de busca: sai junto com o campo.
    if (typeof esconderResultadosDePessoas === 'function') esconderResultadosDePessoas();
    // Só o carrossel: o ranking de artistas não depende da busca e não
    // precisa ser recarregado aqui.
    carregarMusicasMaisTocadas();
  });
}

// ============================================================
// UPLOAD DE MÚSICA
// ============================================================

// Nome de artista da conta logada, guardado aqui depois de consultado —
// usado só pra exibir no modal de upload, o valor de verdade quem decide
// é sempre o servidor (na hora de gravar a música).
let nomeArtistaAtual = '';

if (btnUpload) {
  btnUpload.addEventListener('click', async () => {
    if (!estaLogado()) {
      alert('Faça login para enviar músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    await abrirFluxoUpload();
  });
}

// Confere se a conta já tem nome de artista definido. Se não tiver, pede
// primeiro (só na primeira vez); se já tiver, vai direto pro upload.
async function abrirFluxoUpload() {
  try {
    const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/eu');
    const dados = await resposta.json();

    if (!resposta.ok) {
      alert(dados.mensagem || 'Não foi possível verificar sua conta.');
      return;
    }

    if (!dados.usuario.eh_artista) {
      if (modalArtista) modalArtista.classList.remove('hidden');
    } else {
      abrirModalUpload(dados.usuario.nome_artista);
    }
  } catch (erro) {
    console.error('Erro ao verificar conta:', erro);
    alert('Erro de conexão com o servidor.');
  }
}

function abrirModalUpload(nomeArtista) {
  nomeArtistaAtual = nomeArtista;

  const spanArtistaNome = document.getElementById('upload-artista-nome');
  if (spanArtistaNome) spanArtistaNome.textContent = nomeArtista;
  if (previewArtista) previewArtista.textContent = nomeArtista;

  if (modalUpload) modalUpload.classList.remove('hidden');
}

if (btnFecharArtista && modalArtista) {
  btnFecharArtista.addEventListener('click', () => {
    modalArtista.classList.add('hidden');
    if (formArtista) formArtista.reset();
  });
}

if (formArtista) {
  formArtista.addEventListener('submit', async (event) => {
    event.preventDefault();

    const campoNomeArtista = document.getElementById('artista-nome');
    const nomeArtista = campoNomeArtista ? campoNomeArtista.value.trim() : '';

    if (!nomeArtista) {
      alert('Digite um nome de artista.');
      return;
    }

    const btnSubmitArtista = formArtista.querySelector('button[type="submit"]');
    if (btnSubmitArtista) {
      btnSubmitArtista.disabled = true;
      btnSubmitArtista.textContent = 'Salvando...';
    }

    try {
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/artista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeArtista })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        if (modalArtista) modalArtista.classList.add('hidden');
        formArtista.reset();
        // Segue direto pro upload — é o motivo de ter aberto esse popup.
        abrirModalUpload(dados.usuario.nome_artista);
      } else {
        alert(dados.mensagem || 'Não foi possível salvar o nome de artista.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitArtista) {
        btnSubmitArtista.disabled = false;
        btnSubmitArtista.textContent = 'Confirmar';
      }
    }
  });
}

if (btnFecharUpload && modalUpload) {
  btnFecharUpload.addEventListener('click', () => {
    modalUpload.classList.add('hidden');
    if (formUpload) formUpload.reset();
    resetarPreviewUpload();
  });
}

// Elementos do formulário e da preview ao vivo
const campoTitulo = document.getElementById('upload-titulo');
const campoAudio = document.getElementById('upload-audio');
const campoCapa = document.getElementById('upload-capa');

const previewCapa = document.getElementById('preview-upload-capa');
const previewCapaVazio = document.getElementById('preview-upload-capa-vazio');
const previewTitulo = document.getElementById('preview-upload-titulo');
const previewArtista = document.getElementById('preview-upload-artista');
const previewAudio = document.getElementById('preview-upload-audio');

// Nome do arquivo escolhido escrito dentro do cartão do botão, pra quem
// está vendo o modal saber o que já escolheu sem precisar olhar o
// preview da esquerda.
const nomeArquivoAudio = document.getElementById('upload-audio-nome');
const nomeArquivoCapa = document.getElementById('upload-capa-nome');

const ROTULO_AUDIO_PADRAO = 'MP3, WAV ou OGG';
const ROTULO_CAPA_PADRAO = 'Opcional · JPG, PNG ou WEBP';

let urlObjetoCapaAtual = null;

function resetarPreviewUpload() {
  if (urlObjetoCapaAtual) {
    URL.revokeObjectURL(urlObjetoCapaAtual);
    urlObjetoCapaAtual = null;
  }
  if (previewCapa) {
    previewCapa.src = '';
    previewCapa.classList.add('hidden');
  }
  if (previewCapaVazio) previewCapaVazio.classList.remove('hidden');
  if (previewTitulo) previewTitulo.textContent = 'Título da música';
  // Artista NÃO volta pro genérico — é fixo da conta, continua mostrando
  // o nome já carregado por abrirModalUpload().
  if (previewArtista && nomeArtistaAtual) previewArtista.textContent = nomeArtistaAtual;
  if (previewAudio) previewAudio.textContent = 'Nenhum áudio selecionado';
  if (nomeArquivoAudio) nomeArquivoAudio.textContent = ROTULO_AUDIO_PADRAO;
  if (nomeArquivoCapa) nomeArquivoCapa.textContent = ROTULO_CAPA_PADRAO;
}

if (campoTitulo && previewTitulo) {
  campoTitulo.addEventListener('input', () => {
    previewTitulo.textContent = campoTitulo.value.trim() || 'Título da música';
  });
}


if (campoAudio && previewAudio) {
  campoAudio.addEventListener('change', () => {
    const arquivo = campoAudio.files[0];
    previewAudio.textContent = arquivo ? `🎵 ${arquivo.name}` : 'Nenhum áudio selecionado';
    if (nomeArquivoAudio) nomeArquivoAudio.textContent = arquivo ? arquivo.name : ROTULO_AUDIO_PADRAO;
  });
}

if (campoCapa && previewCapa && previewCapaVazio) {
  campoCapa.addEventListener('change', () => {
    const arquivo = campoCapa.files[0];

    if (urlObjetoCapaAtual) {
      URL.revokeObjectURL(urlObjetoCapaAtual);
      urlObjetoCapaAtual = null;
    }

    if (arquivo) {
      urlObjetoCapaAtual = URL.createObjectURL(arquivo);
      previewCapa.src = urlObjetoCapaAtual;
      previewCapa.classList.remove('hidden');
      previewCapaVazio.classList.add('hidden');
      if (nomeArquivoCapa) nomeArquivoCapa.textContent = arquivo.name;
    } else {
      previewCapa.src = '';
      previewCapa.classList.add('hidden');
      previewCapaVazio.classList.remove('hidden');
      if (nomeArquivoCapa) nomeArquivoCapa.textContent = ROTULO_CAPA_PADRAO;
    }
  });
}

if (formUpload) {
  formUpload.addEventListener('submit', async (event) => {
    event.preventDefault();

    const titulo = campoTitulo ? campoTitulo.value.trim() : '';
    const arquivoAudio = campoAudio && campoAudio.files[0] ? campoAudio.files[0] : null;
    const arquivoCapa = campoCapa && campoCapa.files[0] ? campoCapa.files[0] : null;

    if (!titulo || !arquivoAudio) {
      alert('Preencha o título e selecione o arquivo de áudio.');
      return;
    }

    const dadosFormulario = new FormData();
    dadosFormulario.append('titulo', titulo);
    dadosFormulario.append('audio', arquivoAudio);
    if (arquivoCapa) dadosFormulario.append('capa', arquivoCapa);

    const btnSubmitUpload = formUpload.querySelector('button[type="submit"]');
    if (btnSubmitUpload) {
      btnSubmitUpload.disabled = true;
      btnSubmitUpload.textContent = 'Enviando...';
    }

    try {
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/musicas', {
        method: 'POST',
        body: dadosFormulario
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Música enviada com sucesso!');
        if (modalUpload) modalUpload.classList.add('hidden');
        formUpload.reset();
        resetarPreviewUpload();
        carregarMusicas();
      } else {
        alert(dados.mensagem || 'Não foi possível enviar a música.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitUpload) {
        btnSubmitUpload.disabled = false;
        btnSubmitUpload.textContent = 'Enviar';
      }
    }
  });
}