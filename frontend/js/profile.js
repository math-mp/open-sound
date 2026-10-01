// ================================================================
// profile.js — modo DONO e modo VISITANTE.
//
// Sem ?u= na URL (ou apontando para si mesmo) => modo DONO: a página
// de sempre, com a janela de Configurações.
//
// Com ?u=<@> de outra pessoa => modo VISITANTE: a página abre sem login
// nenhum, a janela de Configurações sai do DOM, e a Biblioteca fica
// somente leitura. A segurança de verdade continua nas rotas do
// servidor, que leem o usuário do token; aqui o que se remove são só os
// controles de edição.
// ================================================================

const API_BASE = 'https://open-sound.onrender.com';
const CHAVE_SESSAO = 'tokenSessao';
const BIO_MAX = 220; // mesmo limite de LIMITES no backend/server.js
const EXIBICAO_MAX = 40; // mesmo limite de NOME_EXIBICAO_MAX no backend

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
// MODO DA PÁGINA: DONO ou VISITANTE
// ================================================================

// A URL manda: perfil.html?u=fulano. Sem o parâmetro, é o próprio perfil.
// O identificador é codificado por quem monta o link (ver linkPerfil).
let modoVisitante = false;
let identificadorVisitado = null;

function lerVisitanteDaUrl() {
  let bruto = '';
  try {
    bruto = new URLSearchParams(window.location.search).get('u') || '';
  } catch (erro) {
    bruto = '';
  }
  if (!bruto.trim()) return null;
  // decodeURIComponent sobre o que o próprio location.search já decodifica
  // não é necessário e pode lançar em "%" solto; o valor já vem pronto.
  return bruto.trim();
}

// ================================================================
// ELEMENTOS DO DOM
// ================================================================

const elBloqueado = document.getElementById('perfil-bloqueado');
const elConteudo = document.getElementById('perfil-conteudo');

// Janela 1 — Perfil (só exibição)
const elJanelaIdentidade = document.getElementById('janela-identidade');
const elAbaIdentidade = document.getElementById('aba-identidade');
const elNome = document.getElementById('perfil-nome');
const elUsuario = document.getElementById('perfil-usuario');
const elBioExibicao = document.getElementById('perfil-bio');
const elEstatisticas = document.getElementById('perfil-estatisticas');
// Avatar do perfil exibido. NÃO leva data-os-avatar de propósito: o
// sessao.js sobrescreveria com o avatar de quem está logado.
const elAvatarCaixa = document.getElementById('perfil-avatar-caixa');

// Janela 2 — Configurações (só o dono; some inteira no modo visitante)
const elJanelaConfig = document.getElementById('janela-config');
const elConfigAvatarInput = document.getElementById('config-avatar-input');
const elConfigAvatarEnviar = document.getElementById('config-avatar-enviar');
const elConfigAvatarRemover = document.getElementById('config-avatar-remover');
const elConfigAvatarStatus = document.getElementById('config-avatar-status');

const elConfigExibicaoForm = document.getElementById('config-exibicao-form');
const elConfigExibicaoInput = document.getElementById('config-exibicao-input');
const elConfigExibicaoContador = document.getElementById('config-exibicao-contador');
const elConfigExibicaoStatus = document.getElementById('config-exibicao-status');

const elConfigBioForm = document.getElementById('config-bio-form');
const elConfigBioTextarea = document.getElementById('config-bio-textarea');
const elConfigBioContador = document.getElementById('config-bio-contador');
const elConfigBioStatus = document.getElementById('config-bio-status');

// Janela 3 — Biblioteca
const elFavoritaEscolha = document.getElementById('perfil-favorita-escolha');
const elFavoritaFiltro = document.getElementById('perfil-favorita-filtro');
const elFavoritaResultados = document.getElementById('perfil-favorita-resultados');
const elFavoritaSelecionada = document.getElementById('perfil-favorita-selecionada');

const elFavoritaCard = document.getElementById('perfil-favorita-card');
const elFavoritaCapa = document.getElementById('perfil-favorita-capa');
const elFavoritaTitulo = document.getElementById('perfil-favorita-titulo');
const elFavoritaArtista = document.getElementById('perfil-favorita-artista');
const elFavoritaTocar = document.getElementById('perfil-favorita-tocar');

const elPlaylistsLista = document.getElementById('perfil-playlists-lista');
const elBibliotecaNota = document.getElementById('perfil-biblioteca-nota');

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
// RENDER — serve aos dois modos
//
// Tudo que vem do servidor entra por textContent, nunca por innerHTML:
// a partir de agora o conteúdo é visto por outras pessoas, e nome/bio/
// status são texto de usuário.
// ================================================================

