
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm install -g serve
CMD ["sh", "-c", "if [ -d 'dist' ]; then serve -s dist -l 3000; elif [ -d 'build' ]; then serve -s build -l 3000; else echo 'Build directory not found'; fi"]
