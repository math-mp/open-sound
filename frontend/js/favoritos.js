// ================================================================
// FAVORITOS + "ADICIONAR À PLAYLIST" — universal (todas as páginas)
// ================================================================
// A barra do player já existe em todas as páginas (player.js monta o
// que faltar), mas os dois botões dela — o coração e o "＋" — só
// respondiam na home, porque a lógica inteira vivia dentro do home.js.
// Navegar para a biblioteca, playlist, perfil ou configurações deixava
// os dois botões sem função nenhuma.
//
// Este arquivo tira essa lógica de lá e entrega para qualquer página:
// basta carregá-lo DEPOIS do player.js. Além dos listeners da barra,
// ele monta o modal "Adicionar à Playlist" quando a página não traz o
// markup (mesma estratégia do player.js com o painel da fila), para não
// repetir o mesmo HTML uma vez por arquivo.
//
// O que o home.js (e qualquer página) continua usando daqui:
//   pintarCoracao / atualizarTodosCoracoes / alternarFavorito /
//   abrirModalAddPlaylist / carregarFavoritos / limparFavoritosLocais
//
// A sessão é lida direto do localStorage em vez de chamar o estaLogado()
// de cada página: assim este arquivo funciona sozinho e não depende da
// ordem em que o script da página foi avaliado.

const API_FAVORITOS = 'http://localhost:3000';
const CHAVE_TOKEN_FAVORITOS = 'tokenSessao';

// IDs (números) das músicas favoritadas pela conta logada.
let idsFavoritos = new Set();
// IDs com uma requisição em andamento — evita duplo clique no coração.
const favoritosPendentes = new Set();
// Música que o modal "Adicionar à Playlist" está tratando agora.
let musicaParaAdicionar = null;

// ============================================================
// SESSÃO
// ============================================================

function tokenDaSessao() {
  return localStorage.getItem(CHAVE_TOKEN_FAVORITOS);
}

function sessaoAtiva() {
  return !!tokenDaSessao();
}