function renderizarPerfil(perfil) {
  const { usuario, favorita, playlists, estatisticas, ouvindo } = perfil;

    // Ordem de quem aparece: o nome escolhido pela pessoa PRIMEIRO, depois
    // o nome de artista, depois o @. Antes o nome de artista vinham na
    // frente, e em conta de artista o campo "Como você aparece" era salvo
    // e nunca aparecia — dava a impressão de que não estava salvando.
    const nomeExibido = usuario.nome_exibicao
        || (usuario.eh_artista && usuario.nome_artista)
        || usuario.nome_usuario
        || 'Sem nome';
    elNome.textContent = nomeExibido;

    if (usuario.nome_usuario) {
        elUsuario.textContent = `@${usuario.nome_usuario}`;
        elUsuario.style.display = 'block';
    } else {
        elUsuario.style.display = 'none';
    }

    elBioExibicao.textContent = usuario.bio || '';

    // Status é público e vai nos DOIS modos: é a cara da pessoa.
    renderizarStatus(usuario);
    // "Ouvindo agora" só vem no corpo quando o dono ligou a opção — o
    // servidor já filtrou; aqui é só o que chegou.
    renderizarOuvindo(ouvindo);
    if (!modoVisitante) preencherControlesStatus(usuario);

    // A personalização é pública: quem está só olhando vê a mesma aparência
    // que o dono vê. Por isso entra nos DOIS modos, logo depois do avatar.
    if (usuario.personalizacao && typeof usuario.personalizacao === 'object') {
        aparenciaSalva = {
            ...personalizacaoPadrao(),
            ...usuario.personalizacao,
            acentos: { ...ACENTOS_PADRAO, ...(usuario.personalizacao.acentos || {}) },
            banner_url: usuario.banner_url || null
        };
    } else {
        aparenciaSalva = { ...personalizacaoPadrao(), banner_url: usuario.banner_url || null };
    }

    if (!modoVisitante) {
        aparenciaEditando = JSON.parse(JSON.stringify(aparenciaSalva));
        preencherControlesAparencia(aparenciaEditando);
    }
    aplicarAparencia(aparenciaSalva);

    // Avatar e nome NÃO são escritos aqui por atributo: quem pinta a caixa
    // do avatar é o OS.pintarCaixa(), com os dados da rota — e não o
    // sessao.js, que só conhece o usuário logado.
    if (window.OS && elAvatarCaixa && typeof OS.pintarCaixa === 'function') {
        OS.pintarCaixa(elAvatarCaixa, usuario.avatar_url || null, nomeExibido);
    }

    elEstatisticas.textContent = (estatisticas && usuario.eh_artista)
        ? `${estatisticas.musicas_enviadas} música(s) enviada(s) · ${estatisticas.reproducoes} reprodução(ões)`
        : '';

    favoritaAtual = favorita;
    renderizarFavorita(favorita);
    renderizarPlaylists(playlists);

    // Os campos editáveis só existem no modo dono — no visitante a janela
    // inteira foi removida do DOM.
    if (modoVisitante) {
        elBibliotecaNota.textContent = favorita
            ? 'Esta é a música favorita.'
            : 'Nenhuma música favorita escolhida ainda.';
        return;
    }

    // Só substitui o texto do campo se a pessoa não estiver com o foco
    // nele agora (evita apagar o que está sendo digitado se o cache
    // disparar no meio da edição).
    if (document.activeElement !== elConfigBioTextarea) {
        elConfigBioTextarea.value = usuario.bio || '';
        atualizarContadorBio();
    }
    if (document.activeElement !== elConfigExibicaoInput) {
        elConfigExibicaoInput.value = usuario.nome_exibicao || '';
        atualizarContadorExibicao();
    }
    elConfigAvatarRemover.classList.toggle('hidden', !usuario.avatar_url);
    elBibliotecaNota.textContent = 'A busca filtra as 50 músicas mais recentes. Clicar em uma salva como favorita.';
}

// A favorita vira um cartão tocável quando a pessoa só está olhando.
function renderizarFavorita(favorita) {
    // O dono tem o seletor (para trocar de música) E o cartão (para
    // ouvir). Quem só visita tem só o cartão — o seletor sai do DOM.
    if (!favorita) {
        elFavoritaCard.classList.add('hidden');
        if (!modoVisitante) elFavoritaSelecionada.textContent = 'Nenhuma escolhida ainda.';
        return;
    }

    elFavoritaCapa.src = favorita.url_capa || '../assets/avatar-padrao.png';
    elFavoritaTitulo.textContent = favorita.titulo;
    elFavoritaArtista.textContent = favorita.artista;
    elFavoritaCard.classList.remove('hidden');

    if (!modoVisitante) {
        elFavoritaSelecionada.textContent = `Favorita: ${favorita.titulo}`;
    }
}

// O player universal cuida do rótulo ▶/⏸ e da troca de faixa; o botão
// passado aqui é o que recebe essa pintura.
if (elFavoritaTocar) {
    elFavoritaTocar.addEventListener('click', () => {
        if (!favoritaAtual || typeof tocarMusica !== 'function') return;
        tocarMusica(favoritaAtual, elFavoritaTocar);
    });
}

// ================================================================
// DADOS
// ================================================================
// O perfil (avatar, nome, tema, bio, favorita, playlists) NÃO usa um
// cache próprio: no modo dono quem cuida disso é o sessao.js,
// compartilhado com as outras páginas. O perfil de outra pessoa não
// passa por esse cache (ele é do usuário logado), então vai direto ao
// servidor por fetch próprio.

