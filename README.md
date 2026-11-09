# Canastra Sacramento: versão de teste (MVP)

Jogo de Canastra no navegador, seguindo o regulamento da modalidade personalizada.
Você joga em dupla com um bot (computador) contra outros dois bots. Os bots são personagens com foto, sorteados entre 16 a cada vez que a página abre ou é atualizada; "Nova partida" mantém os mesmos personagens.

## Jogar online

O jogo está publicado em **https://danielsilmor.github.io/canastra-sacramento/**
(abre no computador e no celular, sem instalar nada). Cada pessoa joga sozinha contra os bots, no próprio navegador.

O código fica em https://github.com/danielsilmor/canastra-sacramento (público).
A pasta `_material` (imagens de referência e anotações) **não** vai para a internet: ela está listada no arquivo `.gitignore`.

### Como publicar uma mudança

Depois de alterar os arquivos, rode no terminal, dentro da pasta do jogo:

```
git add -A
git commit -m "Descreva aqui o que mudou"
git push
```

Em cerca de 1 minuto o site se atualiza sozinho.

## Do que você precisa

**Só de um navegador** (Google Chrome ou Microsoft Edge). Não é preciso instalar nada.

Opcional, para quem quiser mexer no código:
- **Visual Studio Code** (gratuito): editor para abrir e alterar os arquivos (https://code.visualstudio.com)
- **Git** (já está instalado neste computador): guarda o histórico de versões do projeto.

## Como jogar

1. Abra a pasta `Canastra Sacramento`.
2. Dê dois cliques em **`index.html`**. O jogo abre no navegador e a primeira rodada começa sozinha.

Na sua vez:
1. **Comprar:** clique no **monte** (ou arraste o monte para a sua mão, ou use o botão "Comprar do monte").
   Para **pegar o lixo**: selecione 2 ou mais cartas da mão que formem sequência com a carta do topo e clique no lixo (ou no botão "Pegar lixo"). Se essas cartas encaixarem num jogo que a dupla já tem, elas vão para esse jogo; para escolher o jogo, clique nele (ou arraste o lixo até ele). Também dá para arrastar o lixo para a mão depois de selecionar as cartas.
2. **Baixar (opcional):** clique nas cartas para selecioná-las (elas sobem e ganham borda vermelha) e depois:
   - clique no painel **"Nós"** (ou arraste as cartas até ele) para baixar uma sequência nova;
   - clique num **jogo já baixado** (ou arraste as cartas até ele) para acrescentar.
   O botão "Baixar sequência" continua funcionando.
   **Várias sequências de uma vez:** selecione todas as cartas juntas (inclusive ao pegar o lixo). O jogo separa sozinho em sequências por naipe e coloca cada curinga onde ele faz falta, no máximo 1 por sequência. Exemplo: 10♠ do lixo + 8♠ 2♠ 8♣ 9♣ J♣ Q♣ 2♦ da mão viram **8♠ 2♠ 10♠** e **8♣ 9♣ 2♦ J♣ Q♣**.
3. **Descartar:** selecione 1 carta e clique no **lixo** (ou arraste a carta até o lixo, ou use o botão "Descartar").

Só dá para selecionar e mexer nas cartas na sua vez. Se tentar fora de hora, aparece um aviso explicando o motivo
(por exemplo, "Ainda não é a sua vez" ou "Primeiro compre uma carta").

Enquanto a dupla não abriu, as sequências ficam "separadas" num quadro amarelo tracejado até somarem os 80 pontos
(120 se a dupla estiver VU) **ou até um dos jogos virar canastra** (7 cartas, limpa ou suja): a canastra já vale mais
que o mínimo, então abre o jogo sozinha, mesmo somando menos de 80 em cartas. Aí a abertura é feita automaticamente. Dentro do quadro amarelo dá para remanejar:
- **Acrescentar cartas:** selecione cartas da mão (pode ser só 1, como um 7 ou um coringuinha) e clique num jogo do quadro amarelo (ou arraste as cartas até ele).
- **Sequência nova:** com 3 ou mais cartas selecionadas, clique no quadro amarelo fora dos jogos ou no painel "Nós".
- **Desfazer um jogo:** o botão "Desfazer" embaixo de cada jogo devolve as cartas para a mão. Se o jogo tiver a carta do lixo, ela continua no lixo e você volta a escolher: comprar do monte ou pegar o lixo de novo (os outros jogos separados continuam no quadro).
- **Devolver uma carta só:** sem nenhuma carta selecionada, clique numa carta de um jogo do quadro amarelo para ela voltar para a mão (se o jogo continuar válido sem ela).
- **Cancelar abertura** devolve tudo de uma vez.

**Escolher como montar:** quando as cartas selecionadas podem ser montadas de mais de um jeito, ao baixar ou pegar o lixo
aparece a janela **"Como você quer montar?"** com **todas** as montagens possíveis desenhadas. Muda onde fica cada curinga
(contorno amarelo) e cada carta: por exemplo, um Ás pode ficar na ponta da sequência do seu naipe (10♦ J♦ Q♦ K♦ A♦)
ou numa sequência de Ases (A♦ A♣ A♣). Cada jogo mostra se fica limpo ou sujo. Clique na opção que quiser.
O jogo não oferece quebrar à toa uma sequência que caberia inteira.

O botão **Regras** mostra um resumo das regras.

### Acompanhando as jogadas

- As cartas são **animadas**: distribuição, compra, descarte, baixar sequências e pegar o lixo.
- Na coluna da esquerda fica o **histórico**. A setinha ▲ esconde o histórico, e a setinha ▼ mostra de novo.
- Abaixo do histórico fica o **quadro da jogada**, que diz de quem é a vez, narra cada jogada e tem o botão **Continuar**.
- No ritmo **Passo a passo** (padrão), cada computador faz a jogada completa (comprar, baixar e descartar, tudo animado) e depois espera você clicar em **Continuar** (ou apertar Enter). O quadro mostra o resumo de tudo o que ele fez.
- No alto da mesa ficam os 4 jogadores **na ordem em que jogam** (você, adversário, parceiro e adversário), cada um com a foto do personagem (nos bots), com uma pilha de cartas (mais grossa quanto mais cartas tiver) e o número exato. O "D" indica o carteador.
- O jogador da vez fica com contorno amarelo e a etiqueta "jogando". Na sua vez, o contorno e a etiqueta ficam verdes.
- As cartas da última jogada ficam com **brilho amarelo**. Cartas com **pontinho laranja** são curingas (2 e coringão).
- Na **engrenagem** (⚙, no topo) ficam as configurações: o **ritmo do jogo** (passo a passo ou automático lento, normal ou rápido, sem confirmações) e a **inteligência de cada bot**, além do **tamanho das cartas**, que pode ser escolhido separadamente para os jogos na mesa (inclui a área de abertura), a sua mão e o monte/lixo, em 5 tamanhos (de "Muito pequeno" a "Muito grande"). Cada tamanho é igual em todas as áreas; por padrão, as cartas da mesa são "Pequeno" e as da mão e do monte/lixo são "Grande". As escolhas ficam guardadas num **cookie** do navegador (ao abrir o `index.html` direto do computador, ficam no armazenamento local), e o botão **"Restaurar padrão"** volta tudo ao início.

### Inteligência dos bots

Cada bot pode ter um nível diferente. O nível aparece no quadro do jogador, ao lado do papel (por exemplo, "adversário · Mestre"). A mudança vale a partir da próxima jogada do bot.

| Nível | Como joga |
|---|---|
| **Iniciante** | Bom senso, mas comete erros de propósito: às vezes não pega o lixo, demora para baixar ou descarta uma carta útil. |
| **Moderado** (padrão) | Abre o jogo gastando o mínimo de curingas: compara várias montagens (por exemplo, juntando os Ases numa sequência de Ases em vez de pôr um Ás na ponta de Q K A). Conta as cartas já presas em jogos na mesa para saber até onde cada jogo ainda pode crescer: não põe curinga em jogo com pouca chance de virar canastra, e uma carta que encaixa em dois jogos vai para o mais promissor. Não baixa uma sequência que vai disputar cartas com outra do mesmo naipe já na mesa (ex.: com 9♥ 10♥ J♥ Q♥ na mesa, guarda 4♥ 5♥ 6♥ na mão até chegarem 7♥ e 8♥). Prefere aumentar os jogos da mesa a baixar várias sequências pequenas (guarda trincas na mão para pegar o lixo). Guarda o coringão para fechar canastra com 6 cartas (em vez de pegar o lixo ou começar jogo novo com ele). Só fecha canastra com coringuinha se a dupla já tem uma limpa ou o monte está no fim, porque sem canastra limpa não dá para bater. Não fica com menos de 3 cartas na mão sem canastra limpa (senão fica "preso", sem conseguir baixar nem pegar o lixo). Descarta cartas baixas e só solta o Ás em último caso. Esperto e Mestre seguem essas mesmas regras ao baixar. |
| **Esperto** | Antes de comprar e de descartar, imagina dezenas de continuações da rodada para cada opção (sorteando as cartas que não vê) e escolhe a que rende mais pontos. Do lixo, só conhece a carta de cima. |
| **Mestre** | O mais forte. Decora o lixo inteiro e as cartas que cada jogador pegou dele; deduz as cartas dos adversários pelo que eles fazem (quem recusa um lixo provavelmente não tinha par para ele; quem descarta uma carta provavelmente não tinha as vizinhas dela); compara **todas** as cartas no descarte e vários jeitos de pegar o lixo; elimina cedo as opções claramente piores e só troca a jogada das regras quando a vantagem é clara. Pensa cerca de 0,25 segundo por jogada. Nos torneios, venceu o Moderado por +394 pontos por rodada. |

Os níveis "Estratégico" e "Grão-Mestre" de versões anteriores agora se chamam **Esperto** e **Mestre**. O antigo
"Mestre" (Estratégico com memória) foi removido: nos torneios ele ficou praticamente empatado com o Estratégico.
Configurações salvas com os nomes antigos são convertidas sozinhas.

Nenhum bot trapaceia: nenhum vê a sua mão, a mão dos outros ou a ordem do monte.
A arquitetura, as decisões técnicas e os resultados dos testes estão em **[IA.md](IA.md)**.

### Torneio de bots

Abra **`torneio.html`** para comparar dois bots: escolha os dois, o número de distribuições e o orçamento das
simulações, e clique em "Rodar torneio". Cada distribuição de cartas é jogada duas vezes, com as duplas trocando
de lugar, para a sorte se anular. O resultado mostra a diferença de pontos por rodada com a margem de erro (95%),
o veredito ("melhor" ou "empate estatístico") e medidas de cada bot: rodadas vencidas, bates, cartas na mão no fim,
canastras limpas, erros estratégicos e tempo por jogada.

### Modo depuração

Na engrenagem, em **Depuração**, há duas opções (desligadas por padrão):
- **Explicar as decisões dos bots:** cada jogada de bot ganha um **"Por quê?"** no quadro da jogada e no histórico, com o motivo de cada decisão: por que comprou do monte ou pegou o lixo, como abriu, por que guardou ou baixou uma sequência, onde pôs o curinga e por que descartou aquela carta (com as próximas opções). Nos níveis Esperto e Mestre aparece também o resultado médio das jogadas que ele imaginou para cada opção (no Mestre, também quantas opções ele eliminou cedo e quanto a inferência aproveitou dos mundos sorteados).
- **Mostrar as cartas dos bots:** as mãos dos bots aparecem viradas para cima no quadro de cada um, para conferir se as decisões fazem sentido.

As explicações usam só o que o bot sabe de verdade; mostrar as cartas é só para você estudar as jogadas.
- O visual usa a fonte Inter, que vem da internet. Sem internet, o jogo funciona normalmente com a fonte do sistema.

## Decisões tomadas onde o regulamento não era explícito

- **Só o coringuinha (2) deixa a sequência suja.** Sequência ou canastra com coringão continua **limpa** (500). Esta regra muda o que está escrito no PDF, que considera suja a sequência com qualquer curinga.
- **Coringuinha (2) e coringão também travam o lixo**: descartados, o próximo jogador não pode pegar o lixo, igual ao 3 preto.
- Na 1ª compra da rodada, a carta recusada **vai para o lixo**. Para trocar, clique em "Trocar carta" ou jogue a carta comprada no lixo (arrastando ou clicando nele): o jogo pergunta se você quer trocar e comprar outra ou descartar e passar a vez. Se a carta comprada for um **3** (preto ou vermelho) ou um curinga (**coringuinha (2)** ou **coringão**), não dá para trocar.
- Para pegar o lixo, a carta do topo e **pelo menos 2 cartas da mão** precisam formar uma sequência entre si. Esse trio pode virar um **jogo novo** ou ser **encaixado num jogo que a dupla já baixou** (por exemplo: jogo 4♠ 5♠ 6♠ na mesa, topo 7♠, mão 8♠ 9♠ → o jogo vira 4♠ a 9♠). Não vale encaixar só o topo, sem as 2 cartas da mão. Vale para você e para os computadores.
- O curinga também pode entrar na sequência de Ases (máximo de 1 por sequência).
- O curinga numa sequência se ajusta sozinho: ele tapa o buraco ou vai para a ponta.
- Caso raro: se o monte acabar num 3 vermelho e o jogador ficar com só 1 carta sem poder bater, ele descarta e a rodada termina pelo fim do monte (sem bônus de bate).

## Como o projeto está organizado

| Arquivo | O que faz |
|---|---|
| `index.html` | A página do jogo (a mesa). É o arquivo que você abre. |
| `css/style.css` | O visual: mesa verde, cartas, botões. |
| `js/cards.js` | O baralho: as 106 cartas, valores, embaralhar. |
| `js/rules.js` | As regras: o que é sequência válida, abertura, canastra, pontuação. |
| `js/game.js` | A partida: distribuição, vez de cada um, compra, lixo, descarte, fim da rodada, placar. |
| `js/ai.js` | Como os bots jogam: Iniciante, Moderado e Esperto, e as ferramentas de simulação. |
| `js/mestre.js` | O Mestre (módulo independente): inferência, Monte Carlo adaptativo e decisões. |
| `js/arena.js` | Torneios entre bots: partidas duplicadas, medidas e estatística. |
| `js/ui.js` | Desenha a mesa e responde aos seus cliques. |
| `torneio.html` | Página para rodar torneios entre bots. |
| `tests.html` | Testes automáticos: abra no navegador para conferir as regras e os bots (✅/❌). Também simula partidas só com computadores. |
| `IA.md` | Como os bots pensam: arquitetura, decisões técnicas, resultados e limitações. |

## Próximos passos possíveis

- Ajustar regras depois de testar a dinâmica.
- Animações e sons.
- Multijogador (várias pessoas, cada uma no seu computador). Isso exigirá um servidor e a instalação do Node.js.
