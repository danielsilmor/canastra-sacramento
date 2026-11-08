/*
 * game.js: A partida
 *
 * Guarda o "estado" do jogo (mãos, monte, lixo, jogos baixados, placar)
 * e oferece as ações possíveis: comprar, pegar o lixo, baixar, descartar...
 * Toda ação confere as regras antes de mudar qualquer coisa. Se a jogada
 * não for permitida, nada muda e volta uma mensagem explicando o motivo.
 *
 * Lugares na mesa (sentido horário, como aparece na tela):
 *   0 = Você (embaixo)   1 = João (esquerda)   2 = Beatriz (em cima, sua parceira)   3 = Rafael (direita)
 * Duplas: "Nós" = Você + Beatriz, "Eles" = João + Rafael.
 */

const PLAYER_NAMES = ['Você', 'João', 'Beatriz', 'Rafael'];
const OK = { ok: true };
const fail = (error) => ({ ok: false, error });

class Game {
  constructor(options = {}) {
    const humanSeat = options.allBots ? -1 : 0;
    this.players = PLAYER_NAMES.map((name, seat) => ({
      seat, name, team: seat % 2, hand: [], isHuman: seat === humanSeat,
    }));
    this.teams = [
      { name: 'Nós', score: 0, melds: [], redThrees: [], opened: false },
      { name: 'Eles', score: 0, melds: [], redThrees: [], opened: false },
    ];
    this.stock = [];        // monte de compra
    this.discardPile = [];  // lixo
    this.log = [];
    this.events = [];       // lista do que aconteceu (usada pela tela para animar)
    this.history = [];
    this.phase = 'idle';    // 'draw' (precisa comprar) | 'play' (baixar/descartar) | 'roundEnd'
    this.round = 0;
    this.matchOver = false;
    this.winner = null;
    this.quiet = false;     // true nas partidas "imaginadas" pelos bots: sem registro nem animação
    // Cartas que a mesa inteira viu entrar na mão de cada jogador (ao pegar o lixo).
    // O bot Mestre usa isso para "decorar" o que cada um tem.
    this.publicIn = [new Set(), new Set(), new Set(), new Set()];
  }

  // ---------- Ajudantes ----------

  addLog(text, seat = null) {
    if (this.quiet) return;
    this.log.push({ text, seat });
    if (this.log.length > 300) this.log.shift();
  }

  // Registra um acontecimento (comprar, descartar, baixar...) para a tela animar.
  emit(type, data = {}) {
    if (this.quiet) return;
    this.events.push({ type, ...data });
  }

  /*
   * Cópia da partida para os bots "imaginarem" jogadas (Estratégico e Mestre).
   * As cartas são as mesmas (não mudam); as listas são novas, então mexer na cópia
   * não muda nada na mesa de verdade. A cópia é "quieta": não gera registro nem animação.
   */
  clone() {
    const g = Object.create(Game.prototype);
    g.players = this.players.map((p) => ({ ...p, hand: [...p.hand] }));
    g.teams = this.teams.map((t) => ({
      ...t, melds: t.melds.map((m) => ({ cards: [...m.cards] })), redThrees: [...t.redThrees],
    }));
    g.stock = [...this.stock];
    g.discardPile = [...this.discardPile];
    g.log = [];
    g.events = [];
    g.history = [];
    g.phase = this.phase;
    g.round = this.round;
    g.matchOver = this.matchOver;
    g.winner = this.winner;
    g.dealer = this.dealer;
    g.current = this.current;
    g.isFirstTurn = this.isFirstTurn;
    g.turn = { ...this.turn, newIds: new Set(this.turn ? this.turn.newIds : []) };
    g.lastRound = null;
    g.quiet = true;
    g.publicIn = this.publicIn.map((s) => new Set(s));
    return g;
  }

  teamOf(seat) {
    return this.teams[this.players[seat].team];
  }

  get topDiscard() {
    return this.discardPile[this.discardPile.length - 1] || null;
  }

  // O lixo fica bloqueado para o próximo jogador quando o descarte foi um 3 preto,
  // um coringuinha (2) ou um coringão.
  isDiscardBlocked() {
    const top = this.topDiscard;
    return !!top && isLockingCard(top);
  }

