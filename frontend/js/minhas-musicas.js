// === AUTENTICAÇÃO ===
// Duplicado de home.js/config.js de propósito — cada página HTML carrega
// seu próprio script, sem sistema de módulos.
const CHAVE_SESSAO = 'tokenSessao';

function obterTokenSessao() {
  return localStorage.getItem(CHAVE_SESSAO);
}

function estaLogado() {
  return !!obterTokenSessao();
}

async function fetchComAutenticacao(url, opcoes = {}) {
  const token = obterTokenSessao();
  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };

  const resposta = await fetch(url, { ...opcoes, headers });

  if (resposta.status === 401) {
    localStorage.removeItem(CHAVE_SESSAO);
    alert('Sua sessão expirou. Faça login novamente.');
    window.location.href = 'home.html';
  }

  return resposta;
}

// GATE: exige login, igual à página de config.
if (!estaLogado()) {
  window.location.href = 'home.html';
}

// === ELEMENTOS DO DOM ===
const listaMinhasMusicas = document.getElementById('lista-minhas-musicas');

const COOLDOWN_EXCLUSAO_MS = 24 * 60 * 60 * 1000;

// Mesmo formato "Xh Ym" usado no config.js pro cooldown de senha.
function formatarTempoRestante(ms) {
  const totalMinutos = Math.ceil(ms / 60000);
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}h ${minutos}min`;
}

// Template do card — mesmo visual de .card-musica da home, mas com botão
// de excluir (e sem botão de tocar: essa página é só gerenciar, não ouvir).
function criarCardMinhaMusica(musica) {
  const card = document.createElement('div');
  card.className = 'card-musica';

  const capa = document.createElement('img');
  capa.className = 'capa-musica';
  capa.src = musica.url_capa || '';
  capa.alt = `Capa de ${musica.titulo}`;

  const info = document.createElement('div');
  info.className = 'info-musica';

  const titulo = document.createElement('p');
  titulo.className = 'titulo-musica';
  titulo.textContent = musica.titulo;

  const artista = document.createElement('p');
  artista.className = 'artista-musica';
  artista.textContent = musica.artista;

  info.appendChild(titulo);
  info.appendChild(artista);

  const btnExcluir = document.createElement('button');
  btnExcluir.className = 'btn-excluir-musica';
  btnExcluir.textContent = 'Excluir';

  const mensagemCooldown = document.createElement('p');
  mensagemCooldown.className = 'mensagem-cooldown hidden';

  // Cooldown calculado a partir de criado_em (hora da postagem) — mesma
  // ideia do cooldown de senha, só que por música em vez de por conta.
  const tempoDesdePostagem = Date.now() - new Date(musica.criado_em).getTime();
  const restante = COOLDOWN_EXCLUSAO_MS - tempoDesdePostagem;

  if (restante > 0) {
    btnExcluir.disabled = true;
    mensagemCooldown.textContent = `Espere ${formatarTempoRestante(restante)} pra poder deletar a música.`;
    mensagemCooldown.classList.remove('hidden');
  }

  btnExcluir.addEventListener('click', async () => {
    const confirmou = confirm(`Excluir "${musica.titulo}" permanentemente?`);
    if (!confirmou) return;

    btnExcluir.disabled = true;
    btnExcluir.textContent = 'Excluindo...';

    try {
      const resposta = await fetchComAutenticacao(`http://localhost:3000/api/musicas/${musica.id}`, {
        method: 'DELETE'
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        card.remove();
        if (listaMinhasMusicas && !listaMinhasMusicas.querySelector('.card-musica')) {
          carregarMinhasMusicas(); // re-renderiza a mensagem de "nenhuma música"
        }
      } else if (dados.codigo === 'COOLDOWN_EXCLUSAO_ATIVO') {
        mensagemCooldown.textContent = `Espere ${formatarTempoRestante(dados.restanteMs)} pra poder deletar a música.`;
        mensagemCooldown.classList.remove('hidden');
        alert(dados.mensagem);
      } else {
        alert(dados.mensagem || 'Não foi possível excluir a música.');
        btnExcluir.disabled = false;
        btnExcluir.textContent = 'Excluir';
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnExcluir.disabled = false;
      btnExcluir.textContent = 'Excluir';
    }
  });

  card.appendChild(capa);
  card.appendChild(info);
  card.appendChild(btnExcluir);
  card.appendChild(mensagemCooldown);

  return card;
}

async function carregarMinhasMusicas() {
  if (!listaMinhasMusicas) return;

  try {
    const resposta = await fetchComAutenticacao('http://localhost:3000/api/musicas/minhas');
    const dados = await resposta.json();

    if (!resposta.ok) {
      listaMinhasMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = dados.mensagem || 'Não foi possível carregar suas músicas.';
      listaMinhasMusicas.appendChild(mensagem);
      return;
    }

    listaMinhasMusicas.innerHTML = '';

    if (!dados.musicas || dados.musicas.length === 0) {
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = 'Você ainda não enviou nenhuma música.';
      listaMinhasMusicas.appendChild(mensagem);
      return;
    }

    dados.musicas.forEach((musica) => {
      listaMinhasMusicas.appendChild(criarCardMinhaMusica(musica));
    });

  } catch (erro) {
    console.error('Erro ao carregar minhas músicas:', erro);
    listaMinhasMusicas.innerHTML = '';
    const mensagem = document.createElement('p');
    mensagem.className = 'mensagem-lista';
    mensagem.textContent = 'Erro de conexão ao carregar suas músicas.';
    listaMinhasMusicas.appendChild(mensagem);
  }
}

carregarMinhasMusicas();