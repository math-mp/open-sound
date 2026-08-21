// === ELEMENTOS DO DOM ===
const modal = document.getElementById('modal-registro');
const btnFechar = document.getElementById('btn-fechar');
const formRegistro = document.getElementById('form-registro');
const etapaRegistro = document.getElementById('etapa-registro');
const etapa2fa = document.getElementById('etapa-2fa');
const btnRegister = document.getElementById('btn-register');
const btnSubmitRegistro = formRegistro.querySelector('button[type="submit"]');

const btnConfirmar2FA = document.getElementById('btn-confirmar-2fa');
const btnReenviar2FA = document.getElementById('btn-reenviar-2fa');
const mensagemTimer = document.getElementById('mensagem-timer');

let emailUsuarioAtual = '';
let tempoRestante = 60;
let intervaloTimer = null;

// === CONTROLE DO MODAL ===

// Abre o popup ao clicar em Registre-se
btnRegister.addEventListener('click', () => {
  modal.classList.remove('hidden');
});

// Fecha o popup ao clicar no botão 'X'
btnFechar.addEventListener('click', () => {
  modal.classList.add('hidden');
});

// === 1. SUBMIT DO REGISTRO (ÚNICO EVENTO) ===
formRegistro.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (btnSubmitRegistro.disabled) return;

  btnSubmitRegistro.disabled = true;
  btnSubmitRegistro.textContent = 'Enviando...';

  const email = formRegistro.querySelector('input[type="email"]').value.trim();
  const password = formRegistro.querySelector('input[type="password"]').value.trim();

  try {
    const resposta = await fetch('http://localhost:3000/api/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const dados = await resposta.json();

    if (resposta.ok) {
      // Sucesso: guarda o e-mail e avança para a etapa do 2FA
      emailUsuarioAtual = email;
      
      etapaRegistro.classList.add('hidden');
      etapa2fa.classList.remove('hidden');

      iniciarTimer2FA();
      btnSubmitRegistro.disabled = false;
      btnSubmitRegistro.textContent = 'Enviar';

    } else if (resposta.status === 400) {
      // E-mail já cadastrado/verificado: avisa e fecha o modal
      alert(dados.mensagem);
      formRegistro.reset();
      modal.classList.add('hidden');

      btnSubmitRegistro.disabled = false;
      btnSubmitRegistro.textContent = 'Enviar';

    } else if (resposta.status === 429) {
      // Cooldown ativo (menos de 60s)
      alert(dados.mensagem);
      btnSubmitRegistro.disabled = false;
      btnSubmitRegistro.textContent = 'Enviar';

    } else {
      // Outros erros da API
      alert(dados.mensagem || 'Ocorreu um erro ao tentar registrar.');
      btnSubmitRegistro.disabled = false;
      btnSubmitRegistro.textContent = 'Enviar';
    }

  } catch (erro) {
    console.error('Erro de conexão:', erro);
    alert('Erro de conexão com o servidor.');
    btnSubmitRegistro.disabled = false;
    btnSubmitRegistro.textContent = 'Enviar';
  }
});

// === 2. VALIDAÇÃO DO 2FA ===
btnConfirmar2FA.addEventListener('click', async () => {
  const inputCodigo = document.querySelector('#etapa-2fa input');
  const codigoDigitado = inputCodigo.value.trim();

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
      modal.classList.add('hidden');
      
      // Reseta formulários e telas
      formRegistro.reset();
      inputCodigo.value = '';
      etapa2fa.classList.add('hidden');
      etapaRegistro.classList.remove('hidden');
      if (intervaloTimer) clearInterval(intervaloTimer);
    } else {
      alert(dados.mensagem);
    }
  } catch (erro) {
    console.error('Erro de conexão:', erro);
    alert('Não foi possível conectar ao servidor.');
  }
});

// === 3. TIMER E REENVIO DO 2FA ===
function iniciarTimer2FA() {
  tempoRestante = 60;
  btnReenviar2FA.disabled = true;
  mensagemTimer.textContent = `Aguarde ${tempoRestante}s para solicitar um novo código.`;

  if (intervaloTimer) clearInterval(intervaloTimer);

  intervaloTimer = setInterval(() => {
    tempoRestante--;

    if (tempoRestante <= 0) {
      clearInterval(intervaloTimer);
      btnReenviar2FA.disabled = false;
      mensagemTimer.textContent = '';
    } else {
      mensagemTimer.textContent = `Aguarde ${tempoRestante}s para solicitar um novo código.`;
    }
  }, 1000);
}

btnReenviar2FA.addEventListener('click', async () => {
  if (tempoRestante > 0) return;

  btnReenviar2FA.disabled = true;
  mensagemTimer.textContent = 'Enviando novo código...';

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
      mensagemTimer.textContent = dados.mensagem;
    }
  } catch (erro) {
    btnReenviar2FA.disabled = false;
    mensagemTimer.textContent = 'Erro ao conectar ao servidor.';
  }
});