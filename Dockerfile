# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy the source code
COPY . .

# Build the Go app statically
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o express-websocket .

# Final stage (minimal image)
FROM alpine:latest

WORKDIR /app

# Add bash and ca-certificates for N8N webhook TLS
RUN apk --no-cache add ca-certificates tzdata

# Copy the pre-built binary file from the previous stage
COPY --from=builder /app/express-websocket .
COPY --from=builder /app/public ./public

# Expose port (default 3000)
EXPOSE 3000

# Command to run the executable
CMD ["./express-websocket"]
