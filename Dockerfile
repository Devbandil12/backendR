# Use a base image that has Puppeteer dependencies pre-installed
FROM ghcr.io/puppeteer/puppeteer:latest

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package.json ./

# Install Node.js dependencies
RUN npm install --omit=dev

# Copy the rest of your application's source code
COPY . .

# Expose the port your Express app listens on
EXPOSE 10000

# Command to run your application
CMD [ "node", "app.js" ]
