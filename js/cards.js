/*
 * cards.js: O baralho
 *
 * Aqui ficam as definições básicas das cartas:
 * - como cada carta é representada no código;
 * - como montar os 2 baralhos + 2 coringões (106 cartas);
 * - quanto vale cada carta;
 * - como embaralhar e organizar a mão.
 *
 * Cada carta é um objeto simples, por exemplo: { id: 7, rank: 9, suit: 'H' }
 *   rank (valor): 2 a 10, 11 = Valete (J), 12 = Dama (Q), 13 = Rei (K), 14 = Ás (A), 99 = Coringão
 *   suit (naipe): 'S' espadas ♠, 'H' copas ♥, 'C' paus ♣, 'D' ouros ♦, 'X' coringão
 */

// Ordem dos naipes ao organizar a mão (alterna preto e vermelho para facilitar a leitura).
const SUITS = ['S', 'H', 'C', 'D'];
const SUIT_SYMBOL = { S: '♠', H: '♥', C: '♣', D: '♦', X: '★' };
const JOKER_RANK = 99;
const RANK_LABEL = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 99: 'JK',
};

// Monta as 106 cartas: dois baralhos de 52 + dois coringões.
function createDeck() {
  const cards = [];
  let id = 1;
  for (let deck = 0; deck < 2; deck++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) cards.push({ id: id++, rank, suit });
    }
    cards.push({ id: id++, rank: JOKER_RANK, suit: 'X' });
  }
  return cards;
}

// Embaralha (algoritmo de Fisher-Yates: troca cada carta com outra aleatória).
function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Perguntas rápidas sobre uma carta.
const isJoker = (c) => c.rank === JOKER_RANK;
const isWild = (c) => c.rank === 2 || isJoker(c); // curinga = coringão ou coringuinha (2)
const isDirtyWild = (c) => c.rank === 2;           // só o coringuinha (2) deixa a sequência suja
const isLockingCard = (c) => isBlackThree(c) || isWild(c); // descartada, trava o lixo para o próximo
const isRedSuit = (c) => c.suit === 'H' || c.suit === 'D';
const isThree = (c) => c.rank === 3;
const isRedThree = (c) => c.rank === 3 && isRedSuit(c);
const isBlackThree = (c) => c.rank === 3 && !isRedSuit(c);

// Valor de cada carta, conforme a tabela do regulamento (seção 2).
function cardValue(c) {
  if (isJoker(c)) return 20;
  if (c.rank === 2) return 10;
  if (c.rank === 3) return isRedSuit(c) ? 100 : 5;
  if (c.rank <= 7) return 5;
  if (c.rank <= 13) return 10;
  return 15; // Ás
}

// Nome curto da carta para mensagens, ex.: "7♥", "A♠", "Coringão".
function cardName(c) {
  if (isJoker(c)) return 'Coringão';
  return RANK_LABEL[c.rank] + SUIT_SYMBOL[c.suit];
}

// Organiza a mão: por naipe e valor; depois os 3 pretos; por último os curingas.
function sortHand(cards) {
  const group = (c) => (isWild(c) ? 2 : isThree(c) ? 1 : 0);
  return [...cards].sort((a, b) =>
    group(a) - group(b) ||
    SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) ||
    a.rank - b.rank ||
    a.id - b.id
  );
}
