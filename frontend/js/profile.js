// ================================================================
// profile.js — conectado às rotas reais de backend/perfil.routes.js.
// Curtidas foi removido do front (a rota PUT /api/perfil/curtidas
// continua existindo no back-end, só não é mais chamada daqui).
// A edição de foto/bio agora vive na janela "Configurações";
// a janela "Perfil" só exibe.
// ================================================================

const API_BASE = 'http://localhost:3000';
const CHAVE_SESSAO = 'tokenSessao';
const BIO_MAX = 220; // mesmo limite de backend/perfil.routes.js (LIMITES.BIO_MAX)

// ================================================================
// AUTENTICAÇÃO
// ================================================================

function obterTokenSessao() {
    return localStorage.getItem(CHAVE_SESSAO);
}

function estaLogado() {
    return !!obterTokenSessao();
}

// Token rejeitado, logout em outra aba ou revalidação que tomou 401:
// o perfil deixa de ter dono e volta para a tela de login, em vez de
// continuar exibindo o cache de 7 dias como se fosse válido.
function encerrarSessaoLocal() {
    localStorage.removeItem(CHAVE_SESSAO);
    if (window.OS) OS.limparCache();
    mostrarBloqueado();
}

document.addEventListener('opensound:sessao-invalida', encerrarSessaoLocal);

async function fetchComAutenticacao(url, opcoes = {}) {
    const token = obterTokenSessao();
    const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };
    const resposta = await fetch(url, { ...opcoes, headers });
    if (resposta.status === 401) {
        encerrarSessaoLocal();
    }
    return resposta;
}

// ================================================================
// CACHE curto de GET /api/musicas
// ================================================================
// O perfil (avatar, nome, tema, bio, favorita, playlists) NÃO usa mais
// um cache próprio: quem cuida disso agora é o sessao.js, compartilhado
// com as outras páginas e pintado antes do primeiro paint. Aqui sobra
// só o cache do catálogo público de músicas.

function montarChaveCache(tipo) {
    return `opensound_cache_${tipo}_${(obterTokenSessao() || 'sem-sessao').slice(-12)}`;
}

function obterDoCache(chave, ttlMs) {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    try {
        const { dados, salvoEm } = JSON.parse(bruto);
        if (Date.now() - salvoEm > ttlMs) { localStorage.removeItem(chave); return null; }
        return dados;
    } catch { localStorage.removeItem(chave); return null; }
}

function salvarNoCache(chave, dados) {
    localStorage.setItem(chave, JSON.stringify({ dados, salvoEm: Date.now() }));
}

// ================================================================
// ELEMENTOS DO DOM
// ================================================================

const elBloqueado = document.getElementById('perfil-bloqueado');
const elConteudo = document.getElementById('perfil-conteudo');

// Janela 1 — Perfil (só exibição)
const elNome = document.getElementById('perfil-nome');
const elUsuario = document.getElementById('perfil-usuario');
const elBioExibicao = document.getElementById('perfil-bio');
const elEstatisticas = document.getElementById('perfil-estatisticas');

// Janela 2 — Configurações
const elConfigAvatarInput = document.getElementById('config-avatar-input');
const elConfigAvatarEnviar = document.getElementById('config-avatar-enviar');
const elConfigAvatarRemover = document.getElementById('config-avatar-remover');
const elConfigAvatarStatus = document.getElementById('config-avatar-status');

const elConfigBioForm = document.getElementById('config-bio-form');
const elConfigBioTextarea = document.getElementById('config-bio-textarea');
const elConfigBioContador = document.getElementById('config-bio-contador');
const elConfigBioStatus = document.getElementById('config-bio-status');

// Janela 3 — Biblioteca
const elFavoritaFiltro = document.getElementById('perfil-favorita-filtro');
const elFavoritaResultados = document.getElementById('perfil-favorita-resultados');
const elFavoritaSelecionada = document.getElementById('perfil-favorita-selecionada');

const elPlaylistsLista = document.getElementById('perfil-playlists-lista');

// ================================================================
// ESTADO EM MEMÓRIA
// ================================================================

let catalogoMusicas = [];
let favoritaAtual = null;

function mostrarBloqueado() {
    elBloqueado.classList.remove('hidden');
    elConteudo.classList.add('hidden');
}

function mostrarConteudo() {
    elBloqueado.classList.add('hidden');
    elConteudo.classList.remove('hidden');
}

function exibirMensagemLista(elemento, mensagem) {
    elemento.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'perfil-estado-mensagem';
    item.textContent = mensagem;
    elemento.appendChild(item);
}

