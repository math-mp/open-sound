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

// Regex de Validação
const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/;

let emailUsuarioAtual = '';
let tempoRestante = 60;
let intervaloTimer = null;
let tokenPendenciaAtual = '';

// === FUNÇÃO PARA MASCARAR E-MAIL ===
// CORREÇÃO: os "${...}" tinham virado "\(...\)" (provável erro de escape ao colar).
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
  // Garante apenas números e avança o foco automaticamente
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value && index < inputsOTP.length - 1) {
      inputsOTP[index + 1].focus();
    }
  });

  // Volta o foco ao apertar Backspace em um campo vazio
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      inputsOTP[index - 1].focus();
    }
  });

  // Suporte a colar o código completo de 6 dígitos
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
      btnToggleSenha.textContent = '🙈';
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

    if (btnSubmitRegistro && btnSubmitRegistro.disabled) return;

    const campoEmail = formRegistro.querySelector('input[type="email"]');
    const campoSenha = document.getElementById('input-senha');

    const email = campoEmail ? campoEmail.value.trim() : '';
    const password = campoSenha ? campoSenha.value.trim() : '';

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
        body: JSON.stringify({ email, password })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        emailUsuarioAtual = email;
        tokenPendenciaAtual = dados.tokenPendencia;

        if (spanEmailMascarado) spanEmailMascarado.textContent = mascararEmail(email);
        if (etapaRegistro) etapaRegistro.classList.add('hidden');
        if (etapa2fa) etapa2fa.classList.remove('hidden');

        inputsOTP.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTP[0]?.focus(), 100);

        iniciarTimer2FA();
      } else {
        alert(dados.mensagem || 'Erro ao processar o registro.');
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
    // Concatena os valores de cada uma das caixas OTP
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
          tokenPendencia: tokenPendenciaAtual
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
        // CORREÇÃO: o servidor agora devolve um token atualizado (com o
        // contador de tentativas) mesmo quando o código está errado.
        if (dados.tokenPendencia) {
          tokenPendenciaAtual = dados.tokenPendencia;
        }
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
        body: JSON.stringify({ tokenPendencia: tokenPendenciaAtual })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        tokenPendenciaAtual = dados.novoTokenPendencia;

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

// CHAVE_SESSAO: nome usado no localStorage para guardar o tokenSessao
// devolvido por POST /api/login.
const CHAVE_SESSAO = 'tokenSessao';

function obterTokenSessao() {
  return localStorage.getItem(CHAVE_SESSAO);
}

function estaLogado() {
  return !!obterTokenSessao();
}

// Atualiza a navbar: some Entrar/Registre-se e mostra Sair quando logado,
// e vice-versa quando deslogado. Chame sempre que o estado de login mudar.
function atualizarUIAutenticacao() {
  const logado = estaLogado();

  if (btnEntrar) btnEntrar.classList.toggle('hidden', logado);
  if (btnRegister) btnRegister.classList.toggle('hidden', logado);
  if (btnSair) btnSair.classList.toggle('hidden', !logado);
}

// Helper para requisições futuras que exigem login (ex: tocar música,
// upload). Injeta o header Authorization automaticamente e trata o 401
// (sessão expirada/inválida) de forma centralizada.
async function fetchComAutenticacao(url, opcoes = {}) {
  const token = obterTokenSessao();
  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };

  const resposta = await fetch(url, { ...opcoes, headers });

  if (resposta.status === 401) {
    // Token inválido/expirado: desloga localmente e avisa o usuário.
    localStorage.removeItem(CHAVE_SESSAO);
    atualizarUIAutenticacao();
    alert('Sua sessão expirou. Faça login novamente.');
  }

  return resposta;
}

// Abre o modal de login ao clicar em "Entrar"
if (btnEntrar && modalLogin) {
  btnEntrar.addEventListener('click', () => modalLogin.classList.remove('hidden'));
}

if (btnFecharLogin && modalLogin) {
  btnFecharLogin.addEventListener('click', () => modalLogin.classList.add('hidden'));
}

// Submit do formulário de login
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

        if (modalLogin) modalLogin.classList.add('hidden');
        formLogin.reset();
      } else {
        alert(dados.mensagem || 'Não foi possível fazer login.');
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

// Logout: só precisa apagar o token local — não existe nada pra invalidar
// no servidor porque o token é stateless (JWT).
if (btnSair) {
  btnSair.addEventListener('click', () => {
    const confirmou = confirm('Você realmente deseja deslogar da sua conta?');
    if (!confirmou) return;

    localStorage.removeItem(CHAVE_SESSAO);
    atualizarUIAutenticacao();
    alert('Você foi deslogado.');
  });
}

// Estado inicial da navbar ao carregar a página
atualizarUIAutenticacao();