# Use lightweight Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better build caching
COPY package*.json ./

# Install all dependencies (including dev dependencies)
RUN npm install

# Copy the rest of the application
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose backend port
EXPOSE 4000

# Run the app using nodemon for hot reload in development
CMD ["npm", "run", "dev"]