// ================================================================
// GET /api/perfil — identidade, favorita, playlists e estatísticas.
// A mesma resposta alimenta a janela Perfil (exibição) e a janela
// Configurações (valores iniciais dos campos editáveis).
//
// O dado vem de OS.revalidar(), que já tem o cache pintado antes do
// paint e faz UMA requisição compartilhada no servidor (a home usa a
// mesma rota, então as duas páginas nunca correm em paralelo).
// ================================================================

function renderizarPerfil(perfil) {
    const { usuario, favorita, playlists, estatisticas } = perfil;

    const nomeExibido = usuario.eh_artista && usuario.nome_artista ? usuario.nome_artista : usuario.nome_usuario || 'Sem nome';
    elNome.textContent = nomeExibido;
    
    // Mostra @nome_usuario abaixo do nome
    if (usuario.nome_usuario) {
        elUsuario.textContent = `@${usuario.nome_usuario}`;
        elUsuario.style.display = 'block';
    } else {
        elUsuario.style.display = 'none';
    }
    
    elBioExibicao.textContent = usuario.bio || '';

    // Avatar e nome não são mais escritos aqui: quem pinta (e quem
    // guarda em cache) é o sessao.js, no mesmo formato das outras
    // páginas. Só o botão "Remover" depende do que veio do servidor.
    elConfigAvatarRemover.classList.toggle('hidden', !usuario.avatar_url);

    elEstatisticas.textContent = usuario.eh_artista
        ? `${estatisticas.musicas_enviadas} música(s) enviada(s) · ${estatisticas.reproducoes} reprodução(ões)`
        : '';

    // Só substitui o texto do campo se o usuário não estiver com o
    // foco nele agora (evita apagar o que a pessoa está digitando se
    // o cache/refresh disparar no meio da edição).
    if (document.activeElement !== elConfigBioTextarea) {
        elConfigBioTextarea.value = usuario.bio || '';
        atualizarContadorBio();
    }

    favoritaAtual = favorita;
    elFavoritaSelecionada.textContent = favorita ? `Favorita: ${favorita.titulo}` : 'Nenhuma escolhida ainda.';

    renderizarPlaylists(playlists);
}

// O cache do sessao.js é opcional: sem ele (módulo não carregado) a
// página volta a buscar tudo direto do backend, como sempre fez.
const perfilDoCache = () => (window.OS ? OS.perfilCacheado() : null);
const perfilAntigo = () => (window.OS ? OS.perfilCacheado(OS.IDADE_MAXIMA_CACHE) : null);

function carregarPerfil({ forcar = false } = {}) {
    if (!forcar) {
        const emCache = perfilDoCache();
        if (emCache) { renderizarPerfil(emCache); return Promise.resolve(); }
    }

    if (!window.OS) {
        return fetchComAutenticacao(`${API_BASE}/api/perfil`).then((resposta) => {
            if (!resposta.ok) { elNome.textContent = 'Não foi possível carregar o perfil'; return null; }
            return resposta.json().then(({ perfil }) => { renderizarPerfil(perfil); return perfil; });
        });
    }

    return OS.revalidar({ forcar }).then((perfil) => {
        if (perfil) { renderizarPerfil(perfil); return; }

        // Revalidação falhou. Melhor exibir o último estado conhecido
        // (ainda que velho) do que deixar o painel pela metade sem
        // nenhuma indicação de que algo deu errado.
        const velho = perfilAntigo();
        if (velho) { renderizarPerfil(velho); return; }

        elNome.textContent = 'Não foi possível carregar o perfil';
        console.error('Não foi possível carregar o perfil.');
    });
}

// ================================================================
// CONFIGURAÇÕES — BIOGRAFIA
// ================================================================

function atualizarContadorBio() {
    elConfigBioContador.textContent = `${elConfigBioTextarea.value.length}/${BIO_MAX}`;
}

elConfigBioTextarea.addEventListener('input', atualizarContadorBio);

