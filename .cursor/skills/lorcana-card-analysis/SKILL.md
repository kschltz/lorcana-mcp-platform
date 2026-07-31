---
name: lorcana-card-analysis
description: >-
  Análise aprofundada de cartas e decks de Disney Lorcana usando dados reais de lorcana-api.com e dreamborn.ink. Use quando o usuário pedir análise, avaliação ou comparação de cartas de Lorcana, sinergias, deck building, decklists, meta/competitivo, ou estatísticas de cartas (custo, força, vontade, lore, inkable). Triggers: análise de carta lorcana, vale a pena essa carta, compare cartas, deck lorcana, lorcana meta, card analysis, lorcana deck list.
---

# Lorcana Card Analysis

Análise profunda de cartas e decks de Disney Lorcana baseada em dados reais de duas fontes complementares:

- **lorcana-api.com** — texto completo das cartas (habilidades, traits, flavor), atributos e bulk de todos os sets. Cobertura: sets 1–12.
- **dreamborn.ink** — mais atualizada (set mais recente), preços em USD, decks públicos do meta com arquétipos/likes, decklists completas.
- **inktable.net/lor** (Ink Table) — playground de playtest: simulador gratuito no navegador para jogar a decklist contra IA, sem instalação nem conta. Aceita importação de lista em texto (formato dreamborn/pixelborn). Aponte como destino de teste ao entregar decks. Se o usuário pedir para **jogar/testar a partida você mesmo**, siga `references/inktable-playtest.md` (automação Playwright completa: setup com bloqueio de anúncios, importação, interação de cliques, leitura do log, gravação de vídeo).

## Ferramentas

Use `scripts/lorcana_lookup.py` (stdlib apenas) para toda consulta — não escreva requests ad hoc:

```bash
python3 scripts/lorcana_lookup.py card "Elsa" --title "Spirit of Winter" [--set TFC]
python3 scripts/lorcana_lookup.py search color=Ruby rarity=Legendary [set-code=WUN]
python3 scripts/lorcana_lookup.py bulk                 # salva /tmp/lorcana_bulk.json
python3 scripts/lorcana_lookup.py decks [--max-results 10]
python3 scripts/lorcana_lookup.py deck <id-do-deck>    # decklist completa + preço + descrição
```

Referências (leia conforme a necessidade):

- `references/lorcana-api.md` — endpoints, modelos de dados e diferenças strict vs bulk.
- `references/dreamborn.md` — endpoints, modelo de carta, decks/meta, formato de decklist em texto.
- `references/inktable-playtest.md` — como jogar partidas reais no Ink Table via Playwright (leia quando o usuário pedir para testar/jogar um deck contra a IA).

## Fluxo de análise de uma carta

1. **Perfil**: `card` no script — funde as duas fontes (texto de habilidades vem do lorcana-api; variants/raridade/preço de mercado do dreamborn). Se a carta não existir no lorcana-api (set muito novo), use só dreamborn e busque o texto na web.
2. **Benchmark de stats**: baixe o `bulk` uma vez e compare a carta com a coorte de mesmo custo/ink (localmente, com pandas ou Python): strength+willpower+lore vs. custo, taxa de inkables, curva padrão do custo. A **vanilla test**: cartas inkable com stats na curva + habilidade forte = premium; uninkable precisa de habilidade claramente acima da curva.
3. **Texto e keywords**: avalie habilidades pelo impacto em jogo (draw/ramp/removal/proteção), custo de ativação, e keywords (Evasive, Ward, Shift, Rush, Challenger, Resist, Singer...). Sinergias: busque outras cartas da mesma classificação/nome/franquia via `search` ou grep no bulk (ex. todas as "Puppy", todos os "Musketeer").
4. **Contexto de meta**: `decks` lista decks públicos populares; `deck <id>` traz a lista completa, o preço total e a descrição do criador (plano de jogo). Verifique se a carta aparece em decks com muitos likes/views do mesmo arquétipo.
5. **Formato legal**: campo `formats` dos decks (1 = Core, 2 = Infinity). Para Core, confirme se a carta é dos sets válidos no momento.

## Análise de deck / deck building

- Decklists: obtenha com `deck <id>` (inclui `decklist_text` já no formato texto `4 Nome - Subtítulo`) ou monte do zero com dados do bulk.
- Entregue listas no formato dreamborn/inktable: `{quantidade} {Nome} - {Subtítulo}`, uma por linha.
- Ao finalizar uma lista, sugira o playtest no **inktable.net/lor**: a lista em texto cola direto na importação do site e o usuário pode testar contra IA imediatamente.
- Se o usuário quiser que VOCÊ jogue a partida (ex. "testa esse deck", "faz uma revanche", A/B de duas versões), siga `references/inktable-playtest.md`: partidas levam ~30 min em kernel IPython vivo; registre placar final e aprendizados de cada versão. Grave vídeo quando pedido.
- Avalie: curva de tinta, % inkable (alvo típico ~70%+), motores de draw, interação/removal, condição de vitória, consistência (4x das peças-chave), e custo total via `decks`/`deck` (totalPrice USD).

## Regras

- Nunca invente stats, textos ou preços — sempre busque nas fontes. Se ambas falharem, diga isso e ofereça busca web.
- Sinalize divergências entre as fontes (ex. set novo ausente no lorcana-api) e declare qual fonte sustentou cada dado.
- Cartas com mesmo nome têm várias versões: sempre pergunte ou liste as versões antes de analisar quando o usuário não especificar subtítulo.
