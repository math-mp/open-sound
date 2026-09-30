const CHAVE_SESSAO = 'tokenSessao';
function obterTokenSessao() { return localStorage.getItem(CHAVE_SESSAO); }
function estaLogado() { return !!obterTokenSessao(); }

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

if (!estaLogado()) {
  window.location.href = 'home.html';
}

const gradePlaylists = document.getElementById('grade-playlists');
const btnNovaPlaylist = document.getElementById('btn-nova-playlist');
const modalNovaPlaylist = document.getElementById('modal-nova-playlist');
const btnFecharNovaPlaylist = document.getElementById('btn-fechar-nova-playlist');
const formNovaPlaylist = document.getElementById('form-nova-playlist');
const campoPlaylistNome = document.getElementById('playlist-nome');
const campoPlaylistCapa = document.getElementById('playlist-capa');

// Clicar no card leva pra playlist.html, que mostra as músicas. O botão de
// tocar vive dentro do card, mas para a propagação do clique pra não navegar.
function criarCardPlaylist(playlist) {
  const card = document.createElement('div');
  card.className = 'card-playlist';

  let capa;
  if (playlist.url_capa) {
    capa = document.createElement('img');
    capa.className = 'capa-musica';
    capa.src = playlist.url_capa;
    capa.alt = `Capa de ${playlist.nome}`;
  } else {
    capa = document.createElement('div');
    capa.className = 'capa-musica capa-vazia';
    capa.textContent = playlist.eh_favoritos ? '⭐' : '🎵';
  }

  const info = document.createElement('div');
  info.className = 'info-musica';

  const nome = document.createElement('p');
  nome.className = 'titulo-musica';
  nome.textContent = playlist.nome;

  const contagem = document.createElement('p');
  contagem.className = 'artista-musica';
  const total = Number(playlist.total_musicas) || 0;
  contagem.textContent = `${total} ${total === 1 ? 'música' : 'músicas'}`;

  info.appendChild(nome);
  info.appendChild(contagem);

  card.appendChild(capa);
  card.appendChild(info);

  // Botão de tocar: joga todas as músicas da playlist na fila e começa pela
  // primeira. Fica escondido na playlist vazia — não há o que tocar.
  const btnTocar = document.createElement('button');
  btnTocar.type = 'button';
  btnTocar.className = 'btn-play-card';
  btnTocar.textContent = '▶ Tocar';
  btnTocar.title = `Tocar ${playlist.nome}`;
  btnTocar.setAttribute('aria-label', `Tocar a playlist ${playlist.nome}`);
  btnTocar.classList.toggle('hidden', total === 0);

  btnTocar.addEventListener('click', async (evento) => {
    // O card inteiro navega pra playlist.html; sem isso, tocar também
    // navegaria e a música nem começaria.
    evento.stopPropagation();
    if (btnTocar.disabled) return;

    btnTocar.disabled = true;
    btnTocar.textContent = 'Carregando...';

    try {
      const resposta = await fetchComAutenticacao(`http://localhost:3000/api/playlists/${playlist.id}`);
      const dados = await resposta.json();

      if (!resposta.ok) {
        alert(dados.mensagem || 'Não foi possível tocar esta playlist.');
        return;
      }

      if (!tocarListaDeMusicas(dados.musicas)) {
        alert('Esta playlist não tem músicas para tocar.');
      }
    } catch (erro) {
      console.error('Erro ao tocar playlist:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      btnTocar.disabled = false;
      btnTocar.textContent = '▶ Tocar';
    }
  });

  card.appendChild(btnTocar);

  card.addEventListener('click', () => {
    window.location.href = `playlist.html?id=${playlist.id}`;
  });

  return card;
}

async function carregarPlaylists() {
  if (!gradePlaylists) return;

  try {
    const resposta = await fetchComAutenticacao('http://localhost:3000/api/playlists');
    const dados = await resposta.json();

    if (!resposta.ok) {
      gradePlaylists.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'mensagem-lista';
      p.textContent = dados.mensagem || 'Não foi possível carregar suas playlists.';
      gradePlaylists.appendChild(p);
      return;
    }

    gradePlaylists.innerHTML = '';
    dados.playlists.forEach((playlist) => {
      gradePlaylists.appendChild(criarCardPlaylist(playlist));
    });

  } catch (erro) {
    console.error('Erro ao carregar playlists:', erro);
    gradePlaylists.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'mensagem-lista';
    p.textContent = 'Erro de conexão ao carregar suas playlists.';
    gradePlaylists.appendChild(p);
  }
}

carregarPlaylists();

if (btnNovaPlaylist && modalNovaPlaylist) {
  btnNovaPlaylist.addEventListener('click', () => modalNovaPlaylist.classList.remove('hidden'));
}

if (btnFecharNovaPlaylist && modalNovaPlaylist) {
  btnFecharNovaPlaylist.addEventListener('click', () => {
    modalNovaPlaylist.classList.add('hidden');
    if (formNovaPlaylist) formNovaPlaylist.reset();
  });
}

if (formNovaPlaylist) {
  formNovaPlaylist.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nome = campoPlaylistNome ? campoPlaylistNome.value.trim() : '';
    const arquivoCapa = campoPlaylistCapa && campoPlaylistCapa.files[0] ? campoPlaylistCapa.files[0] : null;

    if (!nome) {
      alert('Digite um nome para a playlist.');
      return;
    }

    const dadosFormulario = new FormData();
    dadosFormulario.append('nome', nome);
    if (arquivoCapa) dadosFormulario.append('capa', arquivoCapa);

    const btnSubmit = formNovaPlaylist.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Criando...';
    }

    try {
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/playlists', {
        method: 'POST',
        body: dadosFormulario
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        if (modalNovaPlaylist) modalNovaPlaylist.classList.add('hidden');
        formNovaPlaylist.reset();
        carregarPlaylists();
      } else {
        alert(dados.mensagem || 'Não foi possível criar a playlist.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Criar';
      }
    }
  });
}