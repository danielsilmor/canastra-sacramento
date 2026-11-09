/*
 * ai.js: Os jogadores do computador (bots)
 *
 * Quatro níveis de inteligência (escolhidos na engrenagem, para cada bot):
 *   Iniciante    joga com bom senso, mas comete alguns erros de propósito.
 *   Moderado     abre gastando o mínimo de curingas (compara várias montagens),
 *                conta as cartas já presas em jogos na mesa para saber a chance de canastra
 *                de cada jogo (não põe curinga em jogo fraco; carta vai para o jogo mais promissor),
 *                não baixa sequência que disputa cartas com outra do mesmo naipe já na mesa,
 *                prefere aumentar os jogos da mesa a baixar várias sequências pequenas,
 *                guarda o coringão para fechar canastra (não começa jogo novo com ele),
 *                só fecha canastra com coringuinha se a dupla já tem uma limpa,
 *                não fica com menos de 3 cartas sem canastra limpa (senão fica "preso"),
 *                descarta cartas baixas e só solta o Ás em último caso.
 *   Esperto       antes de comprar e de descartar, "imagina" várias continuações da rodada
 *                para cada opção e escolhe a que rende mais pontos. Do lixo, só conhece
 *                a carta de cima (não decora o resto).
 *   Mestre       módulo próprio (mestre.js): decora o lixo e as cartas que cada jogador
 *                pegou dele, deduz as cartas dos adversários pelo comportamento, compara
 *                todas as opções com Monte Carlo adaptativo e só troca a jogada das regras
 *                quando a vantagem é clara. Ver IA.md.
 * Todas as jogadas passam pelas mesmas regras do game.js que o jogador humano.
 * Nenhum bot vê a mão dos outros nem a ordem do monte: nas simulações,
 * as cartas escondidas são sorteadas entre as que ele não conhece.
 */

