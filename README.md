# maiaeconomias

App de finanças pessoais do Maia, estilo Minhas Economias. HTML/JS estático, sem build step. Dado no Supabase, sincroniza cel/PC. Instalável como app (PWA).

**No ar:** https://atahualpamaia10.github.io/maia-personal/

## Como funciona

- **Frontend**: HTML/CSS/JS puro, servido pelo GitHub Pages. Sem framework, sem build.
- **Backend**: Supabase (Postgres + Auth). Toda a camada de dados fica isolada no `store.js`.
- **Login**: Supabase Auth (email + senha), **multiusuário**. Cada usuário só vê os próprios dados (RLS por `user_id`). A publishable key exposta no browser não lê nem escreve nada sem sessão. Novo usuário = espaço vazio e isolado.
- **Sync**: escrita otimista (atualiza a tela na hora, empurra pro Supabase em background; se falhar, avisa e recarrega). Puxar pra baixo ou voltar pro app recarrega do servidor.
- **PWA**: `manifest.webmanifest` + `sw.js` (service worker network-first: sempre pega a versão nova online, cache só como fallback offline).
- Valores monetários sempre em **centavos** (inteiros).

## Arquivos

- `index.html` — shell + modais (transação, escopo de série, conta, prompt, confirmação, login)
- `style.css` — visual, tokens no `:root`, tema verde/dourado, dark mode automático
- `config.js` — URL + publishable key do Supabase (pública por design; vai pro repo)
- `store.js` — camada de dados: auth, CRUD, séries, sync com Supabase
- `app.js` — UI: 3 views (Transações/Contas/Categorias), saldos, eventos, pull-to-refresh
- `schema.sql` — schema inicial do banco (tabelas + RLS)
- `migration-multiuser.sql` — migração que separou o dado por usuário (`user_id` + RLS por dono); já aplicada
- `manifest.webmanifest`, `sw.js`, `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — PWA
- `.env` — credenciais locais (gitignored, não sobe)
- `test-store.js` — **obsoleto**: testava a lógica em localStorage no Node. Não roda mais (o store agora depende do SDK do Supabase no browser).

## Regras de negócio

- **Tipos**: despesa, receita, transferência.
- **Seletor de conta**: no topo da aba Transações, cada conta é um chip com checkbox. Tudo (lista, saldo do dia, saldo do mês anterior, resultado do mês) filtra pelas contas marcadas. Marca várias = soma. Sem card de "total geral".
- **Transferência**: aparece só a perna da conta em vista — débito (−) na origem, crédito (+) no destino. Marcando as duas contas, aparecem as duas linhas (efeito zero no saldo somado).
- **Parcelamento mensal (N)**: cria N linhas, uma por mês, rótulo (k/N). Dia clampado (31 → 30/28).
- **Recorrente indefinido**: materializa linhas até mês atual + 24; estende sozinho a cada load.
- **Cada linha é individual no seu mês.** Editar/excluir linha de série pergunta: "Só esta" ou "Esta e as futuras".
- **Mês anterior ao atual = somente leitura.**
- **Saldo atual da conta** = saldo inicial + transações com data ≤ hoje.
- **Fim do mês**: resultado (receitas − despesas das contas marcadas) + saldo acumulado.
- Deep-link de mês via hash: `#2026-10`.

## Operar

### Mexer no app e publicar
Edita os arquivos e dá push. O GitHub Pages atualiza sozinho em ~1-2 min:
```
git add -A && git commit -m "..." && git push
```
Se mudar CSS/JS, subir a versão do cache no `sw.js` (`CACHE = 'maiaeconomias-vN'`) ajuda a forçar a troca.

### Supabase
- Painel → SQL Editor pra rodar/alterar schema (`schema.sql`).
- Painel → Authentication → Users pra o usuário do login.
- Chaves: Project Settings → API Keys. A publishable fica no `config.js`; a secret só no `.env` local (tarefas administrativas), nunca no repo.

### Instalar no cel
Abrir a URL no Safari/Chrome → compartilhar/menu → "Adicionar à Tela de Início". Login uma vez; a sessão fica salva.

## Pendências / notas

- No `.env`, a linha `SUPABASE_SECRET_KEY` ainda está com a publishable duplicada. Só é usada em tarefa administrativa local; corrigir pra `sb_secret_...` quando precisar.
- Seleção de contas não persiste entre reloads (volta pra todas). Fácil de guardar depois, se quiser.
- Autofill de senha no iOS: salvar primeiro via Safari (navegador); o app instalado passa a sugerir do Keychain.
