package api

import (
	"backend/core"
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

type TargetsRequest struct {
	Targets []string `json:"targets" binding:"required"`
}

// Add this struct and map at the package level
type rateLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

var (
	limiters      = make(map[string]*rateLimiter)
	limitersMutex sync.Mutex
)

func RunServer() {
	router := gin.Default()

	// Add CORS middleware
	router.Use(func(c *gin.Context) {
		allowedOrigins := []string{"http://localhost:5173", "https://ethereum-address-scraper.web.app", "https://ethereum-address-scraper.firebaseapp.com"}
		origin := c.Request.Header.Get("Origin")

		if origin != "" {
			for _, allowedOrigin := range allowedOrigins {
				if origin == allowedOrigin {
					c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
					break
				}
			}
		}

		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	var firebaseApp *firebase.App
	var auth *auth.Client
	ctx := context.Background()
	isProduction := os.Getenv("APP_ENV") == "production"
	if isProduction {
		var err error
		firebaseApp, err = firebase.NewApp(ctx, &firebase.Config{
			ProjectID: "ethereum-address-scraper",
		})
		if err != nil {
			log.Fatalf("error initializing app: %v\n", err)
			panic(err)
		}
		auth, err = firebaseApp.Auth(ctx)
		if err != nil {
			log.Fatalf("error initializing auth: %v\n", err)
			panic(err)
		}
	}

	router.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	router.POST("/scrape", func(c *gin.Context) {
		var request TargetsRequest
		// Create a context with a 30-second timeout
		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()

		// Check for authorization headers if in production
		if isProduction {
			authHeader := c.GetHeader("Authorization")
			if authHeader == "" {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Authorization header required",
				})
				return
			}

			// If Authorization headers is not starting with "Bearer ", return 401
			if !strings.HasPrefix(authHeader, "Bearer ") {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Authorization header must be a Bearer Token",
				})
				return
			}

			// strip "Bearer " from the beginning of the string
			token := strings.TrimPrefix(authHeader, "Bearer ")

			// Verify the token
			_, err := auth.VerifyIDToken(ctx, token)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
				return
			}

			// Apply rate limiting
			if !allowRequest(token) {
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
				return
			}
		}

		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request",
			})
			return
		}

		if len(request.Targets) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Targets array must have at least one URL",
			})
			return
		}

		for _, target := range request.Targets {
			if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "All targets must start with 'http://' or 'https://'",
				})
				return
			}
		}

		// Create a channel to receive the scraping results
		resultsChan := make(chan []core.AddressInfo)
		errChan := make(chan error)

		go func() {
			results, err := core.Scrape(request.Targets)
			if err != nil {
				errChan <- err
				return
			}
			resultsChan <- results
		}()

		select {
		case <-ctx.Done():
			c.JSON(http.StatusRequestTimeout, gin.H{
				"error": "Request timed out after 30 seconds",
			})
			return
		case err := <-errChan:
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to scrape targets: " + err.Error(),
			})
			return
		case results := <-resultsChan:
			c.JSON(http.StatusOK, gin.H{
				"message": "Data fetched successfully",
				"results": results,
			})
		}
	})

	go func() {
		for {
			time.Sleep(1 * time.Hour)
			cleanupLimiters()
		}
	}()

	router.Run(":8080")
}

func allowRequest(token string) bool {
	limitersMutex.Lock()
	defer limitersMutex.Unlock()

	limiter, exists := limiters[token]
	if !exists {
		// Create a new limiter with a rate of 1 per second and a burst of 30
		limiter = &rateLimiter{limiter: rate.NewLimiter(rate.Limit(1), 30)}
		limiters[token] = limiter
	}

	// Update last seen time
	limiter.lastSeen = time.Now()

	// Try to allow the request
	return limiter.limiter.Allow()
}

// Add this function to clean up old limiters
func cleanupLimiters() {
	limitersMutex.Lock()
	defer limitersMutex.Unlock()

	for token, limiter := range limiters {
		if time.Since(limiter.lastSeen) > 1*time.Hour {
			delete(limiters, token)
		}
	}
}
