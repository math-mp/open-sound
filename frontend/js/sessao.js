(function () {
  'use strict';

  const API_BASE = 'https://open-sound.onrender.com';
  const CHAVE_SESSAO = 'tokenSessao';
  const CHAVE_TEMA = 'opensound_tema';
  const PREFIXO_CACHE = 'opensound_usuario_';
  const PREFIXO_CACHE_LEGADO = 'opensound_cache_perfil_';
  const AVATAR_PADRAO = '../assets/avatar-padrao.png';
  const IDADE_MAXIMA_PERFIL = 20 * 1000;
  const IDADE_MAXIMA_CACHE = 7 * 24 * 60 * 60 * 1000;
  const EVENTO_TEMA = 'opensound:tema';
  const EVENTO_SESSAO_INVALIDA = 'opensound:sessao-invalida';

  const CORES_INICIAIS = [
    '#7c4d9e', '#4a6fa5', '#2f7d68', '#a35a4a',
    '#6b5b95', '#3f7d8c', '#8a6d3b', '#7a4f7e'
  ];

  function token() {
    return localStorage.getItem(CHAVE_SESSAO);
  }

  function estaLogado() {
    return !!token();
  }

  function chaveCache() {
    return PREFIXO_CACHE + (token() || 'sem-sessao').slice(-12);
  }

  // Nome que aparece na tela. Mesma ordem do perfil: o nome escolhido
  // pela pessoa tem a maior precedência, depois o nome de artista, e o
  // @ só como último recurso. Precisa bater com o profile.js, senão a
  // navbar e o perfil do mesmo usuário mostrariam nomes diferentes.
  function nomeExibido(usuario) {
    if (!usuario) return '';
    if (usuario.nome_exibicao) return usuario.nome_exibicao;
    if (usuario.eh_artista && usuario.nome_artista) return usuario.nome_artista;
    return usuario.nome_usuario || '';
  }

  function iniciais(nome) {
    if (!nome) return '';
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  function corDoNome(nome) {
    const texto = String(nome || '');
    let soma = 0;
    for (let i = 0; i < texto.length; i++) soma = (soma * 31 + texto.charCodeAt(i)) >>> 0;
    return CORES_INICIAIS[soma % CORES_INICIAIS.length];
  }

  function lerCache() {
    const chave = chaveCache();
    try {
      const bruto = localStorage.getItem(chave);
      if (!bruto) return null;
      const registro = JSON.parse(bruto);
      if (!registro || typeof registro !== 'object' || !registro.salvoEm) return null;
      if (Date.now() - registro.salvoEm > IDADE_MAXIMA_CACHE) {
        localStorage.removeItem(chave);
        return null;
      }
      return registro;
    } catch (erro) {
      localStorage.removeItem(chave);
      return null;
    }
  }

  let temaAlteradoEm = 0;

  function gravarCache(perfil) {
    const usuario = (perfil && perfil.usuario) || {};
    const temaServidor = usuario.tema || null;
    // Uma troca de tema feita DEPOIS que o pedido saiu é mais nova que a
    // resposta do servidor: enquanto o PUT não confirmar, vale a escolha
    // do usuário. O marcador vive em memória e é reidratado do cache no
    // boot, para também cobrir a troca feita antes do primeiro perfil.
    const temaLocal = localStorage.getItem(CHAVE_TEMA);
    const localVence = !!(temaAlteradoEm && temaLocal && temaLocal !== temaServidor);

    // `curtidas` volta com uma linha completa por música curtida e
    // nenhuma tela usa esse campo — guardá-lo faria o cache crescer sem
    // limite e acabar batendo na cota do localStorage.
    const perfilLeve = perfil ? Object.assign({}, perfil) : null;
    if (perfilLeve) delete perfilLeve.curtidas;

    const registro = {
      salvoEm: Date.now(),
      perfil: perfilLeve,
      avatarUrl: usuario.avatar_url || null,
      nome: nomeExibido(usuario),
      tema: localVence ? temaLocal : temaServidor,
      temaAlteradoEm: localVence ? temaAlteradoEm : 0
    };
    try {
      localStorage.setItem(chaveCache(), JSON.stringify(registro));
    } catch (erro) {}
    return registro;
  }

  function ajustarCache(campos, preservarSalvoEm) {
    const atual = lerCache();
    // Sem registro não há o que ajustar: criar um cache órfão só
    // poluiria o storage (é o caso de um visitante trocando o tema).
    if (!atual) return null;

    const registro = Object.assign({}, atual, campos, {
      salvoEm: preservarSalvoEm ? atual.salvoEm : Date.now()
    });
    if (registro.perfil && registro.perfil.usuario) {
      registro.perfil.usuario.avatar_url = registro.avatarUrl;
    }
    try {
      localStorage.setItem(chaveCache(), JSON.stringify(registro));
    } catch (erro) {}
    return registro;
  }

  function pintarIniciais(caixa, nome) {
    const elemento = caixa.querySelector('.os-avatar-iniciais');
    if (!elemento) return;
    const texto = iniciais(nome);
    elemento.textContent = texto;
    if (texto) caixa.style.setProperty('--os-avatar-cor', corDoNome(nome));
    else caixa.style.removeProperty('--os-avatar-cor');
  }

  function pintarCaixa(caixa, avatarUrl, nome) {
    if (!caixa) return;
    pintarIniciais(caixa, nome);

    const img = caixa.querySelector('[data-os-img]');
    if (!img) return;

    const alvo = avatarUrl || AVATAR_PADRAO;
    if (img.getAttribute('src') === alvo && caixa.dataset.osEstado === 'pronto') return;

    caixa.dataset.osEstado = 'carregando';

    const finalizar = () => {
      caixa.dataset.osEstado = 'pronto';
      img.removeEventListener('load', finalizar);
      img.removeEventListener('error', cairNoPadrao);
    };

    const cairNoPadrao = () => {
      finalizar();
      if (!avatarUrl) return;
      img.src = AVATAR_PADRAO;
      if (img.complete) caixa.dataset.osEstado = 'pronto';
    };

    img.addEventListener('load', finalizar);
    img.addEventListener('error', cairNoPadrao);
    img.src = alvo;

    if (img.complete && img.naturalWidth > 0) {
      img.removeEventListener('load', finalizar);
      img.removeEventListener('error', cairNoPadrao);
      caixa.dataset.osEstado = 'pronto';
    }
  }

  function aplicarEstadoSessao() {
    const logado = estaLogado();
    document.documentElement.dataset.sessao = logado ? 'logado' : 'visitante';
    document.querySelectorAll('[data-os-so-logado]').forEach((elemento) => {
      elemento.classList.toggle('hidden', logado);
    });
    document.querySelectorAll('[data-os-so-visitor]').forEach((elemento) => {
      elemento.classList.toggle('hidden', !logado);
    });
  }

  function pintarTodos(registro) {
    const dados = registro === undefined ? lerCache() : registro;
    const avatarUrl = dados ? dados.avatarUrl : null;
    const nome = dados ? dados.nome : '';

    aplicarEstadoSessao();

    // Só antecipa a imagem se a página tem avatar para exibir — nas
    // páginas sem identidade, um preload aqui baixaria a foto sem
    // ninguém para mostrá-la.
    const caixas = document.querySelectorAll('[data-os-avatar]');
    caixas.forEach((caixa) => pintarCaixa(caixa, avatarUrl, nome));
    if (caixas.length && avatarUrl) precarregar(avatarUrl);

    if (nome) {
      document.querySelectorAll('[data-os-nome]').forEach((elemento) => {
        elemento.textContent = nome;
      });
    }
  }

  function precarregar(url) {
    if (!url || url === AVATAR_PADRAO || !document.head) return;
    try {
      const origem = new URL(url, window.location.href).origin;
      if (!document.querySelector('link[data-os-preconnect="' + origem + '"]')) {
        const conexao = document.createElement('link');
        conexao.rel = 'preconnect';
        conexao.href = origem;
        conexao.dataset.osPreconnect = origem;
        document.head.appendChild(conexao);
      }
      if (!document.querySelector('link[data-os-preload="' + url + '"]')) {
        const antecipacao = document.createElement('link');
        antecipacao.rel = 'preload';
        antecipacao.as = 'image';
        antecipacao.href = url;
        antecipacao.dataset.osPreload = url;
        document.head.appendChild(antecipacao);
      }
    } catch (erro) {}
  }

  function aplicarAtributoTema(tema) {
    if (tema === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }

  function aplicarTema(tema, local = true) {
    const alvo = tema === 'light' ? 'light' : 'dark';
    aplicarAtributoTema(alvo);
    try { localStorage.setItem(CHAVE_TEMA, alvo); } catch (erro) {}
    // Marca a troca local para que uma revalidação disparada antes do
    // clique não sobrescreva a escolha (ver notificar).
    if (local) {
      temaAlteradoEm = Date.now();
      ajustarCache({ tema: alvo, temaAlteradoEm: temaAlteradoEm }, true);
    }
    document.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: { tema: alvo } }));
  }

  function encerrarSessao() {
    try { localStorage.removeItem(CHAVE_SESSAO); } catch (erro) {}
    limparCache();
    document.dispatchEvent(new CustomEvent(EVENTO_SESSAO_INVALIDA));
  }

  function notificar(perfil, pedidoIniciadoEm) {
    const dados = gravarCache(perfil);
    // O tema do servidor só prevalece se a resposta for posterior à
    // última troca feita na própria página (senão uma revalidação que
    // já estava em voo desfaria o clique do usuário).
    if (dados.tema && (!dados.temaAlteradoEm || dados.temaAlteradoEm <= pedidoIniciadoEm)) {
      aplicarTema(dados.tema, false);
    }
    pintarTodos(dados);
  }

  let pedidoEmVoo = null;
  let tokenDoPedido = null;

  function revalidar({ forcar = false } = {}) {
    if (!estaLogado()) return Promise.resolve(null);
    if (pedidoEmVoo) return pedidoEmVoo;

    const cache = lerCache();
    const idade = cache ? Date.now() - cache.salvoEm : Infinity;
    if (!forcar && cache && idade < IDADE_MAXIMA_PERFIL) return Promise.resolve(cache.perfil);

    tokenDoPedido = token();
    const iniciadoEm = Date.now();

    pedidoEmVoo = (async () => {
      try {
        const resposta = await fetch(API_BASE + '/api/perfil', {
          headers: { Authorization: 'Bearer ' + tokenDoPedido }
        });
        if (resposta.status === 401) {
          // Token rejeitado: sem isso o cache continuaria pintado por
          // até 7 dias e a página seguiria ACHANDO que há sessão.
          encerrarSessao();
          return null;
        }
        if (!resposta.ok) return null;
        const { perfil } = await resposta.json();
        if (!perfil || !perfil.usuario) return null;
        // A conta pode ter mudado (logout/login) enquanto a resposta
        // viajava: nesse caso o dado é de outra pessoa e não pode ser
        // cacheado nem pintado na sessão nova.
        if (token() !== tokenDoPedido) return null;
        notificar(perfil, iniciadoEm);
        return perfil;
      } catch (erro) {
        console.error('Erro ao revalidar o perfil:', erro);
        return null;
      } finally {
        pedidoEmVoo = null;
        tokenDoPedido = null;
      }
    })();

    return pedidoEmVoo;
  }

  function aoTrocarAvatar(avatarUrl) {
    const registro = ajustarCache({ avatarUrl: avatarUrl || null });
    pintarTodos(registro || { avatarUrl: avatarUrl || null, nome: '' });
  }
  function aoEntrar() {
    pintarTodos(lerCache());
    return revalidar({ forcar: true });
  }

  function limparCache() {
    // Remove a identidade de todas as contas, não só da atual: aí o
    // chamador não precisa se preocupar em remover o token antes (a
    // chave do cache é derivada dele). O prefixo legado vem junto
    // porque a implementação anterior guardava o perfil completo
    // (bio, playlists) e nunca mais o apagou.
    const chaves = [];
    for (let i = 0; i < localStorage.length; i++) {
      const chave = localStorage.key(i);
      if (chave && (chave.startsWith(PREFIXO_CACHE) || chave.startsWith(PREFIXO_CACHE_LEGADO))) chaves.push(chave);
    }
    chaves.forEach((chave) => {
      try { localStorage.removeItem(chave); } catch (erro) {}
    });
    pintarTodos(null);
  }

  // Monta o link para o perfil de alguém. Quando não há identificador
  // (música sem dono, por exemplo) devolve um <span> comum: assim o texto
  // continua aparecendo, sem virar um link quebrado nem mudar o layout.
  function linkPerfil(opcoes) {
    const dados = opcoes || {};
    const identificador = dados.identificador;
    const texto = dados.texto || '';
    const classe = dados.classe || '';

    if (identificador === null || identificador === undefined || identificador === '') {
      const span = document.createElement('span');
      if (classe) span.className = classe;
      span.textContent = texto;
      return span;
    }

    const link = document.createElement('a');
    link.className = (classe ? classe + ' ' : '') + 'os-link-perfil';
    link.href = 'perfil.html?u=' + encodeURIComponent(identificador);
    link.textContent = texto;
    if (dados.descricao) link.title = dados.descricao;
    return link;
  }

  window.OS = {
    IDADE_MAXIMA_CACHE: IDADE_MAXIMA_CACHE,
    perfilCacheado: function (maxIdade) {
      const cache = lerCache();
      if (!cache || !cache.perfil) return null;
      const limite = maxIdade === undefined ? IDADE_MAXIMA_PERFIL : maxIdade;
      if (Date.now() - cache.salvoEm > limite) return null;
      return cache.perfil;
    },
    invalidar: function () {
      const chave = chaveCache();
      const cache = lerCache();
      if (!cache) return;
      cache.salvoEm = Date.now() - IDADE_MAXIMA_PERFIL - 1;
      try { localStorage.setItem(chave, JSON.stringify(cache)); } catch (erro) {}
    },
    revalidar: revalidar,
    aoTrocarAvatar: aoTrocarAvatar,
    aoEntrar: aoEntrar,
    limparCache: limparCache,
    pintarTodos: pintarTodos,
    aplicarTema: aplicarTema,
    // Perfil público de outra pessoa: a caixa mostrada NÃO é a do usuário
    // logado, então não pode usar [data-os-avatar] (pintarTodos sobrescreveria
    // com o avatar de quem está logado). Esta função faz a mesma pintura,
    // mas com o avatar/nome que a rota pública devolveu.
    pintarCaixa: pintarCaixa,
    // Link para o perfil de alguém, para os pontos de entrada (cartão de
    // artista, nome no player, resultado de busca).
    linkPerfil: linkPerfil
  };

  const cacheInicial = estaLogado() ? lerCache() : null;
  temaAlteradoEm = (cacheInicial && cacheInicial.temaAlteradoEm) || 0;

  // Ainda no <head>, antes de existir qualquer elemento no body: o CSS
  // já sabe se o visitante está logado, então "Entrar"/"registre-se"
  // nunca chegam a ser pintados para quem já está autenticado.
  aplicarEstadoSessao();

  if (localStorage.getItem(CHAVE_TEMA) === 'light') aplicarAtributoTema('light');

  document.addEventListener('DOMContentLoaded', () => {
    pintarTodos(cacheInicial);
    // O tema salvo localmente é a decisão mais recente do usuário, então
    // ele vem primeiro; o cache do servidor só entra como reserva (e só
    // importa para quem nunca trocou o tema nesta máquina).
    const tema = localStorage.getItem(CHAVE_TEMA) || (cacheInicial && cacheInicial.tema) || 'dark';
    aplicarAtributoTema(tema);
    document.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: { tema } }));
  });

  window.addEventListener('storage', (evento) => {
    // Token removido em outra aba = logout lá. Esta aba precisa
    // soltar a identidade no mesmo instante, senão continua mostrando
    // o avatar e o nome de quem já saiu.
    if (evento.key === CHAVE_SESSAO) {
      pintarTodos(null);
      document.dispatchEvent(new CustomEvent(EVENTO_SESSAO_INVALIDA));
      return;
    }
    if (evento.key === CHAVE_TEMA) {
      if (!evento.newValue) return;
      aplicarAtributoTema(evento.newValue);
      document.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: { tema: evento.newValue } }));
      return;
    }
    if (evento.key === chaveCache()) {
      const cache = evento.newValue ? lerCache() : null;
      if (cache) pintarTodos(cache);
      else pintarTodos(null);
    }
  });
})();
