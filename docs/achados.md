# Achados

Coisas notadas de passagem que **não** cabiam na tarefa de quem notou — bug no núcleo congelado,
número suspeito, atrito. Uma linha por achado, append no fim, com a data e o arquivo. Não conserte
o que não é seu: registre aqui e siga.

- **2026-08-17** — `package.json`: o script de teste usava aspas simples no glob (`'src/**/*.test.ts'`),
  que o shell do Windows não expande — `npm test` rodava **0 testes e saía verde**. Trocado por aspas
  duplas. Se voltar a aparecer 0 teste, é isso.
