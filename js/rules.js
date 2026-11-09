/*
 * rules.js: As regras da Canastra Sacramento
 *
 * Funções "puras": recebem cartas e respondem se a jogada é válida
 * ou quanto ela vale. Não mexem na mesa: quem faz isso é o game.js.
 */

const Rules = {
  TARGET: 5000,        // pontos para vencer a partida
  VU_LIMIT: 2500,      // acima disso a dupla fica "VU"
  MIN_OPEN: 80,        // pontos mínimos para abrir
  MIN_OPEN_VU: 120,    // pontos mínimos para abrir estando VU
  CANASTRA_SIZE: 7,    // cartas para formar canastra

  isVU(score) {
    return score > this.VU_LIMIT;
  },

  openingMinimum(score) {
    return this.isVU(score) ? this.MIN_OPEN_VU : this.MIN_OPEN;
  },

  /*
   * A abertura vale? Precisa somar o mínimo (80 ou 120) OU ter uma canastra
   * (7+ cartas, limpa ou suja), que já vale bem mais que o mínimo.
   * "melds" = lista de sequências (cada uma, uma lista de cartas).
   */
  opensGame(melds, minOpen) {
    if (melds.some((m) => this.isCanastra(m))) return true;
    return melds.reduce((s, m) => s + this.pointsOf(m), 0) >= minOpen;
  },

  pointsOf(cards) {
    return cards.reduce((sum, c) => sum + cardValue(c), 0);
  },

  /*
   * Verifica se um grupo de cartas forma uma sequência válida.
   * Retorna { ok: true, type, dirty, ordered, points } ou { ok: false, error }.
   *   type: 'run' (sequência do mesmo naipe) ou 'aces' (sequência de Ases)
   *   dirty: true se tem coringuinha (2): sequência "suja". O coringão não suja.
   *   ordered: as cartas na ordem certa para mostrar na mesa
   */
  analyzeMeld(cards) {
    const fail = (error) => ({ ok: false, error });
    if (cards.length < 3) return fail('Uma sequência precisa de pelo menos 3 cartas.');
    if (cards.some(isThree)) return fail('Cartas de valor 3 não podem entrar em sequências.');

    const wilds = cards.filter(isWild);
    const naturals = cards.filter((c) => !isWild(c));
    if (wilds.length > 1) {
      return fail('Cada sequência pode ter no máximo 1 curinga (coringão ou coringuinha).');
    }
    const points = this.pointsOf(cards);

    // Sequência de Ases: pelo menos 3 Ases, naipes livres, pode repetir.
    if (naturals.every((c) => c.rank === 14)) {
      return { ok: true, type: 'aces', dirty: this.isDirty(cards), ordered: [...naturals, ...wilds], points };
    }

    // Sequência normal: mesmo naipe, cartas consecutivas de 4 até Ás, sem repetir.
    const suit = naturals[0].suit;
    if (naturals.some((c) => c.suit !== suit)) {
      return fail('Não é permitido misturar naipes na mesma sequência.');
    }
    const ranks = naturals.map((c) => c.rank).sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] === ranks[i - 1]) return fail('Não pode repetir a mesma carta numa sequência.');
    }
    if (cards.length > 11) return fail('Uma sequência tem no máximo 11 cartas (do 4 ao Ás).');

    const min = ranks[0];
    const max = ranks[ranks.length - 1];
    const gaps = max - min + 1 - naturals.length; // buracos no meio
    if (gaps > wilds.length) {
      return fail('As cartas precisam ser consecutivas (está faltando carta no meio).');
    }

    // Se sobrou curinga sem buraco para tapar, ele vai numa das pontas.
    let lo = min;
    let hi = max;
    if (wilds.length > gaps) {
      if (hi < 14) hi++;
      else lo--;
    }
    if (lo < 4) return fail('A sequência começa no 4 e termina no Ás.');

    const byRank = new Map(naturals.map((c) => [c.rank, c]));
    const spare = [...wilds];
    const ordered = [];
    for (let r = lo; r <= hi; r++) ordered.push(byRank.get(r) || spare.pop());

    return { ok: true, type: 'run', dirty: this.isDirty(cards), ordered, points };
  },

  // Suja = tem coringuinha (2). Sequência com coringão continua limpa.
  isDirty(cards) {
    return cards.some(isDirtyWild);
  },

  /*
   * Separa um monte de cartas em várias sequências válidas, se for possível.
   * Exemplo: 8♠ 10♠ 2♠ 8♣ 9♣ J♣ Q♣ 2♦  →  [8♠ 2♠ 10♠] e [8♣ 9♣ 2♦ J♣ Q♣]
   * As cartas naturais são agrupadas por naipe e cada curinga é testado em cada grupo
   * (no máximo 1 por grupo) até todas as sequências ficarem válidas.
   * Retorna uma lista de sequências (já ordenadas) ou null se não der.
   */
  splitIntoMelds(cards) {
    const options = this.splitOptions(cards);
    return options.length ? options[0] : null;
  },

  /*
   * Todas as formas diferentes de separar as cartas em sequências válidas.
   * Cada carta natural pode ir para qualquer sequência em que caiba (cada Ás pode ficar
   * na ponta da sequência do seu naipe ou numa sequência de Ases) e cada curinga
   * pode ir para qualquer sequência (no máximo 1 por sequência).
   * Exemplo: 10♦ J♦ Q♦ K♦ A♦ A♣ A♣ J♣ K♣ + dois 2 dá, entre outras:
   *   [10♦ J♦ Q♦ K♦ A♦] [A♣ A♣ 2] [J♣ 2 K♣]   ou   [10♦ J♦ Q♦ K♦] [A♦ A♣ 2] [J♣ 2 K♣ A♣] ...
   * Não repete opções iguais: cartas iguais (dois A♣) e curingas do mesmo tipo
   * trocados de lugar contam como a mesma opção. Também não oferece separar em duas
   * uma sequência que poderia ficar inteira (ex.: 4♥ 5♥ 6♥ | 7♥ 8♥ 9♥).
   * As opções vêm ordenadas: menos sequências sujas primeiro, depois a maior sequência.
   */
  splitOptions(cards) {
    if (cards.some(isThree)) return [];
    const wilds = cards.filter(isWild);
    const naturals = cards.filter((c) => !isWild(c))
      .sort((a, b) => a.suit.localeCompare(b.suit) || a.rank - b.rank);
    if (!naturals.length) return [];
    const maxGap = wilds.length ? 1 : 0; // cada sequência pode ter no máximo 1 buraco (tapado por 1 curinga)
    const groups = []; // { kind: 'run' (mesmo naipe) | 'aces', suit, cards, gaps }
    const options = [];
    const seen = new Set();
    let budget = 200000; // trava de segurança: seleções enormes não travam a tela

    // A carta "c" pode entrar no grupo "g"? (as cartas chegam em ordem de naipe e valor)
    const gapIfFits = (g, c) => {
      if (g.kind === 'aces') return c.rank === 14 ? 0 : -1;
      if (c.suit !== g.suit) return -1;
      const last = g.cards[g.cards.length - 1];
      if (c.rank === last.rank) return -1; // não repete carta na sequência
      const gap = c.rank - last.rank - 1;
      return gap + g.gaps <= maxGap ? gap : -1;
    };

    const finish = () => {
      if (groups.some((g) => g.cards.length < 2) || wilds.length > groups.length) return;
      for (const melds of this.wildPlacements(groups.map((g) => g.cards), wilds)) {
        // Separar em duas uma sequência que caberia inteira não é uma opção de verdade.
        let mergeable = false;
        for (let i = 0; i < melds.length && !mergeable; i++) {
          for (let j = i + 1; j < melds.length && !mergeable; j++) {
            mergeable = this.analyzeMeld([...melds[i], ...melds[j]]).ok;
          }
        }
        if (mergeable) continue;
        const key = this.splitKey(melds);
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(melds);
      }
    };

    const place = (i) => {
      if (--budget < 0) return;
      if (i === naturals.length) return finish();
      const c = naturals[i];
      // Grupo de 1 carta que não pode mais crescer nunca vai virar sequência: desiste deste caminho.
      // (as próximas cartas têm naipe "maior" ou valor maior, então se esta já está longe, as outras também)
      for (const g of groups) {
        if (g.cards.length >= 2 || g.kind !== 'run') continue;
        const last = g.cards[g.cards.length - 1];
        if (c.suit !== g.suit || c.rank - last.rank - 1 + g.gaps > maxGap) return;
      }
      // Entra num grupo que já existe...
      for (const g of groups) {
        const gap = gapIfFits(g, c);
        if (gap < 0) continue;
        g.cards.push(c);
        g.gaps += gap;
        place(i + 1);
        g.cards.pop();
        g.gaps -= gap;
      }
      // ...ou começa um grupo novo (um Ás começa uma sequência de Ases; os outros, uma sequência do naipe).
      groups.push({ kind: c.rank === 14 ? 'aces' : 'run', suit: c.suit, cards: [c], gaps: 0 });
      place(i + 1);
      groups.pop();
    };
    place(0);

    const dirtyCount = (melds) => melds.filter((m) => this.isDirty(m)).length;
    const longest = (melds) => Math.max(...melds.map((m) => m.length));
    return options.sort((x, y) => dirtyCount(x) - dirtyCount(y) || longest(y) - longest(x));
  },

  // Todas as formas de colocar cada curinga num grupo diferente (no máximo 1 por grupo)
  // em que todos os grupos viram sequências válidas.
  wildPlacements(groups, wilds) {
    const found = [];
    if (!groups.length) return found;
    const chosen = groups.map(() => null);
    const tryFrom = (w) => {
      if (w === wilds.length) {
        const analyzed = groups.map((g, i) => this.analyzeMeld(chosen[i] ? [...g, chosen[i]] : g));
        if (analyzed.every((a) => a.ok)) found.push(analyzed.map((a) => a.ordered));
        return;
      }
      for (let i = 0; i < groups.length; i++) {
        if (chosen[i]) continue;
        chosen[i] = wilds[w];
        tryFrom(w + 1);
        chosen[i] = null;
      }
    };
    tryFrom(0);
    return found;
  },

  // "Impressão digital" de uma separação, para não repetir opções iguais.
  splitKey(melds) {
    // Cartas iguais (ex.: os dois A♣ dos dois baralhos) contam como a mesma carta.
    const cardKey = (c) => (isJoker(c) ? 'JK' : isWild(c) ? 'W2' : `${c.rank}${c.suit}`);
    return melds.map((m) => m.map(cardKey).sort().join(',')).sort().join('|');
  },

  // Uma sequência só, se der; senão tenta separar em várias. Retorna lista de sequências ou null.
  meldsFrom(cards) {
    const options = this.meldOptions(cards);
    return options.length ? options[0] : null;
  },

  // Todas as montagens possíveis: uma sequência só (se der) ou as separações em várias.
  meldOptions(cards) {
    const a = this.analyzeMeld(cards);
    if (a.ok) return [[a.ordered]];
    return this.splitOptions(cards);
  },

  isCanastra(meldCards) {
    return meldCards.length >= this.CANASTRA_SIZE;
  },

  isCleanCanastra(meldCards) {
    return this.isCanastra(meldCards) && !this.isDirty(meldCards);
  },

  hasCleanCanastra(melds) {
    return melds.some((m) => this.isCleanCanastra(m.cards));
  },

  /*
   * Pontuação da rodada de uma dupla (seção 12 do regulamento).
   * handCards = cartas que ficaram na mão dos dois parceiros.
   */
  scoreTeam(team, handCards, wentOut) {
    let clean = 0;
    let dirty = 0;
    let meldCards = 0;
    for (const m of team.melds) {
      meldCards += this.pointsOf(m.cards);
      if (this.isCanastra(m.cards)) {
        if (this.isDirty(m.cards)) dirty++;
        else clean++;
      }
    }
    const canastras = clean * 500 + dirty * 300;
    const bate = wentOut ? 100 : 0;
    const redCount = team.redThrees.length;
    let redThrees = redCount === 4 ? 500 : redCount * 100;
    if (clean + dirty === 0 && redThrees) redThrees = -redThrees; // sem canastra, os 3 vermelhos são negativos
    const hand = this.pointsOf(handCards);
    const total = meldCards + canastras + bate + redThrees - hand;
    return { meldCards, clean, dirty, canastras, bate, redCount, redThrees, hand, total };
  },
};