elConfigBioForm.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const texto = elConfigBioTextarea.value.trim();

    elConfigBioStatus.textContent = 'Salvando...';
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/bio`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bio: texto })
        });
        const dados = await resposta.json().catch(() => null);

        if (!resposta.ok) {
            elConfigBioStatus.textContent = dados?.mensagem || 'Não foi possível salvar a bio.';
            return;
        }

        elConfigBioStatus.textContent = 'Biografia salva ✓';
        elBioExibicao.textContent = dados.bio || '';
        if (window.OS) OS.invalidar();
    } catch (erro) {
        elConfigBioStatus.textContent = 'Erro de conexão ao salvar a bio.';
        console.error(erro);
    }
});

// ================================================================
// CONFIGURAÇÕES — FOTO DE PERFIL
// ================================================================

elConfigAvatarEnviar.addEventListener('click', () => elConfigAvatarInput.click());

elConfigAvatarInput.addEventListener('change', async () => {
    const arquivo = elConfigAvatarInput.files[0];
    if (!arquivo) return;

    const formulario = new FormData();
    formulario.append('avatar', arquivo);

    elConfigAvatarStatus.textContent = 'Enviando...';
    try {
        // Não definir Content-Type manualmente com FormData: o navegador
        // monta o boundary do multipart sozinho.
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/avatar`, {
            method: 'POST',
            body: formulario
        });
        const dados = await resposta.json().catch(() => null);

        if (!resposta.ok) {
            elConfigAvatarStatus.textContent = dados?.mensagem || 'Não foi possível enviar a foto.';
            return;
        }

        elConfigAvatarRemover.classList.remove('hidden');
        elConfigAvatarStatus.textContent = 'Foto atualizada ✓';
        if (window.OS) { OS.aoTrocarAvatar(dados.avatar_url); OS.invalidar(); }
    } catch (erro) {
        elConfigAvatarStatus.textContent = 'Erro de conexão ao enviar a foto.';
        console.error(erro);
    } finally {
        elConfigAvatarInput.value = '';
    }
});

