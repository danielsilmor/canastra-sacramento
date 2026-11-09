/*
 * ui.js: A tela do jogo
 *
 * Desenha a mesa a partir do estado do jogo (game.js) e transforma os
 * cliques do jogador em ações. Também faz os computadores jogarem.
 *
 * Acompanhamento das jogadas:
 * - Cada ação gera "eventos" no game.js (comprou, descartou, baixou...).
 * - A tela anima cada evento: uma cópia da carta "voa" da origem ao destino.
 * - No ritmo "Passo a passo", cada jogada do computador espera você clicar
 *   em "Continuar" (ou apertar Enter) antes de seguir.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CANCELLED = new Error('cancelado');
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('pt-BR');

// Ritmos: "anim" multiplica a duração das animações; "wait" é a pausa automática entre jogadas.
const PACE = {
  step: { anim: 1, wait: 0 },
  slow: { anim: 1.5, wait: 1600 },
  normal: { anim: 1, wait: 900 },
  fast: { anim: 0.5, wait: 250 },
};
const CARD_W = 70; // largura da carta grande (igual ao --card-w do CSS)
// Tamanhos de carta da engrenagem: [chave, nome, largura da carta em px].
// Cada tamanho é o mesmo em todas as áreas ("Muito pequeno" é igual na mesa, na mão e no monte).
const CARD_SIZES = [
  ['xs', 'Muito pequeno', 38],
  ['s', 'Pequeno', 46],
  ['m', 'Médio', 58],
  ['l', 'Grande', 70],
  ['xl', 'Muito grande', 84],
];
// Áreas com tamanho próprio:
// [chave, nome, explicação, variável do CSS, largura da carta no desenho original, tamanho padrão]
const CARD_AREAS = [
  ['table', 'Jogos na mesa', 'sequências baixadas e área de abertura', '--zoom-table', 46, 's'],
  ['hand', 'Sua mão', 'as cartas que você segura', '--zoom-hand', 70, 'l'],
  ['piles', 'Monte e lixo', 'pilhas de compra e descarte', '--zoom-piles', 70, 'l'],
];
// Configurações padrão (usadas na primeira vez e no botão "Restaurar padrão").
const DEFAULT_SETTINGS = () => ({
  pace: 'step',
  levels: { 1: 'moderado', 2: 'moderado', 3: 'moderado' },
  cardSizes: Object.fromEntries(CARD_AREAS.map((a) => [a[0], a[5]])),
  debug: false,         // modo depuração: explicar as decisões dos bots
  showBotCards: false,  // modo depuração: mostrar as cartas dos bots
});
const SETTINGS_COOKIE = 'canastra-settings';

// Transforma um texto em HTML, trocando cada carta citada (ex.: "Q♠", "10♥", "Coringão")
// por uma fichinha branca com a cor da carta.
function cardTagsHtml(text) {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return safe
    .replace(/(10|[2-9JQKA])([♠♥♦♣])/g, (m, rank, suit) =>
      `<span class="cardtag ${suit === '♥' || suit === '♦' ? 'red' : ''}">${rank}${suit}</span>`)
    .replace(/Coringão/g, '<span class="cardtag joker">Coringão</span>');
}

// Chapéu de bobo da corte (símbolo do coringão), em vetor. Usa a cor do texto da carta.
const ICON_JESTER =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<circle cx="12" cy="3.1" r="2"/><circle cx="2.7" cy="8.9" r="1.9"/><circle cx="21.3" cy="8.9" r="1.9"/>' +
  '<path d="M3.9 9.8C6.2 9.6 7.9 10.3 8.9 11.4L12 4.9l3.1 6.5c1-1.1 2.7-1.8 5-1.6' +
  '-1.8 1.9-2.1 5.2-2 8.6H5.9c.1-3.4-.2-6.7-2-8.6Z"/>' +
  '<rect x="4.6" y="17.7" width="14.8" height="3.6" rx="1.8"/></svg>';

// Ícone "cartas de baralho" no estilo Lucide, com um X no lugar do naipe.
const ICON_CLEAR_CARDS =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="3" width="12" height="18" rx="2"/>' +
  '<path d="m6 6.6-1.6.6a2 2 0 0 0-1.2 2.6l3.4 9a2 2 0 0 0 2.4 1.2"/>' +
  '<path d="m12.5 9.5 5 5"/><path d="m17.5 9.5-5 5"/></svg>';
// Personagens dos bots: [nome, arquivo da imagem em img/avatars, feminino?].
// A cada vez que a página abre (ou é atualizada), 3 deles são sorteados para a mesa.
// "Nova partida" mantém os mesmos personagens.
const CHARACTERS = [
  ['Aline', 'aline', true], ['Amara', 'amara', true], ['Cida', 'cida', true], ['Kátia', 'katia', true],
  ['Melina', 'melina', true], ['Raíssa', 'raissa', true], ['Soraia', 'soraia', true], ['Thuana', 'thuana', true],
  ['Danilo', 'danilo', false], ['Galvão', 'galvao', false], ['Lucas', 'lucas', false], ['Luiz', 'luiz', false],
  ['Pipe', 'pipe', false], ['Ricardo', 'ricardo', false], ['Sóstenes', 'sostenes', false], ['Vitor', 'vitor', false],
].map(([name, file, female]) => ({ name, img: `img/avatars/${file}.png`, female }));

// Sorteia 3 personagens diferentes para os lugares 1, 2 e 3.
function drawCharacters() {
  const pool = shuffle([...CHARACTERS]);
  return { 1: pool[0], 2: pool[1], 3: pool[2] };
}

const UI = {
  game: null,
  selected: new Set(),   // ids das cartas selecionadas na mão
  staging: null,         // abertura sendo montada: { pickup, melds: [[ids]] }
  busy: false,           // true enquanto há animação ou computadores jogando
  token: 0,              // muda a cada nova partida (interrompe jogadas antigas)
  pace: 'step',
  levels: { 1: 'moderado', 2: 'moderado', 3: 'moderado' }, // inteligência de cada bot (lugar 1, 2 e 3)
  cardSizes: DEFAULT_SETTINGS().cardSizes,                 // tamanho das cartas de cada área
  characters: drawCharacters(),                            // personagens sorteados ao abrir a página
  debug: false,                                            // explicar as decisões dos bots
  showBotCards: false,                                     // mostrar as cartas dos bots
  msg: { text: '', type: 'info' },
  view: null,            // durante a distribuição: o que já foi mostrado na mesa
  eventCursor: 0,        // quantos eventos do jogo já foram animados
  logCursor: 0,          // quantas linhas do registro já foram narradas
  freshIds: new Set(),   // cartas da última jogada (ficam destacadas)
  narration: null,       // { text, waiting }
  confirmResolve: null,

  init() {
    $('btn-new').onclick = () => {
      if (confirm('Começar uma nova partida? O placar atual será perdido.')) this.newMatch();
    };
    $('btn-rules').onclick = () => this.showRules();
    $('btn-log-toggle').onclick = () => this.setLogCollapsed(!this.logCollapsed);
    let collapsed = false;
    try { collapsed = localStorage.getItem('canastra-log-collapsed') === '1'; } catch (e) { /* sem armazenamento */ }
    this.setLogCollapsed(collapsed);
    this.loadSettings();
    $('btn-settings').onclick = () => this.showSettings();
    $('modal').onclick = (e) => {
      if (e.target.id === 'modal' && this.modalClosable) this.hideModal();
    };
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && this.confirmResolve && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        this.confirmResolve();
      }
    });
    this.newMatch();
  },

  newMatch() {
    this.token++;
    if (this.confirmResolve) this.confirmResolve();
    this.confirmResolve = null;
    this.busy = false;
    const c = this.characters; // os mesmos personagens a cada nova partida
    this.game = new Game({ names: ['Você', c[1].name, c[2].name, c[3].name] });
    this.eventCursor = 0;
    this.logCursor = 0;
    this.game.newMatch();
    this.selected.clear();
    this.staging = null;
    this.freshIds = new Set();
    this.narration = null;
    this.hideModal();
    this.say(`Nova partida! Você joga em dupla com ${c[2].name}, contra ${c[1].name} e ${c[3].name}.`);
    this.playRoundStart();
  },

  // ---------- Mensagens ----------

  say(text, type = 'info') {
    this.msg = { text, type };
  },
  error(text) {
    this.say(text, 'error');
    this.toast(text);
    this.render();
  },

  // Aviso flutuante, bem visível, que some sozinho depois de alguns segundos.
  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  },

  // Por que o jogador não pode agir agora? (null = pode agir)
  notMyTurnReason() {
    const g = this.game;
    const step = this.pace === 'step';
    // Esperando o "Continuar" (modo passo a passo): diz isso primeiro.
    if (this.confirmResolve) {
      return 'Ainda não é a sua vez. Clique em "Continuar" (ou aperte Enter) para seguir as jogadas.';
    }
    if (this.view) {
      return step
        ? 'Aguarde: as cartas ainda estão sendo distribuídas. No modo passo a passo, clique em "Continuar" para seguir as jogadas.'
        : 'Aguarde: as cartas ainda estão sendo distribuídas.';
    }
    if (g.phase === 'roundEnd') return 'A rodada terminou. Veja a pontuação para continuar.';
    if (g.current !== 0) {
      return `Ainda não é a sua vez. Aguarde ${g.players[g.current].name} jogar` +
        (step ? ' e depois clique em "Continuar".' : '.');
    }
    if (this.busy) return 'Aguarde um instante, a jogada ainda está acontecendo.';
    return null;
  },

  // Confere se o jogador pode agir; se não puder, mostra o motivo.
  canAct() {
    const reason = this.notMyTurnReason();
    if (reason) this.toast(reason);
    return !reason;
  },

  // ---------- Atalhos de estado ----------

  get me() {
    return this.game.players[0];
  },
  // Papel de cada lugar, no feminino ou masculino conforme o personagem sorteado.
  roleOf(seat) {
    if (seat === 0) return 'você';
    const f = this.characters[seat].female;
    if (seat === 2) return f ? 'sua parceira' : 'seu parceiro';
    return f ? 'adversária' : 'adversário';
  },
  // Foto redonda do personagem do bot.
  avatarHtml(seat, cls = '') {
    const c = this.characters[seat];
    return seat && c ? `<img class="avatar ${cls}" src="${c.img}" alt="" draggable="false">` : '';
  },
  get myTeam() {
    return this.game.teams[0];
  },
  isMyTurn() {
    const g = this.game;
    return !this.busy && g.current === 0 && (g.phase === 'draw' || g.phase === 'play');
  },
  // Durante a distribuição a tela mostra o "view", não o estado final.
  handOf(seat) {
    return this.view ? this.view.hands[seat] : this.game.players[seat].hand;
  },
  redOf(t) {
    return this.view ? this.view.red[t] : this.game.teams[t].redThrees;
  },
  stagedIds() {
    const ids = new Set();
    if (this.staging) this.staging.melds.forEach((m) => m.forEach((id) => ids.add(id)));
    return ids;
  },
  cardById(id) {
    if (id === 'TOP') return this.game.topDiscard;
    return this.me.hand.find((c) => c.id === id);
  },
  stagingPoints() {
    if (!this.staging) return 0;
    return this.staging.melds.flat().reduce((s, id) => s + cardValue(this.cardById(id)), 0);
  },
  // A abertura está usando a carta do topo do lixo?
  usingPickup() {
    return !!(this.staging && this.staging.pickup);
  },

  // ---------- Animações ----------

  // Guarda a posição de todas as cartas visíveis (para saber de onde cada uma "sai").
  snapshot() {
    const cards = new Map();
    document.querySelectorAll('[data-id]').forEach((el) => cards.set(el.dataset.id, el.getBoundingClientRect()));
    return { cards, stock: $('stock-card').getBoundingClientRect(), discard: $('discard-slot').getBoundingClientRect() };
  },

  seatRect(seat) {
    if (seat === 0) {
      const cards = $('hand').querySelectorAll('.card');
      const box = $('hand').getBoundingClientRect();
      if (!cards.length) return { left: box.left + 10, top: box.top + 18, width: 64, height: 90 };
      const last = cards[cards.length - 1].getBoundingClientRect();
      return { left: Math.min(last.left + 50, box.right - 70), top: last.top, width: 64, height: 90 };
    }
    const el = document.querySelector(`#seat-${seat} .stack .card:last-child`) || $('seat-' + seat);
    return el.getBoundingClientRect();
  },

  // Faz uma cópia da carta voar de "from" até "to".
  fly(card, from, to, duration) {
    const norm = (r) =>
      // Mais largo que uma carta (mesmo no tamanho "Muito grande") = é um quadro, não uma carta.
      r.width > 100 ? { left: r.left + r.width / 2 - 24, top: r.top + r.height / 2 - 34, width: 48 } : r;
    const a = norm(from);
    const b = norm(to);
    return new Promise((resolve) => {
      const el = card ? this.cardEl(card) : this.cardEl(null, { back: true });
      el.removeAttribute('data-id');
      el.classList.add('flying');
      el.style.left = a.left + 'px';
      el.style.top = a.top + 'px';
      el.style.transform = `scale(${a.width / CARD_W})`;
      document.body.appendChild(el);
      el.getBoundingClientRect(); // força o navegador a desenhar a posição inicial
      el.style.transition = `transform ${duration}ms cubic-bezier(0.3, 0.7, 0.3, 1)`;
      el.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / CARD_W})`;
      setTimeout(() => {
        el.remove();
        resolve();
      }, duration + 30);
    });
  },

  // Anima um evento do jogo, usando as posições guardadas antes da jogada.
  async animateEvent(ev, snap) {
    const dur = 480 * PACE[this.pace].anim;
    let cards;
    if (ev.type === 'pickup') cards = ev.pile;
    else if (ev.cards) cards = ev.cards;
    else if (ev.card) cards = [ev.card];
    else return;
    const flights = cards.map(async (card, i) => {
      await sleep(i * 70 * PACE[this.pace].anim);
      const from =
        snap.cards.get(String(card.id)) ||
        (ev.type === 'draw' ? snap.stock : ev.type === 'pickup' ? snap.discard : this.seatRect(ev.seat));
      const target = document.querySelector(`[data-id="${card.id}"]`);
      const to = target ? target.getBoundingClientRect() : this.seatRect(ev.seat);
      const faceUp = !(ev.type === 'draw' && ev.seat !== 0);
      if (target) target.style.visibility = 'hidden';
      await this.fly(faceUp ? card : null, from, to, dur);
      if (target) target.style.visibility = '';
    });
    await Promise.all(flights);
  },

  // Pega os eventos novos, destaca e anima. Retorna o texto do que aconteceu.
  async playNewEvents(snap) {
    const g = this.game;
    const evs = g.events.slice(this.eventCursor);
    this.eventCursor = g.events.length;
    const logs = g.log.slice(this.logCursor);
    this.logCursor = g.log.length;
    this.freshIds = new Set();
    for (const ev of evs) {
      for (const c of ev.cards || (ev.card ? [ev.card] : [])) this.freshIds.add(c.id);
    }
    this.render();
    for (const ev of evs) await this.animateEvent(ev, snap);
    return logs.map((l) => l.text);
  },

  // Espera o jogador confirmar (passo a passo) ou uma pausa (automático).
  async confirmStep(lines, token, why = []) {
    if (!lines.length) return;
    this.narration = { text: lines.join('\n'), waiting: this.pace === 'step', actor: this.actorSeat, why };
    this.render();
    if (this.pace === 'step') await new Promise((resolve) => (this.confirmResolve = resolve));
    else await sleep(PACE[this.pace].wait);
    this.confirmResolve = null;
    if (token !== this.token) throw CANCELLED;
    this.narration.waiting = false;
    this.narration.actor = null;
    this.render();
  },

  // ---------- Início da rodada: distribuição animada + 3 vermelhos ----------

  async playRoundStart() {
    const g = this.game;
    const token = this.token;
    this.busy = true;
    const evs = g.events.slice(this.eventCursor);
    this.eventCursor = g.events.length;
    const deal = evs.find((e) => e.type === 'deal');
    this.view = { hands: [[], [], [], []], red: [[], []] };
    this.view.stock = 106;
    this.freshIds = new Set();
    this.narration = { text: `Rodada ${g.round}: ${g.players[g.dealer].name} embaralha e distribui 15 cartas para cada jogador.`, waiting: false };
    this.render();
    try {
      // Distribuição: uma carta por vez, começando à direita do carteador.
      const pace = PACE[this.pace].anim;
      const flights = [];
      for (let i = 0; i < 15; i++) {
        for (let k = 1; k <= 4; k++) {
          const seat = (deal.dealer + k) % 4;
          const card = deal.hands[seat][i];
          const from = $('stock-card').getBoundingClientRect();
          flights.push(
            this.fly(null, from, this.seatRect(seat), 300 * pace).then(() => {
              this.view.hands[seat].push(card);
              this.view.stock--;
              this.render();
            })
          );
          await sleep(45 * pace);
          if (token !== this.token) throw CANCELLED;
        }
      }
      await Promise.all(flights);
      if (token !== this.token) throw CANCELLED;

      // 3 vermelhos recebidos: todos são mostrados um a um e confirmados juntos no final.
      const rest = evs.filter((e) => e !== deal);
      const lines = [];
      const fresh = new Set();
      this.actorSeat = null;
      for (let i = 0; i < rest.length; i++) {
        const ev = rest[i];
        if (ev.type !== 'redThree') continue;
        const p = g.players[ev.seat];
        let snap = this.snapshot();
        this.applyToView(ev);
        fresh.add(ev.card.id);
        this.freshIds = fresh;
        let text = `${p.name} recebeu o ${cardName(ev.card)} e baixou na mesa`;
        this.narration = { text: [...lines, text + '.'].join('\n'), waiting: false };
        this.render();
        await this.animateEvent(ev, snap);
        const next = rest[i + 1];
        if (next && next.type === 'draw' && next.seat === ev.seat) {
          snap = this.snapshot();
          this.applyToView(next);
          this.render();
          await this.animateEvent(next, snap);
          text += next.seat === 0 ? ` e comprou o ${cardName(next.card)} para repor` : ' e comprou outra para repor';
          i++;
        }
        lines.push(text + '.');
        await sleep(300 * PACE[this.pace].anim);
        if (token !== this.token) throw CANCELLED;
      }
      if (lines.length) await this.confirmStep(lines, token);
    } catch (e) {
      if (e === CANCELLED) return;
      throw e;
    }
    this.view = null;
    this.logCursor = g.log.length;
    this.busy = false;
    this.freshIds = new Set();
    this.narration = { text: `${g.players[g.current].name} começa jogando.`, waiting: false };
    this.afterAction();
  },

  applyToView(ev) {
    const hand = this.view.hands[ev.seat];
    if (ev.type === 'redThree') {
      const idx = hand.findIndex((c) => c.id === ev.card.id);
      if (idx >= 0) hand.splice(idx, 1);
      this.view.red[ev.seat % 2].push(ev.card);
    } else if (ev.type === 'draw') {
      hand.push(ev.card);
      this.view.stock--;
    }
  },

  // ---------- Ações do jogador ----------

  // Executa uma ação do jogador: guarda posições, aplica, anima e segue o jogo.
  async perform(action, successText) {
    const snap = this.snapshot();
    const r = action();
    if (!r.ok) return this.error(r.error);
    this.selected.clear();
    if (successText) this.say(successText, 'ok');
    this.busy = true;
    const lines = await this.playNewEvents(snap);
    this.narration = { text: lines.join('\n'), waiting: false };
    this.busy = false;
    this.afterAction();
  },

  onStock() {
    if (!this.canAct()) return;
    const g = this.game;
    if (g.phase !== 'draw') return this.error('Você já comprou nesta vez. Agora baixe sequências ou descarte.');
    if (this.staging && this.staging.pickup) {
      return this.error('Você está usando o lixo. Para comprar do monte, clique em "Desfazer" no jogo que tem a carta do lixo.');
    }
    // Primeiro a jogar: a carta que vai sair do monte (para explicar se não puder trocar).
    const first = g.isFirstTurn ? g.stock[g.stock.length - 1] : null;
    this.perform(() => {
      const r = g.drawFromStock(0);
      if (!r.ok) return r;
      const newCards = [...g.turn.newIds].map((id) => cardName(this.cardById(id))).join(', ');
      let text = g.turn.canSecondDraw
        ? `Você comprou ${newCards}. Como é o primeiro a jogar, se não quiser essa carta clique em "Trocar carta" ou jogue a carta no lixo: ela vai para o lixo e você compra outra.`
        : `Você comprou ${newCards}. Baixe sequências, se quiser, e depois descarte 1 carta.`;
      if (first && (isThree(first) || isWild(first))) {
        const what = isThree(first) ? 'um 3' : isJoker(first) ? 'um coringão' : 'um 2';
        text += ` Veio ${what}, então não dá para trocar de carta.`;
      }
      this.say(text, 'ok');
      return r;
    });
  },

  onSecondDraw() {
    if (!this.canAct()) return;
    const g = this.game;
    if (g.turn.firstCardId && this.stagedIds().has(g.turn.firstCardId)) {
      return this.error(`${cardName(this.cardById(g.turn.firstCardId))} está na área amarela. ` +
        'Clique em "Desfazer" no jogo dela antes de trocar a carta.');
    }
    this.perform(() => {
      const r = g.secondDraw(0);
      if (r.ok) {
        const newCards = [...g.turn.newIds].map((id) => cardName(this.cardById(id))).join(', ');
        this.say(`Você trocou de carta e recebeu ${newCards}.`, 'ok');
      }
      return r;
    });
  },

  // Pegar o lixo. "meldIndex" (opcional) = jogo da dupla onde encaixar o topo + cartas da mão.
  onPickup(meldIndex = null) {
    if (!this.canAct()) return;
    const g = this.game;
    if (g.phase !== 'draw') return this.error('Você já comprou nesta vez.');
    if (this.staging && this.staging.pickup) {
      return this.error('Você já está usando o lixo. Para juntar mais cartas, selecione-as e clique num jogo da abertura.');
    }
    const top = g.topDiscard;
    if (!top) return this.error('O lixo está vazio.');
    if (g.isDiscardBlocked()) return this.error(g.blockedReason());
    const ids = [...this.selected];
    // Regra: o topo do lixo + pelo menos 2 cartas da mão formando uma sequência entre si.
    if (ids.length < 2) {
      return this.error(`Para pegar o lixo, selecione pelo menos 2 cartas da mão que formem uma sequência com ${cardName(top)} e clique no lixo.`);
    }
    // As cartas selecionadas + o topo podem formar uma sequência ou várias
    // (ex.: dois jogos, cada um com o seu curinga). O jogo separa sozinho e,
    // se der para montar de mais de um jeito, pergunta qual o jogador quer.
    const all = [top, ...ids.map((id) => this.cardById(id))];
    let options = Rules.meldOptions(all);
    if (!options.length) {
      return this.error(`Com ${cardName(top)}: ${Rules.analyzeMeld(all).error} ` +
        'Para baixar mais de uma sequência, selecione cartas que formem sequências completas, cada uma com no máximo 1 curinga.');
    }
    const topGroup = (groups) => groups.find((gr) => gr.includes(top)); // a sequência que usa o topo do lixo
    if (this.myTeam.opened && meldIndex !== null) {
      // Jogo escolhido: só valem as montagens em que a sequência do topo encaixa nele.
      const target = this.myTeam.melds[meldIndex];
      const fitting = options.filter((o) => Rules.analyzeMeld(target.cards.concat(topGroup(o))).ok);
      if (!fitting.length) {
        return this.error(`${topGroup(options[0]).map(cardName).join(' ')} não encaixa nesse jogo. Clique no lixo para baixar como jogo novo.`);
      }
      options = fitting;
    }
    this.chooseArrangement(options, (groups) => this.pickupWith(groups, meldIndex), top);
  },

  // Pega o lixo com a montagem já escolhida.
  pickupWith(groups, meldIndex) {
    const g = this.game;
    const top = g.topDiscard;
    const toIds = (cards) => cards.map((c) => (c === top ? 'TOP' : c.id));
    const group = groups.find((gr) => gr.includes(top)); // a sequência que usa o topo do lixo
    const others = groups.filter((gr) => gr !== group);

    if (!this.myTeam.opened) {
      // Sequências já separadas antes (se houver) continuam na abertura.
      const before = this.staging ? this.staging.melds : [];
      this.staging = { pickup: true, melds: [toIds(group), ...others.map(toIds), ...before] };
      this.selected.clear();
      return this.tryCommitStaging();
    }
    const melds = this.myTeam.melds;
    const fits = (i) => Rules.analyzeMeld(melds[i].cards.concat(group)).ok;
    // Sem jogo escolhido: encaixa num jogo da dupla se couber; senão vira um jogo novo.
    const target = meldIndex !== null ? meldIndex : melds.findIndex((m, i) => fits(i));
    const plan = { pickup: true, newMelds: others.map(toIds) };
    if (target >= 0) plan.additions = [{ meldIndex: target, ids: toIds(group) }];
    else plan.newMelds.unshift(toIds(group));
    const extra = others.length ? ` e baixou mais ${others.length} sequência${others.length > 1 ? 's' : ''}` : '';
    this.perform(() => g.applyMelds(0, plan),
      `Você pegou o lixo${extra}! As cartas novas estão marcadas. Agora baixe o que quiser e descarte.`);
  },

  onMeld() {
    if (!this.canAct()) return;
    const g = this.game;
    const ids = [...this.selected];
    if (g.phase === 'draw' && !(this.staging && this.staging.pickup)) {
      return this.error('Primeiro compre uma carta: clique no monte ou pegue o lixo.');
    }
    if (ids.length < 3) return this.error('Selecione pelo menos 3 cartas para baixar uma sequência.');
    // Uma sequência ou várias de uma vez (o jogo separa as cartas e os curingas sozinho;
    // se der para montar de mais de um jeito, pergunta qual o jogador quer).
    const cards = ids.map((id) => this.cardById(id));
    const options = Rules.meldOptions(cards);
    if (!options.length) {
      return this.error(Rules.analyzeMeld(cards).error +
        ' Para baixar mais de uma sequência de uma vez, cada uma precisa estar completa, com no máximo 1 curinga.');
    }
    this.chooseArrangement(options, (groups) => this.meldGroups(groups));
  },

  // Baixa (ou separa na abertura) as sequências já montadas.
  meldGroups(groups) {
    const g = this.game;
    const groupIds = groups.map((gr) => gr.map((c) => c.id));

    if (!this.myTeam.opened) {
      if (!this.staging) this.staging = { pickup: false, melds: [] };
      this.staging.melds.push(...groupIds);
      this.selected.clear();
      return this.tryCommitStaging();
    }
    this.perform(() => g.applyMelds(0, { newMelds: groupIds }),
      groups.length > 1 ? `${groups.length} sequências baixadas!` : 'Sequência baixada!');
  },

  // Enquanto a dupla não abriu, as sequências ficam "separadas" até somar o mínimo.
  tryCommitStaging() {
    const g = this.game;
    const pts = this.stagingPoints();
    const min = this.myTeam.minOpen;
    const melds = this.staging.melds.map((m) => m.map((id) => this.cardById(id)));
    const canastra = melds.some((m) => Rules.isCanastra(m));
    if (!Rules.opensGame(melds, min)) {
      this.say(`Abertura: ${pts} de ${min} pontos (ou uma canastra de 7 cartas). Para somar, selecione cartas e clique num jogo da área amarela ` +
        '(acrescentar) ou no painel "Nós" (sequência nova). "Desfazer" devolve um jogo.');
      return this.render();
    }
    // Sem comprar não dá para abrir (acontece se o jogo com a carta do lixo foi desfeito).
    if (g.phase === 'draw' && !this.staging.pickup) {
      this.say('Compre do monte ou pegue o lixo para continuar a abertura.');
      return this.render();
    }
    const staging = this.staging;
    // A tela ainda mostra as cartas "separadas": a animação sai delas para a mesa.
    this.perform(() => {
      const r = g.applyMelds(0, { pickup: staging.pickup, newMelds: staging.melds });
      if (!r.ok) r.error += ' Clique em "Cancelar abertura" para desfazer.';
      else this.staging = null;
      return r;
    }, (canastra && pts < min ? 'Sua dupla abriu o jogo com uma canastra!' : `Sua dupla abriu o jogo com ${pts} pontos!`) +
      (staging.pickup ? ' Você pegou o lixo.' : ''));
  },

  onCancelStaging() {
    const pickup = this.staging && this.staging.pickup;
    this.staging = null;
    this.say('Abertura cancelada. As cartas voltaram para a mão' +
      (pickup ? ` e ${cardName(this.game.topDiscard)} continua no lixo.` : '.'));
    this.render();
  },

  // Clique num jogo da área amarela: acrescenta as cartas selecionadas a ele.
  onStagedMeldClick(i) {
    if (!this.canAct()) return;
    const g = this.game;
    if (g.phase === 'draw' && !this.staging.pickup) {
      return this.error('Primeiro compre uma carta: clique no monte ou pegue o lixo.');
    }
    const ids = [...this.selected];
    if (!ids.length) {
      return this.error('Selecione cartas da mão e clique neste jogo para acrescentá-las. ' +
        'Para devolver uma carta, clique nela; para devolver o jogo inteiro, clique em "Desfazer".');
    }
    const meld = this.staging.melds[i];
    const top = g.topDiscard;
    const a = Rules.analyzeMeld([...meld, ...ids].map((id) => this.cardById(id)));
    if (!a.ok) {
      return this.error(`${a.error} Para separar uma sequência nova, clique no painel "Nós".`);
    }
    this.staging.melds[i] = a.ordered.map((c) => (c === top && meld.includes('TOP') ? 'TOP' : c.id));
    this.selected.clear();
    this.tryCommitStaging();
  },

  // "Desfazer" num jogo da área amarela: as cartas voltam para a mão
  // (e a carta do lixo, se estiver nele, continua no lixo).
  onUnstage(i) {
    if (!this.canAct()) return;
    const g = this.game;
    const meld = this.staging.melds[i];
    const hadTop = meld.includes('TOP');
    this.staging.melds.splice(i, 1);
    if (hadTop) this.staging.pickup = false;
    const left = this.staging.melds.length;
    if (!left) this.staging = null;
    let text = hadTop
      ? `Jogo desfeito: ${cardName(g.topDiscard)} continua no lixo e as outras cartas voltaram para a mão.`
      : 'Jogo desfeito: as cartas voltaram para a mão.';
    if (hadTop && left) text += ' Para continuar, compre do monte ou pegue o lixo de novo.';
    else if (left) text += ` Abertura: ${this.stagingPoints()} de ${this.myTeam.minOpen} pontos.`;
    this.say(text, 'ok');
    this.render();
  },

  // Clique numa carta de um jogo da área amarela (sem cartas selecionadas):
  // devolve só essa carta para a mão, se o jogo continuar válido sem ela.
  onUnstageCard(i, card) {
    if (!this.canAct()) return;
    const top = this.game.topDiscard;
    const meld = this.staging.melds[i];
    const hasTop = meld.includes('TOP');
    if (hasTop && card === top) {
      return this.error(`${cardName(card)} é a carta do lixo. Para devolvê-la ao lixo, clique em "Desfazer" neste jogo.`);
    }
    const rest = meld.filter((id) => id !== card.id);
    const a = Rules.analyzeMeld(rest.map((id) => this.cardById(id)));
    if (!a.ok) {
      return this.error(`Sem ${cardName(card)} o jogo fica inválido: ${a.error} ` +
        'Para devolver o jogo inteiro, clique em "Desfazer".');
    }
    this.staging.melds[i] = a.ordered.map((c) => (hasTop && c === top ? 'TOP' : c.id));
    this.say(`${cardName(card)} voltou para a mão. Abertura: ${this.stagingPoints()} de ${this.myTeam.minOpen} pontos.`, 'ok');
    this.render();
  },

  // Clique num jogo já baixado: acrescenta as cartas selecionadas a ele.
  onMeldClick(teamIdx, meldIndex) {
    if (!this.canAct()) return;
    if (teamIdx !== 0) return this.error('Esse é um jogo dos adversários. Baixe as suas cartas no painel "Nós".');
    const g = this.game;
    // Na hora de comprar: clicar num jogo com 2+ cartas selecionadas pega o lixo e encaixa ali.
    if (g.phase === 'draw' && !this.staging) {
      if (this.selected.size >= 2 && g.topDiscard) return this.onPickup(meldIndex);
      return this.error('Primeiro compre uma carta: clique no monte ou pegue o lixo. ' +
        'Para pegar o lixo e encaixar neste jogo, selecione 2 cartas que formem sequência com o topo e clique no jogo.');
    }
    if (this.staging) return this.error('Complete a abertura ou clique em "Cancelar abertura" primeiro.');
    const ids = [...this.selected];
    if (!ids.length) return this.error('Selecione cartas da sua mão e depois clique no jogo para acrescentá-las.');
    this.perform(() => g.applyMelds(0, { additions: [{ meldIndex, ids }] }), 'Cartas acrescentadas!');
  },

  // Clique na área de jogos da dupla (fora de um jogo): baixa uma sequência nova.
  onTeamAreaClick(teamIdx) {
    if (!this.canAct()) return;
    if (teamIdx !== 0) return this.error('Esse é o painel dos adversários. Baixe as suas cartas no painel "Nós".');
    if (this.game.phase === 'draw' && !(this.staging && this.staging.pickup)) {
      return this.error('Primeiro compre uma carta: clique no monte ou pegue o lixo. Depois você pode baixar.');
    }
    if (!this.selected.size) {
      return this.error('Selecione as cartas da mão que quer baixar e depois clique aqui.');
    }
    this.onMeld();
  },

  // Clique no lixo: na hora de comprar, pega o lixo; depois, descarta a carta selecionada.
  onDiscardPileClick() {
    if (!this.canAct()) return;
    if (this.game.phase === 'draw') return this.onPickup();
    this.onDiscard();
  },

  onDiscard() {
    if (!this.canAct()) return;
    const g = this.game;
    if (g.phase !== 'play') return this.error('Primeiro compre uma carta: clique no monte ou pegue o lixo.');
    if (this.staging) return this.error('Complete a abertura ou clique em "Cancelar abertura" antes de descartar.');
    const ids = [...this.selected];
    if (ids.length !== 1) return this.error('Para descartar, selecione exatamente 1 carta e clique no lixo.');
    // Primeiro a jogar, descartando a carta que acabou de comprar: oferece trocar por outra do monte.
    if (g.turn.canSecondDraw && ids[0] === g.turn.firstCardId) return this.askSecondDraw(ids[0]);
    this.say('');
    this.perform(() => g.discard(0, ids[0]), '');
  },

  // Pergunta se o jogador quer trocar a carta comprada (e comprar outra) ou descartar e passar a vez.
  askSecondDraw(cardId) {
    const g = this.game;
    const name = cardName(this.cardById(cardId));
    this.showModal(`
      <h2>Trocar de carta?</h2>
      <p>Como você é o primeiro a jogar, pode recusar ${cardTagsHtml(name)} e comprar outra carta do monte.
      A carta recusada vai para o lixo e a sua vez continua.</p>
      <p>Se preferir, descarte ${cardTagsHtml(name)} normalmente: a sua vez termina.</p>
      <div class="modal-actions">
        <button class="btn-light" id="btn-sd-discard">Descartar e passar a vez</button>
        <button class="btn-primary" id="btn-sd-swap">Trocar e comprar outra</button>
      </div>`, true);
    $('btn-sd-swap').onclick = () => {
      this.hideModal();
      this.onSecondDraw();
    };
    $('btn-sd-discard').onclick = () => {
      this.hideModal();
      if (!this.canAct() || g.phase !== 'play') return;
      this.say('');
      this.perform(() => g.discard(0, cardId), '');
    };
  },

  // ---------- Arrastar e soltar ----------

  // Torna um elemento um "alvo" onde dá para soltar cartas arrastadas.
  // Usa propriedades (ondragover...) para não acumular eventos a cada redesenho.
  dropTarget(el, accept, onDrop) {
    el.ondragover = (e) => {
      if (!this.drag || !accept(this.drag)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop-over');
    };
    el.ondragleave = (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('drop-over');
    };
    el.ondrop = (e) => {
      if (!this.drag || !accept(this.drag)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-over');
      const d = this.drag;
      this.drag = null;
      onDrop(d);
    };
  },

  // Começa a arrastar algo (cartas da mão, o monte ou o lixo).
  startDrag(e, drag, reasonIfBlocked) {
    const reason = this.notMyTurnReason() || reasonIfBlocked;
    if (reason) {
      e.preventDefault();
      this.toast(reason);
      return;
    }
    this.drag = drag;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'canastra');
  },

  endDrag() {
    this.drag = null;
    document.querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'));
  },

  // Solta cartas da mão: usa as mesmas ações dos cliques.
  dropHandCards(ids, action) {
    this.selected = new Set(ids);
    action();
  },

  onEndRound() {
    if (!this.canAct()) return;
    this.staging = null; // cartas separadas continuam na mão
    this.perform(() => this.game.endByEmptyStock(0), '');
  },

  // Depois de cada ação: fim de rodada? vez dos computadores? ou continua comigo.
  afterAction() {
    const g = this.game;
    this.render();
    if (g.phase === 'roundEnd') return this.showRoundEnd();
    if (g.current !== 0) this.runBots();
    else if (g.phase === 'draw' && !this.msg.text.startsWith('Você comprou')) {
      this.say(g.stock.length
        ? 'Sua vez! Compre do monte ou pegue o lixo.'
        : 'O monte acabou! Você pode pegar o lixo (se conseguir usar a carta do topo) ou encerrar a rodada.');
      this.render();
    }
  },

  async runBots() {
    if (this.busy) return;
    const g = this.game;
    const token = this.token;
    this.busy = true;
    this.selected.clear(); // fora da sua vez não há cartas selecionadas
    let snap = this.snapshot();
    let turnLines = [];
    // Cada passo do computador (comprar, baixar, descartar) é animado na hora.
    // A confirmação vem só no fim da jogada completa, com o resumo de tudo.
    const pause = async () => {
      const lines = await this.playNewEvents(snap);
      if (token !== this.token) throw CANCELLED;
      turnLines.push(...lines);
      this.narration = { text: turnLines.join('\n'), waiting: false, actor: this.actorSeat };
      this.render();
      await sleep(this.pace === 'step' ? 650 : PACE[this.pace].wait);
      if (token !== this.token) throw CANCELLED;
      snap = this.snapshot();
    };
    try {
      while ((g.phase === 'draw' || g.phase === 'play') && !g.players[g.current].isHuman) {
        const seat = g.current;
        this.actorSeat = seat;
        turnLines = [];
        this.narration = { text: `${g.players[seat].name} está pensando…`, waiting: false, actor: seat };
        this.render();
        await sleep(this.pace === 'step' ? 400 : PACE[this.pace].wait / 2);
        if (token !== this.token) throw CANCELLED;
        snap = this.snapshot();
        const before = g.events.length + g.log.length;
        await AI.takeTurn(g, seat, pause, this.levels[seat], this.debug);
        if (g.events.length !== this.eventCursor || g.log.length !== this.logCursor) await pause();
        if (before === g.events.length + g.log.length) throw new Error('o computador não conseguiu jogar');
        // Modo depuração: os motivos da jogada vão para o quadro da jogada e para o histórico.
        const why = this.debug ? [...AI.lastTrace] : [];
        if (why.length) {
          g.log.push({ text: `Por quê? (${g.players[seat].name})`, seat, why });
          this.logCursor = g.log.length; // já mostrado: não entra na narração
          this.narration.why = why;
          this.render();
        }
        if (g.phase !== 'roundEnd') {
          turnLines.push(g.current === 0 ? 'Agora é a sua vez!' : `Agora é a vez de ${g.players[g.current].name}.`);
        }
        if (this.pace === 'step') await this.confirmStep(turnLines, token, why);
      }
      this.actorSeat = null;
      if (this.narration) this.narration.actor = null;
    } catch (e) {
      if (e === CANCELLED) return;
      console.error(e);
      this.say('Erro interno: ' + e.message, 'error');
    }
    this.busy = false;
    this.afterAction();
  },

  // ---------- Desenho da tela ----------

  cardEl(c, opts = {}) {
    const el = document.createElement('div');
    if (opts.back) {
      el.className = 'card back' + (opts.small ? ' small' : '') + (opts.mini ? ' mini' : '');
      return el;
    }
    el.className = 'card' + (opts.small ? ' small' : '');
    el.dataset.id = c.id;
    if (isRedSuit(c)) el.classList.add('red');
    if (isWild(c)) el.classList.add('wild');
    if (this.freshIds.has(c.id)) el.classList.add('fresh');
    if (isJoker(c)) {
      el.classList.add('joker');
      el.innerHTML = `<span class="rank">JK</span><span class="suit">${ICON_JESTER}</span>`;
    } else {
      el.innerHTML = `<span class="rank">${RANK_LABEL[c.rank]}</span><span class="suit">${SUIT_SYMBOL[c.suit]}</span>`;
    }
    el.title = cardName(c) + (isWild(c) ? ' (curinga)' : '') + `, vale ${cardValue(c)} pontos`;
    return el;
  },

  render() {
    if (!this.game) return;
    this.renderScore();
    [0, 1, 2, 3].forEach((s) => this.renderSeat(s));
    this.renderTeam(0);
    this.renderTeam(1);
    this.renderPiles();
    this.renderStaging();
    this.renderHand();
    this.renderActions();
    this.renderStatus();
    this.renderLog();
  },

  renderScore() {
    const g = this.game;
    const block = (label, value, cls = '') =>
      `<div class="score ${cls}"><span class="label">${label}</span><span class="value">${value}</span></div>`;
    const vu = (t) => (Rules.isVU(t.score) ? ' <span class="chip red tiny">VU</span>' : '');
    $('scoreboard').innerHTML =
      block('Nós' + vu(g.teams[0]), fmt(g.teams[0].score), 'us') +
      block('Eles' + vu(g.teams[1]), fmt(g.teams[1].score)) +
      block('Rodada', g.round) +
      block('Meta', fmt(Rules.TARGET), 'meta');
  },

  isActive(seat) {
    const g = this.game;
    return !this.view && g.current === seat && g.phase !== 'roundEnd';
  },

  renderSeat(seat) {
    const g = this.game;
    const p = g.players[seat];
    const el = $('seat-' + seat);
    const active = this.isActive(seat);
    el.classList.toggle('active', active);
    el.classList.toggle('me', seat === 0);
    const dealer = g.dealer === seat && g.phase !== 'roundEnd'
      ? '<span class="dealer" title="Carteador">D</span>' : '';
    const playing = active
      ? `<span class="chip ${seat === 0 ? 'green' : 'yellow'} tiny playing">${seat === 0 ? 'sua vez' : 'jogando'}</span>` : '';
    const n = this.handOf(seat).length;
    el.innerHTML = this.avatarHtml(seat) +
      `<div class="info"><div class="top"><span class="name">${p.name}</span>${dealer}<span class="role"><span class="role-name">${this.roleOf(seat)}</span>` +
      `${seat ? ` · ${AI.LEVELS[this.levels[seat]].label}` : ''}</span>${playing}</div>` +
      `<div class="mid"><div class="stack"></div><span class="count">${n}</span><span class="unit">cartas</span></div>` +
      // Modo depuração: as cartas do bot viradas para cima.
      (this.showBotCards && seat && n
        ? `<div class="bot-hand" title="Cartas de ${p.name} (modo depuração)">${cardTagsHtml(sortHand(this.handOf(seat)).map(cardName).join(' '))}</div>`
        : '') +
      '</div>';
    // Pilha de versos deslocados para o lado: quanto mais cartas, mais "grossa".
    const stack = el.querySelector('.stack');
    const layers = Math.min(n, 12);
    for (let i = 0; i < layers; i++) {
      const back = this.cardEl(null, { back: true, mini: true });
      back.style.left = i * 4 + 'px';
      stack.appendChild(back);
    }
    stack.style.width = (layers ? 24 + (layers - 1) * 4 : 24) + 'px';
  },

  renderTeam(t) {
    const g = this.game;
    const team = g.teams[t];
    const melds = this.view ? [] : team.melds;
    const red = this.redOf(t);
    const el = $('team-' + t);
    const hasSel = this.selected.size > 0;
    // Jogos clicáveis: depois de comprar (acrescentar cartas) ou, na hora de comprar,
    // com 2+ cartas selecionadas (pegar o lixo e encaixar no jogo).
    const pickupIntoMeld = g.phase === 'draw' && this.selected.size >= 2 && !!g.topDiscard && !g.isDiscardBlocked();
    const canClick = t === 0 && this.isMyTurn() && !this.staging && hasSel && (g.phase === 'play' || pickupIntoMeld);
    // Painel "Nós" clicável: com cartas selecionadas, um clique baixa uma sequência nova.
    const areaClickable = t === 0 && this.isMyTurn() && hasSel && (g.phase === 'play' || this.usingPickup());
    el.classList.toggle('clickable', areaClickable);
    el.title = areaClickable ? 'Clique aqui (ou solte as cartas) para baixar uma sequência nova' : '';
    el.onclick = () => {
      if (t === 1 && !this.selected.size) return;
      this.onTeamAreaClick(t);
    };
    this.dropTarget(el, (d) => d.kind === 'hand', (d) => {
      if (t === 1) return this.error('Esse é o painel dos adversários. Baixe as suas cartas no painel "Nós".');
      this.dropHandCards(d.ids, () => this.onMeld());
    });
    const status = team.opened
      ? '<span class="chip green">abriu</span>'
      : `<span class="chip">abertura: ${team.minOpen} pontos ou canastra</span>`;
    el.innerHTML =
      `<div class="panel-header"><span class="panel-title">${t === 0 ? 'Nós' : 'Eles'}</span>` +
      `<span class="panel-sub">${t === 0 ? `você e ${g.players[2].name}` : `${g.players[1].name} e ${g.players[3].name}`}</span>${status}</div>`;

    const row = document.createElement('div');
    row.className = 'melds';
    if (red.length) {
      const box = document.createElement('div');
      box.className = 'meld';
      const r3 = document.createElement('div');
      r3.className = 'red-threes';
      red.forEach((c) => r3.appendChild(this.cardEl(c, { small: true })));
      box.appendChild(r3);
      box.insertAdjacentHTML('beforeend', `<div class="meld-info">3 vermelhos · ${red.length}</div>`);
      row.appendChild(box);
    }
    melds.forEach((m, i) => {
      const box = document.createElement('div');
      box.className = 'meld';
      const cards = document.createElement('div');
      cards.className = 'cards-row';
      m.cards.forEach((c) => cards.appendChild(this.cardEl(c, { small: true })));
      box.appendChild(cards);
      const dirty = Rules.isDirty(m.cards);
      let info = `${m.cards.length} cartas · ${dirty ? 'suja' : 'limpa'}`;
      if (Rules.isCanastra(m.cards)) {
        box.classList.add('canastra');
        info = `<span class="chip yellow tiny">canastra ${dirty ? 'suja · 300' : 'limpa · 500'}</span> ${m.cards.length} cartas`;
      }
      box.insertAdjacentHTML('beforeend', `<div class="meld-info">${info}</div>`);
      if (canClick) {
        box.classList.add('clickable');
        box.title = 'Clique (ou solte as cartas aqui) para acrescentar a este jogo';
      }
      box.onclick = (e) => {
        e.stopPropagation(); // não conta como clique no painel
        if (t === 1 && !this.selected.size) return;
        this.onMeldClick(t, i);
      };
      if (t === 0) {
        // Aceita cartas da mão (acrescentar) e o lixo (pegar e encaixar com as cartas selecionadas).
        this.dropTarget(box, (d) => d.kind === 'hand' || d.kind === 'discard', (d) =>
          d.kind === 'discard' ? this.onPickup(i) : this.dropHandCards(d.ids, () => this.onMeldClick(0, i)));
      }
      row.appendChild(box);
    });
    if (!melds.length && !red.length) {
      row.innerHTML = '<span class="empty-note">Nenhum jogo baixado ainda.</span>';
    }
    el.appendChild(row);
  },

  renderPiles() {
    const g = this.game;
    const el = $('piles');
    el.innerHTML = '';
    const myDraw = this.isMyTurn() && g.phase === 'draw' && !this.usingPickup();
    const stockCount = this.view ? this.view.stock : g.stock.length;

    const alreadyDrew = g.phase !== 'draw' ? 'Você já comprou nesta vez. Agora baixe sequências ou descarte.' : null;

    // Monte (em cima): clique ou arraste para a mão para comprar.
    const stock = document.createElement('div');
    stock.className = 'pile' + (myDraw && stockCount ? ' clickable' : '');
    stock.onclick = () => this.onStock();
    const stockTop = this.cardEl(null, { back: true });
    stockTop.title = 'Clique (ou arraste para a sua mão) para comprar uma carta do monte';
    stockTop.draggable = true;
    stockTop.ondragstart = (e) => this.startDrag(e, { kind: 'stock' }, alreadyDrew);
    stockTop.ondragend = () => this.endDrag();
    stock.appendChild(this.pileStack('stock-card', stockCount, stockTop, () => this.cardEl(null, { back: true })));
    stock.insertAdjacentHTML('beforeend', `<div class="pile-meta">Monte <b>${stockCount}</b></div>`);

    // Lixo (embaixo). Clique: pega o lixo (na hora de comprar) ou descarta (depois).
    // A borda só aparece quando o clique faz alguma coisa.
    const pile = document.createElement('div');
    const top = this.view ? null : g.topDiscard;
    const pileCount = this.view ? 0 : g.discardPile.length;
    const blocked = !!top && g.isDiscardBlocked();
    const canDiscardNow = this.isMyTurn() && g.phase === 'play' && !this.staging && this.selected.size === 1;
    pile.className = 'pile' + ((myDraw && top && !blocked) || canDiscardNow ? ' clickable' : '');
    pile.onclick = () => this.onDiscardPileClick();
    pile.title = g.phase === 'play'
      ? 'Selecione 1 carta e clique aqui (ou arraste a carta) para descartar'
      : 'Selecione 2+ cartas que formem sequência com o topo e clique aqui para pegar o lixo';
    this.dropTarget(pile, (d) => d.kind === 'hand', (d) =>
      this.dropHandCards(d.ids, () => (g.phase === 'draw' ? this.onPickup() : this.onDiscard())));
    let topEl = null;
    if (top) {
      topEl = this.cardEl(top);
      topEl.classList.remove('fresh');
      topEl.draggable = true;
      topEl.ondragstart = (e) =>
        this.startDrag(e, { kind: 'discard' }, alreadyDrew || (blocked ? g.blockedReason() : null));
      topEl.ondragend = () => this.endDrag();
    }
    pile.appendChild(this.pileStack('discard-slot', pileCount, topEl, () => {
      const blank = document.createElement('div');
      blank.className = 'card';
      return blank;
    }));
    pile.insertAdjacentHTML('beforeend',
      `<div class="pile-meta">Lixo <b>${pileCount}</b></div>` +
      `<span class="chip red tiny" style="visibility:${blocked ? 'visible' : 'hidden'}">travado</span>`);

    el.append(stock, pile);
    const narr = $('narration');
    narr.innerHTML = '';
    narr.appendChild(this.narrationEl());
  },

  // Desenha uma pilha: cartas de baixo deslocadas (dão volume) e a de cima por último.
  // Ao passar o mouse numa pilha clicável, só a carta de cima levanta.
  pileStack(id, count, topEl, makeUnder) {
    const slot = document.createElement('div');
    slot.id = id;
    if (!count || !topEl) {
      slot.className = 'empty-slot';
      return slot;
    }
    slot.className = 'pile-stack';
    const layers = Math.min(Math.ceil((count - 1) / 3), 4);
    slot.style.width = `calc(var(--card-w) + ${layers * 2}px)`;
    slot.style.height = `calc(var(--card-h) + ${layers * 2}px)`;
    for (let i = layers; i >= 1; i--) {
      const under = makeUnder();
      under.classList.add('under');
      under.style.left = i * 2 + 'px';
      under.style.top = i * 2 + 'px';
      slot.appendChild(under);
    }
    topEl.classList.add('top');
    slot.appendChild(topEl);
    return slot;
  },

  // Mostra/oculta o histórico (a escolha fica guardada no navegador).
  setLogCollapsed(collapsed) {
    this.logCollapsed = collapsed;
    $('log-panel').classList.toggle('collapsed', collapsed);
    const b = $('btn-log-toggle');
    b.textContent = collapsed ? '▼' : '▲';
    b.title = collapsed ? 'Mostrar histórico' : 'Ocultar histórico';
    try { localStorage.setItem('canastra-log-collapsed', collapsed ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
  },

  // Quadro central: de quem é a vez e o que acabou de acontecer.
  narrationEl() {
    const g = this.game;
    const box = document.createElement('div');
    box.className = 'panel narration';
    // "label" pequeno em cinza e "who" grande, como um placar.
    let label;
    let who;
    let mine = false;
    if (this.view) {
      label = `Rodada ${g.round}`;
      who = 'Distribuindo';
    } else if (this.narration && this.narration.actor != null) {
      label = 'Jogada de';
      who = this.avatarHtml(this.narration.actor, 'narr') + g.players[this.narration.actor].name;
    } else if (g.phase === 'roundEnd') {
      label = `Rodada ${g.round}`;
      who = g.matchOver ? 'Fim da partida' : 'Fim da rodada';
    } else if (g.current === 0) {
      label = 'Agora';
      who = 'Sua vez';
      mine = true;
    } else {
      label = 'Vez de';
      who = this.avatarHtml(g.current, 'narr') + g.players[g.current].name;
    }
    box.innerHTML = `<div class="label">${label}</div><div class="who ${mine ? 'mine' : ''}">${who}</div>`;
    if (this.narration && this.narration.text) {
      const t = document.createElement('div');
      t.className = 'what';
      t.innerHTML = cardTagsHtml(this.narration.text);
      box.appendChild(t);
    }
    // Modo depuração: os motivos de cada decisão do bot.
    if (this.debug && this.narration && this.narration.why && this.narration.why.length) {
      box.appendChild(this.whyEl(this.narration.why, true));
    }
    if (this.narration && this.narration.waiting) {
      const b = document.createElement('button');
      b.className = 'btn-primary';
      b.innerHTML = 'Continuar<kbd>Enter</kbd>';
      b.onclick = () => this.confirmResolve && this.confirmResolve();
      box.appendChild(b);
      box.classList.add('waiting');
    }
    return box;
  },

  renderStaging() {
    const el = $('staging');
    el.innerHTML = '';
    el.classList.toggle('visible', !!this.staging);
    if (!this.staging) return;
    const g = this.game;
    const top = g.topDiscard;
    // Dá para mexer na abertura depois de comprar, ou na hora de pegar o lixo.
    const canEdit = this.isMyTurn() && (g.phase === 'play' || this.staging.pickup);
    const hasSel = this.selected.size > 0;
    el.insertAdjacentHTML('beforeend',
      `<span class="stage-title">Abertura: ${this.stagingPoints()} / ${this.myTeam.minOpen} pontos<br>` +
      '<small>ou uma canastra (7 cartas)</small></span>');
    // Clicar (ou soltar cartas) no quadro amarelo, fora de um jogo, separa uma sequência nova.
    el.classList.toggle('clickable', canEdit && this.selected.size >= 3);
    el.title = canEdit ? 'Clique aqui (ou solte as cartas) para separar uma sequência nova' : '';
    el.onclick = () => {
      if (this.selected.size) this.onMeld();
    };
    this.dropTarget(el, (d) => d.kind === 'hand', (d) => this.dropHandCards(d.ids, () => this.onMeld()));

    this.staging.melds.forEach((ids, i) => {
      const box = document.createElement('div');
      box.className = 'meld' + (canEdit && hasSel ? ' clickable' : '');
      const row = document.createElement('div');
      row.className = 'cards-row';
      const cards = ids.map((id) => this.cardById(id));
      const a = Rules.analyzeMeld(cards);
      (a.ok ? a.ordered : cards).forEach((c) => {
        const cel = this.cardEl(c, { small: true });
        if (c === top) cel.removeAttribute('data-id'); // o topo continua no lixo
        // Sem cartas selecionadas, clicar numa carta devolve só ela para a mão.
        if (this.isMyTurn() && !hasSel) {
          cel.classList.add('removable');
          cel.title = c === top && ids.includes('TOP')
            ? `${cardName(c)} é a carta do lixo: para devolvê-la, clique em "Desfazer"`
            : `Clique para devolver ${cardName(c)} para a mão`;
          cel.onclick = (e) => {
            e.stopPropagation();
            this.onUnstageCard(i, c);
          };
        }
        row.appendChild(cel);
      });
      box.appendChild(row);
      const hasTop = ids.includes('TOP');
      const info = document.createElement('div');
      info.className = 'meld-info';
      info.innerHTML = `<span>${Rules.pointsOf(cards)} pontos${hasTop ? ' · com o lixo' : ''}</span>`;
      const undo = document.createElement('button');
      undo.className = 'meld-undo';
      undo.textContent = 'Desfazer';
      undo.title = hasTop
        ? `Desfaz este jogo: ${cardName(top)} continua no lixo e as outras cartas voltam para a mão`
        : 'Desfaz este jogo: as cartas voltam para a mão';
      undo.onclick = (e) => {
        e.stopPropagation();
        this.onUnstage(i);
      };
      info.appendChild(undo);
      box.appendChild(info);
      if (canEdit && hasSel) box.title = 'Clique (ou solte as cartas aqui) para acrescentar a este jogo';
      box.onclick = (e) => {
        e.stopPropagation(); // não conta como clique no quadro amarelo
        this.onStagedMeldClick(i);
      };
      this.dropTarget(box, (d) => d.kind === 'hand', (d) => this.dropHandCards(d.ids, () => this.onStagedMeldClick(i)));
      el.appendChild(box);
    });
  },

  renderHand() {
    const g = this.game;
    const el = $('hand');
    el.innerHTML = '';
    el.classList.toggle('locked', !this.isMyTurn());
    if (!this.isMyTurn()) this.selected.clear();
    const staged = this.stagedIds();
    const newIds = !this.view && g.current === 0 && g.turn ? g.turn.newIds : new Set();
    const hand = this.handOf(0);
    for (const c of sortHand(hand.filter((c) => !staged.has(c.id)))) {
      const cel = this.cardEl(c);
      if (this.selected.has(c.id)) cel.classList.add('selected');
      if (newIds.has(c.id)) cel.classList.add('new');
      cel.onclick = () => {
        if (!this.canAct()) return; // só dá para selecionar cartas na sua vez
        if (this.selected.has(c.id)) this.selected.delete(c.id);
        else this.selected.add(c.id);
        this.render();
      };
      // Arrastar: leva todas as cartas selecionadas (se esta estiver entre elas) ou só esta.
      cel.draggable = true;
      cel.ondragstart = (e) => {
        const ids = this.selected.has(c.id) ? [...this.selected] : [c.id];
        this.startDrag(e, { kind: 'hand', ids }, null);
      };
      cel.ondragend = () => this.endDrag();
      el.appendChild(cel);
    }
    // A mão recebe cartas arrastadas do monte (comprar) ou do lixo (pegar o lixo).
    this.dropTarget(el, (d) => d.kind === 'stock' || d.kind === 'discard', (d) =>
      d.kind === 'stock' ? this.onStock() : this.onPickup());
    for (const id of [...this.selected]) {
      if (!hand.some((c) => c.id === id) || staged.has(id)) this.selected.delete(id);
    }
  },

  renderActions() {
    const g = this.game;
    const el = $('actions');
    el.innerHTML = '';
    const add = (label, fn, opts = {}) => {
      const b = document.createElement('button');
      if (opts.icon) b.innerHTML = opts.icon + `<span>${label}</span>`;
      else b.textContent = label;
      b.onclick = fn;
      if (opts.cls) b.className = opts.cls;
      if (opts.disabled) b.disabled = true;
      if (opts.title) b.title = opts.title;
      el.appendChild(b);
    };
    const hint = (text) => el.insertAdjacentHTML('beforeend', `<span class="hint">${text}</span>`);

    if (!this.isMyTurn()) {
      if (g.phase === 'roundEnd' && !this.busy) add('Ver pontuação da rodada', () => this.showRoundEnd());
      else hint('Acompanhe as jogadas no quadro acima. Você poderá selecionar cartas quando for a sua vez.');
      return;
    }
    const n = this.selected.size;
    if (this.staging && (g.phase === 'play' || this.staging.pickup)) {
      add('Baixar sequência', () => this.onMeld(), { disabled: n < 3 });
      add('Cancelar abertura', () => this.onCancelStaging(), { cls: 'btn-danger' });
      if (g.phase === 'play' && g.turn.canSecondDraw) {
        add('Trocar carta', () => this.onSecondDraw(), { cls: 'btn-light', title: 'A 1ª carta comprada vai para o lixo e você compra outra' });
      }
      hint('Separe sequências até somar o mínimo para abrir. Para acrescentar cartas, selecione-as e clique ' +
        'num jogo da área amarela. Clique numa carta da área amarela para devolvê-la à mão; "Desfazer" devolve o jogo inteiro.');
    } else if (g.phase === 'draw') {
      add('Comprar do monte', () => this.onStock(), { disabled: !g.stock.length, cls: 'btn-primary' });
      add('Pegar lixo', () => this.onPickup(), {
        disabled: !g.topDiscard || g.isDiscardBlocked(),
        title: 'Selecione 2+ cartas da mão que formem sequência com a carta do topo',
      });
      if (!g.stock.length) add('Encerrar rodada', () => this.onEndRound(), { cls: 'btn-danger' });
      if (this.staging) add('Cancelar abertura', () => this.onCancelStaging(), { cls: 'btn-danger' });
      hint('Compre clicando no monte ou arrastando-o para a sua mão. ' +
        'Para pegar o lixo, selecione 2+ cartas que formem sequência com o topo e clique no lixo.');
    } else {
      add('Baixar sequência', () => this.onMeld(), { disabled: n < 3 });
      add('Descartar', () => this.onDiscard(), { disabled: n !== 1, cls: n === 1 ? 'btn-primary' : '' });
      if (g.turn.canSecondDraw) add('Trocar carta', () => this.onSecondDraw(), { cls: 'btn-light', title: 'A 1ª carta comprada vai para o lixo e você compra outra' });
      hint('Selecione cartas e clique (ou arraste) no painel "Nós" para baixar, ' +
        'num jogo para acrescentar, ou no lixo para descartar.');
    }
    if (n) {
      add(`Limpar seleção · ${n}`, () => { this.selected.clear(); this.render(); },
        { cls: 'btn-light full', icon: ICON_CLEAR_CARDS });
    }
    // As dicas vão por último, embaixo dos botões.
    el.querySelectorAll('.hint').forEach((h) => el.appendChild(h));
  },

  renderStatus() {
    const g = this.game;
    let text;
    if (this.view) text = 'Distribuindo as cartas…';
    else if (g.phase === 'roundEnd') text = g.matchOver ? 'Fim da partida' : 'Fim da rodada';
    else if (g.current === 0) text = g.phase === 'draw' ? 'Sua vez: compre uma carta' : 'Sua vez: baixe (opcional) e descarte';
    else text = `Vez de ${g.players[g.current].name}…`;
    $('status').textContent = text;
    document.querySelector('.player-zone').classList.toggle('active', this.isActive(0));
    const m = $('message');
    m.textContent = this.msg.text;
    m.className = 'message ' + this.msg.type;
  },

  renderLog() {
    const g = this.game;
    const el = $('log');
    el.innerHTML = '';
    // Só mostra o que já foi animado/narrado, para não adiantar as jogadas.
    for (const entry of g.log.slice(0, this.logCursor).slice(-60).reverse()) {
      if (entry.why && !this.debug) continue; // explicações só no modo depuração
      const li = document.createElement('li');
      li.className = entry.seat === null ? 'system' : 'team-' + (entry.seat % 2);
      if (entry.why) {
        li.classList.add('debug');
        li.appendChild(this.whyEl(entry.why, false, entry.text));
      } else {
        li.innerHTML = cardTagsHtml(entry.text);
      }
      el.appendChild(li);
    }
  },

  // Caixa "Por quê?" com os motivos das decisões de um bot (modo depuração).
  whyEl(why, open, title = 'Por quê?') {
    const d = document.createElement('details');
    d.className = 'why';
    d.open = open;
    d.innerHTML = `<summary>${title}</summary><ul>${why.map((w) => `<li>${cardTagsHtml(w)}</li>`).join('')}</ul>`;
    return d;
  },

  // ---------- Janelas ----------

  showModal(html, closable = false) {
    $('modal-box').innerHTML = html;
    $('modal').classList.remove('hidden');
    this.modalClosable = closable;
  },
  hideModal() {
    $('modal').classList.add('hidden');
  },

  // ---------- Configurações (engrenagem) ----------

  /*
   * As configurações ficam num cookie do navegador (vale por cerca de 1 ano).
   * Abrindo o index.html direto do computador, alguns navegadores não aceitam cookie;
   * nesse caso elas ficam no armazenamento local do navegador.
   */
  cookiePath() {
    return location.pathname.replace(/[^/]*$/, '') || '/';
  },
  readStoredSettings() {
    try {
      const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${SETTINGS_COOKIE}=([^;]*)`));
      if (m) return JSON.parse(decodeURIComponent(m[1]));
      return JSON.parse(localStorage.getItem(SETTINGS_COOKIE) || 'null');
    } catch (e) {
      return null;
    }
  },
  writeStoredSettings(data) {
    const value = encodeURIComponent(JSON.stringify(data));
    document.cookie = `${SETTINGS_COOKIE}=${value}; max-age=${60 * 60 * 24 * 365}; path=${this.cookiePath()}; SameSite=Lax`;
    const cookieOk = document.cookie.includes(`${SETTINGS_COOKIE}=`);
    try {
      if (cookieOk) localStorage.removeItem(SETTINGS_COOKIE);
      else localStorage.setItem(SETTINGS_COOKIE, JSON.stringify(data));
    } catch (e) { /* sem armazenamento */ }
  },
  clearStoredSettings() {
    document.cookie = `${SETTINGS_COOKIE}=; max-age=0; path=${this.cookiePath()}; SameSite=Lax`;
    try { localStorage.removeItem(SETTINGS_COOKIE); } catch (e) { /* sem armazenamento */ }
  },

  // Lê o ritmo, a inteligência dos bots e o tamanho das cartas guardados no navegador.
  loadSettings() {
    const d = DEFAULT_SETTINGS();
    const s = this.readStoredSettings() || {};
    this.pace = PACE[s.pace] ? s.pace : d.pace;
    for (const seat of [1, 2, 3]) {
      this.levels[seat] = s.levels && AI.LEVELS[s.levels[seat]] ? s.levels[seat] : d.levels[seat];
    }
    for (const [area] of CARD_AREAS) {
      const ok = s.cardSizes && CARD_SIZES.some(([k]) => k === s.cardSizes[area]);
      this.cardSizes[area] = ok ? s.cardSizes[area] : d.cardSizes[area];
    }
    this.debug = typeof s.debug === 'boolean' ? s.debug : d.debug;
    this.showBotCards = typeof s.showBotCards === 'boolean' ? s.showBotCards : d.showBotCards;
    this.applyCardSizes();
  },
  saveSettings() {
    this.writeStoredSettings({
      pace: this.pace, levels: this.levels, cardSizes: this.cardSizes,
      debug: this.debug, showBotCards: this.showBotCards,
    });
  },
  // Volta tudo ao padrão e apaga o que estava guardado.
  resetSettings() {
    this.clearStoredSettings();
    this.loadSettings();
    this.render();
  },
  // Aplica o tamanho escolhido para as cartas de cada área (variáveis do CSS).
  applyCardSizes() {
    for (const [area, , , cssVar, baseWidth, def] of CARD_AREAS) {
      const size = CARD_SIZES.find(([k]) => k === this.cardSizes[area]) || CARD_SIZES.find(([k]) => k === def);
      document.documentElement.style.setProperty(cssVar, (size[2] / baseWidth).toFixed(4));
    }
  },

  showSettings() {
    const paces = [
      ['step', 'Passo a passo', 'cada bot faz a jogada completa e espera você clicar em Continuar'],
      ['slow', 'Automático lento', 'sem confirmações, com pausas longas'],
      ['normal', 'Automático normal', 'sem confirmações'],
      ['fast', 'Automático rápido', 'sem confirmações, animações curtas'],
    ];
    const levelHelp = {
      iniciante: 'Joga com bom senso, mas comete alguns erros: às vezes não pega o lixo, demora para baixar ou descarta uma carta útil.',
      moderado: 'Abre gastando o mínimo de curingas, prefere aumentar os jogos da mesa a baixar várias sequências pequenas, guarda o coringão para fechar canastra, só usa o coringuinha para fechar canastra se a dupla já tem uma limpa, conta as cartas já usadas na mesa para não pôr curinga em jogo com pouca chance de canastra, não baixa uma sequência que vai disputar cartas com outra do mesmo naipe já na mesa (guarda para aumentar a que existe), não fica com menos de 3 cartas sem canastra limpa, descarta cartas baixas e só solta o Ás em último caso.',
      estrategico: 'Antes de comprar e de descartar, imagina várias continuações da rodada para cada opção e escolhe a que rende mais pontos. Do lixo, só conhece a carta de cima.',
      mestre: 'Como o Estratégico, mas decora o lixo inteiro e as cartas que cada jogador pegou dele. Por isso imagina melhor as mãos dos outros.',
    };
    const options = (list, current) => list
      .map(([value, label]) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`).join('');
    const levelList = Object.entries(AI.LEVELS).map(([k, v]) => [k, v.label]);
    // Bots na ordem em que jogam (lugares 1, 2 e 3).
    const bots = [1, 2, 3].map((seat) => `
      <div class="set-row">
        ${this.avatarHtml(seat, 'small')}<div class="set-who"><b>${this.game.players[seat].name}</b><span>${this.roleOf(seat)}</span></div>
        <select data-seat="${seat}">${options(levelList, this.levels[seat])}</select>
      </div>`).join('');
    this.showModal(`
      <h2>Configurações</h2>
      <h3>Ritmo do jogo</h3>
      <div class="set-row">
        <div class="set-who"><span id="set-pace-help">${paces.find((p) => p[0] === this.pace)[2]}</span></div>
        <select id="set-pace">${options(paces, this.pace)}</select>
      </div>
      <h3>Inteligência dos bots</h3>
      ${bots}
      <p class="set-note">A mudança vale a partir da próxima jogada de cada bot.</p>
      <details class="hands-box set-help">
        <summary>O que cada nível faz</summary>
        <ul>${Object.entries(AI.LEVELS).map(([k, v]) => `<li><b>${v.label}:</b> ${levelHelp[k]}</li>`).join('')}</ul>
      </details>
      <h3>Tamanho das cartas</h3>
      ${CARD_AREAS.map(([area, label, help, , , def]) => `
      <div class="set-row">
        <div class="set-who"><b>${label}</b><span>${help}</span></div>
        <select data-area="${area}">${options(
          CARD_SIZES.map(([k, name]) => [k, k === def ? `${name} (padrão)` : name]), this.cardSizes[area])}</select>
      </div>`).join('')}
      <p class="set-note">Cada tamanho é igual em todas as áreas.</p>
      <h3>Depuração</h3>
      <label class="set-row set-check">
        <div class="set-who"><b>Explicar as decisões dos bots</b><span>cada jogada de bot ganha um "Por quê?" no quadro da jogada e no histórico</span></div>
        <input type="checkbox" id="set-debug"${this.debug ? ' checked' : ''}>
      </label>
      <label class="set-row set-check">
        <div class="set-who"><b>Mostrar as cartas dos bots</b><span>as mãos dos bots aparecem viradas para cima (só para estudar as jogadas)</span></div>
        <input type="checkbox" id="set-botcards"${this.showBotCards ? ' checked' : ''}>
      </label>
      <p class="set-note">As configurações ficam guardadas num cookie deste navegador.</p>
      <div class="modal-actions">
        <button class="btn-light" id="btn-settings-reset" title="Volta o ritmo, a inteligência dos bots e o tamanho das cartas ao padrão">Restaurar padrão</button>
        <button class="btn-primary" id="btn-settings-close">Pronto</button>
      </div>`, true);

    $('set-pace').onchange = (e) => {
      this.pace = e.target.value;
      $('set-pace-help').textContent = paces.find((p) => p[0] === this.pace)[2];
      if (this.pace !== 'step' && this.confirmResolve) this.confirmResolve();
      this.saveSettings();
    };
    $('modal-box').querySelectorAll('select[data-seat]').forEach((sel) => {
      sel.onchange = () => {
        this.levels[sel.dataset.seat] = sel.value;
        this.saveSettings();
        this.render(); // o nível aparece no quadro de cada jogador
      };
    });
    $('modal-box').querySelectorAll('select[data-area]').forEach((sel) => {
      sel.onchange = () => {
        this.cardSizes[sel.dataset.area] = sel.value;
        this.applyCardSizes(); // muda na hora, dá para ver atrás da janela
        this.saveSettings();
      };
    });
    $('set-debug').onchange = (e) => {
      this.debug = e.target.checked;
      this.saveSettings();
      this.render();
    };
    $('set-botcards').onchange = (e) => {
      this.showBotCards = e.target.checked;
      this.saveSettings();
      this.render();
    };
    $('btn-settings-reset').onclick = () => {
      this.resetSettings();
      this.showSettings(); // redesenha a janela com os valores padrão
      this.toast('Configurações restauradas para o padrão.');
    };
    $('btn-settings-close').onclick = () => this.hideModal();
  },

  /*
   * Se as cartas selecionadas podem ser montadas de mais de um jeito (por exemplo,
   * o coringão numa sequência e o coringuinha na outra, ou o contrário),
   * mostra as opções desenhadas e deixa o jogador escolher. Com uma opção só, segue direto.
   * "top" = carta do topo do lixo (quando está pegando o lixo), para marcá-la.
   */
  chooseArrangement(options, onPick, top = null) {
    if (options.length === 1) return onPick(options[0]);
    this.showModal(`
      <h2>Como você quer montar?</h2>
      <p>Essas cartas formam sequências de ${options.length} jeitos diferentes: muda onde fica cada curinga (contorno amarelo) ou cada carta, como um Ás na ponta da sequência do naipe ou numa sequência de Ases. Escolha uma opção.</p>
      <div class="arrangements" id="arrangements"></div>
      <div class="modal-actions"><button class="btn-light" id="btn-arr-cancel">Cancelar</button></div>`, true);
    const list = $('arrangements');
    options.forEach((melds, i) => {
      const opt = document.createElement('div');
      opt.className = 'arrangement';
      opt.tabIndex = 0;
      opt.setAttribute('role', 'button');
      opt.innerHTML = `<span class="arr-label">Opção ${i + 1}</span>`;
      const row = document.createElement('div');
      row.className = 'arr-melds';
      melds.forEach((m) => {
        const box = document.createElement('div');
        box.className = 'meld';
        const cardsRow = document.createElement('div');
        cardsRow.className = 'cards-row';
        m.forEach((c) => {
          const el = this.cardEl(c, { small: true });
          el.removeAttribute('data-id'); // não confunde as animações da mesa
          el.classList.remove('fresh');
          if (isWild(c)) el.classList.add('pick-wild');
          cardsRow.appendChild(el);
        });
        box.appendChild(cardsRow);
        const dirty = Rules.isDirty(m);
        box.insertAdjacentHTML('beforeend',
          `<div class="meld-info"><span class="${dirty ? '' : 'clean'}">${dirty ? 'suja' : 'limpa'}</span>` +
          `${top && m.includes(top) ? '<span>· com o lixo</span>' : ''}</div>`);
        row.appendChild(box);
      });
      opt.appendChild(row);
      const pick = () => {
        this.hideModal();
        onPick(melds);
      };
      opt.onclick = pick;
      opt.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      };
      list.appendChild(opt);
    });
    $('btn-arr-cancel').onclick = () => this.hideModal();
  },

  showRoundEnd() {
    const g = this.game;
    const lr = g.lastRound;
    if (!lr) return;
    this.logCursor = g.log.length;
    this.eventCursor = g.events.length;
    this.say(g.matchOver ? 'A partida terminou.' : 'Rodada encerrada. Veja a pontuação.');
    this.render();
    const [us, them] = lr.results;
    const row = (label, a, b) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
    const sign = (n) => (n > 0 ? '+' : '') + fmt(n);
    let title = lr.batedor !== null ? `${g.players[lr.batedor].name} bateu!` : 'O monte acabou.';
    let result = '';
    if (g.matchOver) {
      title = 'Fim da partida!';
      result =
        g.winner === 0 ? '<p><strong>Vocês venceram! 🎉</strong></p>'
        : g.winner === 1 ? '<p><strong>Eles venceram desta vez.</strong></p>'
        : '<p><strong>Empate!</strong></p>';
    }
    // Cartas que ficaram na mão: fichas brancas na cor de cada carta (como no histórico).
    const hands = g.players
      .map((p) => `<li><b>${p.name}</b><span>${p.hand.length
        ? cardTagsHtml(sortHand(p.hand).map(cardName).join(' '))
        : '<span class="none">sem cartas</span>'}</span></li>`)
      .join('');
    const handsCount = g.players.reduce((s, p) => s + p.hand.length, 0);
    // Placar acumulado em destaque, com quanto cada dupla fez nesta rodada.
    const hero = (label, r, cls) =>
      `<div class="hero-score ${cls}"><span class="label">${label}</span>` +
      `<span class="value">${fmt(r.newScore)}</span><span class="delta">${sign(r.total)} nesta rodada</span></div>`;
    const html = `
      <h2>${title}</h2>${result}
      <p>Rodada ${lr.round}${lr.batedor !== null ? '' : ', encerrada porque o monte acabou'}.</p>
      <div class="hero">${hero('Nós', us, 'us')}${hero('Eles', them, '')}</div>
      <table>
        <tr><th></th><th>Nós</th><th>Eles</th></tr>
        ${row('Cartas baixadas', sign(us.meldCards), sign(them.meldCards))}
        ${row('Canastras limpas (500 cada)', `${us.clean} → ${sign(us.clean * 500)}`, `${them.clean} → ${sign(them.clean * 500)}`)}
        ${row('Canastras sujas (300 cada)', `${us.dirty} → ${sign(us.dirty * 300)}`, `${them.dirty} → ${sign(them.dirty * 300)}`)}
        ${row('Bate', sign(us.bate), sign(them.bate))}
        ${row('3 vermelhos', `${us.redCount} → ${sign(us.redThrees)}`, `${them.redCount} → ${sign(them.redThrees)}`)}
        ${row('Cartas na mão (desconto)', sign(-us.hand), sign(-them.hand))}
        <tr class="total"><td>Total da rodada</td><td>${sign(us.total)}</td><td>${sign(them.total)}</td></tr>
      </table>
      <details class="hands-box">
        <summary title="Clique para ver ou esconder as cartas">Cartas que ficaram na mão <span class="count">${handsCount}</span></summary>
        <ul class="hands">${hands}</ul>
      </details>
      <div class="modal-actions">
        <button class="btn-light" id="btn-modal-close">Ver a mesa</button>
        <button class="btn-primary" id="btn-modal-next">${g.matchOver ? 'Nova partida' : 'Próxima rodada'}</button>
      </div>`;
    this.showModal(html, true);
    $('btn-modal-close').onclick = () => this.hideModal();
    $('btn-modal-next').onclick = () => {
      if (g.matchOver) return this.newMatch();
      this.hideModal();
      this.selected.clear();
      this.staging = null;
      g.nextRound();
      this.say(`Rodada ${g.round} começou. Carteador: ${g.players[g.dealer].name}.`);
      this.playRoundStart();
    };
  },

  showRules() {
    this.showModal(`
      <h2>Regras resumidas</h2>
      <h3>Objetivo</h3>
      <ul><li>Duplas: você + ${this.game.players[2].name} contra ${this.game.players[1].name} + ${this.game.players[3].name}. Vence quem chegar a 5.000 pontos.</li></ul>
      <h3>Como jogar a sua vez</h3>
      <ul>
        <li><b>1. Comprar:</b> clique no monte (ou arraste-o para a sua mão), <i>ou</i> pegue o lixo: selecione 2+ cartas da mão que formem sequência com a carta do topo e clique no lixo. Elas viram um jogo novo ou, se couberem, são encaixadas num jogo da dupla (para escolher o jogo, clique nele).</li>
        <li><b>2. Baixar (opcional):</b> selecione 3+ cartas e clique no painel "Nós". Para acrescentar a um jogo da dupla, selecione as cartas e clique no jogo. Também dá para arrastar as cartas até lá.</li>
        <li><b>3. Descartar:</b> selecione 1 carta e clique no lixo (ou arraste a carta até ele).</li>
        <li>Para baixar várias sequências de uma vez (inclusive ao pegar o lixo), selecione todas as cartas juntas: o jogo separa por naipe e coloca cada curinga onde ele faz falta.</li>
        <li>Só dá para mexer nas cartas na sua vez. Fora dela, aparece um aviso explicando o motivo.</li>
      </ul>
      <h3>Acompanhando os outros jogadores</h3>
      <ul>
        <li>No ritmo <b>Passo a passo</b>, cada jogada do computador aparece no quadro à esquerda, abaixo do histórico, e espera você clicar em "Continuar" (ou apertar Enter).</li>
        <li>As cartas da última jogada ficam com brilho amarelo. O histórico, à esquerda, guarda tudo o que aconteceu.</li>
        <li>Cartas com pontinho laranja são curingas (2 e coringão). O "D" marca o carteador.</li>
      </ul>
      <h3>Sequências</h3>
      <ul>
        <li>3+ cartas seguidas do mesmo naipe, na ordem 4, 5, 6, 7, 8, 9, 10, J, Q, K, A. Ou 3+ Ases de qualquer naipe.</li>
        <li>No máximo 1 curinga por sequência (coringão, com o chapéu de bobo, ou 2).</li>
        <li>Com coringuinha (2) a sequência é "suja". Com coringão ela continua "limpa".</li>
        <li>O 3 preto nunca entra em sequência.</li>
        <li>Descartar um 3 preto, um coringuinha (2) ou um coringão trava o lixo para o próximo jogador.</li>
        <li>3 vermelhos são baixados automaticamente e repostos com o monte.</li>
      </ul>
      <h3>Abertura e canastras</h3>
      <ul>
        <li>A primeira descida da dupla precisa de 80 pontos (120 se a dupla estiver VU, acima de 2.500), ou de uma canastra limpa ou suja (7 cartas), que já vale mais que isso.</li>
        <li>Canastra = 7+ cartas. Limpa (sem 2) vale 500, suja (com 2) vale 300.</li>
        <li>Só pode bater (ficar sem cartas) se a dupla tiver uma canastra limpa. O bate vale +100.</li>
      </ul>
      <h3>Valores das cartas</h3>
      <ul><li>4 a 7 = 5 · 8 a K = 10 · A = 15 · 2 = 10 · Coringão = 20 · 3 preto = 5 · 3 vermelho = 100 (bônus).</li></ul>
      <div class="modal-actions"><button class="btn-primary" id="btn-rules-close">Fechar</button></div>`, true);
    $('btn-rules-close').onclick = () => this.hideModal();
  },
};

window.addEventListener('DOMContentLoaded', () => UI.init());
