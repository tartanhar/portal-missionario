# Portal do Missionário — Etapa 2

Projeto **independente**, para ambiente de testes. Não substitui nem modifica o Mensagens Missionárias atual.

## O que funciona

- Login individual para administrador e missionários.
- Administrador cadastra missionários, cria senha provisória, redefine senha e ativa/desativa contas.
- Troca obrigatória da senha no primeiro login, inclusive para o administrador inicial.
- Senhas protegidas por bcrypt; sessões persistidas no PostgreSQL; cookie HTTP-only, proteção CSRF e limitação de tentativas de login.
- Cada missionário entra em sua própria conta. **Ainda não há mensagens reais no portal.**

## O que NÃO está implementado

- Integração com o banco/compilações do WhatsApp, envio de respostas por e-mail, recuperação automática de senha por e-mail e notificações. Esses itens são etapas futuras.
- Ainda não há dados reais para consultar, nem integração com o sistema em produção.

## Instalação e teste

1. Crie um **novo serviço** Node.js no Render, separado do serviço atual.
2. Crie um **banco PostgreSQL separado**, exclusivamente para o portal de testes. Não use a URL do banco de produção.
3. Coloque estes arquivos em um repositório de testes separado (não substitua o projeto principal).
4. Configure as variáveis de ambiente mostradas em `.env.example` no serviço de testes. Nunca compartilhe credenciais ou publique `.env`.
5. Build Command: `npm install`; Start Command: `npm start`.
6. Abra a URL HTTPS do serviço de testes. Entre com `PORTAL_ADMIN_EMAIL` e `PORTAL_ADMIN_PASSWORD`.
7. Troque a senha inicial, abra **Missionários** e cadastre uma conta de teste.
8. Saia e entre como missionário; confira a exigência de troca de senha.

**Observações:** a conta administrativa é criada somente se ainda não existir administrador. Alterar `PORTAL_ADMIN_PASSWORD` depois não redefine a senha existente. Para testes locais, defina as variáveis de ambiente no terminal antes de executar `npm install` e `npm start`. O app requer Node.js 20+.

**Segurança:** mantenha o serviço de testes privado, sem dados reais, até revisão de segurança e testes de integração. O botão "Redefinir senha" pede uma senha provisória digitada pelo administrador; transmita-a por canal seguro. A recuperação automática por e-mail será feita futuramente.


## Integração de leitura com Mensagens Missionárias

- Usa a mesma conexão Neon via `PORTAL_DATABASE_URL`.
- Consulta `public.missionarios` e `public.mensagens_missionarios` **somente para leitura**.
- Mostra apenas registros com `status='ENVIADA'` e `enviado_em` preenchido.
- O e-mail da conta do portal deve ser **idêntico** ao e-mail do missionário no painel principal. Se houver zero ou mais de um cadastro principal com esse e-mail, o portal não mostra mensagens.
- Respostas abrem o aplicativo de e-mail do missionário usando `mailto:`. **Não são enviadas automaticamente pelo servidor.**
- O histórico agrupa mensagens por dia de envio (não há ID de compilação no banco principal).
- O envio por Resend, a liberação manual e os dados do sistema principal não são modificados.
- Antes do deploy, certifique-se de que o `SESSION_SECRET` tenha ao menos 32 caracteres.
- A conta Neon compartilhada ainda tem permissões de banco; o isolamento do portal é realizado pelas consultas da aplicação, não por uma role PostgreSQL de leitura restrita.


## Respostas dentro do portal
Configure RESEND_API_KEY no serviço portal-missionario do Render (não no GitHub). O remetente padrão é Mensagens Missionárias <mensagens@mail.familycode.com.br>, desde que esteja verificado no Resend. O portal envia diretamente pelo servidor. Somente mensagens ENVIADA vinculadas ao e-mail do missionário permitem resposta. Cada mensagem admite uma resposta; em caso de resultado incerto, o envio fica bloqueado para evitar duplicidade. O registro de status 'sent' confirma aceite do Resend, não entrega na caixa do destinatário.
