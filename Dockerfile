FROM node:22-alpine3.22
WORKDIR /app
RUN corepack enable && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
COPY package.json yarn.lock* tsconfig.json ./
RUN yarn --frozen-lockfile
COPY src ./src
VOLUME /app/db
VOLUME /app/log
CMD ["yarn", "sync_cn"]
