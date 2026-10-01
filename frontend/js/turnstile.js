// ============================================================
// CLOUDFLARE TURNSTILE
// ============================================================
// Widget invisível por padrão: na maioria dos casos o Cloudflare decide
// sozinho, sem o usuário clicar em nada. Só aparece o desafio visual
// quando ele desconfia do acesso.
//
// A site key é pública — pode e deve ir no front. A secret key nunca sai
// do backend (TURNSTILE_SECRET no .env do Render).
//
// Chaves de teste do Cloudflare, para desenvolvimento:
//   1x00000000000000000000AA -> aprova sempre, sem desafio
//   2x00000000000000000000AB -> reprova sempre
//   3x00000000000000000000FF -> exige clique (aparece o checkbox)
const TURNSTILE_SITE_KEY = '0x4AAAAAAFKxORfpt7mytotI';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Carregado sob demanda e uma vez só: o site tem três formulários que
// usam captcha e cada um pode pedir o script antes do outro.
let promessaScript = null;

function carregarTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (promessaScript) return promessaScript;

  promessaScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile carregou sem globais')));
    script.onerror = () => reject(new Error('Falha ao carregar o script do Turnstile'));
    document.head.appendChild(script);
  }).catch((erro) => {
    // Deixa a próxima tentativa recarregar em vez de devolver sempre a mesma
    // promise já rejeitada.
    promessaScript = null;
    throw erro;
  });

  return promessaScript;
}

// Um captcha por id de container. Guardamos o widgetId porque o reset
// é por id, e o token é por callback — o formulário só precisa guardar a
// string que o widget gerou na última validação.
const widgetsTurnstile = new Map();
const tokensTurnstile = new Map();

function montarTurnstile(idContainer, aoResolver) {
  const container = document.getElementById(idContainer);
  if (!container) return Promise.resolve(false);
  if (widgetsTurnstile.has(idContainer)) return Promise.resolve(true);

  return carregarTurnstile()
    .then((turnstile) => {
      if (widgetsTurnstile.has(idContainer)) return true;

      const widgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        // interaction-only é o que faz o widget não atrapalhar: ele só
        // aparece se o Cloudflare exigir interação. Invisible seria ainda
        // mais discreto, mas praticamente nunca desafia ninguém, e o
        // formulário inteiro ficaria sem challenge até para um humano.
        appearance: 'interaction-only',
        execution: 'render',
        callback: (token) => {
          tokensTurnstile.set(idContainer, token);
          if (typeof aoResolver === 'function') aoResolver(token);
        },
        'expired-callback': () => tokensTurnstile.delete(idContainer),
        'error-callback': () => tokensTurnstile.delete(idContainer),
        'timeout-callback': () => tokensTurnstile.delete(idContainer)
      });

      widgetsTurnstile.set(idContainer, widgetId);
      return true;
    })
    .catch((erro) => {
      console.error('Turnstile:', erro);
      // Sem captcha o formulário continua utilizável: quem não tem
      // JavaScript, ou está atrás de bloqueador agressivo, ainda
      // consegue se cadastrar. O backend decide o que fazer.
      return false;
    });
}

function obterTokenTurnstile(idContainer) {
  return tokensTurnstile.get(idContainer) || '';
}

// O token vale uma vez e expira em ~5 minutos. Sempre que o pedido volta
// com erro — e-mail já cadastrado, senha fraca, qualquer coisa — é preciso
// um token novo, senão a próxima tentativa é recusada.
function resetarTurnstile(idContainer) {
  const widgetId = widgetsTurnstile.get(idContainer);
  tokensTurnstile.delete(idContainer);
  if (widgetId !== undefined && window.turnstile) {
    try {
      window.turnstile.reset(widgetId);
    } catch (erro) {
      console.error('Turnstile reset:', erro);
    }
  }
}