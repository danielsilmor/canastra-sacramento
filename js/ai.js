/*
 * ai.js: Os jogadores do computador (bots)
 *
 * Quatro níveis de inteligência (escolhidos na engrenagem, para cada bot):
 *   Iniciante    joga com bom senso, mas comete alguns erros de propósito.
 *   Moderado     prefere aumentar os jogos da mesa a baixar várias sequências pequenas,
 *                usa curinga para fechar canastra em vez de pegar o lixo,
 *                descarta cartas baixas e só solta o Ás em último caso.
 *   Estratégico  antes de comprar e de descartar, "imagina" várias continuações da rodada
 *                para cada opção e escolhe a que rende mais pontos. Do lixo, só conhece
 *                a carta de cima (não decora o resto).
 *   Mestre       como o Estratégico, mas decora o lixo inteiro e as cartas que cada
 *                jogador pegou do lixo, e por isso imagina as mãos dos outros com mais acerto.
 * Todas as jogadas passam pelas mesmas regras do game.js que o jogador humano.
 * Nenhum bot vê a mão dos outros nem a ordem do monte: nas simulações,
 * as cartas escondidas são sorteadas entre as que ele não conhece.
 */

const AI = {
  LEVELS: {
    iniciante: { label: 'Iniciante', sim: false },
    moderado: { label: 'Moderado', sim: false },
    // rounds = quantos sorteios das cartas escondidas por decisão; budgetMs = tempo máximo para pensar.
    estrategico: { label: 'Estratégico', sim: true, memory: false, rounds: 120, budgetMs: 700 },
    mestre: { label: 'Mestre', sim: true, memory: true, rounds: 120, budgetMs: 1000 },
  },
  DEFAULT_LEVEL: 'moderado',
  // Simulação: cada sorteio é jogado "horizon" vezes à frente; "candidates" = quantos descartes comparar.
  // "maxRounds" é um teto geral (os testes diminuem para rodar rápido).
  SIM: { maxRounds: 10000, horizon: 8, candidates: 4 },

  levelOf(level) {
    return AI.LEVELS[level] ? level : AI.DEFAULT_LEVEL;
  },

  // ---------- A vez do bot ----------

  // Executa a vez inteira. "pause" dá tempo de mostrar cada passo na tela.
  async takeTurn(game, seat, pause, level) {
    // eslint-disable-next-line no-unused-vars
    for (const step of AI.turnSteps(game, seat, AI.levelOf(level))) await pause();
  },

  // A mesma vez, sem pausas (usada nas simulações).
  playTurnSync(game, seat, level) {
    // eslint-disable-next-line no-unused-vars
    for (const step of AI.turnSteps(game, seat, level)) { /* sem pausas */ }
  },

  // Os passos da vez. Cada "yield" é um ponto em que a tela pode mostrar o que aconteceu.
  *turnSteps(game, seat, level) {
    if (game.phase === 'draw') {
      const plan = AI.decideDraw(game, seat, level); // plano para pegar o lixo, ou null (monte)
      let took = false;
      if (plan) took = game.applyMelds(seat, plan).ok;
      if (!took) {
        if (!game.stock.length) {
          game.endByEmptyStock(seat);
          return;
        }
        game.drawFromStock(seat);
        if (game.turn.canSecondDraw && AI.wantsSecondDraw(game, seat)) {
          yield;
          game.secondDraw(seat);
        }
      }
      yield;
      if (game.phase !== 'play') return; // pode ter batido ao pegar o lixo
    }
    const before = game.players[seat].hand.length;
    AI.meldAll(game, seat, level);
    if (game.players[seat].hand.length !== before) yield;
    if (game.phase !== 'play' || game.current !== seat) return; // bateu baixando
    const card = AI.decideDiscard(game, seat, level);
    game.discard(seat, card.id);
    yield;
  },

  // Primeiro a jogar: troca a carta comprada se ela não combinar com nada da mão.
  wantsSecondDraw(game, seat) {
    const hand = game.players[seat].hand;
    const first = hand.find((c) => c.id === game.turn.firstCardId);
    return !!first && !isWild(first) && AI.usefulness(hand, first) === 0;
  },

  // ---------- Decisões de cada nível ----------

  // Comprar: retorna o plano para pegar o lixo, ou null para comprar do monte.
  decideDraw(game, seat, level) {
    const plan = AI.findPickup(game, seat);
    if (!plan || !game.stock.length) return plan; // sem monte, só resta o lixo
    if (level === 'iniciante') return Math.random() < 0.35 ? null : plan; // às vezes nem vê o lixo
    if (!AI.LEVELS[level].sim) {
      // Moderado: se dá para fechar uma canastra com curinga, compra do monte em vez de pegar o lixo.
      return AI.wildClosesCanastra(game, seat) ? null : plan;
    }
    // Estratégico e Mestre: imaginam as duas opções e ficam com a que rende mais.
    const best = AI.simulateBest(game, seat, level, [{ kind: 'stock' }, { kind: 'pickup', plan }]);
    return best.kind === 'pickup' ? plan : null;
  },

  // Descartar: escolhe a carta.
  decideDiscard(game, seat, level) {
    const hand = game.players[seat].hand;
    if (hand.length === 1) return hand[0];
    const blackThree = hand.find(isBlackThree);
    if (blackThree) return blackThree; // trava o lixo para o próximo
    if (level === 'iniciante') {
      // Às vezes descarta uma carta qualquer (menos curinga), mesmo que seja útil.
      const naturals = hand.filter((c) => !isWild(c));
      if (naturals.length && Math.random() < 0.25) return naturals[Math.floor(Math.random() * naturals.length)];
      return AI.rankDiscards(game, seat, 'iniciante')[0].card;
    }
    const ranked = AI.rankDiscards(game, seat, 'moderado');
    if (!AI.LEVELS[level].sim) return ranked[0].card;
    // Estratégico e Mestre: comparam os melhores descartes imaginando a continuação.
    let cands = ranked.filter((r) => r.score < 500).slice(0, AI.SIM.candidates); // curinga só se não houver outra
    if (!cands.length) cands = ranked.slice(0, 1);
    if (cands.length === 1) return cands[0].card;
    const best = AI.simulateBest(game, seat, level, cands.map((r) => ({ kind: 'discard', card: r.card })));
    return best.card;
  },

  /*
   * Nota de cada carta para descartar (menor = descarta primeiro).
   * Iniciante: a carta inútil que vale mais (para perder menos pontos na mão).
   * Moderado em diante: a carta inútil mais baixa (dificulta o adversário pegar o lixo)
   * e o Ás só em último caso.
   */
  rankDiscards(game, seat, style) {
    const p = game.players[seat];
    const hand = p.hand;
    const opponents = game.teams[1 - p.team];
    const list = hand.map((c) => {
      let s = AI.usefulness(hand, c) * 10;
      if (isWild(c)) s += 1000;
      if (opponents.melds.some((m) => Rules.analyzeMeld(m.cards.concat([c])).ok)) s += 60; // ajudaria o adversário
      if (style === 'iniciante') {
        s -= cardValue(c) / 5;
      } else {
        s += cardValue(c) / 5;
        if (c.rank === 14) s += 40;
      }
      return { card: c, score: s };
    });
    return list.sort((a, b) => a.score - b.score);
  },

  // Dá para fechar uma canastra da dupla usando um curinga da mão (com 6 cartas,
  // ou 5 cartas mais uma carta natural da mão)?
  wildClosesCanastra(game, seat) {
    const team = game.teamOf(seat);
    const hand = game.players[seat].hand;
    if (!team.opened || !hand.some(isWild)) return false;
    return team.melds.some((m) => {
      if (m.cards.some(isWild) || Rules.isCanastra(m.cards)) return false;
      if (m.cards.length === 6) return true;
      return m.cards.length === 5 &&
        hand.some((c) => !isWild(c) && !isThree(c) && Rules.analyzeMeld(m.cards.concat([c])).ok);
    });
  },

  // ---------- Ferramentas para achar sequências ----------

  // Quantas cartas da mão "conversam" com esta (vizinhas do mesmo naipe ou outros Ases).
  usefulness(hand, card) {
    if (isThree(card) || isWild(card)) return 0;
    let score = 0;
    const seen = new Set();
    for (const c of hand) {
      if (c.id === card.id || isWild(c) || isThree(c)) continue;
      if (card.rank === 14 && c.rank === 14) score += 1;
      if (c.suit !== card.suit || c.rank === card.rank || seen.has(c.rank)) continue;
      const d = Math.abs(c.rank - card.rank);
      if (d === 1) score += 2;
      else if (d === 2) score += 1;
      seen.add(c.rank);
    }
    return score;
  },

  // Sequências de cartas consecutivas (sem repetir) de um naipe, entre as cartas livres.
  segments(cards, suit, used) {
    const byRank = new Map();
    for (const c of cards) {
      if (c.suit === suit && !isWild(c) && !isThree(c) && !used.has(c.id) && !byRank.has(c.rank)) {
        byRank.set(c.rank, c);
      }
    }
    const segs = [];
    let run = [];
    for (let r = 4; r <= 15; r++) {
      if (byRank.has(r)) run.push(byRank.get(r));
      else {
        if (run.length) segs.push(run);
        run = [];
      }
    }
    return segs;
  },

  // Procura sequências possíveis na mão (sem repetir cartas entre elas).
  findMelds(cards, allowDirty) {
    const used = new Set();
    const melds = [];
    const take = (meld) => {
      melds.push(meld);
      meld.forEach((c) => used.add(c.id));
    };
    // 1) Sequências limpas (repete enquanto achar, por causa das cartas duplicadas).
    let found = true;
    while (found) {
      found = false;
      for (const suit of SUITS) {
        for (const seg of AI.segments(cards, suit, used)) {
          if (seg.length >= 3) {
            take(seg);
            found = true;
          }
        }
      }
    }
    // 2) Sequência de Ases.
    const aces = cards.filter((c) => c.rank === 14 && !used.has(c.id));
    if (aces.length >= 3) take(aces);

    // 3) Sequências sujas (com 1 curinga).
    if (allowDirty) {
      for (const wild of cards.filter(isWild)) {
        let best = null;
        for (const suit of SUITS) {
          const segs = AI.segments(cards, suit, used);
          for (let i = 0; i < segs.length; i++) {
            if (segs[i].length === 2 && (!best || best.length < 2)) best = segs[i];
            const next = segs[i + 1];
            if (next && next[0].rank - segs[i][segs[i].length - 1].rank === 2) {
              const joined = [...segs[i], ...next];
              if (joined.length <= 10 && (!best || joined.length > best.length)) best = joined;
            }
          }
        }
        const freeAces = cards.filter((c) => c.rank === 14 && !used.has(c.id));
        if (!best && freeAces.length >= 2) best = freeAces;
        if (best && Rules.analyzeMeld([...best, wild]).ok) take([...best, wild]);
      }
    }
    return melds;
  },

  // Monta um plano para pegar o lixo, se for possível.
  findPickup(game, seat) {
    const top = game.topDiscard;
    if (!top || game.isDiscardBlocked() || isThree(top)) return null;
    const p = game.players[seat];
    const team = game.teamOf(seat);

    // Regra: o topo precisa formar uma sequência nova com pelo menos 2 cartas da mão
    // (depois tenta esticar a sequência com mais cartas da mão).
    const hand = p.hand.filter((c) => !isThree(c));
    const options = [];
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        const a = Rules.analyzeMeld([top, hand[i], hand[j]]);
        if (!a.ok) continue;
        const used = [hand[i], hand[j]];
        for (const c of hand) {
          if (used.includes(c) || isWild(c)) continue;
          if (Rules.analyzeMeld([top, ...used, c]).ok) used.push(c);
        }
        const wildsUsed = used.filter(isWild).length;
        options.push({ used, dirty: Rules.isDirty([top, ...used]), wildsUsed, size: used.length });
      }
    }
    options.sort((x, y) => x.dirty - y.dirty || x.wildsUsed - y.wildsUsed || y.size - x.size);

    for (const opt of options) {
      const ids = ['TOP', ...opt.used.map((c) => c.id)];
      if (team.opened) {
        // Prefere encaixar num jogo da dupla (ajuda a fechar canastras); senão, jogo novo.
        const group = [top, ...opt.used];
        const i = team.melds.findIndex((m) => Rules.analyzeMeld(m.cards.concat(group)).ok);
        if (i >= 0) return { pickup: true, additions: [{ meldIndex: i, ids }] };
        return { pickup: true, newMelds: [ids] };
      }
      // Ainda não abriu: soma com outras sequências da mão para atingir o mínimo.
      const rest = p.hand.filter((c) => !opt.used.includes(c));
      const others = AI.findMelds(rest, true);
      // Vale se somar o mínimo ou se alguma sequência já for canastra (7+ cartas).
      if (Rules.opensGame([[top, ...opt.used], ...others], team.minOpen)) {
        return { pickup: true, newMelds: [ids, ...others.map((m) => m.map((c) => c.id))] };
      }
    }
    return null;
  },

  // Tenta abrir o jogo da dupla com as sequências da mão.
  tryOpen(game, seat) {
    const p = game.players[seat];
    const team = game.teamOf(seat);
    for (const allowDirty of [false, true]) {
      const melds = AI.findMelds(p.hand, allowDirty).sort(
        (a, b) => Rules.pointsOf(b) - Rules.pointsOf(a)
      );
      while (melds.length) {
        if (!Rules.opensGame(melds, team.minOpen)) break; // mínimo de pontos ou canastra
        const r = game.applyMelds(seat, { newMelds: melds.map((m) => m.map((c) => c.id)) });
        if (r.ok) return true;
        melds.pop(); // tira a menor e tenta de novo
      }
    }
    return false;
  },

  // Baixa tudo o que fizer sentido (a tela mostra todas as descidas juntas num só passo).
  meldAll(game, seat, level) {
    const team = game.teamOf(seat);
    if (level === 'iniciante' && Math.random() < 0.3) return; // às vezes demora para baixar
    if (!team.opened && !AI.tryOpen(game, seat)) return;
    for (let guard = 0; guard < 60 && game.phase === 'play'; guard++) {
      if (!AI.nextMeldAction(game, seat, level)) break;
    }
  },

  // Moderado em diante: guarda na mão uma sequência pequena (3 cartas) em vez de baixá-la,
  // para aumentar os jogos da mesa e ter cartas para pegar o lixo. Baixa mesmo assim
  // quando a mão está grande, o monte está acabando ou já dá para bater.
  keepInHand(game, seat, meld, hasClean) {
    const hand = game.players[seat].hand;
    return meld.length <= 3 && hand.length < 10 && game.stock.length > 12 && !(hasClean && hand.length <= 6);
  },

  // Procura a próxima jogada útil e já a executa. Retorna true se fez algo.
  nextMeldAction(game, seat, level) {
    const p = game.players[seat];
    const team = game.teamOf(seat);
    const hasClean = Rules.hasCleanCanastra(team.melds);
    const smart = level !== 'iniciante';
    const tryPlan = (plan) => game.applyMelds(seat, plan).ok;
    const order = team.melds.map((m, i) => i).sort((a, b) => team.melds[b].cards.length - team.melds[a].cards.length);

    // 1) Acrescentar cartas naturais aos jogos da dupla (prioriza os maiores).
    for (const c of p.hand) {
      if (isWild(c) || isThree(c)) continue;
      for (const i of order) {
        if (Rules.analyzeMeld(team.melds[i].cards.concat([c])).ok &&
            tryPlan({ additions: [{ meldIndex: i, ids: [c.id] }] })) return true;
      }
    }
    // 2) Curinga para fechar canastra (jogo com 6 cartas e sem curinga).
    //    Coringão: sempre (continua limpa). Coringuinha (2): Iniciante só se a dupla já tem
    //    uma limpa; do Moderado em diante, sempre (vira canastra suja, 300 pontos).
    const joker = p.hand.find(isJoker);
    const two = p.hand.find(isDirtyWild);
    for (const wild of [joker, smart || hasClean ? two : null]) {
      if (!wild) continue;
      for (const i of order) {
        const cards = team.melds[i].cards;
        if (cards.length === 6 && !cards.some(isWild) &&
            tryPlan({ additions: [{ meldIndex: i, ids: [wild.id] }] })) return true;
      }
    }
    // 3) Sequências novas limpas.
    for (const m of AI.findMelds(p.hand, false)) {
      if (smart && AI.keepInHand(game, seat, m, hasClean)) continue;
      if (tryPlan({ newMelds: [m.map((c) => c.id)] })) return true;
    }
    // 4) Sequências novas com curinga: com coringão sempre (é limpa);
    //    com 2 só quando a mão está grande ou já dá para bater.
    for (const m of AI.findMelds(p.hand, true)) {
      if (!m.some(isWild)) continue;
      if (Rules.isDirty(m) && !(hasClean || p.hand.length >= 9)) continue;
      if (smart && AI.keepInHand(game, seat, m, hasClean)) continue;
      if (tryPlan({ newMelds: [m.map((c) => c.id)] })) return true;
    }
    return false;
  },

  // ---------- Simulação (Estratégico e Mestre) ----------

  /*
   * Compara opções "imaginando" o resto da rodada:
   *   1. sorteia as cartas que o bot não conhece (mãos dos outros, monte e,
   *      para quem não decora, o lixo embaixo da carta de cima);
   *   2. para cada opção, joga a partir daí algumas vezes à frente (todos jogando como Moderado);
   *   3. soma o placar imaginado. Repete com novos sorteios enquanto houver tempo.
   * Todas as opções usam os mesmos sorteios, para a comparação ser justa.
   */
  simulateBest(game, seat, level, candidates) {
    const cfg = AI.LEVELS[level];
    const team = game.players[seat].team;
    const totals = candidates.map(() => 0);
    const start = performance.now();
    const maxRounds = Math.min(cfg.rounds, AI.SIM.maxRounds);
    let rounds = 0;
    while (rounds < maxRounds && (rounds < 2 || performance.now() - start < cfg.budgetMs)) {
      const hidden = AI.guessHidden(game, seat, cfg.memory);
      candidates.forEach((cand, i) => {
        const g = AI.imagine(game, hidden);
        AI.applyCandidate(g, seat, cand);
        totals[i] += AI.rollout(g, team);
      });
      rounds++;
    }
    let best = 0;
    totals.forEach((t, i) => {
      if (t > totals[best]) best = i;
    });
    return candidates[best];
  },

  // Sorteia uma versão possível das cartas escondidas, do ponto de vista do bot "seat".
  guessHidden(game, seat, memory) {
    const known = new Set(game.players[seat].hand.map((c) => c.id));
    const top = game.topDiscard;
    if (top) known.add(top.id);
    const fixed = {}; // cartas que o bot sabe que estão na mão de cada um (Mestre)
    if (memory) {
      game.discardPile.forEach((c) => known.add(c.id)); // decorou o lixo inteiro
      for (const p of game.players) {
        if (p.seat === seat) continue;
        fixed[p.seat] = p.hand.filter((c) => game.publicIn[p.seat].has(c.id)); // viu pegar do lixo
        fixed[p.seat].forEach((c) => known.add(c.id));
      }
    }
    const everywhere = [...game.stock, ...game.discardPile, ...game.players.flatMap((p) => p.hand)];
    const pool = shuffle(everywhere.filter((c) => !known.has(c.id)));
    const hands = {};
    for (const p of game.players) {
      if (p.seat === seat) continue;
      const mine = fixed[p.seat] || [];
      hands[p.seat] = [...mine, ...pool.splice(0, p.hand.length - mine.length)];
    }
    const discardPile = memory
      ? [...game.discardPile]
      : [...pool.splice(0, Math.max(0, game.discardPile.length - 1)), ...(top ? [top] : [])];
    return { hands, discardPile, stock: pool };
  },

  // Uma cópia da partida com as cartas escondidas trocadas pelo sorteio.
  imagine(game, hidden) {
    const g = game.clone();
    for (const seat of Object.keys(hidden.hands)) g.players[seat].hand = [...hidden.hands[seat]];
    g.discardPile = [...hidden.discardPile];
    g.stock = [...hidden.stock];
    return g;
  },

  // Aplica a opção que está sendo testada e termina a vez do bot (como Moderado).
  applyCandidate(g, seat, cand) {
    if (cand.kind === 'discard') {
      g.discard(seat, cand.card.id);
      return;
    }
    let took = false;
    if (cand.kind === 'pickup') took = g.applyMelds(seat, cand.plan).ok;
    if (!took) {
      if (!g.stock.length) return;
      g.drawFromStock(seat);
      if (g.turn.canSecondDraw && AI.wantsSecondDraw(g, seat)) g.secondDraw(seat);
    }
    if (g.phase !== 'play') return;
    AI.meldAll(g, seat, 'moderado');
    if (g.phase === 'play' && g.current === seat) g.discard(seat, AI.decideDiscard(g, seat, 'moderado').id);
  },

  // Joga algumas vezes à frente e devolve a vantagem da dupla "team" no placar imaginado.
  rollout(g, team) {
    for (let t = 0; t < AI.SIM.horizon && g.phase !== 'roundEnd'; t++) {
      const seat = g.current;
      AI.playTurnSync(g, seat, 'moderado');
      if (g.phase !== 'roundEnd' && g.current === seat) break; // não conseguiu jogar
    }
    return AI.evaluate(g, team) - AI.evaluate(g, 1 - team);
  },

  // Valor da situação de uma dupla: pontos da mesa, com as cartas da mão valendo metade
  // (ainda podem ser baixadas) e um bônus para jogos perto de virar canastra.
  evaluate(g, t) {
    if (g.phase === 'roundEnd' && g.lastRound) return g.lastRound.results[t].total;
    const team = g.teams[t];
    const hand = g.players.filter((p) => p.team === t).flatMap((p) => p.hand);
    let v = Rules.scoreTeam(team, [], false).total - 0.5 * Rules.pointsOf(hand);
    for (const m of team.melds) {
      if (Rules.isCanastra(m.cards)) continue;
      if (m.cards.length === 6) v += 90;
      else if (m.cards.length === 5) v += 40;
    }
    return v;
  },
};
