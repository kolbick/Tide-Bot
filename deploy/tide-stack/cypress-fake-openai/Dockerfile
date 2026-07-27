FROM node:22-alpine

WORKDIR /fixture
COPY server.mjs /fixture/server.mjs

USER node
EXPOSE 8081

CMD ["node", "/fixture/server.mjs"]
