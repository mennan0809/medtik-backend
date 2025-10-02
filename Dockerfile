# Use Node.js LTS
FROM node:18

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your app
COPY . .

# Expose app port
EXPOSE 4000

# Default command (Docker Compose can override this)
CMD ["npm", "run", "dev"]
