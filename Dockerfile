FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# 仅安装生产依赖（本项目仅依赖 express，其余使用 Node 内置模块）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制源码与静态前端
COPY . .

# 数据目录：挂载命名卷持久化 SQLite 数据库与快照
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
