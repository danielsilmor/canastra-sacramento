# Inteligência dos bots: arquitetura, decisões e resultados

Este documento explica como os bots da Canastra Sacramento pensam, por que cada escolha técnica foi feita
e o que os testes mostraram. O nível mais forte é o **Mestre** (`js/mestre.js`).

> **Nomes dos níveis.** Durante os testes, o nível mais forte se chamava "Grão-Mestre" e o "Esperto" se chamava
> "Estratégico". Havia também um "Mestre" (o Esperto com memória do lixo), que ficou praticamente empatado com o
> Esperto (+54 ± 55) e foi **removido**; nas tabelas abaixo ele aparece como **Mestre antigo**.
> Níveis atuais: Iniciante, Moderado, Esperto e Mestre.

## Resumo

- O **Mestre** venceu o **Mestre antigo** (o nível mais forte anterior) por **+60 ± 41 pontos por rodada**
  em 1.280 rodadas com as mesmas cartas para os dois: diferença significativa com mais de 99% de confiança
  (cerca de 5% dos pontos de uma rodada). Venceu 53,5% das rodadas contra 46%.
- O ganho vem principalmente de **comparar todas as cartas no descarte** e de **só trocar a jogada das regras
  quando a vantagem é clara**. A inferência pelo comportamento ajuda pouco; a busca nas baixadas não ajudou
  e ficou desligada.
- Ordem de força confirmada: Aleatório < Iniciante < Moderado < Esperto ≤ Mestre antigo < Mestre.
- Contra o **Moderado**, o Mestre fez **+394 ± 78 pontos por rodada** e venceu 69% das rodadas.
- **Regra nova de pegar o lixo** (só no Mestre): compara todos os jeitos em vez de ficar com o primeiro (prefere
  juntar num jogo da mesa e fechar canastra, poupa curinga). **+37 ± 23 pontos por rodada** contra o Mestre sem
  ela, em 3.840 rodadas. Ver 2.9.
- Custo: 0,23 s por jogada em média no jogo (máximo ~0,7 s); o Mestre antigo usa ~0,09 s.

## 1. Análise do projeto

| Arquivo | Papel |
|---|---|
| `js/cards.js` | Baralho (2 baralhos + 2 coringões = 106 cartas), valores, embaralhar. |
| `js/rules.js` | Regras puras: sequência válida, abertura, canastra, pontuação. |
| `js/game.js` | Estado da partida (`Game`) e as ações: comprar, pegar o lixo, baixar, descartar, fim de rodada. Toda ação confere as regras antes de mudar qualquer coisa. |
| `js/ai.js` | Bots Iniciante, Moderado e Esperto; ferramentas comuns (achar sequências, sortear cartas escondidas, simular). |
| `js/mestre.js` | Mestre (módulo independente). |
| `js/arena.js` + `torneio.html` | Ambiente de torneio para medir os bots. |
| `js/ui.js` | Tela. |

**Estado da partida.** Um objeto `Game` guarda mãos, monte, lixo, jogos de cada dupla, 3 vermelhos, placar,
de quem é a vez e a fase (`draw` = precisa comprar, `play` = baixar/descartar). `Game.clone()` faz uma cópia
"quieta" (sem registro nem animação) usada nas simulações.

**Como um bot age.** `AI.turnSteps(game, seat, nível)` é um gerador: decide e chama as mesmas ações que o
jogador humano usa (`drawFromStock`, `applyMelds`, `discard`). Cada `yield` é um ponto em que a tela anima.
O Mestre entra pelo mesmo caminho (`GM.turnSteps`), então tela, testes e torneios funcionam sem mudança.

### Regras da variante (como estão implementadas)

- 4 jogadores em duplas; meta de 5.000 pontos.
- Sequências do mesmo naipe, de 4 até o Ás (3 nunca entra), com pelo menos 3 cartas e **no máximo 1 curinga**;
  sequência de Ases (3+ Ases de qualquer naipe, pode ter 1 curinga).
