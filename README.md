# Cofre

App de finanças pessoais do Maia, no estilo Minhas Economias. HTML/JS estático, sem build step.

## Rodar

Abrir `index.html` no browser. Só isso.

## Estado atual (v1 local)

- Dado salvo em **localStorage** (só neste aparelho). A migração pra Supabase acontece em `store.js`, que isola toda a camada de dados.
- Primeiro load cria dado de exemplo (seed em `store.js`). Pra zerar: DevTools → Application → Local Storage → apagar a chave `cofre.v1`.

## Arquivos

- `index.html` - shell + modais (form de transação, dialog de escopo)
- `style.css` - visual (tokens no `:root`)
- `store.js` - camada de dados: CRUD, séries (parcelamento/recorrente), persistência. Valores em **centavos**.
- `app.js` - UI: render das 3 views (Transações/Contas/Categorias), saldos, eventos

## Regras de negócio

- **Tipos**: despesa, receita, transferência (origem → destino, efeito zero no total geral).
- **Parcelamento mensal (N)**: cria N linhas, uma por mês, rótulo (k/N). Dia clampado (31 → 30/28).
- **Recorrente indefinido**: materializa linhas até mês atual + 24; estende sozinho a cada load (`ensureRecurringHorizon`).
- **Cada linha é individual no seu mês.** Editar/excluir linha de série pergunta: "Só esta" ou "Esta e as futuras". Futuras: propaga valores; a data propaga só o dia do mês; `consolidada` nunca propaga.
- **Mês anterior ao atual = somente leitura** (sem editar, criar ou consolidar).
- **Saldo do dia** = saldo anterior (se o toggle estiver ligado) + acumulado do mês até o dia.
- **Fim do mês**: resultado do mês (receitas − despesas) + saldo acumulado (carry + resultado, sempre exibido).
- **Saldo atual por conta** = saldo inicial + transações com data ≤ hoje.
- Deep-link de mês via hash: `index.html#2026-10`.

## Testes

`test-store.js` (harness Node da lógica do store) roda com `node test-store.js`. 14 checks: parcelas, horizonte, clamp de dia, edição/exclusão forward, encadeamento de saldo.

## Próximos passos

1. Supabase (schema + sync no `store.js`) - esperando conta
2. Senha simples na entrada
3. Deploy GitHub Pages + PWA (manifest, ícone, instalar na home do cel)