const perfilDoCache = () => (window.OS ? OS.perfilCacheado() : null);
const perfilAntigo = () => (window.OS ? OS.perfilCacheado(OS.IDADE_MAXIMA_CACHE) : null);

function carregarPerfil({ forcar = false } = {}) {
    // ---- modo visitante: rota pública, sem cache, sem token obrigatório ----
    if (modoVisitante) {
        return fetch(`${API_BASE}/api/perfil/publico/${encodeURIComponent(identificadorVisitado)}`)
            .then((resposta) => resposta.json().then((corpo) => ({ resposta, corpo })))
            .then(({ resposta, corpo }) => {
                if (!resposta.ok) {
                    elNome.textContent = 'Perfil não encontrado';
                    elUsuario.style.display = 'none';
                    elBioExibicao.textContent = '';
                    elEstatisticas.textContent = '';
                    elPlaylistsLista.innerHTML = '';
                    elFavoritaCard.classList.add('hidden');
                    exibirMensagemLista(elPlaylistsLista, corpo.mensagem || 'Perfil não encontrado.');
                    return null;
                }
                // Se o servidor disser que é o próprio dono, a URL estava
                // apontando para si mesmo: nesse caso a página vira modo
                // dono e passa a usar o caminho completo.
                if (corpo.perfil && corpo.perfil.eh_dono) {
                    modoVisitante = false;
                    identificadorVisitado = null;
                    return carregarPerfil({ forcar: true });
                }
                renderizarPerfil(corpo.perfil);
                return corpo.perfil;
            })
            .catch((erro) => {
                console.error('Erro ao carregar o perfil:', erro);
                elNome.textContent = 'Não foi possível carregar o perfil';
                return null;
            });
    }

    // ---- modo dono: como antes, via sessao.js ----
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
// STATUS E "OUVINDO AGORA"

// O emoji é 1 GRAFEMA, não 1 caractere: 👨‍👩‍👧 ocupa 8 unidades de
// código e valeria 8 com .length, que é o jeito que o próprio projeto já
// errou uma vez. Intl.Segmenter é o que separa um emoji composto em um
// só pedaço.
const STATUS_TEXTO_MAX = 40;
const STATUS_EMOJI_MAX = 1;

function grafeasDe(texto) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
        return Array.from(segmenter.segment(texto), (parte) => parte.segment);
    }
    return Array.from(texto);
}

const contarGrafemas = (texto) => grafeasDe(texto).length;
const recortarPorGrafemas = (texto, limite) => grafeasDe(texto).slice(0, limite).join('');

const elStatus = document.getElementById('perfil-status');
const elOuvindo = document.getElementById('perfil-ouvindo');
const elStatusEmojiInput = document.getElementById('config-status-emoji');
const elStatusEmojiBotao = document.querySelector('.perfil-config-emoji');
const elStatusTextoInput = document.getElementById('config-status-texto');
const elStatusContador = document.getElementById('config-status-contador');
const elStatusMsg = document.getElementById('config-status-status');
const elMostrarOuvindo = document.getElementById('config-mostrar-ouvindo');

// Status (emoji + texto) e o interruptor de privacidade saem juntos no
// caso de uso normal; o botão só marca que houve mudança.
let statusSujo = false;
let ouvindoSujo = false;

function marcarStatusAlterado() {
    const guardar = document.getElementById('config-status-guardar');
    if (guardar) guardar.disabled = !(statusSujo || ouvindoSujo);
}

function renderizarStatus(usuario) {
    const emoji = usuario.status_emoji || '';
    const texto = usuario.status_texto || '';

    if (!emoji && !texto) {
        elStatus.classList.add('hidden');
        elStatus.textContent = '';
        return;
    }

    elStatus.textContent = '';

    if (emoji) {
        const icone = document.createElement('span');
        icone.className = 'perfil-status-emoji';
        icone.setAttribute('aria-hidden', 'true');
        icone.textContent = emoji;
        elStatus.appendChild(icone);
    }

    if (texto) {
        const frase = document.createElement('span');
        frase.className = 'perfil-status-texto';
        frase.textContent = texto;
        elStatus.appendChild(frase);
    }

    elStatus.classList.remove('hidden');
}

// "Ouvindo agora" vira uma pastilha clicável: quem olha pode continuar
// ouvindo por ali, sem procurar a música no catálogo.
let musicaOuvindo = null;

function renderizarOuvindo(ouvindo) {
    if (!ouvindo || !ouvindo.musica) {
        elOuvindo.classList.add('hidden');
        elOuvindo.textContent = '';
        musicaOuvindo = null;
        return;
    }

    musicaOuvindo = ouvindo.musica;
    elOuvindo.textContent = '';

    const barra = document.createElement('span');
    barra.className = 'perfil-ouvindo-barra' + (ouvindo.tocando ? '' : ' pausada');
    barra.setAttribute('aria-hidden', 'true');

    const titulo = document.createElement('span');
    titulo.className = 'perfil-ouvindo-titulo';
    titulo.textContent = ouvindo.musica.titulo;

    elOuvindo.append(barra, titulo);
    elOuvindo.classList.toggle('perfil-ouvindo-pausado', !ouvindo.tocando);
    elOuvindo.classList.remove('hidden');
    elOuvindo.setAttribute('role', 'button');
    elOuvindo.setAttribute('tabindex', '0');
    elOuvindo.title = ouvindo.tocando ? 'Pausar' : 'Ouvir';
}