elConfigAvatarRemover.addEventListener('click', async () => {
    elConfigAvatarStatus.textContent = 'Removendo...';
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/avatar`, { method: 'DELETE' });
        if (!resposta.ok) { elConfigAvatarStatus.textContent = 'Não foi possível remover a foto.'; return; }

        elConfigAvatarRemover.classList.add('hidden');
        elConfigAvatarStatus.textContent = 'Foto removida.';
        if (window.OS) { OS.aoTrocarAvatar(null); OS.invalidar(); }
    } catch (erro) {
        elConfigAvatarStatus.textContent = 'Erro de conexão ao remover a foto.';
        console.error(erro);
    }
});

// ================================================================
// TEMA CLARO/ESCURO — salvo no perfil do usuário (backend)
// ================================================================

const elTemaBtn = document.getElementById('config-tema-btn');

function temaAtual() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function atualizarTextoBotaoTema() {
    elTemaBtn.textContent = temaAtual() === 'light' ? '☀️ Claro' : '🌙 Escuro';
}

function aplicarTema(tema) {
    // O atributo no <html> e o localStorage são do sessao.js, que já
    // aplicou o tema salvo antes do paint (inclusive nas outras páginas).
    if (window.OS) OS.aplicarTema(tema);
    else if (tema === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    atualizarTextoBotaoTema();
}

// O rótulo acompanha mudanças de origem externa (outra aba, home,
// revalidação do perfil) sem duplicar a regra de apply.
document.addEventListener('opensound:tema', atualizarTextoBotaoTema);

async function salvarTemaNoBackend(tema) {
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

elTemaBtn.addEventListener('click', async () => {
    const novoTema = temaAtual() === 'light' ? 'dark' : 'light';
    aplicarTema(novoTema);
    await salvarTemaNoBackend(novoTema);
});

// ================================================================
// CATÁLOGO (GET /api/musicas — público) — só alimenta a Favorita
// agora que Curtidas saiu.
// ================================================================

async function carregarCatalogo() {
    const chave = montarChaveCache('catalogo-musicas');
    const emCache = obterDoCache(chave, 2 * 60 * 1000);
    if (emCache !== null) { catalogoMusicas = emCache; aplicarCatalogoCarregado(); return; }

    try {
        const resposta = await fetch(`${API_BASE}/api/musicas`);
        if (!resposta.ok) throw new Error('Falha ao carregar catálogo.');
        const { musicas } = await resposta.json();
        catalogoMusicas = musicas;
        salvarNoCache(chave, musicas);
        aplicarCatalogoCarregado();
    } catch (erro) {
        exibirMensagemLista(elFavoritaResultados, 'Não foi possível carregar o catálogo.');
        console.error('Erro ao carregar catálogo:', erro);
    }
}

function aplicarCatalogoCarregado() {
    elFavoritaFiltro.disabled = false;
    renderizarResultadosFavorita(catalogoMusicas);
}

elFavoritaFiltro.addEventListener('input', () => {
    const termo = elFavoritaFiltro.value.trim().toLowerCase();
    const filtradas = termo
        ? catalogoMusicas.filter((m) => m.titulo.toLowerCase().includes(termo) || m.artista.toLowerCase().includes(termo))
        : catalogoMusicas;
    renderizarResultadosFavorita(filtradas);
});

function renderizarResultadosFavorita(musicas) {
    elFavoritaResultados.innerHTML = '';
    if (musicas.length === 0) { exibirMensagemLista(elFavoritaResultados, 'Nenhuma música encontrada.'); return; }

    musicas.forEach((musica) => {
        const item = document.createElement('li');
        item.className = 'perfil-resultado-item';
        if (favoritaAtual?.id === musica.id) item.classList.add('selecionado');

        const capa = document.createElement('img');
        capa.className = 'perfil-resultado-capa';
        capa.src = musica.url_capa || '../assets/avatar-padrao.png';
        capa.alt = '';

        const texto = document.createElement('div');
        texto.className = 'perfil-resultado-texto';
        const titulo = document.createElement('span');
        titulo.className = 'perfil-resultado-titulo';
        titulo.textContent = musica.titulo;
        const artista = document.createElement('span');
        artista.className = 'perfil-resultado-artista';
        artista.textContent = musica.artista;
        texto.append(titulo, artista);
        item.append(capa, texto);

        item.addEventListener('click', () => definirFavorita(musica));
        elFavoritaResultados.appendChild(item);
    });
}

// ================================================================
// FAVORITA — salva ao clicar; clicar na já-selecionada remove
// ================================================================

async function definirFavorita(musica) {
    const removendo = favoritaAtual?.id === musica.id;
    elFavoritaSelecionada.textContent = removendo ? 'Removendo...' : 'Salvando...';

    try {
        const resposta = removendo
            ? await fetchComAutenticacao(`${API_BASE}/api/perfil/favorita`, { method: 'DELETE' })
            : await fetchComAutenticacao(`${API_BASE}/api/perfil/favorita`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ musicaId: musica.id })
            });

        const dados = await resposta.json().catch(() => null);
        if (!resposta.ok) {
            alert(dados?.mensagem || 'Não foi possível salvar a favorita.');
            elFavoritaSelecionada.textContent = favoritaAtual ? `Favorita: ${favoritaAtual.titulo}` : 'Nenhuma escolhida ainda.';
            return;
        }

        favoritaAtual = dados.favorita;
        elFavoritaSelecionada.textContent = favoritaAtual ? `Favorita: ${favoritaAtual.titulo}` : 'Nenhuma escolhida ainda.';
        if (window.OS) OS.invalidar();
        renderizarResultadosFavorita(catalogoMusicas.filter((m) =>
            !elFavoritaFiltro.value.trim() ||
            m.titulo.toLowerCase().includes(elFavoritaFiltro.value.trim().toLowerCase()) ||
            m.artista.toLowerCase().includes(elFavoritaFiltro.value.trim().toLowerCase())
        ));
    } catch (erro) {
        alert('Erro de conexão ao salvar a favorita.');
        console.error(erro);
    }
}

// ================================================================
// PLAYLISTS
// ================================================================

function renderizarPlaylists(playlists) {
    elPlaylistsLista.innerHTML = '';
    if (playlists.length === 0) { exibirMensagemLista(elPlaylistsLista, 'Você ainda não tem playlists públicas.'); return; }

    playlists.forEach((playlist) => {
        const item = document.createElement('li');
        item.className = 'perfil-resultado-item';

        const texto = document.createElement('div');
        texto.className = 'perfil-resultado-texto';
        const titulo = document.createElement('span');
        titulo.className = 'perfil-resultado-titulo';
        titulo.textContent = playlist.nome;
        const faixas = document.createElement('span');
        faixas.className = 'perfil-playlist-faixas';
        faixas.textContent = playlist.total_faixas === 1 ? '1 faixa' : `${playlist.total_faixas} faixas`;
        texto.append(titulo, faixas);

        const remover = document.createElement('button');
        remover.type = 'button';
        remover.className = 'perfil-resultado-remover';
        remover.textContent = '✕';
        remover.title = 'Excluir playlist';
        remover.addEventListener('click', () => excluirPlaylist(playlist.id));

        item.append(texto, remover);
        elPlaylistsLista.appendChild(item);
    });
}

async function excluirPlaylist(id) {
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/playlists/${id}`, { method: 'DELETE' });
        if (!resposta.ok) { alert('Não foi possível excluir a playlist.'); return; }
        if (window.OS) OS.invalidar();
        await carregarPerfil({ forcar: true });
    } catch (erro) {
        alert('Erro de conexão ao excluir a playlist.');
        console.error(erro);
    }
}

// ================================================================
// INICIALIZAÇÃO
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (!estaLogado()) { mostrarBloqueado(); return; }
    mostrarConteudo();

    // Avatar, nome e tema já entraram pintados a partir do cache
    // (sessao.js, antes do paint). Falta só o texto do botão do tema
    // e o resto do perfil, que vem do cache ou do servidor.
    atualizarTextoBotaoTema();

    atualizarContadorBio();
    carregarPerfil();
    carregarCatalogo();
});