// Delegado para o fetchComAutenticacao() da página quando ela tem um
// (todas têm), para que a limpeza de sessão em 401 e o alert de "sessão
// expirada" continuem exatamente como cada página já fazia.
async function buscarComSessao(url, opcoes = {}) {
  if (typeof fetchComAutenticacao === 'function') {
    return fetchComAutenticacao(url, opcoes);
  }

  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${tokenDaSessao()}` };
  const resposta = await fetch(url, { ...opcoes, headers });

  if (resposta.status === 401) {
    localStorage.removeItem(CHAVE_TOKEN_FAVORITOS);
    if (window.OS) OS.limparCache();
    alert('Sua sessão expirou. Faça login novamente.');
    window.location.href = 'home.html';
  }

  return resposta;
}

// Visitor precisa entrar: na home o modal de login está no HTML, nas
// outras páginas não existe — aí a sessão só começa de fato na home.
function pedirLogin(mensagem) {
  alert(mensagem);

  const modalLogin = document.getElementById('modal-login');
  if (modalLogin) {
    modalLogin.classList.remove('hidden');
    return;
  }

  window.location.href = 'home.html';
}

// ============================================================
// CORAÇÕES
// ============================================================

function criarBotaoIcone(classeExtra, texto, rotulo) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = classeExtra ? `btn-icone ${classeExtra}` : 'btn-icone';
  botao.textContent = texto;
  botao.setAttribute('aria-label', rotulo);
  botao.title = rotulo;
  return botao;
}

function pintarCoracao(botao, favoritado) {
  if (!botao) return;
  const rotulo = favoritado ? 'Remover dos favoritos' : 'Favoritar';
  botao.classList.toggle('ativo', favoritado);
  botao.textContent = favoritado ? '♥' : '♡';
  botao.setAttribute('aria-label', rotulo);
  botao.title = rotulo;
}

// O player.js repinta os corações já ao retomar a música salva do
// localStorage, ou seja, ele chega aqui antes deste arquivo ter finished
// de ser avaliado. Sem o try/catch, o `let idsFavoritos` ainda estaria no
// escopo temporal e a leitura estouraria "Cannot access before
// initialization" — o mesmo motivo do guard que o player.js faz antes de
// chamar atualizarTodosCoracoes().
function favoritosAtuais() {
  try {
    return idsFavoritos;
  } catch (erro) {
    return new Set();
  }
}

// Repinta o coração dos cards da página e o da barra do player. Os dois
// são procurados na hora (e não guardados em const no load) porque o
// player.js pode ter montado a barra depois deste arquivo rodar.
function atualizarTodosCoracoes() {
  const favoritos = favoritosAtuais();

  document.querySelectorAll('.btn-favoritar-destaque').forEach((botao) => {
    pintarCoracao(botao, favoritos.has(Number(botao.dataset.musicaId)));
  });

  const musica = musicaTocandoAgora();
  pintarCoracao(
    document.getElementById('player-favoritar'),
    !!musica && favoritos.has(Number(musica.id))
  );
}

// musicaNoPlayer é o `let` do player.js. O typeof protege as páginas
// que carregassem este arquivo sem o player; nos cliques (e na
// repintagem) ele já existe.
function musicaTocandoAgora() {
  return typeof musicaNoPlayer === 'undefined' ? null : musicaNoPlayer;
}

// Carga silenciosa: usa fetch puro (e não buscarComSessao) pra que um
// token expirado NÃO dispare o alert de "sessão expirada" só de abrir a
// página.
async function carregarFavoritos() {
  idsFavoritos = new Set();

  if (sessaoAtiva()) {
    try {
      const resposta = await fetch(`${API_FAVORITOS}/api/musicas/favoritos/ids`, {
        headers: { Authorization: `Bearer ${tokenDaSessao()}` }
      });
      if (resposta.ok) {
        const dados = await resposta.json();
        (dados.ids || []).forEach((id) => idsFavoritos.add(Number(id)));
      }
    } catch (erro) {
      console.error('Erro ao carregar favoritos:', erro);
    }
  }

  atualizarTodosCoracoes();
}

// Logout, sessão rejeitada ou token limpo em outra aba: o coração não
// pode continuar marcado com o que era favorido pela conta que saiu.
function limparFavoritosLocais() {
  favoritosAtuais().clear();
  atualizarTodosCoracoes();
}

document.addEventListener('opensound:sessao-invalida', limparFavoritosLocais);

// Atualização otimista: o coração muda na hora e volta atrás se o servidor falhar.
async function alternarFavorito(musica) {
  if (!musica || !musica.id) return;

  if (!sessaoAtiva()) {
    pedirLogin('Faça login para favoritar músicas.');
    return;
  }

  const id = Number(musica.id);
  if (favoritosPendentes.has(id)) return;

  const eraFavorita = idsFavoritos.has(id);
  favoritosPendentes.add(id);

  if (eraFavorita) idsFavoritos.delete(id);
  else idsFavoritos.add(id);
  atualizarTodosCoracoes();

  try {
    const resposta = await buscarComSessao(`${API_FAVORITOS}/api/musicas/${id}/favoritar`, {
      method: eraFavorita ? 'DELETE' : 'POST'
    });
    if (!resposta.ok) throw new Error(String(resposta.status));
  } catch (erro) {
    if (eraFavorita) idsFavoritos.add(id);
    else idsFavoritos.delete(id);
    atualizarTodosCoracoes();
    // Em 401 o buscarComSessao já avisou — não duplica o alert.
    if (erro.message !== '401') alert('Não foi possível atualizar seus favoritos.');
  } finally {
    favoritosPendentes.delete(id);
  }
}

// ============================================================
// MODAL "ADICIONAR À PLAYLIST"
// ============================================================

// Só a home traz esse modal no HTML. Nas outras páginas ele é montado
// aqui, para o botão ＋ da barra do player funcionar em qualquer lugar
// sem precisar repetir o mesmo markup em cada arquivo.
function montarModalAddPlaylist() {
  if (document.getElementById('modal-add-playlist') || !document.body) return;

  const modal = document.createElement('div');
  modal.id = 'modal-add-playlist';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="conteudo-modal">
      <button id="btn-fechar-add-playlist" class="btn-fechar" aria-label="Fechar">×</button>
      <div class="etapa">
        <h2>Adicionar à Playlist</h2>
        <div id="lista-playlists-modal" class="lista-playlists-modal">
          <p class="mensagem-lista">Carregando...</p>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function mostrarMensagemModalPlaylists(texto) {
  const lista = document.getElementById('lista-playlists-modal');
  if (!lista) return;
  lista.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'mensagem-lista';
  p.textContent = texto;
  lista.appendChild(p);
}

// textContent em tudo: nome de playlist é texto digitado pelo usuário.
function criarItemPlaylistModal(playlist, musica) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'item-playlist-modal';

  let capa;
  if (playlist.url_capa) {
    capa = document.createElement('img');
    capa.src = playlist.url_capa;
    capa.alt = '';
  } else {
    capa = document.createElement('span');
    capa.textContent = playlist.eh_favoritos ? '⭐' : '🎵';
  }
  capa.classList.add('item-playlist-capa');

  const nome = document.createElement('span');
  nome.className = 'item-playlist-nome';
  nome.textContent = playlist.nome;

  const estado = document.createElement('span');
  estado.className = 'item-playlist-estado';

  if (playlist.contem_musica) {
    item.classList.add('adicionada');
    estado.textContent = '✔ Já está aqui';
  }

  item.appendChild(capa);
  item.appendChild(nome);
  item.appendChild(estado);

  item.addEventListener('click', async () => {
    if (item.classList.contains('adicionada') || item.disabled) return;
    item.disabled = true;

    try {
      const resposta = await buscarComSessao(`${API_FAVORITOS}/api/playlists/${playlist.id}/musicas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicaId: musica.id })
      });
      if (!resposta.ok) throw new Error(String(resposta.status));

      item.classList.add('adicionada');
      estado.textContent = '✔ Adicionada';

      // Adicionar em "Favoritos" pelo modal equivale a favoritar: o coração acompanha.
      if (playlist.eh_favoritos) {
        idsFavoritos.add(Number(musica.id));
        atualizarTodosCoracoes();
      }
    } catch (erro) {
      if (erro.message !== '401') alert('Não foi possível adicionar a música à playlist.');
    } finally {
      item.disabled = false;
    }
  });

  return item;
}

