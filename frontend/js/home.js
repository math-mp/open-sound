//===aparição modal==

const modal = document.getElementById('modal-registro');
const btnFechar = document.getElementById('btn-fechar');
const formRegistro = document.getElementById('form-registro');
const etapaRegistro = document.getElementById('etapa-registro');
const etapa2fa = document.getElementById('etapa-2fa');
const btnRegister = document.getElementById('btn-register');

// abre o popup ao clicar em registre-se
btnRegister.addEventListener('click', () => {
  modal.classList.remove('hidden');
});

// Fechar o popup ao clicar no botão 'X'
btnFechar.addEventListener('click', () => {
  modal.classList.add('hidden');
});

// Alternar da tela de registro para a tela de 2FA ao enviar o formulário
formRegistro.addEventListener('submit', async (event) => {
  event.preventDefault();

  emailDigitado = formRegistro.querySelector('input[type="email"]').value;
  const senhaDigitada = formRegistro.querySelector('input[type="password"]').value;

  try {
    const resposta = await fetch('http://localhost:3000/api/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailDigitado, password: senhaDigitada })
    });

    const dados = await resposta.json();

    // SÓ AVANÇA PARA O 2FA SE O SERVIDOR RETORNAR SUCESSO (Status 200)
    if (resposta.ok) {
      alert('Código enviado para o seu e-mail!');
      
      // Oculta a tela de cadastro e mostra a tela de 2FA
      etapaRegistro.classList.add('hidden');
      etapa2fa.classList.remove('hidden');
    } else {
      // SE O E-MAIL JÁ EXISTIR (Status 400), EXIBE A MENSAGEM E PERMANECE NA TELA ATUAL
      alert(dados.mensagem); 
      // Nenhuma alteração nas classes CSS é feita aqui, então o usuário continua no cadastro
    }
  } catch (erro) {
    alert('Erro de conexão com o servidor. Tente novamente mais tarde.');
  }
});

//===retorno da api de registro===

let emailCadastrado = "";

formRegistro.addEventListener('submit', async (event) => {
  event.preventDefault();

  emailCadastrado = formRegistro.querySelector('input[type="email"]').value;
  const password = formRegistro.querySelector('input[type="password"]').value;

  try {
    const resposta = await fetch('http://localhost:3000/api/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailCadastrado, password })
    });

    const dados = await resposta.json();

    if (resposta.ok) {
      etapaRegistro.classList.add('hidden');
      etapa2fa.classList.remove('hidden');
    } else {
      alert(dados.mensagem);
    }
  } catch (erro) {
    alert('Erro de conexão com o servidor.');
  }
});

//===validção 2fa===

const btnConfirmar2FA = document.getElementById('btn-confirmar-2fa');

btnConfirmar2FA.addEventListener('click', async () => {
  console.log('Botão clicado!'); // Teste simples para ver se o evento dispara

  const codigoDigitado = document.querySelector('#etapa-2fa input').value.trim();

  try {
    const resposta = await fetch('http://localhost:3000/api/validar-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailDigitado, codigo: codigoDigitado })
    });

    const dados = await resposta.json();

    if (resposta.ok) {
      alert('Conta validada com sucesso!');

      modal.classList.add('hidden');
    } else {
      alert(dados.mensagem);
    }
  } catch (erro) {
    console.error('Erro de conexão:', erro);
    alert('Não foi possível conectar ao servidor.');
  }
});

//===reenvio de codigo 2fa===

// Seleciona o botão de reenviar código no HTML
const btnReenviar2FA = document.getElementById('btn-reenviar-2fa'); 

btnReenviar2FA.addEventListener('click', async () => {
  if (!emailDigitado) {
    alert('Erro: e-mail não identificado. Recarregue a página e tente novamente.');
    return;
  }

  // Desabilita temporariamente o botão para evitar múltiplos cliques
  btnReenviar2FA.disabled = true;
  btnReenviar2FA.textContent = 'Enviando...';

  try {
    const resposta = await fetch('http://localhost:3000/api/reenviar-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailDigitado })
    });

    const dados = await resposta.json();
    alert(dados.mensagem);

  } catch (erro) {
    alert('Erro ao se conectar com o servidor para reenviar o código.');
  } finally {
    // Reabilita o botão após a resposta
    btnReenviar2FA.disabled = false;
    btnReenviar2FA.textContent = 'Reenviar código';
  }
});