  blockedReason() {
    const top = this.topDiscard;
    return `O lixo está travado por ${isJoker(top) ? 'um coringão' : top.rank === 2 ? 'um coringuinha (2)' : 'um 3 preto'}. Compre do monte.`;
  }

  freshTurn() {
    return { seat: this.current, canSecondDraw: false, firstCardId: null, newIds: new Set() };
  }

  checkTurn(seat, phase) {
    if (this.phase === 'roundEnd' || this.phase === 'idle') return fail('A rodada não está em andamento.');
    if (this.current !== seat) return fail('Não é a sua vez.');
    if (phase === 'draw' && this.phase !== 'draw') return fail('Você já comprou nesta vez.');
    if (phase === 'play' && this.phase !== 'play') return fail('Primeiro compre uma carta: do monte ou pegando o lixo.');
    return null;
  }

  // Confere se nenhuma carta sumiu ou duplicou (usado nos testes).
  countCards() {
    let n = this.stock.length + this.discardPile.length;
    for (const p of this.players) n += p.hand.length;
    for (const t of this.teams) {
      n += t.redThrees.length;
      for (const m of t.melds) n += m.cards.length;
    }
    return n;
  }

  // ---------- Início da partida e da rodada ----------

  newMatch() {
    this.teams.forEach((t) => (t.score = 0));
    this.round = 0;
    this.matchOver = false;
    this.winner = null;
    this.history = [];
    this.log = [];
    this.dealer = Math.floor(Math.random() * 4);
    this.addLog(`Sorteio: ${this.players[this.dealer].name} é o carteador.`);
    this.startRound();
  }

  startRound() {
    this.round++;
    for (const t of this.teams) {
      t.melds = [];
      t.redThrees = [];
      t.opened = false;
      t.vu = Rules.isVU(t.score);
      t.minOpen = Rules.openingMinimum(t.score);
    }
    this.stock = shuffle(createDeck());
    this.discardPile = [];
    this.players.forEach((p) => (p.hand = []));
    this.publicIn = [new Set(), new Set(), new Set(), new Set()];
    this.lastRound = null;
    this.addLog(`Rodada ${this.round}. Carteador: ${this.players[this.dealer].name}.`);

    // Distribui 15 cartas, uma por vez, começando pelo jogador à direita do carteador.
    for (let i = 0; i < 15; i++) {
      for (let k = 1; k <= 4; k++) {
        this.players[(this.dealer + k) % 4].hand.push(this.stock.pop());
      }
    }
    this.emit('deal', { dealer: this.dealer, hands: this.players.map((p) => [...p.hand]) });
    // 3 vermelhos recebidos na distribuição: baixar e repor (ordem anti-horária).
    for (let k = 0; k < 4; k++) this.layRedThrees((this.dealer - k + 4) % 4);

    this.current = (this.dealer + 1) % 4;
    this.isFirstTurn = true;
    this.phase = 'draw';
    this.turn = this.freshTurn();
  }

  // Baixa todos os 3 vermelhos da mão do jogador e repõe com cartas do monte.
  layRedThrees(seat) {
    const p = this.players[seat];
    const team = this.teamOf(seat);
    const newIds = [];
    let idx;
    while ((idx = p.hand.findIndex(isRedThree)) >= 0) {
      const [c] = p.hand.splice(idx, 1);
      team.redThrees.push(c);
      const replace = this.stock.length > 0;
      this.addLog(`${p.name} baixou o ${cardName(c)}${replace ? ' e comprou outra carta' : ''}.`, seat);
      this.emit('redThree', { seat, card: c });
      if (replace) {
        const n = this.stock.pop();
        p.hand.push(n);
        this.emit('draw', { seat, card: n });
        newIds.push(n.id);
      }
    }
    return newIds.filter((id) => p.hand.some((c) => c.id === id));
  }

  // ---------- Compras ----------