const AI = {
  LEVELS: {
    iniciante: { label: 'Iniciante', sim: false },
    moderado: { label: 'Moderado', sim: false },
    // rounds = quantos sorteios das cartas escondidas por decisão; budgetMs = tempo máximo para pensar.
    esperto: { label: 'Esperto', sim: true, memory: false, rounds: 120, budgetMs: 700 },
    // Mestre: módulo próprio (mestre.js). Um nível com "hidden: true" não aparece nas configurações.
    mestre: { label: 'Mestre', sim: true, memory: true, engine: 'gm' },
  },
  DEFAULT_LEVEL: 'moderado',
  // Simulação: cada sorteio é jogado "horizon" vezes à frente; "candidates" = quantos descartes comparar.
  // "maxRounds" é um teto geral (os testes diminuem para rodar rápido).
  SIM: { maxRounds: 10000, horizon: 8, candidates: 4 },

  levelOf(level) {
    return AI.LEVELS[level] ? level : AI.DEFAULT_LEVEL;
  },

  // ---------- Explicações (modo depuração) ----------
  // Com o modo depuração ligado, o bot anota o motivo de cada decisão da vez.
  // Nas simulações (jogadas "imaginadas") nada é anotado.
  trace: null,      // anotações da vez atual (null = não anotar)
  lastTrace: [],    // anotações da última vez jogada
  quiet: 0,         // maior que 0 enquanto o bot está simulando

  note(text) {
    if (AI.trace && !AI.quiet && !AI.trace.includes(text)) AI.trace.push(text);
  },
  names(cards) {
    return cards.map(cardName).join(' ');
  },

  // ---------- A vez do bot ----------

  // Executa a vez inteira. "pause" dá tempo de mostrar cada passo na tela.
  // "explain" = anotar os motivos de cada decisão (modo depuração).
  async takeTurn(game, seat, pause, level, explain = false) {
    AI.trace = explain ? [] : null;
    try {
      // eslint-disable-next-line no-unused-vars
      for (const step of AI.turnSteps(game, seat, AI.levelOf(level))) await pause();
    } finally {
      AI.lastTrace = AI.trace || [];
      AI.trace = null;
    }
  },

  // A mesma vez, sem pausas (usada nas simulações).
  playTurnSync(game, seat, level) {
    // eslint-disable-next-line no-unused-vars
    for (const step of AI.turnSteps(game, seat, level)) { /* sem pausas */ }
  },

  // Os passos da vez. Cada "yield" é um ponto em que a tela pode mostrar o que aconteceu.
  *turnSteps(game, seat, level) {
    if (AI.LEVELS[level] && AI.LEVELS[level].engine === 'gm') { // Mestre: decide pelo mestre.js
      yield* GM.turnSteps(game, seat);
      return;
    }
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
          const first = game.players[seat].hand.find((c) => c.id === game.turn.firstCardId);
          AI.note(`Trocou ${cardName(first)} (primeiro a jogar): a carta comprada não combinava com nada da mão.`);
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
    if (!card) { // mão vazia (não deveria acontecer): encerra a rodada para o jogo não travar
      game.endRound(null);
      return;
    }
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
    if (!plan) {
      AI.note(AI.whyNoPickup(game, seat));
      return null;
    }
    const pickupText = AI.describePickup(game, seat, plan);
    if (!game.stock.length) {
      AI.note(`O monte acabou, então pegou o lixo. ${pickupText}`);
      return plan; // sem monte, só resta o lixo
    }
    if (level === 'iniciante') {
      if (Math.random() < 0.35) {
        AI.note(`Podia pegar o lixo, mas comprou do monte (erro de propósito do nível Iniciante). ${pickupText}`);
        return null;
      }
      AI.note(pickupText);
      return plan;
    }
    if (!AI.LEVELS[level].sim) {
      // Moderado: se dá para fechar uma canastra com curinga, compra do monte em vez de pegar o lixo.
      if (AI.wildClosesCanastra(game, seat)) {
        AI.note('Podia pegar o lixo, mas preferiu comprar do monte: dá para fechar uma canastra com o curinga da mão.');
        return null;
      }
      AI.note(pickupText);
      return plan;
    }
    // Esperto: imagina as duas opções e ficam com a que rende mais.
    const cands = [{ kind: 'stock', label: 'comprar do monte' }, { kind: 'pickup', plan, label: 'pegar o lixo' }];
    const best = AI.simulateBest(game, seat, level, cands);
    AI.note(`${AI.simSummary(cands)} Escolheu ${best.label}.` + (best.kind === 'pickup' ? ` ${pickupText}` : ''));
    return best.kind === 'pickup' ? plan : null;
  },

  // Por que não deu para pegar o lixo?
  whyNoPickup(game, seat) {
    const top = game.topDiscard;
    const team = game.teamOf(seat);
    if (!top) return 'Comprou do monte: o lixo está vazio.';
    if (game.isDiscardBlocked()) return `Comprou do monte: o lixo está travado (${cardName(top)} no topo).`;
    if (isThree(top)) return `Comprou do monte: o topo do lixo é ${cardName(top)}, e 3 não entra em sequência.`;
    const hand = game.players[seat].hand.filter((c) => !isThree(c));
    let pair = false;
    for (let i = 0; i < hand.length && !pair; i++) {
      for (let j = i + 1; j < hand.length && !pair; j++) pair = Rules.analyzeMeld([top, hand[i], hand[j]]).ok;
    }
    if (!pair) return `Comprou do monte: não tem 2 cartas na mão que formem sequência com ${cardName(top)} do lixo.`;
    return `Comprou do monte: dava para usar ${cardName(top)} do lixo, mas não alcança o mínimo para abrir ` +
      `(${team.minOpen} pontos ou uma canastra).`;
  },

  // Descreve o plano de pegar o lixo.
  describePickup(game, seat, plan) {
    const hand = game.players[seat].hand;
    const top = game.topDiscard;
    const team = game.teamOf(seat);
    const fromHand = (ids) => ids.filter((id) => id !== 'TOP').map((id) => hand.find((c) => c.id === id));
    const size = game.discardPile.length;
    if (plan.additions && plan.additions.length) {
      const a = plan.additions[0];
      return `Pegou o lixo (${size} carta${size > 1 ? 's' : ''}): ${cardName(top)} do topo + ${AI.names(fromHand(a.ids))} da mão, ` +
        `encaixando no jogo ${AI.names(team.melds[a.meldIndex].cards)}.`;
    }
    const first = plan.newMelds[0];
    const extra = plan.newMelds.length - 1;
    return `Pegou o lixo (${size} carta${size > 1 ? 's' : ''}): ${cardName(top)} do topo + ${AI.names(fromHand(first))} da mão, ` +
      `formando jogo novo` + (extra ? ` e abrindo com mais ${extra} sequência${extra > 1 ? 's' : ''}.` : '.');
  },

  // Descartar: escolhe a carta.
  decideDiscard(game, seat, level) {
    const hand = game.players[seat].hand;
    if (!hand.length) return null; // sem cartas, não há o que descartar
    if (hand.length === 1) {
      AI.note(`Descartou ${cardName(hand[0])}, a última carta da mão.`);
      return hand[0];
    }
    const blackThree = hand.find(isBlackThree);
    if (blackThree) {
      AI.note(`Descartou ${cardName(blackThree)}: o 3 preto trava o lixo para o próximo jogador.`);
      return blackThree;
    }
    if (level === 'iniciante') {
      // Às vezes descarta uma carta qualquer (menos curinga), mesmo que seja útil.
      const naturals = hand.filter((c) => !isWild(c));
      if (naturals.length && Math.random() < 0.25) {
        const c = naturals[Math.floor(Math.random() * naturals.length)];
        AI.note(`Descartou ${cardName(c)} sem pensar muito (erro de propósito do nível Iniciante).`);
        return c;
      }
      const r = AI.rankDiscards(game, seat, 'iniciante');
      AI.note(AI.describeDiscard(r));
      return r[0].card;
    }
    const ranked = AI.rankDiscards(game, seat, 'moderado');
    if (!AI.LEVELS[level].sim) {
      AI.note(AI.describeDiscard(ranked));
      return ranked[0].card;
    }
    // Esperto: compara os melhores descartes imaginando a continuação.
    // Cartas iguais (as duas cópias do mesmo 4♠) dão o mesmo resultado: compara cada uma só uma vez.
    const seen = new Set();
    const distinct = ranked.filter((r) => {
      const k = isWild(r.card) ? (isJoker(r.card) ? 'JK' : 'W2') : `${r.card.rank}${r.card.suit}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let cands = distinct.filter((r) => r.score < 500).slice(0, AI.SIM.candidates); // curinga só se não houver outra
    if (!cands.length) cands = ranked.slice(0, 1);
    if (cands.length === 1) {
      AI.note(AI.describeDiscard(ranked));
      return cands[0].card;
    }
    const options = cands.map((r) => ({ kind: 'discard', card: r.card, label: cardName(r.card) }));
    const best = AI.simulateBest(game, seat, level, options);
    const chosen = ranked.find((r) => r.card === best.card);
    AI.note(`${AI.simSummary(options)} Descartou ${cardName(best.card)} (${chosen.why.join(', ')}).`);
    return best.card;
  },

  // Explica o descarte escolhido e as próximas opções da lista.
  describeDiscard(ranked) {
    const [first, ...rest] = ranked;
    const others = rest.slice(0, 2).map((r) => `${cardName(r.card)} (${r.why.join(', ')})`);
    return `Descartou ${cardName(first.card)}: ${first.why.join(', ')}.` +
      (others.length ? ` Próximas opções: ${others.join('; ')}.` : '');
  },

  // Resumo de uma simulação: média de vantagem de cada opção.
  simSummary(cands) {
    const fmt = (v) => (v >= 0 ? '+' : '') + Math.round(v);
    return `Imaginou ${AI.lastSimRounds} continuações da rodada para cada opção ` +
      `(vantagem média da dupla no placar imaginado, quanto maior melhor: ${cands.map((c) => `${c.label} ${fmt(c.avg)}`).join(', ')}).`;
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
      const why = []; // motivos, para o modo depuração
      const u = AI.usefulness(hand, c);
      let s = u * 10;
      why.push(u === 0 ? 'carta solta, sem vizinhas na mão' : u >= 3 ? 'tem várias vizinhas na mão' : 'tem vizinha na mão');
      if (isWild(c)) {
        s += 1000;
        why.push('é curinga (só em último caso)');
      }
      if (opponents.melds.some((m) => Rules.analyzeMeld(m.cards.concat([c])).ok)) {
        s += 60; // ajudaria o adversário
        why.push('encaixa num jogo dos adversários');
      }
      if (style === 'iniciante') {
        s -= cardValue(c) / 5;
      } else {
        s += cardValue(c) / 5;
        if (cardValue(c) <= 5 && !isWild(c)) why.push('carta baixa');
        if (c.rank === 14) {
          s += 40;
          why.push('Ás só em último caso');
        }
      }
      return { card: c, score: s, why };
    });
    return list.sort((a, b) => a.score - b.score);
  },

  // Dá para fechar uma canastra da dupla usando um curinga da mão (com 6 cartas,
  // ou 5 cartas mais uma carta natural da mão)?
  wildClosesCanastra(game, seat) {
    const team = game.teamOf(seat);
    const hand = game.players[seat].hand;
    // Coringão sempre serve; o 2 só fecha canastra se a dupla já tem limpa ou o monte está no fim.
    const twoOk = Rules.hasCleanCanastra(team.melds) || game.stock.length <= 8;
    if (!team.opened || !hand.some((c) => isJoker(c) || (isDirtyWild(c) && twoOk))) return false;
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
  // "acesFirst": junta os Ases numa sequência de Ases antes de montar as sequências dos naipes
  // (senão, um Ás pode ir para a ponta de Q K A e faltar Ás para a sequência de Ases).
  findMelds(cards, allowDirty, acesFirst = false) {
    const used = new Set();
    const melds = [];
    const take = (meld) => {
      melds.push(meld);
      meld.forEach((c) => used.add(c.id));
    };
    if (acesFirst) {
      const allAces = cards.filter((c) => c.rank === 14);
      if (allAces.length >= 3) take(allAces);
    }
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

  // ---------- Chance de canastra ----------

  // Quantas cópias de cada carta (sem curingas) já estão em jogos: os da mesa, das duas duplas,
  // mais "extra" (jogos que o bot está pensando em baixar). Chave: valor + naipe, ex.: "14D".
  tableCounts(game, extra = []) {
    const counts = new Map();
    const add = (c) => {
      if (isWild(c)) return;
      const k = `${c.rank}${c.suit}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    };
    game.teams.forEach((t) => t.melds.forEach((m) => m.cards.forEach(add)));
    extra.forEach((m) => m.forEach(add));
    return counts;
  },

  /*
   * Até quantas cartas um jogo ainda pode chegar, contando só as cartas que não estão
   * presas em outros jogos (cada carta existe 2 vezes; há 8 Ases). "counts" já inclui
   * as cartas do próprio jogo. Uma canastra precisa de 7: abaixo de 8, o jogo é "fraco"
   * (depende de quase todas as cartas que sobraram).
   */
  reach(cards, counts) {
    const naturals = cards.filter((c) => !isWild(c));
    const wildSlot = 1; // o jogo tem (ou ainda pode ganhar) 1 curinga
    if (!naturals.length) return cards.length;
    if (naturals.every((c) => c.rank === 14)) {
      let acesOnTable = 0;
      for (const s of SUITS) acesOnTable += counts.get(`14${s}`) || 0;
      const elsewhere = acesOnTable - naturals.length;
      return 8 - elsewhere + wildSlot;
    }
    const suit = naturals[0].suit;
    const ranks = naturals.map((c) => c.rank);
    const lo = Math.min(...ranks);
    const hi = Math.max(...ranks);
    const free = (r) => 2 - (counts.get(`${r}${suit}`) || 0) > 0;
    let below = 0;
    for (let r = lo - 1; r >= 4 && free(r); r--) below++;
    let above = 0;
    for (let r = hi + 1; r <= 14 && free(r); r++) above++;
    const hasWild = cards.some(isWild);
    return Math.min(11, cards.length + below + above + (hasWild ? 0 : wildSlot));
  },

  // Jogo com pouca chance de virar canastra?
  isWeak(cards, counts) {
    return AI.reach(cards, counts) < 8;
  },

  /*
   * A sequência "cards" compete com alguma sequência do mesmo naipe em "melds"?
   * Compete quando falta só 1 ou 2 cartas entre as duas (ex.: 4♥ 5♥ 6♥ e 9♥ 10♥ J♥ Q♥).
   * Na mesa os jogos não se juntam: as duas passam a disputar as mesmas cartas (7♥, 8♥)
   * e nenhuma chega fácil a canastra. Melhor guardar as cartas para aumentar a que já existe.
   */
  competesWithRun(melds, cards) {
    return !!AI.competingRun(melds, cards);
  },
  // A sequência de "melds" com que "cards" competiria (ou null).
  competingRun(melds, cards) {
    const span = (cs) => {
      const n = cs.filter((c) => !isWild(c));
      if (!n.length || n.every((c) => c.rank === 14)) return null; // sequência de Ases não é de naipe
      const ranks = n.map((c) => c.rank);
      return { suit: n[0].suit, lo: Math.min(...ranks), hi: Math.max(...ranks) };
    };
    const a = span(cards);
    if (!a) return null;
    return melds.find((m) => {
      const b = span(m);
      if (!b || b.suit !== a.suit) return false;
      const gap = a.hi < b.lo ? b.lo - a.hi - 1 : b.hi < a.lo ? a.lo - b.hi - 1 : -1;
      return gap >= 1 && gap <= 2;
    }) || null;
  },

  /*
   * Moderado em diante: escolhe a melhor abertura entre várias montagens
   * (sequências dos naipes primeiro ou Ases primeiro, com e sem curinga).
   * Entre as que atingem o mínimo, fica com a que gasta menos curingas (o coringão vale mais
   * que o 2), sem curinga em jogo fraco; empate: a que soma mais pontos.
   */
  bestOpening(game, seat) {
    const hand = game.players[seat].hand;
    const team = game.teamOf(seat);
    const candidates = [];
    const seen = new Set();
    for (const acesFirst of [false, true]) {
      for (const allowDirty of [false, true]) {
        const set = AI.findMelds(hand, allowDirty, acesFirst);
        // Todas as combinações de jogos desse conjunto (no máximo 2^8).
        const n = Math.min(set.length, 8);
        for (let mask = 1; mask < (1 << n); mask++) {
          const melds = set.filter((m, i) => mask & (1 << i));
          if (!Rules.opensGame(melds, team.minOpen)) continue;
          const key = melds.map((m) => m.map((c) => c.id).sort().join(',')).sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const counts = AI.tableCounts(game, melds);
          let cost = 0;
          melds.forEach((m, i) => {
            cost += m.filter(isJoker).length * 3 + m.filter(isDirtyWild).length * 2;
            if (m.some(isWild) && AI.isWeak(m, counts)) cost += 4;
            // Duas sequências do mesmo naipe que vão disputar as mesmas cartas.
            if (AI.competesWithRun(melds.slice(i + 1), m)) cost += 2;
          });
          candidates.push({ melds, cost, points: melds.reduce((s, m) => s + Rules.pointsOf(m), 0) });
        }
      }
    }
    return candidates.sort((a, b) => a.cost - b.cost || b.points - a.points);
  },

  // Tenta abrir o jogo da dupla com as sequências da mão.
  tryOpen(game, seat, level) {
    const p = game.players[seat];
    const team = game.teamOf(seat);
    const smart = level !== 'iniciante';
    if (smart) {
      const cands = AI.bestOpening(game, seat);
      const desc = (c) => `${c.melds.map(AI.names).join(' + ')} (${c.points} pontos` +
        (c.cost ? `, custo ${c.cost})` : ', sem gastar curinga)');
      if (!cands.length) {
        AI.note(`Ainda não abriu: nenhuma combinação da mão soma ${team.minOpen} pontos nem forma canastra.`);
        return false;
      }
      for (const cand of cands) {
        const plan = { newMelds: cand.melds.map((m) => m.map((c) => c.id)) };
        if (AI.wouldStrand(game, seat, plan)) {
          AI.note(`Não abriu com ${desc(cand)}: ficaria com menos de 3 cartas sem canastra limpa.`);
          continue;
        }
        if (game.applyMelds(seat, plan).ok) {
          const other = cands.find((c) => c !== cand && c.cost > cand.cost);
          AI.note(`Abriu com ${desc(cand)}. Comparou ${cands.length} jeito${cands.length > 1 ? 's' : ''} de abrir ` +
            'e ficou com o que gasta menos curingas (custo: coringão 3, coringuinha 2, curinga em jogo fraco +4, ' +
            'sequências do mesmo naipe disputando cartas +2).' + (other ? ` Exemplo de opção pior: ${desc(other)}.` : ''));
          return true;
        }
      }
      return false;
    }
    for (const allowDirty of [false, true]) {
      const melds = AI.findMelds(p.hand, allowDirty).sort(
        (a, b) => Rules.pointsOf(b) - Rules.pointsOf(a)
      );
      while (melds.length) {
        if (!Rules.opensGame(melds, team.minOpen)) break; // mínimo de pontos ou canastra
        const plan = { newMelds: melds.map((m) => m.map((c) => c.id)) };
        if (!(smart && AI.wouldStrand(game, seat, plan)) && game.applyMelds(seat, plan).ok) return true;
        melds.pop(); // tira a menor e tenta de novo
      }
    }
    return false;
  },

  /*
   * Moderado em diante: a jogada deixaria o bot "preso"?
   * Sem canastra limpa na dupla não dá para bater; com 1 carta na mão o bot não consegue
   * mais baixar nem pegar o lixo (que pede 2 cartas da mão) e fica só comprando e descartando.
   * Por isso ele não baixa se ficaria com menos de 3 cartas (2 depois do descarte),
   * a não ser que a própria jogada feche uma canastra limpa ou o monte esteja no fim.
   */
  wouldStrand(game, seat, plan) {
    const hand = game.players[seat].hand;
    const team = game.teamOf(seat);
    if (Rules.hasCleanCanastra(team.melds) || game.stock.length <= 4) return false;
    const byId = (id) => hand.find((c) => c.id === id);
    const newMelds = (plan.newMelds || []).map((ids) => ids.map(byId));
    const additions = (plan.additions || []).map((a) => team.melds[a.meldIndex].cards.concat(a.ids.map(byId)));
    const used = newMelds.flat().length + (plan.additions || []).reduce((s, a) => s + a.ids.length, 0);
    if (hand.length - used >= 3) return false;
    return ![...newMelds, ...additions].some((cards) => Rules.isCleanCanastra(cards));
  },

  // Baixa tudo o que fizer sentido (a tela mostra todas as descidas juntas num só passo).
  meldAll(game, seat, level) {
    const team = game.teamOf(seat);
    if (level === 'iniciante' && Math.random() < 0.3) { // às vezes demora para baixar
      AI.note('Não baixou nada nesta vez (erro de propósito do nível Iniciante).');
      return;
    }
    if (!team.opened && !AI.tryOpen(game, seat, level)) return;
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
    const late = game.stock.length <= 8; // monte acabando: vale baixar o que der (cartas na mão contam contra)
    // Tenta a jogada; "what" descreve a jogada para as explicações (ex.: "acrescentar 8♣ ao jogo ...").
    const tryPlan = (plan, what, why = '') => {
      if (smart && AI.wouldStrand(game, seat, plan)) {
        AI.note(`Não quis ${what}: ficaria com menos de 3 cartas sem canastra limpa na dupla ` +
          '(sem conseguir mais baixar nem pegar o lixo).');
        return false;
      }
      if (!game.applyMelds(seat, plan).ok) return false;
      AI.note(`${what.charAt(0).toUpperCase()}${what.slice(1)}${why ? `: ${why}` : ''}.`.replace(/^Acrescentar/, 'Acrescentou')
        .replace(/^Fechar/, 'Fechou').replace(/^Baixar/, 'Baixou'));
      return true;
    };
    const counts = AI.tableCounts(game);
    // Ordem dos jogos da dupla. Iniciante: os maiores primeiro. Do Moderado em diante: primeiro
    // os que ainda não são canastra e têm chance de virar (os maiores e limpos antes),
    // depois as canastras prontas e, por último, os jogos fracos (pouca chance de canastra).
    const meldScore = (cards) => {
      if (!smart) return cards.length;
      let s = cards.length - (Rules.isDirty(cards) ? 0.5 : 0);
      if (Rules.isCanastra(cards)) s -= 50;
      else if (AI.isWeak(cards, counts)) s -= 100;
      return s;
    };
    const order = team.melds.map((m, i) => i)
      .sort((a, b) => meldScore(team.melds[b].cards) - meldScore(team.melds[a].cards));

    // 1) Acrescentar cartas naturais aos jogos da dupla (na ordem acima: uma carta que encaixa
    //    em dois jogos vai para o que está mais perto de virar canastra).
    for (const c of p.hand) {
      if (isWild(c) || isThree(c)) continue;
      const fits = order.filter((i) => Rules.analyzeMeld(team.melds[i].cards.concat([c])).ok);
      for (const i of fits) {
        const why = fits.length > 1 && smart ? `entre ${fits.length} jogos que aceitavam a carta, é o mais perto de virar canastra` : '';
        if (tryPlan({ additions: [{ meldIndex: i, ids: [c.id] }] },
          `acrescentar ${cardName(c)} ao jogo ${AI.names(team.melds[i].cards)}`, why)) return true;
      }
    }
    // 2) Curinga para fechar canastra (jogo com 6 cartas e sem curinga).
    //    Coringão: sempre (continua limpa). Coringuinha (2): só se a dupla já tem uma limpa,
    //    porque a canastra fica suja e, sem nenhuma limpa, a dupla não consegue bater.
    //    Do Moderado em diante, também quando o monte está acabando (garante os 300 pontos).
    const joker = p.hand.find(isJoker);
    const two = p.hand.find(isDirtyWild);
    const sixes = order.filter((i) => team.melds[i].cards.length === 6 && !team.melds[i].cards.some(isWild));
    if (two && !joker && sixes.length && !(hasClean || (smart && late))) {
      AI.note(`Não fechou a canastra ${AI.names(team.melds[sixes[0]].cards)} com ${cardName(two)}: ` +
        'a dupla ainda não tem canastra limpa, e com o 2 a canastra ficaria suja (sem limpa a dupla não pode bater).');
    }
    for (const wild of [joker, hasClean || (smart && late) ? two : null]) {
      if (!wild) continue;
      for (const i of sixes) {
        const cards = team.melds[i].cards;
        if (tryPlan({ additions: [{ meldIndex: i, ids: [wild.id] }] },
          `fechar a canastra ${AI.names(cards)} com ${cardName(wild)}`,
          isJoker(wild) ? 'o coringão mantém a canastra limpa (500)' : 'vira canastra suja (300)')) return true;
      }
    }
    // Do Moderado em diante: não baixa sequência nova que vai disputar cartas com outra
    // do mesmo naipe que a dupla já tem na mesa (e ainda não é canastra), salvo no fim do monte.
    const growing = team.melds.filter((m) => !Rules.isCanastra(m.cards)).map((m) => m.cards);
    const competes = (m) => {
      const rival = smart && !late ? AI.competingRun(growing, m) : null;
      if (rival) {
        AI.note(`Guardou ${AI.names(m)} na mão: disputaria cartas com o jogo ${AI.names(rival)} do mesmo naipe ` +
          '(na mesa os jogos não se juntam; melhor esperar as cartas que faltam para aumentar esse jogo).');
      }
      return !!rival;
    };
    const keeps = (m) => {
      const keep = smart && AI.keepInHand(game, seat, m, hasClean);
      if (keep) {
        AI.note(`Guardou ${AI.names(m)} na mão: sequência pequena, serve para aumentar jogos e para pegar o lixo ` +
          `(mão com ${p.hand.length} cartas, monte com ${game.stock.length}).`);
      }
      return keep;
    };

    // 3) Sequências novas limpas.
    for (const m of AI.findMelds(p.hand, false)) {
      if (competes(m)) continue;
      if (keeps(m)) continue;
      if (tryPlan({ newMelds: [m.map((c) => c.id)] }, `baixar ${AI.names(m)}`)) return true;
    }
    // 4) Sequências novas com curinga. Iniciante: com coringão sempre; com 2 só quando a mão
    //    está grande ou já dá para bater. Do Moderado em diante, o curinga fica guardado para
    //    fechar canastras: só começa jogo novo com ele se a mão está muito grande (12+),
    //    se a dupla já tem canastra limpa (hora de esvaziar a mão para bater) ou no fim do monte.
    for (const m of AI.findMelds(p.hand, true)) {
      if (!m.some(isWild)) continue;
      const wild = cardName(m.find(isWild));
      if (Rules.isDirty(m) && !(hasClean || p.hand.length >= 9)) {
        AI.note(`Não baixou ${AI.names(m)}: com o 2 a sequência fica suja; espera a mão crescer ou a dupla ter canastra limpa.`);
        continue;
      }
      if (smart && !(late || hasClean || p.hand.length >= 12)) {
        AI.note(`Guardou ${wild} (dava para baixar ${AI.names(m)}): o curinga fica guardado para fechar canastra.`);
        continue;
      }
      // Curinga em jogo fraco (pouca chance de canastra) é desperdício, salvo no fim do monte.
      if (smart && !late && AI.isWeak(m, AI.tableCounts(game, [m]))) {
        const r = AI.reach(m, AI.tableCounts(game, [m]));
        AI.note(`Não pôs ${wild} em ${AI.names(m)}: jogo com pouca chance de canastra ` +
          `(com as cartas que sobraram, chega no máximo a ${r} cartas).`);
        continue;
      }
      if (competes(m)) continue;
      if (keeps(m)) continue;
      const reason = late ? 'o monte está acabando' : hasClean ? 'a dupla já tem canastra limpa e é hora de esvaziar a mão'
        : `a mão está grande (${p.hand.length} cartas)`;
      if (tryPlan({ newMelds: [m.map((c) => c.id)] }, `baixar ${AI.names(m)}`, smart ? `usou curinga porque ${reason}` : '')) return true;
    }
    return false;
  },

  // ---------- Simulação (usada pelo Esperto e pelo Mestre) ----------

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
    AI.quiet++; // as jogadas imaginadas não entram nas explicações
    try {
      while (rounds < maxRounds && (rounds < 2 || performance.now() - start < cfg.budgetMs)) {
        const hidden = AI.guessHidden(game, seat, cfg.memory);
        candidates.forEach((cand, i) => {
          const g = AI.imagine(game, hidden);
          AI.applyCandidate(g, seat, cand);
          totals[i] += AI.rollout(g, team);
        });
        rounds++;
      }
    } finally {
      AI.quiet--;
    }
    candidates.forEach((cand, i) => (cand.avg = totals[i] / rounds)); // média, para as explicações
    AI.lastSimRounds = rounds;
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
    const fixed = {}; // cartas que o bot sabe que estão na mão de cada um (com memória)
    if (memory) {
      game.discardPile.forEach((c) => known.add(c.id)); // decorou o lixo inteiro
      for (const p of game.players) {
        if (p.seat === seat) continue;
        fixed[p.seat] = p.hand.filter((c) => game.publicIn[p.seat].has(c.id)); // viu pegar do lixo
        fixed[p.seat].forEach((c) => known.add(c.id));
      }
    }
    const everywhere = [...game.stock, ...game.discardPile, ...game.players.flatMap((p) => p.hand)];
    // 3 vermelhos nunca ficam na mão (são baixados assim que chegam) nem no lixo:
    // os que ainda não apareceram estão no monte.
    const unknown = everywhere.filter((c) => !known.has(c.id));
    const redThrees = unknown.filter(isRedThree);
    const pool = shuffle(unknown.filter((c) => !isRedThree(c)));
    const hands = {};
    for (const p of game.players) {
      if (p.seat === seat) continue;
      const mine = fixed[p.seat] || [];
      hands[p.seat] = [...mine, ...pool.splice(0, p.hand.length - mine.length)];
    }
    const discardPile = memory
      ? [...game.discardPile]
      : [...pool.splice(0, Math.max(0, game.discardPile.length - 1)), ...(top ? [top] : [])];
    return { hands, discardPile, stock: shuffle([...pool, ...redThrees]) };
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
    if (g.phase === 'play' && g.current === seat) {
      const card = AI.decideDiscard(g, seat, 'moderado');
      if (card) g.discard(seat, card.id);
    }
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