function tocarOuvindo() {
    if (!musicaOuvindo || typeof tocarMusica !== 'function') return;
    // O botão do player reescreve o textContent do botão anterior, então
    // o rótulo desta pastilha é repintado pelo 'pause'/'play' logo abaixo.
    tocarMusica(musicaOuvindo, elOuvindo);
    elOuvindo.classList.remove('perfil-ouvindo-pausado');
}

if (elOuvindo) {
    elOuvindo.addEventListener('click', tocarOuvindo);
    elOuvindo.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
            evento.preventDefault();
            tocarOuvindo();
        }
    });
}

function preencherControlesStatus(usuario) {
    if (elStatusEmojiInput) elStatusEmojiInput.value = usuario.status_emoji || '';
    if (elStatusEmojiBotao) elStatusEmojiBotao.textContent = usuario.status_emoji || '😀';
    if (document.activeElement !== elStatusTextoInput) {
        elStatusTextoInput.value = usuario.status_texto || '';
    }
    atualizarContadorStatus();
    if (elMostrarOuvindo) elMostrarOuvindo.checked = !!usuario.mostrar_ouvindo;
}

function atualizarContadorStatus() {
    if (!elStatusContador || !elStatusTextoInput) return;
    const total = contarGrafemas(elStatusTextoInput.value);
    elStatusContador.textContent = `${total}/${STATUS_TEXTO_MAX}`;
}

if (elStatusEmojiInput) {
    elStatusEmojiInput.addEventListener('input', () => {
        // Corta no 1º grafema e mantém o cursor no fim, para a pessoa
        // poder trocar o emoji sem apagar antes.
        const cortado = recortarPorGrafemas(elStatusEmojiInput.value, STATUS_EMOJI_MAX);
        if (elStatusEmojiInput.value !== cortado) elStatusEmojiInput.value = cortado;
        if (elStatusEmojiBotao) elStatusEmojiBotao.textContent = cortado || '😀';
        statusSujo = true;
        marcarStatusAlterado();
    });
}

if (elStatusEmojiBotao) {
    elStatusEmojiBotao.addEventListener('click', () => {
        elStatusEmojiInput.focus();
        elStatusEmojiInput.select();
    });
}

if (elStatusTextoInput) {
    elStatusTextoInput.addEventListener('input', () => {
        // Corta em grafemas, nunca no meio de um emoji.
        const cortado = recortarPorGrafemas(elStatusTextoInput.value, STATUS_TEXTO_MAX);
        if (elStatusTextoInput.value !== cortado) elStatusTextoInput.value = cortado;
        atualizarContadorStatus();
        statusSujo = true;
        marcarStatusAlterado();
    });
}

if (elMostrarOuvindo) {
    elMostrarOuvindo.addEventListener('change', () => {
        ouvindoSujo = true;
        marcarStatusAlterado();
    });
}

const btnGuardarStatus = document.getElementById('config-status-guardar');
if (btnGuardarStatus) {
    btnGuardarStatus.addEventListener('click', async () => {
        if (elStatusMsg) elStatusMsg.textContent = 'Salvando...';
        btnGuardarStatus.disabled = true;

        // Só o que mudou vai no corpo; o resto fica como está no banco.
        const corpo = {};
        if (statusSujo) {
            corpo.emoji = elStatusEmojiInput ? elStatusEmojiInput.value : '';
            corpo.texto = elStatusTextoInput ? elStatusTextoInput.value : '';
        }
        if (ouvindoSujo) corpo.mostrarOuvindo = elMostrarOuvindo ? elMostrarOuvindo.checked : false;

        try {
            const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corpo)
            });
            const dados = await resposta.json().catch(() => null);

            if (!resposta.ok) {
                if (elStatusMsg) elStatusMsg.textContent = dados?.mensagem || 'Não foi possível salvar o status.';
                return;
            }

            statusSujo = false;
            ouvindoSujo = false;
            if (elStatusMsg) elStatusMsg.textContent = 'Status salvo ✓';
            if (window.OS) OS.invalidar();
            await carregarPerfil({ forcar: true });
        } catch (erro) {
            if (elStatusMsg) elStatusMsg.textContent = 'Erro de conexão ao salvar o status.';
            console.error(erro);
        } finally {
            btnGuardarStatus.disabled = !(statusSujo || ouvindoSujo);
        }
    });
}

// ================================================================
// APARÊNCIA — PRÉVIA AO VIVO

