FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY src ./src
COPY public ./public
COPY test ./test
COPY README.md ./
EXPOSE 8080
USER node
CMD ["node", "server.js"]