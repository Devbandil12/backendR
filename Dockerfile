# Puppeteer base image with Chromium already included
FROM ghcr.io/puppeteer/puppeteer:latest

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose port for Express
EXPOSE 10000

# Start the app
CMD ["node", "app.js"]