// Estado em duas camadas: `aparenciaSalva` é o que está no servidor,
// `aparenciaEditando` é o que a pessoa está mexendo agora. Os controles
// escrevem só na segunda e chamam aplicarAparencia(); nada vai para a
// rede até o clique em "Salvar". "Desfazer" volta a primeira pela
// segunda — e é por isso que o botão existe separado do "voltar tudo".
// ================================================================

const ACENTOS_PADRAO = { perfil: '#fde4cf', config: '#fbf8cc', biblioteca: '#98f5e1' };

function personalizacaoPadrao() {
    return {
        acentos: { ...ACENTOS_PADRAO },
        borda_avatar: 'nenhuma',
        fonte_nome: 'padrao',
        efeito: 'nenhum',
        textura_banner: false,
        degrade_nome: { cor1: null, cor2: null }
    };
}

let aparenciaSalva = personalizacaoPadrao();
let aparenciaEditando = personalizacaoPadrao();
let aparenciaTemMudanca = false;

const CHAVE_TEMA_CLARO = 'light';
const estaEmTemaClaro = () => document.documentElement.dataset.theme === CHAVE_TEMA_CLARO;

// Luminância relativa + razão de contraste do WCAG. É a MESMA fórmula que
// o backend usa para validar: os dois lados caem no mesmo par de valores,
// então o que o navegador mostra na prévia é o que o servidor vai gravar.
function luminanciaRelativa(corHex) {
    const n = parseInt(String(corHex).slice(1), 16);
    const canal = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * canal((n >> 16) & 255)
        + 0.7152 * canal((n >> 8) & 255)
        + 0.0722 * canal(n & 255);
}

function razaoDeContraste(a, b) {
    const [claro, escuro] = a > b ? [a, b] : [b, a];
    return (claro + 0.05) / (escuro + 0.05);
}

// Escolhe o tom de texto sobre a cor escolhida. Mesma regra do backend,
// na mesma ordem: o tom do tema primeiro (preserva a paleta e quase
// sempre passa de 4.5:1), e só nos cinzas-médios, onde nem o tom do
// tema nem o claro chegam a 4.5:1, é que se cai nos extremos preto ou
// branco — a única garantia de não ficar ilegível.
const TONS_DO_TEMA = { escuro: '#3a3350', claro: '#302a34' };
const TOM_CLARO_TXT = '#fff8f3';
const TOM_EXTREMOS_TXT = ['#000000', '#ffffff'];
const MINIMO_AA_TXT = 4.5;

function corDeTextoSobre(corHex) {
    const claro = estaEmTemaClaro();
    const fundo = luminanciaRelativa(corHex);

    const tomDoTema = claro ? TONS_DO_TEMA.claro : TONS_DO_TEMA.escuro;
    if (razaoDeContraste(fundo, luminanciaRelativa(tomDoTema)) >= MINIMO_AA_TXT) return tomDoTema;

    if (razaoDeContraste(fundo, luminanciaRelativa(TOM_CLARO_TXT)) >= MINIMO_AA_TXT) return TOM_CLARO_TXT;

    let melhor = TOM_EXTREMOS_TXT[0];
    let melhorRazao = -1;
    TOM_EXTREMOS_TXT.forEach((tom) => {
        const razao = razaoDeContraste(fundo, luminanciaRelativa(tom));
        if (razao > melhorRazao) { melhorRazao = razao; melhor = tom; }
    });
    return melhor;
}

// Escreve a aparência no .perfil-container. Tudo por variável escopada:
// nada de estilo inline no elemento, e nada de cor literal no CSS.
function aplicarAparencia(aparencia) {
    const container = document.querySelector('.perfil-container');
    if (!container) return;

    Object.keys(ACENTOS_PADRAO).forEach((chave) => {
        const cor = (aparencia.acentos && aparencia.acentos[chave]) || ACENTOS_PADRAO[chave];
        container.style.setProperty(`--${chave}-acento`, cor);
        container.style.setProperty(`--${chave}-texto-acento`, corDeTextoSobre(cor));
    });

    // Borda do avatar: uma classe, nunca estilo inline.
    const AVATAR = 'perfil-avatar-wrapper os-avatar-gr';
    elAvatarCaixa.className = `${AVATAR} borda-${aparencia.borda_avatar || 'nenhuma'}`;

    // Fonte e degradê do nome.
    elNome.className = `perfil-nome fonte-${aparencia.fonte_nome || 'padrao'}`;
    const usarDegrade = aparencia.degrade_nome && aparencia.degrade_nome.cor1;
    elNome.classList.toggle('com-degrade', !!usarDegrade);
    if (usarDegrade) {
        container.style.setProperty('--nome-cor-inicial', aparencia.degrade_nome.cor1);
        container.style.setProperty('--nome-cor-final', aparencia.degrade_nome.cor2 || aparencia.degrade_nome.cor1);
    } else {
        container.style.removeProperty('--nome-cor-inicial');
        container.style.removeProperty('--nome-cor-final');
    }

    // Banner: imagem + textura.
    const banner = document.getElementById('perfil-banner');
    if (banner) {
        const url = aparencia.banner_url || '';
        banner.style.backgroundImage = url ? `url("${url}")` : '';
        banner.classList.toggle('com-textura', !!aparencia.textura_banner && !!url);
    }

    if (typeof aplicarEfeitoPerfil === 'function') aplicarEfeitoPerfil(aparencia.efeito);
}

