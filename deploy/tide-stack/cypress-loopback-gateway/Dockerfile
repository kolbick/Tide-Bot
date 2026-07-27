FROM node:22-alpine

WORKDIR /gateway
COPY server.mjs /gateway/server.mjs

USER node
EXPOSE 8080 8081

CMD ["node", "/gateway/server.mjs"]