- Curingas: coringuinha (2) **suja** a sequência; coringão **não suja**.
- Canastra: 7+ cartas. Limpa 500, suja 300.
- Abertura: 80 pontos (120 com a dupla acima de 2.500, "VU") **ou** qualquer canastra.
- Pegar o lixo: o topo + **pelo menos 2 cartas da mão** formando sequência (jogo novo ou encaixado num jogo da dupla); leva o lixo inteiro.
- Lixo travado para o próximo quando o descarte é 3 preto, 2 ou coringão.
- 3 vermelhos: baixados na hora, com reposição; +100 cada (+500 os quatro), negativos se a dupla não fez canastra.
- Primeiro a jogar pode trocar a 1ª compra (exceto 3, 2 ou coringão).
- Bater (+100) só com canastra limpa na dupla; não pode baixar até ficar com 0 ou 1 carta sem ela.
- Fim da rodada: alguém bate ou o monte acaba. Pontos = cartas baixadas + canastras + bate + 3 vermelhos − cartas na mão.

### Ambiguidades (já decididas antes, nada foi mudado para facilitar a IA)

- Curinga na sequência de Ases: permitido (máximo 1).
- Coringão não suja a canastra (decisão do dono do jogo, diferente do PDF original).
- Pegar o lixo exige 2 cartas da mão mesmo para encaixar num jogo existente.
- Caso raro de monte acabando num 3 vermelho com 1 carta na mão: descarta e a rodada termina.

## 2. Arquitetura do Mestre

A inteligência é **híbrida**: regras rápidas e bem testadas (as do Moderado) para gerar alternativas e jogar
as simulações, mais **Monte Carlo com inferência** para escolher entre as alternativas.