// O efeito de overlay é da Fase 4; até lá esta função existe para não
// quebrar a chamada, e não faz nada.
function aplicarEfeitoPerfil() {}

// ---------- preenche os controles a partir da aparência carregada ----------
function preencherControlesAparencia(aparencia) {
    ['perfil', 'config', 'biblioteca'].forEach((chave) => {
        const campo = document.getElementById(`config-cor-${chave}`);
        if (campo) campo.value = (aparencia.acentos && aparencia.acentos[chave]) || ACENTOS_PADRAO[chave];
    });

    const fonte = document.getElementById('config-fonte-nome');
    if (fonte) fonte.value = aparencia.fonte_nome || 'padrao';

    const borda = document.getElementById('config-borda-avatar');
    if (borda) borda.value = aparencia.borda_avatar || 'nenhuma';

    const cor1 = document.getElementById('config-nome-cor1');
    const cor2 = document.getElementById('config-nome-cor2');
    if (cor1) cor1.value = (aparencia.degrade_nome && aparencia.degrade_nome.cor1) || ACENTOS_PADRAO.perfil;
    if (cor2) cor2.value = (aparencia.degrade_nome && aparencia.degrade_nome.cor2) || ACENTOS_PADRAO.config;

    const degrade = document.getElementById('config-nome-degrade');
    if (degrade) degrade.checked = !!(aparencia.degrade_nome && aparencia.degrade_nome.cor1);

    const textura = document.getElementById('config-banner-textura');
    if (textura) textura.checked = !!aparencia.textura_banner;

    const remover = document.getElementById('config-banner-remover');
    if (remover) remover.classList.toggle('hidden', !aparencia.banner_url);

    const preview = document.getElementById('config-banner-preview');
    const vazio = document.getElementById('config-banner-vazio');
    if (preview) preview.style.backgroundImage = aparencia.banner_url ? `url("${aparencia.banner_url}")` : '';
    if (vazio) vazio.classList.toggle('hidden', !!aparencia.banner_url);
}

function marcarAparenciaAlterada() {
    aparenciaTemMudanca = JSON.stringify(aparenciaEditando) !== JSON.stringify(aparenciaSalva);
    const desfazer = document.getElementById('config-aparencia-desfazer');
    if (desfazer) desfazer.disabled = !aparenciaTemMudanca;
}

// O navegador não deixa o JS salvar sozinho; o que dá para fazer é
// AVISAR. Sem isto, fechar a aba ou dar F5 com uma cor mexida e não
// salva levava a alteração embora, e a pessoa achava que o botão não
// funcionava.
window.addEventListener('beforeunload', (evento) => {
    if (!aparenciaTemMudanca) return;
    evento.preventDefault();
    // Chrome exige returnValue para mostrar o aviso; o texto em si é
    // ignorado pelo navegador (por segurança), mas o aviso aparece.
    evento.returnValue = '';
});

// ================================================================
// APARÊNCIA — LISTENERS DOS CONTROLES
//
// Nenhum controle fala com o servidor. Todos mexem só em
// aparenciaEditando e redesenham na hora; a ida ao banco acontece uma
// vez, no botão de salvar.
// ================================================================