  drawFromStock(seat) {
    const err = this.checkTurn(seat, 'draw');
    if (err) return err;
    if (!this.stock.length) return fail('O monte acabou. Pegue o lixo ou encerre a rodada.');
    const p = this.players[seat];
    const c = this.stock.pop();
    p.hand.push(c);
    this.addLog(p.isHuman ? `Você comprou ${cardName(c)} do monte.` : `${p.name} comprou do monte.`, seat);
    this.emit('draw', { seat, card: c });
    const extra = isRedThree(c) ? this.layRedThrees(seat) : [];
    this.turn.newIds = new Set([c.id, ...extra].filter((id) => p.hand.some((h) => h.id === id)));
    // Primeira compra da rodada: pode trocar por uma 2ª carta
    // (exceto se veio um 3 ou um curinga: coringuinha ou coringão).
    if (this.isFirstTurn && !isThree(c) && !isWild(c) && this.stock.length > 0) {
      this.turn.canSecondDraw = true;
      this.turn.firstCardId = c.id;
    }
    this.phase = 'play';
    return OK;
  }

  // A 1ª carta recusada vai para o lixo e o jogador compra outra.
  secondDraw(seat) {
    const err = this.checkTurn(seat, 'play');
    if (err) return err;
    if (!this.turn.canSecondDraw) {
      return fail('A 2ª compra só é permitida ao primeiro jogador da rodada, logo após a primeira compra.');
    }
    const p = this.players[seat];
    const idx = p.hand.findIndex((c) => c.id === this.turn.firstCardId);
    if (idx < 0) return fail('Carta não encontrada.');
    const [rejected] = p.hand.splice(idx, 1);
    this.discardPile.push(rejected);
    this.turn.canSecondDraw = false;
    const c = this.stock.pop();
    p.hand.push(c);
    this.emit('reject', { seat, card: rejected });
    this.emit('draw', { seat, card: c });
    this.addLog(
      `${p.name} recusou ${cardName(rejected)} (foi para o lixo) e comprou outra carta` +
        (p.isHuman ? `: ${cardName(c)}.` : '.'),
      seat
    );
    const extra = isRedThree(c) ? this.layRedThrees(seat) : [];
    this.turn.newIds = new Set([c.id, ...extra].filter((id) => p.hand.some((h) => h.id === id)));
    return OK;
  }