function montarDicaCriarPlaylist(lista) {
  const dica = document.createElement('p');
  dica.className = 'link-cadastro';
  dica.appendChild(document.createTextNode('Quer outra playlist? '));
  const link = document.createElement('a');
  link.href = 'biblioteca.html';
  link.textContent = 'Crie na Biblioteca';
  dica.appendChild(link);
  lista.appendChild(dica);
}

async function abrirModalAddPlaylist(musica) {
  if (!musica || !musica.id) return;

  if (!sessaoAtiva()) {
    pedirLogin('Faça login para adicionar músicas a playlists.');
    return;
  }

  montarModalAddPlaylist();

  musicaParaAdicionar = musica;
  const modal = document.getElementById('modal-add-playlist');
  if (modal) modal.classList.remove('hidden');
  mostrarMensagemModalPlaylists('Carregando...');

  try {
    const resposta = await buscarComSessao(`${API_FAVORITOS}/api/playlists?musicaId=${musica.id}`);
    const dados = await resposta.json();

    // Se o usuário fechou o modal ou abriu outra música enquanto carregava, descarta.
    if (musicaParaAdicionar !== musica) return;

    if (!resposta.ok) {
      mostrarMensagemModalPlaylists(dados.mensagem || 'Não foi possível carregar suas playlists.');
      return;
    }

    const lista = document.getElementById('lista-playlists-modal');
    if (!lista) return;

    lista.innerHTML = '';
    (dados.playlists || []).forEach((playlist) => {
      lista.appendChild(criarItemPlaylistModal(playlist, musica));
    });

    montarDicaCriarPlaylist(lista);

  } catch (erro) {
    console.error('Erro ao carregar playlists:', erro);
    if (musicaParaAdicionar === musica) {
      mostrarMensagemModalPlaylists('Erro de conexão ao carregar suas playlists.');
    }
  }
}

function fecharModalAddPlaylist() {
  const modal = document.getElementById('modal-add-playlist');
  if (modal) modal.classList.add('hidden');
  musicaParaAdicionar = null;
}

// ============================================================
// LIGAÇÃO COM A BARRA DO PLAYER
// ============================================================

// Os dois botões agem sobre a música que está tocando — a mesma regra
// valia na home. Busca os elementos agora porque o player.js monta a
// barra (e o painel da fila) no load dele.
document.addEventListener('DOMContentLoaded', () => {
  montarModalAddPlaylist();

  const favoritar = document.getElementById('player-favoritar');
  if (favoritar) {
    favoritar.addEventListener('click', () => {
      const musica = musicaTocandoAgora();
      if (musica) alternarFavorito(musica);
    });
  }

  const addPlaylist = document.getElementById('player-add-playlist');
  if (addPlaylist) {
    addPlaylist.addEventListener('click', () => {
      const musica = musicaTocandoAgora();
      if (musica) abrirModalAddPlaylist(musica);
    });
  }

  const fechar = document.getElementById('btn-fechar-add-playlist');
  if (fechar) fechar.addEventListener('click', fecharModalAddPlaylist);

  carregarFavoritos();
});