if (elJanelaConfig) {
    // Cada seletor de cor cuida do seu próprio acento.
    document.querySelectorAll('#config-cores input[type="color"]').forEach((campo) => {
        campo.addEventListener('input', () => {
            const chave = campo.dataset.acento;
            if (!chave) return;
            aparenciaEditando.acentos[chave] = campo.value.toLowerCase();
            aplicarAparencia(aparenciaEditando);
            marcarAparenciaAlterada();
        });
    });

    const campoFonte = document.getElementById('config-fonte-nome');
    if (campoFonte) {
        campoFonte.addEventListener('change', () => {
            aparenciaEditando.fonte_nome = campoFonte.value;
            aplicarAparencia(aparenciaEditando);
            marcarAparenciaAlterada();
        });
    }

    const campoBorda = document.getElementById('config-borda-avatar');
    if (campoBorda) {
        campoBorda.addEventListener('change', () => {
            aparenciaEditando.borda_avatar = campoBorda.value;
            aplicarAparencia(aparenciaEditando);
            marcarAparenciaAlterada();
        });
    }

    const campoCor1 = document.getElementById('config-nome-cor1');
    const campoCor2 = document.getElementById('config-nome-cor2');
    const campoDegrade = document.getElementById('config-nome-degrade');
    const aoMudarDegrade = () => {
        const ligado = campoDegrade && campoDegrade.checked;
        aparenciaEditando.degrade_nome = ligado
            ? { cor1: campoCor1 ? campoCor1.value.toLowerCase() : null, cor2: campoCor2 ? campoCor2.value.toLowerCase() : null }
            : { cor1: null, cor2: null };
        aplicarAparencia(aparenciaEditando);
        marcarAparenciaAlterada();
    };
    if (campoCor1) campoCor1.addEventListener('input', aoMudarDegrade);
    if (campoCor2) campoCor2.addEventListener('input', aoMudarDegrade);
    if (campoDegrade) campoDegrade.addEventListener('change', aoMudarDegrade);

    const campoTextura = document.getElementById('config-banner-textura');
    if (campoTextura) {
        campoTextura.addEventListener('change', () => {
            aparenciaEditando.textura_banner = campoTextura.checked;
            aplicarAparencia(aparenciaEditando);
            marcarAparenciaAlterada();
        });
    }

    // Desfazer: volta ao que está salvo, sem tocar no servidor.
    const btnDesfazer = document.getElementById('config-aparencia-desfazer');
    if (btnDesfazer) {
        btnDesfazer.addEventListener('click', () => {
            aparenciaEditando = JSON.parse(JSON.stringify(aparenciaSalva));
            preencherControlesAparencia(aparenciaEditando);
            aplicarAparencia(aparenciaEditando);
            marcarAparenciaAlterada();
            const status = document.getElementById('config-aparencia-status');
            if (status) status.textContent = 'Alterações desfeitas.';
        });
    }

    // Salvar: UMA requisição com o objeto inteiro.
    const btnSalvarAparencia = document.getElementById('config-aparencia-salvar');
    if (btnSalvarAparencia) {
        btnSalvarAparencia.addEventListener('click', async () => {
            const status = document.getElementById('config-aparencia-status');
            if (status) status.textContent = 'Salvando...';
            btnSalvarAparencia.disabled = true;

            try {
                const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/personalizacao`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    // banner_url NÃO vai aqui: quem manda no arquivo é o
                    // upload. Mandar a URL no PUT deixaria o campo editável
                    // pelo navegador, e é justamente o que não queremos.
                    body: JSON.stringify({ personalizacao: aparenciaEditando })
                });
                const dados = await resposta.json().catch(() => null);

                if (!resposta.ok) {
                    if (status) status.textContent = dados?.mensagem || 'Não foi possível salvar a aparência.';
                    return;
                }

                // O servidor normaliza (whitelist + cor); o que vale é a
                // resposta dele, não o que foi enviado.
                aparenciaSalva = dados.personalizacao;
                aparenciaSalva.banner_url = aparenciaEditando.banner_url;
                aparenciaEditando = JSON.parse(JSON.stringify(aparenciaSalva));
                preencherControlesAparencia(aparenciaEditando);
                aplicarAparencia(aparenciaEditando);
                marcarAparenciaAlterada();

                if (window.OS) OS.invalidar();
                if (status) status.textContent = 'Aparência salva ✓';
            } catch (erro) {
                if (status) status.textContent = 'Erro de conexão ao salvar a aparência.';
                console.error(erro);
            } finally {
                btnSalvarAparencia.disabled = false;
            }
        });
    }

    // ---------- banner: subir e remover ----------
    const elBannerInput = document.getElementById('config-banner-input');
    const elBannerEnviar = document.getElementById('config-banner-enviar');
    const elBannerRemover = document.getElementById('config-banner-remover');
    const elBannerStatus = document.getElementById('config-banner-status');

    if (elBannerEnviar && elBannerInput) {
        elBannerEnviar.addEventListener('click', () => elBannerInput.click());

        elBannerInput.addEventListener('change', async () => {
            const arquivo = elBannerInput.files[0];
            if (!arquivo) return;

            const formulario = new FormData();
            formulario.append('banner', arquivo);

            if (elBannerStatus) elBannerStatus.textContent = 'Enviando...';
            try {
                const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/banner`, {
                    method: 'POST',
                    body: formulario
                });
                const dados = await resposta.json().catch(() => null);

                if (!resposta.ok) {
                    if (elBannerStatus) elBannerStatus.textContent = dados?.mensagem || 'Não foi possível enviar o banner.';
                    return;
                }

                // A URL entra na aparência em edição, não na salva: ela só
                // vira definitivo quando o "Salvar aparência" é clicado.
                aparenciaEditando.banner_url = dados.banner_url;
                aparenciaSalva.banner_url = dados.banner_url;
                preencherControlesAparencia(aparenciaEditando);
                aplicarAparencia(aparenciaEditando);
                marcarAparenciaAlterada();
                if (window.OS) OS.invalidar();
                if (elBannerStatus) elBannerStatus.textContent = 'Banner enviado ✓';
            } catch (erro) {
                if (elBannerStatus) elBannerStatus.textContent = 'Erro de conexão ao enviar o banner.';
                console.error(erro);
            } finally {
                elBannerInput.value = '';
            }
        });
    }

    if (elBannerRemover) {
        elBannerRemover.addEventListener('click', async () => {
            if (elBannerStatus) elBannerStatus.textContent = 'Removendo...';
            try {
                const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/banner`, { method: 'DELETE' });
                if (!resposta.ok) {
                    if (elBannerStatus) elBannerStatus.textContent = 'Não foi possível remover o banner.';
                    return;
                }
                aparenciaEditando.banner_url = null;
                aparenciaSalva.banner_url = null;
                preencherControlesAparencia(aparenciaEditando);
                aplicarAparencia(aparenciaEditando);
                marcarAparenciaAlterada();
                if (window.OS) OS.invalidar();
                if (elBannerStatus) elBannerStatus.textContent = 'Banner removido.';
            } catch (erro) {
                if (elBannerStatus) elBannerStatus.textContent = 'Erro de conexão ao remover o banner.';
                console.error(erro);
            }
        });
    }
}

// ================================================================
// CONFIGURAÇÕES — NOME DE EXIBIÇÃO
// ================================================================
// Livre (acento, espaço, emoji), até 40 caracteres. Se ficar vazio, a
// tela volta a mostrar o próprio @.

function atualizarContadorExibicao() {
    elConfigExibicaoContador.textContent = `${elConfigExibicaoInput.value.length}/${EXIBICAO_MAX}`;
}

elConfigExibicaoInput.addEventListener('input', atualizarContadorExibicao);

elConfigExibicaoForm.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const texto = elConfigExibicaoInput.value.trim();

    elConfigExibicaoStatus.textContent = 'Salvando...';
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/exibicao`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nomeExibicao: texto })
        });
        const dados = await resposta.json().catch(() => null);

        if (!resposta.ok) {
            elConfigExibicaoStatus.textContent = dados?.mensagem || 'Não foi possível salvar o nome.';
            return;
        }

        elConfigExibicaoStatus.textContent = 'Nome salvo ✓';
        // Recarrega para o nome novo aparecer no perfil: a resposta do
        // sessao.js ainda traz o valor antigo.
        if (window.OS) OS.invalidar();
        await carregarPerfil({ forcar: true });
    } catch (erro) {
        elConfigExibicaoStatus.textContent = 'Erro de conexão ao salvar o nome.';
        console.error(erro);
    }
});

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
                // O avatar da janela de Perfil NÃO tem [data-os-avatar]
                // (senão o sessao.js sobrescreveria com o do visitante no
                // perfil de outra pessoa). Por isso ele não é pintado por
                // aoTrocarAvatar: precisa vir pelo render do perfil.
                await carregarPerfil({ forcar: true });
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
        await carregarPerfil({ forcar: true });
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
    if (playlists.length === 0) {
        exibirMensagemLista(elPlaylistsLista, modoVisitante
            ? 'Nenhuma playlist pública ainda.'
            : 'Você ainda não tem playlists públicas.');
        return;
    }

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

        item.appendChild(texto);

        // O ✕ de excluir e o link só existem para o dono. Em visita o
        // item é só texto: GET /api/playlists/:id é restrito ao dono,
        // então linkar levaria a um 404.
        if (!modoVisitante) {
            const remover = document.createElement('button');
            remover.type = 'button';
            remover.className = 'perfil-resultado-remover';
            remover.textContent = '✕';
            remover.title = 'Excluir playlist';
            remover.setAttribute('aria-label', `Excluir playlist ${playlist.nome}`);
            remover.addEventListener('click', () => excluirPlaylist(playlist.id));
            item.appendChild(remover);
        }

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