  /*
   * Baixar sequências / acrescentar cartas / pegar o lixo: tudo numa só ação.
   * plan = {
   *   newMelds:  [[ids das cartas], ...]               sequências novas
   *   additions: [{ meldIndex, ids: [...] }, ...]       cartas acrescentadas a jogos da dupla
   *   pickup:    true/false                             se a jogada é para pegar o lixo
   * }
   * Ao pegar o lixo, a carta do topo é indicada pelo id especial 'TOP'.
   */
  applyMelds(seat, plan) {
    const pickup = !!plan.pickup;
    const err = this.checkTurn(seat, pickup ? 'draw' : 'play');
    if (err) return err;
    const p = this.players[seat];
    const team = this.teamOf(seat);
    const newMelds = plan.newMelds || [];
    const additions = plan.additions || [];
    if (!newMelds.length && !additions.length) return fail('Selecione as cartas.');

    let top = null;
    if (pickup) {
      top = this.topDiscard;
      if (!top) return fail('O lixo está vazio.');
      if (this.isDiscardBlocked()) return fail(this.blockedReason());
    }

    // Transforma os ids em cartas, conferindo se estão mesmo na mão.
    const used = new Set();
    let topUsed = false;
    const resolve = (id) => {
      if (id === 'TOP') {
        if (!pickup || topUsed) throw new Error('A carta do topo do lixo só pode ser usada uma vez.');
        topUsed = true;
        return top;
      }
      if (used.has(id)) throw new Error('A mesma carta foi escolhida duas vezes.');
      const c = p.hand.find((h) => h.id === id);
      if (!c) throw new Error('Essa carta não está na mão.');
      used.add(id);
      return c;
    };
    let builtNew;
    let topAddGroup = null; // cartas acrescentadas junto com o topo do lixo
    const grouped = new Map();
    try {
      builtNew = newMelds.map((ids) => ids.map(resolve));
      for (const a of additions) {
        if (!team.melds[a.meldIndex]) throw new Error('Jogo não encontrado.');
        const cards = a.ids.map(resolve);
        if (pickup && a.ids.includes('TOP')) topAddGroup = cards;
        const list = grouped.get(a.meldIndex) || [];
        list.push(...cards);
        grouped.set(a.meldIndex, list);
      }
    } catch (e) {
      return fail(e.message);
    }
    // Pegar o lixo: a carta do topo + pelo menos 2 cartas da mão precisam formar uma
    // sequência entre si. Elas podem virar um jogo novo ou ser encaixadas num jogo da dupla.
    // Não vale só encaixar o topo sozinho num jogo que já está na mesa.
    const topMeld = pickup ? builtNew.find((cards) => cards.includes(top)) || topAddGroup : null;
    if (pickup && (!topUsed || !topMeld || topMeld.length < 3 || !Rules.analyzeMeld(topMeld).ok)) {
      return fail(
        'Para pegar o lixo, a carta do topo precisa formar uma sequência com pelo menos 2 cartas da sua mão ' +
          '(como jogo novo ou encaixando num jogo da dupla).'
      );
    }

    // Valida cada sequência nova e cada acréscimo.
    const analyzedNew = [];
    for (const cards of builtNew) {
      const a = Rules.analyzeMeld(cards);
      if (!a.ok) return fail(a.error);
      analyzedNew.push(a);
    }
    const analyzedAdd = [];
    for (const [idx, cards] of grouped) {
      const a = Rules.analyzeMeld(team.melds[idx].cards.concat(cards));
      if (!a.ok) return fail('Não encaixa nesse jogo: ' + a.error);
      analyzedAdd.push([idx, a]);
    }

    // Abertura: a primeira descida da dupla precisa atingir o mínimo ou ter uma canastra.
    if (!team.opened) {
      const pts = analyzedNew.reduce((s, a) => s + a.points, 0);
      if (!Rules.opensGame(analyzedNew.map((a) => a.ordered), team.minOpen)) {
        return fail(
          `Para abrir, a dupla precisa de ${team.minOpen} pontos${team.vu ? ' (dupla em VU)' : ''} ` +
            `ou de uma canastra (7 cartas). Essas sequências somam ${pts}.`
        );
      }
    }

    // Só pode ficar sem cartas (bater) com canastra limpa na dupla.
    const finalHand = p.hand.length - used.size + (pickup ? this.discardPile.length - 1 : 0);
    const after = team.melds.map((m) => m.cards);
    analyzedAdd.forEach(([i, a]) => (after[i] = a.ordered));
    analyzedNew.forEach((a) => after.push(a.ordered));
    const cleanAfter = after.some((cs) => Rules.isCleanCanastra(cs));
    if (finalHand === 0 && !cleanAfter) {
      return fail('Você não pode ficar sem cartas: para bater, a dupla precisa ter pelo menos uma canastra limpa.');
    }
    if (finalHand === 1 && !cleanAfter) {
      return fail(
        'Você precisa ficar com pelo menos 2 cartas: ao descartar a última você bateria, ' +
          'e a dupla ainda não tem canastra limpa.'
      );
    }

    // Tudo certo: aplica a jogada.
    const canastrasBefore = team.melds.map((m) => Rules.isCanastra(m.cards));
    p.hand = p.hand.filter((c) => !used.has(c.id));
    analyzedAdd.forEach(([i, a]) => (team.melds[i].cards = a.ordered));
    analyzedNew.forEach((a) => team.melds.push({ cards: a.ordered }));
    const wasOpened = team.opened;
    team.opened = true;
    this.turn.canSecondDraw = false;

    if (pickup) {
      this.discardPile.pop();
      const pile = this.discardPile.splice(0);
      p.hand.push(...pile);
      pile.forEach((c) => this.publicIn[seat].add(c.id)); // todos viram essas cartas irem para a mão
      this.turn.newIds = new Set(pile.map((c) => c.id));
      this.phase = 'play';
      const fromHand = topMeld.filter((c) => c !== top).map(cardName).join(', ');
      this.addLog(
        `${p.name} pegou o lixo (${pile.length + 1} cartas): juntou ${cardName(top)} do topo com ${fromHand} da mão.`,
        seat
      );
      this.emit('pickup', { seat, top, pile });
    }
    for (const a of analyzedNew) {
      this.addLog(`${p.name} baixou: ${a.ordered.map(cardName).join(' ')}`, seat);
      this.emit('meld', { seat, cards: a.ordered });
    }
    for (const [i, a] of analyzedAdd) {
      const added = grouped.get(i);
      this.addLog(`${p.name} acrescentou ${added.map(cardName).join(' ')} ao jogo ${a.ordered.map(cardName).join(' ')}`, seat);
      this.emit('add', { seat, cards: added });
    }
    if (!wasOpened) {
      const pts = analyzedNew.reduce((s, a) => s + a.points, 0);
      this.addLog(`A dupla "${team.name}" abriu com ${pts} pontos.`, seat);
    }
    team.melds.forEach((m, i) => {
      if (Rules.isCanastra(m.cards) && !canastrasBefore[i]) {
        this.addLog(`${p.name} completou uma canastra ${Rules.isDirty(m.cards) ? 'suja' : 'limpa'}!`, seat);
      }
    });

    if (!p.hand.length) this.endRound(seat); // bateu sem descartar
    return OK;
  }