```
            ┌─────────────────────────── uma decisão (comprar, baixar ou descartar) ───────────────────────────┐
estado ───► │ gera alternativas ──► sorteia mundos possíveis ──► pesa cada mundo pelo comportamento        │ ──► jogada
            │ (todas as razoáveis)   (cartas escondidas)         dos adversários (inferência)                  │
            │        └──────► joga cada alternativa nos mesmos mundos (todos como Moderado, 8 jogadas)          │
            │                 ──► nota da situação ──► corrida com eliminação ──► escolhe (prefere a regra     │
            │                                                                       se não houver vantagem clara)│
            └───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Interface** (separada da lógica do jogo):

- `GM.chooseDraw(game, seat)` → `{ kind: 'stock' }` ou `{ kind: 'pickup', plan }`
- `GM.chooseMelds(game, seat)` → um jeito de baixar `{ name, label, apply(game, seat) }`
- `GM.chooseDiscard(game, seat)` → a carta
- `GM.turnSteps(game, seat)` → a vez inteira
- `GM.PARAMS` → todos os parâmetros (orçamento, pesos da inferência, partes ligadas/desligadas)

### 2.1 Inferência probabilística (registro de cartas + comportamento)

- **Cartas conhecidas:** a própria mão, todos os jogos da mesa, os 3 vermelhos, o lixo inteiro (memória) e as
  cartas que cada jogador pegou do lixo (`game.publicIn`).
- **Comportamento observado** (`game.observed`, só informação pública):
  - recusou o topo do lixo (comprou do monte com o lixo disponível);
  - descartou uma carta (inclusive a troca da 1ª compra).
- **Mundos possíveis:** as cartas desconhecidas são sorteadas entre as mãos dos outros e o monte, respeitando
  quantidades e o que se sabe (3 vermelhos nunca ficam na mão). Para cada mundo usado, o bot sorteia 3 e
  **pesa** cada um:
  - se nele quem recusou o topo tinha 2 cartas que formavam sequência com o topo: peso × 0,2 (dupla aberta)
    ou × 0,6 (dupla sem abrir: talvez só faltassem pontos);
  - se nele quem descartou uma carta tinha a vizinha dela: peso × 0,75.

  Depois escolhe os mundos na proporção do peso (reamostragem sistemática). Assim os mundos não são tratados
  como igualmente prováveis quando há indícios de comportamento.

### 2.2 Monte Carlo adaptativo

- **Alternativas completas:** compra = monte + os 3 melhores jeitos de pegar o lixo (ver 2.9); descarte = **todas** as cartas
  diferentes da mão (curinga só se não houver outra); baixadas = ver 2.3.
- **Mesmos mundos para todas** (números aleatórios comuns): a comparação é justa e menos barulhenta.
- **Corrida com eliminação:** a cada 8 mundos, as alternativas cuja desvantagem para a líder é maior que
  2 erros-padrão (95%) são eliminadas. As simulações restantes vão para as que estão empatadas.
- **Orçamento adaptativo:** até 160 mundos na compra, 120 nas baixadas, 200 no descarte, multiplicado por 1,5
  em decisões críticas (lixo com 6+ cartas; descarte com o próximo adversário aberto e lixo grande); limite de
  tempo por decisão.
- **Preferência pela regra:** o bot só abandona a escolha das regras do Moderado se a alternativa for melhor por
  pelo menos 1 erro-padrão. Isso evita trocar uma boa jogada por outra que só pareceu melhor por sorte.

### 2.3 Busca nas baixadas (implementada, desligada por padrão)

Compara jeitos de baixar: **pelas regras do Moderado**, **só aumentar os jogos da mesa**, **baixar tudo o que der**
e, sem abrir, a **2ª e a 3ª melhores aberturas**. Jeitos que levam ao mesmo resultado contam uma vez só (poda de
jogadas equivalentes), e nenhum deixa o bot "preso" (menos de 3 cartas sem canastra limpa).

Nos torneios, ligar essa busca **não trouxe ganho mensurável** e deixou cada jogada ~25% mais lenta (seção 3),
então ela fica desligada (`GM.PARAMS.meldSearch = false`) e o Mestre baixa pelas regras do Moderado. O código
continua pronto para quando a avaliação das simulações ficar boa o bastante para separar esses jeitos de baixar.

### 2.4 Avaliação de uma situação

Cada mundo é jogado ~2 voltas à frente (8 vezes, todos como Moderado) e recebe a nota
**pontos da nossa dupla − pontos da outra**, com:

- cartas baixadas, canastras (limpa 500 / suja 300), 3 vermelhos (negativos sem canastra);
- cartas na mão valendo metade (ainda podem ser baixadas);
- bônus para jogos perto de virar canastra (5 cartas +40, 6 cartas +90);
- desconto de 250 por jogador "preso" (1 carta sem canastra limpa): as poucas voltas simuladas não mostram esse
  prejuízo (sem conseguir baixar, pegar o lixo nem bater);
- se a rodada termina na simulação, vale o placar real (inclui o bate e o risco de o adversário bater primeiro).

**Utilidade:** por padrão, pontos. Opcionalmente (`utility: 'vitoria'`), a nota vira a **chance de vencer a
partida** (curva logística sobre a vantagem no placar total), o que deixa o bot mais cauteloso quando está
ganhando e mais arrojado quando está perdendo.

### 2.5 Jogo em dupla

Os jogos baixados são da dupla, então "não descartar o que o parceiro precisa" se resume a **baixar** essas cartas
(o próximo a jogar depois do descarte é sempre um adversário). A cooperação está na avaliação: a nota é sempre da
**dupla** (as duas mãos e os jogos em comum), e as simulações incluem o parceiro jogando, inclusive batendo.
Assim, ajudar o parceiro a bater ou deixar de competir por cartas aparece como vantagem da dupla nas simulações.

### 2.6 Estratégia adaptativa

Não há regras fixas do tipo "se estiver ganhando, faça X": o comportamento muda porque as simulações começam do
estado real. Se o adversário está perto de bater, muitas simulações terminam com o bate dele, e guardar cartas de
valor na mão passa a ter nota ruim. Se o parceiro está perto de bater, as alternativas que deixam a dupla bater
primeiro ganham nota. Com `utility: 'vitoria'`, o placar total da partida também entra.

### 2.7 Desempenho

- Orçamento por decisão (mundos e tempo), ajustável; nos torneios, o mesmo multiplicador vale para todos os bots.
- Poda: cartas iguais contam uma vez; curinga só é candidato se não houver outra carta; jeitos de baixar
  equivalentes contam uma vez; corrida elimina as piores cedo.
- **Sem cache de estados:** cada mundo tem cartas sorteadas diferentes, então estados idênticos praticamente
  não se repetem; um cache gastaria memória sem acertos.
- A lógica do jogo (`game.js`) não sabe nada da inteligência; o Mestre só usa a interface pública.

### 2.8 Preparado para aprendizado

- Todos os números ajustáveis estão em `GM.PARAMS` (e `AI.SIM`/`AI.LEVELS`), em um só lugar.
- `arena.js` joga milhares de rodadas entre bots (self-play), com distribuições duplicadas e estatística, e
  permite ligar/desligar partes (versões "sem inferência", "sem busca de baixadas" etc.).
- Próximos passos possíveis: ajuste automático dos `PARAMS` por torneios (ex.: busca por coordenadas),
  registro das partidas em JSON e uma função de avaliação aprendida a partir desses registros.
- **Aprendizado de máquina não foi usado agora**: com regras ainda mudando, um modelo treinado ficaria
  desatualizado a cada mudança, e a abordagem de busca com inferência é mais barata e mais fácil de explicar
  (o modo depuração mostra o raciocínio).

### 2.9 Pegar o lixo (regra nova, só do Mestre)

**O problema** (visto em partidas e confirmado medindo 240 rodadas do Mestre): ao pegar o lixo, o bot ficava com
o primeiro jeito que achava. Com 6♥ 7♥ 8♥ na mesa, Q♥ no lixo e 9♥ J♥ K♥ A♥ 2♣ na mão, descia J♥ Q♥ K♥ A♥
separado em vez de juntar tudo numa canastra de 9 cartas. Nas 240 rodadas: de 676 lixos que viraram jogo novo
com a dupla aberta, 150 disputavam cartas com outro jogo do mesmo naipe; 18 vezes dava para juntar e desceu
separado (15 delas fechariam canastra); 473 gastaram curinga, 116 deles em jogo fraco (somando todos os lixos
pegos com a dupla aberta, o coringão foi gasto 87 vezes e o coringuinha 418).
Conferidas uma a uma (160 jogadas suspeitas), cerca de 15% eram claramente piores, com perda média de 90 a
130 pontos; o erro mais comum era pegar um lixo pequeno gastando curinga quando comprar do monte era melhor.

**A regra** (`AI.pickupOptions`): lista todos os grupos que pegam o lixo (o topo + 2 ou mais cartas da mão, com no
máximo 1 curinga) e, para cada um, cada jogo da mesa em que encaixa, ou jogo novo. Cada jeito ganha uma nota:

| Situação | Nota |
|---|---|
| juntar num jogo da mesa | +10 |
| fechar canastra (limpa / suja) | +30 / +20 |
| cada carta da mão usada | +0,5 |
| curinga gasto (coringão / coringuinha) | −3 / −2 |
| coringuinha sujando um jogo limpo | −4 |
| jogo novo disputando cartas com outro do mesmo naipe | −8 |
| curinga em jogo novo fraco (pouca chance de canastra) | −4 |

Com a dupla sem abrir, fica com a abertura que gasta menos curingas. Se o lixo é pequeno (até 3 cartas) e o
melhor jeito tem nota negativa, a escolha das regras passa a ser **comprar do monte** (a corrida ainda pega o
lixo se a vantagem for clara). O Mestre compara o monte com os **3 melhores** jeitos.

**Só no Mestre:** a regra (`AI.lixoNovo`) fica ligada enquanto ele pensa e joga, inclusive para os jogadores que ele
imagina nas simulações; nas pausas da tela e na vez dos outros níveis fica desligada. Iniciante, Moderado e
Esperto pegam o lixo como antes. `GM.PARAMS.lixoNovo: false` volta ao jeito antigo (no torneio: "gm-lixo-antigo").

**Resultado:** **+37 ± 23 pontos por rodada** contra o Mestre sem a regra (3.840 rodadas, dois lotes: +19 ± 62 e
+40 ± 25); venceu 52% das rodadas contra 48%, fez um pouco mais de canastras limpas (0,75 contra 0,73 por rodada)
e entregou menos lixo ao adversário (99 contra 113 a cada 100 rodadas). Custa ~7% a mais de tempo por jogada.
No Moderado (só para medir as partes, não foi adotado lá):

| Partes ligadas (Moderado × Moderado) | Rodadas | Diferença por rodada |
|---|---|---|
| todas (juntar + abrir com menos curingas + deixar passar lixo pequeno ruim) | 20.000 | +33 ± 8 |
| juntar + deixar passar lixo pequeno ruim | 16.000 | +29 ± 8 |
| juntar + abrir com menos curingas | 4.000 | +8 ± 10 |
| só juntar | 4.000 | +7 ± 7 |
| só abrir com menos curingas | 16.000 | +2 ± 4 |

A maior parte do ganho vem de **juntar com a nota nova junto com deixar passar o lixo pequeno ruim**; abrir com
menos curingas quase não muda nada.

## 3. Testes e validação

### 3.1 Como foi medido

- **Ambiente:** `js/arena.js` (também em `torneio.html`). Cada distribuição de cartas (sorteada por uma semente)
  é jogada **duas vezes**, com as duplas trocando de lugar: os dois bots recebem exatamente as mesmas cartas e a
  sorte da distribuição se anula. Prova de que funciona: Moderado × Moderado dá **0 ± 0** (bot sem sorteio nas
  decisões joga as duas metades de forma idêntica).
- **Medida principal:** diferença média de pontos por rodada (A − B) com margem de erro de 95%
  (1,96 × desvio-padrão ÷ √distribuições). "Melhor" só quando a margem inteira fica de um lado do zero.
- **Orçamento:** os bots que simulam rodaram com **25%** das simulações do jogo (o mesmo corte para todos), para
  caber no tempo; 8 navegadores sem tela em paralelo.
- **Outras medidas:** rodadas vencidas, bates, cartas na mão no fim, canastras limpas, erros estratégicos
  ("lixo entregue": o próximo pegou um lixo de 5+ cartas com o descarte; "preso": terminou a vez com 1 carta sem
  canastra limpa) e tempo por jogada.

### 3.2 Todos os bots

| Duelo (A × B) | Rodadas | Diferença por rodada (A − B) | Veredito |
|---|---|---|---|
| Iniciante × Aleatório | 4.000 | +390 ± 32 | Iniciante melhor |
| Moderado × Aleatório | 800 | +870 ± 62 | Moderado melhor |
| Moderado × Iniciante | 4.000 | +521 ± 27 | Moderado melhor |
| Esperto × Moderado | 640 | +171 ± 58 | Esperto melhor |
| Mestre antigo × Esperto | 640 | +54 ± 55 | no limite (empate estatístico) |
| **Mestre × Mestre antigo** | **1.280** | **+60 ± 41** | **Mestre melhor** |
| Mestre × Moderado | 400 | +394 ± 78 | Mestre melhor (vence 69% das rodadas) |

Medidas por bot no duelo Mestre × Mestre antigo (média dos dois lotes, 1.280 rodadas):

| Medida | Mestre | Mestre antigo |
|---|---|---|
| Pontos por rodada | 1.191 | 1.130 |
| Rodadas vencidas | 53,5% | 46% |
| Rodadas em que bateu | 28,5% | 27% |
| Canastras limpas por rodada | 0,75 | 0,69 |
| Lixo entregue (a cada 100 rodadas) | 100 | 115 |
| Ficou preso (a cada 100 rodadas) | 1,5 | 2,5 |

Erros estratégicos por nível (a cada 100 rodadas): o Aleatório fica preso 31 a 39 vezes e o Iniciante 123 a 136;
do Moderado em diante, de 1 a 9.

### 3.3 O que cada parte do Mestre vale (testes com uma parte desligada)

Todas contra o Mestre antigo, nas **mesmas 320 distribuições** (640 rodadas cada):

| Versão | Diferença por rodada | Leitura |
|---|---|---|
| com busca nas baixadas | +55 ± 61 | |
| **sem busca nas baixadas (final)** | **+76 ± 57** | a busca não ajuda |
| sem inferência pelo comportamento | +40 ± 64 | a inferência ajuda pouco |
| sem preferência pela regra | +14 ± 59 | **essencial** |
| descarte só entre as 4 melhores da regra | 0 ± 62 | **essencial** |

Em outras 320 distribuições, a versão final fez +44 ± 58 e a versão com busca nas baixadas +82 ± 56: as duas
ficam significativamente acima do Mestre antigo quando os dois lotes são somados (+60 ± 41 e +69 ± 41), e a diferença
entre elas é ruído. A final foi escolhida por ser ~25% mais rápida.

### 3.4 Testes automáticos (`tests.html`)

105 testes, entre eles: duplicação exata do torneio; registro público (recusas e descartes); inferência (pares
para o topo do lixo, peso menor para mundos que contradizem uma recusa); a corrida elimina cedo uma alternativa
claramente pior; o sorteio nunca põe 3 vermelho em mão imaginada; o Mestre joga uma rodada inteira sem
erros e sem sumir carta; a regra nova do lixo (junta no 6♥ 7♥ 8♥ e fecha a canastra, deixa passar lixo pequeno
ruim, abre o jogo pegando o lixo, vale só enquanto o Mestre pensa e o Moderado continua igual); partidas
inteiras com todos os níveis juntos.

## 4. Decisões técnicas e o que foi testado e descartado

| Ideia | Resultado | Decisão |
|---|---|---|
| Regras do Moderado corrigidas a partir de erros vistos em partidas (curinga guardado para fechar canastra, nunca ficar "preso", abertura com menos curingas, chance de canastra, sequências que disputam cartas) | +50 a +140 por rodada em cada etapa | mantidas (base de todos os níveis) |
| Imaginar até o fim da rodada (em vez de 8 jogadas) com nota diferente | −110 por rodada | descartado: as simulações longas acumulam os erros do jogo imaginado |
| "Bot probabilístico": descarte só por contas de probabilidade com pesos definidos à mão | −244 a −289 por rodada | descartado: pesos chutados pioram o jogo |
| Probabilidade + imaginação | empate | descartado (sem ganho) |
| Ajustes de descarte (carta repetida, cartas altas no começo, 3 preto depois) | neutros a levemente negativos (9.000 rodadas) | descartados |
| Mestre: todas as alternativas + corrida com eliminação + preferência pela regra + inferência | **+60 ± 41** | mantido |
| Busca nas baixadas | sem ganho | implementada, desligada |
| Adiar a abertura para pegar um lixo grande (monte com 25+, adversários sem abrir, abertura sem canastra, máx. 2 vezes): rigorosa (lixo 5+, 3 pares na mão) e solta (lixo 3+, 2 pares) | −53 ± 56 e −29 ± 62 (640 rodadas cada); adiou em 4% e 9% das rodadas e, quando adiou, abriu pegando o lixo em cerca de metade das vezes | descartado: não compensa |
| Descer mais cedo (baixar logo as sequências de 3 cartas) | +7 ± 62 (640 rodadas) | descartado (empate) |
| Segurar mais (guardar também as sequências de 4 cartas) | +16 ± 60 (640 rodadas) | descartado (empate) |
| Pegar o lixo pela regra nova: compara todos os jeitos (juntar num jogo da mesa, fechar canastra, poupar curinga, deixar passar lixo pequeno ruim) | **+37 ± 23** contra o Mestre sem ela (3.840 rodadas); no Moderado, +33 ± 8 (20.000 rodadas) | **mantido, só no Mestre** (ver 2.9) |
| **Aprendizado de máquina** | não usado | regras ainda mudando; busca com inferência é mais barata, mede-se bem e explica as decisões |

**Por que "preferir a regra"?** Com poucas centenas de simulações, a média de cada opção tem ruído; escolher
sempre a maior média faz o bot trocar jogadas boas por outras que só pareceram melhores por sorte. Exigir uma
vantagem de pelo menos 1 erro-padrão para sair da escolha das regras foi o que separou o Mestre do empate.

**Por que simular só 8 jogadas?** Nas simulações todos jogam como Moderado; quanto mais longe, mais o jogo
imaginado se afasta do real. Testado: ir até o fim da rodada piorou o bot.

**Quando abrir e quando descer?** O Mestre abre assim que consegue (com a montagem que gasta menos curingas)
e, depois de abrir, guarda só as sequências de 3 cartas. Os testes de abrir mais tarde, descer mais cedo e
segurar mais deram empate ou pior: o jeito atual já está tão bom quanto as alternativas.

## 5. Limitações e oportunidades

- **Ganho moderado:** o Mestre é ~5% melhor que o Mestre antigo porque os dois usam o mesmo "motor" (simulações
  curtas com todos jogando como Moderado e a mesma nota). O próximo salto depende de simulações melhores.
- **Validado com 25% do orçamento.** No jogo ele usa 100%; a vantagem deve ser igual ou maior, mas não foi medida
  diretamente (custaria ~4 vezes mais tempo de torneio).
- **"Jogar pela vitória"** (`utility: 'vitoria'`) está implementado, mas não foi validado: exigiria torneios de
  partidas inteiras até 5.000 pontos, bem mais longos. O padrão é pontos por rodada.
- **Inferência simples:** compara a mão sorteada de hoje com o que o jogador fez antes (ele pode ter recebido
  cartas depois) e usa pesos definidos à mão. Ajuda pouco; pode melhorar com pesos ajustados por torneio.
- **Adversários humanos** jogam diferente do Moderado que o bot imagina nas simulações.
- **Oportunidades:**
  - ajuste automático dos `GM.PARAMS` (a arena já permite: rodar variações e ficar com a melhor);
  - registrar partidas em JSON e aprender uma nota melhor para as situações (regressão sobre self-play);
  - usar um bot mais forte e rápido dentro das simulações;
  - busca dedicada para o fim da rodada (planejar o bate);
  - torneios de partidas inteiras para validar o modo "jogar pela vitória".
