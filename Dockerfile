# Use a base image that has Puppeteer dependencies pre-installed
FROM ghcr.io/puppeteer/puppeteer:latest

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package.json ./

# Install Node.js dependencies
# The --omit=dev flag prevents installing dev dependencies in production
RUN npm install --omit=dev

# Copy the rest of your application's source code
COPY . .

# Build your application (if applicable, e.g., Next.js, etc.)
# RUN npm run build

# Expose the port your Express app listens on
EXPOSE 10000

# Command to run your application
CMD [ "node", "app.js" ]