  // ---------- Descarte e troca de vez ----------

  discard(seat, cardId) {
    const err = this.checkTurn(seat, 'play');
    if (err) return err;
    const p = this.players[seat];
    const team = this.teamOf(seat);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return fail('Essa carta não está na mão.');
    // Caso raro: o monte acabou num 3 vermelho sem reposição e o jogador ficou com 1 carta.
    // Sem canastra limpa ele não pode bater; descarta e a rodada termina pelo fim do monte.
    const stuckEnd = p.hand.length === 1 && !Rules.hasCleanCanastra(team.melds) && !this.stock.length;
    if (p.hand.length === 1 && !Rules.hasCleanCanastra(team.melds) && !stuckEnd) {
      return fail('Você não pode bater: a dupla ainda não tem canastra limpa.');
    }
    const [c] = p.hand.splice(idx, 1);
    this.discardPile.push(c);
    this.emit('discard', { seat, card: c });
    this.addLog(
      `${p.name} descartou ${cardName(c)}` +
        (isLockingCard(c) ? '. O lixo fica travado para o próximo jogador.' : '.'),
      seat
    );
    if (stuckEnd) {
      this.endRound(null);
      return OK;
    }
    if (!p.hand.length) {
      this.endRound(seat);
      return OK;
    }
    this.nextTurn();
    return OK;
  }

  nextTurn() {
    this.isFirstTurn = false;
    this.current = (this.current + 1) % 4;
    this.phase = 'draw';
    this.turn = this.freshTurn();
    if (!this.stock.length) {
      if (!this.topDiscard || this.isDiscardBlocked()) {
        this.addLog('O monte acabou e o lixo não pode ser pego.');
        this.endRound(null);
      } else {
        this.addLog(`O monte acabou. ${this.players[this.current].name} ainda pode pegar o lixo; senão a rodada termina.`);
      }
    }
  }

  // Monte vazio e o jogador da vez não quer (ou não pode) pegar o lixo.
  endByEmptyStock(seat) {
    const err = this.checkTurn(seat, 'draw');
    if (err) return err;
    if (this.stock.length) return fail('O monte ainda tem cartas.');
    this.addLog(`${this.players[seat].name} não pegou o lixo.`, seat);
    this.endRound(null);
    return OK;
  }

  // ---------- Fim da rodada ----------

  endRound(batedor) {
    this.phase = 'roundEnd';
    if (batedor !== null) this.addLog(`${this.players[batedor].name} bateu! Fim da rodada.`, batedor);
    else this.addLog('Fim da rodada: o monte acabou.');

    const results = this.teams.map((team, t) => {
      const handCards = this.players.filter((p) => p.team === t).flatMap((p) => p.hand);
      const r = Rules.scoreTeam(team, handCards, batedor !== null && this.players[batedor].team === t);
      team.score += r.total;
      r.newScore = team.score;
      return r;
    });
    this.lastRound = { round: this.round, batedor, results };
    this.history.push(this.lastRound);

    const [a, b] = this.teams.map((t) => t.score);
    if (a >= Rules.TARGET || b >= Rules.TARGET) {
      this.matchOver = true;
      this.winner = a > b ? 0 : b > a ? 1 : null; // null = empate
    }
    this.dealer = (this.dealer + 1) % 4; // o próximo carteador é o seguinte no sentido horário
  }

  nextRound() {
    if (this.matchOver) return fail('A partida terminou.');
    if (this.phase !== 'roundEnd') return fail('A rodada ainda não terminou.');
    this.startRound();
    return OK;
  }
}
