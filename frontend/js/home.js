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

// Regex de Validação
const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;

const btnConfirmar2FA = document.getElementById('btn-confirmar-2fa');
const btnReenviar2FA = document.getElementById('btn-reenviar-2fa');
const mensagemTimer = document.getElementById('mensagem-timer');

let emailUsuarioAtual = '';
let tempoRestante = 60;
let intervaloTimer = null;

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
    atualizarRegra(regraEsp, /[@$!%*?&#]/.test(valor), 'Ao menos 1 caractere especial (@$!%*?&#)');
  });
}

// === SUBMIT DO REGISTRO ===
if (formRegistro) {
  formRegistro.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (btnSubmitRegistro && btnSubmitRegistro.disabled) return;

    // Busca os inputs de forma segura no momento do clique
    const campoEmail = formRegistro.querySelector('input[type="email"]');
    const campoSenha = document.getElementById('input-senha');

    const email = campoEmail ? campoEmail.value.trim() : '';
    const password = campoSenha ? campoSenha.value.trim() : '';

    // 1. Validação de formato de E-mail
    if (!regexEmail.test(email)) {
      alert('Insira um formato de e-mail válido (exemplo: usuario@email.com).');
      return;
    }

    // 2. Validação de Senha Forte
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
        if (etapaRegistro) etapaRegistro.classList.add('hidden');
        if (etapa2fa) etapa2fa.classList.remove('hidden');

        iniciarTimer2FA();
      } else if (resposta.status === 400) {
        alert(dados.mensagem);
        formRegistro.reset();
        if (modal) modal.classList.add('hidden');
      } else {
        alert(dados.mensagem || 'Ocorreu um erro ao tentar registrar.');
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
    const inputCodigo = document.querySelector('#etapa-2fa input');
    const codigoDigitado = inputCodigo ? inputCodigo.value.trim() : '';

    if (!codigoDigitado) {
      alert('Por favor, digite o código de 6 dígitos.');
      return;
    }

    try {
      const resposta = await fetch('http://localhost:3000/api/validar-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailUsuarioAtual, codigo: codigoDigitado })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Conta validada com sucesso!');
        if (modal) modal.classList.add('hidden');
        if (formRegistro) formRegistro.reset();
        if (inputCodigo) inputCodigo.value = '';
        if (etapa2fa) etapa2fa.classList.add('hidden');
        if (etapaRegistro) etapaRegistro.classList.remove('hidden');
        if (intervaloTimer) clearInterval(intervaloTimer);
      } else {
        alert(dados.mensagem);
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
        body: JSON.stringify({ email: emailUsuarioAtual })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
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