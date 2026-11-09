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
   * Exemplo: K♥ A♥ Q♦ K♦ + coringão + 2♥ dá 2 opções:
   *   [K♥ A♥ coringão] e [Q♦ K♦ 2♥]   ou   [K♥ A♥ 2♥] e [Q♦ K♦ coringão]
   * Curingas do mesmo tipo (dois 2 de naipes diferentes) contam como iguais,
   * porque trocá-los de lugar não muda nada no jogo.
   */
  splitOptions(cards) {
    if (cards.some(isThree)) return [];
    const wilds = cards.filter(isWild);
    const naturals = cards.filter((c) => !isWild(c));
    const options = [];
    const seen = new Set();
    // Ases junto com o naipe (ex.: Q K A) ou Ases num grupo próprio.
    for (const acesApart of [false, true]) {
      const groups = new Map();
      for (const c of naturals) {
        const key = acesApart && c.rank === 14 ? 'A' : c.suit;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      for (const melds of this.wildPlacements([...groups.values()], wilds)) {
        const key = this.splitKey(melds);
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(melds);
      }
    }
    return options;
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
    const cardKey = (c) => (isJoker(c) ? 'JK' : isWild(c) ? 'W2' : String(c.id));
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
