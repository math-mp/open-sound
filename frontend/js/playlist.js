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

const parametros = new URLSearchParams(window.location.search);
const idPlaylist = parametros.get('id');

const tituloNavbarPlaylist = document.getElementById('titulo-playlist');
const tituloSecaoPlaylist = document.getElementById('titulo-secao-playlist');
const gradeMusicasPlaylist = document.getElementById('grade-musicas-playlist');
const btnExcluirPlaylist = document.getElementById('btn-excluir-playlist');

let playlistAtual = null;

// Sem botão de tocar — mesma decisão de escopo de "Minhas Músicas":
// ouvir continua sendo só pelo catálogo principal.
function criarCardMusicaPlaylist(musica) {
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

  const btnRemover = document.createElement('button');
  btnRemover.className = 'btn-excluir-musica';
  btnRemover.textContent = 'Remover';

  btnRemover.addEventListener('click', async () => {
    const confirmou = confirm(`Remover "${musica.titulo}" desta playlist?`);
    if (!confirmou) return;

    btnRemover.disabled = true;
    btnRemover.textContent = 'Removendo...';

    try {
      const resposta = await fetchComAutenticacao(
        `http://localhost:3000/api/playlists/${idPlaylist}/musicas/${musica.id}`,
        { method: 'DELETE' }
      );
      const dados = await resposta.json();

      if (resposta.ok) {
        card.remove();
        if (gradeMusicasPlaylist && !gradeMusicasPlaylist.querySelector('.card-musica')) {
          carregarPlaylist();
        }
      } else {
        alert(dados.mensagem || 'Não foi possível remover a música.');
        btnRemover.disabled = false;
        btnRemover.textContent = 'Remover';
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnRemover.disabled = false;
      btnRemover.textContent = 'Remover';
    }
  });

  card.appendChild(capa);
  card.appendChild(info);
  card.appendChild(btnRemover);

  return card;
}

async function carregarPlaylist() {
  if (!idPlaylist) {
    if (gradeMusicasPlaylist) {
      gradeMusicasPlaylist.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'mensagem-lista';
      p.textContent = 'Playlist não especificada.';
      gradeMusicasPlaylist.appendChild(p);
    }
    return;
  }

  try {
    const resposta = await fetchComAutenticacao(`http://localhost:3000/api/playlists/${idPlaylist}`);
    const dados = await resposta.json();

    if (!resposta.ok) {
      if (gradeMusicasPlaylist) {
        gradeMusicasPlaylist.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'mensagem-lista';
        p.textContent = dados.mensagem || 'Não foi possível carregar a playlist.';
        gradeMusicasPlaylist.appendChild(p);
      }
      return;
    }

    playlistAtual = dados.playlist;

    if (tituloNavbarPlaylist) tituloNavbarPlaylist.textContent = playlistAtual.nome;
    if (tituloSecaoPlaylist) tituloSecaoPlaylist.textContent = playlistAtual.nome;

    // Favoritos não pode ser excluída — o servidor já bloqueia, mas o
    // botão nem aparece pra essa playlist específica.
    if (btnExcluirPlaylist) {
      btnExcluirPlaylist.classList.toggle('hidden', !!playlistAtual.eh_favoritos);
    }

    if (!gradeMusicasPlaylist) return;
    gradeMusicasPlaylist.innerHTML = '';

    if (!dados.musicas || dados.musicas.length === 0) {
      const p = document.createElement('p');
      p.className = 'mensagem-lista';
      p.textContent = 'Nenhuma música nesta playlist ainda.';
      gradeMusicasPlaylist.appendChild(p);
      return;
    }

    dados.musicas.forEach((musica) => {
      gradeMusicasPlaylist.appendChild(criarCardMusicaPlaylist(musica));
    });

  } catch (erro) {
    console.error('Erro ao carregar playlist:', erro);
    if (gradeMusicasPlaylist) {
      gradeMusicasPlaylist.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'mensagem-lista';
      p.textContent = 'Erro de conexão ao carregar a playlist.';
      gradeMusicasPlaylist.appendChild(p);
    }
  }
}

carregarPlaylist();

if (btnExcluirPlaylist) {
  btnExcluirPlaylist.addEventListener('click', async () => {
    if (!playlistAtual) return;

    const confirmou = confirm(`Excluir a playlist "${playlistAtual.nome}" permanentemente? As músicas em si não são apagadas, só saem desta playlist.`);
    if (!confirmou) return;

    btnExcluirPlaylist.disabled = true;

    try {
      const resposta = await fetchComAutenticacao(`http://localhost:3000/api/playlists/${idPlaylist}`, {
        method: 'DELETE'
      });
      const dados = await resposta.json();

      if (resposta.ok) {
        window.location.href = 'biblioteca.html';
      } else {
        alert(dados.mensagem || 'Não foi possível excluir a playlist.');
        btnExcluirPlaylist.disabled = false;
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnExcluirPlaylist.disabled = false;
    }
  });
}