// No modo visitante, os controles de edição saem do DOM — não só do
// estilo. A proteção de verdade está no servidor (toda rota de escrita
// pega o usuário do token e ignora qualquer id que venha do navegador);
// aqui é para não mostrar botão que não vai funcionar.
function aplicarModoVisitante() {
    if (elJanelaConfig && elJanelaConfig.parentNode) {
        elJanelaConfig.parentNode.removeChild(elJanelaConfig);
    }
    if (elFavoritaEscolha && elFavoritaEscolha.parentNode) {
        elFavoritaEscolha.parentNode.removeChild(elFavoritaEscolha);
    }
    if (elAbaIdentidade) elAbaIdentidade.textContent = 'Perfil';
    if (elJanelaIdentidade) {
        elJanelaIdentidade.setAttribute('aria-label', 'Perfil da pessoa visitada');
    }
    // A seta de voltar continua: quem chegou aqui por um link precisa
    // voltar. Ela vai para a home, que é o destino que funciona mesmo
    // quando a página foi aberta direto (sem histórico anterior).
}

function iniciar() {
    identificadorVisitado = lerVisitanteDaUrl();

    // Sem ?u=, ou com login ausente apontando para o próprio perfil: a
    // página de sempre. Sem ?u= e sem login: a tela de "entre na conta".
    if (!identificadorVisitado) {
        modoVisitante = false;
        if (!estaLogado()) { mostrarBloqueado(); return; }
        mostrarConteudo();
        atualizarTextoBotaoTema();
        atualizarContadorBio();
        atualizarContadorExibicao();
        carregarPerfil();
        carregarCatalogo();
        return;
    }

    modoVisitante = true;
    mostrarConteudo();
    aplicarModoVisitante();
    carregarPerfil();
    // O catálogo (para escolher a favorita) é do dono; em visita não é
    // preciso e a busca por ele só custaria uma requisição.
}

document.addEventListener('DOMContentLoaded', iniciar);